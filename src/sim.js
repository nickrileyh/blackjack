// Card-by-card blackjack simulator (the same game the calibration tables were measured on, ported from the C
// simulator): BJA basic strategy + Illustrious 18 + Fab 4, Hi-Lo, true count on half-decks truncated toward zero,
// insurance at +3. It is used for bet rules that depend on what just happened (never raise after a loss, parlay,
// at most double the last bet…) — those can't be read off a per-count table, so the shoes are actually dealt.
//
// To keep the answer exact rather than noisy, every policy is scored on the SAME dealt rounds with the measured
// per-count edge and variance, and reported relative to the plain spread on those same rounds.
const NIL = 9999;
// identical to the simulator's table (key: hard total, 100+k for soft A-k, 200 for 10,10) — index = deviation id.
// Eighth field: 1 = a "0+" play (made only on a positive running count), -1 = a "0−" play (dropped only on a negative one);
// it applies when the index for these rules is 0, exactly as the app's own decision function plays them.
export const DEV_DEFS = [
  [10, 16, 0, 0, "H", "S", 0, 1], [9, 16, 4, 4, "H", "S", 0], [11, 16, NIL, 3, "H", "S", 0], [10, 15, 4, 4, "H", "S", 0], [11, 15, NIL, 5, "H", "S", 0],
  [4, 200, 6, 6, "S", "P", -1], [5, 200, 5, 5, "S", "P", -1], [6, 200, 4, 4, "S", "P", -1],
  [10, 10, 4, 4, "H", "D", -1], [11, 10, 4, 3, "H", "D", -1], [11, 11, 1, NIL, "H", "D", -1],
  [2, 12, 3, 3, "H", "S", -1], [3, 12, 2, 2, "H", "S", -1], [4, 12, 0, 0, "H", "S", -1, -1], [2, 13, 0, 0, "H", "S", -1],
  [2, 9, 1, 1, "H", "D", -1], [7, 9, 3, 3, "H", "D", -1], [6, 8, 2, 2, "H", "D", -1],
  [4, 108, 3, 3, "S", "D", -1], [5, 108, 1, 1, "S", "D", -1], [6, 108, 1, 0, "S", "D", -1, -1], [2, 106, 1, 1, "H", "D", -1], [2, 107, 1, 0, "S", "D", -1, -1],
  [8, 16, 4, 4, "H", "R", 1], [9, 16, -1, -1, "H", "R", 1], [9, 15, 2, 2, "H", "R", 1], [10, 15, 0, 0, "H", "R", 1, -1], [11, 15, 2, -1, "H", "R", 1],
];
const bucket = (tc) => (tc < -3 ? 0 : tc > 6 ? 9 : tc + 3);

// opts (all optional): tcm — how the counter figures the true count (0 half-deck truncated, 1 full-deck, 2 exact,
// 3 half-deck floored, 4 half-deck rounded to nearest); miss — share of cards the counter fails to count;
// perShoe — reseed every shoe from its number, so two runs with different settings see the same shoes.
export function makeGame(R, seats, seed = 12345, opts = {}) {
  const DECKS = [1, 2, 4, 6, 8].includes(+R.decks) ? +R.decks : 6, H17 = !!R.h17, SUR = !!R.surrender, INS = R.insurance !== false;
  const DAS = R.das !== false, DBL = R.dbl === "9-11" ? 1 : R.dbl === "10-11" ? 2 : 0, RSA = !!R.rsa, MAXH = +R.maxHands === 2 || +R.maxHands === 3 ? +R.maxHands : 4, BJP = R.bj65 ? 1.2 : 1.5;
  const NOTH = Math.min(6, Math.max(0, Math.round(+seats || 1) - 1));
  const N = 52 * DECKS, shoe = new Int8Array(N), cut = Math.floor((Math.min(90, Math.max(50, +R.pen || 75)) / 100) * N);
  { let k = 0; for (let d = 0; d < DECKS; d++) for (let s = 0; s < 4; s++) { for (let r = 2; r <= 9; r++) shoe[k++] = r; for (let t = 0; t < 4; t++) shoe[k++] = 10; shoe[k++] = 11; } }
  let st = (seed >>> 0) || 1; const rnd = (n) => { st ^= st << 13; st >>>= 0; st ^= st >>> 17; st ^= st << 5; st >>>= 0; return Math.floor((st / 4294967296) * n); };
  const TCM = opts.tcm | 0, MISS = +opts.miss > 0 ? +opts.miss : 0; let ms = 0x9e3779b9, shoeNo = 0;
  const missed = () => { ms ^= ms << 13; ms >>>= 0; ms ^= ms >>> 17; ms ^= ms << 5; ms >>>= 0; return ms / 4294967296 < MISS; };
  let pos = 0, lim = N, rc = 0, rstart = 0, force = false;
  const fy = (n) => { for (let i = n - 1; i > 0; i--) { const j = rnd(i + 1), t = shoe[i]; shoe[i] = shoe[j]; shoe[j] = t; } };
  const shuffle = () => {
    if (opts.perShoe) { shoeNo++; let h = (Math.imul(shoeNo, 2654435761) ^ (seed >>> 0)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; st = h || 1; ms = (h ^ 0x9e3779b9) >>> 0 || 1; }
    fy(N); pos = 0; lim = N; rc = 0; force = false; rstart = 0;
  };
  const draw = () => { if (pos >= lim) { fy(rstart); lim = rstart; pos = 0; rc = 0; force = true; } return shoe[pos++]; };
  const see = MISS ? (c) => { if (!missed()) rc += c <= 6 ? 1 : c >= 10 ? -1 : 0; } : (c) => { rc += c <= 6 ? 1 : c >= 10 ? -1 : 0; };
  const tcNow = TCM === 0 ? () => { let r = Math.floor(((lim - pos) / 52) * 2 + 0.5) / 2; if (r < 0.5) r = 0.5; return Math.trunc(rc / r); }
    : () => { const rem = (lim - pos) / 52; let r; if (TCM === 1) { r = Math.floor(rem + 0.5); if (r < 1) r = 1; } else if (TCM === 2) { r = rem; if (r < 0.25) r = 0.25; } else { r = Math.floor(rem * 2 + 0.5) / 2; if (r < 0.5) r = 0.5; } const t = rc / r; return TCM === 3 ? Math.floor(t) : TCM === 4 ? Math.floor(t + 0.5) : Math.trunc(t); };
  // deviations for these rules: dev[sur?1:0][up][key]
  const dev = [{}, {}];
  DEV_DEFS.forEach(([up, key, s17, h17, below, above, ls, edge]) => { const idx = H17 ? h17 : s17; if (idx === NIL) return; for (let e = 0; e < 2; e++) { if (ls !== -1 && ls !== e) continue; dev[e][up * 256 + key] = [idx, above, below, idx === 0 ? edge || 0 : 0]; } });
  const hardRule = (t, u, sur) => {
    if (t >= 18) return "S"; if (t === 17) return u === 11 && H17 && sur ? "R" : "S";
    if (t === 16) return u <= 6 ? "S" : sur && u >= 9 ? "R" : "H";
    if (t === 15) return u <= 6 ? "S" : sur && (u === 10 || (u === 11 && H17)) ? "R" : "H";
    if (t >= 13) return u <= 6 ? "S" : "H"; if (t === 12) return u >= 4 && u <= 6 ? "S" : "H";
    if (t === 11) return u <= 10 || H17 ? "D" : "H"; if (t === 10) return u <= 9 ? "D" : "H"; if (t === 9) return u >= 3 && u <= 6 ? "D" : "H"; return "H";
  };
  const softRule = (k, u) => {
    if (k === 9) return "S"; if (k === 8) return u === 6 && H17 ? "D" : "S";
    if (k === 7) return (u >= 3 && u <= 6) || (u === 2 && H17) ? "D" : u <= 8 ? "S" : "H";
    if (k === 6) return u >= 3 && u <= 6 ? "D" : "H"; if (k >= 4) return u >= 4 && u <= 6 ? "D" : "H"; return u >= 5 && u <= 6 ? "D" : "H";
  };
  const pairRule = (c, u, sur) => {
    if (c === 11) return "P";
    if (!DAS) { if (c === 2 || c === 3) return u >= 4 && u <= 7 ? "P" : "H"; if (c === 4) return "H"; if (c === 6) return u >= 3 && u <= 6 ? "P" : "H"; }
    if (c === 8) return u === 11 && H17 && sur ? "R" : "P"; if (c === 10) return "S";
    if (c === 9) return u <= 6 || u === 8 || u === 9 ? "P" : "S"; if (c === 7) return u <= 7 ? "P" : "H"; if (c === 6) return u <= 6 ? "P" : "H";
    if (c === 5) return hardRule(10, u, sur); if (c === 4) return u === 5 || u === 6 ? "P" : "H"; return u <= 7 ? "P" : "H";
  };
  const dblOk = (tot, soft) => (DBL === 0 ? true : soft ? false : DBL === 1 ? tot >= 9 && tot <= 11 : tot >= 10 && tot <= 11);
  // a hand: {n, c0, c1, hard, aces, tot, soft, bet, sa, fs, bj, sur, bust}
  const newHand = (bet) => ({ n: 0, c0: 0, c1: 0, hard: 0, aces: 0, tot: 0, soft: false, bet, sa: false, fs: false, bj: false, sur: false, bust: false });
  const hadd = (h, c) => { if (h.n === 0) h.c0 = c; else if (h.n === 1) h.c1 = c; h.n++; h.hard += c === 11 ? 1 : c; if (c === 11) h.aces++; if (h.aces && h.hard + 10 <= 21) { h.tot = h.hard + 10; h.soft = true; } else { h.tot = h.hard; h.soft = false; } if (h.tot > 21) h.bust = true; };
  const decide = (h, up, tc, canD, canP, canS, usedev) => {
    const sur = canS && SUR, tot = h.tot, soft = h.soft; let base, key = 0;
    if (canP && h.n === 2 && h.c0 === h.c1) { base = pairRule(h.c0, up, sur); key = h.c0 === 10 ? 200 : 0; }
    else if (soft && tot >= 13 && tot <= 20) { base = softRule(tot - 11, up); key = 100 + (tot - 11); }
    else if (soft && tot === 21) base = "S";
    else if (soft && tot === 12) base = canP && h.n === 2 ? "P" : "H";
    else { base = hardRule(tot > 21 ? 21 : tot, up, sur); key = tot; }
    let act = base;
    if (usedev && key) { const d = dev[sur ? 1 : 0][up * 256 + key]; if (d && !(d[1] === "P" && !canP)) act = (d[3] && tc === 0 ? (d[3] > 0 ? rc > 0 : rc >= 0) : tc >= d[0]) ? d[1] : d[2]; }
    if (act === "D" && !canD) act = soft && (tot === 18 || tot === 19) ? "S" : "H";
    if (act === "P" && !canP) act = hardRule(tot, up, sur);
    if (act === "R" && !canS) act = "H";
    return act;
  };
  const dealTo = (sp, h) => { const c = draw(); see(c); hadd(h, c); sp.nc++; };
  const resplitAces = (sp, h) => { while (RSA && h.n === 2 && h.c1 === 11 && sp.h.length < MAXH) { const nh = newHand(h.bet); nh.fs = true; nh.sa = true; hadd(nh, 11); sp.h.push(nh); const b = h.bet; Object.assign(h, newHand(b)); h.fs = true; h.sa = true; hadd(h, 11); dealTo(sp, h); } };
  const playSpot = (sp, up) => {
    for (let i = 0; i < sp.h.length; i++) {
      const h = sp.h[i];
      if (h.n === 1) { dealTo(sp, h); if (h.sa) { resplitAces(sp, h); continue; } }
      if (h.n === 2 && h.tot === 21 && !h.fs) { h.bj = true; continue; }
      for (;;) {
        if (h.tot >= 21) break;
        const canD = h.n === 2 && (DAS || !h.fs) && dblOk(h.tot, h.soft), canP = h.n === 2 && h.c0 === h.c1 && sp.h.length < MAXH && !h.sa, canS = h.n === 2 && !h.fs && sp.h.length === 1;
        const act = decide(h, up, sp.user ? tcNow() : 0, canD, canP, canS, sp.user);
        if (act === "S") break;
        if (act === "H") { dealTo(sp, h); continue; }
        if (act === "D") { h.bet *= 2; dealTo(sp, h); break; }
        if (act === "R") { h.sur = true; break; }
        if (act === "P") {
          const nh = newHand(h.bet); nh.fs = true; const c0 = h.c0, c1 = h.c1, b = h.bet;
          Object.assign(h, newHand(b)); hadd(h, c0); hadd(nh, c1); h.fs = true; sp.h.push(nh);
          if (c0 === 11) { h.sa = true; nh.sa = true; }
          dealTo(sp, h);
          if (h.sa) { resplitAces(sp, h); break; }
          continue;
        }
      }
    }
  };
  // one round with nu user spots (0, 1 or 2) at one unit each → per-unit result of each (insurance included)
  const res = [0, 0];
  const playRound = (nu) => {
    const sps = [], uidx = []; const nb = NOTH > 0 ? 1 : 0;
    const add = (u) => { const s = { h: [newHand(1)], user: u, nc: 0 }; if (u) uidx.push(sps.length); sps.push(s); };
    if (nu === 0) for (let i = 0; i < NOTH; i++) add(false);
    else { for (let i = 0; i < nb; i++) add(false); for (let i = 0; i < nu; i++) add(true); for (let i = 0; i < NOTH - nb; i++) add(false); }
    for (const s of sps) { const c = draw(); see(c); hadd(s.h[0], c); s.nc++; }
    const up = draw(); see(up);
    for (const s of sps) { const c = draw(); see(c); hadd(s.h[0], c); s.nc++; }
    const hole = draw(); res[0] = 0; res[1] = 0;
    const take = nu > 0 && up === 11 && INS && tcNow() >= 3;
    const dbj = (up === 10 && hole === 11) || (up === 11 && hole === 10);
    if (dbj) { see(hole); for (let k = 0; k < nu; k++) { const h = sps[uidx[k]].h[0]; res[k] = (h.n === 2 && h.tot === 21 ? 0 : -1) + (take ? 1 : 0); } return; }
    for (const s of sps) playSpot(s, up);
    see(hole);
    let live = false; for (const s of sps) for (const h of s.h) if (!h.bust && !h.sur && !h.bj) live = true;
    const d = newHand(0); hadd(d, up); hadd(d, hole);
    if (live) while (d.tot < 17 || (d.tot === 17 && d.soft && H17)) { const c = draw(); see(c); hadd(d, c); }
    for (let k = 0; k < nu; k++) { let r = take ? -0.5 : 0; for (const h of sps[uidx[k]].h) { if (h.sur) r += -0.5 * h.bet; else if (h.bust) r += -h.bet; else if (h.bj) r += BJP * h.bet; else if (d.tot > 21) r += h.bet; else if (h.tot > d.tot) r += h.bet; else if (h.tot < d.tot) r += -h.bet; } res[k] = r; }
  };
  shuffle();
  return {
    headsUp: NOTH === 0,
    // deals the next round: spotsFor(bucket) says how many hands you play at that count. Returns null when you left the shoe.
    next(spotsFor) {
      let fresh = false;
      for (;;) {
        if (pos >= cut || force) { shuffle(); fresh = true; }
        rstart = pos; const b = bucket(tcNow()), nu = spotsFor(b);
        if (nu === 0 && NOTH === 0) { force = true; continue; } // heads-up: a $0 count means you leave and start a fresh shoe
        playRound(nu);
        return { b, nu, x0: res[0], x1: res[1], fresh };
      }
    },
  };
}

// What a policy bets this round. `want` is the spread's bet at this count; `p` is the policy; `s` its running state.
export function policyBet(p, s, want, b, fresh) {
  if (fresh) { s.prev = 0; s.n = 0; }
  if (!(want > 0)) return 0;
  let bet = want; const prev = s.prev, last = s.last; // last: 1 won, -1 lost, 0 pushed
  if (p.flatFirst && s.n < p.flatFirst) bet = Math.min(bet, p.flatBet || bet);
  if (s.n === 0 && p.offTopBet > 0) bet = p.offTopBet;
  if (prev > 0) {
    if (bet > prev) {
      if ((p.raiseOnlyAfterWin && last !== 1) || (p.noRaiseAfterLoss && last === -1) || (p.holdAfterPush && last === 0)) bet = prev;
      else if (p.maxRaise > 0) bet = Math.min(bet, prev * p.maxRaise);
    } else if (bet < prev) {
      if ((p.noLowerAfterWin && last === 1) || (p.lowerOnlyAfterLoss && last !== -1) || (p.holdAfterPush && last === 0)) bet = prev;
      else if (p.maxDrop > 0) bet = Math.max(bet, prev / p.maxDrop);
    }
  }
  if (p.roundTo > 0) bet = Math.max(p.roundTo, Math.round(bet / p.roundTo) * p.roundTo);
  if (p.cap > 0) bet = Math.min(bet, p.cap);
  return bet;
}

// Deal `rounds` rounds and score every policy on them. edge[b], m1[b] (one hand) and m2[b] (two hands) are the
// calibrated per-count edge and second moment per unit; spots[b] the hands played at each count.
export function runPolicies({ R, seats, spots, bets, edge, m1, m2, policies, rounds = 400000, seed = 2024 }) {
  const g = makeGame(R, seats, seed), spotsFor = (b) => spots[b];
  const P = policies.map((p) => ({ p, s: { prev: 0, n: 0, last: 0 }, ev: 0, ex2: 0, act: 0, real: 0, hist: {}, top: 0, changed: 0 }));
  let played = 0, total = 0; const freq = new Float64Array(10);
  for (let t = 0; t < rounds; t++) {
    const r = g.next(spotsFor); total++; freq[r.b]++;
    const want = r.nu > 0 ? bets[r.b] : 0; if (r.nu > 0) played++;
    const net = r.x0 + (r.nu === 2 ? r.x1 : 0), sign = net > 0 ? 1 : net < 0 ? -1 : 0;
    for (const q of P) {
      const bet = policyBet(q.p, q.s, want, r.b, r.fresh);
      if (bet > 0) {
        q.ev += bet * r.nu * edge[r.b]; q.ex2 += bet * bet * (r.nu === 2 ? m2[r.b] : m1[r.b]); q.act += bet * r.nu; q.real += bet * net;
        const k = Math.round(bet); q.hist[k] = (q.hist[k] || 0) + 1; if (bet > q.top) q.top = bet; if (bet !== want) q.changed++;
        q.s.prev = bet; q.s.last = sign; q.s.n++;
      }
    }
  }
  return { rounds: total, played, freq: Array.from(freq, (x) => x / total), out: P.map((q) => ({ ev: q.ev / total, ex2: q.ex2 / total, avgBet: played ? q.act / played : 0, real: q.real / total, top: q.top, changedShare: played ? q.changed / played : 0, hist: q.hist })) };
}

// How a different way of counting changes the mix of true counts you THINK you're at, for this exact spread pattern
// (sitting out, two hands, table size, penetration): the same shoes are dealt to the normal counter and to the
// variant, and the ratio of how often each lands on every count is returned.
export function countShift({ R, seats, spots, opts, rounds = 400000, seed = 4242 }) {
  const run = (o) => { const g = makeGame(R, seats, seed, { ...o, perShoe: true }), f = new Float64Array(10), sf = (b) => spots[b]; for (let t = 0; t < rounds; t++) f[g.next(sf).b]++; return f; };
  const a = run({}), b = run(opts);
  return Array.from(a, (x, i) => (x > rounds * 2e-5 ? b[i] / x : 1));
}
