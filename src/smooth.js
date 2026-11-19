// Soft gradients drawn a pixel at a time, with dither — because Safari draws a CSS gradient in flat bands.
//
// A screen has 256 levels of each colour. A soft glow on a dark surface crosses only a handful of them, so a browser
// that just rounds each pixel to the nearest level draws it as flat bands with edges you can see (rings round a glow,
// stripes down a fade). Chrome hides this by dithering its gradients; Safari doesn't. Laying noise over the finished
// picture doesn't help either: the bands are already there, and fine noise averages out to the eye and leaves them.
// The cure is to add the noise BEFORE rounding — then each small patch averages to the true colour and there is no
// band to see. CSS can't do that, so the three soft gradients the dark themes keep are painted here:
//   1. the page's glow          a fixed canvas behind the content (.glowbg), one canvas pixel per screen pixel,
//                               drawn as the page colour with the light added (it sits straight on the page colour)
//   2. the light under the pointer   a picture in --plight, used by .card::after (desktop only)
//   3. the table felt           a picture in --feltimg, stretched over every .felt
// Every other dark surface is a flat colour (a flat colour can't band). Light themes keep their CSS gradients: steps
// of one level are far too small to see on a bright surface.

const root = () => document.documentElement;
const cssVar = (n) => getComputedStyle(root()).getPropertyValue(n).trim();
const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const trip = (s) => { const a = String(s || "").split(",").map((x) => parseFloat(x)); return a.length === 3 && a.every((x) => x === x) ? a : null; };
const isLight = () => root().getAttribute("data-theme") === "light";

// a glow fades on a cosine: flat at the centre and flat where it ends, so it has no rim
const EASE = (() => { const a = new Float32Array(1026); for (let i = 0; i < 1026; i++) a[i] = i >= 1024 ? 0 : Math.cos((Math.PI * i) / 2048) ** 2; return a; })();
// quick random numbers from 0 to 1 (the dither); seeded, so a repaint gives the same picture
const rand = (seed) => { let s = seed | 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };   // mulberry32: a plainer generator left faint streaks
// round v to a whole level, with the dither added first. Above one level the noise is triangular (two throws), which
// survives a little blur; below it a single throw, so empty space stays empty.
const dith = (v, r) => (v <= 0 ? 0 : v < 1 ? (v + r() >= 1 ? 1 : 0) : Math.floor(v + r() - r() + 0.5));

// Runs row(y) for every row a few milliseconds at a time, so painting never holds up a tap or an animation; then done().
// Returns a function that stops it.
function inSlices(h, rowsPerSlice, row, done) {
  let y = 0, dead = false;
  const slice = () => { if (dead) return; const stop = Math.min(h, y + rowsPerSlice); for (; y < stop; y++) row(y); if (y < h) setTimeout(slice, 0); else done(); };
  setTimeout(slice, 0);
  return () => { dead = true; };
}

// ---- 1. the page's glow -------------------------------------------------------------------------------------
// What used to be three CSS gradients on the page: the lift of the theme's "velvet" colour at the top, and two faint
// washes of the accent colour in the top corners.
function glowPlan() {
  const vw = window.innerWidth, vh = window.innerHeight, wide = vw >= 1024, left = wide ? 248 : 0;   // desktop: the glow starts where the sidebar ends
  const W = Math.max(1, vw - left), H = Math.round(Math.min(wide ? 720 : 560, Math.max(380, vh * (wide ? 0.8 : 0.68))));
  const bg = hex(cssVar("--bg")) || [7, 9, 10], vl = hex(cssVar("--velvet-l")) || [20, 32, 36], acc = trip(cssVar("--acc")) || [52, 211, 153];
  // the velvet lift as a light laid over the background: the palest colour on the line from bg through velvet-l,
  // at the opacity that gives exactly velvet-l at the centre
  const d = vl.map((v, i) => v - bg[i]); let k = Infinity; d.forEach((x, i) => { if (x > 0) k = Math.min(k, (255 - bg[i]) / x); });
  const lift = k === Infinity ? null : { c: bg.map((b, i) => Math.max(0, Math.min(255, b + k * d[i]))), a: 1 / k, x: W / 2, y: -0.05 * H, rx: (wide ? 0.72 : 1.05) * W, ry: 1.05 * H, p: 1.35 };
  const layers = wide
    ? [lift, { c: acc, a: 0.085, x: W - 170, y: 40, rx: 720, ry: 440, p: 1 }, { c: acc, a: 0.035, x: 0.22 * vw - left, y: -120, rx: 620, ry: 360, p: 1 }]
    : [lift, { c: acc, a: 0.1, x: 0.96 * W, y: -70, rx: 440, ry: 280, p: 1 }, { c: acc, a: 0.05, x: -0.06 * W, y: -40, rx: 350, ry: 220, p: 1 }];
  const dpr = window.devicePixelRatio || 1, s = Math.min(dpr, 3, Math.sqrt(4.2e6 / (W * H)));       // one canvas pixel per screen pixel, within a budget
  return { left, W, H, w: Math.max(1, Math.round(W * s)), h: Math.max(1, Math.round(H * s)), s, bg, layers: layers.filter(Boolean) };
}

// Paints the glow; returns a function that stops it.
function paintGlow(canvas) {
  const P = glowPlan(), { w, h, s, layers, bg } = P, img = new ImageData(w, h), px = img.data, r = rand(21);
  const L = layers.map((l) => ({ ...l, x: l.x * s, y: l.y * s, irx: 1 / (l.rx * s), iry: 1 / (l.ry * s) }));
  return inSlices(h, Math.max(8, Math.floor(160000 / w)), (y) => {
    let o = y * w * 4;
    for (let x = 0; x < w; x++, o += 4) {
      let A = 0, R = 0, G = 0, B = 0;
      for (let i = 0; i < L.length; i++) {
        const l = L[i], dx = (x - l.x) * l.irx, dy = (y - l.y) * l.iry, t2 = dx * dx + dy * dy;
        if (t2 >= 1) continue;
        let e = EASE[(Math.sqrt(t2) * 1024) | 0]; if (l.p !== 1) e = Math.pow(e, l.p);
        const a = l.a * e, k = 1 - a;
        R = R * k + l.c[0] * a; G = G * k + l.c[1] * a; B = B * k + l.c[2] * a; A = A * k + a;
      }
      if (A <= 0) continue;
      // Written as a solid colour: the page colour with the light already added, each channel dithered. (A see-through
      // pixel would be stored multiplied by its opacity, which rounds away most of the colour and leaves faint streaks.)
      const dr = R - A * bg[0], dg = G - A * bg[1], db = B - A * bg[2];
      px[o] = bg[0] + (dr >= 0 ? dith(dr, r) : -dith(-dr, r)); px[o + 1] = bg[1] + (dg >= 0 ? dith(dg, r) : -dith(-dg, r)); px[o + 2] = bg[2] + (db >= 0 ? dith(db, r) : -dith(-db, r)); px[o + 3] = 255;
    }
  }, () => {
    canvas.width = w; canvas.height = h;
    canvas.style.left = P.left + "px"; canvas.style.width = P.W + "px"; canvas.style.height = P.H + "px";
    canvas.getContext("2d").putImageData(img, 0, 0);
    canvas.classList.add("on");
  });
}

// ---- pictures handed to CSS through a variable ----------------------------------------------------------------
const urls = {};
function setPicture(name, canvas) {
  const put = (blob) => { if (!blob) return; const u = URL.createObjectURL(blob), old = urls[name]; urls[name] = u; root().style.setProperty(name, 'url("' + u + '")'); if (old) setTimeout(() => URL.revokeObjectURL(old), 4000); };
  if (canvas.toBlob) canvas.toBlob(put, "image/png"); else root().style.setProperty(name, 'url("' + canvas.toDataURL("image/png") + '")');
}

// ---- 2. the light under the pointer ---------------------------------------------------------------------------
export const LIGHT_R = 300;                    // its radius in CSS pixels; the .card::after rule is sized to match
function paintLight() {
  const light = isLight(), c = light ? trip(cssVar("--acc")) || [30, 63, 168] : [255, 255, 255], peak = (light ? 0.042 : 0.036) * 255;
  const s = Math.min(window.devicePixelRatio || 1, 2), n = Math.round(2 * LIGHT_R * s), cv = document.createElement("canvas"); cv.width = cv.height = n;
  const img = new ImageData(n, n), px = img.data, r = rand(7), m = (n - 1) / 2, ir = 1 / (LIGHT_R * s);
  return inSlices(n, Math.max(8, Math.floor(200000 / n)), (y) => {
    let o = y * n * 4; const dy = (y - m) * ir, dy2 = dy * dy;
    for (let x = 0; x < n; x++, o += 4) {
      const dx = (x - m) * ir, t2 = dx * dx + dy2; if (t2 >= 1) continue;
      const q = dith(peak * EASE[(Math.sqrt(t2) * 1024) | 0], r); if (!q) continue;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = q;
    }
  }, () => { cv.getContext("2d").putImageData(img, 0, 0); setPicture("--plight", cv); });
}

// ---- 3. the table felt ------------------------------------------------------------------------------------------
// The same shape as the CSS it replaces: radial-gradient(120% 90% at 50% 0%, felt1, felt2 60%, felt3). The picture is
// stretched over each felt, whatever its size; it is drawn large so that is nearly always a shrink.
function paintFelt() {
  const f = [hex(cssVar("--felt1")), hex(cssVar("--felt2")), hex(cssVar("--felt3"))]; if (f.some((x) => !x)) return () => {};
  const w = 1100, h = 720, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const img = new ImageData(w, h), px = img.data, r = rand(3), irx = 1 / (1.2 * w), iry = 1 / (0.9 * h);
  return inSlices(h, 110, (y) => {
    let o = y * w * 4; const dy = y * iry, dy2 = dy * dy;
    for (let x = 0; x < w; x++, o += 4) {
      const dx = (x - w / 2) * irx; let t = Math.sqrt(dx * dx + dy2); if (t > 1) t = 1;
      const a = t < 0.6 ? f[0] : f[1], b = t < 0.6 ? f[1] : f[2], u = t < 0.6 ? t / 0.6 : (t - 0.6) / 0.4, n = r() - r() + 0.5;   // one throw of the dither for the pixel
      px[o] = Math.floor(a[0] + (b[0] - a[0]) * u + n); px[o + 1] = Math.floor(a[1] + (b[1] - a[1]) * u + n); px[o + 2] = Math.floor(a[2] + (b[2] - a[2]) * u + n); px[o + 3] = 255;
    }
  }, () => { cv.getContext("2d").putImageData(img, 0, 0); setPicture("--feltimg", cv); });
}

// ---- 4. the nap of the felt ------------------------------------------------------------------------------------
// A small tile of fine light and dark specks, laid over every felt and repeated: the cloth's nap. It is the same in
// every theme (only its strength is set in the css), so it is painted once.
function paintGrain() {
  const n = 160, cv = document.createElement("canvas"); cv.width = n; cv.height = n;
  const img = new ImageData(n, n), px = img.data, r = rand(11);
  for (let o = 0; o < n * n * 4; o += 4) { const v = r() + r() - 1, c = v > 0 ? 255 : 0; px[o] = c; px[o + 1] = c; px[o + 2] = c; px[o + 3] = Math.round(Math.abs(v) * 26); }
  cv.getContext("2d").putImageData(img, 0, 0); setPicture("--feltgrain", cv);
}

// ---- keeping them up to date ----------------------------------------------------------------------------------
// Call once with the glow canvas. Repaints when the theme changes (the "bj-theme" event) and when the window's width
// changes; a phone's toolbars sliding in and out change only the height, and are ignored.
export function startSmooth(canvas) {
  if (typeof document === "undefined" || typeof ImageData === "undefined") return () => {};
  let stop = null, stopF = null, stopL = null, timer = 0, t2 = 0, seen = null;
  const pointer = typeof matchMedia !== "undefined" && matchMedia("(hover:hover) and (min-width:1024px)").matches;
  const glow = () => { try { if (stop) stop(); stop = null; if (!canvas) return; if (isLight()) { canvas.classList.remove("on"); return; } stop = paintGlow(canvas); } catch (_) {} };
  const pictures = (wait) => { clearTimeout(timer); clearTimeout(t2);
    timer = setTimeout(() => { try { if (stopF) stopF(); stopF = paintFelt(); } catch (_) {} }, wait);
    t2 = setTimeout(() => { try { if (stopL) stopL(); if (pointer) stopL = paintLight(); } catch (_) {} }, wait + 350); };
  const size = () => ({ w: window.innerWidth, h: window.innerHeight, d: window.devicePixelRatio || 1 });
  // a new theme: drop the old pictures at once (the CSS gradients stand in for a moment), then paint the new ones
  const onTheme = () => { try { root().style.removeProperty("--feltimg"); root().style.removeProperty("--plight"); } catch (_) {} if (canvas) canvas.classList.remove("on"); glow(); pictures(40); };
  let rz = 0;
  const onResize = () => { clearTimeout(rz); rz = setTimeout(() => { const k = size(); if (k.w !== seen.w || k.d !== seen.d || Math.abs(k.h - seen.h) > 200) { seen = k; glow(); } }, 220); };
  seen = size(); glow(); pictures(500);
  setTimeout(() => { try { paintGrain(); } catch (_) {} }, 900);
  window.addEventListener("bj-theme", onTheme); window.addEventListener("resize", onResize);
  return () => { clearTimeout(timer); clearTimeout(t2); clearTimeout(rz); if (stop) stop(); if (stopF) stopF(); if (stopL) stopL(); window.removeEventListener("bj-theme", onTheme); window.removeEventListener("resize", onResize); };
}
