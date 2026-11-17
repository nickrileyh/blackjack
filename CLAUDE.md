# Blackjack Trainer — notes for any Claude session working on this repo

## Keep every chat in sync

This repo's `main` branch is the single source of truth. GitHub Pages serves it directly.

1. **Before changing anything**, fetch the latest `main` and start from those files. Never start from a copy saved earlier in a chat.
2. **After changing anything**, commit and push to `main` in the same turn, then tell Nick what was pushed.
3. If `main` moved while you were working, rebase onto it and re-check your change before pushing. Do not overwrite someone else's newer files.
4. Only touch the files your change needs. Do not regenerate or replace icons, `manifest.json` or `sw.js` unless that is the task.
5. When anything in `index.html` or the cached files changes in a way users must pick up, bump `CACHE` in `sw.js`.

## Source and build

`index.html` is a generated file: the whole app (React + CSS + fonts) compiled into one offline page. **Never edit it by hand** — the next build overwrites it. Edit the source and rebuild:

- `src/app.jsx` — the entire app (all components, styles in the `css` template string, strategy/sim data)
- `src/head.html` — everything in `<head>` before the app styles (meta tags, icon links, inlined fonts)
- `src/entry.jsx` — mounts the app and the `window.storage` wrapper around localStorage
- `src/casinos.jsx`, `src/casino-map.js`, `src/casino-data.js` — the Casinos page, its map maths and its generated data (see "Casinos page" below)
- `src/input.css` — Tailwind entry
- `src/sound.js`, `src/sound-data.js` — the sound effects and their recordings (see "Sound" below; `sound-data.js` is generated)
- `src/planner.jsx` — the Plan tab and the casino scores (see "Plan tab" below)
- `src/cover.js`, `src/coverdata.js`, `src/sim.js` — what a count play is worth and the card simulator behind it; `calFor` uses them for the "Deviations off" switch
- `build.sh` — `npm ci` once, then `./build.sh` writes `index.html` (scratch files go to `.build/`, ignored)

Commit the source change and the rebuilt `index.html` together. `build.sh` never touches the icons, `manifest.json` or `sw.js`.

## The Ask tab was removed

Nick asked for the AI assistant tab to be taken out (Nov 2026). `src/ask.jsx` and `src/aitools.js` are gone, with the tab, its Settings card and its palette entry; `src/entry.jsx` clears the API key and chats it had saved on the device (`bj:__ask-key`, `bj-ask-v1`). `src/cover.js`, `src/coverdata.js` and `src/sim.js` stay: the calculator's "Deviations off" switch runs on them. Don't bring the tab back unless he asks.

## Navigation and motion

- Phone: bottom tab bar; desktop (1024px+): sidebar. Train has Strategy / Drills tabs. On Train and Live play the table comes first and stats sit below it.
- **Keep pages plain** (Nick asks for simple, clean and sleek every time): the page header is the page name, the rules pill and the gear — no label above the name except today's date on Home. Explanations that aren't needed to use a page fold away behind `Info` ("How it works", "How to set it up", "About these numbers"), and secondary figures behind a "More …" link (Sessions shows four stats, with streak, average win/loss, upswing and swings behind "More stats"). Fold things away rather than delete them — every function stays.
- The compact top bar (`TopBar`) appears on scroll and shows only the page title and rules pill. Section chips in it were tried and removed at Nick's request (he wants the app kept clean) — don't add extra navigation rows. The "Ramp ↓ · Your numbers ↓ …" jump pills at the top of Bet spread were removed for the same reason.
- Desktop layout (1180px+): every page is up to 1120px wide and uses two columns through `.dgrid` / `.dcol` wrappers, which are `display: contents` below that width — so the phone order is simply the source order. `.dgrid.wl` is a wide-left split (table or main content left, stats and reference right); `.narrow` and `.segw` keep single cards and switches from stretching. `.deskonly` / `.notdesk` show or hide an element on wide screens.
- Jump-to palette (`CommandPalette`, opened with ⌘K / Ctrl K, `/`, or the sidebar button): lists every page, drill and action — no theme rows (Nick removed those). When adding a page or drill, add it to `cmdItems` in `App`.
- `go(tab, options)` also fires a `bj-nav` event when the target page is already open; pages read it with `useNav` (train mode/view, drill, log sheet).
- `Seg` (segmented control) has a pill that slides to the selected option when its options sit in one row. In the dark themes the selected option is an accent-tinted glass pill with light text (the same look as the sidebar highlight), not the old ivory pill; the light theme keeps its solid pill.
- Keep motion small and purposeful, and add anything new to the `prefers-reduced-motion` rule.
- **Entrance motion is one small kit** (in the `css` string, after `.growy`), so every chart and meter moves the same way. Use these rather than inventing new keyframes; all of them are switched off together in the `prefers-reduced-motion` rule, and all use `backwards` fill so nothing is left clipped or dashed once they finish:
  - `.drawline` + `pathLength="1"` on a solid SVG line: it traces itself with an easy ease (`--ee`). Used on the Sessions chart, the full-screen chart, the Home sparkline and the bell curve.
  - `.wipex` on the `<svg>` itself: a left-to-right reveal, for charts drawn with `vector-effect: non-scaling-stroke` or a filled area (Live play money chart, desktop Home chart), where a dash trace is unreliable.
  - `.fadein` (bands, dashed lines, labels) and `.popin` (the end dot). Add `.late` to anything that should land as the line arrives: it is timed off `--trace`, the one variable that sets how long a line takes to draw (0.66 s — Nick asked for the animations to be quick; change the pace there, not per chart).
  - `.bary` on a column and `.barlab` on the number above it (set `--i` to the column's index for the stagger): bet ramps, the optimizer's bars, dealer outcomes. `.barx` on a meter fill: mastery, skills, long run, odds.
  - Wrap a chart's moving parts in a `<g key=…>` built from what is drawn, so a new filter or new data plays the entrance again (see `PnlChart`).
- Numbers that move: `<Glide v={n} f={format} />` glides to a new value when it changes (add `enter` to also count up from zero when the page opens — headline numbers only). It is a tiny component on purpose: only its own text re-renders each frame, never the page. `useTween` is the hook underneath (used by `LuckGauge`, whose marker rides the curve). Don't tween a number with a hook at the top of a big page component.
- Small phones (320–370px) are checked: the tab capsule's six tabs share the width (`.navbtn{flex:1 1 0;min-width:0}`, labels step down a size), the page title and rules pill shrink so they never touch, and rows of answer buttons carry the `acts` class (side padding, no wrapping). On touch screens small text links, steppers and round icon buttons get a larger invisible touch area (`@media (pointer:coarse)` in the `css` string) — keep new small controls inside those selectors.
- A true count of zero prints as "0", never "+0" (`fmtTC`).
- Rows that must fit a phone are checked at 320, 360, 375 and 390px, not just one size: a row of five answer buttons tightens below 390px (the `nth-last-child(n+5)` rule next to `.acts`), the bet table on Bet spread is `.btrow` (below 431px "Show frequencies" swaps the EV/round column for Freq % instead of adding a sixth column), the deviation list is `.devrow`, and the Fill chart play picker is `.chipseg.brushes`. Change their columns in the `css` string, not inline.
- A tap outside only counts when the press **started** on the dimmed backdrop: spread `{...backdrop(close)}` on any new backdrop instead of `onClick={close}` (a slider dragged out of a dialog used to close it and lose the change).
- On desktop there is **one** rules pill, on a fixed rail (`.pillrail`, rendered beside `TopBar`): it sits level with the page title and glides up into the top bar on scroll (`TopBar` sets `html.scrolled`), so nothing swaps or jumps. The header's and the top bar's own pills are hidden at 1024px+ and still used on phones.
- `.dgrid.two` balances a page whose right column would run long (Settings): a third wrapper, `.dcol.cont`, placed after the right column in the source, continues the **left** column on desktop, so the phone order is untouched.
- The desktop sidebar has one highlight (`.sn-glide`) that slides to the current page; `App` places it from the active item's `offsetTop` (no transition on first paint or on resize).
- Sheets (`Sheet`) close four ways: the ×, a tap outside, Escape, and on a phone a drag down on the top of the sheet (`.sheetgrab`: the grab bar and title row; a short drag springs back). Each of those plays a short exit (`.sheetwrap.out`, 170 ms) before the owner's `onClose` runs, so a sheet leaves the way it came in; if the owner keeps the sheet open after all, it comes back. A sheet the owner removes itself (a Save button) just goes. The game-rules dialog (`RulesModal`) closes without saving the same ways (×, outside tap, Escape) except on first run, when it must be answered.
- Tapping into a number box selects its contents (one `focusin` listener in `App`), so typing replaces the old value. Give new number inputs `inputMode="numeric"` or `"decimal"` and they get it too.
- The printing on the Live play felt fades back while cards are out (`.felt.busy .feltprint`) so it never fights the hand labels.
- Sessions → Export CSV saves a file on a computer; on a phone it shares a real `.csv` file when the phone allows it, then falls back to sharing text, then to the clipboard.
- **Nothing slow may run while a page opens or on a keystroke.** The drawdown replay (`drawdownFromMix`, up to three million rounds) goes through `useDeferred(key, fn, keep)`: it waits until the page has finished animating in (about 1.1 s after it opens, so the sum never makes a chart trace stutter), debounces itself while you type, and remembers answers by key. Its results are `undefined`/`null` until ready, so the UI must cope ("…"). Use the same hook for any new heavy sum.

## Plan tab (wide screens only)

`plan` is in `NAV_ITEMS` but filtered out of the phone's bottom bar; it is reached from the sidebar and the Jump-to palette. Nick asked for these planning tools on desktop only, and for the page to be clean, sleek and easy to use while keeping every function. Everything is in `src/planner.jsx` (`PlanPage`, its own `planCss`), with settings in `bj-plan-v1` on this device only (`PLAN_DEF`: risk limit, sessions a week, hours a session, horizon, target, rest days).

**Two halves, two bases (Nick's instruction, and the page says so under the settings row):**
- **Casino scores (left side, and the Casinos list) assume every hand is played with the best bets for the current bankroll.** `spreadSetup` forces `entry: -3` and takes the risk limit from the Plan page (`prefs.risk`, 2/5/10/20%); bankroll, table min/max, rules, seats and two-hand counts come from Bet spread. `scoreGame` runs the optimizer once per game: the most profit per hour under the risk limit, or — when nothing fits — the optimizer's safest spread (lowest possible risk of ruin), flagged `infeasible`. Every casino row shows score, risk of ruin of those bets (red when over the limit) and $/hr.
- **Everything about the bankroll (right side) uses his own rules and spread from Bet spread**, passed in as `mine` (`{ ev, sd, ror, mn, bets, rph, rps, loses }`, built in `App` from the same `compute` result the Bet spread page shows): a normal month, cash to bring, risk of ruin now, the tables his spread covers, the chart and the move-up table.

Layout: a slim settings row (`Settings`: bankroll with a link to Bet spread, risk limit, sessions a week, hours a session — the only place these are set — the two-bases sentence, and "How this page works"), then two columns. Left: `PlayNext` (the next casino as a headline with score / risk / $ / bets chips, one warning when there are too few casinos for the pace, and the five visits after it — kept bare on purpose: the "most of your hours were at…" note, the "nothing is ready sooner" labels and the footers were taken out as clutter, so don't add notes back), `Rotation` ("Your casinos" and "Worth scouting"). Right: `BankrollNow` (bankroll, the table it covers, a bar to the next table, month / cash / risk), `Growth` (chart, three stats with three more behind "More stats", target; then the move-up table). A score is coloured on one smooth run from red at 0 to green at 100 (`scoreTone`, Nick's instruction — an `hsl()` hue, a little darker on the light themes); use it wherever a score is printed, Casinos list and Table score included. Other numbers stay calm: only a risk over the limit is red.

- **Scores** (`scoreFor`, `worthOf`, `yardstick`) are absolute against the risk limit, so they follow the bankroll (Nick's instructions: a casino's risk of ruin must count, and a table that would wreck the bankroll must not score well). worth = $/hr × (1 − that casino's risk of ruin) × `fit`, where `fit` is 1 inside the limit, else (bankroll ÷ bankroll those bets need at the limit)². Score = 100 × worth ÷ (worth + yardstick), and the yardstick is the usual game (`refOf`: the app's rules and table limits, every hand played) **as if played safely inside the limit — never marked down for its own risk**. (An earlier version marked the usual game down too; when it was itself too big for the bankroll, a $50 table at 65% risk scored 70.) So 50 = earns what the usual game does, safely; 67 twice that; a 65%-risk table scores under 5; and the same table climbs as the bankroll grows. If the usual game has no winning every-hand spread, 1/400 of the bankroll an hour stands in as the yardstick. Verdicts: Sit ≥ 50, Maybe 40–49, Walk below; a table over the limit is never "Sit".
- **Which game is scored** (`gamesAt`): **the games Nick saved on the casino first; only when he has saved none, the scouting report** (his instruction) — its `best` game with that game's own min/max, plus every game line the report spells out in full; a line that restates the `best` game (same decks, soft-17 rule and minimum) isn't a second game — it lends `best` its doubling and resplit limits, which the summary never carries (`reportGame` parses decks, H17/S17, limits, cut, DAS, surrender, doubling limits; side games and 6:5 are skipped). The best-scoring one for his bankroll wins. Scores are worked out a few at a time about 0.7 s after a page opens and kept in `_sc`; the Casinos list shows them on wide screens too (`CasinoRow`'s `score`).
- **Rotation**: `restOf` gives each played casino its "back" date from two editable numbers (`rest.base` 7 days, `rest.backed` 90): Medium heat / watched last visit / 3+ visits in 30 days rest 3× the base, High heat 6×, a second back-off at the same casino 2× the back-off rest (`backedN` from `linkSessions`). `schedule` lays out the next six visits: each goes to the ready casino with the most days rested × (0.75 + score / 200), which then rests again. **A casino scoring under the cut-off is never suggested** (Nick's instruction; `prefs.minScore`, 10 by default, changed under "Change the rest days and the lowest score to suggest", 0 = off): `useRotation` leaves it out of the schedule and of "ready", lists it last as "Skipped" with a grey bar, and Play next names what was left out. It applies to every score, from his saved games or a report; a casino with no score at all stays in. When every casino is under the cut-off Play next says "Nothing to suggest" and why. The plan waits (`pending`) until every score is in, so it never names a casino and then takes it back. "Your casinos" lists every one, resting ones too, with a bar that fills as it rests (full and green = ready, red = a back-off counting down; Nick asked for a plain filling bar, no dots). "Worth scouting" is the best-scored reported games within 250 miles of the middle of the casinos he plays, with each report's date.
- **Casino pop-up** (`CasinoPop`): clicking a casino anywhere on the page opens it and stays on Plan (Nick's instruction — don't navigate away, and no "Log a session" button in it): status, score and verdict, what it earns, risk of ruin (and the bankroll the table needs when over the limit), how good the game is on its own, how it fits the bankroll, a session's value and cash to bring, which game was scored and from where, the bets, his record. A link at the bottom goes to the Casinos page (`openCasinoId` + `go("casinos", { open })`).
- **Bankroll growth**: `growthModel(mine, bankroll, risk)` scales his spread to each table minimum (`TABLE_MINS`); "move up" is the bankroll those bets need at the risk limit, "drop at" is where that risk has doubled. `growthSim` deals 4,000 seeded bankroll paths (mirrored pairs) with those rules: steps of an hour or less (up to 480), with each step's lowest and highest point drawn from their exact distributions so ruin, target touches and reaching the next table between steps are counted. Two deals run through `useDeferred`, never on a keystroke: one over the chosen horizon (chart: median, a darker middle-half band inside the 10th–90th band, dashed "staying at this table" — the band is wide because moving up scales the swings, and a separate walk confirms it; the stats; the target, answered afterwards from stored path maxima by `goalStats`), and a much longer one (`far`, three times the expected wait for the furthest table shown) for "getting there" — the date by which half the paths have reached each table and the share that ever do — and the "typically" date on the bar.
- **Dates** are whole local days: `dayOf` is local midnight, `addDays` adds calendar days and `daysBetween` counts them, so a clock change never shifts a "back" date and a casino is ready from the start of its back day.
- **Cash to bring** (`cashFor`) is `sessionCash` at 5% times the app's shoe-clustering factor (`tailFix`), the same sum as Bet spread's "bring with you".
- **Checked by `tools/checks/plan-test.jsx`** (run by `tools/checks/run.sh`, about 930 checks): every optimizer result re-priced by `compute`, no simple ramp beating it, table bankrolls hitting exactly the risk limit (and twice it at "drop at") for optimizer spreads and for a hand-made one, the simulation against closed forms (ruin, target, median, percentiles, long-run ruin = the risk-of-ruin formula, share reaching the next table) and a separate random walk, the whole move-up / drop-back ladder against a separate walk in 3-minute steps (every "Where it's heading" stat and the shares reaching each table), session cash, rotation dates across clock changes, the schedule, and the report reader. Run it after touching `planner.jsx`. **Risk of ruin against real cards**: `tools/checks/ruin.sh` (slow, about 15 minutes, not part of `run.sh`) deals real blackjack with the bets the page scores, from the same bankroll, thousands of times, and prints the share that went broke beside the page's figure, after dealing 30 million rounds a game to compare $/hr and swing (six games on 16 Nov 2026: every $/hr inside its sampling error, every swing within $2); five games on 16 Nov 2026 (28,000 bankrolls, about 950 million rounds) all landed within sampling error, 1.3 points at most, of the formula.
- Sessions → tapping a session opens its sheet with `SessionLuck` on top (wide screens): that one session's percentile against what its saved spread expected over its hours (`LuckGauge`).

## Sound

The table sounds are **real recordings**: a card dealt, a chip bet and the shuffle come from Kenney's "Casino Audio" pack (CC0 — `tools/sounds/kenney/License.txt`). Nick rejected two rounds of synthesized card and chip sounds as fake, harsh and too many, so don't go back to synthesizing them.

- `tools/sounds/kenney/` holds the chosen `.ogg` files; `tools/sounds/build-sounds.py` (needs numpy and an ffmpeg with the `rubberband` filter) prepares each one and writes `src/sound-data.js` — **generated, don't edit by hand** — as small MP3 clips in base64 (about 45 KB), so the app stays one offline page. To use different recordings, edit `CLIPS` in that script, run it, then `./build.sh`. The rest of the pack (card fans, shoves, chip handling, dice) is not in the repo; ask Nick for the zip again or get it from kenney.nl.
- **Never trim a recording short to make it fit — speed it up at the same pitch instead** (Nick's instruction, after hearing clips cut down to just the snap). The quiet slide before a card lands is most of what makes it sound like a deal, so the script keeps the whole sound and only cuts real silence from the ends; a clip that is too long for the pace gets a `tempo` in `CLIPS` (cards 1.3–1.5, the full seven-stroke shuffle 1.55 so it fits the "Shuffling" pause). Each stretch is tried three ways (ffmpeg `atempo` and two `rubberband` settings) and the one that changes the recording's tone and snap least is kept. Card clips come out 170–260 ms, longer than the gap between dealt cards, so a deal overlaps into one run instead of separate clicks.
- `src/sound.js` decodes the clips on the first tap and plays them (skipping only the dead silence an MP3 decoder leaves at the front — not the slide). `sfx(name, delayMs)`: `card` (one of five slides, never the same twice running), `chip` (one of four), `shuffle`. Recordings play dry at the levels in `TRIM`; cards are the most frequent so they sit lowest.
- **Keep it sparse** (Nick: "too many sounds"). The default set is those three. The answer and result notes — `right`, `wrong`, `win`, `blackjack`, `lose`, `pass`, soft synthesized wooden notes — are the `feedback` group, **off by default** and opt-in from Settings. No sounds on ordinary taps, tabs or sheets.
- **Cards:** `PlayingCard` plays `card` when it mounts, timed to its own deal delay, so anything that deals a card is heard without extra code; a face-down card is a plain div, so put `<Flick d={ms} />` beside it. Cards that land together are spaced 90 ms apart inside `sfx`.
- **Notes (when switched on):** `logResult` is the one place every drill and test answer passes through, and it plays `right` or `wrong` (pass `quiet` as the fourth argument when one answer logs twice, as the count drill does). Live play is skipped there: it plays `wrong` when a mistake is flagged and `win` / `blackjack` / `lose` once the round is settled. Passing a test plays `pass`. Live play also plays `chip` on a bet and `shuffle` on a new shoe (table group).
- **The settings** (`soundPrefs()` / `setSoundPrefs(patch)`): on/off, volume, `table` and `feedback`; each sound's group is in `GROUP`. Saved on this device only under `bj-sound-v1` (not in `BACKUP_KEYS`); the stored setting carries `v`, and one saved before `v: 2` has the notes switched off once. The full set is the Sound card in Settings (`SoundCard`); the Live play table settings carry just the on/off switch (`SoundToggle`). Both stay in step through the `bj-sound` event, and changing a setting plays a sample.
- Nothing plays before the first tap or key press (browsers require it), while the page is hidden, or with the switch off; a phone's silent switch mutes it too.
- To check a change without ears: bundle `src/sound.js` alone, swap `AudioContext` for an `OfflineAudioContext`, `await soundReady()`, render, and read the peak level (cards about 0.25, chips and shuffle about 0.35). That checks levels, not whether it sounds good — only Nick's ears can, so send him a rendered preview after changing a sound.

## Live play

Settings open as a sheet from the gear on the table header (`setupOpen` in `Play`) and persist to `PLAY_KEY` (`_playPrefs`): hand totals, running count, auto-deal the next hand (skips the Next tap, the bet is still the user's), count check every 3/5/10/20 hands or off, dealing speed (a 5-stop slider, `DEAL_SPEEDS`), and New session. `speed` multiplies every deal timing through `ms()`; the opening deal staggers through `HandView`'s `stagger` / `base` / `dur` props so cards land one at a time.

Page order: the table card (felt, then the bankroll/net strip, then the controls), `SpreadMini`, `ShoePanel` (wide screens only), the record card, the percentile card, mistakes. `SpreadMini` is the ramp; the current true count is lit and named only while "Show the running count" is on — with the count hidden it is a plain reference so it can't give the count away. `ShoePanel` is the shoe at a glance: a penetration bar with a tick per deck and the cut card in red, cards seen and cards left, and — only while the count is showing, for the same reason — the true count's path through this shoe. Its line comes from `trace` in `Play`, one sample per ~1% of the shoe, emptied when a new shoe starts; the vertical scale grows to fit the shoe's own peak. The record card holds a `scope` switch (this session / all time), the stat row and the money chart; the percentile is built from `evHour`/`sdHour`/`rph`. Both charts show on phones too. On wide screens the table is the left column and everything after it the right.

All-time hands, money, clean rate, count checks and a per-hand money list live in `PLAYALL_KEY`, which is in `BACKUP_KEYS` so it syncs: the counter names are in `SYNC_COUNTERS` so two devices' totals add up, and the money list is `{id, n}` per hand so their hands merge; `syncTidy` sorts and thins it (`thinPts` adds neighbouring hands together past 600 points). It saves every tenth hand and on pagehide/visibilitychange, never once per hand, and reloads itself on `bj-sync-applied`. Wipe it from Settings → Reset skill results.

Keyboard shortcuts for the table are changeable in that same sheet, on a computer only (`.kbdonly`, same media rule as `.kbdhint`): `KeyBinder` edits `keys` (defaults in `PLAY_KEYS_DEF`, saved with the other prefs in `PLAY_KEY`). Keys live at the same moment must differ (`PLAY_KEY_GROUPS`), so taking another action's key swaps the two. Enter and Space always deal the next hand. The key hints under the table read from `keys`, and the table ignores keys while the settings sheet is open.

## Count plays that go by the running count (0+ and 0−)

The app rounds true counts toward zero, so a true count of 0 covers running counts on both sides of zero. The plays the BJA charts print as "0+" (16 vs 10) and "0−" (12 vs 4, 15 vs 10 with surrender, and A,8 vs 6 in H17), plus A,7 vs 2 in H17 (0−, measured by the app's simulator — the BJA chart prints no index for it), turn on the **sign of the running count** instead: 0+ makes the play on any positive running count, 0− drops the basic play on any negative one, and a running count of exactly zero is basic strategy. They carry `edge: "+"` or `"-"` in `DEV_TABLE`; `devOver(d, tc, rc)` is the one place that decides whether a deviation's "above" play applies — use it, never `tc >= d.idx`. `correctPlay` takes the running count as `opts.rc` (Live play passes the shoe's); without it a true count of 0 is read as a running count of 0. `idxLabel(d)` prints "0+" / "0−", and drills show the running count's sign beside a true count of 0 (`devDrillCount`, `rcs`). 13 vs 2 (−1 on the chart: hit at −1 and below) is an ordinary index, stored as 0 and shown as −1 (see `chartIdx` below).

## Deviations on or off

Game rules → Advanced → **Deviations** (`rules.devs`, on unless it is exactly `false`; read it through `devsOn(R)`, since
rules saved before the switch existed have no such field). Off means basic strategy on every hand: no count plays and
no insurance.

- **Calculator:** `calFor(R, seats)` is the one door. With deviations off it builds the no-insurance table (`calBase`,
  the old `calFor` body) and takes every count play off through `coverCal(…, { skip_all_deviations: true })` from
  `src/cover.js`, then marks the result `basicOnly`. Checked against six games played out with basic strategy only
  (300 million rounds each): within about 2%. `coverCal` ignores deviation and insurance cover for rules that already
  have deviations off, so they can't be taken off twice.
- **Play:** `correctPlay` skips the count plays unless `opts.devs` is passed. Live play grades on basic strategy and never wants insurance. `src/sim.js` deals the same way.
- **Left alone on purpose:** the deviation list, drills and tests in Train stay available so they can still be practised.
- The setting travels with the rules: it is in each session's saved game (the session editor has the same switch), in
  `rulesLabel`, and at the end of the rules pill as "no dev". The pill now shortens with "…" instead of running under
  the page title (`.rulespill .mono`), which also fixed long rule sets on small phones.

## Where the calculator's numbers come from

`CALR` / `CALQ` / `CALD` / `CALX` at the top of `src/app.jsx` are measured tables, packed by `tools/sim/build_cal.py` from
the simulator in `tools/sim/table_sim.c` (64 billion rounds in all; the README there lists what each part is and how to
re-run it). Don't edit those lines by hand. Three things must say the same thing whenever a play or an index changes:
`DEV_TABLE` in `src/app.jsx`, `DEV_DEFS` in `src/sim.js`, and `defs[]` in `tools/sim/table_sim.c` (same order — the
position is the play's id in the cover data). `CAL_ROUNDS` and the Settings paragraph state the round counts; keep them
true if tables are re-run.

The simulator's `audit` mode checked every basic strategy cell and every count play in all 20 games (5 deck counts ×
H17/S17 × surrender). With 4, 6 and 8 decks every cell and index holds. **How negative chart numbers are stored and shown.** A play's index in `DEV_TABLE` (`s17` / `h17`) is always the lowest
true count at which its "above" play is made. The BJA chart prints the plays where basic strategy is already the above
play the other way round — "−1" on 13 vs 2, on surrender 16 vs 9 and on surrender 15 vs A (H17) means *hit at −1 and
below* — so those are stored as 0 and **shown as −1**: `devLow(d)` marks them, `chartIdx(d)` is the number the chart
prints (one below the stored index) and `idxLabel`, the deviation list, the fill-in test, the drill explanations and the
cover catalog all show that number. `devPlay(d)` is the count play itself (the one that
isn't basic strategy). Never show a raw stored index to the user. Surrender 16 vs 9 and 15 vs A (H17) used to be stored
as −1 (hitting only from −2); the check measured surrendering 16 vs 9 at −1 as about 1% of the bet worse than hitting,
and Nick confirmed the chart. The shipped tables and cover-play costs were dealt with the old indices; the difference
is under 0.005% of a bet at a true count of −1, far inside their noise, so they were not re-run. With 1 and 2 decks several plays differ from the shoe
charts (doubling 9 vs 2, splitting 6s vs 7 and so on) — expected, BJA's charts are for shoes, and the app deliberately
uses one chart for every deck count. Soft 18 vs 2 in H17 ("0−": stand on a negative running count) came from that
check; the BJA chart has no index there.

## Sessions

The Luck check card's **Long run** bar measures N₀ from the log itself, not from the spread currently set in the app:
`sessionStats` returns `expHour` and `modelSd` (each session's own snapshot edge and swing, weighted by its hours),
and N₀ in hours is `(modelSd / expHour)²`. It follows the page's period and casino filters, like every other figure on
the card. With nothing logged, or when the logged average has no edge, it falls back to the current spread's `n0` and
the caption says which one it used.

## Checking the arithmetic

`tools/checks/run.sh` builds the app with a few internal functions exported and runs `tools/checks/math-test.jsx` in Node, then `tools/checks/plan-test.jsx` for the Plan tab (see "Plan tab"). The first covers: payouts (`settle`), hand values, the normal curve (`PhiN`), the chance of a dip (`pDip`, against a brute-force random walk), the calculator's formulas (EV, swing, risk of ruin against a simulated walk, N0, session bankroll) across deck counts and table sizes, and about 70 basic-strategy and count-play spot checks against the published charts. It prints "all N checks passed" or each failure; run it after touching any of those. It does not re-measure the edge tables — that is the simulator's job (above). Two things it found that are by design, not bugs: heads-up with a $0 bet at the starting count never plays a hand (nobody else moves the count), and 12 v 5, 12 v 6 and 13 v 3 have no count play because BJA's chart leaves them out.

## Casinos page

A tab of its own (`casinos`): a built-in, offline map of casinos with Nick's own scouting notes. It lives in its own files so work on it doesn't collide with `app.jsx`:

- `src/casinos.jsx` — the page (`CasinosPage`), the map component (`CasinoMap`), the sheets, and its own CSS (`casCss`, rendered in a `<style>` by the page; new motion goes in its `prefers-reduced-motion` rule). It imports shared controls from `app.jsx` (the `export { … }` line at the very end of `app.jsx`) and `app.jsx` imports the page back, so **nothing from `app.jsx` may be used while `casinos.jsx` loads — only inside components.**
- `src/casino-map.js` — plain maths, no React: unpacks the TopoJSON outlines, projects them (`albersUsa` for the US with Alaska and Hawaii inset, `azimuthal` for everything else), fits a box to the view, finds the state under a point.
- `src/casino-data.js` — **generated, never edit by hand.** Outlines for the US states, Canadian provinces and every country (Natural Earth), the built-in casino list (`CASINO_ROWS`: id | name | town | state | lat | lon) and the scouting reports (`CASINO_INTEL`). All are strings, parsed the first time the page opens.
- `tools/casinos/` — `casinos.src.txt` (the list, one casino per line, only places with live blackjack), `intel.json` (sourced scouting reports keyed by casino id: `asOf`, `tablesN`, `tables`, `games[]`, `best{}` (the best game a source describes), `min`, `pen`, `hl`, `heat`, `other`, `note`, `src[[label, url]]` — every fact dated and sourced, nothing guessed), `research-brief.md` (the brief the research agents worked from, the exact report shape, and what is still unresearched), `build-data.mjs` (writes `src/casino-data.js`; needs `npm i --no-save mapshaper all-the-cities` first; checks every casino against its town and state outline and stops on anything suspicious) and `check-map.mjs` (checks the maths and the data, writes preview maps). After changing the list or the reports: run `build-data.mjs`, then `check-map.mjs`, then `./build.sh`.
- **No research older than 7 years** (Nick's instruction): `tools/casinos/prune-old.mjs` removes it from `intel.json` — a claim is judged by the newest date it cites, a field whose dated claims are all old goes whole, old entries leave a bracketed source list, numbers only old text supported (`best`, `min`, `tablesN`) go with it, and a report with nothing left is removed. Run it (then the three steps above) when adding research, and don't add sources older than that.
- **Casino ids never change once shipped** (`us-oh-jack-cleveland-casino`): Nick's marks are stored against them. To rename a casino, change its name in `casinos.src.txt` and pin the old id as a fourth field on the line (`City|New name|lat,lon|old-id`).

How it works: the country button picks a country (US and Canada have lists and states/provinces; any other country shows its outline and takes casinos you add). At the full view a tap on a state zooms to it and filters the list; once zoomed, a tap opens the casino under it, a crowd of pins zooms in instead, and a few overlapping pins open a short chooser. Taps are handled on `click`, not pointer-up, so the sheet a tap opens isn't closed by the same tap. One finger scrolls the page at the full view and pans once zoomed (`touch-action` switches); pinch, the buttons, Ctrl/trackpad-pinch wheel and + − 0 arrows zoom and move. Pins on a simplified outline are nudged just inside their own state at build time so none shows across a border.

Data: `bj-casinos-v1` (in `BACKUP_KEYS`, so it syncs) holds `{ marks: [...] }` — one record per casino Nick has touched (`status` been/backed, `backedOn`, `heat` 1–3, `games[]` each with the app's rule shape plus `label`/`min`/`max`/`tables`/`note`, `notes`, `aka[]`, `hidden`) and his own casinos (`custom: true` with `name`, `city`, `cc`, `st`, `lat`, `lon`). Every list item has an `id` so the sync merges them one by one. The casino sheet saves on close. Sessions are matched to casinos by name (`linkSessions`: an explicit `aka` link, then an exact name, then a name whose words fit exactly one casino); a session with heat "Backed off" marks its casino backed off on the map. Unmatched names are listed under "From your sessions" to be matched by hand. "Log a session" on a casino opens the Sessions sheet with that name (`go("sessions", { log: true, where })`), and "Practice this game in the app" sets the app's rules to that table.

Scouting reports show at the top of a casino's sheet: three quick facts (tables, lowest 3:2 minimum, best game), then "Read the full report". "Add the reported game to mine" copies `best` into Nick's own games (a rule the report doesn't mention is taken as not offered). The "Reports" chip filters the map and list to casinos that have one, and list rows show the table count and minimum.

**Played, no game saved** (wide screens only, above Table score): every casino marked been or backed off, or matched to a logged session, that has no game of Nick's saved and isn't hidden — most sessions first. Tapping one opens its sheet to add the game. It disappears once all have a game.

**Table score** (`TableScoreCard` in `src/planner.jsx`, below the list, wide screens only): a table's rules, players, min and max → `scoreGame`, scored exactly as on the Plan tab (every hand played, the Plan page's risk limit; see "Scores" there). Games saved on casinos can be loaded from its picker.

Not built yet: reports shared between people using the app (needs an online home and a decision about what is public).

## Card sizes

Playing cards are drawn at fixed pixel sizes (`.pc`, `.pc.sm`, `.pc.big`) and scaled with CSS `zoom: var(--cz)`. Each felt sets `--cz` through a class (`cz-play` live play, `cz-train` strategy table / pairs / hand totals, `cz-big` single-card drills and tests, `cz-rounds` + `rd-seats` table rounds), with larger values at 640px and 1024px. To change how big cards are, change those values in the `css` string; don't edit the card artwork sizes. Anything sized to hold cards uses `calc(Npx * var(--cz, 1))`. Hands use `.hand > .slot` so cards sit side by side when they fit and tuck under each other when they don't.

## Themes

`THEME_LIST` in `src/app.jsx` (Emerald, Dark blue, Classic gold, Amethyst, Copper, Graphite, White & blue, Kiera); each is one block of colour variables on `:root[data-theme=…]`. **Kiera** (pink with a green felt, from a palette Nick sent) is a light theme: `applyTheme` sets `data-theme="light"` so every light-theme layout rule applies, plus `data-skin="kiera"`, whose block repaints the colours. Add another light theme the same way; a rule that must beat a later light-theme rule needs both attributes in its selector.

## Liquid glass (after iOS 26)

Nick asked for an Apple-style liquid glass look, then for it to go further, "like iOS 26". It is one block at the end of the `css` string in `src/app.jsx` ("Liquid glass, after iOS 26"), driven by four variables: `--gl-edge` (the specular rim: a gradient brightest at the top-left and bottom-right corners), `--gl-hi` (the bright top edge on small controls), `--gl-rim` and `--gl-sheen` (a soft sheen from the top-left corner); the blur itself is written out where it is used. Light themes re-point them.

- **The tab bar is a floating capsule** (`.bottom-nav > div`): `.bottom-nav` itself is now only the fade the page disappears into, with `pointer-events: none`, so taps beside the capsule reach the page. The selected tab is a capsule over the whole button (`.navbtn.on`), not a lozenge round the icon. Checked at 320, 390 and tablet widths; below 350px the side padding tightens.
- **The top bar has no bottom line**: it is blurred glass that fades out through a `mask-image` over its last 18px (it has 22px of bottom padding for that).
- **Sheets float on a phone** (below 1024px): inset 8px from the screen edges, round all the way round; the wrapper's bottom padding stands in for the safe area, so the sheet's own content padding is cut to 22px there.
- **Sheets, the game-rules dialog and the Jump-to palette are the clearest glass in the app** (Nick twice sent a pop-up that "doesn't have it": a thin dark fill over a dark scrim reads as a solid box). So the scrim is light (`--scrim` .4 in the dark themes), the fill is thin (`color-mix` of the sheet colours at 58–72% with a light tint on top), the backdrop is blurred, saturated and brightened a little, and each has the rim. None of the three scrolls itself: `Sheet` is a flex column whose `.sheetbody` scrolls under a title that stays put, and the rules dialog has the same inner box. Keep it that way — a panel that scrolls takes its rim with it. Close buttons are `.xbtn`.
- **The rim** is a `::before` with a 1px padding and a mask (`.card:not(.rulesdlg)::before`, the tab capsule, the palette), which is why `.card` is `position: relative` through `:where()` (zero specificity, so a Tailwind position class still wins) and its own border is transparent in the dark themes. Don't put the rim on anything that scrolls its own content — the ring would scroll with it. And don't use `.card::before` or `.card::after` for anything else (`::after` is the pointer light).
- **Real blur only on what floats over the page**: tab capsule, top bar, sidebar, the floating rules pill, sheets, the Jump-to palette and the sync toast. Cards get the rim and the sheen but no `backdrop-filter` — nothing sits behind them, and dozens of blurred layers make a phone scroll badly. Don't add blur to cards or list rows.
- **Shapes**: cards are 22px round (16px when nested), `.btn` and the sliding segmented control (`.chipseg.slide`) are capsules. A `.chipseg` that can wrap to several rows keeps its 12px corners.
- Sheets and the palette are see-through through `color-mix()` inside an `@supports` rule, so older browsers keep the solid sheet. `prefers-reduced-transparency` turns the chrome solid again.
- Pills, round buttons and ghost buttons share one capsule: a top-to-bottom tint with the `--gl-hi` edge. Give a new small control the same two declarations rather than a flat fill (`.pchip` on the Plan page does).
- Shadows in the light rules use `rgba(var(--fg),…)` so Kiera and any later light theme tint them their own colour.
- **One selection look on phone and desktop**: the sidebar's sliding highlight (`.sn-glide`), the tab bar's (`.navglide`, placed from `--i` / `--n`), a segment's thumb and a selected filter chip (`.gchip.on` — `ChipRow`, the hour and casino picks in the session sheet) are all the same accent-tinted glass capsule; in the light themes the segment and the chip are the solid accent pill. The old white selected chip and the sidebar's left accent bar are gone. Use `.gchip` for any new chip instead of inline colours.
- **Switches, sliders and wells**: a switch's knob and a slider's handle are the same light bead of glass (a capsule a little wider than tall, bright top, soft shadow); the switch track, `.in` text boxes and segmented tracks are cut into the surface (a shadow along the top inside, a hairline of light along the bottom).
- A single-row `.chipseg` is a capsule; `Seg` adds `.rows` when its options wrap, and `.rows` and `.brushes` keep 12px corners. Inputs (`.in`) are 14px round; a desktop dialog is 30px, the palette 24px, the map's zoom buttons are round glass.
- **Fluid motion, kept quiet** (Nick: very subtle, then smoother and more fluid, three times): nothing bounces. Two curves: `--fluid`, a long ease-out, for things that arrive or settle (presses, sheets, the top bar), and `--ez`, an **easy ease** (eases out of where it was, quickest in the middle, eases into where it is going — the After Effects sense), for a selection changing place. **Switching tab is quick and on the easy ease** (Nick's instruction): the tab bar's glass takes 0.34 s, a segment's thumb 0.3 s, the sidebar highlight 0.36 s, and the page that comes in 0.36 s with a 30 ms stagger. `Glider` (the tab bar's `.navglide` and a segment's `.thumb`): CSS slides it with the `translate` property, and `Glider` adds a brief stretch about its middle with the `scale` property through the Web Animations API, timed to the slide (its `ms` prop) and peaking halfway, where it is moving fastest (a longer jump stretches a little more, capped at 14%; a second tap mid-move restarts it from the size it has). Both run on the compositor (no layout or repaint), which is what keeps it smooth — don't go back to animating `left` / `right` / `width`. Browsers without `translate` fall back to a plain `transform` slide.
- **The tab icons stay still.** Nick saw them glitch when switching: they shrank and popped back (`navpop`) and the line got thicker on the selected one. Now the icon keeps one line weight selected or not (sidebar too), has no animation, only its colour eases, and each tab sits on its own layer for good (`will-change`) so nothing is re-drawn when the slide starts or stops. Don't animate or re-weight them again.
- **One smoothing pass covers everything else** (the block under "every other movement in the app"): presses on every kind of button dip slightly and ease back on `--fluid`; hovers, focus rings and colour changes take .3s on `--ease`; the top bar, page sections, `Info` text, sheets (phone and desktop), the palette, the sync toast, the rules pill's glide, bet bars, the tab underline and the shoe nudge all use `--fluid`; a switch's knob slides on it. On a computer a soft light drifts after the pointer across the card it is over (`.card::after`, fed `--mx` / `--my` by one `pointermove` listener in `App` that eases a fifth of the way each frame and stops when it has caught up). The sheet's exit stays at 170 ms because `Sheet` unmounts on a 170 ms timer. Chart entrances keep their own kit (`--trace`). All of it is in the `prefers-reduced-motion` rule (`Glider` checks `noMotion()`). Don't add overshoot, a bare `ease`, looping or idle animation.
- **Things that bit**: a backtick inside the `css` template string ends it (the build fails) — no backticks in CSS comments. `backdrop-filter` values are written out, not `var(--…)`, because older Safari ignores a variable in `-webkit-backdrop-filter`. A glass panel inside a wrapper that has its own `backdrop-filter` only sees that wrapper (Chrome), so scrims carry no blur (`.cmdk-wrap`, `.rulesscrim`, `.sheetwrap`). The rim's mask is the two-longhand form (`-webkit-mask-composite: xor` and `mask-composite: exclude`). This look could only be checked in Chromium here, not in Safari.
- Tune the variables, not individual elements.

## The table felt

`.felt` is the green table surface used by live play, the strategy table and the drills. `FeltPrint` draws the printing on it (payout and dealer rule, read from the app's rules through `RulesCtx`) behind the cards; it is used on live play and the strategy table only. In the light theme the felt is deep blue and `:root[data-theme="light"] .felt` re-points the text and accent variables to light-on-dark, so anything placed inside a felt should use the theme variables rather than fixed colors. Outside a felt, use `var(--recess)` for sunken boxes (not `rgba(var(--sh),…)`, which is white in the light theme) and `rgba(var(--fg),…)` for faint tracks and tints. The sidebar logo (`.sn-tile`) is the app icon's spade and chip in theme colors.

## Splash screen and icons

The splash lives in `src/app.jsx` (`Splash`, `SPLASH_LAYERS`, and the `.splash` / `.sp-*` CSS); the icon links are in `src/head.html`. Details of the current design, for reference:

Design: flat spade + "21" chip. On the splash the logo takes its colors from the active theme (`--b1/--b2/--b3` tile, `--ivory` spade, `--brass` chip, `--ink` digits). The tile eases in, the spade rises, the chip rolls in from the right and settles upright. The old stroke trace, shine and ring pulse were removed on purpose.

### 1. CSS — replaces the old block from `.splash.go{animation:splashout…` up to `@keyframes spfade`

```css
.splash.go{animation:splashout .45s cubic-bezier(.4,0,.2,1) 1.5s forwards}
.splash>*{will-change:transform,opacity}
.sp-l{position:absolute;inset:0;width:100%;height:100%;display:block}
.sp-chip{transform-origin:66.02% 67.58%}
.splash.go .sp-tile{animation:sptile .6s cubic-bezier(.16,1,.3,1) both}
.splash.go .sp-spade{animation:spspade .6s cubic-bezier(.16,1,.3,1) .12s both}
.splash.go .sp-chip{animation:spchip .85s cubic-bezier(.22,.8,.24,1) .32s both}
.splash.go .sp-word{animation:rise .5s var(--ease) .5s both}
.splash.go .sp-tag{animation:rise .5s var(--ease) .62s both}
@keyframes sptile{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}
@keyframes spspade{from{opacity:0;transform:translateY(7%)}to{opacity:1;transform:none}}
@keyframes spchip{0%{opacity:0;transform:translateX(78%) rotate(285deg)}12%{opacity:1}100%{opacity:1;transform:none}}
```

The `prefers-reduced-motion` rules and `@keyframes spfade`, `splashout`, `rise` are unchanged.

### 2. Markup — inside `.sp-tile`

The two old `<svg>` elements (`sp-spade`, `sp-chip`) and the `sp-shine` span are replaced by one element inside the existing clipped container:

```jsx
<div className="sp-l" dangerouslySetInnerHTML={{ __html: SPLASH_LAYERS }} />
```

where `SPLASH_LAYERS` is exactly this string (three stacked 512×512 SVG layers: background, spade, chip):

```html
<svg class="sp-l" viewBox="0 0 512 512" aria-hidden="true"><defs><radialGradient id="sbg" gradientUnits="userSpaceOnUse" cx="256" cy="120" r="460"><stop offset="0" style="stop-color:var(--b1)"/><stop offset=".5" style="stop-color:var(--b2)"/><stop offset="1" style="stop-color:var(--b3)"/></radialGradient></defs><rect width="512" height="512" fill="url(#sbg)"/></svg><svg class="sp-l sp-spade" viewBox="0 0 512 512" aria-hidden="true"><path d="M240 92C206 136 108 204 108 288C108 332 140 362 178 362C204 362 224 350 234 332C232 368 216 396 190 414H290C264 396 248 368 246 332C256 350 276 362 302 362C340 362 372 332 372 288C372 204 274 136 240 92Z" style="fill:var(--ivory)"/></svg><svg class="sp-l sp-chip" viewBox="0 0 512 512" aria-hidden="true"><circle cx="338" cy="346" r="94" fill="url(#sbg)"/><circle cx="338" cy="346" r="80" style="fill:var(--brass)"/><circle cx="338" cy="346" r="67" fill="none" style="stroke:var(--ink)" stroke-opacity=".45" stroke-width="4"/><g transform="translate(295.17 375.06) scale(0.039 -0.039)" style="fill:var(--ink)"><path d="M124 0V220L652 715Q720 781 766.5 834.5Q813 888 837.5 939.5Q862 991 862 1051Q862 1118 832.0 1166.0Q802 1214 750.0 1240.0Q698 1266 631 1266Q562 1266 510.0 1238.0Q458 1210 430.0 1158.0Q402 1106 402 1033H110Q110 1178 176.5 1285.5Q243 1393 361.0 1451.5Q479 1510 633 1510Q791 1510 909.0 1453.5Q1027 1397 1092.5 1298.0Q1158 1199 1158 1070Q1158 987 1125.5 906.0Q1093 825 1009.5 724.5Q926 624 773 484L548 262V251H1178V0Z"/><path transform="translate(1235 0)" d="M749 1490V0H444V1221H434L93 979V1259L422 1490Z"/></g></svg>
```

Tile styles: `background: "var(--b2)"`, `boxShadow: "0 0 0 6px rgba(var(--acc),.07), 0 0 70px -14px rgba(var(--acc),.3), 0 30px 60px -24px rgba(0,0,0,.55)"`; the ring overlay uses `rgba(var(--acc),.4)`. Width/height 132, radius 32 are unchanged.

### 3. Timing

The splash is removed 2050 ms after it starts (was 1950).

### 4. `<head>`

```html
<meta name="theme-color" content="#07090A">
<link rel="apple-touch-icon" href="apple-touch-icon.png?v=3">
<link rel="icon" type="image/svg+xml" href="icon.svg?v=3">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png?v=3">
```

### 5. Icon files (default emerald theme; `icon.svg` is the master artwork)

`icon.svg`, `icon-192.png`, `icon-512.png` (rounded, purpose `any`), `icon-maskable-512.png` (full bleed, padded), `apple-touch-icon.png` (180, full bleed), `icon.png` (192, kept for old links). `manifest.json` lists the 192/512/maskable icons with `background_color` and `theme_color` `#07090A`. `sw.js` precaches the new icon URLs.
