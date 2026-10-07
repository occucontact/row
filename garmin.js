// =============================================================
// Garmin card for the dashboard home page.
// Renders into <section id="garminCard"> from the "<profile>-garmin"
// row that scripts/occu_sync.py writes. Read-only; the last copy is
// cached in localStorage so the card also shows offline.
// =============================================================
(function () {
  'use strict';

  const CACHE_KEY = 'garmin:cache';
  const TREND_DAYS = 7;
  const STALE_HOURS = 30;   // flag data older than this (sync not running)

  const css = `
.grm-card {
  margin: 0 0 18px; padding: 18px 18px 16px;
  border-radius: 16px;
  background: linear-gradient(160deg, rgba(0,124,195,0.10) 0%, rgba(255,255,255,0.03) 55%), var(--bg-card, #161b22);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
}
.grm-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
.grm-label { font: 800 10px/1 var(--font-mono, monospace); letter-spacing: 0.18em; color: #4FB3F6; }
.grm-updated { font: 600 11px/1 var(--font-mono, monospace); color: var(--text-tertiary, #76746E); }
.grm-updated.stale { color: var(--warning, #d29922); }
.grm-hero { display: grid; grid-template-columns: 1.3fr 1fr; gap: 10px; }
.grm-tile {
  padding: 12px 14px; border-radius: 12px;
  background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.05);
  min-width: 0;
}
.grm-tile-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary, #76746E); }
.grm-big { font: 800 30px/1.05 var(--font-mono, monospace); color: var(--text-primary, #e6edf3); margin-top: 6px; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.grm-big small { font-size: 13px; font-weight: 700; color: var(--text-secondary, #8b949e); margin-left: 3px; letter-spacing: 0; }
.grm-sub { font-size: 12px; color: var(--text-secondary, #8b949e); margin-top: 5px; }
.grm-pill { display: inline-block; font: 800 9.5px/1 var(--font-mono, monospace); letter-spacing: 0.1em; padding: 3px 6px; border-radius: 5px; margin-left: 6px; vertical-align: 2px; }
.grm-pill.good { background: rgba(63,185,80,0.16); color: var(--success, #3fb950); }
.grm-pill.warn { background: rgba(210,153,34,0.16); color: var(--warning, #d29922); }
.grm-pill.bad  { background: rgba(248,81,73,0.16); color: var(--danger, #f85149); }
.grm-stages { display: flex; height: 6px; border-radius: 6px; overflow: hidden; margin-top: 10px; background: rgba(255,255,255,0.06); }
.grm-stages span { display: block; height: 100%; }
.grm-bb { position: relative; height: 6px; border-radius: 6px; margin-top: 10px; background: rgba(255,255,255,0.06); }
.grm-bb-range { position: absolute; top: 0; bottom: 0; border-radius: 6px; background: linear-gradient(90deg, #F2C063, #6BE3A4); }
.grm-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; }
.grm-row .grm-big { font-size: 20px; }
.grm-trend { display: flex; align-items: flex-end; gap: 4px; height: 34px; margin-top: 12px; }
.grm-trend-bar { flex: 1; border-radius: 3px 3px 1px 1px; background: rgba(79,179,246,0.35); min-height: 3px; }
.grm-trend-bar.today { background: #4FB3F6; }
.grm-trend-caption { display: flex; justify-content: space-between; font: 600 10px/1 var(--font-mono, monospace); color: var(--text-tertiary, #76746E); margin-top: 5px; }
.grm-act {
  display: flex; align-items: center; gap: 10px; margin-top: 12px;
  padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.035);
  font-size: 12.5px; color: var(--text-secondary, #8b949e);
}
.grm-act strong { color: var(--text-primary, #e6edf3); font-weight: 700; }
.grm-act-icon { font-size: 16px; }
@media (max-width: 480px) {
  .grm-big { font-size: 26px; }
  .grm-row .grm-big { font-size: 17px; }
}
`;

  const ACT_ICON = { running: '🏃', trail_running: '🏃', treadmill_running: '🏃', cycling: '🚴', indoor_cycling: '🚴',
    walking: '🚶', hiking: '🥾', strength_training: '🏋️', indoor_cardio: '🫀', swimming: '🏊', lap_swimming: '🏊' };
  const ACT_NAME = { running: 'Løping', trail_running: 'Terrengløp', treadmill_running: 'Mølle', cycling: 'Sykling',
    indoor_cycling: 'Spinning', walking: 'Gåtur', hiking: 'Fjelltur', strength_training: 'Styrke',
    indoor_cardio: 'Kondisjon inne', swimming: 'Svømming', lap_swimming: 'Svømming' };
  const HRV_STATUS = { BALANCED: ['Balansert', 'good'], UNBALANCED: ['Ubalansert', 'warn'], LOW: ['Lav', 'bad'], POOR: ['Dårlig', 'bad'] };

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  function hm(sec) { const m = Math.round(sec / 60); return Math.floor(m / 60) + 't ' + pad(m % 60) + 'm'; }
  function mmss(sec) { const s = Math.round(sec); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60); }
  const num = n => Number(n).toLocaleString('nb-NO');

  function sleepScoreClass(s) { return s >= 80 ? 'good' : s >= 60 ? 'warn' : 'bad'; }

  function render(data) {
    const el = document.getElementById('garminCard');
    if (!el || !data || !data.days) return;
    const days = data.days;
    const now = new Date();
    const todayKey = keyOf(now);
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    const yestKey = keyOf(yest);
    // Garmin files last night's sleep under today's date.
    const night = days[todayKey] && days[todayKey].sleepSec ? days[todayKey] : (days[yestKey] || {});
    const day = days[todayKey] || {};
    const prev = days[yestKey] || {};

    const updated = data.updatedAt ? new Date(data.updatedAt) : null;
    const stale = !updated || (now - updated) > STALE_HOURS * 3600 * 1000;
    const updatedText = updated
      ? 'oppdatert ' + (keyOf(updated) === todayKey ? '' : (window.nb ? nb.dateObj(updated) + ' ' : '')) +
        pad(updated.getHours()) + ':' + pad(updated.getMinutes())
      : 'ingen data ennå';

    // Sleep tile
    let sleepTile = '<div class="grm-tile"><div class="grm-tile-label">Søvn</div>';
    if (night.sleepSec) {
      const total = (night.deepSec || 0) + (night.remSec || 0) + (night.lightSec || 0) + (night.awakeSec || 0) || night.sleepSec;
      const seg = (v, c) => v ? '<span style="width:' + (v / total * 100).toFixed(1) + '%;background:' + c + '"></span>' : '';
      sleepTile += '<div class="grm-big">' + esc(hm(night.sleepSec)) +
        (night.sleepScore != null ? '<span class="grm-pill ' + sleepScoreClass(night.sleepScore) + '">' + night.sleepScore + '</span>' : '') + '</div>' +
        '<div class="grm-stages" aria-hidden="true">' + seg(night.deepSec, '#3B6FD8') + seg(night.lightSec, '#4FB3F6') +
        seg(night.remSec, '#A78BFA') + seg(night.awakeSec, '#F2C063') + '</div>' +
        '<div class="grm-sub">Dyp ' + hm(night.deepSec || 0) + ' · REM ' + hm(night.remSec || 0) + '</div>';
    } else {
      sleepTile += '<div class="grm-big">—</div><div class="grm-sub">Ingen søvndata</div>';
    }
    sleepTile += '</div>';

    // Body Battery tile (today if present, else yesterday)
    const bbDay = day.bbHigh != null ? day : prev;
    let bbTile = '<div class="grm-tile"><div class="grm-tile-label">Body Battery</div>';
    if (bbDay.bbHigh != null) {
      const lo = bbDay.bbLow || 0, hi = bbDay.bbHigh;
      bbTile += '<div class="grm-big">' + (bbDay.bbNow != null && bbDay === day ? bbDay.bbNow : hi) + '<small>/100</small></div>' +
        '<div class="grm-bb" aria-hidden="true"><div class="grm-bb-range" style="left:' + lo + '%;width:' + Math.max(2, hi - lo) + '%"></div></div>' +
        '<div class="grm-sub">' + lo + ' → ' + hi + (bbDay === day ? ' i dag' : ' i går') + '</div>';
    } else {
      bbTile += '<div class="grm-big">—</div>';
    }
    bbTile += '</div>';

    // Small metrics row
    const hrvStatus = HRV_STATUS[night.hrvStatus];
    const stepsDay = day.steps != null ? day : prev;
    const small = (label, value, sub) => '<div class="grm-tile"><div class="grm-tile-label">' + label + '</div>' +
      '<div class="grm-big">' + value + '</div><div class="grm-sub">' + sub + '</div></div>';
    const row =
      small('HRV', night.hrv != null ? night.hrv + '<small>ms</small>' : '—',
        hrvStatus ? '<span class="grm-pill ' + hrvStatus[1] + '" style="margin-left:0">' + hrvStatus[0] + '</span>'
          : (night.hrvWeek ? 'snitt ' + night.hrvWeek : '')) +
      small('Hvilepuls', (night.restingHr || day.restingHr || prev.restingHr || '—') + '<small>bpm</small>',
        day.stress != null ? 'stress ' + day.stress : (prev.stress != null ? 'stress ' + prev.stress + ' i går' : '')) +
      small('Skritt', stepsDay.steps != null ? num(stepsDay.steps) : '—',
        stepsDay.stepGoal ? 'mål ' + num(stepsDay.stepGoal) + (stepsDay === day ? '' : ' · i går') : '');

    // 7-day sleep trend
    const trendKeys = [];
    for (let i = TREND_DAYS - 1; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i); trendKeys.push(keyOf(d)); }
    const maxSleep = Math.max(9 * 3600, ...trendKeys.map(k => (days[k] && days[k].sleepSec) || 0));
    const trend = '<div class="grm-trend" role="img" aria-label="Søvn siste 7 dager">' + trendKeys.map(k => {
      const s = (days[k] && days[k].sleepSec) || 0;
      return '<div class="grm-trend-bar' + (k === todayKey ? ' today' : '') + '" style="height:' + (s / maxSleep * 100).toFixed(0) + '%" title="' + k + ': ' + (s ? hm(s) : 'ingen data') + '"></div>';
    }).join('') + '</div><div class="grm-trend-caption"><span>Søvn 7 dager</span><span>i natt</span></div>';

    // Latest activity
    const a = (data.activities || [])[0];
    let act = '';
    if (a) {
      const when = a.start ? (window.nb ? nb.date(a.start.slice(0, 10)) : a.start.slice(0, 10)) : '';
      const parts = [];
      if (a.distanceM) parts.push((a.distanceM / 1000).toLocaleString('nb-NO', { maximumFractionDigits: 1 }) + ' km');
      if (a.durationSec) parts.push(mmss(a.durationSec));
      if (a.avgHr) parts.push('puls ' + Math.round(a.avgHr));
      act = '<div class="grm-act"><span class="grm-act-icon" aria-hidden="true">' + (ACT_ICON[a.type] || '⌚') + '</span>' +
        '<span><strong>' + esc(ACT_NAME[a.type] || a.name || 'Aktivitet') + '</strong> · ' + esc(parts.join(' · ')) +
        '<br><span style="color:var(--text-tertiary,#76746E)">' + esc(when) + '</span></span></div>';
    }

    el.innerHTML =
      '<div class="grm-head"><span class="grm-label">GARMIN</span>' +
      '<span class="grm-updated' + (stale ? ' stale' : '') + '">' + esc(updatedText) + (stale && updated ? ' · synk stoppet?' : '') + '</span></div>' +
      '<div class="grm-hero">' + sleepTile + bbTile + '</div>' +
      '<div class="grm-row">' + row + '</div>' + trend + act;
    el.hidden = false;
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { return null; }
  }

  async function load() {
    const supa = window.getSupa && window.getSupa();
    if (!supa || !window.activeProfile) return;
    try {
      const user = await window.getSupaUser();
      if (!user) return;
      const { data, error } = await supa.from('app_state').select('data')
        .eq('key', window.activeProfile.toLowerCase() + '-garmin').maybeSingle();
      if (error || !data || !data.data) return;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data.data)); } catch (e) { /* storage full — card still renders */ }
      render(data.data);
    } catch (e) { /* offline — cached copy already shown */ }
  }

  function boot() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    render(readCache());
    load();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
