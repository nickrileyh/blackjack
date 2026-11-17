// Independent checks of the Plan tab's arithmetic (src/planner.jsx): the per-casino optimizer results against the
// calculator, table bankrolls against the risk-of-ruin formula, the bankroll simulation against closed forms and a
// separate random walk, session cash, the rotation's dates, and the scouting-report reader.
// Run:  tools/checks/run.sh
process.env.TZ = "America/New_York"; // the date checks cross a clock change
import { COUNTS, calFor, compute, pDip, PhiN, DEFAULT_RULES } from "./app.jsx";
import { scoreGame, scoreFor, cashFor, growthModel, growthSim, goalStats, restOf, restSet, schedule, addDays, daysBetween, reportGame, scoreTone, gamesAt } from "./planner.jsx";
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
  const plan = schedule(rows, today, R, 2, 6, () => 50);
  ok("two a week lands on days 0, 4, 7, 11, 14, 18", plan.map((v) => daysBetween(today, v.t)).join() === "0,4,7,11,14,18", plan.map((v) => daysBetween(today, v.t)).join());
  ok("with enough casinos nobody is visited twice", new Set(plan.map((v) => v.c.id)).size === 6);
  const two = [cas("a", { n: 1, last: "2026-11-14", dates: ["2026-11-14"] }), cas("b", { n: 1, last: "2026-11-02", dates: ["2026-11-02"] }, { heat: 2 })].map((c) => ({ c, ...restOf(c, R) })), p2 = schedule(two, today, R, 3, 8, () => 50), seen = {};
  let fine = true; p2.forEach((v) => { const r = two.find((x) => x.c.id === v.c.id), gap = v.c.id === "b" ? 21 : 7; if (seen[v.c.id] == null ? r.until && v.t < r.until : daysBetween(seen[v.c.id], v.t) < gap) fine = false; seen[v.c.id] = v.t; });
  ok("no visit lands inside a casino's rest", fine, p2.map((v) => v.c.id + daysBetween(today, v.t)).join(" "));
  const sc = (c) => (c.id === "g" ? 100 : 0), tie = ["f", "g"].map((id) => { const c = cas(id, { n: 1, last: id === "g" ? "2026-11-02" : "2026-11-01", dates: [] }); return { c, ...restOf(c, R) }; });
  ok("a much better game wins a near-tie on rest", schedule(tie, today, R, 1, 1, sc)[0].c.id === "g"); ok("without scores the longer-rested goes first", schedule(tie, today, R, 1, 1, () => null)[0].c.id === "f");
  const bk = [cas("x", { n: 1, last: "2026-09-01", dates: ["2026-09-01"], backed: "2026-09-01", backedN: 1 })].map((c) => ({ c, ...restOf(c, R) }));
  ok("a backed-off casino comes back only when its rest ends", daysBetween(D("2026-09-01"), schedule(bk, today, R, 2, 1, () => 50)[0].t) === 90);
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

// ---- a score's colour: one smooth run from red (0) to green (100)
{
  const hue = (n) => +/^hsl\((\d+) /.exec(scoreTone(n))[1];
  ok("score colour: 0 is red", hue(0) <= 8, `hue ${hue(0)}`); ok("score colour: 100 is green", hue(100) >= 120 && hue(100) <= 150, `hue ${hue(100)}`);
  let smooth = true; for (let n = 1; n <= 100; n++) { const d = hue(n) - hue(n - 1); if (d < 0 || d > 3) smooth = false; }
  ok("score colour: the hue only ever moves toward green, in small steps", smooth);
  ok("score colour: out-of-range scores are clamped", scoreTone(-5) === scoreTone(0) && scoreTone(140) === scoreTone(100));
}

console.log(bad ? `${bad} of ${n} plan checks FAILED` : `all ${n} plan checks passed`);
process.exit(bad ? 1 : 0);
