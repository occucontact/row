// =============================================================
// Profile auth guard + per-profile localStorage namespace.
// Load as the FIRST non-deferred <script> in every page <head>
// (except lock.html). Does three things:
//
//  1. Redirects to lock.html immediately if no active session.
//  2. Exposes window.activeProfile and window.dashLogout /
//     window.dashSwitch for the topbar.
//  3. Wraps localStorage so every read/write is transparently
//     scoped to the active profile:
//       "goals:2026-01-01"  →  "profile:ICEMAN:goals:2026-01-01"
//     Keys that start with "_" are never prefixed (system keys
//     like _auth and _session).
// =============================================================
(function () {
  'use strict';

  var SESS_KEY = '_session';
  var SUPA_AUTH_KEY = '_sb_auth';   // Supabase login token (see supa.js)

  // ── Read session ────────────────────────────────────────────
  var sess;
  try { sess = JSON.parse(localStorage.getItem(SESS_KEY)); } catch (e) {}

  // ── Auth guard ──────────────────────────────────────────────
  // A valid session needs a Supabase login token plus a chosen profile.
  // (The token is checked for presence only so pages still open offline;
  // the database itself rejects anything without a valid token.)
  var hasLogin = false;
  try { hasLogin = !!localStorage.getItem(SUPA_AUTH_KEY); } catch (e) {}
  if (!hasLogin || !sess || !sess.authenticated || !sess.profile) {
    // Hide any flash of page content before the navigation fires.
    document.documentElement.style.visibility = 'hidden';
    window.location.replace('lock.html');
    // Stop all further script execution on this page.
    throw new Error('profile:auth-redirect');
  }

  var profile = sess.profile;

  // ── Expose globals ──────────────────────────────────────────
  window.activeProfile = profile;

  // Logout: clear session entirely → lock screen (needs password again).
  window.dashLogout = function () {
    localStorage.removeItem(SESS_KEY); // bypasses prefix — see below
    window.location.replace('lock.html');
  };

  // Switch profile: keep "authenticated" flag but clear profile
  // → lock screen goes straight to profile picker (no re-entry of password).
  window.dashSwitch = function () {
    try {
      localStorage.setItem(SESS_KEY,
        JSON.stringify({ authenticated: true }));
    } catch (e) {}
    window.location.replace('lock.html');
  };

  // ── localStorage namespace wrapper ──────────────────────────
  // Patched on Storage.prototype, NOT by assigning localStorage.setItem:
  // Safari treats that assignment as storing an item named "setItem" and
  // keeps the original method, so the namespace silently never applied.
  var ls = window.localStorage;
  var proto = Storage.prototype;
  var rawGet = proto.getItem, rawSet = proto.setItem, rawRemove = proto.removeItem;
  var _get    = function (k) { return rawGet.call(ls, k); };
  var _set    = function (k, v) { rawSet.call(ls, k, v); };
  var _remove = function (k) { rawRemove.call(ls, k); };

  // Keys that start with "_" bypass profiling (e.g. _auth, _session).
  function pfx(k) {
    if (typeof k !== 'string' || k.charAt(0) === '_') return k;
    return 'profile:' + profile + ':' + k;
  }

  // localStorage.key() returns raw names; use this to list the active
  // profile's keys (unprefixed), e.g. profileStorageKeys('goals:').
  window.profileStorageKeys = function (prefix) {
    var own = 'profile:' + profile + ':';
    var out = [];
    for (var i = 0; i < ls.length; i++) {
      var raw = ls.key(i);
      if (!raw || raw.indexOf(own) !== 0) continue;
      var k = raw.slice(own.length);
      if (!prefix || k.indexOf(prefix) === 0) out.push(k);
    }
    return out;
  };

  // Other modules (sync.js, gym.html) subscribe here instead of wrapping
  // setItem themselves. Listeners get the unprefixed key.
  var writeListeners = [];
  window.onProfileStorageWrite = function (fn) { writeListeners.push(fn); };
  function notifyWrite(k) {
    for (var i = 0; i < writeListeners.length; i++) {
      try { writeListeners[i](k); } catch (e) { /* a listener must never block the write */ }
    }
  }

  proto.getItem = function (k) {
    return rawGet.call(this, this === ls ? pfx(k) : k);
  };
  proto.setItem = function (k, v) {
    if (this !== ls) return rawSet.call(this, k, v);
    rawSet.call(this, pfx(k), v);
    notifyWrite(k);
  };
  proto.removeItem = function (k) {
    if (this !== ls) return rawRemove.call(this, k);
    rawRemove.call(this, pfx(k));
    notifyWrite(k);
  };

  // ── One-time repair for browsers where the old wrapper never worked ──
  // Copy un-namespaced app keys into the active profile (never overwriting
  // existing profile data), and drop the junk items Safari created when the
  // old code assigned functions to localStorage.setItem/getItem/removeItem.
  // The raw originals are kept as a fallback copy.
  var MIGRATED_KEY = '_profile_keys_migrated_v1';
  var JUNK_KEYS = { setItem: 1, getItem: 1, removeItem: 1, key: 1, clear: 1 };
  if (!_get(MIGRATED_KEY)) {
    try {
      var rawKeys = [];
      for (var i = 0; i < ls.length; i++) {
        var rk = ls.key(i);
        if (!rk || rk.charAt(0) === '_' || rk.indexOf('profile:') === 0 || rk.indexOf('sb-') === 0) continue;
        rawKeys.push(rk);
      }
      rawKeys.forEach(function (rk) {
        if (JUNK_KEYS[rk]) { _remove(rk); return; }
        if (_get(pfx(rk)) == null) _set(pfx(rk), _get(rk));
      });
      _set(MIGRATED_KEY, profile);
    } catch (e) { /* storage full — retry on next load */ }
  }

  // Patch dashLogout/dashSwitch to use the undecorated _remove
  // so they can still clear the _session key correctly even after
  // the wrapper has been installed.
  window.dashLogout = function () {
    _remove(SESS_KEY);
    var done = function () {
      _remove(SUPA_AUTH_KEY);
      window.location.replace('lock.html');
    };
    // Also revoke the refresh token server-side when the client is loaded.
    try {
      var c = window.getSupa && window.getSupa();
      // scope 'local': end only this browser's session, not the Mac sync job's.
      if (c) { c.auth.signOut({ scope: 'local' }).then(done, done); return; }
    } catch (e) {}
    done();
  };
  window.dashSwitch = function () {
    try { _set(SESS_KEY, JSON.stringify({ authenticated: true })); } catch (e) {}
    window.location.replace('lock.html');
  };

  // Restore page visibility (only reached when auth passes).
  document.documentElement.style.visibility = '';
})();
