// Risk of ruin against real cards (slow: about 15 minutes, so it is not part of run.sh).
// For each game it takes the bets the Plan page scores (every hand played, the optimizer's best or safest spread), then
// deals real blackjack with them from the same bankroll, thousands of times over, until the bankroll is gone or has
// grown to K times its size, and prints the share that went broke beside the page's figure. "to Kx" is the page's own
// formula for the same stopping rule, so that is the number the dealt share should match.
// Run:  tools/checks/ruin.sh            (or pass a JSON list of [name, game, bankroll, limit %, bankrolls, K])
import { COUNTS, DEFAULT_RULES } from "./app.jsx";
import { scoreGame } from "./planner.jsx";
import { makeGame } from "./sim.js";
const base = { rules: { ...DEFAULT_RULES, h17: true, surrender: true, decks: 6, pen: 75 }, seats: 4, spotsMap: {}, minBet: 25, maxBet: 500, hphAuto: true, handsPerHour: 100 };
const D6 = { decks: 6, h17: true, das: true, surrender: true, pen: 75 };
const CASES = process.argv[2] ? JSON.parse(process.argv[2]) : [
  ["2 decks H17 $50-1000, $5k", { rules: { decks: 2, h17: true, das: true, pen: 60 }, min: 50, max: 1000 }, 5000, 5, 8000, 5],
  ["6 decks H17 LS $25-500, $5k", { rules: D6, min: 25, max: 500 }, 5000, 5, 6000, 4],
  ["6 decks S17 $15-500, $6k", { rules: { decks: 6, h17: false, das: true, pen: 75 }, min: 15, max: 500 }, 6000, 5, 5000, 3],
  ["8 decks H17 $15-2500, $10k", { rules: { decks: 8, h17: true, das: true, pen: 80 }, min: 15, max: 2500 }, 10000, 5, 4000, 2],
  ["6 decks H17 LS $25-500, $20k", { rules: D6, min: 25, max: 500 }, 20000, 5, 5000, 2]];
for (const [name, g, B, cap, N, K] of CASES) {
  const setup = { ...base, bankroll: B, rorPct: cap }, x = scoreGame(setup, g), R = { ...DEFAULT_RULES, ...g.rules };
  const bets = COUNTS.map((c) => x.bets[c]), a = -Math.log(x.ror) / B, H = K * B;
  const want = (Math.exp(-a * B) - Math.exp(-a * H)) / (1 - Math.exp(-a * H));
  const game = makeGame(R, 4, 777 + B), one = () => 1;
  let bust = 0, rounds = 0; const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    let b = B;
    while (b > 0 && b < H) { const r = game.next(one); b += bets[r.b] * r.x0; rounds++; }
    if (b <= 0) bust++;
  }
  const p = bust / N, se = Math.sqrt(Math.max(p * (1 - p), 1e-6) / N);
  console.log(`${name}: bets ${bets.join("/")}  page ${(100 * x.ror).toFixed(1)}% (to ${K}x: ${(100 * want).toFixed(1)}%)  dealt ${(100 * p).toFixed(1)}% ±${(200 * se).toFixed(1)}  [${N} bankrolls, ${(rounds / 1e6).toFixed(0)}M rounds, ${((Date.now() - t0) / 1000).toFixed(0)}s] ev/hr ${x.ev.toFixed(1)} sd ${x.sd.toFixed(0)} rph ${x.rph.toFixed(0)}`);
}
