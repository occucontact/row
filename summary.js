// =============================================================
// Health summary card for the dashboard home page.
// Renders <section id="summaryCard"> from the "<profile>-summary" row
// that scripts/occu_sync.py writes every few days (Claude-written text).
// Read-only, cached in localStorage for offline use.
// =============================================================
(function () {
  'use strict';

  const CACHE_KEY = 'summary:cache';
  const EVERY_DAYS = 4;

  const css = `
.hsum-card {
  margin: 0 0 18px; padding: 18px 18px 14px;
  border-radius: 16px;
  background: linear-gradient(160deg, rgba(198,243,109,0.08) 0%, rgba(255,255,255,0.03) 55%), var(--bg-card, #161b22);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
}
.hsum-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.hsum-label { font: 800 10px/1 var(--font-mono, monospace); letter-spacing: 0.18em; color: #C6F36D; }
.hsum-meta { font: 600 11px/1.3 var(--font-mono, monospace); color: var(--text-tertiary, #76746E); text-align: right; }
.hsum-body { font-size: 14px; line-height: 1.6; color: var(--text-secondary, #8b949e); }
.hsum-body p { margin: 0 0 10px; }
.hsum-body strong { color: var(--text-primary, #e6edf3); font-weight: 700; }
.hsum-body ul { margin: 4px 0 6px; padding-left: 18px; }
.hsum-body li { margin: 3px 0; }
.hsum-body li::marker { color: #C6F36D; }
.hsum-older { margin-top: 6px; font-size: 13px; }
.hsum-older summary { cursor: pointer; color: var(--text-tertiary, #76746E); font-weight: 600; padding: 6px 0; }
.hsum-older summary:hover { color: var(--text-secondary, #8b949e); }
.hsum-older details { border-top: 1px solid rgba(255,255,255,0.06); padding: 4px 0; }
.hsum-older .hsum-body { font-size: 13px; padding: 4px 0 6px; }
`;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Tiny renderer for the fixed format the summary uses: **bold**, "- " lists, paragraphs.
  // Input is escaped first, so the text can never inject HTML.
  function toHtml(text) {
    const out = [];
    let list = null;
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    String(text || '').split(/\r?\n/).forEach(raw => {
      const line = raw.trim();
      if (/^[-•]\s+/.test(line)) {
        if (!list) { list = []; out.push(list); }
        list.push('<li>' + inline(line.replace(/^[-•]\s+/, '')) + '</li>');
        return;
      }
      list = null;
      if (line) out.push('<p>' + inline(line) + '</p>');
    });
    return out.map(x => Array.isArray(x) ? '<ul>' + x.join('') + '</ul>' : x).join('');
  }

  function fmtRange(e) {
    if (!e || !e.from || !e.to) return '';
    return window.nb ? nb.date(e.from) + ' – ' + nb.date(e.to) : e.from + ' – ' + e.to;
  }
  function nextText(e) {
    if (!e || !e.createdDate) return '';
    const p = e.createdDate.split('-').map(Number);
    const next = new Date(p[0], p[1] - 1, p[2] + EVERY_DAYS);
    return 'neste ' + (window.nb ? nb.dateObj(next) : next.toDateString());
  }

  function render(data) {
    const el = document.getElementById('summaryCard');
    const latest = data && data.latest;
    if (!el || !latest || !latest.text) return;
    const older = (data.history || []).slice(1);
    el.innerHTML =
      '<div class="hsum-head"><span class="hsum-label">HELSEOPPSUMMERING</span>' +
      '<span class="hsum-meta">' + esc(fmtRange(latest)) + '<br>' + esc(nextText(latest)) + '</span></div>' +
      '<div class="hsum-body">' + toHtml(latest.text) + '</div>' +
      (older.length
        ? '<div class="hsum-older">' + older.map(e =>
            '<details><summary>' + esc(fmtRange(e)) + '</summary><div class="hsum-body">' + toHtml(e.text) + '</div></details>'
          ).join('') + '</div>'
        : '');
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
        .eq('key', window.activeProfile.toLowerCase() + '-summary').maybeSingle();
      if (error || !data || !data.data) return;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data.data)); } catch (e) { /* storage full — still render */ }
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
