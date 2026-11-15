# Cover-play simulator

The Ask tab's cover-play costs (`src/coverdata.js`) are measured, not estimated. This folder holds the card
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
