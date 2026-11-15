// Cover plays: what each one costs at every true count, layered on top of the calibrated game.
// The numbers come from the card simulator, which played hundreds of millions of rounds twice from the same cards —
// once normally, once with the cover play — so each cost is measured directly rather than estimated.
import { CALV } from "./coverdata.js";
import { DEV_DEFS } from "./sim.js";

const COUNTS = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
const UP = (u) => (u === 11 ? "A" : String(u));
const HAND = (key) => (key === 200 ? "10,10" : key > 100 ? `A,${key - 100}` : `Hard ${key}`);
const HKEY = (key) => (key === 200 ? "TT" : key > 100 ? `A${key - 100}` : String(key));
const ACT = { H: "hit", S: "stand", D: "double", P: "split", R: "surrender" };

// The count plays (Illustrious 18 + Fab 4), with the id the simulator knows them by.
export const DEVIATIONS = DEV_DEFS.map(([up, key, s17, h17, below, above, ls], i) => ({
  n: i, id: `${HKEY(key)}v${UP(up)}${ls === 1 ? "_sur" : ""}`, hand: HAND(key), up: UP(up), s17: s17 === 9999 ? null : s17, h17: h17 === 9999 ? null : h17, below, above, surrenderOnly: ls === 1, noSurrenderOnly: ls === 0,
}));
export const INSURANCE_MODES = { always: 1, tc1: 2, tc2: 3, tc4: 4, tc5: 5, even_money_always: 7, good_hands_always: 8 };
export const HABITS = {
  no_soft_doubles: [1, "never double a soft hand (hit or stand instead)"],
  stand_16: [2, "always stand on hard 16 against 7 through ace instead of hitting"],
  stand_15_16: [3, "always stand on hard 15 and 16 against 7 through ace instead of hitting"],
  no_splits: [4, "never split pairs other than aces and eights"],
  never_hit_soft_18: [5, "stand on soft 18 against 9, 10 and ace"],
  never_bust: [6, "never hit a hard 12 or higher (the 'no bust' player)"],
  no_split_8s_vs_high: [7, "don't split 8s against 9, 10 or ace (play them as 16)"],
  no_split_9s: [8, "never split 9s (stand on 18)"],
  no_double_9: [9, "never double a hard 9 (hit instead)"],
  no_double_vs_10_ace: [10, "never double 10 or 11 against a 10 or ace (hit instead)"],
  never_double: [11, "never double down at all"],
  stand_soft_17: [12, "stand on soft 17 (never hit or double A,6)"],
  mimic_dealer: [13, "play like the dealer: hit to 17, never double, split or surrender"],
};
export const COUNT_METHODS = { full_deck: "tcfull", exact: "tcexact", floor: "tcfloor", round_nearest: "tcround" };

const _rows = {};
function rowsFor(key) {
  if (_rows[key] !== undefined) return _rows[key];
  const rec = CALV[key]; if (!rec) return (_rows[key] = null);
  const dec = (b64) => { const bin = atob(b64), o = new Float64Array(bin.length / 2); for (let i = 0; i < o.length; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; o[i] = v; } return o; };
  const a = dec(rec.b), by = {};
  rec.v.forEach((nm, i) => { const o = i * 30; by[nm] = { e: Array.from(a.subarray(o, o + 10), (x) => x / 4e5), m2: Array.from(a.subarray(o + 10, o + 20), (x) => x / 1e5), c12: Array.from(a.subarray(o + 20, o + 30), (x) => x / 1e5) }; });
  const ce = {};
  if (rec.c) { const c = dec(rec.c); ["miss2", "miss5", "tcfull", "tcexact", "tcfloor", "tcround"].forEach((nm, i) => { const o = i * 40; if (o + 40 > c.length) return; ce[nm] = { f: Array.from(c.subarray(o, o + 10), (x) => x / 1e4), e: Array.from(c.subarray(o + 10, o + 20), (x) => x / 4e5), m2: Array.from(c.subarray(o + 20, o + 30), (x) => x / 1e5), c12: Array.from(c.subarray(o + 30, o + 40), (x) => x / 1e5) }; }); }
  return (_rows[key] = { by, ce });
}
const cfgKey = (R) => `${[1, 2, 4, 6, 8].includes(+R.decks) ? +R.decks : 6}_${R.h17 ? 1 : 0}_${R.surrender ? 1 : 0}`;
// what has been measured for these rules (the assistant is only offered these)
export function coverAvail(R) {
  const rows = rowsFor(cfgKey(R)); if (!rows) return { habits: [], countMethods: [], miss: false, insurance: [], any: false };
  return { any: true, habits: Object.keys(HABITS).filter((h) => rows.by["f" + HABITS[h][0]]), insurance: Object.keys(INSURANCE_MODES).filter((m) => rows.by["i" + INSURANCE_MODES[m]]), countMethods: Object.keys(COUNT_METHODS).filter((m) => rows.ce[COUNT_METHODS[m]]), miss: !!rows.ce.miss2 };
}
// a count play that doubles only exists where the table lets you double that hand
const dblAllowed = (R, key) => { const d = R.dbl === "9-11" ? 1 : R.dbl === "10-11" ? 2 : 0; if (d === 0) return true; if (key > 100) return false; return d === 1 ? key >= 9 && key <= 11 : key >= 10 && key <= 11; };

// The count plays that exist for these rules, described in words (for the catalog the assistant reads).
export function deviationCatalog(R) {
  return DEVIATIONS.filter((d) => (R.h17 ? d.h17 : d.s17) != null && (d.surrenderOnly ? !!R.surrender : true)).map((d) => {
    const idx = R.h17 ? d.h17 : d.s17;
    return { id: d.id, hand: d.hand, dealer: d.up, index: idx, play: `${ACT[d.above]} at true count ${idx >= 0 ? "+" : ""}${idx} or higher, otherwise ${ACT[d.below]}`, ...(d.surrenderOnly ? { needs: "surrender, first two cards" } : {}), ...(d.noSurrenderOnly && R.surrender ? { note: "used when surrender isn't available (after a hit)" } : {}) };
  });
}

// cal: from calFor(R, seats) with insurance on. cover: see the shape in aitools.js. Returns { cal, applied, skipped }.
export function coverCal(cal, R, cover) {
  const applied = [], skipped = [], approx = [];
  if (!cover || !Object.keys(cover).length) return { cal, applied, skipped, approx };
  const decks = [1, 2, 4, 6, 8].includes(+R.decks) ? +R.decks : 6, key = `${decks}_${R.h17 ? 1 : 0}_${R.surrender ? 1 : 0}`, rows = rowsFor(key);
  if (!rows) return { cal, applied, skipped: ["cover-play data isn't loaded"], approx };
  const out = { ...cal, e: { ...cal.e }, m2: { ...cal.m2 }, c12: { ...cal.c12 } };
  const add = (r, w = 1) => COUNTS.forEach((c, i) => { out.e[c] += w * r.e[i]; out.m2[c] += w * r.m2[i]; out.c12[c] += w * r.c12[i]; });
  const use = (nm, label, w = 1) => { const r = rows.by[nm]; if (r) { add(r, w); applied.push(label); } else skipped.push(`${label} (never comes up with these rules, so it changes nothing)`); };
  // count plays
  const modes = {};
  const MODE = { skip: 1, basic: 1, always_high: 2, always_low: 3 };
  if (cover.skip_all_deviations) DEVIATIONS.forEach((d) => (modes[d.n] = 1));
  (cover.deviations || []).forEach((x) => { const d = DEVIATIONS.find((y) => y.id.toLowerCase() === String(x.play || x.id || "").toLowerCase()); const m = MODE[x.mode || "skip"]; if (!d || !m) { skipped.push(`unknown count play "${x.play || x.id}"`); return; } modes[d.n] = m; });
  let nAll = 0;
  Object.keys(modes).forEach((n) => { const d = DEVIATIONS[n], m = modes[n], nm = `d${n}_${m}`, key = DEV_DEFS[n][1];
    if (d.above === "D" && !dblAllowed(R, key)) { if (!cover.skip_all_deviations) skipped.push(`${d.id} (this table doesn't allow that double, so the play doesn't exist here)`); return; }
    if (rows.by[nm]) { add(rows.by[nm]); nAll++; if (!cover.skip_all_deviations || m !== 1) applied.push(`${d.id}: ${m === 1 ? "basic strategy only" : m === 2 ? `always ${ACT[d.above]}` : `always ${ACT[d.below]}`}`); } else if (!cover.skip_all_deviations) skipped.push(`${d.id} (not a play for these rules)`); });
  if (cover.skip_all_deviations) applied.push(`all ${nAll} count plays skipped (basic strategy only; insurance handled separately)`);
  // insurance
  if (cover.insurance && cover.insurance !== "normal" && cover.insurance !== "never") { const v = INSURANCE_MODES[cover.insurance]; if (v) use(`i${v}`, `insurance: ${cover.insurance}`); else skipped.push(`unknown insurance option "${cover.insurance}"`); }
  // habits
  const dr = R.dbl === "9-11" ? 1 : R.dbl === "10-11" ? 2 : 0;
  (cover.habits || []).forEach((h) => {
    const f = HABITS[h]; if (!f) { skipped.push(`unknown habit "${h}"`); return; }
    if ((h === "no_soft_doubles" && dr > 0) || (h === "no_double_9" && dr === 2)) { skipped.push(`${h} (this table already doesn't allow those doubles, so it costs nothing extra)`); return; }
    use(`f${f[0]}`, `habit: ${f[1]}`);
    if (dr > 0 && (h === "never_double" || h === "mimic_dealer")) approx.push(`"${h}" was measured where any two cards can be doubled; with this table's double restriction it costs somewhat less than shown`);
  });
  // slips: measured at 5% of close decisions, and the cost scales with the rate
  if (cover.slip_rate_pct > 0) use("slip", `misplays ${cover.slip_rate_pct}% of close decisions`, Math.min(40, cover.slip_rate_pct) / 5);
  // counting: these change which count you think you're at, so the mix of counts moves too
  const fm = COUNTS.map(() => 1);
  const useC = (r, w, label) => { COUNTS.forEach((c, i) => { out.e[c] += w * r.e[i]; out.m2[c] += w * r.m2[i]; out.c12[c] += w * r.c12[i]; fm[i] *= 1 + w * (r.f[i] - 1); }); applied.push(label); };
  if (cover.count_method && cover.count_method !== "half_deck") { const nm = COUNT_METHODS[cover.count_method], r = nm && rows.ce[nm]; if (r) useC(r, 1, `true count: ${cover.count_method.replace("_", " ")}`); else skipped.push(`count method "${cover.count_method}"`); }
  if (cover.missed_cards_pct > 0 && rows.ce.miss2) {
    const p = Math.min(8, cover.missed_cards_pct), a = rows.ce.miss2, b = rows.ce.miss5;
    if (p <= 2) useC(a, p / 2, `misses ${p}% of cards`);
    else { const w = (p - 2) / 3; useC({ f: a.f.map((x, i) => x + w * (b.f[i] - x)), e: a.e.map((x, i) => x + w * (b.e[i] - x)), m2: a.m2.map((x, i) => x + w * (b.m2[i] - x)), c12: a.c12.map((x, i) => x + w * (b.c12[i] - x)) }, 1, `misses ${p}% of cards`); }
  }
  if (fm.some((x) => Math.abs(x - 1) > 1e-9)) { out.fmul = fm; approx.push("A different way of counting changes which true count you think you're at, so it also shifts how often you bet big or sit out. That part is modeled approximately: good to a few percent of the win rate, a little less exact for spreads that sit out or leave at low counts."); }
  // the tables were measured with 3 players at 75% penetration; count plays are worth a little more with more cards seen
  if (nAll > 0 && (Math.abs((+R.pen || 75) - 75) > 7 || cal.seats >= 5)) approx.push("The cost of changing count plays was measured at a 3-player table with 75% penetration. At this table it is likely a little higher than shown (count plays gain value with more players and deeper penetration) — treat it as accurate to within about a fifth of the cost.");
  if ((R.das === false || +R.maxHands < 4 || R.rsa) && ((cover.habits || []).some((h) => /split/.test(h)))) approx.push("Split habits were measured with double-after-split and splitting to four hands; with this table's split rules the cost differs slightly.");
  return { cal: out, applied, skipped, approx };
}
