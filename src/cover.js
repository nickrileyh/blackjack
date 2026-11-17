// Cover plays: what each one costs at every true count, layered on top of the calibrated game.
// The numbers come from the card simulator (tools/sim), which played hundreds of millions of rounds twice from the
// same cards — once normally, once with the cover play — so each cost is measured directly rather than estimated.
// They were measured at three table sizes and every penetration from 50% to 90%, because a play that depends on
// the count is worth more when more cards have been seen by the time you act.
import { CALV } from "./coverdata.js";
import { DEV_DEFS } from "./sim.js";

const COUNTS = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
const UP = (u) => (u === 11 ? "A" : String(u));
const HAND = (key) => (key === 200 ? "10,10" : key > 100 ? `A,${key - 100}` : `Hard ${key}`);
const HKEY = (key) => (key === 200 ? "TT" : key > 100 ? `A${key - 100}` : String(key));
const ACT = { H: "hit", S: "stand", D: "double", P: "split", R: "surrender" };

// The count plays (Illustrious 18 + Fab 4), with the id the simulator knows them by.
export const DEVIATIONS = DEV_DEFS.map(([up, key, s17, h17, below, above, ls, edge], i) => ({
  edge: edge || 0, n: i, id: `${HKEY(key)}v${UP(up)}${ls === 1 ? "_sur" : ""}`, hand: HAND(key), up: UP(up), s17: s17 === 9999 ? null : s17, h17: h17 === 9999 ? null : h17, below, above, surrenderOnly: ls === 1, noSurrenderOnly: ls === 0,
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

const E_SC = 2.5e5, M_SC = 5e4;
const _dec = {};
function decode(key) {
  if (_dec[key] !== undefined) return _dec[key];
  const rec = CALV[key]; if (!rec) return (_dec[key] = null);
  const arr = (b64) => { const bin = atob(b64), o = new Float64Array(bin.length / 2); for (let i = 0; i < o.length; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; o[i] = v; } return o; };
  const a = arr(rec.b), row = (o, sc) => Array.from(a.subarray(o, o + 10), (x) => x / sc);
  const dev = {}, rest = {}; let p = 0;
  rec.d.forEach((nm) => { dev[nm] = { e: row(p, E_SC), m2: row(p + 10, M_SC), c12: row(p + 20, M_SC) }; p += 30; });
  const scale = a.subarray(p, p + 810); p += 810; // [group 0..2][table size 0..2][pen 0..8][count 0..9], ×1000
  rec.r.forEach((nm) => { rest[nm] = { e: row(p, E_SC), lo: row(p + 10, E_SC), hi: row(p + 20, E_SC), o0: row(p + 30, E_SC), oh: row(p + 40, E_SC), m2: row(p + 50, M_SC), c12: row(p + 60, M_SC) }; p += 70; });
  const ce = {};
  if (rec.c) { const c = arr(rec.c), crow = (o, sc) => Array.from(c.subarray(o, o + 10), (x) => x / sc); let q = 0; (rec.cn || []).forEach((nm) => { const t = {}; [["f", 1e4], ["e", E_SC], ["m2", M_SC], ["c12", M_SC]].forEach(([k, sc]) => { t[k] = { ref: crow(q, sc), lo: crow(q + 10, sc), hi: crow(q + 20, sc) }; q += 30; }); ce[nm] = t; }); }
  return (_dec[key] = { dev, rest, scale, ce, hiO: rec.hi || 6 });
}
const cfgKey = (R) => `${[1, 2, 4, 6, 8].includes(+R.decks) ? +R.decks : 6}_${R.h17 ? 1 : 0}_${R.surrender ? 1 : 0}`;

// The tables for these rules at this penetration and table size: by(name) → { e, m2, c12 } per count (or null).
function tablesFor(R, seats) {
  const T = decode(cfgKey(R)); if (!T) return null;
  const pen = Math.min(90, Math.max(50, +R.pen || 75)), o = Math.min(T.hiO, Math.max(0, Math.round(+seats || 4) - 1));
  const xlo = pen < 75 ? (75 - pen) / 25 : 0, xhi = pen > 75 ? (pen - 75) / 15 : 0;
  const w0 = o < 2 ? (2 - o) / 2 : 0, wh = o > 2 ? (o - 2) / (T.hiO - 2) : 0;
  // count plays: scale grid, interpolated between the measured table sizes and penetrations
  const pf = (pen - 50) / 5, p0 = Math.min(7, Math.floor(pf)), pw = pf - p0;
  const [oa, ob, ow] = o <= 2 ? [0, 1, o / 2] : [1, 2, wh];
  const sc = (g, b) => { const at = (oi, pi) => T.scale[((g * 3 + oi) * 9 + pi) * 10 + b] / 1000; const lo = at(oa, p0) * (1 - pw) + at(oa, p0 + 1) * pw, hi = at(ob, p0) * (1 - pw) + at(ob, p0 + 1) * pw; return lo * (1 - ow) + hi * ow; };
  return {
    has: (nm) => !!(T.dev[nm] || T.rest[nm]),
    by(nm) {
      const d = T.dev[nm];
      if (d) { const g = +nm.slice(-1) - 1, k = COUNTS.map((_, b) => sc(g, b)); return { e: d.e.map((x, b) => x * k[b]), m2: d.m2.map((x, b) => x * k[b]), c12: d.c12.map((x, b) => x * k[b]) }; }
      const r = T.rest[nm]; if (!r) return null;
      return { e: r.e.map((x, b) => x + xlo * r.lo[b] + xhi * r.hi[b] + w0 * r.o0[b] + wh * r.oh[b]), m2: r.m2, c12: r.c12 };
    },
    ce(nm) { const t = T.ce[nm]; if (!t) return null; const at = (k) => t[k].ref.map((x, b) => x + xlo * t[k].lo[b] + xhi * t[k].hi[b]); return { f: at("f").map((x) => 1 + x), e: at("e"), m2: at("m2"), c12: at("c12") }; },
    hasCe: (nm) => !!T.ce[nm],
  };
}
// what has been measured for these rules (the assistant is only offered these)
export function coverAvail(R) {
  const T = tablesFor(R, 3); if (!T) return { habits: [], countMethods: [], miss: false, insurance: [], any: false };
  return { any: true, habits: Object.keys(HABITS).filter((h) => T.has("f" + HABITS[h][0])), insurance: Object.keys(INSURANCE_MODES).filter((m) => T.has("i" + INSURANCE_MODES[m])), countMethods: Object.keys(COUNT_METHODS).filter((m) => T.hasCe(COUNT_METHODS[m])), miss: T.hasCe("miss2") };
}
// a count play that doubles only exists where the table lets you double that hand
const dblAllowed = (R, key) => { const d = R.dbl === "9-11" ? 1 : R.dbl === "10-11" ? 2 : 0; if (d === 0) return true; if (key > 100) return false; return d === 1 ? key >= 9 && key <= 11 : key >= 10 && key <= 11; };

// The count plays that exist for these rules, described in words (for the catalog the assistant reads).
export function deviationCatalog(R) {
  return DEVIATIONS.filter((d) => (R.h17 ? d.h17 : d.s17) != null && (d.surrenderOnly ? !!R.surrender : true) && (d.above !== "D" || dblAllowed(R, DEV_DEFS[d.n][1]))).map((d) => {
    const idx = R.h17 ? d.h17 : d.s17;
    const play = idx === 0 && d.edge ? (d.edge > 0 ? `${ACT[d.above]} on any positive running count, otherwise ${ACT[d.below]}` : `${ACT[d.below]} on any negative running count, otherwise ${ACT[d.above]}`) : idx <= 0 ? `${ACT[d.below]} at true count −${1 - idx} or lower, otherwise ${ACT[d.above]}` : `${ACT[d.above]} at true count +${idx} or higher, otherwise ${ACT[d.below]}`;
    return { id: d.id, hand: d.hand, dealer: d.up, index: idx === 0 && d.edge ? (d.edge > 0 ? "0+" : "0−") : idx <= 0 ? idx - 1 : idx, play, ...(d.surrenderOnly ? { needs: "surrender, first two cards" } : {}), ...(d.noSurrenderOnly && R.surrender ? { note: "used when surrender isn't available (after a hit)" } : {}) };
  });
}

// cal: from calFor(R, seats). cover: { skip_all_deviations, … } (the shape the removed Ask tab used). Returns { cal, applied, skipped, approx }.
export function coverCal(cal, R, cover, shift) {
  const applied = [], skipped = [], approx = [];
  if (!cover || !Object.keys(cover).length) return { cal, applied, skipped, approx };
  // "Deviations: off" in the game rules already is basic strategy with no insurance (calFor in app.jsx took the count
  // plays off through this same function), so a cover that skips or forces them has nothing left to change
  if (R && R.devs === false && (cover.skip_all_deviations || (cover.deviations || []).length || (cover.insurance && cover.insurance !== "normal"))) {
    cover = { ...cover }; delete cover.skip_all_deviations; delete cover.deviations; delete cover.insurance;
    skipped.push("count plays and insurance (deviations are switched off in these rules, so the numbers are already basic strategy with no insurance)");
    if (!Object.keys(cover).length) return { cal, applied, skipped, approx };
  }
  const T = tablesFor(R, cal.seats);
  if (!T) return { cal, applied, skipped: ["cover-play data isn't loaded"], approx };
  const out = { ...cal, e: { ...cal.e }, m2: { ...cal.m2 }, c12: { ...cal.c12 } };
  const add = (r, w = 1) => COUNTS.forEach((c, i) => { out.e[c] += w * r.e[i]; out.m2[c] += w * r.m2[i]; out.c12[c] += w * r.c12[i]; });
  const use = (nm, label, w = 1) => { const r = T.by(nm); if (r) { add(r, w); applied.push(label); } else skipped.push(`${label} (never comes up with these rules, so it changes nothing)`); };
  // count plays
  const modes = {}, MODE = { skip: 1, basic: 1, always_high: 2, always_low: 3 };
  if (cover.skip_all_deviations) DEVIATIONS.forEach((d) => (modes[d.n] = 1));
  (cover.deviations || []).forEach((x) => { const d = DEVIATIONS.find((y) => y.id.toLowerCase() === String(x.play || x.id || "").toLowerCase()); const m = MODE[x.mode || "skip"]; if (!d || !m) { skipped.push(`unknown count play "${x.play || x.id}"`); return; } modes[d.n] = m; });
  let nAll = 0;
  Object.keys(modes).forEach((n) => {
    const d = DEVIATIONS[n], m = modes[n], nm = `d${n}_${m}`, key = DEV_DEFS[n][1], solo = !cover.skip_all_deviations || m !== 1;
    if (d.above === "D" && !dblAllowed(R, key)) { if (solo) skipped.push(`${d.id} (this table doesn't allow that double, so the play doesn't exist here)`); return; }
    const r = T.by(nm);
    if (r) { add(r); nAll++; if (solo) applied.push(`${d.id}: ${m === 1 ? "basic strategy only" : m === 2 ? `always ${ACT[d.above]}` : `always ${ACT[d.below]}`}`); }
    else if ((R.h17 ? d.h17 : d.s17) != null && (!d.surrenderOnly || R.surrender)) { if (solo) approx.push(`${d.id} is a count play here, but what it costs to skip or force it hasn't been measured (it comes up rarely and is worth very little, so the numbers barely move)`); }
    else if (solo) skipped.push(`${d.id} (not a play for these rules)`);
  });
  if (cover.skip_all_deviations) applied.push(`all ${nAll} count plays skipped (basic strategy only; insurance is set separately)`);
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
  if (cover.count_method && cover.count_method !== "half_deck") { const nm = COUNT_METHODS[cover.count_method], r = nm && T.ce(nm); if (r) useC(r, 1, `true count: ${cover.count_method.replace("_", " ")}`); else skipped.push(`count method "${cover.count_method}" (not measured for these rules)`); }
  if (cover.missed_cards_pct > 0) {
    const p = Math.min(8, cover.missed_cards_pct), a = T.ce("miss2"), b = T.ce("miss5");
    if (!a || !b) skipped.push("missed cards (not measured for these rules)");
    else if (p <= 2) useC(a, p / 2, `misses ${p}% of cards`);
    else { const w = (p - 2) / 3, mix = (k) => a[k].map((x, i) => x + w * (b[k][i] - x)); useC({ f: mix("f"), e: mix("e"), m2: mix("m2"), c12: mix("c12") }, 1, `misses ${p}% of cards`); }
  }
  // `shift` (when given) is that change in the mix of counts, measured by dealing this exact spread both ways — used for
  // spreads that sit out or play two hands, where when you do those things moves with the count you think you have
  if (fm.some((x) => Math.abs(x - 1) > 1e-9)) { out.fmul = shift && shift.length === 10 ? shift : fm; approx.push("Counting-method answers are the roughest numbers here. A different way of counting changes which true count you think you're at, which moves both how often you bet big and what those bets are worth. The direction and rough size are right, but treat the change as accurate to about 5% of the win rate."); }
  if (nAll > 0 && +R.decks === 1) approx.push("At single deck, treat the cost of changing count plays as accurate to about 15% of that cost: with so few rounds per deal it depends on exactly how many hands are on the table.");
  if ((R.das === false || +R.maxHands < 4 || R.rsa) && (cover.habits || []).some((h) => /split/.test(h))) approx.push("Split habits were measured with double-after-split and splitting to four hands; with this table's split rules the cost differs slightly.");
  return { cal: out, applied, skipped, approx };
}
