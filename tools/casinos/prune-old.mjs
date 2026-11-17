// Removes scouting-report research older than a cutoff (default: 7 years before today) from intel.json.
//   node tools/casinos/prune-old.mjs            # rewrite intel.json
//   node tools/casinos/prune-old.mjs --dry      # only print what would go
// Every fact in a report carries its source's date in the text ("CBJN Apr 2022", "a 2014 forum post"). A claim is
// judged by the newest date it cites; a claim citing only dates before the cutoff is dropped. When everything dated in
// a field is old the whole field goes, undated sentences included, since they came from the same old source. A bare
// year is taken as the middle of that year. In a bracketed list of sources only the old ones go. Numbers that only old
// text supported (table count, lowest minimum, best game) go with it, and a report left with nothing is removed.
// Then run build-data.mjs, check-map.mjs and ./build.sh.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), file = path.join(here, "intel.json"), dry = process.argv.includes("--dry");
const yearsArg = process.argv.find((a) => /^--years=/.test(a)), YEARS = yearsArg ? +yearsArg.split("=")[1] : 7;
const now = new Date(), CUT = (now.getFullYear() - YEARS) * 12 + now.getMonth(); // months since year 0
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// every date a piece of text cites, as [months, isOld]
export function datesIn(text) {
  // the year of a court case ("Uston v. Resorts, 1982") is not the date of the research
  const out = [], s = String(text || "").replace(/( v\.? [A-Z][\w.' ]*?),? (?:19|20)\d\d/g, "$1"), used = [];
  const re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(?:\d{1,2},?\s+)?((?:19|20)\d\d)\b/gi; let m;
  while ((m = re.exec(s))) { const k = +m[2] * 12 + MON[m[1].slice(0, 3).toLowerCase()]; out.push([k, k < CUT]); used.push([m.index, m.index + m[0].length]); }
  const ry = /(?<![$\d,.–-])\b((?:19|20)\d\d)\b(?![,.]?\d)/g;
  while ((m = ry.exec(s))) { if (used.some(([a, b]) => m.index >= a && m.index < b)) continue; const y = +m[1]; if (y > now.getFullYear() + 1) continue; out.push([y * 12 + 5, y * 12 + 5 < CUT]); } // a bare year is taken as the middle of that year
  return out;
}
const verdict = (text) => { const d = datesIn(text); if (!d.length) return "undated"; const newest = d.reduce((a, b) => (b[0] > a[0] ? b : a)); return newest[1] ? "old" : "fresh"; };
// sentences, keeping a trailing "(source, date)" with the sentence it closes
const sentences = (s) => String(s).split(/(?<=[.!?])(?<!\b(?:v|vs|c|ca|approx|incl|excl|St|Mt|No|est)\.)\s+(?=[A-Z0-9"“(])/).filter(Boolean);
// "(2021 CDC Gaming; 2010 forum posts)" → "(2021 CDC Gaming)": in a list of sources the old ones go, when a newer or
// undated one still stands behind the claim
const pruneSources = (s) => String(s).replace(/\(([^()]*;[^()]*)\)/g, (all, inner) => { const parts = inner.split(/;\s*/), keep = parts.filter((x) => verdict(x) !== "old"); return keep.length && keep.length < parts.length ? `(${keep.join("; ")})` : all; });
const splitSemi = (x) => x.split(/;\s+(?![^()]*\))/); // semicolons outside brackets separate claims
function pruneText(s0, semi) {
  const s = pruneSources(s0), parts = sentences(s).flatMap((x) => (semi ? splitSemi(x) : [x])), v = parts.map(verdict);
  if (!v.includes("old")) return s;
  if (!v.includes("fresh")) return null;
  const kept = parts.filter((_, i) => v[i] !== "old").map((x) => x.trim().replace(/[;,]$/, ""));
  return kept.map((x) => (/[.!?]$/.test(x) ? x : x + ".")).map((x) => x[0].toUpperCase() + x.slice(1)).join(" ");
}
const intel = JSON.parse(fs.readFileSync(file, "utf8")), log = []; let gone = 0;
for (const [id, r] of Object.entries(intel)) {
  const before = JSON.stringify(r);
  if (verdict(r.asOf) === "old") { delete intel[id]; gone++; log.push(`${id}: whole report (as of ${r.asOf})`); continue; }
  for (const k of ["tables", "pen", "hl", "heat", "other", "note"]) if (typeof r[k] === "string") { const t = pruneText(r[k], false); if (t == null) delete r[k]; else r[k] = t; }
  const hadGames = Array.isArray(r.games) && r.games.length;
  if (Array.isArray(r.games)) { r.games = r.games.map((g) => pruneText(g, true)).filter(Boolean); if (!r.games.length) delete r.games; }
  if (Array.isArray(r.src)) { r.src = r.src.filter((x) => verdict(x[0]) !== "old"); if (!r.src.length) delete r.src; }
  // numbers with nothing recent left to stand on: the "best game" must still be described by the text that is left
  // (its deck count and its soft-17 rule), and the lowest minimum must still be quoted somewhere
  const text = [r.tables, r.pen, r.hl, r.note, r.other, ...(r.games || [])].filter(Boolean).join(" \n ");
  if (r.best && before !== JSON.stringify(r)) {
    const b = r.best, dk = { 1: /single[- ]deck|\b1[- ]deck/i, 2: /double[- ]deck|\b2[- ]decks?\b|\btwo[- ]deck/i }[b.decks] || new RegExp(`(?<![\\d.])${b.decks}[- ]decks?\\b|${{ 4: "four", 6: "six", 8: "eight" }[b.decks]}[- ]deck`, "i");
    const okDecks = !b.decks || dk.test(text), okS17 = b.h17 == null || (b.h17 ? /\bH17\b|hits? (on )?soft 17/i : /\bS17\b|stands? on (all|soft) 17/i).test(text);
    if (!r.games || !okDecks || !okS17) { delete r.best; log.push(`${id}: best game dropped (only old text described it)`); }
  }
  if (r.min != null && before !== JSON.stringify(r) && !new RegExp(`\\$${r.min}(?!\\d)`).test(text)) { delete r.min; log.push(`${id}: lowest minimum dropped`); }
  if (!r.tables && !r.games) delete r.tablesN;
  const left = ["tables", "games", "best", "min", "pen", "hl", "heat", "other", "note"].some((k) => r[k] != null);
  if (!left) { delete intel[id]; gone++; log.push(`${id}: nothing recent left`); continue; }
  if (JSON.stringify(r) !== before) log.push(`${id}: trimmed (${before.length} → ${JSON.stringify(r).length} chars)`);
}
console.log(log.join("\n")); console.log(`\n${log.length} reports touched, ${gone} removed, ${Object.keys(intel).length} left. Cutoff: before ${Object.keys(MON)[CUT % 12]} ${Math.floor(CUT / 12)}.`);
if (!dry) fs.writeFileSync(file, JSON.stringify(intel, null, 1) + "\n");
