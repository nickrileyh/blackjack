# Cover-play simulator

The Ask tab's cover-play costs (`src/coverdata.js`) are measured, not estimated. This folder holds the card
simulator that produced them. You only need it to add a new cover play or re-measure; the app itself never runs it.

- `cover_sim.c` — the blackjack simulator (BJA basic strategy + Illustrious 18 + Fab 4, Hi-Lo, half-deck true count
  truncated toward zero, insurance at +3). Two modes matter here:
  - `cdelta decks h17 sur others rounds seed` — plays every round normally, then replays it from the same cards with
    each cover play whose situation came up (count plays forced three ways, insurance variants, habits 1–6, 5% slips).
    Prints the per-true-count change in edge and second moments for each.
  - `cerr decks h17 sur others rounds seed` — counting shortcuts and errors (2% / 5% of cards missed, full-deck, exact
    and floored true counts). These move which count you think you're at, so it prints the new mix of counts too.
- `cover_sim_batch2.c` — same simulator with habits 7–13 and the round-to-nearest true count.
- `cover_sim_check.c` — adds `sdelta`: one spread played by the normal counter and by any mix of cover plays from the
  same cards. `val_cover.py` uses it to check the app's answers.
- `build_cover.py` — turns the result files (`cv/`, `cv2/`, `ce/`, `ce2/`, named `decks_h17_sur.json`) into
  `src/coverdata.js`.

Build with `gcc -O2 -march=native -o cover_sim cover_sim.c -lm`. The shipped tables used 300 million rounds per rule
set for `cdelta` and 100 million for `cerr`, with 2 other players and 75% penetration, for 1, 2, 4, 6 and 8 decks,
H17 and S17, surrender on and off.

Adding a cover play: add a switch in `decide()` (set a trigger bit when the situation comes up, change the action when
the switch is on), replay it in `run_cdelta`, re-run, rebuild `coverdata.js`, then name it in `src/cover.js`
(`HABITS` or a new list) so the assistant's tool schema offers it.
