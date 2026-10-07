// =============================================================
// Shared Supabase client. Load right after the supabase-js CDN
// script and before sync.js / page code:
//     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//     <script src="supa.js"></script>
//
// The publishable key below is meant to be public — row level
// security in the database (supabase/security.sql) makes sure only
// the signed-in owner can read or write anything.
// =============================================================
(function () {
  'use strict';

  var SUPA_URL = 'https://yntpsdcjqeewgcozfqxg.supabase.co';
  var SUPA_KEY = 'sb_publishable_czAWpjJwmdO19E_kO2ROLA_DpPs00lg';
  // Starts with "_" so profile.js never namespaces it: one login
  // covers every profile and every page.
  var STORAGE_KEY = '_sb_auth';

  var client = null;

  window.SUPA_URL = SUPA_URL;
  window.SUPA_KEY = SUPA_KEY;
  window.SUPA_STORAGE_KEY = STORAGE_KEY;

  window.getSupa = function () {
    if (client) return client;
    if (!window.supabase || !window.supabase.createClient) return null;
    client = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
      auth: {
        storageKey: STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
    return client;
  };

  // Resolves to the signed-in user, or null (not signed in / offline).
  window.getSupaUser = async function () {
    var c = window.getSupa();
    if (!c) return null;
    try {
      var res = await c.auth.getSession();
      return res && res.data && res.data.session ? res.data.session.user : null;
    } catch (e) {
      return null;
    }
  };

  // Synchronous token for keepalive fetches during page unload,
  // where awaiting getSession() is not possible.
  window.getSupaAccessToken = function () {
    try {
      var s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return (s && s.access_token) || null;
    } catch (e) {
      return null;
    }
  };
})();
