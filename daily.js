// =============================================================
// Daily mobility — guided session ("økt-modus") with timers,
// confirm-to-advance flow and streak tracking.
// State lives in localStorage under 'daily:log' and 'daily:meta'
// (profile.js scopes them per profile).
// =============================================================
(function () {
  'use strict';

  // ---------- Constants ----------
  const LOG_KEY = 'daily:log';
  const META_KEY = 'daily:meta';
  const ROLLOVER_HOUR = 6;          // same 06:00 day boundary as goals/topbar
  const SIDE_GAP_SEC = 5;           // pause between sides/directions
  const SET_GAP_SEC = 15;           // rest between sets
  const COUNTDOWN_BEEPS = 3;        // short beeps for the last N seconds
  const HEATMAP_WEEKS = 12;
  const COPENHAGEN_EARLY_DAYS = 3;  // weeks 1–2: max 3 days a week
  const TICK_MS = 200;
  const TOAST_MS = 2600;
  const RING_R = 92;
  const RING_CIRC = 2 * Math.PI * RING_R;
  const SIDES = ['Venstre', 'Høyre'];

  const EXERCISES = [
    { id: 'hip', name: 'Hoftesirkler + beinpendler', extra: true,
      dose: '5 sirkler hver vei per bein · 10 pendler fram/tilbake + 10 sidelengs per bein',
      cue: 'Hold deg i veggen, og hold overkroppen stille.',
      why: 'Varmer opp hofteleddet før resten av økta' },
    { id: 'tib', name: 'Tibialis Raise + Wall slide', dose: '2×20 + 2×20',
      cue: 'Len deg mot veggen og løft tærne. Gå langsomt i topposisjonen.',
      why: 'Fremmer kne- og ankelstabilitet' },
    { id: 'plantar', name: 'Plantar Fascia Stretch + ulnar nerve-øvelse', dose: '1–2×30 sek',
      cue: 'Knel med tærne bøyd under deg, og sitt bak på hælene.',
      why: 'Avlaster fotbuen og forbedrer bevegelseskjeden',
      timer: { secs: [30] } },
    { id: 'couch', name: 'Couch Stretch', dose: '1×30–60 sek per side',
      cue: 'Bakre fot opp mot veggen, fremre bein i lunge. Spenn setet på det bakre beinet og vipp bekkenet bakover før du presser hofta fram.',
      why: 'Åpner hofteleddsbøyerne og rebalanserer bekkenet',
      timer: { secs: [30, 45, 60], sides: SIDES } },
    { id: 'atg', name: 'ATG Split Squat', dose: '2×5 per bein',
      cue: 'Fremre kne langt fram, bakre bein strukket. Kontroller deg ned.',
      why: 'Bygger kontrollert styrke og mobilitet i hofte og kne' },
    { id: 'patrick', name: 'Patrick Step', dose: '1–2×6–10 per side',
      cue: 'Stå på en kant, strekk ut foten og senk den frie hælen mot gulvet, press deg så opp.',
      why: 'Styrker patella og VMO' },
    { id: 'squat', name: 'Deep Bodyweight Squat Hold + Wall crawl', dose: '1×60 sek + 3×10',
      cue: 'Gå dypt ned med hælene i gulvet. Hendene kan støtte balansen.',
      why: 'Åpner hofte, rygg og bekken',
      timer: { secs: [60] } },
    { id: 'butterfly', name: 'Butterfly mot vegg', dose: '1×30–60 sek',
      cue: 'Sitt med ryggen mot veggen og fotsålene sammen. Press knærne ned.',
      why: 'Åpner hoftene og mobiliserer adduktorene',
      timer: { secs: [30, 45, 60] } },
    { id: 'frog', name: 'Frosk', extra: true, dose: '60 sek',
      cue: 'Knærne bredt på et mykt underlag, leggene parallelle. Rugg rolig fram og tilbake.',
      why: 'Tar adduktorene i en annen vinkel enn butterfly',
      timer: { secs: [60] } },
    { id: 'ninety', name: '90/90 Stretch', dose: '10 per side ×2',
      cue: 'Én hofte i internrotasjon, én i ekstern. Len deg fram.',
      why: 'Bedrer hoftefleksibilitet og rotasjonskontroll' },
    { id: 'pigeon', name: 'Due (pigeon)', extra: true, dose: '45–60 sek per side',
      cue: 'Er det ubehagelig i kneet, bytt til figur-4 liggende på ryggen.',
      why: 'Tøyer setemuskulaturen og hoftens utadrotatorer',
      timer: { secs: [45, 60], sides: SIDES } },
    { id: 'hamstring', name: 'Liggende hamstring', extra: true, dose: '40 sek per side',
      cue: 'Med strikk eller håndkle.',
      why: 'Løsner baksiden av låret, som ofte låser bekkenet',
      timer: { secs: [40], sides: SIDES } },
    { id: 'copenhagen', name: 'Copenhagen-sideplanke', extra: true, optional: true,
      cue: 'Albuen under skulderen og det øverste beinet på en benk. Løft hofta til kroppen er rett.',
      why: 'Styrker adduktorene og forebygger lyskeplager',
      note: 'Dropp den eller kjør den lett dagen før kamp.',
      progression: copenhagenPlan },
    { id: 'posture', name: 'Wall Posture Reset + thumb to finger', dose: '1×60 sek',
      cue: 'Hele kroppen mot veggen. Press korsryggen og bakhodet jevnt mot veggen. Gjør thumb to finger med begge hender i motsatt rekkefølge av hverandre.',
      why: 'Aktiverer den posturale kjeden',
      timer: { secs: [60] } },
    { id: 'neck', name: 'Nakke isometrisk', dose: '1×10–15 sek per retning',
      cue: 'Press lett fram, bak, høyre og venstre, uten bevegelse.',
      why: 'Fremmer nakkestabilitet og demper spenninger',
      timer: { secs: [10, 15], sides: ['Fram', 'Bak', 'Høyre', 'Venstre'] } },
    { id: 'hang', name: 'Passive Hang', dose: '2×20–30 sek · bygg opp til 1–2 min totalt',
      cue: 'Heng med full armstrekk, med beina bøyd eller strake.',
      why: 'Avlaster ryggen, åpner skuldrene og bedrer grepsstyrken',
      timer: { secs: [20, 30, 45, 60], sets: 2 } },
    { id: 'cobra', name: 'Prone Cobra Hold', dose: '2×30 sek',
      cue: 'Ligg på magen og løft brystet og armene med bøyde albuer. Tærne peker i gulvet.',
      why: 'Styrker ryggstrekkerne og scapula-retraktorene',
      timer: { secs: [30], sets: 2 } },
    { id: 'hipflexor', name: 'Hip Flexor Stretch', dose: '30 sek per side',
      cue: 'Knelende lunge, press hofta fram.',
      why: 'Motvirker sittende stilling og gir bedre bekkenkontroll',
      timer: { secs: [30], sides: SIDES } },
    { id: 'wgs', name: "World's Greatest Stretch", dose: '45 sek per side',
      timer: { secs: [45], sides: SIDES } },
    { id: 'max', name: 'Push-ups og dips', dose: 'Maks antall', kind: 'max' },
  ];
  const REQUIRED = EXERCISES.filter(e => !e.optional);
  const byId = id => EXERCISES.find(e => e.id === id);

  function copenhagenPlan(week) {
    if (week <= 2) {
      return { dose: 'Kort vektarm (kneet på benken) · 2×15–20 sek per side',
        timer: { secs: [15, 20], sets: 2, sides: SIDES }, earlyPhase: true };
    }
    if (week <= 4) {
      return { dose: '2×30 sek kort vektarm, eller lang vektarm (ankelen på benken) 2×15 sek per side',
        timer: { secs: [30, 15], sets: 2, sides: SIDES } };
    }
    return { dose: 'Lang vektarm 2×30 sek, eller senk og løft hofta 2×8–10 per side',
      timer: { secs: [30], sets: 2, sides: SIDES } };
  }

  // ---------- Dates ----------
  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  function parseKey(k) { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); }
  function daysBetween(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 86400000); }
  function mondayOf(k) { const d = parseKey(k); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return keyOf(d); }
  function today() {
    const d = new Date();
    if (d.getHours() < ROLLOVER_HOUR) d.setDate(d.getDate() - 1);
    return keyOf(d);
  }
  const isValidKey = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);

  // ---------- Storage (immutable updates) ----------
  function readObj(key) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }
  function writeObj(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { showToast('Kunne ikke lagre – lagringen er full eller blokkert'); return; }
    // Same-tab writes don't fire 'storage'; nudge topbar.js so the DAILY pill updates now.
    window.dispatchEvent(new Event('storage'));
  }
  const getLog = () => readObj(LOG_KEY);
  const getMeta = () => readObj(META_KEY);
  const saveMeta = patch => writeObj(META_KEY, Object.assign({}, getMeta(), patch));
  function emptyDay() {
    return { checked: {}, times: {}, elapsedMs: 0, startedAt: null, done: false,
      durationSec: 0, pushups: null, dips: null };
  }
  function getDay(k) {
    const raw = getLog()[k] || {};
    return Object.assign(emptyDay(), raw, {
      checked: Object.assign({}, raw.checked), times: Object.assign({}, raw.times)
    });
  }
  function updateToday(fn) {
    const k = today();
    const next = fn(getDay(k));
    writeObj(LOG_KEY, Object.assign({}, getLog(), { [k]: next }));
    render();
    return next;
  }

  // ---------- Streaks & stats ----------
  const isDone = (log, k) => !!(log[k] && log[k].done);
  function currentStreak(log) {
    let k = today();
    if (!isDone(log, k)) k = addDays(k, -1);
    let n = 0;
    while (isDone(log, k)) { n++; k = addDays(k, -1); }
    return n;
  }
  function bestStreak(log) {
    const keys = Object.keys(log).filter(k => isValidKey(k) && isDone(log, k)).sort();
    let best = 0, run = 0, prev = null;
    for (const k of keys) {
      run = prev && daysBetween(prev, k) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = k;
    }
    return best;
  }
  function programWeek() {
    const start = getMeta().startDate;
    if (!isValidKey(start)) return 1;
    return Math.max(1, Math.floor(daysBetween(start, today()) / 7) + 1);
  }
  function copenhagenDaysThisWeek(log) {
    const mon = mondayOf(today());
    let n = 0;
    for (let i = 0; i < 7; i++) {
      const d = log[addDays(mon, i)];
      if (d && d.checked && d.checked.copenhagen) n++;
    }
    return n;
  }
  function copenhagenText(log, d) {
    const n = copenhagenDaysThisWeek(log);
    return n >= COPENHAGEN_EARLY_DAYS && !d.checked.copenhagen
      ? 'Uke 1–2: ' + n + '/' + COPENHAGEN_EARLY_DAYS + ' dager denne uka – hopp over Copenhagen i dag.'
      : 'Uke 1–2: bare ' + COPENHAGEN_EARLY_DAYS + ' dager i uka (' + n + '/' + COPENHAGEN_EARLY_DAYS + ' denne uka).';
  }
  function resolved(ex) {
    return ex.progression ? Object.assign({}, ex, ex.progression(programWeek())) : ex;
  }

  // ---------- Session clock ----------
  const elapsedMs = d => (d.elapsedMs || 0) + (d.startedAt ? Date.now() - d.startedAt : 0);
  function fmtClock(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(s % 60);
  }
  const isRunning = () => !!getDay(today()).startedAt;
  function startSession() {
    if (!isValidKey(getMeta().startDate)) saveMeta({ startDate: today() });
    updateToday(d => (d.startedAt || d.done) ? d : Object.assign({}, d, { startedAt: Date.now() }));
    exWatchResume();
    requestWakeLock();
  }
  function pauseSession() {
    pauseTimer();
    exWatchPause();
    updateToday(d => d.startedAt ? Object.assign({}, d, { elapsedMs: elapsedMs(d), startedAt: null }) : d);
    releaseWakeLock();
  }
  function finishSession() {
    stopTimer();
    exWatchPause();
    updateToday(d => {
      const ms = elapsedMs(d);
      return Object.assign({}, d, {
        elapsedMs: ms, startedAt: null, done: true,
        durationSec: Math.round(ms / 1000), finishedAt: Date.now()
      });
    });
    releaseWakeLock();
    beep(660, 0.12); setTimeout(() => beep(880, 0.25), 140);
    vibrate([120, 80, 220]);
    const hero = document.getElementById('dyHero');
    hero.classList.remove('pop'); void hero.offsetWidth; hero.classList.add('pop');
    if (pl.open) showSummary();
    else showToast('Økt fullført 🔥 ' + currentStreak(getLog()) + ' dager på rad');
  }
  function reopenSession() { updateToday(d => Object.assign({}, d, { done: false })); }
  function setChecked(id, value) {
    updateToday(d => {
      const checked = Object.assign({}, d.checked);
      if (value) checked[id] = true; else delete checked[id];
      return Object.assign({}, d, { checked });
    });
  }
  function maybeAutoFinish() {
    const d = getDay(today());
    if (!d.done && REQUIRED.every(e => d.checked[e.id])) finishSession();
  }

  // ---------- Sound, vibration, wake lock ----------
  let audioCtx = null;
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }
  function beep(freq, dur) {
    if (!audioCtx) return;
    try {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t); osc.stop(t + dur + 0.02);
    } catch (e) { /* audio unavailable — the visual countdown still works */ }
  }
  const vibrate = p => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };

  let wakeLock = null;
  async function requestWakeLock() {
    if (wakeLock || !('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { wakeLock = null; }
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  // ---------- Player state ----------
  // pl.id = exercise on screen; exAccMs/exResumedAt = stopwatch for time on
  // this exercise; timer = active countdown; timerDone = countdown finished
  // and waiting for the user to confirm.
  let pl = { open: false, summary: false, id: null, exAccMs: 0, exResumedAt: null,
    timer: null, timerDone: false, skipped: {} };
  const setPl = patch => { pl = Object.assign({}, pl, patch); };

  const exWatchMs = () => pl.exAccMs + (pl.exResumedAt ? Date.now() - pl.exResumedAt : 0);
  function exWatchPause() { if (pl.exResumedAt) setPl({ exAccMs: exWatchMs(), exResumedAt: null }); }
  function exWatchResume() { if (pl.open && pl.id && !pl.exResumedAt) setPl({ exResumedAt: Date.now() }); }

  function nextPendingId(afterId) {
    const d = getDay(today());
    const pending = e => !d.checked[e.id] && !pl.skipped[e.id];
    const start = afterId ? EXERCISES.findIndex(e => e.id === afterId) + 1 : 0;
    const later = EXERCISES.slice(start).find(pending);
    return (later || EXERCISES.slice(0, start).find(pending) || {}).id || null;
  }

  // ---------- Countdown timer (inside the player) ----------
  function buildRounds(t, sec) {
    const sets = t.sets || 1;
    const sides = t.sides || [null];
    const rounds = [];
    for (let s = 1; s <= sets; s++) {
      sides.forEach((side, i) => {
        const parts = [];
        if (sets > 1) parts.push('Sett ' + s + '/' + sets);
        if (side) parts.push(side);
        rounds.push({ label: parts.join(' · ') || 'Hold', sec,
          gapAfter: i < sides.length - 1 ? SIDE_GAP_SEC : SET_GAP_SEC });
      });
    }
    return rounds;
  }
  function selectedSec(ex) {
    const chosen = (getMeta().secs || {})[ex.id];
    return ex.timer.secs.indexOf(chosen) !== -1 ? chosen : ex.timer.secs[0];
  }
  function timerLabel(t, sec) {
    const sides = t.sides ? t.sides.length : 1;
    const parts = [sec + ' s'];
    if (sides === 2) parts.push('× 2 sider');
    else if (sides > 2) parts.push('× ' + sides + ' retninger');
    if ((t.sets || 1) > 1) parts.push('× ' + t.sets + ' sett');
    return parts.join(' ');
  }
  function startTimer() {
    const ex = resolved(byId(pl.id));
    if (!ex.timer) return;
    unlockAudio();
    if (!isRunning()) startSession();
    const rounds = buildRounds(ex.timer, selectedSec(ex));
    setPl({ timerDone: false, timer: { rounds, idx: 0, phase: 'work',
      endsAt: Date.now() + rounds[0].sec * 1000, remainingMs: null, lastSec: null } });
    beep(880, 0.15);
    renderPlayer();
  }
  function stopTimer() { setPl({ timer: null }); }
  function pauseTimer() {
    const t = pl.timer;
    if (t && t.remainingMs == null) setPl({ timer: Object.assign({}, t, { remainingMs: Math.max(0, t.endsAt - Date.now()) }) });
  }
  function resumeTimer() {
    const t = pl.timer;
    if (t && t.remainingMs != null) setPl({ timer: Object.assign({}, t, { endsAt: Date.now() + t.remainingMs, remainingMs: null }) });
  }
  function toggleTimer() {
    if (!pl.timer) return;
    if (pl.timer.remainingMs != null) { if (!isRunning()) startSession(); resumeTimer(); }
    else pauseTimer();
    renderPlayer();
  }
  function skipPhase() {
    if (!pl.timer) return;
    setPl({ timer: Object.assign({}, pl.timer, { endsAt: Date.now(), remainingMs: null }) });
    tickTimer();
  }
  function tickTimer() {
    const t = pl.timer;
    if (!t || t.remainingMs != null) return;
    const left = t.endsAt - Date.now();
    const sec = Math.ceil(left / 1000);
    if (sec !== t.lastSec) {
      if (sec > 0 && sec <= COUNTDOWN_BEEPS) beep(t.phase === 'work' ? 520 : 440, 0.08);
      setPl({ timer: Object.assign({}, t, { lastSec: sec }) });
    }
    if (left <= 0) advanceTimer();
  }
  function advanceTimer() {
    const t = pl.timer;
    const now = Date.now();
    if (t.phase === 'gap') {
      beep(880, 0.2); vibrate(120);
      const next = t.rounds[t.idx + 1];
      setPl({ timer: Object.assign({}, t, { phase: 'work', idx: t.idx + 1, endsAt: now + next.sec * 1000, lastSec: null }) });
    } else if (t.idx >= t.rounds.length - 1) {
      // Countdown finished — wait for the user to confirm before moving on.
      beep(660, 0.12); setTimeout(() => beep(990, 0.3), 140); vibrate([120, 80, 220]);
      setPl({ timer: null, timerDone: true });
    } else {
      beep(330, 0.35); vibrate(250);
      setPl({ timer: Object.assign({}, t, { phase: 'gap', endsAt: now + t.rounds[t.idx].gapAfter * 1000, lastSec: null }) });
    }
    renderPlayer();
  }

  // ---------- Player flow ----------
  function openPlayer(id) {
    unlockAudio();
    const target = id || nextPendingId(null);
    if (!target) {
      if (!getDay(today()).done) finishSession();
      return;
    }
    setPl({ open: true, summary: false });
    document.body.classList.add('pl-lock');
    document.getElementById('player').hidden = false;
    if (!isRunning() && !getDay(today()).done) startSession();
    showExercise(target);
  }
  function closePlayer() {
    stopTimer();
    exWatchPause();
    setPl({ open: false, summary: false, id: null, exAccMs: 0, timerDone: false });
    document.body.classList.remove('pl-lock');
    document.getElementById('player').hidden = true;
    render();
  }
  function showExercise(id) {
    stopTimer();
    setPl({ id, summary: false, timerDone: false, exAccMs: 0, exResumedAt: isRunning() ? Date.now() : null });
    renderPlayerStatic();
    renderPlayer();
    document.getElementById('plConfirm').focus({ preventScroll: true });
  }
  function confirmExercise() {
    const id = pl.id;
    if (!id) return;
    const ex = byId(id);
    const spentSec = Math.round(exWatchMs() / 1000);
    const patch = {};
    if (ex.kind === 'max') {
      patch.pushups = readMaxInput('plPushups');
      patch.dips = readMaxInput('plDips');
    }
    updateToday(d => Object.assign({}, d, patch, {
      times: Object.assign({}, d.times, { [id]: (d.times[id] || 0) + spentSec }),
      checked: Object.assign({}, d.checked, { [id]: true })
    }));
    beep(780, 0.1); vibrate(60);
    advanceTo(id);
  }
  function skipExercise() {
    const id = pl.id;
    setPl({ skipped: Object.assign({}, pl.skipped, { [id]: true }) });
    advanceTo(id);
  }
  function advanceTo(fromId) {
    const next = nextPendingId(fromId);
    if (next) { showExercise(next); return; }
    stopTimer();
    exWatchPause();
    if (!getDay(today()).done) finishSession();
    else showSummary();
  }
  function goPrev() {
    const i = EXERCISES.findIndex(e => e.id === pl.id);
    if (i > 0) showExercise(EXERCISES[i - 1].id);
  }
  function readMaxInput(elId) {
    const n = parseInt(document.getElementById(elId).value, 10);
    return Number.isFinite(n) && n >= 0 && n <= 999 ? n : null;
  }
  function showSummary() {
    stopTimer();
    exWatchPause();
    setPl({ summary: true });
    const log = getLog();
    const d = getDay(today());
    document.getElementById('plSumStreak').textContent = currentStreak(log);
    document.getElementById('plSumTime').textContent = fmtClock(d.durationSec * 1000);
    document.getElementById('plSumCount').textContent =
      EXERCISES.filter(e => d.checked[e.id]).length + '/' + EXERCISES.length;
    renderPlayer();
    document.getElementById('plSumClose').focus({ preventScroll: true });
  }

  // ---------- Player rendering ----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const setText = (id, t) => { const el = $(id); if (el.textContent !== t) el.textContent = t; };

  function renderPlayerStatic() {
    const ex = resolved(byId(pl.id));
    const i = EXERCISES.findIndex(e => e.id === pl.id);
    const d = getDay(today());
    const tags = [];
    if (ex.optional) tags.push('Valgfri');
    if (ex.extra) tags.push('Tillegg');
    setText('plStep', 'Øvelse ' + (i + 1) + ' av ' + EXERCISES.length + (tags.length ? ' · ' + tags.join(' · ') : ''));
    setText('plName', ex.name);
    setText('plDose', ex.dose);
    setText('plCue', ex.cue || '');
    setText('plWhy', ex.why || '');
    $('plWhy').hidden = !ex.why;
    const notes = [];
    if (ex.earlyPhase) notes.push(copenhagenText(getLog(), d));
    if (ex.note) notes.push(ex.note);
    setText('plNote', notes.join(' '));
    $('plNote').hidden = !notes.length;

    const chips = $('plChips');
    chips.innerHTML = ex.timer && ex.timer.secs.length > 1
      ? ex.timer.secs.map(s => '<button type="button" class="chip" data-sec="' + s + '" aria-pressed="' +
          (s === selectedSec(ex)) + '">' + s + 's</button>').join('')
      : '';
    $('plMax').hidden = ex.kind !== 'max';
    if (ex.kind === 'max') {
      $('plPushups').value = d.pushups == null ? '' : d.pushups;
      $('plDips').value = d.dips == null ? '' : d.dips;
    }
    $('plPrev').disabled = i === 0;
    $('plSkip').hidden = !ex.optional;

    const next = nextPendingId(pl.id);
    const nextEx = next && next !== pl.id ? byId(next) : null;
    setText('plConfirm', nextEx ? '✓ Gjort – neste' : '✓ Gjort – fullfør økta');
    setText('plNext', nextEx ? 'Neste: ' + nextEx.name : 'Siste øvelse');
  }

  function renderPlayer() {
    if (!pl.open || !pl.id) return;
    const player = $('player');
    player.classList.toggle('is-summary', pl.summary);
    if (pl.summary) return;

    const d = getDay(today());
    const running = !!d.startedAt;
    const doneCount = REQUIRED.filter(e => d.checked[e.id]).length;
    setText('plSession', fmtClock(elapsedMs(d)));
    $('plBar').style.transform = 'scaleX(' + (doneCount / REQUIRED.length) + ')';
    setText('plCount', doneCount + '/' + REQUIRED.length);
    setText('plPause', running ? '❚❚ Pause' : '▶ Fortsett');
    player.classList.toggle('is-paused', !running && !d.done);

    const ex = resolved(byId(pl.id));
    const t = pl.timer;
    const arc = $('plArc');
    arc.style.strokeDasharray = RING_CIRC;
    let big, label, frac;
    if (t) {
      const isGap = t.phase === 'gap';
      const round = t.rounds[t.idx];
      const left = t.remainingMs != null ? t.remainingMs : Math.max(0, t.endsAt - Date.now());
      const total = (isGap ? round.gapAfter : round.sec) * 1000;
      const next = t.rounds[t.idx + 1];
      big = String(Math.ceil(left / 1000));
      label = isGap ? 'Bytt · neste: ' + (next ? next.label : '')
        : round.label + (t.rounds.length > 1 ? ' (' + (t.idx + 1) + '/' + t.rounds.length + ')' : '');
      frac = left / total;
      player.dataset.phase = isGap ? 'gap' : 'work';
    } else if (pl.timerDone) {
      big = '✓'; label = 'Tiden er ute – bekreft under'; frac = 0;
      player.dataset.phase = 'done';
    } else {
      big = fmtClock(exWatchMs()); label = 'Tid på øvelsen'; frac = 1;
      player.dataset.phase = 'idle';
    }
    setText('plBig', big);
    setText('plLabel', label);
    $('plBig').classList.toggle('is-long', big.length > 3);
    arc.style.strokeDashoffset = RING_CIRC * (1 - Math.max(0, Math.min(1, frac)));

    // Timer controls
    const hasTimer = !!ex.timer;
    $('plTimerStart').hidden = !hasTimer || !!t;
    $('plTimerCtl').hidden = !t;
    if (hasTimer && !t) {
      setText('plTimerStart', (pl.timerDone ? '↻ Kjør igjen · ' : '▶ Start nedtelling · ') + timerLabel(ex.timer, selectedSec(ex)));
    }
    if (t) setText('plTimerToggle', t.remainingMs != null ? '▶' : '❚❚');
    $('plChips').querySelectorAll('.chip').forEach(c => { c.disabled = !!t; });
    $('plConfirm').classList.toggle('is-ready', pl.timerDone);
  }

  // ---------- Page rendering ----------
  const CHECK_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';

  function cardHTML(rawEx, i) {
    const ex = resolved(rawEx);
    const tags = (ex.optional ? '<span class="ex-tag opt">Valgfri</span>' : '') +
                 (ex.extra ? '<span class="ex-tag">Tillegg</span>' : '');
    return '<li class="ex" data-id="' + ex.id + '">' +
      '<button type="button" class="ex-check" aria-pressed="false" aria-label="Marker ' + esc(ex.name) + ' som gjort">' + CHECK_SVG + '</button>' +
      '<div class="ex-body">' +
        '<div class="ex-head"><span class="ex-num">' + pad(i + 1) + '</span><h3>' + esc(ex.name) + '</h3>' + tags + '</div>' +
        '<p class="ex-dose">' + esc(ex.dose) + '</p>' +
        (ex.cue ? '<p class="ex-cue">' + esc(ex.cue) + '</p>' : '') +
        (ex.why ? '<p class="ex-why">' + esc(ex.why) + '</p>' : '') +
        (ex.earlyPhase ? '<p class="ex-week" id="dyCphWeek"></p>' : '') +
        (ex.note ? '<p class="ex-note">' + esc(ex.note) + '</p>' : '') +
        (ex.kind === 'max' ? '<div class="ex-record" id="dyRecord"></div>' : '') +
        '<div class="ex-tools"><span class="ex-time" data-time></span>' +
        '<button type="button" class="ex-go">Gå til ›</button></div>' +
      '</div></li>';
  }
  function buildList() {
    $('dyList').innerHTML = EXERCISES.map(cardHTML).join('');
  }

  function renderClock() {
    setText('dyClock', fmtClock(elapsedMs(getDay(today()))));
  }
  function render() {
    const log = getLog();
    const k = today();
    const d = getDay(k);
    const running = !!d.startedAt;
    const doneCount = REQUIRED.filter(e => d.checked[e.id]).length;

    const hero = $('dyHero');
    hero.classList.toggle('is-running', running);
    hero.classList.toggle('is-done', d.done);
    renderClock();
    setText('dyClockState', d.done
      ? 'Fullført ' + (d.finishedAt ? nb.clock(new Date(d.finishedAt)) : '')
      : running ? 'Pågår…' : (d.elapsedMs ? 'På pause' : 'Ikke startet'));
    const streak = currentStreak(log);
    setText('dyStreak', String(streak));
    setText('dyStreakRisk', !d.done && streak > 0 ? 'Gjør økta i dag for å holde streaken' : '');
    $('dyBar').style.transform = 'scaleX(' + (doneCount / REQUIRED.length) + ')';
    setText('dyCount', doneCount + '/' + REQUIRED.length);

    $('dyStart').hidden = d.done;
    setText('dyStart', running ? '▶ Åpne økta' : d.elapsedMs || doneCount ? '▶ Fortsett økta' : '▶ Start økt');
    $('dyPause').hidden = d.done || !running;
    $('dyFinish').hidden = d.done || !(running || d.elapsedMs > 0 || doneCount > 0);
    $('dyReopen').hidden = !d.done;

    const doneDays = Object.keys(log).filter(x => isValidKey(x) && isDone(log, x));
    const timed = doneDays.map(x => log[x].durationSec).filter(s => s > 0);
    setText('dyBest', String(Math.max(bestStreak(log), streak)));
    setText('dyTotal', String(doneDays.length));
    setText('dyAvg', timed.length ? fmtClock(timed.reduce((a, b) => a + b, 0) / timed.length * 1000) : '—');
    setText('dyWeek', 'Uke ' + programWeek());

    renderHeatmap(log, k);
    renderCards(log, d);
    renderPlayer();
  }
  function renderHeatmap(log, todayKey) {
    const start = addDays(mondayOf(todayKey), -(HEATMAP_WEEKS - 1) * 7);
    const cells = [];
    for (let i = 0; i < HEATMAP_WEEKS * 7; i++) {
      const k = addDays(start, i);
      const day = log[k];
      const cls = ['dy-heat-cell'];
      if (k > todayKey) cls.push('future');
      else if (day && day.done) cls.push('done');
      else if (day && day.checked && Object.keys(day.checked).length) cls.push('partial');
      if (k === todayKey) cls.push('today');
      cells.push('<div class="' + cls.join(' ') + '" title="' + nb.date(k) + '"></div>');
    }
    $('dyHeat').innerHTML = cells.join('');
  }
  function renderCards(log, d) {
    document.querySelectorAll('.ex').forEach(card => {
      const id = card.dataset.id;
      const on = !!d.checked[id];
      card.classList.toggle('is-checked', on);
      card.querySelector('.ex-check').setAttribute('aria-pressed', String(on));
      const sec = d.times[id];
      card.querySelector('[data-time]').textContent = sec ? '⏱ ' + fmtClock(sec * 1000) : '';
    });
    const cph = $('dyCphWeek');
    if (cph) cph.textContent = copenhagenText(log, d);
    const rec = $('dyRecord');
    if (rec) {
      const best = field => Math.max(0, ...Object.keys(log).map(k => Number(log[k] && log[k][field]) || 0));
      const prevKey = Object.keys(log).filter(k => isValidKey(k) && k < today() &&
        (log[k].pushups != null || log[k].dips != null)).sort().pop();
      const prev = prevKey ? log[prevKey] : null;
      rec.textContent = 'Rekord: ' + best('pushups') + ' push-ups · ' + best('dips') + ' dips' +
        (d.pushups != null || d.dips != null ? '   ·   I dag: ' + (d.pushups ?? '–') + ' / ' + (d.dips ?? '–') : '') +
        (prev ? '   ·   Sist (' + nb.date(prevKey) + '): ' + (prev.pushups ?? '–') + ' / ' + (prev.dips ?? '–') : '');
    }
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), TOAST_MS);
  }

  // ---------- Events ----------
  function onListClick(e) {
    const card = e.target.closest('.ex');
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.closest('.ex-check')) {
      const on = !getDay(today()).checked[id];
      setChecked(id, on);
      if (on) maybeAutoFinish();
      return;
    }
    if (e.target.closest('.ex-go')) openPlayer(id);
  }
  function onChipClick(e) {
    const chip = e.target.closest('.chip');
    if (!chip || pl.timer) return;
    const sec = Number(chip.dataset.sec);
    saveMeta({ secs: Object.assign({}, getMeta().secs, { [pl.id]: sec }) });
    $('plChips').querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
    renderPlayer();
  }
  function onSessionToggle() {
    if (isRunning()) pauseSession();
    else { startSession(); resumeTimer(); }
    renderPlayer();
  }

  function boot() {
    setText('dyDate', nb.dateLong(parseKey(today())));
    buildList();

    const startInput = $('dyStartDate');
    startInput.value = getMeta().startDate || '';
    startInput.addEventListener('change', () => {
      if (!isValidKey(startInput.value)) return;
      saveMeta({ startDate: startInput.value });
      buildList(); render();
      showToast('Programstart satt – uke ' + programWeek());
    });
    $('dyReset').addEventListener('click', () => {
      if (!confirm('Nullstille dagens økt? Dette kan ikke angres.')) return;
      setPl({ skipped: {} });
      updateToday(() => emptyDay());
      releaseWakeLock();
    });

    $('dyList').addEventListener('click', onListClick);
    $('dyStart').addEventListener('click', () => openPlayer());
    $('dyPause').addEventListener('click', pauseSession);
    $('dyFinish').addEventListener('click', finishSession);
    $('dyReopen').addEventListener('click', reopenSession);

    $('plClose').addEventListener('click', closePlayer);
    $('plSumClose').addEventListener('click', closePlayer);
    $('plPause').addEventListener('click', onSessionToggle);
    $('plConfirm').addEventListener('click', confirmExercise);
    $('plSkip').addEventListener('click', skipExercise);
    $('plPrev').addEventListener('click', goPrev);
    $('plTimerStart').addEventListener('click', startTimer);
    $('plTimerToggle').addEventListener('click', toggleTimer);
    $('plTimerSkip').addEventListener('click', skipPhase);
    $('plTimerStop').addEventListener('click', () => { stopTimer(); renderPlayer(); });
    $('plChips').addEventListener('click', onChipClick);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && pl.open) closePlayer(); });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (isRunning()) requestWakeLock();
      render();
    });
    // Only real cross-tab StorageEvents (ours above has no .key) — avoids a double render.
    window.addEventListener('storage', e => { if (e.key !== undefined) render(); });

    render();
    // Resume straight into the player if a session was left running.
    if (isRunning()) { requestWakeLock(); openPlayer(); }

    setInterval(() => {
      renderClock();
      if (pl.open && !pl.summary) { tickTimer(); renderPlayer(); }
    }, TICK_MS);
  }

  boot();
})();
