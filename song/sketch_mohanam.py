#!/usr/bin/env python3
"""Local instrumental sketch in raga Mohanam (no API needed).

Programmed approximation of a temple chariot-festival mood:
tanpura-style drone, nadaswaram-like lead melody with gamaka slides,
and a thavil-like 8-beat (adi tala) rhythm. Writes output/mohanam_sketch.wav
(and .mp3 if lameenc is installed).
"""
import os
import wave

import numpy as np

SR = 44100
BPM = 96
BEAT = 60.0 / BPM
SA = 146.83  # D3 tonic

# Mohanam: S R2 G3 P D2 (just intonation ratios within the octave)
RATIOS = [1.0, 9 / 8, 5 / 4, 3 / 2, 27 / 16]


def degree_freq(deg, base_octave=1):
    octave, step = divmod(deg, 5)
    return SA * RATIOS[step] * 2 ** (octave + base_octave)


def env(n, attack=0.04, release=0.15):
    e = np.ones(n)
    a, r = int(attack * SR), int(release * SR)
    if a:
        e[:a] = np.linspace(0, 1, a)
    if r and r < n:
        e[-r:] = np.linspace(1, 0, r)
    return e


def nadaswaram_note(freq, dur, prev_freq=None):
    """Bright reedy tone: additive harmonics, slide-in (gamaka), vibrato."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = np.full(n, freq)
    if prev_freq:  # glide from the previous pitch over ~70 ms
        g = min(int(0.07 * SR), n)
        f[:g] = np.linspace(prev_freq, freq, g)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(t / 0.25, 1)
    phase = 2 * np.pi * np.cumsum(f * vib) / SR
    tone = np.zeros(n)
    for h, amp in enumerate([1.0, 0.62, 0.45, 0.3, 0.22, 0.15, 0.09], start=1):
        tone += amp * np.sin(h * phase)
    return tone * env(n, attack=0.025, release=min(0.18, dur * 0.4)) * 0.16


def tanpura(total_dur):
    """Slow looping Sa/Pa plucks with rich harmonics."""
    n = int(total_dur * SR)
    out = np.zeros(n)
    cycle = [SA, SA * 1.5, SA * 2, SA]  # Sa Pa Sa' Sa
    step = 1.4
    i, pos = 0, 0.0
    while pos < total_dur:
        f = cycle[i % 4]
        m = int(min(2.6, total_dur - pos) * SR)
        t = np.arange(m) / SR
        pluck = sum(
            (0.5 ** h) * np.sin(2 * np.pi * f * (h + 1) * t) for h in range(6)
        ) * np.exp(-t / 1.6)
        s = int(pos * SR)
        out[s:s + m] += pluck[: n - s] * 0.05
        i += 1
        pos += step
    return out


def thavil_low(dur=0.22):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 95 * np.exp(-t * 9) + 55
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14) * 0.5


def thavil_hi(dur=0.09):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = np.random.default_rng(7).standard_normal(n)
    return (noise * np.exp(-t * 55) + 0.4 * np.sin(2 * np.pi * 480 * t)
            * np.exp(-t * 40)) * 0.22


def add(buf, sound, at_sec):
    s = int(at_sec * SR)
    m = min(len(sound), len(buf) - s)
    if m > 0:
        buf[s:s + m] += sound[:m]


# Melody phrases as (scale degree, duration in beats); 0=Sa ... 5=upper Sa
PALLAVI = [(0, .5), (1, .5), (2, 1), (3, 1), (2, .5), (1, .5), (0, 2)]
ANUPALLAVI = [(2, .5), (3, .5), (4, 1), (5, 1), (4, .5), (3, .5),
              (2, 1), (1, 1), (0, 2)]
CHARANAM = [(5, .5), (5, .5), (4, 1), (3, 1), (4, .5), (5, .5), (6, 1),
            (5, 1), (4, .5), (3, .5), (2, 1), (1, 1), (0, 2)]
FORM = [PALLAVI, PALLAVI, ANUPALLAVI, PALLAVI, CHARANAM, ANUPALLAVI, PALLAVI]

# One adi-tala (8 beat) thavil cycle: (beat offset, low?)
TALA = [(0, True), (1, False), (2, True), (3.5, False), (4, True),
        (5, False), (6, True), (6.5, False), (7, False)]


def main():
    intro = 4.0
    melody_beats = sum(d for ph in FORM for _, d in ph)
    outro = 4.0
    total = intro + melody_beats * BEAT + outro
    buf = tanpura(total)

    # rhythm runs under the melody section
    pos = intro
    while pos < total - outro - 0.01:
        for off, low in TALA:
            add(buf, thavil_low() if low else thavil_hi(), pos + off * BEAT)
        pos += 8 * BEAT

    # lead melody
    pos, prev = intro, None
    for phrase in FORM:
        for deg, beats in phrase:
            f = degree_freq(deg)
            add(buf, nadaswaram_note(f, beats * BEAT, prev), pos)
            prev = f
            pos += beats * BEAT
    # closing sustained Sa over the drone
    add(buf, nadaswaram_note(degree_freq(0), outro * 0.9, prev), pos)

    buf /= max(1.0, np.max(np.abs(buf)) / 0.85)
    pcm = (buf * 32767).astype(np.int16)

    os.makedirs("output", exist_ok=True)
    with wave.open("output/mohanam_sketch.wav", "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"Wrote output/mohanam_sketch.wav ({total:.0f}s)")

    try:
        import lameenc
        enc = lameenc.Encoder()
        enc.set_bit_rate(160)
        enc.set_in_sample_rate(SR)
        enc.set_channels(1)
        enc.set_quality(2)
        mp3 = enc.encode(pcm.tobytes()) + enc.flush()
        with open("output/mohanam_sketch.mp3", "wb") as f:
            f.write(mp3)
        print("Wrote output/mohanam_sketch.mp3")
    except ImportError:
        pass


if __name__ == "__main__":
    main()
