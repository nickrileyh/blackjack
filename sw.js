const CACHE = "bj-v117";
// The app opens from this device's saved copy at once, with or without a connection, and the newest version is fetched
// behind it. When a newer one has been saved, the open app is told its build stamp (the bj-build meta tag build.sh
// writes into index.html); the app compares it with its own and offers the update, so nothing is announced by mistake.
const PAGE = "./index.html";
const CORE = [PAGE, "./icon-192.png?v=3", "./apple-touch-icon.png?v=3", "./icon.svg?v=3"];
const tagOf = (r) => { const t = r && (r.headers.get("etag") || r.headers.get("last-modified") || r.headers.get("content-length")); return t ? t.replace(/^W\//, "") : null; };
const stampOf = (r) => r.clone().text().then((t) => { const m = /<meta name="bj-build" content="([^"]+)"/.exec(t); return m ? m[1] : null; }).catch(() => null);
const tell = (build) => build ? self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ type: "bj-update", build }))) : null;
self.addEventListener("install", (e) => {
  // "reload" skips the browser's own ten-minute copy, so a new version is saved as the new version
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: "reload" })))));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    const hit = await caches.match(PAGE);
    if (hit) await tell(await stampOf(hit));
  })());
});
async function page(e) {
  const c = await caches.open(CACHE), hit = await c.match(PAGE);
  // "no-cache" asks the server whether the copy is still current: a few hundred bytes when nothing changed
  const fresh = fetch(PAGE, { cache: "no-cache" }).then(async (r) => {
    if (!r.ok || r.redirected) return r;
    const changed = !hit || tagOf(hit) !== tagOf(r);
    if (changed) { await c.put(PAGE, r.clone()); if (hit) await tell(await stampOf(r)); }
    return r;
  });
  if (!hit) return fresh;
  e.waitUntil(fresh.catch(() => {}));
  return hit;
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch sync traffic to GitHub
  if (req.mode === "navigate" || /\/index\.html$/.test(url.pathname)) { e.respondWith(page(e)); return; }
  e.respondWith(caches.match(req).then((m) => m || fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; })));
});
