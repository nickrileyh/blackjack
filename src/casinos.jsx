// The Casinos page: a built-in map of every casino you've played or might play, with your own scouting notes.
// Lives in its own file (with casino-map.js and casino-data.js) so work here doesn't collide with app.jsx.
// Shared controls come from app.jsx; they are only touched inside components, never while this file loads.
import { useState, useMemo, useEffect, useRef, memo } from "react";
import { Sheet, Seg, ChipRow, ConfirmLink, More, Fold, rulesShort, dasOn, dblRule, maxHandsOf, SESS_KEY, casinoKey, dateShort, localDay, sgnMoney, fmtH, useNav } from "./app.jsx";
import { unpack, albersUsa, azimuthal, regionMap, countryMap, fitBox, regionAt } from "./casino-map.js";
import { GEO_US, GEO_CA, GEO_WORLD, CASINO_ROWS, CASINO_INTEL } from "./casino-data.js";
import { TableScoreCard, useCasinoScores, scoreTone, milesBetween } from "./planner.jsx";

export const CAS_KEY = "bj-casinos-v1"; // your marks and your own casinos — backed up and synced
const CAS_UI_KEY = "bj-casinos-ui"; // which country you were looking at — this device only

// ---------- data: parsed the first time the page opens, then kept ----------
let _base = null;
function baseData() {
  if (_base) return _base;
  const list = CASINO_ROWS.split("\n").map((l) => { const [id, name, city, st, lat, lon] = l.split("|"); return { id, name, city, st, cc: id.startsWith("us-") ? "USA" : "CAN", lat: +lat, lon: +lon }; });
  let intel = {}; try { intel = JSON.parse(CASINO_INTEL); } catch (_) {}
  return (_base = { list, intel });
}
const _geo = {}, _maps = {};
const geoOf = (k) => _geo[k] || (_geo[k] = unpack(JSON.parse(k === "US" ? GEO_US : k === "CA" ? GEO_CA : GEO_WORLD)));
// one drawn map per country: the US and Canada come with states and provinces, everything else is the country's outline
function mapFor(cc) {
  if (_maps[cc]) return _maps[cc];
  let m;
  if (cc === "USA") { m = regionMap(geoOf("US"), albersUsa(), true); m.kmu = 5.95; m.geo = geoOf("US"); }
  else if (cc === "CAN") { m = regionMap(geoOf("CA"), azimuthal(-96, 61), false); m.kmu = 6.37; m.geo = geoOf("CA"); }
  else { m = countryMap(geoOf("W"), cc) || countryMap(geoOf("W"), "USA"); m.kmu = 6.37; m.geo = null; }
  m.hasRegions = !!m.geo; m.names = {}; m.regions.forEach((r) => (m.names[r.id] = r.n));
  return (_maps[cc] = m);
}
let _countries = null;
const countries = () => _countries || (_countries = geoOf("W").feats.map((f) => ({ id: f.id, n: f.n })).sort((a, b) => a.n.localeCompare(b.n)));
const countryName = (cc) => (countries().find((c) => c.id === cc) || {}).n || cc;

// The first visit to this page used to stall while the casino list and the map outlines were unpacked (about a fifth of
// a second on a phone). The app now does that work in three small pieces a few seconds after it opens, while nothing
// is moving, so the page opens as quickly the first time as every time after.
export function warmCasinos() {
  const steps = [() => baseData(), () => geoOf("US"), () => mapFor("USA")]; let i = 0;
  const next = () => { try { steps[i++](); } catch (_) {} if (i < steps.length) setTimeout(next, 350); };
  setTimeout(next, 0);
}

// ---------- matching the names typed into the session log to casinos on the map ----------
const STOP = new Set(["casino", "casinos", "hotel", "resort", "resorts", "the", "and", "at", "of", "spa", "racetrack", "gaming"]);
const tokens = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w && !STOP.has(w));
const lower = (s) => String(s || "").trim().toLowerCase();
// which casino does each name in the session log mean? an explicit link wins, then an exact name, then a name whose
// words all appear in exactly one casino ("greektown", "the meadows", "jack")
function linkSessions(sessions, all) {
  const names = new Map(); // lowercased session name → { name, list }
  sessions.forEach((s) => { const k = casinoKey(s); if (k === "—") return; const o = names.get(k) || { name: (s.where || "").trim(), list: [] }; o.list.push(s); names.set(k, o); });
  const aka = new Map(), exact = new Map(), toks = all.map((c) => [c, new Set(tokens(c.name))]);
  all.forEach((c) => { ((c.mark && c.mark.aka) || []).forEach((a) => aka.set(lower(a), c)); const k = tokens(c.name).join(" "); if (k) exact.set(k, exact.has(k) ? null : c); });
  const by = new Map(), loose = [];
  names.forEach((o, k) => {
    const t = tokens(o.name); let hit = aka.get(k) || (t.length ? exact.get(t.join(" ")) : null) || null;
    if (!hit && t.length) { const c = toks.filter(([, set]) => t.every((w) => set.has(w))); if (c.length === 1) hit = c[0][0]; }
    if (!hit) { loose.push({ key: k, name: o.name, n: o.list.length }); return; }
    const st = by.get(hit.id) || { n: 0, h: 0, net: 0, last: "", backed: null, watched: false, dates: [], recs: [], lastHeat: null };
    o.list.forEach((s) => { st.n++; st.h += +s.hours || 0; st.net += +s.result || 0; st.dates.push(s.date); st.recs.push({ date: s.date, h: +s.hours || 0 }); if (s.date >= st.last) { st.last = s.date; st.lastHeat = s.heat || null; } if (s.heat === "backed") { st.backedN = (st.backedN || 0) + 1; if (!st.backed || s.date > st.backed) st.backed = s.date; } if (s.heat === "watched") st.watched = true; });
    by.set(hit.id, st);
  });
  return { by, loose: loose.sort((a, b) => b.n - a.n) };
}
const statusOf = (c) => ((c.mark && c.mark.status === "backed") || (c.sess && c.sess.backed) ? "backed" : (c.mark && c.mark.status === "been") || (c.sess && c.sess.n) ? "been" : "none");
const hasNotes = (m) => !!(m && (m.heat || (m.games && m.games.length) || (m.notes && m.notes.trim())));
const HEATS = [[1, "Low"], [2, "Medium"], [3, "High"]];
const gameLine = (g) => [g.rules ? rulesShort(g.rules) : null, g.min || g.max ? `$${g.min || "?"}–${g.max ? "$" + g.max : "?"}` : null, g.tables ? `${g.tables} table${+g.tables === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
const mapsUrl = (c) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([c.name, c.city, c.st].filter(Boolean).join(", "));
const reduceMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; } };

const casCss = `
.cmap{position:relative;aspect-ratio:4/3;background:var(--recess);overflow:hidden;user-select:none;-webkit-user-select:none;cursor:grab;outline:none;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.cmap.drag{cursor:grabbing}.cmap.placing{cursor:crosshair}
.cmap:focus-visible{box-shadow:inset 0 0 0 2px var(--brass)}
.cmap svg{display:block;width:100%;height:100%}
.cm-land{fill:rgba(var(--fg),.04)}
.cm-reg{fill:rgba(var(--fg),.09);transition:fill .16s var(--ease)}
.cm-reg.on{fill:rgba(var(--acc),.17)}
.cmap.solo .cm-reg{fill:rgba(var(--fg),.12);stroke:rgba(var(--fg),.34);stroke-width:1;vector-effect:non-scaling-stroke}
@media (hover:hover){.cmap.regs:not(.placing) .cm-reg:hover{fill:rgba(var(--fg),.14)}.cmap.regs:not(.placing) .cm-reg.on:hover{fill:rgba(var(--acc),.2)}}
.cm-in{fill:none;stroke:rgba(var(--fg),.17);stroke-width:1;vector-effect:non-scaling-stroke;pointer-events:none}
.cm-out{fill:none;stroke:rgba(var(--fg),.34);stroke-width:1;vector-effect:non-scaling-stroke;pointer-events:none}
.cpin{pointer-events:none;transform:scale(var(--ik))}
.cpin.o{fill:rgba(var(--fg),.46);transform:scale(calc(var(--ik) * var(--ps)))}
.cpin.b{fill:var(--brass);stroke:var(--bg);stroke-width:1.6}
.cpin.x{fill:var(--rose);stroke:var(--bg);stroke-width:1.6}
.cpin.halo{fill:rgba(var(--neg),.2);stroke:rgba(var(--neg),.55);stroke-width:1}
.cpin.pulse{fill:none;stroke:rgba(var(--neg),.6);stroke-width:1.2;animation:cpulse 2.6s ease-out infinite}
.cpin.sel{fill:none;stroke:var(--ivory);stroke-width:1.6}
.cpin.me{fill:var(--ivory);stroke:var(--brass);stroke-width:2.6}
.cpin.meh{fill:rgba(var(--acc),.22);stroke:rgba(var(--acc),.5);stroke-width:1}
.cpinsin{animation:cpinsin .39s var(--ez) .05s backwards}
@keyframes cpinsin{from{opacity:0}}
@keyframes cpulse{0%{transform:scale(calc(var(--ik) * .55));opacity:.9}70%,100%{transform:scale(calc(var(--ik) * 1.5));opacity:0}}
.cm-lab{font:600 11px Inter,system-ui,sans-serif;fill:var(--ivory);paint-order:stroke;stroke:var(--bg);stroke-width:3px;stroke-linejoin:round;pointer-events:none}
.cm-labs{transition:opacity .18s var(--ease)}
.cm-ctl{position:absolute;right:10px;top:10px;display:flex;flex-direction:column;gap:6px}
.cm-btn{width:34px;height:34px;border-radius:999px;display:flex;align-items:center;justify-content:center;color:var(--ivory-d);background:linear-gradient(180deg,rgba(var(--fg),.1),rgba(var(--fg),.04)),rgba(var(--bgrgb),.6);border:1px solid rgba(var(--fg),.12);box-shadow:inset 0 1px 0 var(--gl-hi);backdrop-filter:blur(14px) saturate(1.6);-webkit-backdrop-filter:blur(14px) saturate(1.6);transition:transform .12s var(--ease),color .15s var(--ez),opacity .2s var(--ez)}
.cm-btn:active{transform:scale(.92)}.cm-btn:disabled{opacity:.35}
@media (hover:hover){.cm-btn:hover:not(:disabled){color:var(--ivory)}}
.cm-btn:focus-visible,.crow:focus-visible,.cpick:focus-visible{outline:2px solid var(--brass);outline-offset:2px}
.cm-banner{position:absolute;left:10px;top:10px;right:54px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 8px 8px 12px;border-radius:12px;font-size:12.5px;font-weight:600;color:var(--ivory);background:rgba(var(--bgrgb),.9);border:1px solid rgba(var(--acc),.4);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:rise .17s var(--ease) both}
.cm-hint{position:absolute;left:10px;bottom:10px;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:500;color:var(--ivory-d);background:rgba(var(--bgrgb),.72);border:1px solid rgba(var(--fg),.08);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);pointer-events:none}
.cm-scale{position:absolute;right:12px;bottom:11px;display:flex;flex-direction:column;align-items:flex-end;gap:3px;font-size:10px;font-weight:600;color:var(--muted);pointer-events:none}
.cm-scale span{display:block;height:5px;border:1.5px solid rgba(var(--fg),.45);border-top:0;border-radius:0 0 2px 2px}
.cpick{display:flex;align-items:center;gap:7px;height:34px;padding:0 10px 0 13px;border-radius:999px;font-size:13.5px;font-weight:600;color:var(--ivory);background:rgba(var(--fg),.05);border:1px solid rgba(var(--acc),.22);transition:transform .13s var(--ease),background .15s var(--ez);min-width:0}
.cpick:active{transform:scale(.97)}.cpick svg{color:var(--brass);flex:none}
.cdot{flex:none;display:inline-block;width:9px;height:9px;border-radius:50%;box-sizing:border-box;border:1.5px solid rgba(var(--fg),.4)}
.cdot.b{background:var(--brass);border-color:var(--brass)}.cdot.x{background:var(--rose);border-color:var(--rose);box-shadow:0 0 0 3px rgba(var(--neg),.2)}
.crow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:11px;width:100%;text-align:left;padding:10px 4px;border-radius:10px;transition:background .15s var(--ez)}
.crow+.crow{border-top:1px solid rgba(var(--fg),.06)}
.crow:active{background:rgba(var(--fg),.05)}
@media (hover:hover){.crow:hover{background:rgba(var(--fg),.04)}}
.ctag{font-size:10px;font-weight:600;border-radius:999px;padding:1px 7px;white-space:nowrap}
.ctag.x{background:rgba(var(--neg),.18);color:var(--neg-l)}.ctag.b{background:rgba(var(--acc),.15);color:var(--brass)}.ctag.n{background:rgba(var(--fg),.07);color:var(--ivory-d)}
.bj select.in.csel{padding-right:30px;font-size:14px;height:44px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237D8985' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 11px center}
.cbox{border-radius:14px;padding:12px 14px;background:rgba(var(--fg),.035);border:1px solid rgba(var(--fg),.06)}
.cback{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:600;color:var(--brass);margin-bottom:12px}
.clink{color:var(--brass);font-weight:600;text-decoration:underline;text-underline-offset:2px}
@media (min-width:1180px){.cmap{aspect-ratio:16/11}}
@media (prefers-reduced-motion:reduce){.cpin.pulse{animation:none;opacity:0}.cpinsin{animation:none}.cm-banner{animation:none}.cm-reg,.cm-labs,.cm-btn{transition:none}}
`;

// ---------- the map ----------
const MapBase = memo(function MapBase({ map, focus }) {
  return (
    <>
      {map.land && <path className="cm-land" d={map.land} />}
      {map.regions.map((r) => <path key={r.id} className={"cm-reg" + (focus === r.id ? " on" : "")} d={r.d} data-r={r.id} />)}
      {map.inner && <path className="cm-in" d={map.inner} />}
      {map.outer && <path className="cm-out" d={map.outer} />}
    </>
  );
});
const MapPins = memo(function MapPins({ pins, sel, me }) {
  const others = [], been = [], backed = [];
  pins.forEach((p) => (p.kind === "backed" ? backed : p.kind === "been" ? been : others).push(p));
  const at = (p) => `translate(${p.x.toFixed(2)},${p.y.toFixed(2)})`;
  const selP = sel && pins.find((p) => p.id === sel);
  return (
    <>
      {others.map((p) => <g key={p.id} transform={at(p)}><circle className="cpin o" r="1.9" /></g>)}
      {been.map((p) => <g key={p.id} transform={at(p)}><circle className="cpin b" r="5" /></g>)}
      {backed.map((p) => <g key={p.id} transform={at(p)}><circle className="cpin pulse" r="13" /><circle className="cpin halo" r="10.5" /><circle className="cpin x" r="5.5" /></g>)}
      {selP && <g transform={at(selP)}><circle className="cpin sel" r="9.5" /></g>}
      {me && <g transform={at(me)}><circle className="cpin meh" r="11" /><circle className="cpin me" r="4.6" /></g>}
    </>
  );
});
function CasinoMap({ map, pins, me, focus, sel, placing, miles, regionWord, onRegion, onPins, onPlace, onCancelPlace }) {
  const wrap = useRef(null), ptrs = useRef(new Map()), gest = useRef(null), raf = useRef(0), tapped = useRef(null);
  const [size, setSize] = useState(null), [view, setView] = useState(null), [settled, setSettled] = useState(null), [drag, setDrag] = useState(false);
  const vr = useRef(null); vr.current = view;
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const read = () => { const w = el.clientWidth, h = el.clientHeight; if (w > 0 && h > 0) setSize((s) => (s && s.w === w && s.h === h ? s : { w, h })); };
    read(); let ro = null; if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(read); ro.observe(el); } else window.addEventListener("resize", read);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener("resize", read); };
  }, []);
  const fit = useMemo(() => (size ? fitBox(map.box, size.w, size.h, 14) : null), [map, size]);
  const kMax = fit ? Math.max(fit.k * 4, map.kmu / 0.02) : 1; // closest zoom: about 20 m per pixel
  const clamp = (v) => {
    const k = Math.min(kMax, Math.max(fit.k, v.k)); if (k <= fit.k * 1.0005) return { ...fit };
    const cx = Math.min(map.box[2], Math.max(map.box[0], (size.w / 2 - v.x) / k)), cy = Math.min(map.box[3], Math.max(map.box[1], (size.h / 2 - v.y) / k));
    return { k, x: size.w / 2 - cx * k, y: size.h / 2 - cy * k };
  };
  const viewOf = (id) => {
    const r = id && map.regions.find((x) => x.id === id); if (!r || !map.hasRegions) return { ...fit };
    const f = fitBox(r.main, size.w, size.h, 30), k = Math.min(kMax, Math.max(fit.k * 2.2, f.k));
    return clamp({ k, x: size.w / 2 - ((r.main[0] + r.main[2]) / 2) * k, y: size.h / 2 - ((r.main[1] + r.main[3]) / 2) * k });
  };
  const stop = () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; };
  // the app's one curve, cubic-bezier(.05,.7,.1,1): off at full speed, then a long glide to a stop
  const ezOutMap = (p) => { if (p <= 0) return 0; if (p >= 1) return 1; const bx = (t) => 3 * (1 - t) * (1 - t) * t * 0.05 + 3 * (1 - t) * t * t * 0.1 + t * t * t, by = (t) => 3 * (1 - t) * (1 - t) * t * 0.7 + 3 * (1 - t) * t * t + t * t * t; let lo = 0, hi = 1; for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (bx(m) < p) lo = m; else hi = m; } return by((lo + hi) / 2); };
  const animTo = (to) => {
    stop(); const from = vr.current; if (!from || reduceMotion()) { setView(to); return; }
    const c0 = [(size.w / 2 - from.x) / from.k, (size.h / 2 - from.y) / from.k], c1 = [(size.w / 2 - to.x) / to.k, (size.h / 2 - to.y) / to.k], t0 = performance.now(), dur = 520;   // the map zooms the way everything else moves: straight off the mark, easing to a stop
    const step = (now) => {
      const u = Math.min(1, (now - t0) / dur), e = ezOutMap(u);
      const k = from.k * Math.pow(to.k / from.k, e), cx = c0[0] + (c1[0] - c0[0]) * e, cy = c0[1] + (c1[1] - c0[1]) * e;
      setView(u >= 1 ? to : { k, x: size.w / 2 - cx * k, y: size.h / 2 - cy * k });
      raf.current = u < 1 ? requestAnimationFrame(step) : 0;
    };
    raf.current = requestAnimationFrame(step);
  };
  // a new map or a new size starts framed; a change of focused state glides there
  const framed = useRef({});
  useEffect(() => {
    if (!fit) return; const f = framed.current;
    if (f.fit !== fit) {
      const v = vr.current; stop();
      if (f.map === map && f.focus === focus && v) { // same map at a new size (a rotated phone, a scrollbar coming or going): keep looking at the same spot
        const zz = v.k / f.fit.k, cx = (f.w / 2 - v.x) / v.k, cy = (f.h / 2 - v.y) / v.k, k = fit.k * zz;
        setView(zz <= 1.0005 ? { ...fit } : clamp({ k, x: size.w / 2 - cx * k, y: size.h / 2 - cy * k }));
      } else setView(viewOf(focus));
      framed.current = { fit, map, focus, w: size.w, h: size.h }; return;
    }
    f.focus = focus; animTo(viewOf(focus));
  }, [fit, focus]); // eslint-disable-line
  useEffect(() => stop, []);
  useEffect(() => { const t = setTimeout(() => setSettled(view), 150); return () => clearTimeout(t); }, [view]);
  const zoomed = (v) => !!fit && v.k > fit.k * 1.02;
  const zoomAt = (px, py, f, smooth) => { const v = vr.current; if (!v) return; const k = Math.min(kMax, Math.max(fit.k, v.k * f)), ux = (px - v.x) / v.k, uy = (py - v.y) / v.k, to = clamp({ k, x: px - ux * k, y: py - uy * k }); if (smooth) animTo(to); else { stop(); setView(to); } };
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    // pinch on a trackpad (or Ctrl + wheel) always zooms; a plain wheel zooms only once you're zoomed in, so the page still scrolls past the map
    const wheel = (e) => { const v = vr.current; if (!v || !fit) return; if (!(e.ctrlKey || e.metaKey || zoomed(v))) return; e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0024))); };
    el.addEventListener("wheel", wheel, { passive: false }); return () => el.removeEventListener("wheel", wheel);
  }); // eslint-disable-line
  const local = (p) => { const r = wrap.current.getBoundingClientRect(); return { x: p.x - r.left, y: p.y - r.top }; };
  const down = (e) => {
    if (!vr.current || (e.pointerType === "mouse" && e.button !== 0) || (e.target.closest && e.target.closest(".cm-ctl,.cm-banner"))) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { wrap.current.setPointerCapture(e.pointerId); } catch (_) {}
    stop(); const P = [...ptrs.current.values()];
    if (P.length === 1) gest.current = { type: "pan", sx: e.clientX, sy: e.clientY, v0: vr.current, moved: false, touch: e.pointerType !== "mouse" };
    else if (P.length === 2) gest.current = { type: "pinch", d0: Math.max(1, Math.hypot(P[0].x - P[1].x, P[0].y - P[1].y)), m0: local({ x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 }), v0: vr.current, moved: true };
  };
  const move = (e) => {
    if (!ptrs.current.has(e.pointerId)) return; ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gest.current; if (!g) return;
    if (g.type === "pan") {
      const dx = e.clientX - g.sx, dy = e.clientY - g.sy; if (!g.moved && Math.hypot(dx, dy) < 6) return; g.moved = true;
      if (g.touch && !zoomed(g.v0)) return; // on the full view a finger drag scrolls the page; pan once you've zoomed in
      setDrag(true); setView(clamp({ k: g.v0.k, x: g.v0.x + dx, y: g.v0.y + dy }));
    } else {
      const P = [...ptrs.current.values()]; if (P.length < 2) return;
      const d = Math.hypot(P[0].x - P[1].x, P[0].y - P[1].y), m = local({ x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 });
      const k = Math.min(kMax, Math.max(fit.k, (g.v0.k * d) / g.d0)), ux = (g.m0.x - g.v0.x) / g.v0.k, uy = (g.m0.y - g.v0.y) / g.v0.k;
      setDrag(true); setView(clamp({ k, x: m.x - ux * k, y: m.y - uy * k }));
    }
  };
  const tap = (e, pointerType) => {
    const v = vr.current, p = local({ x: e.clientX, y: e.clientY });
    if (placing) { const ll = map.proj.inv((p.x - v.x) / v.k, (p.y - v.y) / v.k); if (ll && isFinite(ll[0] + ll[1])) onPlace(ll[0], ll[1]); return; }
    if (!map.hasRegions || v.k >= fit.k * 1.8) {
      const R = pointerType === "mouse" ? 11 : 20;
      const hits = pins.map((q) => [Math.hypot(q.x * v.k + v.x - p.x, q.y * v.k + v.y - p.y), q]).filter((h) => h[0] <= R).sort((a, b) => a[0] - b[0]);
      if (hits.length) {
        // a crowd under one tap (the Strip from state level): zoom into it rather than list dozens of casinos
        if (hits.length > 5 && v.k < kMax * 0.9) {
          let b = [1e9, 1e9, -1e9, -1e9]; hits.forEach(([, q]) => { b = [Math.min(b[0], q.x), Math.min(b[1], q.y), Math.max(b[2], q.x), Math.max(b[3], q.y)]; });
          const f = fitBox(b, size.w, size.h, 70), k = Math.min(kMax, Math.max(v.k * 3, Math.min(f.k, v.k * 40)));
          animTo(clamp({ k, x: size.w / 2 - ((b[0] + b[2]) / 2) * k, y: size.h / 2 - ((b[1] + b[3]) / 2) * k })); return;
        }
        onPins(hits.filter((h) => h[0] <= hits[0][0] + 9).map((h) => h[1])); return;
      }
    }
    if (map.hasRegions) { const el = document.elementFromPoint(e.clientX, e.clientY), id = el && el.getAttribute && el.getAttribute("data-r"); if (id) onRegion(id); }
  };
  const up = (e) => {
    if (!ptrs.current.delete(e.pointerId)) return; const g = gest.current; if (!g) return;
    if (g.type === "pinch") { const P = [...ptrs.current.values()]; gest.current = P.length === 1 ? { type: "pan", sx: P[0].x, sy: P[0].y, v0: vr.current, moved: true, touch: true } : null; if (!P.length) setDrag(false); return; }
    gest.current = null; setDrag(false);
    // the tap itself is handled on the click that follows: a sheet opened on pointer-up would be closed again by that same click
    if (!g.moved && e.type === "pointerup") tapped.current = { t: Date.now(), type: e.pointerType };
  };
  const click = (e) => { const t = tapped.current; tapped.current = null; if (t && Date.now() - t.t < 900 && vr.current) tap(e, t.type); };
  const key = (e) => {
    if (!fit || !vr.current) return; const v = vr.current, c = [size.w / 2, size.h / 2];
    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomAt(c[0], c[1], 1.8, true); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomAt(c[0], c[1], 1 / 1.8, true); }
    else if (e.key === "0" || e.key === "Escape") { if (placing && e.key === "Escape") onCancelPlace(); else if (focus) onRegion(null); else animTo({ ...fit }); }
    else if (e.key.startsWith("Arrow") && zoomed(v)) { e.preventDefault(); const s = 70, d = { ArrowLeft: [s, 0], ArrowRight: [-s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] }[e.key]; animTo(clamp({ k: v.k, x: v.x + d[0], y: v.y + d[1] })); }
  };
  // names appear beside pins once few enough are in view to read them
  const inView = useRef(0);
  const labels = useMemo(() => {
    if (!settled || !size || !fit) return [];
    const vis = pins.map((p) => ({ p, x: p.x * settled.k + settled.x, y: p.y * settled.k + settled.y })).filter((q) => q.x > 4 && q.x < size.w - 4 && q.y > 12 && q.y < size.h - 6);
    const mine = vis.filter((q) => q.p.kind !== "other"); inView.current = vis.length;
    const pool = vis.length <= 40 ? vis : settled.k > fit.k * 1.8 && mine.length <= 10 ? mine : [];
    const rank = { backed: 0, been: 1, other: 2 }, placed = [[0, size.h - 40, 190, size.h], [size.w - 54, 0, size.w, 136]], out = []; // keep clear of the hint and the zoom buttons
    pool.slice().sort((a, b) => rank[a.p.kind] - rank[b.p.kind] || a.y - b.y).forEach((q) => {
      if (out.length >= 16) return; const w = q.p.name.length * 6.3 + 6, right = q.x + 11 + w < size.w - 4, x0 = right ? q.x + 9 : q.x - 9 - w, box = [x0, q.y - 8, x0 + w, q.y + 7];
      if (x0 < 2 || placed.some((b) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) return;
      placed.push(box); out.push({ id: q.p.id, x: right ? q.x + 10 : q.x - 10, y: q.y + 4, a: right ? "start" : "end", t: q.p.name });
    });
    return out;
  }, [settled, pins, size, fit]);
  const z = view && fit ? view.k / fit.k : 1, isZoomed = z > 1.02;
  const hint = placing || !view ? null : map.hasRegions && z < 1.8 ? `Tap a ${regionWord} to zoom in` : !pins.length ? null : inView.current ? "Tap a pin for details" : "No casinos in view";
  // a scale bar once you're in close, so a blank stretch of map still tells you how far apart things are
  const scale = useMemo(() => {
    if (!view || z < 1.8) return null; const per = (map.kmu / view.k) * (miles ? 0.621371 : 1); // miles or km per pixel
    const n = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].filter((x) => x / per <= 84).pop(); if (!n) return null;
    return { w: n / per, t: `${n === 0.25 ? "¼" : n === 0.5 ? "½" : n} ${miles ? "mi" : "km"}` };
  }, [view, z, map, miles]);
  return (
    <div ref={wrap} className={"cmap" + (map.hasRegions ? " regs" : " solo") + (drag ? " drag" : "") + (placing ? " placing" : "")} tabIndex={0} role="application" aria-label="Casino map. Plus and minus zoom, arrow keys move, 0 shows the whole country. The list below has every casino."
      style={{ touchAction: isZoomed || placing ? "none" : "pan-y" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={click} onKeyDown={key}>
      {size && view && (
        <svg viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
          <g transform={`translate(${view.x.toFixed(2)},${view.y.toFixed(2)}) scale(${view.k})`} style={{ "--ik": 1 / view.k, "--ps": Math.min(2.6, 1 + Math.max(0, Math.log2(z)) * 0.3) }}>
            <MapBase map={map} focus={focus} />
            <g className="cpinsin"><MapPins pins={pins} sel={sel} me={me} /></g>
          </g>
          <g className="cm-labs" style={{ opacity: settled === view ? 1 : 0 }}>{labels.map((l) => <text key={l.id} className="cm-lab" x={l.x} y={l.y} textAnchor={l.a}>{l.t}</text>)}</g>
        </svg>
      )}
      {placing && <div className="cm-banner"><span>Tap where the casino is</span><button onClick={onCancelPlace} className="text-xs font-semibold rounded-full px-3" style={{ height: 28, background: "rgba(var(--fg),.1)", color: "var(--ivory)" }}>Cancel</button></div>}
      <div className="cm-ctl">
        <button className="cm-btn" aria-label="Zoom in" disabled={!view || view.k >= kMax * 0.999} onClick={() => zoomAt(size.w / 2, size.h / 2, 2, true)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
        <button className="cm-btn" aria-label="Zoom out" disabled={!isZoomed} onClick={() => zoomAt(size.w / 2, size.h / 2, 0.5, true)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg></button>
        {(isZoomed || focus) && <button className="cm-btn rise" aria-label="Show the whole country" onClick={() => { if (focus) onRegion(null); else animTo({ ...fit }); }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg></button>}
      </div>
      {hint && <div className="cm-hint">{hint}</div>}
      {scale && !placing && <div className="cm-scale" aria-hidden="true"><span style={{ width: scale.w }} />{scale.t}</div>}
    </div>
  );
}

// ---------- rows and sheets ----------
function CasinoRow({ c, place, onOpen, score, dist }) {
  const st = statusOf(c), m = c.mark || {}, g = (m.games || [])[0];
  const it = c.intel, quick = !g && it ? [it.tablesN ? `${it.tablesN} tables` : null, it.min ? `from $${it.min}` : null].filter(Boolean) : [];
  const sub = [place, g && g.rules ? rulesShort(g.rules) : null, ...quick, m.heat ? `${HEATS[m.heat - 1][1].toLowerCase()} heat` : null].filter(Boolean).join(" · ");
  return (
    <button className="crow" onClick={() => onOpen(c)}>
      <span className={"cdot" + (st === "backed" ? " x" : st === "been" ? " b" : "")} aria-hidden="true" />
      <span className="min-w-0"><span className="block text-sm font-semibold truncate" style={{ color: "var(--ivory)" }}>{c.name}</span><span className="block text-[11px] truncate" style={{ color: "var(--muted)" }}>{sub}</span></span>
      <span className="flex items-center gap-2">{dist && <span className="mono text-xs whitespace-nowrap" style={{ color: "var(--ivory-d)" }}>{dist}</span>}{score && <span className="text-right leading-none" title={`Table score ${score.score}: the best game here against your usual game (50)`}><span className="block mono text-[13px] font-semibold" style={{ color: scoreTone(score.score) }}>{score.score}</span><span className="block text-[8.5px] font-semibold uppercase mt-0.5" style={{ color: "var(--muted)", letterSpacing: ".08em" }}>score</span></span>}{dist ? null : st === "backed" ? <span className="ctag x">backed off</span> : st === "been" ? <span className="ctag b">been</span> : c.intel ? <span className={"ctag n" + (score ? " ph-hide" : "")}>report</span> : null}<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: "var(--muted)" }}><path d="M9 6l6 6-6 6" /></svg></span>
    </button>
  );
}
function CountrySheet({ value, counts, onPick, onClose }) {
  const [q, setQ] = useState("");
  const all = countries(), w = q.trim().toLowerCase();
  const top = ["USA", "CAN", ...Object.keys(counts.mine).filter((k) => k !== "USA" && k !== "CAN").sort((a, b) => countryName(a).localeCompare(countryName(b)))];
  const rows = w ? all.filter((c) => c.n.toLowerCase().includes(w)) : [...top.map((id) => ({ id, n: countryName(id), top: true })), ...all.filter((c) => !top.includes(c.id))];
  return (
    <Sheet title="Choose a country" onClose={onClose}>
      <input className="in mb-3" placeholder="Search countries" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search countries" autoComplete="off" />
      <div style={{ minHeight: "46vh" }}>
        {rows.map((c, i) => { const built = counts.built[c.id] || 0, mine = counts.mine[c.id] || 0; return (
          <button key={c.id} className="crow" onClick={() => onPick(c.id)} style={!w && i === top.length ? { borderTop: "1px solid var(--line)", marginTop: 6 } : undefined}>
            <span className={"cdot" + (mine ? " b" : "")} aria-hidden="true" />
            <span className="text-sm font-semibold truncate" style={{ color: "var(--ivory)" }}>{c.n}</span>
            <span className="flex items-center gap-2 text-[11px]" style={{ color: "var(--muted)" }}>{[built ? `${built} casinos` : null, mine ? `${mine} yours` : null].filter(Boolean).join(" · ") || (c.top ? "" : "add your own")}{value === c.id && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brass)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-label="selected"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}</span>
          </button>); })}
        {!rows.length && <p className="text-sm text-center py-8" style={{ color: "var(--muted)" }}>No country matches “{q}”.</p>}
      </div>
    </Sheet>
  );
}
function GameEditor({ g, set, onRemove, onUse, used }) {
  const R = g.rules || {}, setR = (k, v) => set({ ...g, rules: { ...R, [k]: v } }); // a saved game with no rules (old or hand-edited data) opens empty instead of failing
  const [more, setMore] = useState(() => !dasOn(R) || dblRule(R) !== "any" || maxHandsOf(R) !== 4 || !!R.rsa);
  const row = (label, control) => <div className="grid items-center gap-3" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,190px)" }}><span className="text-sm" style={{ color: "var(--ivory-d)" }}>{label}</span>{control}</div>;
  const num = (k, ph, pre) => <div className="relative">{pre && <span className="absolute left-3 top-1/2 -translate-y-1/2 mono" style={{ color: "var(--muted)" }}>{pre}</span>}<input className="in mono" style={pre ? { paddingLeft: 24 } : undefined} type="number" inputMode="numeric" min="0" placeholder={ph} value={g[k] ?? ""} onChange={(e) => set({ ...g, [k]: e.target.value === "" ? "" : Math.max(0, Number(e.target.value)) })} aria-label={ph} /></div>;
  return (
    <div className="rise">
      <label className="block mb-2"><span className="eyebrow block mb-1.5">Which game</span><input className="in" placeholder="Main floor, high limit, double deck…" value={g.label || ""} onChange={(e) => set({ ...g, label: e.target.value })} /></label>
      <div className="flex gap-1.5 mb-4">{["Main floor", "High limit", "Double deck"].map((l) => <button key={l} type="button" onClick={() => set({ ...g, label: l })} className="chippress rounded-full px-3 text-xs font-semibold" style={{ height: 30, background: g.label === l ? "rgba(var(--acc),.18)" : "rgba(var(--fg),.05)", color: g.label === l ? "var(--brass)" : "var(--ivory-d)" }}>{l}</button>)}</div>
      <div className="space-y-3">
        {row("Decks", <Seg value={R.decks} options={[[1, "1"], [2, "2"], [4, "4"], [6, "6"], [8, "8"]]} onChange={(v) => setR("decks", v)} />)}
        {row("Dealer on soft 17", <Seg value={!!R.h17} options={[[false, "Stands"], [true, "Hits"]]} onChange={(v) => setR("h17", v)} />)}
        {row("Blackjack pays", <Seg value={!!R.bj65} options={[[false, "3 to 2"], [true, "6 to 5"]]} onChange={(v) => setR("bj65", v)} />)}
        {row("Surrender", <Seg value={!!R.surrender} options={[[false, "No"], [true, "Yes"]]} onChange={(v) => setR("surrender", v)} />)}
        {row("Double after split", <Seg value={dasOn(R)} options={[[false, "No"], [true, "Yes"]]} onChange={(v) => setR("das", v)} />)}
        {row(<>Penetration <span className="mono" style={{ color: "var(--brass)" }}>{R.pen}%</span></>, <input type="range" min={50} max={90} step={5} value={R.pen} onChange={(e) => setR("pen", Number(e.target.value))} aria-label="Penetration" />)}
      </div>
      <More open={more} onClick={() => setMore(!more)} className="mt-4 mb-1">{more ? "Fewer rules" : "More rules — doubling, splitting"}</More>
      <Fold open={more} className="space-y-3 pt-2">
        {row("Double on", <Seg value={dblRule(R)} options={[["any", "Any 2"], ["9-11", "9–11"], ["10-11", "10–11"]]} onChange={(v) => setR("dbl", v)} />)}
        {row("Split up to (hands)", <Seg value={maxHandsOf(R)} options={[[2, "2"], [3, "3"], [4, "4"]]} onChange={(v) => setR("maxHands", v)} />)}
        {row("Resplit aces", <Seg value={!!R.rsa} options={[[false, "No"], [true, "Yes"]]} onChange={(v) => setR("rsa", v)} />)}
      </Fold>
      <div className="grid grid-cols-3 gap-2 mt-4">
        <label className="block"><span className="eyebrow block mb-1.5">Table min</span>{num("min", "Min", "$")}</label>
        <label className="block"><span className="eyebrow block mb-1.5">Table max</span>{num("max", "Max", "$")}</label>
        <label className="block"><span className="eyebrow block mb-1.5">Tables</span>{num("tables", "How many")}</label>
      </div>
      <input className="in mt-3" placeholder="Note — hours, mid-shoe entry, shuffler…" value={g.note || ""} onChange={(e) => set({ ...g, note: e.target.value })} aria-label="Note about this game" />
      <button type="button" className="btn ghost mt-4" onClick={onUse} disabled={used}>{used ? "The app is using these rules ✓" : "Practice this game in the app"}</button>
      <p className="text-[11px] mt-1.5 text-center" style={{ color: "var(--muted)" }}>Sets the app's game rules to this table, so the charts, drills and spread match it.</p>
      <div className="text-center mt-4"><ConfirmLink label="Remove this game" confirm="Tap again to remove" onConfirm={onRemove} style={{ fontSize: 13 }} /></div>
    </div>
  );
}
// the best game a report describes, in the app's short rule style — only the parts the source actually gave
const bestLine = (b) => [b.decks ? `${b.decks}D` : null, b.h17 === true ? "H17" : b.h17 === false ? "S17" : null, b.das === true ? "DAS" : b.das === false ? "NDAS" : null, b.ls ? "LS" : null, b.rsa ? "RSA" : null, b.bj65 ? "6:5" : null, b.pen ? `${b.pen}%` : null].filter(Boolean).join(" · ");
const intelFacts = (intel) => [intel.tablesN ? [String(intel.tablesN), "table games"] : null, intel.min ? [`$${intel.min}`, "lowest 3:2 minimum"] : null, intel.best && bestLine(intel.best) ? [bestLine(intel.best), intel.best.where || "best game reported"] : null].filter(Boolean);
function IntelBlock({ intel, onCopy, copied }) {
  const rows = [["Tables", intel.tables], ["Blackjack", intel.games], ["Penetration", intel.pen], ["High limit", intel.hl], ["Heat", intel.heat], ["Other games", intel.other], ["Good to know", intel.note]].filter((r) => r[1] && (!Array.isArray(r[1]) || r[1].length));
  const facts = intelFacts(intel);
  const [open, setOpen] = useState(rows.length <= 2);
  return (
    <div className="cbox mb-4">
      <div className="flex items-baseline justify-between gap-3"><span className="eyebrow">Scouting report</span>{intel.asOf && <span className="text-[11px]" style={{ color: "var(--muted)" }}>as of {intel.asOf}</span>}</div>
      {facts.length > 0 && <div className="grid gap-2 mt-2.5" style={{ gridTemplateColumns: `repeat(${facts.length}, minmax(0,1fr))` }}>{facts.map(([v, k]) => (
        <div key={k} className="rounded-xl px-2.5 py-2" style={{ background: "rgba(var(--fg),.04)" }}><div className="mono text-[13px] font-semibold leading-tight" style={{ color: "var(--ivory)" }}>{v}</div><div className="text-[10.5px] leading-tight mt-0.5" style={{ color: "var(--muted)" }}>{k}</div></div>))}</div>}
      <Fold open={open} className="space-y-2.5 pt-3">
        {rows.map(([k, v]) => (
          <div key={k}><div className="text-[11px] font-semibold" style={{ color: "var(--muted)" }}>{k}</div>
            {Array.isArray(v) ? <ul className="text-[13px] leading-snug" style={{ color: "var(--ivory-d)" }}>{v.map((x, i) => <li key={i} className="flex gap-2 mt-1"><span aria-hidden="true" style={{ color: "var(--brass)" }}>·</span><span>{x}</span></li>)}</ul> : <div className="text-[13px] leading-snug mt-0.5" style={{ color: "var(--ivory-d)" }}>{v}</div>}
          </div>))}
        {intel.best && intel.best.decks && onCopy && <button type="button" className="btn ghost" style={{ fontSize: 14, padding: "10px 12px" }} onClick={onCopy} disabled={copied}>{copied ? "Added to your games ✓" : "Add the reported game to mine"}</button>}
        {intel.src && intel.src.length > 0 && <div className="text-[11px] pt-2.5" style={{ borderTop: "1px solid var(--line)", color: "var(--muted)" }}>Sources: {intel.src.map(([l, u], i) => <span key={u + i}>{i ? " · " : ""}<a className="clink" href={u} target="_blank" rel="noopener noreferrer">{l}</a></span>)}</div>}
        <p className="text-[11px]" style={{ color: "var(--muted)" }}>Gathered from public reports. Casinos change rules, limits and table counts often — trust what you see on the floor.</p>
      </Fold>
      {!open && <More open={false} onClick={() => setOpen(true)} className="mt-3">Read the full report</More>}
    </div>
  );
}
function CasinoSheet({ c, place, intel, appRules, onSave, onClose, onRemove, onMove, onUseRules, onLog }) {
  const m0 = c.mark || {};
  const [d, setD] = useState(() => ({ status: m0.status || "none", backedOn: m0.backedOn || "", heat: m0.heat || 0, games: (m0.games || []).map((g) => ({ ...g })), notes: m0.notes || "", name: c.name, city: c.city || "" }));
  const [edit, setEdit] = useState(null); // id of the game being edited
  const [usedId, setUsedId] = useState(null), [copied, setCopied] = useState(false);
  const dirty = useRef(false), dr = useRef(d); dr.current = d;
  const set = (patch) => { dirty.current = true; setD((o) => ({ ...o, ...patch })); };
  const sess = c.sess, fromLog = !!(sess && sess.backed);
  const shown = fromLog ? "backed" : d.status === "none" && sess && sess.n ? "been" : d.status;
  const close = () => { // closing keeps what you entered — there is nothing to lose by tapping away
    const v = dr.current;
    if (dirty.current && (!c.custom || v.name.trim())) {
      const games = v.games.map((g) => { const o = { id: g.id, rules: g.rules }; if ((g.label || "").trim()) o.label = g.label.trim(); ["min", "max", "tables"].forEach((k) => { if (g[k] !== "" && g[k] != null && +g[k] > 0) o[k] = +g[k]; }); if ((g.note || "").trim()) o.note = g.note.trim(); return o; });
      onSave({ status: v.status === "none" ? null : v.status, backedOn: v.status === "backed" ? v.backedOn || localDay() : null, heat: v.heat || null, games: games.length ? games : null, notes: v.notes.trim() || null, ...(c.custom ? { name: v.name.trim(), city: v.city.trim() } : {}) });
    }
    onClose();
  };
  const game = edit && d.games.find((g) => g.id === edit);
  // copy the game a scouting report describes into your own list, to correct against what you see at the table
  const copyReported = () => {
    const b = intel.best, pen = b.pen ? Math.min(90, Math.max(50, Math.round(b.pen / 5) * 5)) : appRules.pen;
    const rules = { ...appRules, decks: [1, 2, 4, 6, 8].includes(b.decks) ? b.decks : appRules.decks, pen, ...(b.h17 != null ? { h17: !!b.h17 } : {}), ...(b.das != null ? { das: !!b.das } : {}), surrender: !!b.ls, rsa: !!b.rsa, bj65: !!b.bj65 }; // a rule the report doesn't mention is taken as not offered
    set({ games: [...d.games, { id: "g" + Date.now().toString(36), label: b.where || "Reported game", rules, min: b.min || "", max: b.max || "", tables: "", note: `From the scouting report${intel.asOf ? ", " + intel.asOf : ""} — check it at the table` }] }); setCopied(true);
  };
  const addGame = () => { const id = "g" + Date.now().toString(36); set({ games: [...d.games, { id, label: d.games.length ? "" : "Main floor", rules: { ...appRules }, min: "", max: "", tables: "", note: "" }] }); setEdit(id); };
  if (game) return (
    <Sheet title={game.label || "Game"} onClose={close}>
      <button type="button" className="cback" onClick={() => setEdit(null)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>{c.name}</button>
      <GameEditor g={game} set={(ng) => { setUsedId(null); set({ games: d.games.map((x) => (x.id === ng.id ? ng : x)) }); }} onRemove={() => { set({ games: d.games.filter((x) => x.id !== game.id) }); setEdit(null); }} onUse={() => { onUseRules({ ...appRules, ...game.rules }); setUsedId(game.id); }} used={usedId === game.id} />
      <button className="btn mt-5" onClick={() => setEdit(null)}>Done</button>
    </Sheet>
  );
  return (
    <Sheet title={c.custom ? d.name || "Your casino" : c.name} onClose={close}>
      <div className="flex items-center justify-between gap-3 -mt-2 mb-4">
        <span className="text-xs min-w-0 truncate" style={{ color: "var(--muted)" }}>{place || "Your own pin"}</span>
        <a className="text-xs font-semibold shrink-0 lnk" style={{ color: "var(--brass)" }} href={mapsUrl({ ...c, name: d.name })} target="_blank" rel="noopener noreferrer">Directions ↗</a>
      </div>
      {c.custom && <div className="grid grid-cols-2 gap-2 mb-4">
        <label className="block"><span className="eyebrow block mb-1.5">Name</span><input className="in" value={d.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="block"><span className="eyebrow block mb-1.5">Town</span><input className="in" value={d.city} onChange={(e) => set({ city: e.target.value })} /></label>
      </div>}
      <div className="cbox mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">{sess && sess.n ? <><div className="text-sm font-semibold mono" style={{ color: sess.net >= 0 ? "var(--brass)" : "var(--neg-l)" }}>{sgnMoney(sess.net)}</div><div className="text-[11px]" style={{ color: "var(--muted)" }}>{sess.n} session{sess.n === 1 ? "" : "s"} · {fmtH(sess.h)} · last {dateShort(sess.last)}</div></> : <div className="text-xs" style={{ color: "var(--muted)" }}>No sessions logged here yet.</div>}</div>
        <button type="button" onClick={() => { close(); onLog(d.name); }} className="text-xs font-semibold rounded-full px-3 shrink-0 chippress" style={{ height: 30, background: "rgba(var(--acc),.14)", color: "var(--brass)" }}>Log a session</button>
      </div>
      {intel && <IntelBlock intel={intel} onCopy={copyReported} copied={copied} />}
      <span className="eyebrow block mb-1.5">Status</span>
      {fromLog ? <div className="cbox mb-4 text-xs" style={{ color: "var(--ivory-d)", borderColor: "rgba(var(--neg),.35)" }}><b style={{ color: "var(--neg-l)" }}>Backed off</b> on {dateShort(sess.backed)} — from your session log. Change the heat on that session to undo it.</div>
        : <>
          <Seg value={shown} options={sess && sess.n ? [["been", "Been here"], ["backed", "Backed off"]] : [["none", "Not yet"], ["been", "Been here"], ["backed", "Backed off"]]} onChange={(v) => set({ status: v, backedOn: v === "backed" ? d.backedOn || localDay() : d.backedOn })} style={{ marginBottom: shown === "backed" ? 8 : 16 }} />
          {shown === "backed" && <label className="grid items-center gap-3 mb-4 rise" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,190px)" }}><span className="text-sm" style={{ color: "var(--ivory-d)" }}>When</span><input className="in" type="date" value={d.backedOn || localDay()} max={localDay()} onChange={(e) => set({ backedOn: e.target.value })} /></label>}
        </>}
      <span className="eyebrow block mb-1.5">Heat</span>
      <div className="chipseg mb-1" role="group" aria-label="Heat" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>{HEATS.map(([v, l]) => <button key={v} type="button" className={d.heat === v ? "on" : ""} aria-pressed={d.heat === v} onClick={() => set({ heat: d.heat === v ? 0 : v })} style={{ height: 36 }}>{l}</button>)}</div>
      <p className="text-[11px] mb-4" style={{ color: "var(--muted)" }}>How closely they watch counters. Tap again to clear.</p>
      <div className="flex items-baseline justify-between mb-1.5"><span className="eyebrow">Games</span>{d.games.length > 0 && <button type="button" onClick={addGame} className="text-xs font-semibold lnk" style={{ color: "var(--brass)" }}>+ Add a game</button>}</div>
      {d.games.length ? <div className="cbox mb-4" style={{ padding: "2px 10px" }}>{d.games.map((g) => (
        <button key={g.id} type="button" className="crow" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }} onClick={() => setEdit(g.id)}>
          <span className="min-w-0"><span className="block text-sm font-semibold truncate" style={{ color: "var(--ivory)" }}>{g.label || "Blackjack"}</span><span className="block text-[11px] mono truncate" style={{ color: "var(--muted)" }}>{gameLine(g)}</span></span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: "var(--muted)" }}><path d="M9 6l6 6-6 6" /></svg>
        </button>))}</div>
        : <button type="button" onClick={addGame} className="w-full text-left rounded-xl px-3.5 py-3 mb-4" style={{ background: "rgba(var(--fg),.04)", border: "1px dashed rgba(var(--acc),.3)" }}><span className="block text-sm font-semibold" style={{ color: "var(--brass)" }}>+ Add a game you found</span><span className="block text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>Decks, rules, penetration, limits, how many tables — one entry per pit or room.</span></button>}
      <label className="block mb-4"><span className="eyebrow block mb-1.5">Notes</span><textarea className="in" rows={3} placeholder="Which pits, shift changes, who to avoid, what's in the high-limit room…" value={d.notes} onChange={(e) => set({ notes: e.target.value })} style={{ fontSize: 15, lineHeight: 1.45, resize: "vertical" }} /></label>
      <button className="btn" onClick={close}>Done</button>
      <div className="flex items-center justify-center gap-5 mt-3">
        {c.custom && <button type="button" onClick={() => { close(); onMove(); }} className="text-xs underline underline-offset-2 lnk" style={{ color: "var(--muted)", fontSize: 13 }}>Move the pin</button>}
        <ConfirmLink label={c.custom ? "Delete this casino" : "Hide from my map"} confirm={c.custom ? "Tap again to delete" : "Tap again to hide"} onConfirm={() => { dirty.current = false; onRemove(); }} style={{ fontSize: 13 }} />
      </div>
    </Sheet>
  );
}
function AddSheet({ draft, set, map, cname, onPlaceOnMap, onSave, onClose }) {
  const [msg, setMsg] = useState(null), [busy, setBusy] = useState(false);
  const placed = draft.lat != null;
  const here = () => {
    if (!navigator.geolocation) { setMsg("This device won't share its location — tap the map instead."); return; }
    setBusy(true); setMsg(null);
    navigator.geolocation.getCurrentPosition((p) => { setBusy(false); const lat = p.coords.latitude, lon = p.coords.longitude, q = map.proj.fwd(lon, lat); if (!q || q[0] < map.box[0] - 40 || q[0] > map.box[2] + 40 || q[1] < map.box[1] - 40 || q[1] > map.box[3] + 40) { setMsg(`You don't seem to be in ${cname} right now — tap the map instead.`); return; } set({ lat, lon, st: map.geo ? regionAt(map.geo, lon, lat) : null }); },
      () => { setBusy(false); setMsg("Couldn't get your location — tap the map instead."); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  };
  const ok = draft.name.trim() && placed;
  return (
    <Sheet title="Add a casino" onClose={onClose}>
      <label className="block mb-3"><span className="eyebrow block mb-1.5">Name</span><input className="in" placeholder="Casino name" value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
      <label className="block mb-4"><span className="eyebrow block mb-1.5">Town</span><input className="in" placeholder="Town or city" value={draft.city} onChange={(e) => set({ city: e.target.value })} /></label>
      <span className="eyebrow block mb-1.5">Where it is</span>
      {placed && <div className="cbox mb-2 text-sm rise" style={{ color: "var(--ivory)", borderColor: "rgba(var(--acc),.3)" }}><span style={{ color: "var(--brass)" }}>✓</span> Pinned{draft.st && map.names[draft.st] ? ` in ${map.names[draft.st]}` : ` in ${cname}`}</div>}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <button type="button" className="btn ghost" style={{ fontSize: 14, padding: "11px 10px" }} onClick={onPlaceOnMap}>{placed ? "Tap the map again" : "Tap the map"}</button>
        <button type="button" className="btn ghost" style={{ fontSize: 14, padding: "11px 10px" }} onClick={here} disabled={busy}>{busy ? "Finding you…" : "I'm here now"}</button>
      </div>
      {msg && <p className="text-xs mb-2" style={{ color: "var(--neg-l)" }}>{msg}</p>}
      <button className="btn mt-3" disabled={!ok} onClick={onSave}>Add to my map</button>
      <p className="text-[11px] mt-2 text-center" style={{ color: "var(--muted)" }}>It's saved to {cname}. You can add heat, games and notes next.</p>
    </Sheet>
  );
}
function LinkSheet({ name, all, onLink, onAddNew, onClose }) {
  const [q, setQ] = useState("");
  const w = tokens(q), mine = tokens(name);
  const rows = (w.length ? all.filter((c) => { const t = tokens(c.name + " " + c.city + " " + c.st); return w.every((x) => t.some((y) => y.startsWith(x))); }) : all.filter((c) => { const t = new Set(tokens(c.name + " " + c.city)); return mine.some((x) => t.has(x)); })).slice(0, 30);
  return (
    <Sheet title={`Which casino is “${name}”?`} onClose={onClose}>
      <p className="text-xs -mt-2 mb-3" style={{ color: "var(--muted)" }}>Pick it once and every session logged under that name shows on the map.</p>
      <input className="in mb-2" placeholder="Search casinos" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search casinos" autoComplete="off" />
      <div style={{ minHeight: "30vh" }}>
        {rows.map((c) => <CasinoRow key={c.id} c={c} place={[c.city, c.st].filter(Boolean).join(", ")} onOpen={() => onLink(c)} />)}
        {!rows.length && <p className="text-sm text-center py-6" style={{ color: "var(--muted)" }}>{w.length ? "Nothing matches." : "Search for it above."}</p>}
      </div>
      <button className="btn ghost mt-3" onClick={onAddNew}>It's not listed — add “{name}”</button>
    </Sheet>
  );
}

// ---------- the page ----------
// ---------- where you are ("Near me") ----------
// Asked for only when "Near me" is tapped. It stays on this device: it sorts the list by distance and is never saved
// or sent anywhere. One answer is shared by the Casinos page and the session timer while the app is open.
let _pos = null, _posState = "idle"; // idle | asking | ok | denied | off
const posSubs = new Set();
const setPos = (state, pos) => { _posState = state; if (pos !== undefined) _pos = pos; posSubs.forEach((f) => f()); };
export function askWhere() {
  if (_posState === "asking") return;
  if (typeof navigator === "undefined" || !navigator.geolocation) { setPos("off"); return; }
  setPos("asking");
  try {
    navigator.geolocation.getCurrentPosition(
      (p) => setPos("ok", { lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() }),
      (e) => setPos(e && e.code === 1 ? "denied" : "off"),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  } catch (_) { setPos("off"); }
}
export function useWhere() {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); posSubs.add(f); return () => { posSubs.delete(f); }; }, []);
  return { pos: _pos, state: _posState, ask: askWhere };
}
export const distLabel = (mi, miles = true) => { const v = miles ? mi : mi * 1.609344; return (v < 10 ? Math.round(v * 10) / 10 : Math.round(v)).toLocaleString() + (miles ? " mi" : " km"); };
// the casinos closest to a spot, nearest first (the session timer offers them as where you are)
export async function nearestCasinos(pos, n = 3) {
  const all = await loadCasinoAll();
  return all.filter((c) => isFinite(c.lat + c.lon) && !(c.mark && c.mark.hidden)).map((c) => ({ c, mi: milesBetween(pos, c) })).sort((a, b) => a.mi - b.mi).slice(0, n);
}
let _casUi = null; // country and focused state, kept while the app is open
// everything known about every casino: the built-in list with your marks on top, plus the ones you added
function buildAll(marksList, sessions) {
  const base = baseData(), marks = new Map(marksList.map((m) => [m.id, m]));
  const all = base.list.map((b) => ({ ...b, mark: marks.get(b.id), intel: base.intel[b.id] || null }));
  marksList.forEach((m) => { if (m.custom) all.push({ id: m.id, name: m.name || "Casino", city: m.city || "", st: m.st || "", cc: m.cc || "USA", lat: m.lat, lon: m.lon, custom: true, mark: m }); });
  const { by, loose } = linkSessions(sessions, all);
  all.forEach((c) => { c.sess = by.get(c.id) || null; });
  return { all, loose };
}
// for the Plan tab: the same list, read straight from storage
export async function loadCasinoAll() {
  let d = null, s = [];
  try { const r = await window.storage.get(CAS_KEY, false); if (r?.value) d = JSON.parse(r.value); } catch (_) {}
  try { const r = await window.storage.get(SESS_KEY, false); if (r?.value) s = JSON.parse(r.value) || []; } catch (_) {}
  return buildAll(Array.isArray(d && d.marks) ? d.marks.filter((m) => m && m.id) : [], Array.isArray(s) ? s : []).all;
}
let _casOpen = null; // a casino the Plan tab asked to open before this page was showing
export const openCasinoId = (id) => { _casOpen = id; };
export default function CasinosPage({ rules, onUseRules, go }) {
  const [data, setData] = useState(null); // { marks: [...] }
  const [sessions, setSessions] = useState([]);
  const [cc, setCc] = useState(() => (_casUi && _casUi.cc) || "USA");
  const [focus, setFocus] = useState(() => (_casUi && _casUi.focus) || null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null); // casino id in the detail sheet
  const [pick, setPick] = useState(null); // several casinos under one tap
  const [countrySheet, setCountrySheet] = useState(false);
  const [add, setAdd] = useState(null); // draft of a casino being added
  const [placing, setPlacing] = useState(null); // "add" | casino id being moved
  const [link, setLink] = useState(null); // session name being linked
  const [showHidden, setShowHidden] = useState(false);
  const [more, setMore] = useState(false);
  const mapCard = useRef(null);
  const where = useWhere(), near = filter === "near";
  const pickFilter = (v) => { setFilter(v); if (v === "near") { setFocus(null); setQ(""); if (where.state !== "ok" || Date.now() - where.pos.t > 6e5) where.ask(); } };
  useEffect(() => { (async () => {
    let d = null, s = [], ui = null;
    try { const r = await window.storage.get(CAS_KEY, false); if (r?.value) d = JSON.parse(r.value); } catch (_) {}
    try { const r = await window.storage.get(SESS_KEY, false); if (r?.value) s = JSON.parse(r.value) || []; } catch (_) {}
    if (!_casUi) { try { const r = await window.storage.get(CAS_UI_KEY, false); if (r?.value) ui = JSON.parse(r.value); } catch (_) {} if (ui && ui.cc && countries().some((c) => c.id === ui.cc)) setCc(ui.cc); }
    setSessions(Array.isArray(s) ? s : []); setData({ marks: Array.isArray(d && d.marks) ? d.marks.filter((m) => m && m.id) : [] });
  })(); }, []);
  useEffect(() => { _casUi = { cc, focus }; try { window.storage.set(CAS_UI_KEY, JSON.stringify({ cc }), false); } catch (_) {} }, [cc, focus]);
  useNav((o) => { if (o.add) { _casAdd = false; startAdd(); } if (o.open) { _casOpen = null; setOpen(o.open); } if (o.near) { _casNear = false; pickFilter("near"); } });
  useEffect(() => { if (_casAdd) { _casAdd = false; startAdd(); } if (_casOpen) { setOpen(_casOpen); _casOpen = null; } if (_casNear) { _casNear = false; pickFilter("near"); } }, []); // eslint-disable-line
  const save = (marks) => { setData({ marks }); try { window.storage.set(CAS_KEY, JSON.stringify({ v: 1, marks }), false); } catch (_) {} };
  const patchMark = (id, patch, base) => {
    const cur = data.marks.find((m) => m.id === id), next = { ...(cur || base || { id }), ...patch, t: Date.now() };
    Object.keys(next).forEach((k) => { if (next[k] == null || next[k] === "" || (Array.isArray(next[k]) && !next[k].length)) delete next[k]; });
    // a built-in casino with nothing left on it needs no record at all
    const empty = !next.custom && Object.keys(next).every((k) => k === "id" || k === "t");
    save(empty ? data.marks.filter((m) => m.id !== id) : cur ? data.marks.map((m) => (m.id === id ? next : m)) : [...data.marks, next]);
  };

  const map = useMemo(() => mapFor(cc), [cc]);
  // everything known about every casino: the built-in list with your marks on top, plus the ones you added
  const everything = useMemo(() => (data ? buildAll(data.marks, sessions) : null), [data, sessions]);
  const here = useMemo(() => (everything ? everything.all.filter((c) => c.cc === cc) : []), [everything, cc]);
  const visible = useMemo(() => here.filter((c) => showHidden || !(c.mark && c.mark.hidden)), [here, showHidden]);
  const counts = useMemo(() => { const o = { all: visible.length, been: 0, backed: 0, intel: 0 }; visible.forEach((c) => { const s = statusOf(c); if (s !== "none") o.been++; if (s === "backed") o.backed++; if (c.intel) o.intel++; }); return o; }, [visible]);
  const hiddenN = here.length - here.filter((c) => !(c.mark && c.mark.hidden)).length;
  const pins = useMemo(() => {
    const out = [];
    visible.forEach((c) => {
      const s = statusOf(c); if ((filter === "been" && s === "none") || (filter === "backed" && s !== "backed") || (filter === "intel" && !c.intel)) return;
      if (!isFinite(c.lat + c.lon)) return; const p = map.proj.fwd(c.lon, c.lat, cc === "USA" ? c.st || undefined : undefined); if (!p) return;
      out.push({ id: c.id, x: p[0], y: p[1], kind: s === "backed" ? "backed" : s === "been" ? "been" : "other", name: c.name });
    });
    return out;
  }, [visible, filter, map, cc]);
  const countryCounts = useMemo(() => { const built = {}, mine = {}; if (everything) everything.all.forEach((c) => { if (!c.custom) built[c.cc] = (built[c.cc] || 0) + 1; if (c.custom || statusOf(c) !== "none" || hasNotes(c.mark)) mine[c.cc] = (mine[c.cc] || 0) + 1; }); return { built, mine }; }, [everything]);
  const placeOf = (c) => [c.city, map.names[c.st] && c.cc === cc ? (focus === c.st ? null : c.st) : c.st].filter(Boolean).join(", ");
  const fullPlace = (c) => [c.city, c.cc === cc && map.names[c.st] ? map.names[c.st] : c.st, c.cc !== cc || !map.hasRegions ? countryName(c.cc) : null].filter(Boolean).join(", ");

  const words = tokens(q), searching = q.trim().length > 0;
  const list = useMemo(() => {
    const rank = { backed: 0, been: 1, none: 2 }, sort = (L) => L.slice().sort((a, b) => rank[statusOf(a)] - rank[statusOf(b)] || a.name.localeCompare(b.name));
    const byFilter = (c) => { const s = statusOf(c); return filter === "all" || (filter === "intel" ? !!c.intel : filter === "been" ? s !== "none" : s === "backed"); };
    if (searching) { const raw = q.trim().toLowerCase(); return sort(visible.filter((c) => { const hay = (c.name + " " + c.city + " " + c.st + " " + (map.names[c.st] || "")).toLowerCase(); if (hay.includes(raw)) return true; const t = tokens(hay); return words.length > 0 && words.every((x) => t.some((y) => y.startsWith(x))); })); }
    // near me: every casino in this country by distance, whatever its status
    if (filter === "near") return where.pos ? visible.filter((c) => isFinite(c.lat + c.lon)).map((c) => [milesBetween(where.pos, c), c]).sort((a, b) => a[0] - b[0]).slice(0, 80).map((x) => x[1]) : [];
    if (focus) return sort(visible.filter((c) => c.st === focus && byFilter(c)));
    if (filter !== "all") return sort(visible.filter(byFilter));
    return sort(visible.filter((c) => c.custom || statusOf(c) !== "none" || hasNotes(c.mark)));
  }, [visible, q, focus, filter, map, where.pos]); // eslint-disable-line
  const me = useMemo(() => { if (!near || !where.pos) return null; let st; try { st = cc === "USA" && map.geo ? regionAt(map.geo, where.pos.lon, where.pos.lat) || undefined : undefined; } catch (_) {} const p = map.proj.fwd(where.pos.lon, where.pos.lat, st); return p ? { x: p[0], y: p[1] } : null; }, [near, where.pos, map, cc]);
  useEffect(() => { setMore(false); }, [q, focus, filter, cc]);
  const title = searching ? `${list.length} match${list.length === 1 ? "" : "es"}` : near ? "Near you" : focus ? `${map.names[focus] || focus}${filter === "backed" ? " · backed off" : filter === "been" ? " · been" : filter === "intel" ? " · reports" : ""}` : filter === "backed" ? "Backed off" : filter === "been" ? "Where you've been" : filter === "intel" ? "Scouting reports" : "Your casinos";
  const regionCounts = useMemo(() => { const o = {}; visible.forEach((c) => { if (c.st) o[c.st] = (o[c.st] || 0) + 1; }); return o; }, [visible]);

  const toMap = () => { try { const el = mapCard.current; if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" }); } catch (_) {} };
  function startAdd(name) { setOpen(null); setPick(null); setLink(null); setAdd({ name: name || "", city: "", lat: null, lon: null, st: null }); }
  const placed = (lon, lat) => {
    const st = map.geo ? regionAt(map.geo, lon, lat) : null;
    if (placing === "add") { setAdd((a) => ({ ...(a || { name: "", city: "" }), lat, lon, st })); setPlacing(null); return; }
    patchMark(placing, { lat: +lat.toFixed(4), lon: +lon.toFixed(4), st }); setOpen(placing); setPlacing(null);
  };
  const saveNew = () => {
    const id = "c" + Date.now().toString(36);
    save([...data.marks, { id, custom: true, cc, st: add.st || undefined, name: add.name.trim(), city: add.city.trim() || undefined, lat: +add.lat.toFixed(4), lon: +add.lon.toFixed(4), t: Date.now() }].map((m) => { const o = { ...m }; Object.keys(o).forEach((k) => o[k] === undefined && delete o[k]); return o; }));
    setAdd(null); setOpen(id);
  };
  const pickCountry = (id) => { setCountrySheet(false); if (id !== cc) { setCc(id); setFocus(null); setFilter("all"); setQ(""); } };
  const openCasino = (c) => { setPick(null); setOpen(c.id); };

  const shownList = more ? list : list.slice(0, near ? 12 : 40);
  const scores = useCasinoScores(shownList, true);
  if (!everything) return <div><style>{casCss}</style></div>;
  const cname = countryName(cc), cur = open && everything.all.find((c) => c.id === open);
  const shown = shownList;
  const emptyAll = !searching && !focus && filter === "all" && !list.length;
  return (
    <div>
      <style>{casCss}</style>
      <div className="dgrid wl"><div className="dcol stick">
        <section className="card mb-4 overflow-hidden" ref={mapCard} style={{ scrollMarginTop: 12 }}>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <button className="cpick" onClick={() => setCountrySheet(true)} aria-label={`Country: ${cname}. Change`}><span className="truncate">{cname}</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></button>
            <button onClick={() => startAdd()} className="text-[13px] font-semibold shrink-0 rounded-full px-3.5 chippress" style={{ height: 34, background: "rgba(var(--acc),.14)", color: "var(--brass)" }}>+ Add casino</button>
          </div>
          <CasinoMap map={map} pins={pins} me={me} focus={focus} sel={open} placing={!!placing} miles={cc === "USA"} regionWord={cc === "USA" ? "state" : "province"}
            onRegion={(id) => { setFocus(id); if (id) { setQ(""); if (near) setFilter("all"); } }} onPins={(L) => { if (L.length === 1) setOpen(L[0].id); else setPick(L.map((p) => p.id)); }}
            onPlace={placed} onCancelPlace={() => { const was = placing; setPlacing(null); if (was && was !== "add") setOpen(was); }} />
          <div className="px-4 py-3">
            <ChipRow small value={filter} onChange={pickFilter} options={[["all", "All"], ["near", <span key="n" className="flex items-center gap-1.5"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 3 3 10.5l7.5 3 3 7.5z" /></svg>Near me</span>], ["been", <span key="b" className="flex items-center gap-1.5"><span className="cdot b" />Been {counts.been}</span>], ["backed", <span key="x" className="flex items-center gap-1.5"><span className="cdot x" style={{ boxShadow: "none" }} />Backed off {counts.backed}</span>], ...(counts.intel ? [["intel", "Reports"]] : [])]} />
          </div>
        </section>
      </div><div className="dcol o2">
        <section className="card p-5 mb-4">
          <div className="grid gap-2 mb-5" style={{ gridTemplateColumns: map.hasRegions ? "minmax(0,1fr) minmax(0,.8fr)" : "1fr" }}>
            <input className="in" style={{ height: 44, fontSize: 15 }} type="search" placeholder="Search casinos" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search casinos" autoComplete="off" enterKeyHint="search" />
            {map.hasRegions && <select className="in csel" value={focus || ""} onChange={(e) => { setFocus(e.target.value || null); setQ(""); if (e.target.value) { toMap(); if (near) setFilter("all"); } }} aria-label={cc === "USA" ? "State" : "Province"}>
              <option value="">{cc === "USA" ? "All states" : "All provinces"}</option>
              {map.regions.slice().sort((a, b) => a.n.localeCompare(b.n)).map((r) => <option key={r.id} value={r.id}>{r.n}{regionCounts[r.id] ? ` (${regionCounts[r.id]})` : ""}</option>)}
            </select>}
          </div>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <div className="eyebrow">{title}</div>
            {!searching && !near && list.length > 0 && <div className="mono text-xs" style={{ color: "var(--muted)" }}>{list.length}</div>}
            {near && !searching && where.pos && <button className="text-xs font-semibold lnk" style={{ color: "var(--brass)" }} onClick={() => where.ask()}>{where.state === "asking" ? "Finding you…" : "Update"}</button>}
          </div>
          {shown.map((c) => <CasinoRow key={c.id} c={c} place={searching || !focus ? [c.city, c.st].filter(Boolean).join(", ") : placeOf(c)} onOpen={openCasino} score={scores.get(c)} dist={near && !searching && where.pos ? distLabel(milesBetween(where.pos, c), cc === "USA") : null} />)}
          {list.length > shown.length && <button onClick={() => setMore(true)} className="w-full text-xs font-semibold py-2.5 lnk" style={{ color: "var(--brass)" }}>{near && !searching ? "Show more" : `Show all ${list.length}`}</button>}
          {near && !searching && list.length > 0 && <p className="text-[11px] mt-2 text-center" style={{ color: "var(--muted)" }}>Nearest first, in a straight line. Your location stays on this device.</p>}
          {near && !searching && !list.length ? (
            <div className="text-center py-6">
              <div className="text-sm font-semibold">{where.state === "asking" || where.state === "idle" ? "Finding where you are…" : where.state === "denied" ? "Location is switched off for this app" : where.state === "ok" ? `No casinos listed in ${cname}` : "Couldn't find where you are"}</div>
              <p className="text-xs mt-1" style={{ color: "var(--ivory-d)" }}>{where.state === "asking" || where.state === "idle" ? "Your phone may ask whether to allow it. It stays on this device." : where.state === "denied" ? "Allow location for this app in your phone's settings, then tap Near me again. Or pick a state on the map." : where.state === "ok" ? "Pick the country you're in with the button above the map." : "Check that location is switched on, then try again."}</p>
              {(where.state === "off" || where.state === "denied") && <button className="text-xs font-semibold lnk mt-2" style={{ color: "var(--brass)" }} onClick={() => where.ask()}>Try again</button>}
            </div>
          ) : !list.length && (emptyAll
            ? <div className="text-center py-6"><div className="text-sm font-semibold">{counts.all ? "Mark where you've played" : `No casinos listed for ${cname} yet`}</div><p className="text-xs mt-1" style={{ color: "var(--ivory-d)" }}>{counts.all ? `${map.hasRegions ? (cc === "USA" ? "Tap a state on the map" : "Tap a province on the map") : "Tap a pin on the map"} or search by name. Casinos you've been to, been backed off from or written notes on collect here.` : "Add the ones you play with “+ Add casino”, then tap the map where each one is."}</p></div>
            : <p className="text-sm text-center py-6" style={{ color: "var(--muted)" }}>{searching ? `Nothing in ${cname} matches “${q.trim()}”.` : focus ? (filter === "all" ? `No casinos with blackjack tables listed in ${map.names[focus] || focus}.` : filter === "intel" ? `No scouting reports for ${map.names[focus] || focus} yet.` : `None in ${map.names[focus] || focus} yet.`) : filter === "backed" ? "You haven't been backed off anywhere. Long may it last." : filter === "intel" ? "No scouting reports here yet." : "Nowhere marked yet."}</p>)}
          {(searching || focus) && !near && !list.length && <div className="text-center -mt-2 mb-1"><button className="text-xs font-semibold lnk" style={{ color: "var(--brass)" }} onClick={() => startAdd(searching ? q.trim() : "")}>+ Add {searching ? `“${q.trim()}”` : "a casino here"}</button></div>}
          {hiddenN > 0 && !searching && <div className="text-center mt-2"><button className="text-xs underline underline-offset-2 lnk" style={{ color: "var(--muted)" }} onClick={() => setShowHidden(!showHidden)}>{showHidden ? "Stop showing hidden casinos" : `${hiddenN} hidden — show`}</button></div>}
        </section>
        {everything.loose.length > 0 && !searching && (
          <section className="card p-5 mb-4">
            <div className="eyebrow mb-1">From your sessions</div>
            <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>These names in your session log aren't matched to a casino on the map yet.</p>
            {everything.loose.map((l) => (
              <button key={l.key} className="crow" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }} onClick={() => setLink(l)}>
                <span className="min-w-0"><span className="block text-sm font-semibold truncate" style={{ color: "var(--ivory)" }}>{l.name}</span><span className="block text-[11px]" style={{ color: "var(--muted)" }}>{l.n} session{l.n === 1 ? "" : "s"}</span></span>
                <span className="text-xs font-semibold" style={{ color: "var(--brass)" }}>Match ›</span>
              </button>))}
          </section>
        )}
        {(() => { // wide screens: casinos you've played that have no game of yours saved yet
          const todo = everything.all.filter((c) => statusOf(c) !== "none" && !(c.mark && c.mark.hidden) && !((c.mark && c.mark.games) || []).length)
            .sort((x, y) => ((y.sess && y.sess.n) || 0) - ((x.sess && x.sess.n) || 0) || x.name.localeCompare(y.name));
          return todo.length > 0 && (
            <section className="card p-5 mb-4 deskonly">
              <div className="flex items-baseline justify-between gap-3 mb-1"><div className="eyebrow">Played, no game saved</div><div className="mono text-xs" style={{ color: "var(--muted)" }}>{todo.length}</div></div>
              <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>Add the table you played so its score and the Plan tab use your game, not a guess.</p>
              {todo.map((c) => <CasinoRow key={c.id} c={c} place={[c.city, c.st].filter(Boolean).join(", ")} onOpen={openCasino} />)}
            </section>);
        })()}
        <TableScoreCard casinos={everything.all} appRules={rules} onUseRules={onUseRules} />
      </div></div>

      {countrySheet && <CountrySheet value={cc} counts={countryCounts} onPick={pickCountry} onClose={() => setCountrySheet(false)} />}
      {pick && <Sheet title={`${pick.length} casinos here`} onClose={() => setPick(null)}>
        <p className="text-xs -mt-2 mb-2" style={{ color: "var(--muted)" }}>They sit close together — zoom in to pull them apart, or pick one.</p>
        {pick.map((id) => everything.all.find((c) => c.id === id)).filter(Boolean).map((c) => <CasinoRow key={c.id} c={c} place={[c.city, c.st].filter(Boolean).join(", ")} onOpen={openCasino} />)}
      </Sheet>}
      {cur && !placing && <CasinoSheet key={cur.id} c={cur} place={fullPlace(cur)} intel={baseData().intel[cur.id]} appRules={rules}
        onClose={() => setOpen(null)} onUseRules={onUseRules} onLog={(name) => go("sessions", { log: true, where: name })}
        onSave={(patch) => patchMark(cur.id, patch)} onMove={() => { setPlacing(cur.id); toMap(); }}
        onRemove={() => { if (cur.custom) save(data.marks.filter((m) => m.id !== cur.id)); else patchMark(cur.id, { hidden: cur.mark && cur.mark.hidden ? null : true }); setOpen(null); }} />}
      {add && !placing && <AddSheet draft={add} set={(p) => setAdd((a) => ({ ...a, ...p }))} map={map} cname={cname} onClose={() => setAdd(null)} onSave={saveNew} onPlaceOnMap={() => { setPlacing("add"); toMap(); }} />}
      {link && <LinkSheet name={link.name} all={everything.all} onClose={() => setLink(null)} onAddNew={() => startAdd(link.name)}
        onLink={(c) => { const aka = [...new Set([...((c.mark && c.mark.aka) || []), link.key])]; patchMark(c.id, { aka }); setLink(null); }} />}
    </div>
  );
}
let _casNear = false; // set by Home's "Near me" before the page opens
export const openCasinoNear = () => { _casNear = true; };
let _casAdd = false; // set by the Jump-to palette's "Add a casino" before the page opens
export const openCasinoAdd = () => { _casAdd = true; };
