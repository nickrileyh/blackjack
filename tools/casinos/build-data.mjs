// Builds src/casino-data.js (the map outlines and the built-in casino list) for the Casinos page.
// Run it only when casinos.src.txt, intel.json or the map detail changes:
//   npm i --no-save mapshaper all-the-cities     (one-off tools; not needed to build the app itself)
//   node tools/casinos/build-data.mjs
// It downloads Natural Earth outlines (public domain) into tools/casinos/.cache, simplifies them, checks every casino's
// coordinates against its town (GeoNames) and its state outline, and stops if anything looks wrong.
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, "../.."), cache = path.join(here, ".cache");
const require = createRequire(path.join(root, "package.json"));
fs.mkdirSync(cache, { recursive: true });
const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";
const need = (f) => { const p = path.join(cache, f); if (!fs.existsSync(p)) { console.log("downloading", f); execFileSync("curl", ["-sSfL", "-o", p, NE + f], { stdio: "inherit" }); } return p; };
const A1 = need("ne_10m_admin_1_states_provinces_lakes.geojson"), A0 = need("ne_50m_admin_0_countries_lakes.geojson");
const ms = (args) => execFileSync(path.join(root, "node_modules/.bin/mapshaper"), args, { stdio: ["ignore", "ignore", "pipe"] });
const tmp = (n) => path.join(cache, n);

// ---- outlines (the "lakes" files cut the Great Lakes out, so Michigan and Ontario have their real shores) ----
const region = (cc, pct, island, out) => ms([A1, "-filter", `iso_a2=="${cc}"`, "-each", "id=postal,n=name", "-filter-fields", "id,n", "-simplify", "weighted", pct, "keep-shapes", "-filter-islands", "min-area=" + island, "-clean", "-o", "format=topojson", "quantization=60000", tmp(out)]);
region("US", "30%", "8km2", "us.json");
region("CA", "6%", "150km2", "ca.json");
const SKIP = ["ATA", "KAS", "ATC", "HMD", "SGS", "IOT", "ATF", "IOA"]; // no people, no casinos
ms([A0, "-filter", `!${JSON.stringify(SKIP)}.includes(ADM0_A3)`, "-each", "id=ADM0_A3,n=NAME_LONG", "-filter-fields", "id,n", "-simplify", "weighted", "18%", "keep-shapes", "-clean", "-o", "format=topojson", "quantization=60000", tmp("world.json")]);
const NAMES = { USA: "United States", CAN: "Canada", GBR: "United Kingdom", RUS: "Russia", KOR: "South Korea", PRK: "North Korea", MAC: "Macau", BRN: "Brunei", LAO: "Laos", CZE: "Czechia", COD: "DR Congo", COG: "Congo", MKD: "North Macedonia", SWZ: "Eswatini", CIV: "Côte d'Ivoire", GMB: "Gambia", BHS: "Bahamas", VAT: "Vatican City", CPV: "Cabo Verde", PSX: "Palestine", SAH: "Western Sahara", CYN: "Northern Cyprus", SOL: "Somaliland", KOS: "Kosovo", TWN: "Taiwan", HKG: "Hong Kong", FSM: "Micronesia", VIR: "U.S. Virgin Islands", VGB: "British Virgin Islands", ALD: "Åland", SXM: "Sint Maarten", MAF: "Saint Martin", BLM: "Saint Barthélemy", SPM: "Saint Pierre and Miquelon", STP: "São Tomé and Príncipe", CUW: "Curaçao", TLS: "Timor-Leste" };
const pack = (file, rename) => { const t = JSON.parse(fs.readFileSync(tmp(file))); delete t.bbox; const o = t.objects[Object.keys(t.objects)[0]]; t.objects = { a: o }; o.geometries.forEach((g) => { if (rename && rename[g.properties.id]) g.properties.n = rename[g.properties.id]; delete g.id; }); return JSON.stringify(t); };
const geo = { US: pack("us.json"), CA: pack("ca.json"), W: pack("world.json", NAMES) };

// ---- casinos ----
const cities = require("all-the-cities");
const CA_ADMIN = { "01": "AB", "02": "BC", "03": "MB", "04": "NB", "05": "NL", "07": "NS", "08": "ON", "09": "PE", "10": "QC", "11": "SK", "12": "YT", "13": "NT", "14": "NU" };
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\bst\.?\s/g, "saint ").replace(/\bste\.?\s/g, "sainte ").replace(/\bmt\.?\s/g, "mount ").replace(/[^a-z0-9]+/g, " ").trim();
const idx = new Map();
for (const c of cities) { if (c.country !== "US" && c.country !== "CA") continue; const st = c.country === "CA" ? CA_ADMIN[c.adminCode] : c.adminCode; const k = c.country + "|" + st + "|" + norm(c.name); const prev = idx.get(k); if (!prev || c.population > prev.population) idx.set(k, c); }
const polys = {}; for (const f of JSON.parse(fs.readFileSync(A1)).features) { const p = f.properties; if (p.iso_a2 === "US" || p.iso_a2 === "CA") polys[p.iso_a2 + "|" + p.postal] = f.geometry; }
const inRing = (pt, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
const inGeom = (pt, g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).some((poly) => inRing(pt, poly[0]) && !poly.slice(1).some((h) => inRing(pt, h)));
const km = (a, b, c, d) => { const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r; return 6371 * Math.hypot(x, y); };
// distance to the outline itself (point to segment), so a riverfront casino a few metres over the simplified line passes
const distGeom = (pt, g) => { let best = 1e9; const kx = 111.32 * Math.cos(pt[1] * Math.PI / 180), ky = 110.57; for (const poly of g.type === "Polygon" ? [g.coordinates] : g.coordinates) for (const ring of poly) for (let i = 1; i < ring.length; i++) { const ax = (ring[i - 1][0] - pt[0]) * kx, ay = (ring[i - 1][1] - pt[1]) * ky, bx = (ring[i][0] - pt[0]) * kx, by = (ring[i][1] - pt[1]) * ky, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0; const d = Math.hypot(ax + t * dx, ay + t * dy); if (d < best) best = d; } return best; };
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/['’!]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
let cc = null, st = null; const list = [], ids = new Set(), problems = [], spots = new Map();
for (const raw of fs.readFileSync(path.join(here, "casinos.src.txt"), "utf8").split("\n")) {
  const line = raw.trim(); if (!line || line.startsWith("#")) continue;
  if (line.startsWith("@")) { [cc, st] = line.slice(1).split(/\s+/); if (!polys[cc + "|" + st]) problems.push("no outline for " + line); continue; }
  const [city, name, ll, idOverride] = line.split("|").map((x) => x.trim());
  if (!city || !name || /[|\t]/.test(name)) { problems.push("bad line: " + line); continue; }
  const hit = idx.get(cc + "|" + st + "|" + norm(city));
  let lat, lon;
  if (ll) { [lat, lon] = ll.split(",").map(Number); if (hit) { const d = km(lat, lon, hit.loc.coordinates[1], hit.loc.coordinates[0]); if (d > 40) problems.push(`${name}: ${d.toFixed(0)} km from ${city}, ${st}`); } }
  else if (hit) { lon = hit.loc.coordinates[0]; lat = hit.loc.coordinates[1]; }
  else { problems.push(`${name}: no coordinates and ${city}, ${st} isn't a known town`); continue; }
  if (!(lat > 17 && lat < 72 && lon < -50 && lon > -170)) { problems.push(`${name}: coordinates out of range`); continue; }
  const g = polys[cc + "|" + st];
  if (g && !inGeom([lon, lat], g)) { const d = distGeom([lon, lat], g); if (d > 3) problems.push(`${name}: ${d.toFixed(1)} km outside ${st}`); }
  const id = idOverride || `${cc.toLowerCase()}-${st.toLowerCase()}-${slug(name)}`;
  if (ids.has(id)) problems.push("duplicate id " + id); ids.add(id);
  const k = lat.toFixed(4) + "," + lon.toFixed(4); if (spots.has(k)) problems.push(`${name} sits exactly on ${spots.get(k)}`); spots.set(k, name);
  list.push([id, name, city, st, +lat.toFixed(4), +lon.toFixed(4)]);
}
if (problems.length) { console.error("Fix these first:\n  " + problems.join("\n  ")); process.exit(1); }

// ---- keep every pin inside its own state on the simplified outline ----
// A riverfront or beachfront casino can land a few hundred metres over the drawn line (Laughlin in Arizona, Wheeling in
// Ohio, Biloxi in the Gulf). Those pins are nudged just inside their own state so the map never shows them across a border.
const { unpack } = await import(path.join(root, "src/casino-map.js"));
const drawn = { us: unpack(JSON.parse(geo.US)), ca: unpack(JSON.parse(geo.CA)) };
const inside = (f, lon, lat) => f.polys.some((P) => inRing([lon, lat], P[0]) && !P.slice(1).some((h) => inRing([lon, lat], h)));
let moved = 0, far = 0; const atSea = [];
for (const r of list) {
  const f = drawn[r[0].slice(0, 2)].byId.get(r[3]); let lat = r[4], lon = r[5];
  if (inside(f, lon, lat)) continue;
  const other = drawn[r[0].slice(0, 2)].feats.find((g) => g !== f && inside(g, lon, lat)); // drawn inside a neighbouring state?
  const kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.57; let best = 1e9, bx = 0, by = 0;
  for (const P of f.polys) for (const ring of P) for (let i = 1; i < ring.length; i++) { const ax = (ring[i - 1][0] - lon) * kx, ay = (ring[i - 1][1] - lat) * ky, cx = (ring[i][0] - lon) * kx, cy = (ring[i][1] - lat) * ky, dx = cx - ax, dy = cy - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0, px = ax + t * dx, py = ay + t * dy, d = Math.hypot(px, py); if (d < best) { best = d; bx = px; by = py; } }
  // out at sea is left alone when it's far from the drawn coast: a barrier island the outline doesn't show (Atlantic City)
  if (!other && best > 2.5) { atSea.push(`${r[1]} (${best.toFixed(1)} km)`); continue; }
  let done = false;
  for (const step of [0.6, 0.3, 0.12, 0.04]) { const s = (best + step) / (best || 1), nlon = lon + (bx * s) / kx, nlat = lat + (by * s) / ky; if (inside(f, nlon, nlat)) { r[4] = +nlat.toFixed(4); r[5] = +nlon.toFixed(4); done = true; break; } }
  if (!done) { console.error(`couldn't place ${r[1]} inside ${r[3]}`); process.exit(1); }
  moved++; if (best > far) far = best;
  if (best > 6) { console.error(`${r[1]} is ${best.toFixed(1)} km outside ${r[3]} on the drawn map — check its coordinates`); process.exit(1); }
}
console.log(`pins nudged inside their own state: ${moved} (furthest ${far.toFixed(1)} km)`);
if (atSea.length) console.log("left off the drawn coast: " + atSea.join(", "));

// ---- scouting reports ----
const intelFile = path.join(here, "intel.json");
const intel = fs.existsSync(intelFile) ? JSON.parse(fs.readFileSync(intelFile, "utf8")) : {};
const LIMITS = { asOf: 12, tables: 190, hl: 280, pen: 190, heat: 280, other: 220, note: 280 }, BEST = { where: "string", decks: "number", h17: "boolean", das: "boolean", ls: "boolean", rsa: "boolean", bj65: "boolean", pen: "number", min: "number", max: "number" };
const bad = [];
for (const [k, v] of Object.entries(intel)) {
  if (!ids.has(k)) { bad.push(`${k}: unknown casino id`); continue; }
  for (const f of Object.keys(v)) if (!(f in LIMITS) && !["tablesN", "min", "games", "best", "src"].includes(f)) bad.push(`${k}: unknown field ${f}`);
  for (const [f, n] of Object.entries(LIMITS)) if (v[f] != null && (typeof v[f] !== "string" || !v[f].trim() || v[f].length > n)) bad.push(`${k}.${f}: must be text of at most ${n} characters`);
  for (const f of ["tablesN", "min"]) if (v[f] != null && !(Number.isInteger(v[f]) && v[f] > 0 && v[f] < 2000)) bad.push(`${k}.${f}: must be a whole number`);
  if (v.games != null && !(Array.isArray(v.games) && v.games.length <= 6 && v.games.every((g) => typeof g === "string" && g.trim() && g.length <= 200))) bad.push(`${k}.games: up to 6 lines of at most 200 characters`);
  if (v.best != null) { if (typeof v.best !== "object" || Array.isArray(v.best)) bad.push(`${k}.best: must be an object`); else for (const [f, x] of Object.entries(v.best)) if (!BEST[f] || typeof x !== BEST[f]) bad.push(`${k}.best.${f}: unexpected or wrong type`); }
  if (!(Array.isArray(v.src) && v.src.length >= 1 && v.src.length <= 6 && v.src.every((x) => Array.isArray(x) && x.length === 2 && typeof x[0] === "string" && x[0].trim() && /^https:\/\/[^\s"<>]+$/.test(x[1])))) bad.push(`${k}.src: 1–6 [label, https url] pairs are required`);
}
if (bad.length) { console.error("intel.json problems:\n  " + bad.join("\n  ")); process.exit(1); }


const q = (s) => JSON.stringify(s);
const out = `// GENERATED by tools/casinos/build-data.mjs — don't edit by hand. Edit tools/casinos/casinos.src.txt or intel.json and rebuild.
// Outlines: Natural Earth (public domain). Each is a TopoJSON string, parsed only when the Casinos page first opens.
export const GEO_US = ${q(geo.US)};
export const GEO_CA = ${q(geo.CA)};
export const GEO_WORLD = ${q(geo.W)};
// id | name | town | state or province | latitude | longitude
export const CASINO_ROWS = ${q(list.map((r) => r.join("|")).join("\n"))};
// Scouting reports gathered from public sources, keyed by casino id.
export const CASINO_INTEL = ${q(JSON.stringify(intel))};
`;
fs.writeFileSync(path.join(root, "src/casino-data.js"), out);
const kb = (s) => (s.length / 1024).toFixed(0) + " KB";
console.log(`casinos: ${list.length} (US ${list.filter((r) => r[0].startsWith("us-")).length}, Canada ${list.filter((r) => r[0].startsWith("ca-")).length}) · reports: ${Object.keys(intel).length}`);
console.log(`outlines: US ${kb(geo.US)}, Canada ${kb(geo.CA)}, world ${kb(geo.W)} · file ${kb(out)}`);
