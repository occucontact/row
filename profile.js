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

  // ── Read session ────────────────────────────────────────────
  var sess;
  try { sess = JSON.parse(localStorage.getItem(SESS_KEY)); } catch (e) {}

  // ── Auth guard ──────────────────────────────────────────────
  // A valid session must have both authenticated + profile.
  if (!sess || !sess.authenticated || !sess.profile) {
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
  var _get    = localStorage.getItem.bind(localStorage);
  var _set    = localStorage.setItem.bind(localStorage);
  var _remove = localStorage.removeItem.bind(localStorage);

  // Keys that start with "_" bypass profiling (e.g. _auth, _session).
  function pfx(k) {
    if (typeof k !== 'string' || k.charAt(0) === '_') return k;
    return 'profile:' + profile + ':' + k;
  }

  localStorage.getItem    = function (k) { return _get(pfx(k)); };
  localStorage.setItem    = function (k, v) { _set(pfx(k), v); };
  localStorage.removeItem = function (k) { _remove(pfx(k)); };

  // Patch dashLogout/dashSwitch to use the undecorated _remove
  // so they can still clear the _session key correctly even after
  // the wrapper has been installed.
  window.dashLogout = function () {
    _remove(SESS_KEY);
    window.location.replace('lock.html');
  };
  window.dashSwitch = function () {
    try { _set(SESS_KEY, JSON.stringify({ authenticated: true })); } catch (e) {}
    window.location.replace('lock.html');
  };

  // Restore page visibility (only reached when auth passes).
  document.documentElement.style.visibility = '';
})();
