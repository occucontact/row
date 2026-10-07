// =============================================================
// Shared cloud-sync helper. Each page calls initCloudSync({...}).
// Needs supabase-js + supa.js loaded first, and a signed-in user
// (lock.html). Without a session the page simply stays local-only.
//
// Each page's synced keys live in one JSON row of public.app_state,
// keyed "<profile>-<appKey>". Row level security limits every row
// to its owner (supabase/security.sql).
// =============================================================
(function () {
  'use strict';

  const PUSH_DEBOUNCE_MS = 250;

  window.initCloudSync = function (config) {
    const baseKey = config && config.appKey;
    const appKey = (window.activeProfile ? window.activeProfile.toLowerCase() + '-' : '') + (baseKey || '');
    const syncedKeys = (config && config.syncedKeys) || [];
    const syncedPrefixes = (config && config.syncedPrefixes) || [];
    const onApplied = config && config.onApplied;
    const supa = window.getSupa && window.getSupa();
    if (!baseKey || !supa) return;

    // profile.js stores keys as "profile:<NAME>:<key>" but localStorage.key()
    // returns those raw names, so strip the prefix before matching.
    const profilePrefix = window.activeProfile ? 'profile:' + window.activeProfile + ':' : '';
    // One-time flag per device + row: the first sync after the security
    // upgrade merges instead of overwriting (see init below).
    const mergedFlag = '_sync_merged_v2:' + appKey;

    let pushTimer = null, suppressSync = false, lastSyncedJson = null, ready = false;

    function matches(k) {
      if (!k) return false;
      if (syncedKeys.indexOf(k) !== -1) return true;
      for (let i = 0; i < syncedPrefixes.length; i++) {
        if (k.indexOf(syncedPrefixes[i]) === 0) return true;
      }
      return false;
    }
    function unprefixed(raw) {
      if (!profilePrefix) return raw;
      return raw && raw.indexOf(profilePrefix) === 0 ? raw.slice(profilePrefix.length) : null;
    }
    function listAllKeys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = unprefixed(localStorage.key(i));
        if (matches(k)) out.push(k);
      }
      return out;
    }
    function collect() {
      const out = {};
      for (const k of listAllKeys()) {
        const v = localStorage.getItem(k);
        if (v == null) continue;
        try { out[k] = JSON.parse(v); } catch (e) { out[k] = v; }
      }
      return out;
    }

    const origSet = localStorage.setItem.bind(localStorage);
    const origRemove = localStorage.removeItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      origSet(k, v);
      try { if (!suppressSync && matches(k)) schedulePush(); } catch (e) {}
    };
    localStorage.removeItem = function (k) {
      origRemove(k);
      try { if (!suppressSync && matches(k)) schedulePush(); } catch (e) {}
    };

    function applyRemote(remote) {
      if (!remote || typeof remote !== 'object') return false;
      suppressSync = true;
      let changed = false;
      try {
        for (const k of Object.keys(remote)) {
          if (!matches(k)) continue;
          const incoming = JSON.stringify(remote[k]);
          if (localStorage.getItem(k) !== incoming) {
            try { origSet(k, incoming); changed = true; } catch (e) {}
          }
        }
        for (const k of listAllKeys()) {
          if (!(k in remote)) { try { origRemove(k); changed = true; } catch (e) {} }
        }
      } finally { suppressSync = false; }
      if (changed && typeof onApplied === 'function') { try { onApplied(); } catch (e) {} }
      return changed;
    }

    async function pushNow() {
      if (!ready) return false;
      const state = collect();
      const json = JSON.stringify(state);
      if (json === lastSyncedJson) return true;
      try {
        const { error } = await supa.from('app_state').upsert(
          { key: appKey, data: state, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
        if (error) return false;
        lastSyncedJson = json;
        return true;
      } catch (e) { return false; }
    }
    function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, PUSH_DEBOUNCE_MS); }

    function flushOnUnload() {
      if (!ready) return;
      const token = window.getSupaAccessToken && window.getSupaAccessToken();
      if (!token) return;
      const state = collect();
      const json = JSON.stringify(state);
      if (json === lastSyncedJson) return;
      try {
        fetch(window.SUPA_URL + '/rest/v1/app_state?on_conflict=key', {
          method: 'POST',
          headers: {
            'apikey': window.SUPA_KEY,
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify({ key: appKey, data: state, updated_at: new Date().toISOString() }),
          keepalive: true,
        }).catch(() => {});
        lastSyncedJson = json;
      } catch (e) {}
    }

    (async function init() {
      const user = await window.getSupaUser();
      if (!user) return;   // not signed in → local only
      let remote = {};
      try {
        const { data, error } = await supa.from('app_state').select('data').eq('key', appKey).maybeSingle();
        if (error) return;   // e.g. offline — try again on next page load
        remote = (data && data.data && typeof data.data === 'object') ? data.data : {};
      } catch (e) { return; }
      ready = true;

      const local = collect();
      if (!localStorage.getItem(mergedFlag)) {
        // Sync was broken for a while, so this device may hold newer data
        // than the cloud. Merge (local wins per key) so nothing is lost.
        const merged = Object.assign({}, remote, local);
        applyRemote(merged);
        if (await pushNow()) { try { origSet(mergedFlag, '1'); } catch (e) {} }
      } else if (Object.keys(remote).length > 0) {
        lastSyncedJson = JSON.stringify(remote);
        applyRemote(remote);
      } else if (Object.keys(local).length > 0) {
        schedulePush();
      }

      supa.channel('app_state_' + appKey)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'app_state', filter: 'key=eq.' + appKey,
        }, (payload) => {
          if (!payload.new || !payload.new.data) return;
          const incoming = JSON.stringify(payload.new.data);
          if (incoming === lastSyncedJson) return;
          lastSyncedJson = incoming;
          applyRemote(payload.new.data);
        })
        .subscribe();
    })();

    window.addEventListener('beforeunload', flushOnUnload);
    window.addEventListener('pagehide', flushOnUnload);
    window.addEventListener('storage', (e) => { if (e.key && matches(unprefixed(e.key))) schedulePush(); });
  };
})();
