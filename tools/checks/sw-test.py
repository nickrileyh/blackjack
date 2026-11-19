import os, shutil, subprocess, time, re, sys
from playwright.sync_api import sync_playwright
# Checks sw.js and the app's update flow against a local web server, in Chromium (needs: pip install playwright,
# playwright install chromium). Run it after touching sw.js, the update code in src/entry.jsx, or the update pill in
# App: python3 tools/checks/sw-test.py   (about two minutes; every line should start with "ok")
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); SITE = "/tmp/bj-sw-site"; PORT = 8765
os.makedirs(SITE, exist_ok=True)
def deploy(index=None, sw=None, stamp=None):
    if index is not None:
        t = index
        if stamp: t = re.sub(r'(<meta name="bj-build" content=")[^"]+', r'\g<1>' + stamp, t) if 'bj-build' in t else t.replace('</head>', '<!-- ' + stamp + ' --></head>', 1)
        open(SITE + "/index.html", "w").write(t)
    if sw is not None: open(SITE + "/sw.js", "w").write(sw)
    now = time.time() + deploy.n * 5; deploy.n += 1
    for f in ("index.html", "sw.js"): os.utime(SITE + "/" + f, (now, now))
deploy.n = 1
for f in ("icon-192.png", "apple-touch-icon.png", "icon.svg", "manifest.json"): shutil.copy(REPO + "/" + f, SITE)
NEW_INDEX = open(REPO + "/index.html").read(); NEW_SW = open(REPO + "/sw.js").read()
VER = int(re.search(r'bj-v(\d+)', NEW_SW).group(1)); bump = lambda t, k: t.replace(f"bj-v{VER}", f"bj-v{VER + k}")
# the worker the app had before this one (network first, then the cache), to check the hand-over from it
LEGACY_SW = """const CACHE = "bj-v107";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html", "./icon-192.png?v=3", "./apple-touch-icon.png?v=3", "./icon.svg?v=3"]))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match("./index.html"))));
});
"""
def server(): return subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
URL = f"http://127.0.0.1:{PORT}/index.html"
stamp = lambda pg: pg.evaluate("(document.querySelector('meta[name=bj-build]')||{}).content || null")
pill = lambda pg: pg.evaluate("[...document.querySelectorAll('.syncpill')].map(e => e.textContent)")
ok = lambda name, cond, info="": print(("ok   " if cond else "FAIL ") + name, "" if cond else info)
with sync_playwright() as p:
    srv = server(); time.sleep(1)
    b = p.chromium.launch()
    def fresh_ctx():
        c = b.new_context(viewport={"width": 390, "height": 844}); pg = c.new_page(); pg.navs = 0
        pg.on("framenavigated", lambda f: setattr(pg, "navs", pg.navs + 1) if f == pg.main_frame else None)
        pg.errs = []; pg.on("pageerror", lambda e: pg.errs.append(str(e))); return c, pg
    # ---- A. new install
    deploy(NEW_INDEX, NEW_SW, "aaaa00000001")
    c, pg = fresh_ctx(); pg.goto(URL); pg.wait_for_timeout(4000)
    ok("A first visit: one load, no pill", pg.navs == 1 and not pill(pg), (pg.navs, pill(pg)))
    ok("A controlled by the worker", pg.evaluate("!!navigator.serviceWorker.controller"))
    pg.reload(); pg.wait_for_timeout(3500)
    ok("A reload: still one version, no pill, no extra reload", stamp(pg) == "aaaa00000001" and not pill(pg) and pg.navs == 2, (stamp(pg), pill(pg), pg.navs))
    # ---- B. offline
    srv.terminate(); srv.wait(); time.sleep(.5)
    pg.reload(); pg.wait_for_timeout(3000)
    ok("B offline: opens from the saved copy", stamp(pg) == "aaaa00000001" and pg.evaluate("!!document.querySelector('.shell')"), stamp(pg))
    srv = server(); time.sleep(1)
    # ---- C. index changed, worker not bumped: untouched launch restarts itself once
    deploy(NEW_INDEX, None, "bbbb00000002"); n0 = pg.navs
    pg.reload(); pg.wait_for_timeout(6000)
    ok("C new index, untouched: restarted onto it once", stamp(pg) == "bbbb00000002" and pg.navs == n0 + 2, (stamp(pg), pg.navs - n0))
    ok("C no splash the second time, no pill", pg.evaluate("!document.querySelector('.splash')") and not pill(pg), pill(pg))
    # ---- D. index changed while the app is open and in use: a pill, and a tap loads it
    pg.wait_for_timeout(9000); pg.mouse.click(200, 300)
    deploy(NEW_INDEX, None, "cccc00000003"); n0 = pg.navs
    pg.evaluate("fetch('./index.html', { cache: 'no-cache' })"); pg.wait_for_timeout(2500)
    ok("D open app: pill offered, no reload", any("New version" in x for x in pill(pg)) and pg.navs == n0 and stamp(pg) == "bbbb00000002", (pill(pg), pg.navs - n0))
    pg.locator(".syncpill").click(); pg.wait_for_timeout(4000)
    ok("D tap: new version, no pill", stamp(pg) == "cccc00000003" and not pill(pg), (stamp(pg), pill(pg)))
    # ---- E. worker bumped with a new index: touched early -> pill; then untouched launch -> restart
    deploy(NEW_INDEX, bump(NEW_SW, 1), "dddd00000004"); n0 = pg.navs
    pg.reload(); pg.mouse.click(200, 300); pg.wait_for_timeout(6000)
    ok("E bump, touched: pill, old version still showing", any("New version" in x for x in pill(pg)) and stamp(pg) == "cccc00000003" and pg.navs == n0 + 1, (pill(pg), stamp(pg), pg.navs - n0))
    pg.locator(".syncpill").click(); pg.wait_for_timeout(4000)
    ok("E tap: new version", stamp(pg) == "dddd00000004" and not pill(pg), stamp(pg))
    ok("E old cache deleted", pg.evaluate("caches.keys()") == [f"bj-v{VER + 1}"], pg.evaluate("caches.keys()"))
    pg.wait_for_timeout(61000)
    deploy(NEW_INDEX, bump(NEW_SW, 2), "eeee00000005"); n0 = pg.navs
    pg.reload(); pg.wait_for_timeout(7000)
    ok("E bump, untouched: restarted once onto it", stamp(pg) == "eeee00000005" and pg.navs == n0 + 2 and not pill(pg), (stamp(pg), pg.navs - n0, pill(pg)))
    ok("no page errors", not pg.errs, pg.errs[:3]); c.close()
    # ---- F. someone on the old worker (network first) meets the new one: no pill, no extra reload
    deploy(NEW_INDEX, LEGACY_SW, "0000000legacy")
    c, pg = fresh_ctx(); pg.goto(URL); pg.wait_for_timeout(4000)
    ok("F old worker in control", pg.evaluate("!!navigator.serviceWorker.controller"))
    deploy(NEW_INDEX, NEW_SW, "ffff00000006"); n0 = pg.navs
    pg.reload(); pg.wait_for_timeout(7000)
    ok("F old -> new: one load, the new version, no pill", stamp(pg) == "ffff00000006" and pg.navs == n0 + 1 and not pill(pg), (stamp(pg), pg.navs - n0, pill(pg)))
    pg.reload(); pg.wait_for_timeout(4000)
    ok("F next open: same, no pill, one load", stamp(pg) == "ffff00000006" and pg.navs == n0 + 2 and not pill(pg), (stamp(pg), pg.navs - n0, pill(pg)))
    ok("F caches", pg.evaluate("caches.keys()") == [f"bj-v{VER}"], pg.evaluate("caches.keys()"))
    ok("no page errors", not pg.errs, pg.errs[:3])
    b.close(); srv.terminate()
