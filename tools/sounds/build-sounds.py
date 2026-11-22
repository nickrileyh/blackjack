#!/usr/bin/env python3
"""Builds src/sound-data.js: the recorded card, chip and shuffle sounds, as small MP3 clips in base64.

    python3 tools/sounds/build-sounds.py        (needs numpy and an ffmpeg with the rubberband filter)

The recordings are from Kenney's "Casino Audio" pack (CC0, kenney.nl) — see kenney/License.txt.

Each clip keeps the WHOLE sound: the quiet slide before a card lands is most of what makes it sound like a deal, so
only real silence is cut from the ends. Where a recording is too long for the pace of the app it is SPED UP WITHOUT
CHANGING ITS PITCH (never trimmed shorter): each stretch is tried a few ways and the one that best keeps the
recording's tone and snap is used. Clips in one group are then levelled to be equally loud.
To change which recordings are used, or how fast they play, edit CLIPS below and run this again, then ./build.sh.

Two more steps make them sound like one table (Nick: "make sound effects better for train and live practice more
realistic", Nov 2026):
  * MATCH: the dealt cards are tone-matched to one another, so every card sounds like the same deck on the same felt
    and only the small details change. (Two of the five recordings used before were mostly a low thump and three were
    bright paper, so one card in two sounded like a different object.)
  * FELT: everything that lands on the table has the very top and the rumble taken off, as felt and a little distance
    do. The shuffle happens in the dealer's hands above the table and is left as recorded.
Both are minimum-phase filters, so nothing is heard before a snap.
"""
import base64, os, subprocess, tempfile, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 44100
# group -> [(file, start seconds or None for "where the sound starts", end seconds or None for "where it dies away", tempo)]
# tempo 1.3 = 30% faster at the same pitch
CLIPS = {
    # the four recordings of a card that slides and then lands, as recorded (no stretching: their slides are short enough
    # to sit under a dealt card at the app's normal pace); 2 and 5, mostly a thump, are no longer used
    "card": [("card-slide-4", None, None, 1.0), ("card-slide-6", None, None, 1.0), ("card-slide-7", None, None, 1.0), ("card-slide-8", None, None, 1.0)],
    # a chip set down with some body to it (a stack, two chips meeting) rather than the thin ticks of chip-lay-1 and 2
    "chip": [("chips-stack-3", None, None, 1.0), ("chips-stack-4", None, None, 1.0), ("chips-collide-1", None, None, 1.0), ("chips-collide-2", None, None, 1.0)],
    # all seven shuffling strokes of the three-second recording, quickened to fit the "Shuffling" pause
    "shuffle": [("card-shuffle", 0.06, 2.98, 1.55)],
    # the dealer paying a win: chips cut from the rack and set beside the bet
    "pay": [("chips-handle-3", None, None, 1.0), ("chips-handle-4", None, None, 1.0)],
    # the dealer taking a losing bet
    "take": [("chips-collide-3", None, None, 1.0), ("chips-collide-1", None, None, 1.0)],
    # the dealer gathering the cards off the felt before the next hand
    "collect": [("card-shove-1", None, None, 1.25), ("card-shove-3", None, None, 1.25)],
}
MATCH = {"card", "cardq"}                                   # tone-matched to one another within the group
FELT = {"card", "cardq", "chip", "pay", "take", "collect"}   # given the felt's tone
# the same card recordings, quicker at the same pitch, for the fast dealing speeds in Live play:
# a card that flies in a tenth of a second needs a sound that fits inside it (sound.js picks the set by flight time)
QUICK = 1.5
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

# ---- tone ----
CENTRES = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

def band_db(y):
    """The level of each octave band, in dB."""
    S = np.abs(np.fft.rfft(y * np.hanning(len(y)), 1 << 16)) ** 2; f = np.fft.rfftfreq(1 << 16, 1 / SR)
    return np.array([10 * np.log10(S[(f >= c / np.sqrt(2)) & (f < c * np.sqrt(2))].sum() + 1e-20) for c in CENTRES])

def curve(gains_db, f):
    """A smooth gain curve through the octave-band gains (straight lines in log frequency), as a magnitude."""
    lf = np.log2(np.maximum(f, 20)); return 10 ** (np.interp(lf, np.log2(CENTRES), gains_db) / 20)

def min_phase_apply(y, gains_db):
    """Filter y by the gain curve with a minimum-phase filter (cepstrum method): the tone changes, nothing rings before a snap."""
    n = 1 << int(np.ceil(np.log2(len(y) + SR // 10)))
    f = np.fft.rfftfreq(n, 1 / SR); mag = np.maximum(curve(gains_db, f), 1e-4)
    c = np.fft.irfft(np.log(mag), n); fold = np.zeros(n); fold[0] = c[0]; fold[1:n // 2] = 2 * c[1:n // 2]; fold[n // 2] = c[n // 2]
    H = np.exp(np.fft.rfft(fold, n))
    return np.fft.irfft(np.fft.rfft(y, n) * H, n)[:len(y)]

# felt and a little distance: a soft roll-off over 6 kHz and nothing under 60 Hz
FELT_DB = np.array([-9, -2, 0, 0, 0, 0, -1, -3.5, -9])

def match(clips):
    """Bring each clip three quarters of the way to the group's median tone, by at most 7 dB in any band."""
    b = [band_db(c) - band_db(c).max() for c in clips]; target = np.median(b, axis=0)
    return [min_phase_apply(c, np.clip(0.75 * (target - x), -7, 7)) for c, x in zip(clips, b)]

def mp3(y):
    with tempfile.TemporaryDirectory() as d:
        wav, out = os.path.join(d, "a.wav"), os.path.join(d, "a.mp3"); write(wav, y)
        ffmpeg("-i", wav, "-c:a", "libmp3lame", "-b:a", "96k", "-ac", "1", out)
        return open(out, "rb").read()

lines, total = [], 0
for group, items in CLIPS.items():
    made = [faster(cut(decode(n), a, b), t) for n, a, b, t in items]
    clips = [y for y, _ in made]
    if group in MATCH: clips = match(clips)
    if group in FELT: clips = [min_phase_apply(c, FELT_DB) for c in clips]
    clips = [fade(y) for y in clips]
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
    "// card, cardq: a dealt card; chip: a bet; shuffle; pay: a win paid; take: a losing bet taken; collect: cards gathered.\n"
    "export const CLIPS = {\n" + "\n".join(lines) + "\n};\n")
print(f"src/sound-data.js: {total / 1024:.1f} KB of MP3")
