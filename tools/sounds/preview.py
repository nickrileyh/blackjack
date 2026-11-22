#!/usr/bin/env python3
"""Renders what the table sounds like, so a change can be heard by someone who has ears (Nick) and measured by someone
who hasn't (Claude). It plays one script — three Live play hands (a win, a loss, a blackjack) and three Train hands, at
the app's own timings — through src/sound.js offline in Chromium, and writes table-sounds-after.mp3; with --before it
also renders the last commit's sound.js and sound-data.js as table-sounds-before.mp3, for an A/B.

    python3 tools/sounds/preview.py [--before] [--out DIR]     (needs Playwright with Chromium, ffmpeg, npm ci done)

It prints the peak of each part of the script and the left/right balance; a sound missing from a version prints -180.
"""
import argparse, asyncio, base64, functools, http.server, os, shutil, subprocess, tempfile, threading, wave
import numpy as np
from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SR = 44100
PAGE = """<!doctype html><meta charset="utf-8"><title>sound preview</title><script>
const DUR = Number(new URLSearchParams(location.search).get("dur") || 26);
class FakeAC extends OfflineAudioContext { constructor() { super(2, Math.ceil(44100 * DUR), 44100); window.__ctx = this; } get state() { return "running"; } }
window.AudioContext = FakeAC; window.webkitAudioContext = FakeAC;
</script>"""

def script():
    ev = []
    def at(t, name, delay=0, opt=None): ev.append([round(t, 3), name, delay, opt or {}])
    cp = lambda to: {"from": min(0.75, to + 0.35), "to": to}
    def deal(t, pans, step=(0, 75, 150, 225)):            # player, dealer, player, hole: 75 ms apart at Normal
        for i, p in enumerate(pans): at(t, "card", step[i], {"fly": 0.34, "pan": cp(p)})
    card = lambda t, p: at(t, "card", 0, {"fly": 0.34, "pan": cp(p)})
    at(0.3, "shuffle")
    at(2.7, "chip", 0, {"pan": -0.1}); deal(3.1, [-0.15, -0.35, -0.05, -0.25]); card(4.6, 0.05)
    card(5.6, -0.25); card(6.02, -0.15); at(6.4, "pay", 480); at(8.6, "collect")
    at(9.3, "chip", 0, {"pan": -0.1}); deal(9.7, [-0.15, -0.35, -0.05, -0.25])
    card(11.3, -0.25); card(11.72, -0.15); card(12.14, -0.05); at(12.5, "take", 480); at(14.2, "collect")
    at(14.9, "chip", 0, {"pan": -0.1}); at(14.9, "chip", 260, {"pan": -0.1}); deal(15.3, [-0.15, -0.35, -0.05, -0.25])
    at(16.1, "pay", 480, {"big": True}); at(17.8, "collect")
    for k, t in enumerate([19.0, 21.0, 23.0]):
        if k: at(t - 0.2, "collect", 0, {"soft": True})
        deal(t, [-0.25, -0.1, 0.12, 0.27], (0, 70, 140, 210))
    return ev, 25.5

async def render(dirname, port, names, out):
    ev, dur = script()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name in names:
            pg = await b.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
            await pg.goto(f"http://127.0.0.1:{port}/preview.html?dur={dur}")
            await pg.add_script_tag(url=f"http://127.0.0.1:{port}/{name}.js")
            data = await pg.evaluate("""async (events) => {
              try { localStorage.removeItem("bj:bj-sound-v1"); } catch (_) {}
              await SND.soundReady(); const ctx = window.__ctx;
              const times = [...new Set(events.map(e => e[0]))].sort((a, b) => a - b);
              for (const t of times) ctx.suspend(t).then(() => { for (const e of events) if (e[0] === t) SND.sfx(e[1], e[2], e[3]); ctx.resume(); });
              const buf = await ctx.startRendering(); const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length, o = new Int16Array(n * 2);
              for (let i = 0; i < n; i++) { o[2 * i] = Math.max(-1, Math.min(1, L[i])) * 32767; o[2 * i + 1] = Math.max(-1, Math.min(1, R[i])) * 32767; }
              let s = ""; const u = new Uint8Array(o.buffer); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
              return btoa(s);
            }""", ev)
            pcm = base64.b64decode(data); wav = os.path.join(dirname, name + ".wav")
            w = wave.open(wav, "wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm); w.close()
            x = np.frombuffer(pcm, dtype=np.int16).reshape(-1, 2).astype(float) / 32768
            pk = lambda a, z: 20 * np.log10(np.abs(x[int(a * SR):int(z * SR)]).max() + 1e-9)
            bal = 20 * np.log10((np.sqrt((x[:, 0] ** 2).mean()) + 1e-9) / (np.sqrt((x[:, 1] ** 2).mean()) + 1e-9))
            print(f"{name:6s} peaks dB: shuffle {pk(0.3, 2.4):.1f}  deal {pk(2.6, 4.4):.1f}  pay {pk(6.8, 7.6):.1f}  collect {pk(8.5, 9.2):.1f}  take {pk(12.9, 13.6):.1f}  train {pk(18.7, 25):.1f}  left/right {bal:+.1f} dB  {errs or ''}")
            mp3 = os.path.join(out, f"table-sounds-{'after' if name == 'new' else 'before'}.mp3")
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-c:a", "libmp3lame", "-b:a", "192k", mp3], check=True)
            print("  wrote", mp3); await pg.close()
        await b.close()

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--before", action="store_true"); ap.add_argument("--out", default=os.getcwd()); a = ap.parse_args()
    esb = os.path.join(ROOT, "node_modules", ".bin", "esbuild")
    with tempfile.TemporaryDirectory() as d:
        open(os.path.join(d, "preview.html"), "w").write(PAGE)
        subprocess.run([esb, os.path.join(ROOT, "src", "sound.js"), "--bundle", "--format=iife", "--global-name=SND", "--outfile=" + os.path.join(d, "new.js"), "--log-level=warning"], check=True)
        names = ["new"]
        if a.before:
            os.makedirs(os.path.join(d, "old", "src"))
            for f in ("sound.js", "sound-data.js"):
                open(os.path.join(d, "old", "src", f), "wb").write(subprocess.run(["git", "-C", ROOT, "show", "HEAD:src/" + f], capture_output=True, check=True).stdout)
            subprocess.run([esb, os.path.join(d, "old", "src", "sound.js"), "--bundle", "--format=iife", "--global-name=SND", "--outfile=" + os.path.join(d, "old.js"), "--log-level=warning"], check=True)
            names.insert(0, "old")
        class Quiet(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *x): pass
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=d))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try: asyncio.run(render(d, srv.server_address[1], names, os.path.abspath(a.out)))
        finally: srv.shutdown()

if __name__ == "__main__":
    main()
