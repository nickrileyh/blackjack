// Independent checks of the app's arithmetic: payouts, hand values, the normal curve, drawdown odds, the calculator's
// formulas (EV, swing, risk of ruin, N0, session bankroll) and ~70 strategy and count-play spot checks against the charts.
// Run:  tools/checks/run.sh      (it prints "all N checks passed" or each failure)
// 12 v 5, 12 v 6 and 13 v 3 at negative counts are not tested: the app follows BJA's chart, which leaves those plays out.
import { correctPlay, DEFAULT_RULES, DEFAULT_BETS, COUNTS, calFor, compute, PhiN, pDip, sessionCash, handValue, settle, drawdownFromMix, autoRph, roundFreqs } from "./app-x.jsx";
let bad = 0, n = 0; const ok = (name, cond, info = "") => { n++; if (!cond) { bad++; console.log("FAIL", name, info); } };
const near = (name, a, b, tol) => { if (process.env.MARGINS && /pDip|vs simulation/.test(name)) console.log("  margin", (Math.abs(a - b) / tol).toFixed(2), name); ok(name, Math.abs(a - b) <= tol, `got ${a} want ${b} ±${tol}`); };
// ---- normal curve
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
let worst = 0; for (let z = -4; z <= 4; z += 0.05) worst = Math.max(worst, Math.abs(PhiN(z) - 0.5 * (1 + erf(z / Math.SQRT2))));
ok("PhiN matches the normal curve", worst < 2e-6, "worst " + worst); near("PhiN(0)", PhiN(0), 0.5, 1e-6); near("PhiN(1.96)", PhiN(1.96), 0.975, 2e-4);
// ---- chance of dipping x below the start within T, against a brute-force walk
// The walks use their own seeded random numbers, so a run always gives the same answer: these checks used to fail now
// and then on sampling noise alone. A walk is also only looked at once a step, which misses dips between looks, so each
// step adds the exact chance that the path touched the line in between (a Brownian bridge) — no bias left to hide in
// the tolerance.
let _seed = +process.env.SEED || 20261116; const rand = () => { _seed = (_seed + 0x6D2B79F5) | 0; let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const touched = (a, b, vr) => rand() < Math.exp((-2 * a * b) / vr); // a and b: height above the line at each end of a step with variance vr
for (const [mu, sd, T, x] of [[20, 600, 6, 1500], [35, 450, 4, 800], [0, 500, 8, 2000], [60, 900, 10, 1000]]) {
  const steps = 400, dt = T / steps, paths = 20000; let hit = 0;
  for (let p = 0; p < paths; p++) { let w = 0; for (let i = 0; i < steps; i++) { const a = w; w += mu * dt + sd * Math.sqrt(dt) * gauss(); if (w <= -x || touched(a + x, w + x, sd * sd * dt)) { hit++; break; } } }
  near(`pDip mu=${mu} sd=${sd} T=${T} x=${x}`, pDip(x, mu, sd, T), hit / paths, 0.02);
}
// ---- hand values and payouts
const c = (...r) => r.map((rank) => ({ rank, suit: "♠" }));
const hv = (cards) => { const v = handValue(c(...cards)); return `${v.total}${v.soft ? "s" : ""}${v.bust ? "x" : ""}`; };
[[[11, 6], "17s"], [[11, 6, 10], "17"], [[11, 11], "12s"], [[11, 11, 9], "21s"], [[10, 6, 6], "22x"], [[11, 5, 5], "21s"], [[11, 5, 10, 5], "21"], [[9, 9, 11, 11, 11], "21"], [[10, 11], "21s"]].forEach(([cs, want]) => ok("handValue " + cs, hv(cs) === want, hv(cs)));
const st = (p, d, flags = {}) => settle(c(...p), c(...d), 100, flags);
[["blackjack pays 3:2", st([11, 10], [10, 9]), 150], ["blackjack at 6:5", st([11, 10], [10, 9], { bj65: true }), 120], ["both blackjack push", st([11, 10], [10, 11]), 0], ["dealer blackjack beats 21", st([7, 7, 7], [11, 10]), -100],
 ["21 after a split is not a blackjack", st([11, 10], [10, 9], { split: true }), 100], ["split 21 loses to dealer blackjack", st([11, 10], [10, 11], { split: true }), -100], ["player bust loses even if dealer busts", st([10, 6, 9], [10, 6, 10]), -100],
 ["dealer bust pays", st([10, 3], [10, 6, 10]), 100], ["higher total wins", st([10, 9], [10, 8]), 100], ["lower total loses", st([10, 7], [10, 8]), -100], ["equal totals push", st([10, 8], [9, 9]), 0], ["surrender loses half", st([10, 6], [10, 10], { surrendered: true }), -50],
 ["soft 21 from three cards beats 20", st([11, 5, 5], [10, 10]), 100]].forEach(([name, got, want]) => ok(name, got === want, `got ${got} want ${want}`));
// ---- the calculator
for (const R of [DEFAULT_RULES, { ...DEFAULT_RULES, decks: 8 }, { ...DEFAULT_RULES, decks: 2 }, { ...DEFAULT_RULES, h17: !DEFAULT_RULES.h17 }]) for (const seats of [2, 4]) {
  const cal = calFor(R, seats), bets = { ...DEFAULT_BETS }, tag = `${R.decks}D ${R.h17 ? "H17" : "S17"} ${seats}p`;
  const r = compute({ bankroll: 10000, handsPerHour: 80, bets, cal });
  near(tag + " count frequencies add to 1", r.rows.reduce((s, x) => s + x.f, 0), 1, 1e-6);
  ok(tag + " edge rises with the count", r.rows.every((x, i) => i === 0 || x.edge > r.rows[i - 1].edge - 1e-4), r.rows.map((x) => (x.edge * 100).toFixed(2)).join(" "));
  const e0 = r.rows.find((x) => x.c === 0).edge; ok(tag + " house edge at a neutral count is plausible", e0 < 0.002 && e0 > -0.012, (e0 * 100).toFixed(2) + "%");
  const slope = (r.rows.find((x) => x.c === 4).edge - r.rows.find((x) => x.c === 0).edge) / 4; ok(tag + " about half a percent per true count", slope > 0.0035 && slope < 0.0075, (slope * 100).toFixed(3) + "%/TC");
  let ev = 0, ex2 = 0; r.rows.forEach((x) => { ev += x.f * x.bet * x.edge * x.sp; });
  near(tag + " EV per round is the weighted sum", r.evHand, ev, 1e-9); near(tag + " EV per hour", r.evHour, r.evHand * 80, 1e-9); near(tag + " SD per hour", r.sdHour, Math.sqrt(r.varHand * 80), 1e-9);
  near(tag + " risk of ruin formula", r.ror, r.evHand <= 0 ? 1 : Math.min(1, Math.exp((-2 * r.evHand * 10000) / r.varHand)), 1e-12);
  near(tag + " N0", r.n0, r.varHand / (r.evHand * r.evHand), 1e-6 * r.n0);
  // swing per unit bet should be near the textbook 1.1–1.2 units for one hand
  const flat = compute({ bankroll: 10000, handsPerHour: 80, bets: Object.fromEntries(COUNTS.map((k) => [k, 100])), cal });
  const sdUnits = Math.sqrt(flat.varHand) / 100; ok(tag + " flat-bet swing per round is about 1.15 units", sdUnits > 1.08 && sdUnits < 1.22, sdUnits.toFixed(3));
  if (R.decks >= 6) ok(tag + " flat betting loses in a shoe", flat.evHand < 0, flat.evHand.toFixed(3)); else ok(tag + " flat betting is near break-even at best", flat.evHand < 0.25, flat.evHand.toFixed(3));
  if (r.evHand > 0) {  // risk of ruin against a brute-force walk with the same drift and swing, half the bankroll to make ruin common
    const B = 0.35 * r.varHand / r.evHand, paths = 3000, cap = 40 * r.n0, chunk = Math.max(1, Math.round(r.n0 / 4000)); let ruin = 0;
    for (let p = 0; p < paths; p++) { let w = B; for (let t = 0; t < cap; t += chunk) { const a = w; w += r.evHand * chunk + Math.sqrt(r.varHand * chunk) * gauss(); if (w <= 0 || touched(a, w, r.varHand * chunk)) { ruin++; break; } if (w > 12 * B) break; } }
    near(tag + " risk of ruin vs simulation", Math.exp(-2 * r.evHand * B / r.varHand), ruin / paths, 0.035);
  }
}
// ---- session bankroll: the 99% and 95% figures really are those chances
{ const cal = calFor(DEFAULT_RULES, 4), r = compute({ bankroll: 10000, handsPerHour: 80, bets: DEFAULT_BETS, cal });
  for (const T of [2, 6, 12]) { near(`session cash for ${T}h: 1% chance of running out`, pDip(sessionCash(0.01, r.evHour, r.sdHour, T), r.evHour, r.sdHour, T), 0.01, 0.0005); near(`session cash for ${T}h: 5%`, pDip(sessionCash(0.05, r.evHour, r.sdHour, T), r.evHour, r.sdHour, T), 0.05, 0.002); } }
// ---- basic strategy spot checks against the published charts (S17 and H17, double after split, late surrender)
{ const S = { ...DEFAULT_RULES, decks: 6, h17: false, surrender: true, das: true }, H = { ...S, h17: true }, NS = { ...S, surrender: false };
  const o = { canDouble: true, canSplit: false, canSurrender: true }, sp = { ...o, canSplit: true };
  const P = (cards, up, R, opts = o, tc = 0) => correctPlay(c(...cards), up, tc, R, { rc: tc * 3, ...opts }).act;
  [["12 v 2", P([10, 2], 2, S), "H"], ["12 v 4", P([10, 2], 4, S), "S"], ["12 v 6", P([10, 2], 6, S), "S"], ["13 v 2", P([10, 3], 2, S), "S"], ["16 v 7", P([10, 6], 7, S), "H"], ["16 v 10 surrenders", P([10, 6], 10, S), "R"], ["16 v 10 without surrender", P([10, 6], 10, NS, { ...o, canSurrender: false }), "H"],
   ["15 v 10 surrenders", P([10, 5], 10, S), "R"], ["16 v 9 surrenders", P([10, 6], 9, S), "R"], ["16 v A surrenders", P([10, 6], 11, S), "R"], ["15 v A: S17 hits", P([10, 5], 11, S), "H"], ["15 v A: H17 surrenders", P([10, 5], 11, H), "R"], ["17 v A: H17 surrenders", P([10, 7], 11, H), "R"], ["17 v A: S17 stands", P([10, 7], 11, S), "S"],
   ["11 v A: S17 hits", P([6, 5], 11, S), "H"], ["11 v A: H17 doubles", P([6, 5], 11, H), "D"], ["11 v 10 doubles", P([6, 5], 10, S), "D"], ["10 v 10 hits", P([6, 4], 10, S), "H"], ["10 v 9 doubles", P([6, 4], 9, S), "D"], ["9 v 2 hits", P([5, 4], 2, S), "H"], ["9 v 3 doubles", P([5, 4], 3, S), "D"], ["9 v 7 hits", P([5, 4], 7, S), "H"], ["8 v 6 hits", P([5, 3], 6, S), "H"],
   ["A,2 v 4 hits", P([11, 2], 4, S), "H"], ["A,2 v 5 doubles", P([11, 2], 5, S), "D"], ["A,6 v 2 hits", P([11, 6], 2, S), "H"], ["A,6 v 3 doubles", P([11, 6], 3, S), "D"], ["A,7 v 2: S17 stands", P([11, 7], 2, S), "S"], ["A,7 v 2: H17 doubles", P([11, 7], 2, H), "D"], ["A,7 v 7 stands", P([11, 7], 7, S), "S"], ["A,7 v 9 hits", P([11, 7], 9, S), "H"],
   ["A,8 v 6: S17 stands", P([11, 8], 6, S), "S"], ["A,8 v 6: H17 doubles", P([11, 8], 6, H), "D"], ["A,9 v 6 stands", P([11, 9], 6, S), "S"],
   ["A,A splits", P([11, 11], 10, S, sp), "P"], ["8,8 v 10 splits", P([8, 8], 10, S, sp), "P"], ["8,8 v A: S17 splits", P([8, 8], 11, S, sp), "P"], ["8,8 v A: H17 surrenders", P([8, 8], 11, H, sp), "R"], ["10,10 v 6 stands", P([10, 10], 6, S, sp), "S"], ["9,9 v 7 stands", P([9, 9], 7, S, sp), "S"], ["9,9 v 9 splits", P([9, 9], 9, S, sp), "P"], ["9,9 v 10 stands", P([9, 9], 10, S, sp), "S"],
   ["7,7 v 7 splits", P([7, 7], 7, S, sp), "P"], ["7,7 v 8 hits", P([7, 7], 8, S, sp), "H"], ["6,6 v 2 splits (DAS)", P([6, 6], 2, S, sp), "P"], ["6,6 v 7 hits", P([6, 6], 7, S, sp), "H"], ["5,5 v 9 doubles", P([5, 5], 9, S, sp), "D"], ["4,4 v 5 splits (DAS)", P([4, 4], 5, S, sp), "P"], ["4,4 v 4 hits", P([4, 4], 4, S, sp), "H"], ["3,3 v 2 splits (DAS)", P([3, 3], 2, S, sp), "P"], ["2,2 v 8 hits", P([2, 2], 8, S, sp), "H"],
   // count plays
   ["16 v 10 at +1 stands (no surrender)", P([10, 6], 10, NS, { ...o, canSurrender: false }, 1), "S"], ["15 v 10 at +4 stands", P([10, 5], 10, NS, { ...o, canSurrender: false }, 4), "S"], ["15 v 10 at +3 hits", P([10, 5], 10, NS, { ...o, canSurrender: false }, 3), "H"], ["12 v 3 at +2 stands", P([10, 2], 3, S, o, 2), "S"], ["12 v 3 at +1 hits", P([10, 2], 3, S, o, 1), "H"], ["12 v 2 at +3 stands", P([10, 2], 2, S, o, 3), "S"],
   ["10,10 v 6 at +4 splits", P([10, 10], 6, S, sp, 4), "P"], ["10,10 v 5 at +5 splits", P([10, 10], 5, S, sp, 5), "P"], ["10,10 v 5 at +4 stands", P([10, 10], 5, S, sp, 4), "S"], ["10 v 10 at +4 doubles", P([6, 4], 10, S, o, 4), "D"], ["11 v A S17 at +1 doubles", P([6, 5], 11, S, o, 1), "D"], ["9 v 2 at +1 doubles", P([5, 4], 2, S, o, 1), "D"], ["9 v 7 at +3 doubles", P([5, 4], 7, S, o, 3), "D"],
   ["10 v A S17 at +4 doubles", P([6, 4], 11, S, o, 4), "D"], ["10 v A H17 at +3 doubles", P([6, 4], 11, H, o, 3), "D"], ["13 v 2 at -1 hits", P([10, 3], 2, S, o, -1), "H"], ["12 v 6 H17 at -1 stands", P([10, 2], 6, H, o, -1), "S"],
  ].forEach(([name, got, want]) => ok("strategy: " + name, got === want, `got ${got} want ${want}`)); }
console.log(bad ? `${bad} of ${n} checks FAILED` : `all ${n} checks passed`);
