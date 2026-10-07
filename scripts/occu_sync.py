#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["garminconnect==0.3.2", "requests==2.33.0"]
# ///
"""occu.no helper — Garmin → Supabase sync, plus a read-only view of dashboard data.

    uv run occu_sync.py login            # once: sign in to Supabase (password is never stored)
    uv run occu_sync.py sync [--days N]  # fetch Garmin data into the "<profile>-garmin" row
    uv run occu_sync.py show [KEY ...]   # print your dashboard rows as JSON
    uv run occu_sync.py install          # copy to ~/.occu and run `sync` daily via launchd

Garmin login tokens come from ~/.garminconnect (created by garmin-mcp-auth).
Supabase access uses a rotating refresh token in ~/.occu/supabase_session.json
(mode 600). Nothing secret lives in this file: the publishable key is public and
row level security limits every row to the signed-in owner.
"""
from __future__ import annotations

import argparse
import datetime as dt
import getpass
import json
import logging
import logging.handlers
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import requests

SUPA_URL = "https://yntpsdcjqeewgcozfqxg.supabase.co"
SUPA_KEY = "sb_publishable_czAWpjJwmdO19E_kO2ROLA_DpPs00lg"
DEFAULT_EMAIL = "occu.contact@gmail.com"
PROFILE = os.environ.get("OCCU_PROFILE", "iceman").lower()

STATE_DIR = Path.home() / ".occu"
SESSION_FILE = STATE_DIR / "supabase_session.json"
LOG_FILE = STATE_DIR / "sync.log"
GARMIN_TOKENS = Path(os.environ.get("GARMINTOKENS", "~/.garminconnect")).expanduser()

LAUNCHD_LABEL = "no.occu.garmin-sync"
LAUNCHD_PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LAUNCHD_LABEL}.plist"
SYNC_TIMES = [(7, 30), (19, 0)]   # morning: last night's sleep; evening: today's activities

DEFAULT_DAYS = 7          # re-fetch a week each run so late watch syncs are picked up
KEEP_DAYS = 120           # rolling history stored in the row
ACTIVITY_COUNT = 15
HTTP_TIMEOUT = 30
TOKEN_SKEW_SEC = 60

log = logging.getLogger("occu")


class NeedsLogin(Exception):
    """Raised when a stored login is missing or no longer valid."""


# ---------------------------------------------------------------- helpers
def setup_logging(verbose: bool) -> None:
    STATE_DIR.mkdir(mode=0o700, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(LOG_FILE, maxBytes=256_000, backupCount=2)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(handler)
    console = logging.StreamHandler(sys.stderr)
    console.setFormatter(logging.Formatter("%(message)s"))
    log.addHandler(console)
    log.setLevel(logging.DEBUG if verbose else logging.INFO)


def notify(message: str) -> None:
    """Best-effort macOS notification so a broken login doesn't go unnoticed."""
    script = f'display notification {json.dumps(message)} with title "occu.no"'
    try:
        subprocess.run(["osascript", "-e", script], check=False, timeout=10, capture_output=True)
    except (OSError, subprocess.SubprocessError):
        pass


def write_private(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def prune(d: dict) -> dict:
    """Drop None values so the stored JSON stays small."""
    return {k: v for k, v in d.items() if v is not None}


# ---------------------------------------------------------------- Supabase
def _auth_request(grant: str, payload: dict) -> dict:
    res = requests.post(
        f"{SUPA_URL}/auth/v1/token?grant_type={grant}",
        headers={"apikey": SUPA_KEY, "Content-Type": "application/json"},
        json=payload, timeout=HTTP_TIMEOUT,
    )
    if res.status_code in (400, 401, 403):
        raise NeedsLogin(res.json().get("error_description") or res.json().get("msg") or res.text)
    res.raise_for_status()
    return res.json()


def _save_session(tok: dict) -> dict:
    session = {
        "access_token": tok["access_token"],
        "refresh_token": tok["refresh_token"],
        "expires_at": int(tok.get("expires_at") or time.time() + int(tok.get("expires_in", 3600))),
        "user_id": tok.get("user", {}).get("id"),
    }
    write_private(SESSION_FILE, session)
    return session


def supabase_login() -> None:
    email = input(f"Supabase e-post [{DEFAULT_EMAIL}]: ").strip() or DEFAULT_EMAIL
    password = getpass.getpass("Passord (lagres ikke): ")
    session = _save_session(_auth_request("password", {"email": email, "password": password}))
    print(f"Innlogget. Nøkkel lagret i {SESSION_FILE} (kun lesbar for deg). Bruker-id {session['user_id']}.")


def access_token() -> str:
    if not SESSION_FILE.exists():
        raise NeedsLogin("no saved session")
    session = json.loads(SESSION_FILE.read_text())
    if session.get("expires_at", 0) - TOKEN_SKEW_SEC > time.time():
        return session["access_token"]
    # Refresh tokens rotate: always persist the new one immediately.
    session = _save_session(_auth_request("refresh_token", {"refresh_token": session["refresh_token"]}))
    return session["access_token"]


def _rest_headers() -> dict:
    return {"apikey": SUPA_KEY, "Authorization": f"Bearer {access_token()}", "Content-Type": "application/json"}


def fetch_rows(keys: list[str] | None = None) -> list[dict]:
    params = {"select": "key,updated_at,data", "order": "key"}
    if keys:
        params["key"] = "in.(" + ",".join(keys) + ")"
    res = requests.get(f"{SUPA_URL}/rest/v1/app_state", headers=_rest_headers(), params=params, timeout=HTTP_TIMEOUT)
    if res.status_code == 401:
        raise NeedsLogin(res.text)
    res.raise_for_status()
    return res.json()


def upsert_row(key: str, data: dict) -> None:
    headers = {**_rest_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"}
    body = {"key": key, "data": data, "updated_at": dt.datetime.now(dt.timezone.utc).isoformat()}
    res = requests.post(f"{SUPA_URL}/rest/v1/app_state?on_conflict=key", headers=headers, json=body, timeout=HTTP_TIMEOUT)
    if res.status_code == 401:
        raise NeedsLogin(res.text)
    res.raise_for_status()


# ---------------------------------------------------------------- Garmin
def garmin_client():
    from garminconnect import Garmin

    if not GARMIN_TOKENS.exists():
        raise NeedsLogin("no Garmin tokens")
    g = Garmin()
    try:
        g.login(str(GARMIN_TOKENS))   # refreshes and re-saves tokens when needed
    except Exception as exc:          # library raises several auth error types
        raise NeedsLogin(f"Garmin: {exc}") from exc
    return g


def _safe(label: str, fn, *args):
    try:
        return fn(*args)
    except Exception as exc:  # noqa: BLE001 — one failing endpoint must not drop the whole day
        log.warning("Garmin %s%s failed: %s", label, args, exc)
        return None


def day_summary(g, day: str) -> dict:
    stats = _safe("stats", g.get_stats, day) or {}
    sleep = ((_safe("sleep", g.get_sleep_data, day) or {}).get("dailySleepDTO")) or {}
    hrv = ((_safe("hrv", g.get_hrv_data, day) or {}).get("hrvSummary")) or {}
    readiness = _safe("readiness", g.get_training_readiness, day)
    if isinstance(readiness, list):
        readiness = readiness[0] if readiness else {}
    readiness = readiness or {}
    score = ((sleep.get("sleepScores") or {}).get("overall") or {}).get("value")
    return prune({
        "steps": stats.get("totalSteps"),
        "stepGoal": stats.get("dailyStepGoal"),
        "restingHr": stats.get("restingHeartRate"),
        "bbHigh": stats.get("bodyBatteryHighestValue"),
        "bbLow": stats.get("bodyBatteryLowestValue"),
        "bbNow": stats.get("bodyBatteryMostRecentValue"),
        "stress": stats.get("averageStressLevel"),
        "activeKcal": stats.get("activeKilocalories"),
        "intensityMin": (stats.get("moderateIntensityMinutes") or 0) + 2 * (stats.get("vigorousIntensityMinutes") or 0) or None,
        "sleepSec": sleep.get("sleepTimeSeconds"),
        "deepSec": sleep.get("deepSleepSeconds"),
        "remSec": sleep.get("remSleepSeconds"),
        "lightSec": sleep.get("lightSleepSeconds"),
        "awakeSec": sleep.get("awakeSleepSeconds"),
        "sleepScore": score,
        "hrv": hrv.get("lastNightAvg"),
        "hrvWeek": hrv.get("weeklyAvg"),
        "hrvStatus": hrv.get("status"),
        "readiness": readiness.get("score"),
        "readinessLevel": readiness.get("level"),
    })


def recent_activities(g) -> list[dict]:
    out = []
    for a in _safe("activities", g.get_activities, 0, ACTIVITY_COUNT) or []:
        out.append(prune({
            "id": a.get("activityId"),
            "start": a.get("startTimeLocal"),
            "type": (a.get("activityType") or {}).get("typeKey"),
            "name": a.get("activityName"),
            "durationSec": round(a["duration"]) if a.get("duration") else None,
            "distanceM": round(a["distance"]) if a.get("distance") else None,
            "avgHr": a.get("averageHR"),
            "kcal": a.get("calories"),
            "aerobicTe": round(a["aerobicTrainingEffect"], 1) if a.get("aerobicTrainingEffect") else None,
        }))
    return out


def vo2max(g, day: str):
    metrics = _safe("max_metrics", g.get_max_metrics, day)
    if isinstance(metrics, list) and metrics:
        return ((metrics[0] or {}).get("generic") or {}).get("vo2MaxPreciseValue")
    return None


def run_sync(days: int) -> None:
    key = f"{PROFILE}-garmin"
    g = garmin_client()
    today = dt.date.today()  # noqa: DTZ011 — Garmin days are local calendar dates
    existing = fetch_rows([key])
    data = (existing[0]["data"] if existing else {}) or {}
    stored = dict(data.get("days") or {})

    for i in range(days):
        day = (today - dt.timedelta(days=i)).isoformat()
        summary = day_summary(g, day)
        if summary:
            stored[day] = summary
    cutoff = (today - dt.timedelta(days=KEEP_DAYS)).isoformat()
    stored = {d: v for d, v in sorted(stored.items()) if d >= cutoff}

    new_data = {
        "days": stored,
        "activities": recent_activities(g) or data.get("activities") or [],
        "vo2max": vo2max(g, today.isoformat()) or data.get("vo2max"),
        "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    upsert_row(key, new_data)
    latest = stored.get(today.isoformat()) or stored.get((today - dt.timedelta(days=1)).isoformat()) or {}
    log.info("Synced %d days to %s (latest: %s)", days, key, json.dumps(latest)[:200])


# ---------------------------------------------------------------- install
def install() -> None:
    STATE_DIR.mkdir(mode=0o700, exist_ok=True)
    target = STATE_DIR / "occu_sync.py"
    shutil.copy2(Path(__file__).resolve(), target)
    uv = shutil.which("uv") or str(Path.home() / ".local" / "bin" / "uv")
    intervals = "".join(
        f"<dict><key>Hour</key><integer>{h}</integer><key>Minute</key><integer>{m}</integer></dict>"
        for h, m in SYNC_TIMES
    )
    LAUNCHD_PLIST.parent.mkdir(parents=True, exist_ok=True)
    LAUNCHD_PLIST.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>{uv}</string><string>run</string><string>--quiet</string><string>--script</string>
    <string>{target}</string><string>sync</string>
  </array>
  <key>StartCalendarInterval</key><array>{intervals}</array>
  <key>StandardOutPath</key><string>{STATE_DIR / 'launchd.log'}</string>
  <key>StandardErrorPath</key><string>{STATE_DIR / 'launchd.log'}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>{Path(uv).parent}:/usr/bin:/bin</string>
    <key>OCCU_PROFILE</key><string>{PROFILE}</string>
  </dict>
</dict></plist>
""")
    uid = os.getuid()
    subprocess.run(["launchctl", "bootout", f"gui/{uid}/{LAUNCHD_LABEL}"], capture_output=True, check=False)
    subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", str(LAUNCHD_PLIST)], check=True)
    times = ", ".join(f"{h:02d}:{m:02d}" for h, m in SYNC_TIMES)
    print(f"Installert: {target}\nKjører daglig kl. {times} (også når Macen våkner etter et missed tidspunkt).")


# ---------------------------------------------------------------- main
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login")
    p_sync = sub.add_parser("sync")
    p_sync.add_argument("--days", type=int, default=DEFAULT_DAYS)
    p_show = sub.add_parser("show")
    p_show.add_argument("keys", nargs="*")
    sub.add_parser("install")
    args = parser.parse_args()
    setup_logging(args.verbose)

    try:
        if args.cmd == "login":
            supabase_login()
        elif args.cmd == "sync":
            if not 1 <= args.days <= KEEP_DAYS:
                parser.error(f"--days must be between 1 and {KEEP_DAYS}")
            run_sync(args.days)
        elif args.cmd == "show":
            print(json.dumps(fetch_rows(args.keys or None), ensure_ascii=False, indent=2))
        elif args.cmd == "install":
            install()
        return 0
    except NeedsLogin as exc:
        garmin = str(exc).startswith(("Garmin", "no Garmin"))
        fix = "kjør garmin-mcp-auth på nytt" if garmin else "kjør: uv run ~/.occu/occu_sync.py login"
        log.error("Login needed (%s) — %s", exc, fix)
        notify(("Garmin" if garmin else "Supabase") + "-innlogging utløpt – " + fix)
        return 2
    except requests.RequestException as exc:
        log.error("Network error: %s", exc)
        return 3


if __name__ == "__main__":
    sys.exit(main())
