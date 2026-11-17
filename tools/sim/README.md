# Simulators

Everything the calculator knows was measured by dealing cards. This folder holds the simulators and the scripts that
pack their results into the app. The app itself never runs them. Two parts: the calibration tables and strategy check
(first section), and the cover-play costs (second; the Ask tab that showed them was removed in Nov 2026, the Deviations switch still uses them).

## Calibration tables and the strategy check

`table_sim.c` plays BJA basic strategy with the Illustrious 18 and Fab 4 (Hi-Lo, half-deck true count truncated toward
zero, insurance at +3), including the running-count plays (0+ / 0−) exactly as `devOver` in `src/app.jsx` decides them.
Build with `gcc -O2 -march=native -o table_sim table_sim.c -lm`. Modes:

- `cal decks h17 sur others rounds seed` — the edge and swing tables (`CALR`): per true count, the edge per hand,
  insurance's share, E[x²] and the covariance of two hands, tallied for every penetration from 50% to 90% at once.
  It also prints the edge by depth in the shoe (`bins`), which `build_cal.py` needs for 1 and 2 decks.
- `freq decks others rounds seed pattern` — how often each count comes up for one playing pattern (`CALQ`): `pattern`
  is ten digits, one per count from −3 to +6: 0 sit out, 1 one hand, 2 two hands. `FH17` / `FSUR` set the rules.
- `rdelta` — table rules (`CALX`): each round played with and without a rule from the same cards.
- `audit decks h17 sur others rounds seed` — the strategy check. For your first decision of every round it replays the
  hand from the same cards with every legal play, and for each count play it compares the two plays at each true
  count (and, at a true count of 0, by the sign of the running count). `audit_report.py` reads `aud/a_*.json` and
  lists every basic strategy cell where another play beats the chart and every index the cards disagree with. The report
  for the shipped run is `strategy-check.txt` (gains are in percent of the bet, ± one standard error). It is printed
  against the app's indices as they are now; the run itself was dealt surrendering 16 vs 9 and 15 vs A (H17) at −1 and
  hitting only from −2, one count late (the chart's −1 means hit at −1 and below; `defs[]` holds the lowest count
  for the "above" play, so both are 0 there now).
- `val decks h17 sur ins others pen rounds seed bets spots` — plays one spread outright. `val_base.py` uses it to check
  the calculator: random games and spreads, the simulator's result against `calFor` / `compute`.
- `idx` — one hand against one upcard, both plays from the same cards, by true count (`PROBE=key,up,A,B`).

`A7V2="index,edge"` overrides the H17 index for soft 18 vs 2 (default `0,-1`: stand on a negative running count, the
index the strategy check found; the BJA chart prints none for H17).

What the shipped tables were built from (64 billion rounds):

| Part | Rounds |
|---|---|
| `cal`: 6 and 8 decks, 400 million heads-up and 100 million for each larger table (pooled, 600 million) per rule set; 4 decks 240 million per game; 1 and 2 decks 190 million per game | 25.4 billion |
| `freq`: 1 and 2 decks, per pattern, rule set and table size: 16 million (`fam7/`) pooled with an earlier 24 million (`fam12/`, `fam12r/`) | 9.7 + 14.7 billion |
| `freq`: 4 to 8 decks, 16 million per pattern and table size (`fam/`) | 6.1 billion |
| `rdelta`: table rules | 2.7 billion |
| `audit`: 250–300 million for each of the 20 games (5 deck counts × H17/S17 × surrender), plus `idx` runs for soft 18 vs 2 | 5.9 billion |

`build_cal.py` (run it in the folder holding the result folders) packs `cal7/`, `fam/`, `fam12/`, `fam12r/` and `fam7/`
into `caldata.js`: the three lines `const CALR = …`, `const CALQ = …`, `const CALD = …` that replace the same lines of
`src/app.jsx` (a second seed of a table, `c_…_b.json`, is pooled with the first). For 1 and 2 decks a playing pattern
changes where in the deck your hands fall, and the same count is worth a different amount early and late; `CALD` is
that shift. It is measured two ways and the two are combined cell by cell: predicted from the big `cal` run's edge by
depth and each pattern's own tally of where its hands fell (little noise, but depth doesn't explain everything,
least of all with one deck), and directly from the pattern runs' own edges (no model error, more noise). The script
prints, per group, how far the two sit apart beyond noise (`tau`) and weights the direct measurement by
tau² / (tau² + its noise). `CALDMODE=binned` or `direct` builds with one of them alone.

How well it holds up. Ten games with a realistic ramp (sit out at 0 or −1 and below, 1 to 10 units), each played for
500 million rounds and compared with the calculator's win rate: the gap is 0.4% to 2.8% (median 1.1%); the tables this
run replaced were off by up to 5.3% on the same games (heads-up shoes, double deck and 8-deck S17 improved most). What
is left is mostly the tables' own noise: a shared 6- or 8-deck table rests on 600 million rounds per rule set, and the
few hands at +5 and up carry much of a big spread's profit. A wider, noisier check (64 random games and spreads, 40
million rounds each) shows the remaining model error: about 2% with 4 decks, and several percent for single-deck
spreads that both sit out and play two hands, where the app combines two measured patterns.

## Cover-play simulator

The cover-play costs (`src/coverdata.js`) are measured, not estimated. This folder holds the card
simulator that produced them. You only need it to add a new cover play or re-measure; the app itself never runs it.

- `cover_sim.c` — the blackjack simulator (BJA basic strategy + Illustrious 18 + Fab 4, Hi-Lo, half-deck true count
  truncated toward zero, insurance at +3). One run tallies every penetration from 50% to 90% at once.
  - `cdelta decks h17 sur others rounds seed` — plays every round normally, then replays it from the same cards with
    each cover play whose situation came up: every count play forced three ways (basic strategy, always the high-count
    play, always the low-count play), seven insurance variants, thirteen playing habits, and 5% slips on close
    decisions. Prints the per-true-count change in edge for each (and in the second moments at 75%).
  - `cerr decks h17 sur others rounds seed` — counting shortcuts and errors (2% / 5% of cards missed; full-deck, exact,
    floored and rounded true counts). These move which count you think you're at, so it prints the new mix of counts
    as well as the edge at each.
- `build_cover.py` — turns the result files (`g/cdelta_<decks>_<h17>_<sur>_<others>.json`, `g/cerr_…_2.json`) into
  `src/coverdata.js`. Count plays are stored as one reference row each plus a scale grid by table size × penetration;
  everything else as a reference row plus penetration and table-size terms.
- `cover_sim_check.c` + `val_cover.py` — the check: `sdelta` plays one spread as the normal counter and with any mix
  of cover plays from the same cards, and the script compares that with what the app's calculator says.

Build with `gcc -O2 -march=native -o cover_sim cover_sim.c -lm`.

The shipped tables: every deck count (1, 2, 4, 6, 8) × H17/S17 × surrender on/off. For each, `cdelta` at 3 players
(150 million rounds), heads-up and a full table (75 million each; "full" is 5 players at 1–2 decks, 7 otherwise),
and `cerr` at 3 players (50 million rounds).

How well it holds up (see `val_cover.py`): playing cover — skipped or forced count plays, insurance, habits, slips —
lands within about 1–2% of the win rate across table sizes and penetrations (single deck: count plays within ~15% of
their own cost). Counting methods and missed cards are rougher, about 5% of the win rate.

Adding a cover play: add a switch in `decide()` (set a trigger bit when the situation comes up, change the action when
the switch is on), replay it in `run_cdelta`, re-run, rebuild `coverdata.js`, then name it in `src/cover.js`
(`HABITS` or a new list) so the assistant's tool schema offers it.
