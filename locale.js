// Shared nb-NO locale helpers — loaded on every app page.
window.nb = (function () {
  'use strict';

  var LOCALE = 'nb-NO';

  var _clock = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });
  var _date  = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
  var _dateLong = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  // "14:35"
  function clock(d) { return _clock.format(d); }

  // "man. 2. jan." from "2026-01-02"
  function date(yyyy_mm_dd) {
    var p = yyyy_mm_dd.split('-').map(Number);
    return _date.format(new Date(p[0], p[1] - 1, p[2]));
  }

  // "man. 2. jan." from a Date object
  function dateObj(d) { return _date.format(d); }

  // "man. 2. jan. 2026" from a Date object
  function dateLong(d) { return _dateLong.format(d); }

  // Duration in minutes → "2t 30 min" / "45 min"
  function duration(totalMin) {
    var h = Math.floor(totalMin / 60);
    var m = Math.floor(totalMin % 60);
    if (h === 0) return m + ' min';
    if (m === 0) return h + 't';
    return h + 't ' + m + ' min';
  }

  // Number with comma as decimal separator
  function num(n, opts) {
    return n.toLocaleString(LOCALE, opts || {});
  }

  // Short month abbreviations in Norwegian (uppercase)
  var MONTHS_SHORT = ['JAN','FEB','MAR','APR','MAI','JUN','JUL','AUG','SEP','OKT','NOV','DES'];
  var MONTHS_MIX   = ['Jan','Feb','Mar','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Des'];

  return { clock: clock, date: date, dateObj: dateObj, dateLong: dateLong, duration: duration, num: num, MONTHS_SHORT: MONTHS_SHORT, MONTHS_MIX: MONTHS_MIX };
})();
