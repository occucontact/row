// =============================================================
// Fixed daily habits card for the home page (index.html).
// Daily routine and supplements are checked off from their own pages;
// reading (book + pages) and journal (today / tomorrow) are logged here.
// Done-rules live in topbar.js (window.dashHabits) so the GOALS pill
// and this card always agree. Load after topbar.js.
//
// Storage (synced as the "habits" row, see SYNC_CONFIGS in sync.js):
//   habits:reading  { books: [{id,title,totalPages,finishedAt}], activeBookId,
//                     log: { 'YYYY-MM-DD': { bookId: pages } } }
//   habits:journal  { 'YYYY-MM-DD': { did, tomorrow, updatedAt } }
// =============================================================
(function () {
  'use strict';

  const READING_KEY = 'habits:reading';
  const JOURNAL_KEY = 'habits:journal';
  const MAX_TITLE = 120;
  const MAX_BOOK_PAGES = 5000;
  const MAX_PAGES_PER_DAY = 2000;
  const MAX_JOURNAL_CHARS = 4000;
  const SAVE_DEBOUNCE_MS = 400;
  const QUICK_PAGES = [5, 10, 20];

  const css = `
.hb-card {
  margin: 0 0 18px; padding: 16px 16px 10px; border-radius: 16px;
  background: var(--bg-card, #161b22); border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
}
.hb-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
.hb-title { font: 800 10px/1 var(--font-mono, monospace); letter-spacing: 0.18em; color: var(--text-tertiary, #76746E); text-transform: uppercase; }
.hb-count { font: 700 12px/1 var(--font-mono, monospace); color: var(--text-secondary, #8b949e); }
.hb-row {
  display: grid; grid-template-columns: 30px 1fr auto; align-items: center; gap: 10px;
  width: 100%; padding: 11px 4px; border: 0; border-top: 1px solid rgba(255,255,255,0.05);
  background: none; color: inherit; font: inherit; text-align: left; text-decoration: none; cursor: pointer;
  -webkit-tap-highlight-color: transparent; border-radius: 0;
}
.hb-row:first-of-type { border-top: 0; }
.hb-row:hover .hb-name { color: #fff; }
.hb-row:focus-visible { outline: 2px solid var(--accent, #58a6ff); outline-offset: 2px; border-radius: 8px; }
.hb-check {
  width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  border: 1.5px solid rgba(255,255,255,0.18); font-size: 13px; transition: background 0.2s, border-color 0.2s;
}
.hb-row.done .hb-check { background: var(--success, #3fb950); border-color: var(--success, #3fb950); color: #06110a; }
.hb-name { font-size: 14.5px; font-weight: 650; color: var(--text-primary, #e6edf3); transition: color 0.15s; }
.hb-sub { font-size: 12px; color: var(--text-tertiary, #76746E); margin-top: 2px; }
.hb-right { display: flex; align-items: center; gap: 8px; font: 700 12px/1 var(--font-mono, monospace); color: var(--text-secondary, #8b949e); }
.hb-chev { color: var(--text-tertiary, #76746E); transition: transform 0.2s; }
.hb-row[aria-expanded="true"] .hb-chev { transform: rotate(90deg); }
.hb-panel { padding: 4px 4px 14px 44px; }
.hb-panel[hidden] { display: none; }
.hb-field { display: flex; flex-direction: column; gap: 5px; margin-top: 10px; font-size: 12px; color: var(--text-tertiary, #76746E); }
.hb-input, .hb-select, .hb-text {
  width: 100%; padding: 10px 12px; border-radius: 10px; box-sizing: border-box;
  background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);
  color: var(--text-primary, #e6edf3); font: 500 14px/1.4 var(--font, sans-serif);
}
.hb-text { min-height: 84px; resize: vertical; }
.hb-input:focus, .hb-select:focus, .hb-text:focus { outline: none; border-color: var(--accent, #58a6ff); }
.hb-inline { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.hb-inline .hb-input { width: 110px; font-family: var(--font-mono, monospace); font-weight: 700; }
.hb-btn {
  padding: 9px 12px; border-radius: 10px; cursor: pointer; font: 700 12.5px/1 var(--font, sans-serif);
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: var(--text-primary, #e6edf3);
  -webkit-tap-highlight-color: transparent; transition: background 0.15s, transform 0.1s;
}
.hb-btn:hover { background: rgba(255,255,255,0.12); }
.hb-btn:active { transform: scale(0.96); }
.hb-btn.primary { background: var(--accent, #58a6ff); border-color: transparent; color: #06101c; }
.hb-progress { height: 6px; border-radius: 6px; background: rgba(255,255,255,0.06); overflow: hidden; margin-top: 12px; }
.hb-progress span { display: block; height: 100%; background: linear-gradient(90deg, var(--accent, #58a6ff), var(--success, #3fb950)); transform-origin: left; transition: transform 0.4s; }
.hb-note { font-size: 12px; color: var(--text-tertiary, #76746E); margin-top: 6px; }
.hb-plan { margin-top: 6px; padding: 10px 12px; border-radius: 10px; background: rgba(88,166,255,0.08); font-size: 13px; color: var(--text-secondary, #8b949e); white-space: pre-wrap; }
.hb-plan b { display: block; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent, #58a6ff); margin-bottom: 4px; }
.hb-saved { font-size: 11px; color: var(--success, #3fb950); min-height: 14px; margin-top: 6px; }
`;

  // ---------- storage ----------
  function readObj(key) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
    catch (e) { return {}; }
  }
  function writeObj(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { alert('Kunne ikke lagre – lagringen på enheten er full.'); return false; }
  }
  function reading() {
    const r = readObj(READING_KEY);
    return { books: Array.isArray(r.books) ? r.books : [], activeBookId: r.activeBookId || null, log: r.log && typeof r.log === 'object' ? r.log : {} };
  }
  const journal = () => readObj(JOURNAL_KEY);

  const H = () => window.dashHabits;
  const today = () => H().activeDateKey();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clampInt = (v, max) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : null; };

  // ---------- reading ----------
  function bookPagesRead(r, bookId) {
    return Object.values(r.log).reduce((sum, day) => sum + (Number((day || {})[bookId]) || 0), 0);
  }
  function activeBook(r) {
    return r.books.find(b => b.id === r.activeBookId && !b.finishedAt) || r.books.find(b => !b.finishedAt) || null;
  }
  function setPagesToday(pages) {
    const r = reading();
    const book = activeBook(r);
    if (!book) return;
    const day = Object.assign({}, r.log[today()], { [book.id]: pages });
    const log = Object.assign({}, r.log, { [today()]: day });
    let books = r.books;
    const total = Object.values(log).reduce((s, d) => s + (Number((d || {})[book.id]) || 0), 0);
    let finished = false;
    if (book.totalPages && total >= book.totalPages && !book.finishedAt) {
      books = r.books.map(b => b.id === book.id ? Object.assign({}, b, { finishedAt: today() }) : b);
      finished = true;
    }
    writeObj(READING_KEY, Object.assign({}, r, { log, books }));
    render();
    if (finished) alert('Ferdig med «' + book.title + '»! 🎉 Velg eller legg til neste bok.');
  }
  function addBook(title, totalPages) {
    const r = reading();
    const book = { id: 'b' + Date.now().toString(36), title, totalPages: totalPages || null, startedAt: today(), finishedAt: null };
    writeObj(READING_KEY, Object.assign({}, r, { books: r.books.concat(book), activeBookId: book.id }));
    render();
  }
  function chooseBook(id) {
    writeObj(READING_KEY, Object.assign({}, reading(), { activeBookId: id }));
    render();
  }

  // ---------- journal ----------
  let journalTimer = null;
  function saveJournal() {
    const did = document.getElementById('hbDid').value.slice(0, MAX_JOURNAL_CHARS);
    const tomorrow = document.getElementById('hbTomorrow').value.slice(0, MAX_JOURNAL_CHARS);
    const j = journal();
    writeObj(JOURNAL_KEY, Object.assign({}, j, { [today()]: { did, tomorrow, updatedAt: new Date().toISOString() } }));
    const saved = document.getElementById('hbSaved');
    if (saved) saved.textContent = 'Lagret ✓';
    renderRows();
  }
  function planToGoals() {
    const lines = document.getElementById('hbTomorrow').value.split(/\r?\n/)
      .map(l => l.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
    if (!lines.length) { alert('Skriv planen for i morgen først, én ting per linje.'); return; }
    const key = 'goals:' + H().shiftKey(today(), 1);
    let existing = [];
    try { existing = JSON.parse(localStorage.getItem(key)) || []; } catch (e) { existing = []; }
    if (!Array.isArray(existing)) existing = [];
    const seen = new Set(existing.map(g => g && g.text));
    const added = lines.filter(t => !seen.has(t)).map(text => ({ text: text.slice(0, 200), done: false }));
    writeObj(key, existing.concat(added));
    window.dispatchEvent(new CustomEvent('goals-changed'));
    window.dispatchEvent(new Event('storage'));
    alert(added.length ? added.length + ' mål lagt til for i morgen.' : 'Alle linjene finnes allerede som mål i morgen.');
  }

  // ---------- render ----------
  const open = { read: false, journal: false };

  function habitSub(id) {
    if (id === 'daily') return H().done('daily', today()) ? 'Dagens økt er fullført' : 'Fullfør økta på Daily-siden';
    if (id === 'stack') {
      let items = []; let taken = {};
      try { items = JSON.parse(localStorage.getItem('stack:items')) || []; } catch (e) {}
      try { taken = JSON.parse(localStorage.getItem('stack:taken:' + today())) || {}; } catch (e) {}
      if (!items.length) return 'Ingen kosttilskudd i stacken ennå';
      return items.filter(i => taken[i.id]).length + ' av ' + items.length + ' tatt';
    }
    if (id === 'read') {
      const r = reading(); const book = activeBook(r);
      const pagesToday = Object.values(r.log[today()] || {}).reduce((s, p) => s + (Number(p) || 0), 0);
      if (!book) return pagesToday ? pagesToday + ' sider i dag · velg neste bok' : 'Velg en bok å lese';
      return '«' + book.title + '» · ' + pagesToday + ' sider i dag';
    }
    const e = journal()[today()] || {};
    const parts = [];
    if (String(e.did || '').trim()) parts.push('dagen ✓');
    if (String(e.tomorrow || '').trim()) parts.push('i morgen ✓');
    return parts.length ? parts.join(' · ') : 'Hva gjorde du i dag, og hva skal du i morgen?';
  }

  function rowHtml(h) {
    const done = H().done(h.id, today());
    const streak = H().streak(h.id);
    const inner = '<span class="hb-check" aria-hidden="true">' + (done ? '✓' : '') + '</span>' +
      '<span><div class="hb-name">' + h.icon + ' ' + esc(h.label) + '</div><div class="hb-sub">' + esc(habitSub(h.id)) + '</div></span>' +
      '<span class="hb-right">' + (streak ? '🔥' + streak : '') + '<span class="hb-chev" aria-hidden="true">›</span></span>';
    const label = h.label + (done ? ', fullført' : ', ikke fullført');
    if (h.href) return '<a class="hb-row' + (done ? ' done' : '') + '" href="' + h.href + '" aria-label="' + esc(label) + '">' + inner + '</a>';
    return '<button type="button" class="hb-row' + (done ? ' done' : '') + '" data-toggle="' + h.id + '" aria-expanded="' + open[h.id] +
      '" aria-controls="hbPanel-' + h.id + '" aria-label="' + esc(label) + '">' + inner + '</button>' +
      '<div class="hb-panel" id="hbPanel-' + h.id + '"' + (open[h.id] ? '' : ' hidden') + '></div>';
  }

  function readingPanel() {
    const r = reading(); const book = activeBook(r);
    const unfinished = r.books.filter(b => !b.finishedAt);
    const finishedCount = r.books.length - unfinished.length;
    let html = '<label class="hb-field">Bok<select class="hb-select" id="hbBook">' +
      unfinished.map(b => '<option value="' + esc(b.id) + '"' + (book && b.id === book.id ? ' selected' : '') + '>' + esc(b.title) + '</option>').join('') +
      '<option value="__new"' + (book ? '' : ' selected') + '>+ Ny bok…</option></select></label>';
    html += '<div id="hbNewBook"' + (book ? ' hidden' : '') + '>' +
      '<label class="hb-field">Tittel<input class="hb-input" id="hbBookTitle" maxlength="' + MAX_TITLE + '" placeholder="F.eks. Atomic Habits"></label>' +
      '<label class="hb-field">Antall sider (valgfritt)<input class="hb-input" id="hbBookPages" type="number" inputmode="numeric" min="1" max="' + MAX_BOOK_PAGES + '"></label>' +
      '<div class="hb-inline" style="margin-top:10px"><button type="button" class="hb-btn primary" id="hbAddBook">Legg til bok</button></div></div>';
    if (book) {
      const pagesToday = Number((r.log[today()] || {})[book.id]) || 0;
      const read = bookPagesRead(r, book.id);
      html += '<label class="hb-field">Sider lest i dag<span class="hb-inline">' +
        '<input class="hb-input" id="hbPages" type="number" inputmode="numeric" min="0" max="' + MAX_PAGES_PER_DAY + '" value="' + pagesToday + '">' +
        QUICK_PAGES.map(n => '<button type="button" class="hb-btn" data-add="' + n + '">+' + n + '</button>').join('') + '</span></label>';
      if (book.totalPages) {
        const pct = Math.min(100, Math.round(read / book.totalPages * 100));
        html += '<div class="hb-progress" aria-hidden="true"><span style="transform:scaleX(' + (pct / 100) + ')"></span></div>' +
          '<div class="hb-note">' + read + ' av ' + book.totalPages + ' sider · ' + pct + ' %</div>';
      } else {
        html += '<div class="hb-note">' + read + ' sider lest i denne boka</div>';
      }
    }
    if (finishedCount) html += '<div class="hb-note">📚 ' + finishedCount + ' bok' + (finishedCount === 1 ? '' : 'er') + ' fullført</div>';
    return html;
  }

  function journalPanel() {
    const j = journal();
    const e = j[today()] || {};
    const yesterdayPlan = String((j[H().shiftKey(today(), -1)] || {}).tomorrow || '').trim();
    return (yesterdayPlan ? '<div class="hb-plan"><b>I går planla du</b>' + esc(yesterdayPlan) + '</div>' : '') +
      '<label class="hb-field">Hva gjorde jeg i dag?<textarea class="hb-text" id="hbDid" maxlength="' + MAX_JOURNAL_CHARS + '">' + esc(e.did || '') + '</textarea></label>' +
      '<label class="hb-field">Hva skal jeg i morgen? (én ting per linje)<textarea class="hb-text" id="hbTomorrow" maxlength="' + MAX_JOURNAL_CHARS + '">' + esc(e.tomorrow || '') + '</textarea></label>' +
      '<div class="hb-inline" style="margin-top:10px"><button type="button" class="hb-btn" id="hbPlanGoals">Gjør planen om til mål for i morgen</button></div>' +
      '<div class="hb-saved" id="hbSaved" aria-live="polite"></div>';
  }

  function renderRows() {
    const el = document.getElementById('habitsCard');
    if (!el || !H()) return;
    const doneCount = H().list.filter(h => H().done(h.id, today())).length;
    // Keep open panels (and text being typed) intact: only refresh row headers.
    H().list.forEach(h => {
      const row = el.querySelector(h.href ? 'a[href="' + h.href + '"]' : '[data-toggle="' + h.id + '"]');
      if (!row) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = rowHtml(h);
      const fresh = tmp.firstElementChild;
      row.className = fresh.className;
      row.innerHTML = fresh.innerHTML;
      row.setAttribute('aria-label', fresh.getAttribute('aria-label'));
    });
    const count = el.querySelector('.hb-count');
    if (count) count.textContent = doneCount + '/' + H().list.length;
  }

  function render() {
    const el = document.getElementById('habitsCard');
    if (!el || !H()) return;
    const active = document.activeElement;
    if (active && el.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) { renderRows(); return; }
    const doneCount = H().list.filter(h => H().done(h.id, today())).length;
    el.innerHTML = '<div class="hb-head"><span class="hb-title">Faste vaner</span><span class="hb-count">' + doneCount + '/' + H().list.length + '</span></div>' +
      H().list.map(rowHtml).join('');
    if (open.read) document.getElementById('hbPanel-read').innerHTML = readingPanel();
    if (open.journal) document.getElementById('hbPanel-journal').innerHTML = journalPanel();
    el.hidden = false;
  }

  // ---------- events ----------
  function onClick(e) {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const id = toggle.dataset.toggle;
      open[id] = !open[id];
      render();
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      const input = document.getElementById('hbPages');
      const next = Math.min(MAX_PAGES_PER_DAY, (clampInt(input.value, MAX_PAGES_PER_DAY) || 0) + Number(add.dataset.add));
      input.value = next;
      setPagesToday(next);
      return;
    }
    if (e.target.id === 'hbAddBook') {
      const title = document.getElementById('hbBookTitle').value.trim().slice(0, MAX_TITLE);
      if (!title) { alert('Skriv inn en tittel.'); return; }
      const pagesRaw = document.getElementById('hbBookPages').value;
      const pages = pagesRaw ? clampInt(pagesRaw, MAX_BOOK_PAGES) : null;
      if (pagesRaw && !pages) { alert('Antall sider må være mellom 1 og ' + MAX_BOOK_PAGES + '.'); return; }
      addBook(title, pages);
      return;
    }
    if (e.target.id === 'hbPlanGoals') { saveJournal(); planToGoals(); }
  }
  function onChange(e) {
    if (e.target.id === 'hbBook') {
      if (e.target.value === '__new') document.getElementById('hbNewBook').hidden = false;
      else chooseBook(e.target.value);
    } else if (e.target.id === 'hbPages') {
      const n = clampInt(e.target.value, MAX_PAGES_PER_DAY);
      if (n == null) { e.target.value = 0; return; }
      e.target.value = n;
      setPagesToday(n);
    }
  }
  function onInput(e) {
    if (e.target.id !== 'hbDid' && e.target.id !== 'hbTomorrow') return;
    const saved = document.getElementById('hbSaved');
    if (saved) saved.textContent = '';
    clearTimeout(journalTimer);
    journalTimer = setTimeout(saveJournal, SAVE_DEBOUNCE_MS);
  }

  function boot() {
    const el = document.getElementById('habitsCard');
    if (!el || !window.dashHabits) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    // Flush a pending journal save if the page is hidden mid-typing.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && journalTimer) { clearTimeout(journalTimer); journalTimer = null; saveJournal(); }
      else if (!document.hidden) render();
    });
    window.addEventListener('storage', render);
    window.addEventListener('goals-changed', renderRows);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
