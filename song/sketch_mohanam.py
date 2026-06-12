#!/usr/bin/env python3
"""Local instrumental sketch in raga Mohanam (no API needed).

Programmed approximation of a temple chariot-festival mood: warm drone,
flute-like lead melody with gamaka slides, soft percussion in adi tala,
stereo with reverb. Writes output/mohanam_sketch.wav (and .mp3 if
lameenc is installed).
"""
import os
import wave

import numpy as np

SR = 44100
BPM = 88
BEAT = 60.0 / BPM
SA = 220.0  # A3 tonic

# Mohanam: S R2 G3 P D2 (just intonation ratios within the octave)
RATIOS = [1.0, 9 / 8, 5 / 4, 3 / 2, 27 / 16]

rng = np.random.default_rng(7)


def degree_freq(deg):
    octave, step = divmod(deg, 5)
    return SA * RATIOS[step] * 2 ** octave


def smooth_env(n, attack, release):
    """Raised-cosine attack/release — no clicks."""
    e = np.ones(n)
    a, r = min(int(attack * SR), n // 2), min(int(release * SR), n // 2)
    if a:
        e[:a] = 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    if r:
        e[-r:] = 0.5 + 0.5 * np.cos(np.pi * np.arange(r) / r)
    return e


def lowpass(x, cutoff):
    """Gentle one-pole-style rolloff via FFT."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    spec *= 1 / (1 + (f / cutoff) ** 2)
    return np.fft.irfft(spec, len(x))


def flute_note(freq, dur, prev_freq=None):
    """Soft flute-like tone: few harmonics, breath, slow vibrato, glide."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = np.full(n, float(freq))
    if prev_freq:  # gamaka: glide from previous pitch over ~90 ms
        g = min(int(0.09 * SR), n)
        f[:g] = freq + (prev_freq - freq) * (0.5 + 0.5 * np.cos(
            np.pi * np.arange(g) / g))
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.0 * t) * np.minimum(t / 0.4, 1)
    phase = 2 * np.pi * np.cumsum(f * vib) / SR
    tone = (np.sin(phase) + 0.30 * np.sin(2 * phase)
            + 0.12 * np.sin(3 * phase) + 0.05 * np.sin(4 * phase))
    breath = lowpass(rng.standard_normal(n), 1800) * 0.015
    return (tone + breath) * smooth_env(n, 0.06, min(0.25, dur * 0.45)) * 0.22


def drone(total_dur):
    """Continuous warm Sa/Pa pad with slow movement and slight detune."""
    n = int(total_dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    voices = [(SA / 2, 0.5), (SA / 2 * 1.003, 0.35), (SA * 0.75, 0.30),
              (SA, 0.28), (SA * 1.002, 0.20), (SA * 1.5, 0.10)]
    for i, (f, amp) in enumerate(voices):
        lfo = 1 + 0.12 * np.sin(2 * np.pi * (0.05 + 0.013 * i) * t + i)
        out += amp * lfo * (np.sin(2 * np.pi * f * t)
                            + 0.25 * np.sin(2 * np.pi * 2 * f * t + i))
    return out * 0.045


def drum_low():
    n = int(0.30 * SR)
    t = np.arange(n) / SR
    f = 110 * np.exp(-t * 12) + 58
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 10) * 0.30


def drum_hi():
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 520 * t) * np.exp(-t * 38)
    snap = lowpass(rng.standard_normal(n), 4000) * np.exp(-t * 60)
    return (0.5 * body + 0.35 * snap) * 0.16


def add(buf, sound, at_sec):
    s = int(at_sec * SR)
    m = min(len(sound), len(buf) - s)
    if m > 0:
        buf[s:s + m] += sound[:m]


def reverb(x, seed, decay=0.9, length=1.4, wet=0.22):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.random.default_rng(seed).standard_normal(n) * np.exp(-t / decay)
    ir = lowpass(ir, 5000)
    ir /= np.sqrt(np.sum(ir ** 2))
    tail = np.fft.irfft(
        np.fft.rfft(x, len(x) + n) * np.fft.rfft(ir, len(x) + n))[:len(x)]
    return x + wet * tail


# Melody phrases as (scale degree, duration in beats); 0=Sa ... 5=upper Sa
PALLAVI = [(0, .5), (1, .5), (2, 1), (3, 1), (2, .5), (1, .5), (0, 2)]
ANUPALLAVI = [(2, .5), (3, .5), (4, 1), (5, 1.5), (4, .5), (3, 1),
              (2, 1), (1, 1), (0, 2)]
CHARANAM = [(5, 1), (5, .5), (4, .5), (3, 1), (4, .5), (5, .5), (6, 1.5),
            (5, 1.5), (4, .5), (3, .5), (2, 1), (1, 1), (0, 2)]
FORM = [PALLAVI, PALLAVI, ANUPALLAVI, PALLAVI, CHARANAM, ANUPALLAVI, PALLAVI]

# One adi-tala (8 beat) cycle: (beat offset, low drum?)
TALA = [(0, True), (2, False), (3, True), (4, True), (6, False), (7, False)]


def main():
    intro = 5.0
    melody_beats = sum(d for ph in FORM for _, d in ph)
    outro = 5.0
    total = intro + melody_beats * BEAT + outro
    n = int(total * SR)

    pad = drone(total)
    lead = np.zeros(n)
    perc = np.zeros(n)

    # rhythm under the melody section only, easing in on the 2nd cycle
    pos, cycle = intro, 0
    while pos < total - outro - 0.01:
        gain = 0.5 if cycle == 0 else 1.0
        for off, low in TALA:
            add(perc, (drum_low() if low else drum_hi()) * gain,
                pos + off * BEAT)
        pos += 8 * BEAT
        cycle += 1

    pos, prev = intro, None
    for phrase in FORM:
        for deg, beats in phrase:
            f = degree_freq(deg)
            add(lead, flute_note(f, beats * BEAT + 0.05, prev), pos)
            prev = f
            pos += beats * BEAT
    add(lead, flute_note(degree_freq(0), outro * 0.8, prev), pos)

    mix = pad + lead + perc
    left = reverb(mix + 0.02 * pad, seed=11)
    right = reverb(mix - 0.02 * pad, seed=12)

    stereo = np.stack([left, right], axis=1)
    stereo *= smooth_env(n, 1.5, 4.0)[:, None]
    stereo = np.tanh(stereo / np.quantile(np.abs(stereo), 0.999)) * 0.8

    pcm = (stereo * 32767).astype(np.int16)
    os.makedirs("output", exist_ok=True)
    with wave.open("output/mohanam_sketch.wav", "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"Wrote output/mohanam_sketch.wav ({total:.0f}s)")

    try:
        import lameenc
        enc = lameenc.Encoder()
        enc.set_bit_rate(192)
        enc.set_in_sample_rate(SR)
        enc.set_channels(2)
        enc.set_quality(2)
        mp3 = enc.encode(pcm.tobytes()) + enc.flush()
        with open("output/mohanam_sketch.mp3", "wb") as f:
            f.write(mp3)
        print("Wrote output/mohanam_sketch.mp3")
    except ImportError:
        pass


if __name__ == "__main__":
    main()
