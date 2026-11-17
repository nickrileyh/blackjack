#!/usr/bin/env python3
"""Builds src/sound-data.js: the recorded card, chip and shuffle sounds, as small MP3 clips in base64.

    python3 tools/sounds/build-sounds.py        (needs numpy and an ffmpeg with the rubberband filter)

The recordings are from Kenney's "Casino Audio" pack (CC0, kenney.nl) — see kenney/License.txt.

Each clip keeps the WHOLE sound: the quiet slide before a card lands is most of what makes it sound like a deal, so
only real silence is cut from the ends. Where a recording is too long for the pace of the app it is SPED UP WITHOUT
CHANGING ITS PITCH (never trimmed shorter): each stretch is tried a few ways and the one that best keeps the
recording's tone and snap is used. Clips in one group are then levelled to be equally loud.
To change which recordings are used, or how fast they play, edit CLIPS below and run this again, then ./build.sh.
"""
import base64, os, subprocess, tempfile, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 44100
# group -> [(file, start seconds or None for "where the sound starts", end seconds or None for "where it dies away", tempo)]
# tempo 1.3 = 30% faster at the same pitch
CLIPS = {
    "card": [("card-slide-2", None, None, 1.0), ("card-slide-4", None, None, 1.3), ("card-slide-5", None, None, 1.3), ("card-slide-6", None, None, 1.3), ("card-slide-8", None, None, 1.5)],
    "chip": [("chip-lay-1", None, None, 1.0), ("chip-lay-2", None, None, 1.0), ("chips-stack-4", None, None, 1.0), ("chips-stack-5", None, None, 1.0)],
    # all seven shuffling strokes of the three-second recording, quickened to fit the "Shuffling" pause
    "shuffle": [("card-shuffle", 0.06, 2.98, 1.55)],
}
# the same five card recordings, quicker again at the same pitch, for the fast dealing speeds in Live play:
# a card that flies in a tenth of a second needs a sound that fits inside it (sound.js picks the set by flight time)
QUICK = 1.6
CLIPS["cardq"] = [(n, a, b, round(t * QUICK, 2)) for n, a, b, t in CLIPS["card"]]
STRETCHES = ["atempo={t}", "rubberband=tempo={t}:transients=crisp:detector=percussive", "rubberband=tempo={t}:transients=crisp:detector=percussive:window=short:phase=independent"]

def read(path):
    w = wave.open(path); return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768

def write(path, y):
    w = wave.open(path, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(y, -1, 1) * 32767).astype(np.int16).tobytes()); w.close()

def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)

def decode(name):
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "a.wav"); ffmpeg("-i", os.path.join(HERE, "kenney", name + ".ogg"), "-ac", "1", "-ar", str(SR), out); return read(out)

def cut(x, a, b):
    """Keep everything audible: from the first hint of the sound (1.2% of its loudest moment) to where it has died away (4%), plus a little air."""
    n = int(0.01 * SR); e = np.array([np.sqrt((x[i:i + n] ** 2).mean()) for i in range(0, len(x) - n, n)]); mx = e.max()
    i0 = int(a * SR) if a is not None else max(0, np.where(e > 0.012 * mx)[0][0] * n - n)
    i1 = int(b * SR) if b is not None else min(len(x), (np.where(e > 0.04 * mx)[0][-1] + 1) * n + int(0.06 * SR))
    return x[i0:i1].copy()

def fade(y):
    fi, fo = int(0.006 * SR), int(min(0.06, len(y) / SR / 4) * SR)
    y = y.copy(); y[:fi] *= np.linspace(0, 1, fi); y[-fo:] *= np.linspace(1, 0, fo) ** 2; return y

def bands(y):
    S = np.abs(np.fft.rfft(y)) ** 2; f = np.fft.rfftfreq(len(y), 1 / SR); t = S.sum()
    return [100 * S[(f >= lo) & (f < hi)].sum() / t for lo, hi in ((0, 1000), (1000, 3000), (3000, 6000), (6000, 12000), (12000, SR / 2))]

crest = lambda y: np.abs(y).max() / np.sqrt((y ** 2).mean())

def faster(y, tempo):
    """Speed up at the same pitch. Returns the version that changes the tone (energy in five bands) and the snap (crest) least."""
    if abs(tempo - 1) < 1e-6: return y, "as recorded"
    best = None
    with tempfile.TemporaryDirectory() as d:
        a, b = os.path.join(d, "a.wav"), os.path.join(d, "b.wav"); write(a, y)
        for f in STRETCHES:
            ffmpeg("-i", a, "-af", f.format(t=tempo), b); z = read(b)
            score = sum(abs(p - q) for p, q in zip(bands(z), bands(y))) + 40 * abs(crest(z) - crest(y)) / crest(y)
            if best is None or score < best[0]: best = (score, z, f.split("=")[0] + (" short window" if "short" in f else ""))
    return best[1], f"x{tempo} by {best[2]}"

def mp3(y):
    with tempfile.TemporaryDirectory() as d:
        wav, out = os.path.join(d, "a.wav"), os.path.join(d, "a.mp3"); write(wav, y)
        ffmpeg("-i", wav, "-c:a", "libmp3lame", "-b:a", "96k", "-ac", "1", out)
        return open(out, "rb").read()

lines, total = [], 0
for group, items in CLIPS.items():
    made = [faster(cut(decode(n), a, b), t) for n, a, b, t in items]
    clips = [fade(y) for y, _ in made]
    loud = [np.sqrt(np.mean(np.sort(c ** 2)[-int(0.05 * SR):])) for c in clips]           # loudness of each clip's loudest 50 ms
    clips = [c * (min(loud) / l) for c, l in zip(clips, loud)]
    k = 0.89 / max(np.abs(c).max() for c in clips)                                         # as loud as the group allows without clipping
    enc = [mp3(c * k) for c in clips]
    total += sum(len(e) for e in enc)
    for (n, _, _, _), c, (_, how) in zip(items, clips, made): print(f"{group:8s} {n:14s} {len(c) / SR * 1000:5.0f} ms  {how}")
    lines.append(f'  {group}: [\n' + ",\n".join(f'    "{base64.b64encode(e).decode()}"' for e in enc) + "\n  ],")
open(os.path.join(HERE, "..", "..", "src", "sound-data.js"), "w").write(
    "// Generated by tools/sounds/build-sounds.py — do not edit by hand.\n"
    "// Recorded card, chip and shuffle sounds from Kenney's \"Casino Audio\" pack (CC0, kenney.nl), as MP3 in base64.\n"
    "export const CLIPS = {\n" + "\n".join(lines) + "\n};\n")
print(f"src/sound-data.js: {total / 1024:.1f} KB of MP3")
