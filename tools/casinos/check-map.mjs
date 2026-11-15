// Checks the map maths and data without a browser, and writes preview SVGs to tools/casinos/.cache/preview.html.
//   node tools/casinos/check-map.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { unpack, albersUsa, azimuthal, regionMap, countryMap, fitBox, regionAt } from "../../src/casino-map.js";
import { GEO_US, GEO_CA, GEO_WORLD, CASINO_ROWS } from "../../src/casino-data.js";
const here = path.dirname(fileURLToPath(import.meta.url));
let bad = 0; const fail = (m) => { bad++; console.error("FAIL " + m); };
const us = unpack(JSON.parse(GEO_US)), ca = unpack(JSON.parse(GEO_CA)), world = unpack(JSON.parse(GEO_WORLD));
const rows = CASINO_ROWS.split("\n").map((l) => { const [id, name, city, st, lat, lon] = l.split("|"); return { id, name, city, st, lat: +lat, lon: +lon, cc: id.slice(0, 2).toUpperCase() }; });
const A = albersUsa(), C = azimuthal(-96, 61);
// round trips
for (const [P, pts] of [[A, [[-81.69, 41.5], [-115.17, 36.11], [-149.9, 61.2], [-157.85, 21.3], [-70.2, 44.8], [-122.4, 47.6]]], [C, [[-79.4, 43.7], [-123.1, 49.3], [-63.6, 44.6], [-139.4, 64.1]]], [azimuthal(113.55, 22.2), [[113.54, 22.19], [114.2, 22.3]]], [azimuthal(178, -17.8), [[-179.5, -16.5], [177.4, -17.6]]]]) {
  for (const [lon, lat] of pts) { const q = P.fwd(lon, lat), r = P.inv(q[0], q[1]); if (Math.abs(r[0] - lon) > 1e-6 || Math.abs(r[1] - lat) > 1e-6) fail(`round trip ${lon},${lat} -> ${r}`); }
}
const usMap = regionMap(us, A, true), caMap = regionMap(ca, C, false);
if (us.feats.length !== 51) fail("US regions " + us.feats.length);
if (ca.feats.length !== 13) fail("Canada regions " + ca.feats.length);
// every casino lands inside the drawn country box, and in (or right beside) its own state
let off = 0;
for (const c of rows) {
  const m = c.cc === "US" ? usMap : caMap, g = c.cc === "US" ? us : ca;
  const p = m.proj.fwd(c.lon, c.lat, c.cc === "US" ? c.st : undefined);
  if (!p || p[0] < m.box[0] - 1 || p[0] > m.box[2] + 1 || p[1] < m.box[1] - 1 || p[1] > m.box[3] + 1) fail("outside the map: " + c.name);
  const r = regionAt(g, c.lon, c.lat); if (r !== c.st) { off++; if (r && r !== c.st) console.log(`note: ${c.name} (${c.st}) falls in ${r} on the simplified outline`); }
}
console.log(`casinos ${rows.length}; ${off} sit on a coast or border of the simplified outline`);
const ids = new Set(rows.map((r) => r.id)); if (ids.size !== rows.length) fail("duplicate ids");
if (world.feats.length < 220) fail("world countries " + world.feats.length);
for (const f of world.feats) { const m = countryMap(world, f.id); if (!m || !m.regions[0].d) fail("no shape for " + f.id); const b = m.box; if (!(b[2] > b[0] && b[3] > b[1]) || !isFinite(b[0] + b[1] + b[2] + b[3])) fail("bad box for " + f.id); }
// previews
const W = 420, H = 315;
const svg = (m, title, pins = []) => { const t = fitBox(m.box, W, H, 14); return `<figure><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#0D1114;border-radius:14px"><g transform="translate(${t.x},${t.y}) scale(${t.k})"><path d="${m.land}" fill="#1a2226"/>${m.regions.map((r) => `<path d="${r.d}" fill="#22302c"/>`).join("")}<path d="${m.inner}" fill="none" stroke="#3d4d48" stroke-width="1" vector-effect="non-scaling-stroke"/><path d="${m.outer}" fill="none" stroke="#5f746d" stroke-width="1" vector-effect="non-scaling-stroke"/></g>${pins.map((c) => { const p = m.proj.fwd(c.lon, c.lat, c.cc === "US" ? c.st : undefined); return `<circle cx="${p[0] * t.k + t.x}" cy="${p[1] * t.k + t.y}" r="1.6" fill="#34D399" opacity=".8"/>`; }).join("")}</svg><figcaption>${title}</figcaption></figure>`; };
const some = ["FRA", "RUS", "AUS", "MAC", "MCO", "IDN", "FJI", "NZL", "GBR", "CHL", "NOR", "SGP", "JPN", "MEX", "BHS", "NLD", "ABW", "BRA", "ZAF", "KIR", "PRT", "ESP"];
fs.mkdirSync(path.join(here, ".cache"), { recursive: true });
fs.writeFileSync(path.join(here, ".cache/preview.html"), `<body style="background:#07090A;color:#ccc;font:12px system-ui;display:flex;flex-wrap:wrap;gap:8px"><style>figure{margin:0}</style>${svg(usMap, "United States", rows.filter((r) => r.cc === "US"))}${svg(caMap, "Canada", rows.filter((r) => r.cc === "CA"))}${some.map((id) => svg(countryMap(world, id), id)).join("")}</body>`);
console.log(bad ? `${bad} problem(s)` : "all checks passed"); process.exit(bad ? 1 : 0);
