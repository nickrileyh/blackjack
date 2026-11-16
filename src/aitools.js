// The calculator the in-app assistant works with. The language model never does blackjack arithmetic itself:
// it describes a scenario (a spread, rules, cover plays, a betting habit) and these functions return the numbers,
// from the same calibrated model the Spread page uses.
import { COUNTS, calFor, compute, autoRph, roundFreqs, spotsAt, momentAt, optimizeSpread, optimizeForProfit, correctPlay, rulesLabel, pDip, PhiN, DEFAULT_RULES, DEFAULT_BETS, SKILLS, sessEv, sessSd, loadLog, sessionDrawdown, sessionCash } from "./app.jsx";
import { coverCal, coverAvail, deviationCatalog, HABITS } from "./cover.js";
import { runPolicies, countShift } from "./sim.js";

const r0 = (x) => Math.round(x), r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const getJ = async (k, d) => { try { const r = await window.storage.get(k, false); return r && r.value ? JSON.parse(r.value) : d; } catch (_) { return d; } };

// Everything saved on this device that the assistant may look at.
export async function loadSetup() {
  const rules = { ...DEFAULT_RULES, ...(await getJ("bj-rules-v1", {})) }, sp = await getJ("bj-spread-v1", {});
  return {
    rules, seats: sp.seats || 4, bets: { ...DEFAULT_BETS, ...(sp.bets || {}) }, spotsMap: sp.spotsMap || {}, bankroll: +sp.bankroll || 5000,
    minBet: +sp.minBet || 25, maxBet: +sp.maxBet || 500, hphAuto: sp.hphAuto !== false, handsPerHour: +sp.handsPerHour || 100, entry: sp.entry ?? 1, belowMode: sp.belowMode || "out",
  };
}

// base setup + requested changes → one concrete scenario
function resolve(base, ch = {}) {
  const R = { ...base.rules, ...(ch.rules || {}) };
  if (ch.rules && ch.rules.penetration != null) R.pen = ch.rules.penetration;
  if (ch.rules && ch.rules.blackjack_pays) R.bj65 = ch.rules.blackjack_pays === "6:5";
  if (ch.rules && ch.rules.double_on) R.dbl = ch.rules.double_on;
  if (ch.rules && ch.rules.deviations != null) R.devs = !!ch.rules.deviations;
  if (ch.rules && ch.rules.split_to_hands) R.maxHands = ch.rules.split_to_hands;
  if (ch.rules && ch.rules.resplit_aces != null) R.rsa = !!ch.rules.resplit_aces;
  if (ch.rules && ch.rules.double_after_split != null) R.das = !!ch.rules.double_after_split;
  const asMap = (v, f) => (Array.isArray(v) ? Object.fromEntries(v.filter((x) => x && x.true_count != null).map((x) => [String(Math.round(+x.true_count)), +x[f]])) : v);
  if (ch.bets) ch = { ...ch, bets: asMap(ch.bets, "bet") }; if (ch.hands) ch = { ...ch, hands: asMap(ch.hands, "hands") };
  const bets = { ...base.bets }; let spotsMap = { ...base.spotsMap };
  if (ch.bets) { if (ch.replace_bets) COUNTS.forEach((c) => (bets[c] = 0)); Object.keys(ch.bets).forEach((k) => { const c = Math.max(-3, Math.min(6, Math.round(+k))); bets[c] = Math.max(0, +ch.bets[k] || 0); }); }
  if (ch.bet_multiplier > 0) COUNTS.forEach((c) => (bets[c] = bets[c] * ch.bet_multiplier));
  if (ch.max_bet > 0) COUNTS.forEach((c) => (bets[c] = Math.min(bets[c], ch.max_bet)));
  if (ch.min_bet > 0) COUNTS.forEach((c) => { if (bets[c] > 0) bets[c] = Math.max(bets[c], ch.min_bet); });
  if (ch.round_bets_to > 0) COUNTS.forEach((c) => { if (bets[c] > 0) bets[c] = Math.max(ch.round_bets_to, Math.round(bets[c] / ch.round_bets_to) * ch.round_bets_to); });
  if (ch.hands) { if (ch.replace_bets) spotsMap = {}; Object.keys(ch.hands).forEach((k) => { const c = Math.max(-3, Math.min(6, Math.round(+k))); if (+ch.hands[k] === 2) spotsMap[c] = 2; else delete spotsMap[c]; }); }
  const cover = { ...(ch.cover || {}) };
  if (cover.insurance === "never") R.insurance = false; else if (cover.insurance && cover.insurance !== "normal") R.insurance = true;
  return { R, seats: Math.min(7, Math.max(1, Math.round(+ch.players_at_table || base.seats))), bets, spotsMap, bankroll: ch.bankroll > 0 ? +ch.bankroll : base.bankroll, rph: ch.rounds_per_hour > 0 ? +ch.rounds_per_hour : base.hphAuto ? null : base.handsPerHour, cover, policy: ch.bet_policy || null, extra: +ch.extra_dollars_per_hour || 0, missPct: Math.max(0, Math.min(100, +ch.missed_raise_pct || 0)) };
}

const POLICY_KEYS = { max_raise_multiple: "maxRaise", max_drop_multiple: "maxDrop", raise_only_after_win: "raiseOnlyAfterWin", no_raise_after_loss: "noRaiseAfterLoss", no_lower_after_win: "noLowerAfterWin", lower_only_after_loss: "lowerOnlyAfterLoss", hold_after_push: "holdAfterPush", flat_first_rounds: "flatFirst", flat_bet: "flatBet", off_the_top_bet: "offTopBet", round_to: "roundTo" };
const toPolicy = (p) => { const o = {}; Object.keys(p || {}).forEach((k) => { if (POLICY_KEYS[k] && p[k]) o[POLICY_KEYS[k]] = p[k] === true ? true : +p[k]; }); return o; };

export function evalScenario(base, ch = {}, opts = {}) {
  const sc = resolve(base, ch), notes = [];
  let cal = calFor(sc.R, sc.seats);
  // counting differently changes how often you land on each count: deal this exact spread both ways to measure it
  const TCM = { full_deck: 1, exact: 2, floor: 3, round_nearest: 4 }, cm = TCM[sc.cover.count_method] || 0, miss = Math.max(0, Math.min(8, +sc.cover.missed_cards_pct || 0));
  let shift = null;
  const pat = COUNTS.map((c) => spotsAt(c, sc.bets, sc.spotsMap, cal));
  if ((cm || miss > 0) && pat.some((x) => x > 0) && pat.some((x) => x !== pat[0])) shift = countShift({ R: sc.R, seats: sc.seats, spots: COUNTS.map((c) => spotsAt(c, sc.bets, sc.spotsMap, cal)), opts: { tcm: cm, miss: miss / 100 }, rounds: opts.rounds || 400000 });
  const cc = coverCal(cal, sc.R, sc.cover, shift); cal = cc.cal;
  if (cc.skipped.length) notes.push("Not applied: " + cc.skipped.join("; "));
  (cc.approx || []).forEach((t) => notes.push(t));
  const rph = sc.rph || autoRph(roundFreqs(sc.bets, sc.spotsMap, cal), sc.bets, sc.spotsMap, cal);
  const r = compute({ bankroll: sc.bankroll, handsPerHour: rph, bets: sc.bets, cal, spotsMap: sc.spotsMap });
  let ev = r.evHand, ex2 = r.varHand + r.evHand * r.evHand, avgBet = r.avgBet, pol = null;
  if (sc.policy && Object.keys(toPolicy(sc.policy)).length && r.playedFrac > 0) {
    const P = toPolicy(sc.policy); if (P.flatFirst && !P.flatBet) P.flatBet = sc.bets[0] || Math.min(...COUNTS.map((c) => sc.bets[c]).filter((x) => x > 0));
    const spots = COUNTS.map((c) => spotsAt(c, sc.bets, sc.spotsMap, cal)), bets = COUNTS.map((c) => +sc.bets[c] || 0);
    const sim = runPolicies({ R: sc.R, seats: sc.seats, spots, bets, edge: r.rows.map((x) => x.edge), m1: COUNTS.map((c) => cal.m2[c]), m2: COUNTS.map((c) => momentAt(cal, c, 2)), policies: [{}, P], rounds: opts.rounds || 400000, seed: 7 });
    const a = sim.out[0], b = sim.out[1];
    ev = r.evHand + (b.ev - a.ev); ex2 = a.ex2 > 0 ? ex2 * (b.ex2 / a.ex2) : ex2; avgBet = a.avgBet > 0 ? avgBet * (b.avgBet / a.avgBet) : avgBet;
    const hist = Object.keys(b.hist).map(Number).sort((x, y) => x - y), tot = hist.reduce((s, k) => s + b.hist[k], 0);
    pol = { rounds_dealt: sim.rounds, share_of_bets_changed_pct: r1(100 * b.changedShare), biggest_bet: b.top, bet_sizes_pct: Object.fromEntries(hist.filter((k) => b.hist[k] / tot >= 0.005).map((k) => [k, r1((100 * b.hist[k]) / tot)])) };
    notes.push("The betting rule depends on the previous hand, so " + sim.rounds.toLocaleString() + " rounds were dealt and both the plain spread and the rule were scored on the same rounds with the measured edge at each count.");
    if (cal.fmul) notes.push("Counting errors and a betting rule are combined approximately.");
  }
  if (sc.missPct > 0 && r.playedFrac > 0) {
    // rounds where the bigger bet doesn't go out (distraction, cover, a pit boss watching): the smallest played bet goes out instead
    const lo0 = Math.min(...COUNTS.map((c) => +sc.bets[c] || 0).filter((x) => x > 0)), flat = {}; COUNTS.forEach((c) => (flat[c] = sc.bets[c] > 0 ? lo0 : 0));
    const rf = compute({ bankroll: sc.bankroll, handsPerHour: rph, bets: flat, cal, spotsMap: sc.spotsMap }), p = Math.min(1, sc.missPct / 100);
    ev = (1 - p) * ev + p * rf.evHand; ex2 = (1 - p) * ex2 + p * (rf.varHand + rf.evHand * rf.evHand); avgBet = (1 - p) * avgBet + p * rf.avgBet;
    notes.push(`On ${sc.missPct}% of rounds the smallest bet ($${lo0}) goes out instead of the spread's bet.`);
  }
  if (sc.extra) ev += sc.extra / rph;
  const v = Math.max(1e-9, ex2 - ev * ev), evHour = ev * rph, sdHour = Math.sqrt(v * rph), B = sc.bankroll;
  const ror = ev <= 0 ? 1 : Math.min(1, Math.exp((-2 * ev * B) / v)), n0 = ev > 0 ? v / (ev * ev) : Infinity;
  const played = COUNTS.filter((c) => sc.bets[c] > 0), lo = played.length ? Math.min(...played.map((c) => sc.bets[c])) : 0, hi = played.length ? Math.max(...played.map((c) => sc.bets[c] * spotsAt(c, sc.bets, sc.spotsMap, cal))) : 0;
  const out = {
    name: ch.name || "scenario", rules: `${sc.R.decks} decks, ${rulesLabel(sc.R)}, ${sc.R.surrender ? "late surrender" : "no surrender"}, ${sc.R.devs === false ? "deviations off (basic strategy only, never insures)" : sc.R.insurance === false ? "never insures" : "insurance at +3"}, ${sc.R.pen}% penetration`,
    players_at_table: sc.seats, bankroll: B, rounds_per_hour: r0(rph),
    win_per_hour: r2(evHour), swing_per_hour_1sd: r0(sdHour), win_per_100_rounds: r2(ev * 100), edge_on_money_bet_pct: avgBet > 0 && r.playedFrac > 0 ? r3((100 * ev) / (avgBet * r.playedFrac)) : 0,
    risk_of_ruin_pct: ror >= 1 ? 100 : +(100 * ror).toPrecision(3), chance_to_double_bankroll_before_losing_it_pct: ev > 0 ? r1(100 / (1 + ror)) : null,
    hours_to_long_run_n0: Number.isFinite(n0) ? r0(n0 / rph) : null, kelly_fraction: ev > 0 ? r2(v / ev / B) : null,
    average_bet_when_playing: r2(avgBet), share_of_rounds_played_pct: r1(100 * r.playedFrac), spread: lo > 0 ? `$${r0(lo)} to $${r0(hi)} (1 to ${r1(hi / lo)})` : "no bets",
    by_true_count: r.rows.map((x) => ({ tc: x.c === -3 ? "-3 or lower" : x.c === 6 ? "+6 or higher" : (x.c > 0 ? "+" : "") + x.c, bet: x.bet, hands: x.bet > 0 ? x.sp : 0, share_of_rounds_pct: r2(100 * x.f), your_edge_pct: r2(100 * x.edge), ...(x.edge > 0 ? { full_kelly_bet_per_hand: r0((B * x.edge * x.sp) / momentAt(cal, x.c, x.sp)) } : {}) })),
    ...(cc.applied.length ? { cover_applied: cc.applied } : {}), ...(pol ? { betting_rule: pol } : {}), ...(sc.extra ? { extra_dollars_per_hour_included: sc.extra } : {}), ...(notes.length ? { notes } : {}),
  };
  out._ = { evHour, sdHour, ev, v, rph, B, rows: pol || sc.missPct > 0 ? null : r.rows, cal };
  return out;
}
const strip = (o) => { const { _, ...rest } = o; return rest; };

function riskOverTime(base, a) {
  const s = evalScenario(base, a.scenario || {}), { evHour: mu, sdHour: sd } = s._, out = { scenario: s.name, win_per_hour: r2(mu), swing_per_hour_1sd: r0(sd), horizons: [] };
  const z = [[5, -1.6449], [25, -0.6745], [50, 0], [75, 0.6745], [95, 1.6449]];
  (a.hours && a.hours.length ? a.hours : [4, 20, 100, 500]).slice(0, 8).forEach((H) => {
    H = Math.max(0.25, +H); const m = mu * H, v = sd * Math.sqrt(H), h = { hours: H, expected: r0(m), one_sd: r0(v), chance_of_being_behind_pct: r1(100 * PhiN(-m / v)), result_percentiles: Object.fromEntries(z.map(([p, q]) => [p + "th", r0(m + q * v)])) };
    (a.loss_amounts || []).slice(0, 6).forEach((x) => { x = Math.abs(+x); if (x > 0) { (h.chance_of_ever_being_down || (h.chance_of_ever_being_down = {}))["$" + r0(x)] = r1(100 * Math.min(1, pDip(x, mu, sd, H))) + "%"; (h.chance_of_finishing_down_at_least || (h.chance_of_finishing_down_at_least = {}))["$" + r0(x)] = r1(100 * PhiN((-x - m) / v)) + "%"; } });
    (a.win_amounts || []).slice(0, 6).forEach((x) => { x = Math.abs(+x); if (x > 0) (h.chance_of_finishing_up_at_least || (h.chance_of_finishing_up_at_least = {}))["$" + r0(x)] = r1(100 * (1 - PhiN((x - m) / v))) + "%"; });
    if (s._.rows && H <= 3000) { try { const d = sessionDrawdown(s._.rows, s._.cal, H, s._.rph); h.peak_to_trough_drawdown = { typical: r0(d.med), one_in_ten_is_worse_than: r0(d.p90) }; } catch (_) {} }
    out.horizons.push(h);
  });
  if (mu > 0) out.hours_until_ahead_with_confidence = Object.fromEntries([[80, 0.8416], [90, 1.2816], [95, 1.6449], [99, 2.3263]].map(([p, q]) => [p + "%", r0(Math.pow((q * sd) / mu, 2))]));
  if (a.session_hours > 0) { const H = +a.session_hours, pl = PhiN((-mu * H) / (sd * Math.sqrt(H))); out.sessions_of_hours = H; out.chance_a_session_loses_pct = r1(100 * pl); out.chance_of_losing_n_sessions_in_a_row_pct = Object.fromEntries([2, 3, 4, 5, 6, 8, 10].map((n) => [n, +(100 * Math.pow(pl, n)).toPrecision(2)])); out.chance_of_winning_n_sessions_in_a_row_pct = Object.fromEntries([2, 3, 4, 5, 6, 8, 10].map((n) => [n, +(100 * Math.pow(1 - pl, n)).toPrecision(2)])); }
  out.note = "Bell-curve estimate from the hourly win and swing. Under about 3 hours, real results have slightly fatter tails (a hot or cold shoe clusters big bets), so treat the extremes as a little wider.";
  return out;
}

function stopRules(base, a) {
  const s = evalScenario(base, a.scenario || {}), { evHour: mu, sdHour: sd } = s._, L = Math.abs(+a.stop_loss || 0), W = Math.abs(+a.win_goal || 0), H = +a.max_hours > 0 ? +a.max_hours : 0, th = (2 * mu) / (sd * sd);
  const out = { scenario: s.name, win_per_hour: r2(mu), swing_per_hour_1sd: r0(sd) };
  if (L > 0 && W > 0) {
    const p = Math.abs(th) < 1e-12 ? L / (L + W) : (1 - Math.exp(th * L)) / (Math.exp(-th * W) - Math.exp(th * L)), t = Math.abs(mu) < 1e-9 ? (L * W) / (sd * sd) : (p * W - (1 - p) * L) / mu;
    out.playing_until_one_is_hit = { chance_win_goal_comes_first_pct: r1(100 * p), chance_stop_loss_comes_first_pct: r1(100 * (1 - p)), average_hours_until_one_is_hit: r1(t), average_result_per_session: r0(p * W - (1 - p) * L) };
  }
  if (H > 0) { out.within_hours = H; if (L > 0) out.chance_stop_loss_is_hit_within_that_time_pct = r1(100 * Math.min(1, pDip(L, mu, sd, H))); if (W > 0) out.chance_win_goal_is_hit_within_that_time_pct = r1(100 * Math.min(1, pDip(W, -mu, sd, H))); }
  out.note = "Stopping rules change how each session feels, not the win per hour actually played: every hour at the table is worth the same on average whenever it happens.";
  return out;
}

function bankrollNeeded(base, a) {
  const s = evalScenario(base, a.scenario || {}), { ev, v, rph, B, evHour, sdHour } = s._;
  if (!(ev > 0)) return { scenario: s.name, error: "This game loses money on average, so no bankroll makes it safe.", win_per_hour: r2(ev * rph) };
  const extra = {};
  if (a.trip_hours > 0) extra.trip_bankroll_for_hours = { hours: +a.trip_hours, cash_to_bring_so_the_chance_of_running_out_is: Object.fromEntries([20, 10, 5, 1].map((p) => [p + "%", r0(sessionCash(p / 100, evHour, sdHour, +a.trip_hours))])) };
  if (a.grow_to > B) { const th = (2 * ev) / v, G = +a.grow_to; extra.growing_the_bankroll = { from: B, to: G, chance_of_getting_there_before_going_broke_pct: r1((100 * (1 - Math.exp(-th * B))) / (1 - Math.exp(-th * G))), average_hours_if_it_gets_there: r0((G - B) / evHour), note: "Assumes the same bets the whole way; raising bets as the bankroll grows gets there faster." }; }
  return { ...extra, scenario: s.name, win_per_hour: r2(ev * rph), bankroll_for_risk_of_ruin: Object.fromEntries((a.risk_of_ruin_pcts && a.risk_of_ruin_pcts.length ? a.risk_of_ruin_pcts : [20, 10, 5, 2, 1]).slice(0, 8).map((p) => [p + "%", r0((-Math.log(Math.min(0.999, Math.max(1e-9, p / 100))) * v) / (2 * ev))])), full_kelly_bankroll: r0(v / ev) };
}

function optimize(base, a) {
  const sc = resolve(base, a.scenario || {}); let cal = calFor(sc.R, sc.seats); cal = coverCal(cal, sc.R, sc.cover).cal;
  const entry = a.play_from_true_count != null ? Math.max(-3, Math.min(6, Math.round(a.play_from_true_count))) : base.entry, belowMode = a.below_that === "min_bet" ? "min" : a.below_that === "sit_out" ? "out" : base.belowMode;
  const mn = a.min_bet > 0 ? a.min_bet : base.minBet, mx = a.max_bet > 0 ? a.max_bet : base.maxBet, B = sc.bankroll;
  const b0 = {}; COUNTS.forEach((c) => (b0[c] = c >= entry ? mn : belowMode === "out" ? 0 : mn));
  const rph = sc.rph || autoRph(roundFreqs(b0, sc.spotsMap, cal), b0, sc.spotsMap, cal);
  const args = { B, mn, mx, cal, entry, belowMode, spotsMap: sc.spotsMap };
  const res = a.profit_goal_per_hour > 0 ? optimizeForProfit({ ...args, evHandGoal: a.profit_goal_per_hour / rph }) : optimizeSpread({ ...args, rorCap: Math.min(0.999, Math.max(1e-6, (a.risk_of_ruin_cap_pct > 0 ? a.risk_of_ruin_cap_pct : 5) / 100)) });
  const full = evalScenario(base, { ...(a.scenario || {}), name: "optimized spread", bets: res.bets, replace_bets: true, hands: sc.spotsMap });
  return { goal: a.profit_goal_per_hour > 0 ? `least risk that wins $${a.profit_goal_per_hour}/hour` : `most profit with risk of ruin at or under ${a.risk_of_ruin_cap_pct > 0 ? a.risk_of_ruin_cap_pct : 5}%`, table_min: mn, table_max: mx, ...(res.infeasible ? { warning: `Even the safest spread here has a ${r1(100 * res.minRor)}% risk of ruin — the bankroll is too small for this table minimum.` } : {}), ...(res.unreachable ? { warning: "That profit goal can't be reached with this maximum bet; this is the most the limits allow." } : {}), result: strip(full) };
}

function playLookup(base, a) {
  const R = { ...base.rules, ...(a.rules || {}), ...(a.rules && a.rules.deviations != null ? { devs: !!a.rules.deviations } : {}) }, rank = (x) => { const s = String(x).toUpperCase().trim(); return s === "A" || s === "11" || s === "1" ? 11 : ["K", "Q", "J", "T", "10"].includes(s) ? 10 : Math.max(2, Math.min(9, parseInt(s, 10) || 0)); };
  const cards = (a.cards || []).map((c) => ({ rank: rank(c) })), up = rank(a.dealer_upcard), two = cards.length === 2;
  if (cards.length < 2) return { error: "Give the player's cards, for example [\"10\",\"6\"]." };
  const names = { H: "hit", S: "stand", D: "double", P: "split", R: "surrender" };
  const one = (tc) => { const p = correctPlay(cards, up, tc, R, { canDouble: two && a.after_split !== true ? true : two && R.das !== false, canSplit: two && cards[0].rank === cards[1].rank, canSurrender: two && !!R.surrender && !a.after_split, devs: true }); return names[p.act] || p.act; };
  const tcs = a.true_count != null ? [Math.round(a.true_count)] : [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6], plays = tcs.map((t) => [t, one(t)]);
  const d = correctPlay(cards, up, 0, R, { canDouble: two, canSplit: two && cards[0].rank === cards[1].rank, canSurrender: two && !!R.surrender, devs: true }).dev;
  return { rules: rulesLabel(R) + (R.surrender ? ", surrender" : ""), hand: (a.cards || []).join(","), dealer: String(a.dealer_upcard), ...(a.true_count != null ? { true_count: tcs[0], play: plays[0][1] } : { play_by_true_count: plays.map(([t, p]) => `${t > 0 ? "+" : ""}${t}${t === -3 ? " or lower" : t === 6 ? " or higher" : ""}: ${p}`) }), ...(d ? { count_play: d.edge ? `${d.name}: marked ${d.edge === "+" ? "0+" : "0−"} — it goes by the sign of the RUNNING count, not a true count of 0. ${d.edge === "+" ? `Make the play (${names[d.above]}) on any positive running count, even when the true count rounds to 0; at a running count of zero or below, ${names[d.below]}.` : `Drop the basic play and ${names[d.below]} on any negative running count, even when the true count rounds to 0; at zero or above, ${names[d.above]}.`} The true-count rows here treat 0 as a running count of exactly 0.` : `${d.idx <= 0 ? `${d.name}: the chart prints ${d.idx - 1 < 0 ? "−" : ""}${Math.abs(d.idx - 1)} — ${names[d.below]} at that true count and below, otherwise ${names[d.above]}` : `${d.name}: index +${d.idx} — ${names[d.above]} at that true count and above, otherwise ${names[d.below]}`}` } : { count_play: "none — basic strategy at every count" }), insurance: "take it at true count +3 or higher (any hand)", ...(R.devs === false ? { note: "Deviations are switched off in the saved game rules (basic strategy only, no insurance): the calculator and Live play ignore the count plays shown here." } : {}) };
}

async function sessionStats(base, a) {
  let list = (await getJ("bj-sessions-v1", [])).filter((s) => s && s.date);
  const all = list.length;
  if (a.from) list = list.filter((s) => s.date >= a.from); if (a.to) list = list.filter((s) => s.date <= a.to);
  if (a.where) { const w = String(a.where).toLowerCase(); list = list.filter((s) => String(s.where || "").toLowerCase().includes(w)); }
  if (!list.length) return { sessions: 0, logged_in_total: all, note: all ? "No sessions match that filter." : "No sessions have been logged yet (Sessions tab → Log)." };
  const cur = evalScenario(base, {})._;
  const agg = (L) => { let h = 0, net = 0, exp = 0, vr = 0, wins = 0; L.forEach((s) => { const hh = +s.hours || 0; h += hh; net += +s.result || 0; exp += sessEv(s, cur.evHour) * hh; vr += Math.pow(sessSd(s, cur.sdHour), 2) * hh; if (+s.result > 0) wins++; }); const sd = Math.sqrt(vr), z = sd > 0 ? (net - exp) / sd : 0; return { sessions: L.length, hours: r1(h), net: r0(net), per_hour: h ? r2(net / h) : 0, expected: r0(exp), expected_per_hour: h ? r2(exp / h) : 0, one_sd: r0(sd), luck_z: r2(z), luck_percentile: r0(100 * PhiN(z)), winning_sessions: wins }; };
  const by = (f) => { const m = {}; list.forEach((s) => { const k = f(s) || "—"; (m[k] || (m[k] = [])).push(s); }); return Object.fromEntries(Object.keys(m).sort().map((k) => [k, (({ sessions, hours, net, expected, luck_z }) => ({ sessions, hours, net, expected, luck_z }))(agg(m[k]))])); };
  const srt = list.slice().sort((x, y) => (+x.result || 0) - (+y.result || 0));
  let run = 0, peak = 0, dd = 0; list.slice().sort((x, y) => String(x.date).localeCompare(String(y.date)) || (x.id || 0) - (y.id || 0)).forEach((s) => { run += +s.result || 0; if (run > peak) peak = run; if (peak - run > dd) dd = peak - run; });
  return { ...agg(list), first: list.reduce((m, s) => (s.date < m ? s.date : m), list[0].date), last: list.reduce((m, s) => (s.date > m ? s.date : m), list[0].date), biggest_win: r0(+srt[srt.length - 1].result || 0), biggest_loss: r0(+srt[0].result || 0), deepest_drawdown_between_sessions: r0(dd),
    by_place: by((s) => s.where), by_month: by((s) => String(s.date).slice(0, 7)),
    recent: list.slice().sort((x, y) => String(y.date).localeCompare(String(x.date))).slice(0, Math.min(25, a.list_recent || 8)).map((s) => ({ date: s.date, where: s.where || "", hours: +s.hours || 0, result: +s.result || 0, expected: r0(sessEv(s, cur.evHour) * (+s.hours || 0)), ...(s.notes ? { notes: String(s.notes).slice(0, 140) } : {}) })),
    how_to_read: "luck_z is (actual − expected) ÷ one standard deviation: between −1 and +1 is ordinary, beyond ±2 is unusual. Each session's expected value uses the spread and rules saved with that session." };
}

async function trainingStats(base, a) {
  const log = await loadLog(), now = Date.now(), days = Math.max(1, +a.days || 30), since = now - days * 864e5, label = Object.fromEntries(SKILLS);
  if (!log.length) return { answers: 0, note: "No practice has been recorded yet." };
  const out = { window_days: days, skills: {} };
  SKILLS.forEach(([id]) => { const L = log.filter((x) => x.s === id), W = L.filter((x) => x.t >= since), last = L.slice(-50); const acc = (X) => (X.length ? r1((100 * X.filter((x) => x.ok).length) / X.length) : null); const ms = W.filter((x) => x.ms > 0).map((x) => x.ms).sort((x, y) => x - y);
    if (L.length) out.skills[label[id]] = { all_time_answers: L.length, all_time_accuracy_pct: acc(L), in_window_answers: W.length, in_window_accuracy_pct: acc(W), last_50_accuracy_pct: acc(last), ...(ms.length ? { median_seconds_per_answer: r1(ms[Math.floor(ms.length / 2)] / 1000) } : {}), last_practiced: new Date(L[L.length - 1].t).toISOString().slice(0, 10) }; });
  const daysSet = new Set(log.filter((x) => x.t >= since).map((x) => new Date(x.t).toDateString()));
  out.days_practiced_in_window = daysSet.size; out.total_answers_in_window = log.filter((x) => x.t >= since).length;
  const tests = await getJ("bj-tests-v1", {}); if (Object.keys(tests).length) out.tests = Object.fromEntries(Object.keys(tests).map((k) => [k, { passed: !!tests[k].pass, score: tests[k].score, ...(tests[k].secs ? { seconds: tests[k].secs } : {}) }]));
  const pa = await getJ("bj-playall-v1", null); if (pa && pa.hands) out.live_play = { hands: pa.hands, ...(pa.net != null ? { net: r0(pa.net) } : {}), ...(pa.clean != null ? { clean_hands: pa.clean } : {}), ...(pa.errors != null ? { errors: pa.errors } : {}) };
  out.casino_ready_standard = "BJA's bar: 100% on basic strategy and deviations, a deck counted down in under 30 seconds, true-count conversions without pausing.";
  return out;
}

const makeScen = (av, flat) => ({
  type: "object", description: "Changes from the user's current setup. Leave a field out to keep what they have now. An empty object is their current game.",
  properties: {
    name: { type: "string", description: "Short label for this scenario" },
    bets: flat ? { type: "array", description: "Dollar bet per hand at true counts -3…6 (-3 means -3 or lower, 6 means +6 or higher). 0 = sit out (heads-up: leave the table). Only the counts you list change.", items: { type: "object", properties: { true_count: { type: "number" }, bet: { type: "number" } }, required: ["true_count", "bet"] } }
      : { type: "object", description: "Dollar bet per hand at true counts, keys \"-3\"…\"6\" (-3 means -3 or lower, 6 means +6 or higher). 0 = sit out (heads-up: leave the table). Only the counts you list change.", additionalProperties: { type: "number" } },
    replace_bets: { type: "boolean", description: "true = counts not listed in bets become 0 (use when giving a whole new spread)" },
    hands: flat ? { type: "array", description: "Hands played at a true count: 1 or 2", items: { type: "object", properties: { true_count: { type: "number" }, hands: { type: "number" } }, required: ["true_count", "hands"] } }
      : { type: "object", description: "Hands played at a count: 1 or 2, same keys as bets", additionalProperties: { type: "number" } },
    bet_multiplier: { type: "number", description: "Scale every bet (0.5 = half stakes)" }, max_bet: { type: "number" }, min_bet: { type: "number" }, round_bets_to: { type: "number", description: "Round bets to a chip size, e.g. 25" },
    bankroll: { type: "number" }, players_at_table: { type: "number", description: "1–7, the user included" }, rounds_per_hour: { type: "number", description: "Leave out to use the typical speed for the table size" },
    missed_raise_pct: { type: "number", description: "Percent of rounds where the user fails to put out the spread's bet and bets their smallest bet instead (distraction, or holding back while watched)" },
    extra_dollars_per_hour: { type: "number", description: "Money outside the cards per hour: tips are negative, comps or cashback positive. Comps aren't cash for bankroll purposes unless the user says so." },
    rules: { type: "object", properties: { decks: { type: "number", enum: [1, 2, 4, 6, 8] }, h17: { type: "boolean" }, surrender: { type: "boolean" }, penetration: { type: "number", description: "% dealt, 50–90" }, blackjack_pays: { type: "string", enum: ["3:2", "6:5"] }, double_after_split: { type: "boolean" }, double_on: { type: "string", enum: ["any", "9-11", "10-11"] }, resplit_aces: { type: "boolean" }, split_to_hands: { type: "number", enum: [2, 3, 4] }, deviations: { type: "boolean", description: "false = basic strategy on every hand: no count plays and no insurance (the Deviations switch in the game rules). Leave out to keep the saved setting." } } },
    cover: {
      type: "object", description: "Cover plays and playing/counting mistakes. Each was measured in the card simulator; they add together.",
      properties: {
        deviations: { type: "array", description: "Change individual count plays (ids are listed in the system prompt). mode skip = play basic strategy there; always_high = always make the high-count play (e.g. always stand 16v10, always split 10s); always_low = always make the low-count play.", items: { type: "object", properties: { play: { type: "string" }, mode: { type: "string", enum: ["skip", "always_high", "always_low"] } }, required: ["play"] } },
        skip_all_deviations: { type: "boolean", description: "Basic strategy only on every hand (insurance is set separately)" },
        insurance: { type: "string", enum: ["normal", "never", ...av.insurance], description: "normal = at +3. tc1/tc2/tc4/tc5 = insure from that count. even_money_always = also insure every blackjack. good_hands_always = also insure every 20 and blackjack." },
        ...(av.habits.length ? { habits: { type: "array", description: "Playing habits: " + av.habits.map((h) => `${h} = ${HABITS[h][1]}`).join("; "), items: { type: "string", enum: av.habits } } } : {}),
        slip_rate_pct: { type: "number", description: "Percent of close decisions misplayed (forgetting a double/split/surrender, hit↔stand on stiffs and soft 18, doubling a 9–11 that should be hit). 1–2 is a tired but competent player." },
        ...(av.countMethods.length ? { count_method: { type: "string", enum: ["half_deck", ...av.countMethods], description: "How the true count is figured: half_deck (the app's default: decks left to the nearest half deck, result truncated toward zero), full_deck (decks left to the nearest whole deck), exact (perfect division, truncated), floor (half-deck, always rounded down), round_nearest (half-deck, rounded to the nearest whole number)" } } : {}),
        ...(av.miss ? { missed_cards_pct: { type: "number", description: "Percent of cards the user fails to count (0–8)" } } : {}),
      },
    },
    bet_policy: {
      type: "object", description: "Rules about how the bet may change from the previous hand (bet-jump cover). The spread still says what the user WANTS to bet at each count; these limit how fast they get there. They reset at each shuffle.",
      properties: { max_raise_multiple: { type: "number", description: "Raise at most to this multiple of the last bet (2 = never more than double)" }, max_drop_multiple: { type: "number", description: "Lower at most to last bet ÷ this" }, raise_only_after_win: { type: "boolean", description: "Parlay-style: only raise after winning the last hand" }, no_raise_after_loss: { type: "boolean" }, no_lower_after_win: { type: "boolean" }, lower_only_after_loss: { type: "boolean" }, hold_after_push: { type: "boolean" }, flat_first_rounds: { type: "number", description: "Bet no more than flat_bet for this many rounds after each shuffle" }, flat_bet: { type: "number" }, off_the_top_bet: { type: "number", description: "Bet this on the first round of every shoe" }, round_to: { type: "number" } },
    },
  },
});

// The tools offered to the model, limited to what has been measured for the user's rules.
export function toolsFor(R, flat) {
  const av = coverAvail(R || DEFAULT_RULES), SCEN = makeScen(av, flat), REF = flat ? SCEN : { type: "object", description: "One scenario, with exactly the same fields as a scenario in the calculate tool (bets, hands, rules, cover, bet_policy, bankroll…). Leave it out for the user's current game." };
  return [
  { name: "calculate", description: "Run the app's calibrated blackjack model on one or more scenarios and get win per hour, swing, risk of ruin, hours to the long run and the per-count table. Pass several scenarios to compare them side by side (always include an empty scenario {} named \"current\" when the user asks what a change would do). This is the ONLY source for these numbers — never estimate them yourself.", input_schema: { type: "object", properties: { scenarios: { type: "array", minItems: 1, maxItems: 6, items: SCEN } }, required: ["scenarios"] } },
  { name: "risk_over_time", description: "For one scenario: expected result, chance of being behind, result percentiles, and the chance of ever being down (or finishing down/up) given amounts, after given numbers of hours. Use for trip bankrolls, losing streaks and 'how long until I'm ahead' questions.", input_schema: { type: "object", properties: { scenario: REF, hours: { type: "array", items: { type: "number" } }, loss_amounts: { type: "array", items: { type: "number" } }, win_amounts: { type: "array", items: { type: "number" } }, session_hours: { type: "number", description: "Length of one session; adds the chance a session loses and of losing/winning several in a row" } } } },
  { name: "bankroll_needed", description: "Bankroll required to hold a scenario's risk of ruin to given levels, plus the full-Kelly bankroll. Optionally: cash to bring for a trip of trip_hours, and the chance and time to grow the bankroll to grow_to.", input_schema: { type: "object", properties: { scenario: REF, risk_of_ruin_pcts: { type: "array", items: { type: "number" } }, trip_hours: { type: "number" }, grow_to: { type: "number" } } } },
  { name: "stop_loss_and_win_goal", description: "What a per-session stop-loss and/or win goal does: which one is hit first and how often, how long a session lasts on average, and the chance each is hit within max_hours.", input_schema: { type: "object", properties: { scenario: REF, stop_loss: { type: "number" }, win_goal: { type: "number" }, max_hours: { type: "number" } } } },
  { name: "optimize_spread", description: "Find the best bets at each count: either the most profit under a risk-of-ruin cap, or the least risk that reaches a profit goal. Exact (same optimizer as the Spread page).", input_schema: { type: "object", properties: { scenario: REF, risk_of_ruin_cap_pct: { type: "number" }, profit_goal_per_hour: { type: "number" }, min_bet: { type: "number" }, max_bet: { type: "number" }, play_from_true_count: { type: "number", description: "Lowest count that gets a real bet" }, below_that: { type: "string", enum: ["sit_out", "min_bet"] } } } },
  { name: "correct_play", description: "The correct play for a hand against a dealer upcard under the user's rules (BJA basic strategy with the Illustrious 18 and Fab 4), at one true count or across all counts.", input_schema: { type: "object", properties: { cards: { type: "array", items: { type: "string" }, description: "Player cards, e.g. [\"A\",\"7\"] or [\"10\",\"6\"]" }, dealer_upcard: { type: "string" }, true_count: { type: "number" }, after_split: { type: "boolean" } }, required: ["cards", "dealer_upcard"] } },
  { name: "session_results", description: "The user's logged casino sessions: totals, actual vs expected, luck, by place and by month, biggest swings, recent sessions. Optional filters.", input_schema: { type: "object", properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string" }, where: { type: "string" }, list_recent: { type: "number" } } } },
  { name: "training_stats", description: "The user's practice record in the app: accuracy and speed by skill (basic strategy, deviations, running count, true count…), test results and live-play record.", input_schema: { type: "object", properties: { days: { type: "number", description: "Look-back window, default 30" } } } },
];
}

export async function runTool(name, input) {
  const base = await loadSetup(); input = input || {};
  try {
    if (name === "calculate") { const list = (input.scenarios || [{}]).slice(0, 6).map((s) => evalScenario(base, s || {})); const first = list[0]._; return { results: list.map((s, i) => ({ ...strip(s), ...(i > 0 ? { vs_first: { win_per_hour: r2(s._.evHour - first.evHour), swing_per_hour: r0(s._.sdHour - first.sdHour), win_change_pct: first.evHour ? r1((100 * (s._.evHour - first.evHour)) / Math.abs(first.evHour)) : null } } : {}) })) }; }
    if (name === "risk_over_time") return riskOverTime(base, input);
    if (name === "bankroll_needed") return bankrollNeeded(base, input);
    if (name === "stop_loss_and_win_goal") return stopRules(base, input);
    if (name === "optimize_spread") return optimize(base, input);
    if (name === "correct_play") return playLookup(base, input);
    if (name === "session_results") return await sessionStats(base, input);
    if (name === "training_stats") return await trainingStats(base, input);
    return { error: "unknown tool " + name };
  } catch (e) { return { error: String((e && e.message) || e) }; }
}

// What the assistant is told about the user before the first question.
export async function setupBrief() {
  const base = await loadSetup(), cur = strip(evalScenario(base, { name: "current" }));
  const sess = await getJ("bj-sessions-v1", []);
  const av = coverAvail(base.rules);
  return { base, tools: toolsFor(base.rules), toolsFlat: toolsFor(base.rules, true), text: JSON.stringify({ ...(av.countMethods.length ? {} : { not_measured_yet_for_these_rules: "counting shortcuts and missed cards" }), current_game: cur, table_limits_saved: { min: base.minBet, max: base.maxBet }, sessions_logged: sess.length, count_plays_for_these_rules: deviationCatalog(base.rules), }) };
}
