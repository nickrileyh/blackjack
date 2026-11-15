// Map maths for the Casinos page: unpack the packed outlines (TopoJSON), project them, and fit them to a box.
// No dependencies, no DOM — everything here is plain numbers so it can be checked on its own (tools/casinos/check-map.mjs).
const D = Math.PI / 180;

// TopoJSON → features with [lon, lat] rings, plus the border lines split into shared (between two regions) and outer (coast).
export function unpack(topo) {
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map((a) => { let x = 0, y = 0; return a.map((p) => { x += p[0]; y += p[1]; return [x * sx + tx, y * sy + ty]; }); });
  const owner = new Array(arcs.length).fill(-1), shared = new Uint8Array(arcs.length);
  const obj = topo.objects[Object.keys(topo.objects)[0]];
  const feats = obj.geometries.map((g, fi) => {
    const polys = g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : [];
    const used = new Set();
    const ring = (ids) => {
      const out = [];
      ids.forEach((i, n) => { const j = i < 0 ? ~i : i, a = arcs[j]; used.add(j); if (i < 0) for (let q = a.length - (n ? 2 : 1); q >= 0; q--) out.push(a[q]); else for (let q = n ? 1 : 0; q < a.length; q++) out.push(a[q]); });
      return out;
    };
    const P = polys.map((p) => p.map(ring));
    used.forEach((j) => { if (owner[j] === -1) owner[j] = fi; else if (owner[j] !== fi) shared[j] = 1; });
    return { id: g.properties.id, n: g.properties.n, polys: P, arcs: [...used] };
  });
  return { feats, arcs, shared, byId: new Map(feats.map((f) => [f.id, f])) };
}

// Albers equal-area conic, set up the way d3 does it so the US looks the way people expect.
function conic(p0, p1, lam0, lamC, phiC, k, tx, ty) {
  const s0 = Math.sin(p0 * D), n = (s0 + Math.sin(p1 * D)) / 2, c = 1 + s0 * (2 * n - s0), r0 = Math.sqrt(c) / n;
  const raw = (lam, phi) => { let dl = lam - lam0; dl = ((((dl + 180) % 360) + 360) % 360) - 180; const r = Math.sqrt(Math.max(0, c - 2 * n * Math.sin(phi * D))) / n, a = n * dl * D; return [r * Math.sin(a), r0 - r * Math.cos(a)]; };
  const pc = raw(lamC, phiC);
  const fwd = (lam, phi) => { const p = raw(lam, phi); return [tx + k * (p[0] - pc[0]), ty - k * (p[1] - pc[1])]; };
  const inv = (X, Y) => {
    const x = (X - tx) / k + pc[0], y = pc[1] - (Y - ty) / k, r0y = r0 - y;
    let l = Math.atan2(x, Math.abs(r0y)) * Math.sign(r0y); if (r0y * n < 0) l -= Math.PI * Math.sign(x) * Math.sign(r0y);
    return [lam0 + l / n / D, Math.asin(Math.max(-1, Math.min(1, (c - (x * x + r0y * r0y) * n * n) / (2 * n)))) / D];
  };
  return { fwd, inv };
}
// The lower 48 with Alaska and Hawaii tucked in under the south-west, in a 960 × 500 box.
export function albersUsa() {
  const k = 1070, x = 480, y = 250;
  const lower = conic(29.5, 45.5, -96, -96.6, 38.7, k, x, y);
  const alaska = conic(55, 65, -154, -156, 58.5, k * 0.35, x - 0.307 * k, y + 0.201 * k);
  const hawaii = conic(8, 18, -157, -160, 19.9, k, x - 0.205 * k, y + 0.212 * k);
  const pick = (lon, lat) => (lat > 50 && (lon < -129.5 || lon > 170) ? alaska : lat < 30 && lon < -150 ? hawaii : lower);
  const AK = [x - 0.425 * k, y + 0.12 * k, x - 0.214 * k, y + 0.234 * k], HI = [x - 0.214 * k, y + 0.166 * k, x - 0.115 * k, y + 0.234 * k];
  const inBox = (b, X, Y) => X >= b[0] && X <= b[2] && Y >= b[1] && Y <= b[3];
  return {
    fwd: (lon, lat, region) => (region === "AK" ? alaska : region === "HI" ? hawaii : region ? lower : pick(lon, lat)).fwd(lon, lat),
    inv: (X, Y) => (inBox(HI, X, Y) ? hawaii : inBox(AK, X, Y) ? alaska : lower).inv(X, Y),
  };
}
// Lambert azimuthal equal-area about a centre point: any country, any latitude, no seams near the centre.
export function azimuthal(lon0, lat0, R = 1000) {
  const s0 = Math.sin(lat0 * D), c0 = Math.cos(lat0 * D);
  return {
    fwd: (lon, lat) => {
      const dl = (lon - lon0) * D, sp = Math.sin(lat * D), cp = Math.cos(lat * D), cc = s0 * sp + c0 * cp * Math.cos(dl);
      if (cc < -0.6) return null; // far side of the globe: never drawn
      const kk = Math.sqrt(2 / (1 + cc));
      return [R * kk * cp * Math.sin(dl), -R * kk * (c0 * sp - s0 * cp * Math.cos(dl))];
    },
    inv: (X, Y) => {
      const x = X / R, y = -Y / R, rho = Math.hypot(x, y); if (rho < 1e-12) return [lon0, lat0];
      const c = 2 * Math.asin(Math.min(1, rho / 2)), sc = Math.sin(c), cc = Math.cos(c);
      const lat = Math.asin(Math.max(-1, Math.min(1, cc * s0 + (y * sc * c0) / rho))) / D;
      let lon = lon0 + Math.atan2(x * sc, rho * c0 * cc - y * s0 * sc) / D; lon = ((((lon + 180) % 360) + 360) % 360) - 180;
      return [lon, lat];
    },
  };
}

const ringBox = (r) => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const p of r) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; };
const ringArea = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(s / 2); };
const fmt = (v) => (Math.round(v * 100) / 100).toString();
function ringPath(r, close) { let d = ""; for (let i = 0; i < r.length; i++) d += (i ? "L" : "M") + fmt(r[i][0]) + "," + fmt(r[i][1]); return close ? d + "Z" : d; }
// Project a feature's rings; a ring with any point on the far side of the globe is dropped whole.
function projRings(f, fwd, region) {
  const out = [];
  for (const poly of f.polys) { const P = []; for (const ring of poly) { const r = []; let ok = true; for (const p of ring) { const q = fwd(p[0], p[1], region); if (!q) { ok = false; break; } r.push(q); } if (ok && r.length > 2) P.push(r); else if (!P.length) break; } if (P.length) out.push(P); }
  return out;
}
const pathOf = (polys) => polys.map((P) => P.map((r) => ringPath(r, true)).join("")).join("");
const boxOf = (polys) => { let b = [1e9, 1e9, -1e9, -1e9]; polys.forEach((P) => { const q = ringBox(P[0]); b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; }); return b; };
const grow = (b, f) => { const w = (b[2] - b[0]) * f, h = (b[3] - b[1]) * f; return [b[0] - w, b[1] - h, b[2] + w, b[3] + h]; };
const meet = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
// The part of a country worth framing: its biggest piece plus everything near it (so France is framed without French Guiana).
function mainBox(polys) {
  if (!polys.length) return null;
  const items = polys.map((P) => ({ b: ringBox(P[0]), a: ringArea(P[0]) })).sort((x, y) => y.a - x.a);
  let box = items[0].b.slice(); const left = items.slice(1);
  for (let pass = 0; pass < 6; pass++) {
    let any = false; const near = grow(box, 0.45);
    for (let i = left.length - 1; i >= 0; i--) if (meet(near, left[i].b)) { const q = left[i].b; box = [Math.min(box[0], q[0]), Math.min(box[1], q[1]), Math.max(box[2], q[2]), Math.max(box[3], q[3])]; left.splice(i, 1); any = true; }
    if (!any) break;
  }
  return box;
}
function linesPath(geo, fwd, want, regionOf) {
  let d = "";
  geo.arcs.forEach((a, j) => { if (!want(j)) return; const r = []; for (const p of a) { const q = fwd(p[0], p[1], regionOf ? regionOf(j) : undefined); if (!q) return; r.push(q); } d += ringPath(r, false); });
  return d;
}

// A country with its states or provinces: one shape per region, plus shared borders and the outer coast as two lines.
export function regionMap(geo, proj, composite) {
  const regions = geo.feats.map((f) => { const polys = projRings(f, proj.fwd, composite ? f.id : undefined); return { id: f.id, n: f.n, d: pathOf(polys), box: boxOf(polys), main: mainBox(polys) }; });
  let box = [1e9, 1e9, -1e9, -1e9]; regions.forEach((r) => { box = [Math.min(box[0], r.box[0]), Math.min(box[1], r.box[1]), Math.max(box[2], r.box[2]), Math.max(box[3], r.box[3])]; });
  const firstOwner = new Array(geo.arcs.length); geo.feats.forEach((f) => f.arcs.forEach((j) => { if (firstOwner[j] === undefined) firstOwner[j] = f.id; }));
  const regionOf = composite ? (j) => firstOwner[j] : null;
  return { regions, box, inner: linesPath(geo, proj.fwd, (j) => geo.shared[j], regionOf), outer: linesPath(geo, proj.fwd, (j) => !geo.shared[j], regionOf), land: "", proj };
}
// One country from the world file, framed on its main part, with everything else around it drawn faintly as land.
export function countryMap(world, id) {
  const f = world.byId.get(id); if (!f) return null;
  // centre on the biggest piece (in degrees), so far-off territories don't drag the view away
  let big = null, bigA = -1; f.polys.forEach((P) => { const b = ringBox(P[0]), a = ringArea(P[0]) * Math.cos(((b[1] + b[3]) / 2) * D); if (a > bigA) { bigA = a; big = b; } });
  const proj = azimuthal((big[0] + big[2]) / 2, (big[1] + big[3]) / 2);
  const polys = projRings(f, proj.fwd);
  let box = mainBox(polys) || [-10, -10, 10, 10];
  const min = 18; // never frame tighter than about 100 km across, or a city-state fills the screen as a blob
  if (box[2] - box[0] < min) { const m = (box[0] + box[2]) / 2; box[0] = m - min / 2; box[2] = m + min / 2; }
  if (box[3] - box[1] < min) { const m = (box[1] + box[3]) / 2; box[1] = m - min / 2; box[3] = m + min / 2; }
  const span = Math.max(box[2] - box[0], box[3] - box[1]), near = [box[0] - span * 2.5, box[1] - span * 2.5, box[2] + span * 2.5, box[3] + span * 2.5];
  let land = "";
  for (const g of world.feats) { if (g === f) continue; const pr = projRings(g, proj.fwd); const keep = pr.filter((P) => meet(near, ringBox(P[0]))); if (keep.length) land += pathOf(keep); }
  return { regions: [{ id, n: f.n, d: pathOf(polys), box, main: box }], box, inner: "", outer: "", land, proj };
}
// Fit a box into a w × h view with padding: returns the scale and offset that turn map units into pixels.
export function fitBox(b, w, h, pad = 16) {
  const bw = Math.max(1e-6, b[2] - b[0]), bh = Math.max(1e-6, b[3] - b[1]);
  const k = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  return { k, x: w / 2 - ((b[0] + b[2]) / 2) * k, y: h / 2 - ((b[1] + b[3]) / 2) * k };
}
// Which region holds a point given in degrees (used when you drop your own pin).
export function regionAt(geo, lon, lat) {
  const inRing = (r) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > lat) !== (b[1] > lat) && lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; };
  for (const f of geo.feats) for (const P of f.polys) if (inRing(P[0]) && !P.slice(1).some(inRing)) return f.id;
  return null;
}
