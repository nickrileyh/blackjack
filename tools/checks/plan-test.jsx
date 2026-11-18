// Independent checks of the Plan tab's arithmetic (src/planner.jsx): the per-casino optimizer results against the
// calculator, table bankrolls against the risk-of-ruin formula, the bankroll simulation against closed forms and a
// separate random walk, session cash, the rotation's dates, and the scouting-report reader.
// Run:  tools/checks/run.sh
process.env.TZ = "America/New_York"; // the date checks cross a clock change
import { COUNTS, calFor, compute, pDip, PhiN, DEFAULT_RULES, optimizeSpread } from "./app.jsx";
import { scoreGame, scoreFor, cashFor, growthModel, growthSim, goalStats, restOf, restSet, nextUp, addDays, daysBetween, reportGame, scoreTone, gamesAt, ladderModel, averageGame, bankrollHistory, autoAt, optFor, dealSim } from "./planner.jsx";
let bad = 0, n = 0; const ok = (name, cond, info = "") => { n++; if (!cond) { bad++; console.log("FAIL", name, info); } };
const near = (name, a, b, tol) => ok(name, Math.abs(a - b) <= tol, `got ${a} want ${b} ±${tol}`);
const base = { rules: { ...DEFAULT_RULES, h17: true, surrender: true, decks: 6, pen: 75 }, seats: 4, spotsMap: {}, minBet: 25, maxBet: 500, hphAuto: true, handsPerHour: 100 };
const GAMES = [
  { rules: base.rules, min: 25, max: 500 }, { rules: { decks: 6, h17: false, das: true, pen: 75 }, min: 15, max: 500 }, { rules: { decks: 8, h17: true, das: true, pen: 80 }, min: 15, max: 2500 },
  { rules: { decks: 2, h17: true, das: true, pen: 60, dbl: "9-11" }, min: 25, max: 1000 }, { rules: { decks: 6, h17: true, pen: 70 }, min: 50, max: 1000 }, { rules: { decks: 6, h17: true, pen: 75, bj65: true }, min: 10, max: 500 }];

// ---- every casino's numbers: the optimizer's result is re-priced by the calculator, and beaten by no simple ramp
for (const B of [3000, 6000, 20000, 60000]) for (const cap of [2, 5, 20]) GAMES.forEach((g, gi) => {
  const setup = { ...base, bankroll: B, rorPct: cap }, x = scoreGame(setup, g), tag = `B ${B} cap ${cap}% game ${gi}`;
  const cal = calFor({ ...DEFAULT_RULES, ...g.rules }, 4), r = compute({ bankroll: B, handsPerHour: x.rph, bets: x.bets, cal, spotsMap: {} });
  ok(`${tag}: every hand is played inside the table limits`, COUNTS.every((c, i) => x.bets[c] >= g.min && x.bets[c] <= g.max && (i === 0 || x.bets[c] >= x.bets[COUNTS[i - 1]])), JSON.stringify(x.bets));
  if (x.loses) { ok(`${tag}: "no winning spread" is true of its bets`, r.evHour <= 0.01, `ev ${r.evHour}`); return; }
  near(`${tag}: $/hr`, x.ev, r.evHour, 1e-6 * Math.max(1, r.evHour)); near(`${tag}: swing`, x.sd, r.sdHour, 1e-6 * r.sdHour); near(`${tag}: risk of ruin`, x.ror, r.ror, 1e-9);
  ok(`${tag}: inside the limit unless flagged`, x.infeasible ? x.ror > cap / 100 : x.ror <= (cap / 100) * 1.001, `ror ${x.ror}`);
  near(`${tag}: fit is (bankroll ÷ bankroll needed)²`, x.fit, x.infeasible ? Math.pow(Math.log(x.ror) / Math.log(cap / 100), 2) : 1, 1e-9);
  // straight-line ramps from the minimum: none should be safer than the "safest" spread, or earn more inside the limit
  let safest = 1, most = -1e9;
  for (let top = g.min; top <= g.max; top += 5) for (let start = 0; start <= 3; start++) {
    const bets = {}; COUNTS.forEach((c) => (bets[c] = c <= start ? g.min : Math.round((g.min + ((top - g.min) * (c - start)) / (6 - start)) / 5) * 5));
    const q = compute({ bankroll: B, handsPerHour: x.rph, bets, cal, spotsMap: {} });
    if (q.ror < safest) safest = q.ror; if (q.ror <= cap / 100 && q.evHour > most) most = q.evHour;
  }
  if (x.infeasible) ok(`${tag}: no ramp is safer than the safest spread`, x.ror <= safest * 1.01, `opt ${x.ror} ramp ${safest}`);
  else ok(`${tag}: no ramp earns more inside the limit`, x.ev >= most * 0.99, `opt ${x.ev} ramp ${most}`);
  // session cash: the chance of dipping that far is 5% before the shoe-clustering factor
  const cash = cashFor(x, 4); if (x.ev > 0) ok(`${tag}: session cash`, cash > 0 && Math.abs(pDip(cash, x.ev, x.sd, 4) - 0.05) < 0.02, `pDip ${pDip(cash, x.ev, x.sd, 4)}`);
});
// ---- scores: absolute against the risk limit, so they follow the bankroll
{ const setup = { ...base, bankroll: 6000, rorPct: 5 }, ref = { ev: 20, sd: 400, ror: 0.05, fit: 1, infeasible: false, loses: false }, S = (x) => scoreFor({ ...ref, ...x }, ref, setup);
  near("a usual game inside the limit scores 50", S({}), 50, 0); near("twice the money scores 67", S({ ev: 40 }), 67, 0); near("half the money scores 33", S({ ev: 10 }), 33, 0);
  near("a losing game scores 0", S({ loses: true }), 0, 0); near("certain ruin scores 0", S({ ror: 1, infeasible: true, fit: 0 }), 0, 0);
  ok("same money, safer table, higher score", S({ ror: 0.01 }) > 50);
  // over the limit: the same money at 65% risk (the bankroll is 14% of what the bets need) is worth almost nothing
  const f = (ror) => Math.pow(Math.log(ror) / Math.log(0.05), 2);
  ok("65% risk scores under 5 even at three times the money", S({ ev: 60, ror: 0.65, infeasible: true, fit: f(0.65) }) < 5, String(S({ ev: 60, ror: 0.65, infeasible: true, fit: f(0.65) })));
  ok("a little over the limit lands in the 40s", S({ ror: 0.07, infeasible: true, fit: f(0.07) }) >= 40 && S({ ror: 0.07, infeasible: true, fit: f(0.07) }) < 50, String(S({ ror: 0.07, infeasible: true, fit: f(0.07) })));
  // a usual game that is itself too big for the bankroll is the yardstick as if it were safe, and scores low itself
  const big = { ...ref, ror: 0.58, infeasible: true, fit: f(0.58) };
  ok("a too-big usual game scores low itself", scoreFor(big, big, setup) < 5, String(scoreFor(big, big, setup)));
  ok("…and a 65%-risk table doesn't look good beside it", scoreFor({ ...ref, ev: 60, ror: 0.65, infeasible: true, fit: f(0.65) }, big, setup) < 5);
  ok("a losing usual game still leaves a yardstick", scoreFor({ ...ref, ev: 15 }, { ...ref, loses: true, ev: 0 }, setup) === 50);
  // the real thing: a $50 double-deck table against a growing bankroll — risk falls and the score climbs
  const dd = { rules: { decks: 2, h17: true, das: true, pen: 60, dbl: "9-11" }, min: 50, max: 3000 }; let prev = -1, prevRor = 2, list = [];
  for (const B of [5000, 10000, 20000, 40000, 80000, 160000]) { const su = { ...base, bankroll: B, rorPct: 5 }, x = scoreGame(su, dd), sc = scoreFor(x, scoreGame(su, GAMES[0]), su); list.push(`${B}:${sc}@${Math.round(x.ror * 100)}%`);
    ok(`$50 double deck, bankroll ${B}: the score rises as risk falls`, sc >= prev && x.ror <= prevRor + 0.005, list.join(" ")); prev = sc; prevRor = x.ror;
    if (B === 5000) ok("$50 double deck wrecks a $5,000 bankroll: score under 10", x.ror > 0.5 && sc < 10, `score ${sc} risk ${x.ror}`); }
  ok("…and is a good game once the bankroll is big enough", prev >= 50, list.join(" ")); }

// ---- table bankrolls: scaled bets at "move up" run exactly the risk limit, at "drop at" twice it
for (const B of [6000, 40000]) for (const risk of [0.02, 0.05, 0.1, 0.2]) {
  const setup = { ...base, bankroll: B, rorPct: 1e-7 }, safe = scoreGame(setup, GAMES[0]), m = growthModel(safe, B, risk), cal = calFor(base.rules, 4);
  ok(`model B ${B} ${risk}: built`, !!m && m.lv.length > 1);
  m.lv.forEach((l) => {
    const bets = {}; COUNTS.forEach((c) => (bets[c] = safe.bets[c] * l.k));
    near(`B ${B} ${risk} $${l.m}: risk at "move up"`, compute({ bankroll: l.need, handsPerHour: safe.rph, bets, cal, spotsMap: {} }).ror, risk, risk * 1e-6);
    near(`B ${B} ${risk} $${l.m}: risk at "drop at"`, compute({ bankroll: l.down, handsPerHour: safe.rph, bets, cal, spotsMap: {} }).ror, 2 * risk, risk * 1e-6);
    near(`B ${B} ${risk} $${l.m}: $/hr scales with the table`, l.ev, compute({ bankroll: B, handsPerHour: safe.rph, bets, cal, spotsMap: {} }).evHour, 1e-6 * l.ev);
  });
  const cur = m.cur; ok(`B ${B} ${risk}: "you're here" is the biggest table the bankroll covers`, !cur || (cur.need <= B * 1.0005 && m.lv.every((l) => l.need <= B * 1.0005 ? l.m <= cur.m : true)));
  // "getting there": a separate fine-grained walk between going broke and the next table's bankroll
  const nx = m.lv.find((l) => l.state === "later"), at = cur || null;
  if (nx && at && nx === m.lv[m.lv.indexOf(at) + 1]) {
    let s = 987654321 >>> 0; const u = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return (s + 0.5) / 4294967296; }, z = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
    const dt = Math.pow((nx.need - B) / at.sd / 40, 2), P = 4000; let hit = 0, hrs = 0;
    for (let p = 0; p < P; p++) { let b = B, t = 0; while (b > 0 && b < nx.need) { b += at.ev * dt + at.sd * Math.sqrt(dt) * z(); t += dt; } if (b >= nx.need) { hit++; hrs += t; } }
    near(`B ${B} ${risk}: chance of reaching the next table`, nx.chance, hit / P, 0.035);
  }
}

// ---- the bankroll simulation at one table, against closed forms
for (const [B, ev, sd, T] of [[6000, 4, 180, 208], [6000, 10, 350, 400], [20000, 44, 1800, 416], [6000, 9, 250, 832], [8000, 12, 500, 8736]]) {
  const s = growthSim({ B, lv: [{ m: 5, need: 0, down: 0, ev, sd }], hours: T }), last = s.pts[s.pts.length - 1], N = s.N, tag = `sim B ${B} ev ${ev} sd ${sd} T ${T}`;
  const se = (p) => 3.5 * Math.sqrt((p * (1 - p)) / N) + 0.004, bust = pDip(B, ev, sd, T);
  near(`${tag}: going broke`, s.bust, bust, se(bust));
  if (bust < 0.02) {
    const sdT = sd * Math.sqrt(T), g = B * 1.5;
    near(`${tag}: typical bankroll`, last.mid, B + ev * T, (3.5 * 1.2533 * sdT) / Math.sqrt(N) + 0.03 * sdT);
    near(`${tag}: 10th percentile`, last.lo, B + ev * T - 1.2816 * sdT, 0.12 * sdT); near(`${tag}: 90th percentile`, last.hi, B + ev * T + 1.2816 * sdT, 0.12 * sdT);
    near(`${tag}: chance of a loss`, s.below, PhiN((-ev * Math.sqrt(T)) / sd), se(0.4) + bust);
    near(`${tag}: reaching a target`, goalStats(s, g).p, pDip(g - B, -ev, sd, T), se(0.4) + bust);
  }
  near(`${tag}: tables add up`, s.end.reduce((a, b) => a + b, 0), 1, 1e-9);
}
{ // long enough to be "forever": the simulated ruin matches the risk-of-ruin formula the whole page is built on
  const B = 5000, ev = 15, sd = 450, s = growthSim({ B, lv: [{ m: 5, need: 0, down: 0, ev, sd }], hours: 8736 * 4 });
  near("sim: going broke over a very long time is the risk of ruin", s.bust, Math.exp((-2 * ev * B) / (sd * sd)), 0.03);
  // moving up and dropping back: a table you can never reach changes nothing; the same seed gives the same picture
  const one = growthSim({ B, lv: [{ m: 5, need: 0, down: 0, ev, sd }], hours: 400 }), two = growthSim({ B, lv: [{ m: 5, need: 0, down: 0, ev, sd }, { m: 10, need: 1e12, down: 5e11, ev: 2 * ev, sd: 2 * sd }], hours: 400 });
  near("sim: an unreachable table changes nothing", two.pts[two.pts.length - 1].mid, one.pts[one.pts.length - 1].mid, 1e-6); near("sim: same inputs, same answer", growthSim({ B, lv: [{ m: 5, need: 0, down: 0, ev, sd }], hours: 400 }).bust, one.bust, 0);
  { const G = 9000, th = (2 * ev) / (sd * sd), far = growthSim({ B, lv: [{ m: 5, need: 0, down: 0, ev, sd }, { m: 10, need: G, down: 0, ev: 2 * ev, sd: 2 * sd }], hours: 60000 });
    near("sim: share that ever reach the next table", far.reach[1].p, (1 - Math.exp(-th * B)) / (1 - Math.exp(-th * G)), 0.03);
    ok("sim: half the paths reach it sooner than the average wait", far.reach[1].med != null && far.reach[1].med < (G - B) / ev, `median ${far.reach[1].med} mean ${(G - B) / ev}`); near("sim: the table you start at is already reached", far.reach[0].p, 1, 0); }
  // your own spread, as Bet spread prices it, drives the bankroll side: any spread works, not only an optimizer's
  { const cal = calFor(base.rules, 4), bets = { "-3": 0, "-2": 0, "-1": 0, 0: 0, 1: 25, 2: 50, 3: 50, 4: 75, 5: 75, 6: 100 }, r = compute({ bankroll: 6000, handsPerHour: 100, bets, cal, spotsMap: {} });
    const m = growthModel({ ev: r.evHour, sd: r.sdHour, mn: 25, bets }, 6000, 0.05);
    ok("own spread: model built", !!m); m.lv.forEach((l) => { const sb = {}; COUNTS.forEach((c) => (sb[c] = bets[c] * l.k)); near(`own spread $${l.m}: risk at "move up"`, compute({ bankroll: l.need, handsPerHour: 100, bets: sb, cal, spotsMap: {} }).ror, 0.05, 1e-7); });
    ok("own spread: a losing spread has no plan", growthModel({ ev: -3, sd: 300, mn: 25, bets }, 6000, 0.05) === null); ok("own spread: no table minimum, no plan", growthModel({ ev: 10, sd: 300, mn: 0, bets }, 6000, 0.05) === null); }
  const up = growthSim({ B, lv: [{ m: 5, need: 0, down: 0, ev, sd }, { m: 10, need: 6000, down: 4500, ev: 2 * ev, sd: 2 * sd }], hours: 2000 });
  ok("sim: moving up widens the range", up.pts[up.pts.length - 1].hi > growthSim({ B, lv: [{ m: 5, need: 0, down: 0, ev, sd }], hours: 2000 }).pts.slice(-1)[0].hi);
  ok("sim: bankrolls never go below zero", up.pts.every((p) => p.lo >= 0 && p.lo <= p.mid && p.mid <= p.hi));
}

// ---- the whole ladder (move up, drop back) against a separate walk in 3-minute steps: every stat on "Where it's
// heading" and the "getting there" shares, for the spread the page is usually shown with and for a rougher one
for (const [B, ev, sd, T, risk] of [[20000, 17.35, 281, 416, 0.05], [6000, 9, 250, 832, 0.1], [20000, 17.35, 281, 832, 0.2]]) {
  const bets = { "-3": 0, "-2": 0, "-1": 0, 0: 0, 1: 25, 2: 50, 3: 50, 4: 75, 5: 75, 6: 100 }, m = growthModel({ ev, sd, mn: 25, bets }, B, risk), lv = m.lv, tag = `ladder B ${B} risk ${risk} T ${T}`;
  const sim = growthSim({ B, lv, hours: T }), last = sim.pts[sim.pts.length - 1], goal = B * 2;
  let s = 246813579 >>> 0; const u = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return (s + 0.5) / 4294967296; }, z = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const P = 6000, dt = 0.05, sq = Math.sqrt(dt), steps = Math.round(T / dt), fin = new Float64Array(P), dds = new Float64Array(P), ever = lv.map(() => 0), end = lv.map(() => 0);
  let l0 = 0; lv.forEach((l, i) => { if (l.need <= B * 1.0005) l0 = i; });
  let bust = 0, below = 0, hitGoal = 0;
  for (let p = 0; p < P; p++) {
    let b = B, l = l0, pk = B, dd = 0, mx = B, top = l0;
    for (let i = 0; i < steps && b > 0; i++) {
      b += lv[l].ev * dt + lv[l].sd * sq * z();
      if (b <= 0) { b = 0; dd = pk; break; }
      if (b > mx) mx = b; if (b > pk) pk = b; else if (pk - b > dd) dd = pk - b;
      while (l < lv.length - 1 && b >= lv[l + 1].need) l++;
      if (l > top) top = l;
      while (l > 0 && b < lv[l].down) l--;
    }
    fin[p] = b; dds[p] = dd; if (b <= 0) bust++; if (b < B) below++; if (mx >= goal) hitGoal++; for (let j = 0; j <= top; j++) ever[j]++; end[l]++;
  }
  fin.sort(); dds.sort(); const q = (a, f) => a[Math.floor(f * P)], rel = (name, a, b, tol) => near(`${tag}: ${name}`, a, b, tol * Math.max(Math.abs(b), B * 0.2));
  rel("typical bankroll", last.mid, q(fin, 0.5), 0.05); rel("10th percentile", last.lo, q(fin, 0.1), 0.08); rel("90th percentile", last.hi, q(fin, 0.9), 0.08);
  rel("25th percentile", last.q1, q(fin, 0.25), 0.07); rel("75th percentile", last.q3, q(fin, 0.75), 0.07);
  near(`${tag}: chance of a loss`, sim.below, below / P, 0.035); near(`${tag}: going broke`, sim.bust, bust / P, 0.02);
  near(`${tag}: reaching a target`, goalStats(sim, goal).p, hitGoal / P, 0.035);
  rel("typical worst dip", sim.ddMid, q(dds, 0.5), 0.08); rel("worst dip, 1 in 10", sim.ddBad, q(dds, 0.9), 0.08);
  lv.forEach((x, j) => { near(`${tag}: share that reach $${x.m} tables`, sim.reach[j].p, ever[j] / P, 0.035); near(`${tag}: share ending at $${x.m} tables`, sim.end[j], end[j] / P, 0.035); });
  ok(`${tag}: the bands nest`, sim.pts.every((p) => p.lo <= p.q1 && p.q1 <= p.mid && p.mid <= p.q3 && p.q3 <= p.hi));
  if (B === 20000 && T === 416 && risk === 0.05) console.log(`  (ladder, $20k, 1 year: page ${Math.round(last.lo)} / ${Math.round(last.mid)} / ${Math.round(last.hi)}, separate walk ${Math.round(q(fin, 0.1))} / ${Math.round(q(fin, 0.5))} / ${Math.round(q(fin, 0.9))}; staying put would be ${Math.round(B + lv[l0].ev * T - 1.2816 * lv[l0].sd * Math.sqrt(T))} / ${Math.round(B + lv[l0].ev * T)} / ${Math.round(B + lv[l0].ev * T + 1.2816 * lv[l0].sd * Math.sqrt(T))})`);
}

// ---- rotation dates
const D = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).getTime(); }, R = restSet({ base: 7, backed: 90 });
near("a week across the clock change is 7 days", daysBetween(D("2026-10-28"), D("2026-11-04")), 7, 0); near("adding 7 days lands on the same weekday at midnight", addDays(D("2026-10-28"), 7), D("2026-11-04"), 0);
near("spring clock change too", addDays(D("2027-03-10"), 7), D("2027-03-17"), 0); near("yesterday evening to this morning is 1 day", daysBetween(new Date(2026, 10, 15, 22, 0).getTime(), new Date(2026, 10, 16, 8, 0).getTime()), 1, 0);
const cas = (id, sess, mark) => ({ id, name: id, sess, mark });
near("a plain visit rests 7 days", restOf(cas("a", { n: 1, last: "2026-11-09", dates: ["2026-11-09"] }), R).until, D("2026-11-16"), 0);
near("watched last time rests 21", restOf(cas("a", { n: 1, last: "2026-11-09", dates: ["2026-11-09"], lastHeat: "watched" }), R).until, D("2026-11-30"), 0);
near("three visits in 30 days rests 21", restOf(cas("a", { n: 3, last: "2026-11-09", dates: ["2026-10-15", "2026-11-01", "2026-11-09"] }), R).until, D("2026-11-30"), 0);
near("two visits in 30 days rests 7", restOf(cas("a", { n: 3, last: "2026-11-09", dates: ["2026-10-01", "2026-11-01", "2026-11-09"] }), R).until, D("2026-11-16"), 0);
near("high heat rests 42", restOf(cas("a", { n: 1, last: "2026-11-09", dates: ["2026-11-09"] }, { heat: 3 }), R).until, D("2026-12-21"), 0);
near("one back-off rests 90 days from the back-off", restOf(cas("a", { n: 2, last: "2026-11-10", dates: ["2026-11-01", "2026-11-10"], backed: "2026-11-10", backedN: 1 }), R).until, addDays(D("2026-11-10"), 90), 0);
near("a second back-off rests 180", restOf(cas("a", { n: 2, last: "2026-11-10", dates: ["2026-11-01", "2026-11-10"], backed: "2026-11-10", backedN: 2 }), R).until, addDays(D("2026-11-10"), 180), 0);
ok("never played is ready", restOf(cas("a", null, { status: "been" }), R).until === null);
{ const today = D("2026-11-16"), rows = ["a", "b", "c", "d", "e", "f", "g"].map((id) => { const c = cas(id, null, { status: "been" }); return { c, ...restOf(c, R) }; });
  const plan = nextUp(rows, today, () => 50);
  ok("one pick and two alternates", plan.length === 3 && new Set(plan.map((v) => v.c.id)).size === 3 && plan.every((v) => v.ready && v.t === today), plan.map((v) => v.c.id).join());
  ok("fewer casinos, fewer alternates", nextUp(rows.slice(0, 2), today, () => 50).length === 2 && nextUp([], today, () => 50).length === 0);
  // a is resting until the 21st, b (medium heat) until the 23rd, c has never been played: c first, then by the day each is back
  const mix = [cas("a", { n: 1, last: "2026-11-14", dates: ["2026-11-14"] }), cas("b", { n: 1, last: "2026-11-02", dates: ["2026-11-02"] }, { heat: 2 }), cas("c", null, { status: "been" })].map((c) => ({ c, ...restOf(c, R) })), p2 = nextUp(mix, today, () => 50);
  ok("a ready casino comes before a resting one, then the soonest back", p2.map((v) => v.c.id).join() === "c,a,b" && p2[0].ready && !p2[1].ready, p2.map((v) => v.c.id + daysBetween(today, v.t)).join(" "));
  ok("a resting casino is offered for the day its rest ends, never sooner", p2.slice(1).every((v) => v.t === mix.find((x) => x.c.id === v.c.id).until && v.t > today));
  const sc = (c) => (c.id === "g" ? 100 : 0), tie = ["f", "g"].map((id) => { const c = cas(id, { n: 1, last: id === "g" ? "2026-11-02" : "2026-11-01", dates: [] }); return { c, ...restOf(c, R) }; });
  ok("a much better game wins a near-tie on rest", nextUp(tie, today, sc)[0].c.id === "g"); ok("without scores the longer-rested goes first", nextUp(tie, today, () => null)[0].c.id === "f");
  const bk = [cas("x", { n: 1, last: "2026-09-01", dates: ["2026-09-01"], backed: "2026-09-01", backedN: 1 })].map((c) => ({ c, ...restOf(c, R) })), pb = nextUp(bk, today, () => 50);
  ok("a backed-off casino comes back only when its rest ends", pb.length === 1 && !pb[0].ready && pb[0].back && daysBetween(D("2026-09-01"), pb[0].t) === 90);
  ok("once that rest is over it is offered as a first visit back", nextUp(bk, D("2026-12-05"), () => 50)[0].ready && nextUp(bk, D("2026-12-05"), () => 50)[0].back);
}

// ---- reading a scouting report's game lines
const rg = (s) => reportGame(s);
{ const a = rg("Main floor: 8 decks, H17, DAS, $15–$2,500, about 20 tables, 1.5 decks cut off (Current Blackjack News, Apr 2022).");
  ok("report: main floor", a && a.label === "Main floor" && a.rules.decks === 8 && a.rules.h17 && a.rules.das && a.min === 15 && a.max === 2500 && a.rules.pen === 80 && !a.rules.surrender, JSON.stringify(a));
  const b = rg("6 decks, H17, DAS, $15–$1000, about 1.8 decks cut (Apr 2022 CBJN)."); ok("report: '1.8 decks cut' is the cut, not 8 decks", b && b.rules.decks === 6 && b.rules.pen === 70, JSON.stringify(b));
  const c = rg("Double deck, H17, double on 9–11 only, no mid-shoe entry, $50–$3000, about 1 deck cut (Apr 2022 CBJN)."); ok("report: double deck", c && c.rules.decks === 2 && c.rules.pen === 50 && c.rules.dbl === "9-11" && !c.rules.das, JSON.stringify(c));
  const d = rg("High limit: 6 decks, S17, DAS, LS, resplit aces to 3, $100–$3000, about 1.5 decks cut; 6 tables (Apr 2022 CBJN)."); ok("report: high limit", d && !d.rules.h17 && d.rules.surrender && d.rules.rsa && d.rules.pen === 75 && d.min === 100, JSON.stringify(d));
  ok("report: 6:5 tables are left out", rg("Low-limit tables: 6 decks, H17, $10–$500, all paying 6:5.") === null); ok("report: side games are left out", rg("Spanish 21: 6 decks, H17, $10–$500, about 3 tables.") === null);
  ok("report: a line without limits is left out", rg("6 decks, S17, DAS, no surrender per a 2014 forum post.") === null); }

// ---- a report's summary game takes its doubling and resplit limits from the line that spells the same game out
{
  const it = { best: { decks: 2, h17: true, das: true, pen: 75, min: 25, max: 1000 }, games: ["Double deck pitch with cut card, H17, double on 9–11 only, DAS, no mid-shoe entry, $25–$1000, about 0.5 deck cut (Apr 2022 CBJN).", "6 decks, H17, DAS, late surrender, $15–$1000, about 1 deck cut (Apr 2022 CBJN)."] };
  const gs = gamesAt({ intel: it });
  ok("report: the same game isn't listed twice", gs.length === 2, JSON.stringify(gs.map((g) => g.label)));
  ok("report: the best game keeps the doubling limit its line states", gs[0].rules.dbl === "9-11" && gs[0].rules.decks === 2 && gs[0].rules.pen === 75);
  ok("report: the other game is untouched", gs[1].rules.decks === 6 && gs[1].rules.surrender === true && gs[1].rules.dbl === "any" && gs[1].rules.pen === 85, JSON.stringify(gs[1].rules));
  const setup = { ...base, bankroll: 20000, rorPct: 5 }, free = scoreGame(setup, { rules: { ...gs[0].rules, dbl: "any" }, min: 25, max: 1000 }), tied = scoreGame(setup, gs[0]);
  ok("report: a doubling limit lowers what the game earns", tied.ev < free.ev, `${tied.ev} vs ${free.ev}`);
  ok("report: your own saved game is used instead of the report", gamesAt({ intel: it, mark: { games: [{ rules: { decks: 6, h17: true }, min: 10, max: 300 }] } }).length === 1);
}

// ---- moving up and dropping back: every hand played, the best bets for each table (ladderModel)
for (const [nm, su] of [["6D H17 LS $25-500", base], ["2D H17 $50-1000", { ...base, rules: { ...DEFAULT_RULES, decks: 2, h17: true, pen: 60 }, minBet: 50, maxBet: 1000 }]]) for (const risk of [0.02, 0.05, 0.2]) {
  const L = ladderModel(su, risk), cal = calFor({ ...DEFAULT_RULES, ...su.rules }, 4), ratio = su.maxBet / su.minBet, tag0 = `ladder ${nm} ${risk}`;
  ok(`${tag0}: built`, L.lv.length >= 6, `levels ${L.lv.length}`);
  // the optimizer on its own, as the page's casino scores call it: the most $/hr inside the limit, or nothing
  const best = (m, B) => { const x = optimizeSpread({ B, mn: m, mx: Math.max(m, Math.round((ratio * m) / 5) * 5), cal, entry: -3, belowMode: "min", spotsMap: {}, rorCap: risk }); return x.ev > 0 && x.ror <= risk * 1.001 ? x.ev * L.rph : 0; };
  L.lv.forEach((l, i) => {
    const tag = `${tag0} $${l.m}`, at = compute({ bankroll: l.need, handsPerHour: L.rph, bets: l.bets, cal, spotsMap: {} }), dn = compute({ bankroll: l.down, handsPerHour: L.rph, bets: l.bets, cal, spotsMap: {} });
    ok(`${tag}: every hand is played, inside the table's limits`, COUNTS.every((c, k) => l.bets[c] >= l.m && l.bets[c] <= l.mx && (k === 0 || l.bets[c] >= l.bets[COUNTS[k - 1]])), JSON.stringify(l.bets));
    near(`${tag}: $/hr`, l.ev, at.evHour, 1e-6 * at.evHour); near(`${tag}: swing`, l.sd, at.sdHour, 1e-4 * at.sdHour);
    ok(`${tag}: at "move up" the bets run the risk limit`, at.ror <= risk * 1.002 && at.ror >= risk * 0.93, `ror ${at.ror}`);
    near(`${tag}: at "drop at" that risk has doubled`, dn.ror, 2 * risk, 0.012 * risk);
    if (!i) { ok(`${tag}: nothing wins inside the limit with 4% less`, best(l.m, l.need * 0.96) === 0, String(best(l.m, l.need * 0.96))); return; }
    const p = L.lv[i - 1];
    ok(`${tag}: a bigger table needs more`, l.need > p.need && l.down > p.down && l.down < l.need && l.ev > p.ev, `${p.need} → ${l.need}`);
    // the rule itself: from "move up" on the bigger table earns as much, and a tenth short of it the smaller earns more
    ok(`${tag}: at "move up" it earns what the smaller table would`, best(l.m, l.need) >= best(p.m, l.need) * 0.99, `${best(l.m, l.need)} vs ${best(p.m, l.need)}`);
    ok(`${tag}: a tenth short, the smaller table still earns more`, best(p.m, l.need * 0.9) > best(l.m, l.need * 0.9), `${best(p.m, l.need * 0.9)} vs ${best(l.m, l.need * 0.9)}`);
  });
}
{ // rules nothing can beat playing every hand: no ladder, no crash
  const L = ladderModel({ ...base, rules: { ...DEFAULT_RULES, decks: 8, h17: true, bj65: true, pen: 60 } }, 0.05); ok("ladder: a 6:5 game has no table to move up to", L.lv.length === 0, JSON.stringify(L.lv.map((l) => l.m))); }

// ---- the game the chart projects (the average of the logged sessions) and the history it opens with
{
  const mine = { ev: 20, sd: 500 }, S = [{ date: "2026-10-03", hours: 2, result: 300, snap: { ev: 30, sd: 600 } }, { date: "2026-09-01", hours: 6, result: -450, snap: { ev: 10, sd: 400 } }, { date: "2026-10-20", hours: 4, result: 125 }, { date: "2026-10-21", hours: 0, result: 50 }];
  const a = averageGame(S, mine);
  near("average game: $/hr is weighted by hours", a.ev, (30 * 2 + 10 * 6 + 20 * 4) / 12, 1e-9); near("average game: the swing averages the variance", a.sd, Math.sqrt((600 * 600 * 2 + 400 * 400 * 6 + 500 * 500 * 4) / 12), 1e-9);
  ok("average game: a session with no hours isn't counted", a.n === 3 && a.hours === 12); ok("average game: nothing logged, nothing to average", averageGame([], mine) === null && averageGame(null, mine) === null);
  const h = bankrollHistory(S, 8000), tot = 300 - 450 + 125 + 50;
  ok("history: one point before the first session and one per session, in date order", h.length === 5 && h.every((q, i) => !i || q.t >= h[i - 1].t));
  near("history: it starts at today's bankroll less everything won since", h[0].v, 8000 - tot, 1e-9); near("history: it ends at today's bankroll", h[h.length - 1].v, 8000, 1e-9);
  near("history: the oldest session comes first", h[1].v - h[0].v, -450, 1e-9); near("history: each step is that session's result", h[2].v - h[1].v, 300, 1e-9);
  ok("history: starts the day before the first session", daysBetween(h[0].t, h[1].t) === 1); ok("history: nothing logged, no history", bankrollHistory([], 8000).length === 0);
  // steady play (the switch off): one table, never resized — the middle path is the bankroll plus the average game's edge
  const T = 416, s = growthSim({ B: 8000, lv: [{ m: 25, need: 0, down: 0, ev: a.ev, sd: a.sd, state: "now" }], hours: T }), last = s.pts[s.pts.length - 1];
  near("steady play: the typical result is today's bankroll plus the edge", last.mid, 8000 + a.ev * T, 0.06 * a.sd * Math.sqrt(T));
}

// ---- a score's colour: one smooth run from red (0) to green (100)
{
  const hue = (n) => +/^hsl\((\d+) /.exec(scoreTone(n))[1];
  ok("score colour: 0 is red", hue(0) <= 8, `hue ${hue(0)}`); ok("score colour: 100 is green", hue(100) >= 120 && hue(100) <= 150, `hue ${hue(100)}`);
  let smooth = true; for (let n = 1; n <= 100; n++) { const d = hue(n) - hue(n - 1); if (d < 0 || d > 3) smooth = false; }
  ok("score colour: the hue only ever moves toward green, in small steps", smooth);
  ok("score colour: out-of-range scores are clamped", scoreTone(-5) === scoreTone(0) && scoreTone(140) === scoreTone(100));
}

// ---- the optimized game ("Where it's heading" by default): the best every-hand bets for the bankroll at the risk limit
for (const [gi, su] of [[0, { ...base, minBet: 25, maxBet: 1000 }], [1, { ...base, rules: { ...DEFAULT_RULES, decks: 2, h17: true, das: true, pen: 65 }, minBet: 10, maxBet: 500 }]]) for (const risk of [0.02, 0.05]) {
  const L = ladderModel(su, risk), { opt } = optFor(su, risk), tag0 = `optimized game ${gi} at ${risk * 100}%`, B0 = L.lv[0].need;
  // 1. read off the curve, $/hr and swing match the optimizer run afresh at that bankroll, its bets sit at the limit (or the
  //    table maximum holds them back and they are inside it), and the table picked earns at least what the one below would
  for (const k of [1.05, 1.6, 2.5, 4, 7, 12, 25]) {
    const B = B0 * k, a = autoAt(L, B), x = opt(a.m, B), tag = `${tag0}, $${Math.round(B)}`;
    ok(`${tag}: not over the limit above the smallest table`, !a.over);
    ok(`${tag}: plays the biggest table whose "Move up" it has reached`, L.lv[a.i].need <= B && (a.i === L.lv.length - 1 || L.lv[a.i + 1].need > B), `table ${a.m}`);
    near(`${tag}: $/hr off the curve = the optimizer's`, a.ev, x.ev, 0.02 * x.ev + 0.05); near(`${tag}: swing off the curve = the optimizer's`, a.sd, x.sd, 0.02 * x.sd);
    ok(`${tag}: those bets are inside the limit`, x.ror <= risk * 1.001, `ror ${x.ror}`);
    if (a.i > 0) { const y = opt(L.lv[a.i - 1].m, B); ok(`${tag}: the table below earns no more`, !y.ok || y.ev <= a.ev * 1.03 + 0.05, `${y.ev} vs ${a.ev}`); }
  }
  { const a = autoAt(L, B0 * 0.6); ok(`${tag0}: under the smallest table it plays that table's own bets, flagged over the limit`, a.over && a.i === 0 && a.ev === L.lv[0].ev && a.sd === L.lv[0].sd); }
}
{ // 2. the 4,000 futures against a separate walk: 3-minute steps, the bets resized at the start of every 4-hour session
  const su = { ...base, minBet: 25, maxBet: 1000 }, L = ladderModel(su, 0.05), B = 12000, T = 208, sess = 4, dt = 0.05, N = 6000, tag = "optimized futures vs a separate walk";
  const m = growthSim({ B, lv: L.lv, hours: T, auto: L, sess }), e = m.pts[m.pts.length - 1];
  let sd = 77; const u = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; }, z = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const ends = [], per = Math.round(sess / dt); let half = 0, below = 0;
  for (let p = 0; p < N; p++) { let b = B, g = null, lo = B; for (let i = 0; i < T / dt; i++) { if (i % per === 0) g = autoAt(L, b); b += g.ev * dt + g.sd * Math.sqrt(dt) * z(); if (b < lo) lo = b; if (b <= 0) { b = 0; break; } } ends.push(b); if (lo <= B / 2) half++; if (b < B) below++; }
  ends.sort((a, b) => a - b); const q = (f) => ends[Math.floor(f * N)];
  near(`${tag}: typical`, e.mid, q(0.5), 0.03 * q(0.5)); near(`${tag}: 10th percentile`, e.lo, q(0.1), 0.04 * q(0.1)); near(`${tag}: 90th percentile`, e.hi, q(0.9), 0.04 * q(0.9));
  near(`${tag}: ending behind`, m.below, below / N, 0.025); near(`${tag}: losing half`, m.half, half / N, 0.025);
}
{ // 3. against real cards: futures dealt hand by hand (src/sim.js), betting the optimizer's bets, resized every session.
  // Each of the model's 10th / 50th / 90th percentiles must lie where 300 dealt futures put it, give or take what chance
  // allows (a band of order statistics that holds 99 times in 100).
  const su = { ...base, minBet: 25, maxBet: 1000 }, L = ladderModel(su, 0.05), B = 12000, T = 208, sess = 4, n = 300;
  const m = growthSim({ B, lv: L.lv, hours: T, auto: L, sess }), e = m.pts[m.pts.length - 1];
  const d = dealSim({ setup: su, risk: 0.05, game: { kind: "auto", lad: L }, B, hours: T, sess, rph: L.rph, seed: 20261117 }, n), ends = d.paths.map((p) => p.end).sort((a, b) => a - b);
  ok("real cards: every future dealt to the end", d.paths.length === n && d.rounds >= n * Math.round(T * L.rph) * 0.999, `${d.paths.length} paths, ${d.rounds} rounds`);
  [[0.1, e.lo], [0.5, e.mid], [0.9, e.hi]].forEach(([f, v]) => { const k = f * n, w = 2.58 * Math.sqrt(n * f * (1 - f)), lo = ends[Math.max(0, Math.floor(k - w))], hi = ends[Math.min(n - 1, Math.ceil(k + w))]; ok(`real cards: the model's ${f * 100}th percentile is where the dealt futures put it`, v >= lo && v <= hi, `model ${Math.round(v)}, dealt ${Math.round(lo)}–${Math.round(hi)}`); });
  const fixed = dealSim({ setup: su, risk: 0.05, game: { kind: "fixed", lv: [{ m: 25, need: 0 }], bets: { "-3": 25, "-2": 25, "-1": 25, 0: 25, 1: 25, 2: 50, 3: 75, 4: 100, 5: 150, 6: 200 } }, B, hours: 40, sess: 4, rph: L.rph, seed: 5 }, 400);
  const r = compute({ bankroll: B, handsPerHour: L.rph, bets: { "-3": 25, "-2": 25, "-1": 25, 0: 25, 1: 25, 2: 50, 3: 75, 4: 100, 5: 150, 6: 200 }, cal: calFor({ ...DEFAULT_RULES, ...su.rules }, 4), spotsMap: {} });
  const res = fixed.paths.map((p) => (p.end - B) / 40), mean = res.reduce((a, b) => a + b, 0) / res.length, sdv = Math.sqrt(res.reduce((a, b) => a + (b - mean) ** 2, 0) / (res.length - 1));
  near("real cards: a fixed spread earns its calculated $/hr", mean, r.evHour, 3.3 * (r.sdHour / Math.sqrt(40)) / Math.sqrt(res.length));
  near("real cards: and swings as calculated (40 hours, as dollars an hour)", sdv, r.sdHour / Math.sqrt(40), 0.1 * r.sdHour / Math.sqrt(40));
}

console.log(bad ? `${bad} of ${n} plan checks FAILED` : `all ${n} plan checks passed`);
process.exit(bad ? 1 : 0);
