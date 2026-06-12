#!/usr/bin/env python3
"""Generate a full song (vocals + instruments) from lyrics via a music API.

Providers:
  fal         fal.ai ACE-Step (lyrics + style tags -> song). Key: FAL_KEY
  elevenlabs  ElevenLabs Music (prompt incl. lyrics -> song). Key: ELEVENLABS_API_KEY

Usage:
  export FAL_KEY=...            # from https://fal.ai/dashboard/keys
  python3 generate_song.py --provider fal \
      --lyrics lyrics/01-chithirath-ther-erinaai.txt \
      --style style-prompt.txt --out output/song1.mp3

Suno has no official public API; third-party wrappers (sunoapi.org etc.)
expose a similar HTTP interface — adapt request_fal() if you use one.
"""
import argparse
import json
import os
import sys
import urllib.request

FAL_ENDPOINT = "https://fal.run/fal-ai/ace-step"
ELEVENLABS_ENDPOINT = "https://api.elevenlabs.io/v1/music"


def http_json(url, payload, headers):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **headers},
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        body = resp.read()
    ctype = resp.headers.get("Content-Type", "")
    return (json.loads(body), None) if "json" in ctype else (None, body)


def download(url, out_path):
    with urllib.request.urlopen(url, timeout=600) as resp:
        with open(out_path, "wb") as f:
            f.write(resp.read())


def request_fal(lyrics, style, out_path):
    key = os.environ.get("FAL_KEY")
    if not key:
        sys.exit("Set FAL_KEY (get one at https://fal.ai/dashboard/keys)")
    payload = {
        "lyrics": lyrics,
        "tags": style.replace("\n", " "),
        "duration": 180,
    }
    data, _ = http_json(FAL_ENDPOINT, payload, {"Authorization": f"Key {key}"})
    audio_url = data.get("audio", {}).get("url") or data.get("audio_url")
    if not audio_url:
        sys.exit(f"No audio in response: {json.dumps(data)[:500]}")
    download(audio_url, out_path)


def request_elevenlabs(lyrics, style, out_path):
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("Set ELEVENLABS_API_KEY (get one at https://elevenlabs.io)")
    prompt = f"{style.strip()}\n\nSing these Tamil lyrics:\n{lyrics.strip()}"
    payload = {"prompt": prompt, "music_length_ms": 180000}
    data, raw = http_json(ELEVENLABS_ENDPOINT, payload, {"xi-api-key": key})
    if raw:  # audio bytes returned directly
        with open(out_path, "wb") as f:
            f.write(raw)
        return
    audio_url = (data or {}).get("audio_url")
    if not audio_url:
        sys.exit(f"No audio in response: {json.dumps(data)[:500]}")
    download(audio_url, out_path)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--provider", choices=["fal", "elevenlabs"], default="fal")
    p.add_argument("--lyrics", required=True, help="path to lyrics .txt")
    p.add_argument("--style", default="style-prompt.txt")
    p.add_argument("--out", default="output/song.mp3")
    args = p.parse_args()

    lyrics = open(args.lyrics, encoding="utf-8").read()
    style = open(args.style, encoding="utf-8").read()
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)

    if args.provider == "fal":
        request_fal(lyrics, style, args.out)
    else:
        request_elevenlabs(lyrics, style, args.out)
    print(f"Saved {args.out}")


if __name__ == "__main__":
    main()
