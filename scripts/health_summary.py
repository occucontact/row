"""Health summary for occu.no, written every few days.

The facts (period vs. baseline averages, habits) are computed here so the
numbers are exact; Claude Code runs headless with no tools and only turns
those facts into a short Norwegian summary. Used by occu_sync.py.
"""
from __future__ import annotations

import datetime as dt
import glob
import json
import os
import re
import shutil
import statistics
import subprocess
from pathlib import Path

SUMMARY_PROFILES = ("iceman",)
SUMMARY_EVERY_DAYS = 4
PERIOD_DAYS = 4
BASELINE_DAYS = 28
HISTORY_KEEP = 12
CLAUDE_TIMEOUT_SEC = 300

GARMIN_METRICS = ("sleepSec", "sleepScore", "deepSec", "remSec", "hrv", "restingHr",
                  "bbHigh", "bbLow", "stress", "steps", "activeKcal", "intensityMin")

PROMPT = """Du skriver en helseoppsummering på norsk (bokmål) til {name}, basert KUN på faktadataene under (JSON).
Periode: {start} til {end} ({days} dager), sammenlignet med snittet for de {baseline} dagene før. "lastNight" er natten etter perioden.

Regler:
- Bruk bare tall som står i dataene. Mangler noe, si det kort i stedet for å gjette.
- Ikke still diagnoser. Ved tydelig bekymringsfulle tegn (for eksempel hvilepuls flere slag over snittet i flere dager, eller vedvarende lite søvn) anbefal å ta det opp med lege.
- Tider står i sekunder; skriv dem som timer og minutter (7t 05m).
- Ikke nevn vanninntak; det logges ikke.
- Maks 170 ord. Ingen innledning, hilsen eller avslutning.
- Bruk nøyaktig dette formatet:
**Kort fortalt:** én eller to setninger.
**Søvn og restitusjon:** ...
**Aktivitet:** ...
**Vaner:** de faste vanene (daglig rutine, kosttilskudd, lesing, journal) og dagens mål.
**Neste {days} dager:**
- konkret råd
- konkret råd

Data:
{facts}
"""


class SummaryError(Exception):
    """Claude Code could not produce a summary."""


# ---------------------------------------------------------------- helpers
def _iso(d: dt.date) -> str:
    return d.isoformat()


def _span(end: dt.date, days: int) -> list[str]:
    return [_iso(end - dt.timedelta(days=i)) for i in range(days - 1, -1, -1)]


def _mean(values) -> float | None:
    nums = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
    return round(statistics.fmean(nums), 1) if nums else None


def _get(rows: dict, key: str, field: str, default=None):
    data = rows.get(key)
    return data.get(field, default) if isinstance(data, dict) else default


# ---------------------------------------------------------------- facts
def _garmin_facts(rows: dict, profile: str, today: dt.date, period: list[str], baseline: list[str]) -> dict:
    days = _get(rows, f"{profile}-garmin", "days", {}) or {}
    activities = _get(rows, f"{profile}-garmin", "activities", []) or []
    window = set(period) | {_iso(today)}
    last_night = days.get(_iso(today)) or {}
    return {
        "period": {d: days.get(d) for d in period},
        "periodAvg": {m: _mean((days.get(d) or {}).get(m) for d in period) for m in GARMIN_METRICS},
        "baselineAvg": {m: _mean((days.get(d) or {}).get(m) for d in baseline) for m in GARMIN_METRICS},
        "baselineDaysWithData": sum(1 for d in baseline if days.get(d)),
        "lastNight": {k: last_night.get(k) for k in ("sleepSec", "sleepScore", "hrv", "hrvStatus") if k in last_night},
        "activities": [a for a in activities if str(a.get("start", ""))[:10] in window],
    }


def _daily_facts(rows: dict, profile: str, today: dt.date, period: list[str]) -> dict:
    log = _get(rows, f"{profile}-daily", "daily:log", {}) or {}

    def done(day: str) -> bool:
        return bool((log.get(day) or {}).get("done"))

    streak, cursor = 0, today if done(_iso(today)) else today - dt.timedelta(days=1)
    while done(_iso(cursor)):
        streak += 1
        cursor -= dt.timedelta(days=1)
    durations = [(log.get(d) or {}).get("durationSec") for d in period if done(d)]
    pushups = [v.get("pushups") for v in log.values() if isinstance(v, dict) and v.get("pushups") is not None]
    dips = [v.get("dips") for v in log.values() if isinstance(v, dict) and v.get("dips") is not None]
    return {
        "sessionsDone": sum(1 for d in period if done(d)),
        "periodDays": len(period),
        "avgDurationSec": _mean(durations),
        "currentStreak": streak,
        "trackedSince": _get(rows, f"{profile}-daily", "daily:meta", {}).get("startDate"),
        "bestPushups": max(pushups) if pushups else None,
        "bestDips": max(dips) if dips else None,
    }


def _habit_facts(rows: dict, profile: str, period: list[str]) -> dict:
    health = rows.get(f"{profile}-health") or {}
    items = health.get("stack:items") or []
    goals = rows.get(f"{profile}-goals") or {}
    goal_days = {}
    for d in period:
        lst = goals.get(f"goals:{d}")
        if isinstance(lst, list) and lst:
            goal_days[d] = {"done": sum(1 for g in lst if isinstance(g, dict) and g.get("done")), "total": len(lst)}
    return {
        "supplementsInStack": len(items),
        "supplementsTakenPerDay": {d: len(health.get(f"stack:taken:{d}") or {}) for d in period},
        "goalsPerDay": goal_days,
    }


def _reading_journal_facts(rows: dict, profile: str, period: list[str]) -> dict:
    habits = rows.get(f"{profile}-habits") or {}
    reading = habits.get("habits:reading") or {}
    books = {b.get("id"): b for b in reading.get("books") or [] if isinstance(b, dict)}
    log = reading.get("log") or {}
    pages = {d: sum(int(p) for p in (log.get(d) or {}).values() if isinstance(p, (int, float))) for d in period}
    journal = habits.get("habits:journal") or {}

    def journaled(day: str) -> bool:
        e = journal.get(day) or {}
        return bool(str(e.get("did", "")).strip() and str(e.get("tomorrow", "")).strip())

    current = books.get(reading.get("activeBookId")) or {}
    return {
        "readingPagesPerDay": pages,
        "readingDays": sum(1 for v in pages.values() if v > 0),
        "currentBook": {k: current.get(k) for k in ("title", "totalPages")} if current else None,
        "booksFinishedInPeriod": [b.get("title") for b in books.values() if b.get("finishedAt") in period],
        "journalDays": sum(1 for d in period if journaled(d)),
    }


def build_facts(rows: dict, profile: str, today: dt.date) -> dict:
    end = today - dt.timedelta(days=1)   # last complete day
    period = _span(end, PERIOD_DAYS)
    baseline = _span(end - dt.timedelta(days=PERIOD_DAYS), BASELINE_DAYS)
    weights = _get(rows, f"{profile}-po-coach", "po_coach_weights", []) or []
    return {
        "periodStart": period[0], "periodEnd": period[-1],
        "garmin": _garmin_facts(rows, profile, today, period, baseline),
        "dailyMobility": _daily_facts(rows, profile, today, period),
        "habits": _habit_facts(rows, profile, period),
        "readingAndJournal": _reading_journal_facts(rows, profile, period),
        "bodyWeightLatest": weights[-1] if weights else None,
    }


def has_enough_data(facts: dict) -> bool:
    return any(facts["garmin"]["period"].values())


# ---------------------------------------------------------------- Claude
def _version_key(path: str) -> tuple:
    m = re.search(r"claude-code-(\d+)\.(\d+)\.(\d+)", path)
    return tuple(int(x) for x in m.groups()) if m else (0,)


def find_claude() -> str | None:
    """Locate the Claude Code CLI (env override, VS Code extension, or PATH)."""
    env = os.environ.get("CLAUDE_BIN")
    if env and Path(env).exists():
        return env
    pattern = str(Path.home() / ".vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude")
    found = sorted(glob.glob(pattern), key=_version_key)
    if found:
        return found[-1]
    local = Path.home() / ".local/bin/claude"
    return shutil.which("claude") or (str(local) if local.exists() else None)


def write_summary(facts: dict, name: str, workdir: Path) -> str:
    claude = find_claude()
    if not claude:
        raise SummaryError("Claude Code CLI not found")
    prompt = PROMPT.format(
        name=name, start=facts["periodStart"], end=facts["periodEnd"], days=PERIOD_DAYS,
        baseline=BASELINE_DAYS, facts=json.dumps(facts, ensure_ascii=False, separators=(",", ":")),
    )
    try:
        res = subprocess.run(
            [claude, "-p", "--tools", "", "--no-session-persistence",
             "--strict-mcp-config", "--setting-sources", ""],
            input=prompt, text=True, capture_output=True, timeout=CLAUDE_TIMEOUT_SEC,
            cwd=workdir, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise SummaryError(str(exc)) from exc
    text = (res.stdout or "").strip()
    if res.returncode != 0 or not text:
        raise SummaryError(f"exit {res.returncode}: {(res.stderr or res.stdout or '')[-300:]}")
    return text


def is_due(existing: dict, today: dt.date) -> bool:
    created = ((existing or {}).get("latest") or {}).get("createdDate")
    if not created:
        return True
    return (today - dt.date.fromisoformat(created)).days >= SUMMARY_EVERY_DAYS


def new_entry(facts: dict, text: str, today: dt.date) -> dict:
    return {
        "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "createdDate": _iso(today),
        "from": facts["periodStart"],
        "to": facts["periodEnd"],
        "text": text,
    }


def updated_row(existing: dict, entry: dict) -> dict:
    # A re-run on the same day replaces that day's summary instead of stacking.
    previous = [e for e in (existing or {}).get("history") or [] if e.get("createdDate") != entry["createdDate"]]
    history = [entry] + previous[: HISTORY_KEEP - 1]
    return {"latest": entry, "history": history}
