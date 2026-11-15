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
- `src/input.css` — Tailwind entry
- `build.sh` — `npm ci` once, then `./build.sh` writes `index.html` (scratch files go to `.build/`, ignored)

Commit the source change and the rebuilt `index.html` together. `build.sh` never touches the icons, `manifest.json` or `sw.js`.

## Navigation and motion

- Phone: bottom tab bar; desktop (1024px+): sidebar. Train has Strategy / Drills tabs. On Train and Live play the table comes first and stats sit below it.
- The compact top bar (`TopBar`) appears on scroll and shows only the page title and rules pill. Section chips in it were tried and removed at Nick's request (he wants the app kept clean) — don't add extra navigation rows. The "Ramp ↓ · Your numbers ↓ …" jump pills at the top of Bet spread were removed for the same reason.
- Desktop layout (1180px+): every page is up to 1120px wide and uses two columns through `.dgrid` / `.dcol` wrappers, which are `display: contents` below that width — so the phone order is simply the source order. `.dgrid.wl` is a wide-left split (table or main content left, stats and reference right); `.narrow` and `.segw` keep single cards and switches from stretching. `.deskonly` / `.notdesk` show or hide an element on wide screens.
- Jump-to palette (`CommandPalette`, opened with ⌘K / Ctrl K, `/`, or the sidebar button): lists every page, drill and action — no theme rows (Nick removed those). When adding a page or drill, add it to `cmdItems` in `App`.
- `go(tab, options)` also fires a `bj-nav` event when the target page is already open; pages read it with `useNav` (train mode/view, drill, log sheet).
- `Seg` (segmented control) has a pill that slides to the selected option when its options sit in one row.
- Keep motion small and purposeful, and add anything new to the `prefers-reduced-motion` rule.

## Live play

Settings live in the card at the end of the page and persist to `PLAY_KEY` (`_playPrefs`): hand totals, running count, auto-deal the next hand (skips the Next tap, the bet is still the user's), count check every 3/5/10/20 hands or off, and dealing speed. `speed` multiplies every deal timing through `ms()`; the opening deal staggers through `HandView`'s `stagger` / `base` / `dur` props so cards land one at a time. Dealing speed is a 5-stop slider (`DEAL_SPEEDS`). All-time hands, money, clean rate, count checks and a per-hand running total live in `PLAYALL_KEY` on this device only (not in `BACKUP_KEYS`, so a write every hand never hits sync; wipe it from Settings → Reset skill results). Bankroll and net live inside the table card, under the hand. Below it the right column runs: `SpreadMini`, the record card (a `scope` switch for this session or all time, the stat row, and the money chart on wide screens), the percentile card, mistakes, settings. The right column carries `SpreadMini` (the ramp with the live true count lit) and, on wide screens only, the running-percentile card built from `evHour`/`sdHour`/`rph`. Source order puts the bankroll/net card before `SpreadMini` (the phone order Nick asked for); `.dcol.pcol` turns that column into a flex column on wide screens so `.spreadmini` can take `order:-1` and sit above the stats there.

## Card sizes

Playing cards are drawn at fixed pixel sizes (`.pc`, `.pc.sm`, `.pc.big`) and scaled with CSS `zoom: var(--cz)`. Each felt sets `--cz` through a class (`cz-play` live play, `cz-train` strategy table / pairs / hand totals, `cz-big` single-card drills and tests, `cz-rounds` + `rd-seats` table rounds), with larger values at 640px and 1024px. To change how big cards are, change those values in the `css` string; don't edit the card artwork sizes. Anything sized to hold cards uses `calc(Npx * var(--cz, 1))`. Hands use `.hand > .slot` so cards sit side by side when they fit and tuck under each other when they don't.

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
