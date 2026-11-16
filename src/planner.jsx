// Desktop-only planning tools:
//  - TableScoreCard (Casinos page): score a table's rules against your bankroll and spread settings.
//  - useCasinoScores: each casino's best table score, worked out a few at a time (Casinos list and the Plan page).
//  - PlanPage (the Plan tab): the casino rotation and the bankroll growth plan.
// Like casinos.jsx, nothing from app.jsx may be used while this file loads — only inside functions.
import { useState, useEffect, useMemo } from "react";
import { Seg, Info, rulesShort, money, shortMoney, sgnMoney, fmtTC, pct, COUNTS, calFor, autoRph, roundFreqs, optimizeSpread, DEFAULT_RULES } from "./app.jsx";
import { loadCasinoAll, openCasinoId } from "./casinos.jsx";
import { loadSetup } from "./aitools.js";

// ---------- table score ----------
// The spread settings come from Bet spread (bankroll, risk-of-ruin cap, where you start betting, sit out or bet the
// minimum below it). The optimizer finds the most profit per hour this table allows under that risk cap. 50 means as good
// as the game the app is set to (your saved rules, min and max); 100 is twice as good.
async function spreadSetup() {
  const base = await loadSetup();
  let rorPct = 10; try { const r = await window.storage.get("bj-spread-v1", false); const d = r && r.value ? JSON.parse(r.value) : {}; if (d.rorPct > 0) rorPct = d.rorPct; } catch (_) {}
  return { ...base, rorPct };
}
export function scoreGame(setup, g) {
  const R = { ...DEFAULT_RULES, ...(g.rules || {}) }, seats = g.seats || setup.seats || 4, cal = calFor(R, seats);
  const mn = +g.min > 0 ? +g.min : setup.minBet, mx = Math.max(mn, +g.max > 0 ? +g.max : setup.maxBet);
  const { entry, belowMode, spotsMap } = setup;
  const b0 = {}; COUNTS.forEach((c) => (b0[c] = c >= entry ? mn : belowMode === "out" ? 0 : mn));
  const rph = setup.hphAuto ? autoRph(roundFreqs(b0, spotsMap, cal), b0, spotsMap, cal) : Math.max(1, setup.handsPerHour || 100);
  const res = optimizeSpread({ B: setup.bankroll, mn, mx, cal, entry, belowMode, spotsMap, rorCap: setup.rorPct / 100 });
  // over the risk cap: either the minimum is too big for the bankroll, or nothing at this table wins at all
  const loses = res.infeasible ? !(optimizeSpread({ B: setup.bankroll, mn, mx, cal, entry, belowMode, spotsMap, rorCap: 0.999 }).ev > 0) : !(res.ev > 0);
  return { ev: res.infeasible ? 0 : res.ev * rph, ror: res.ror, bets: res.bets, infeasible: !!res.infeasible, loses, rph, mn, mx };
}
const verdictOf = (s, score) => (s.loses ? ["Walk", "No spread wins at this table."] : s.infeasible ? ["Walk", "The minimum is too big for your bankroll at your risk limit."] : score >= 55 ? ["Sit", "As good as your usual game or better."] : score >= 35 ? ["Maybe", "Worth playing if nothing better is open."] : ["Walk", "Much worse than your usual game."]);
const scoreOf = (ev, ref) => (ref > 0 ? Math.max(0, Math.min(100, Math.round((50 * ev) / ref))) : ev > 0 ? 100 : 0);
// the spread as a short line: neighbouring counts with the same bet are joined ("+2 $50 · +3–+4 $75")
function spreadLine(bets) {
  const parts = []; let i = 0;
  while (i < COUNTS.length) { let j = i; while (j + 1 < COUNTS.length && (+bets[COUNTS[j + 1]] || 0) === (+bets[COUNTS[i]] || 0)) j++;
    const a = COUNTS[i], b = COUNTS[j], v = +bets[a] || 0, last = j === COUNTS.length - 1;
    const lab = a === b ? fmtTC(a) + (last ? "+" : "") : last ? `${fmtTC(a)}+` : i === 0 ? `${fmtTC(b)} and below` : `${fmtTC(a)} to ${fmtTC(b)}`;
    parts.push([lab, v ? "$" + v : "sit out"]); i = j + 1; }
  return parts;
}

const BLANK = { rules: { decks: 6, h17: true, bj65: false, surrender: false, das: true, pen: 75 }, min: "", max: "", seats: 4 };
export function TableScoreCard({ casinos, onUseRules, appRules }) {
  const [setup, setSetup] = useState(null);
  useEffect(() => { spreadSetup().then(setSetup).catch(() => {}); }, []);
  // games you've written down on the map, ready to pick
  const games = useMemo(() => { const out = []; (casinos || []).forEach((c) => ((c.mark && c.mark.games) || []).forEach((g, i) => g.rules && out.push({ key: c.id + ":" + (g.id || i), name: c.name, label: g.label, g }))); return out; }, [casinos]);
  const [pick, setPick] = useState("");
  const [g, setG] = useState(BLANK);
  const choose = (k) => { setPick(k); const f = games.find((x) => x.key === k); setG(f ? { rules: { ...BLANK.rules, ...f.g.rules }, min: f.g.min || "", max: f.g.max || "", seats: g.seats } : BLANK); };
  const setR = (k, v) => setG((o) => ({ ...o, rules: { ...o.rules, [k]: v } }));
  const [out, setOut] = useState(null);
  const ref = useMemo(() => { if (!setup) return null; try { return scoreGame(setup, { rules: setup.rules, min: setup.minBet, max: setup.maxBet, seats: setup.seats }); } catch (_) { return null; } }, [setup]);
  useEffect(() => {
    if (!setup || !ref) return;
    const t = setTimeout(() => { try { setOut(scoreGame(setup, g)); } catch (_) { setOut(null); } }, 150);
    return () => clearTimeout(t);
  }, [setup, ref, g]);
  const R = g.rules, row = (label, control) => <div className="grid items-center gap-3" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,200px)" }}><span className="text-sm" style={{ color: "var(--ivory-d)" }}>{label}</span>{control}</div>;
  const num = (k, ph) => <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 mono" style={{ color: "var(--muted)" }}>$</span><input className="in mono" style={{ paddingLeft: 24 }} type="number" inputMode="numeric" min="0" placeholder={ph} value={g[k]} onChange={(e) => setG((o) => ({ ...o, [k]: e.target.value }))} /></div>;
  const score = out && ref ? scoreOf(out.ev, ref.ev) : null, [verdict, why] = out && ref ? verdictOf(out, score) : ["", ""];
  const tone = verdict === "Sit" ? "var(--brass)" : verdict === "Maybe" ? "var(--ivory)" : "var(--rose)";
  return (
    <section className="card p-5 mb-4 deskonly">
      <div className="eyebrow mb-3">Table score</div>
      {games.length > 0 && <select className="in csel mb-3" value={pick} onChange={(e) => choose(e.target.value)} aria-label="Load a game you've saved">
        <option value="">A table in front of you</option>
        {games.map((x) => <option key={x.key} value={x.key}>{x.name}{x.label ? ` — ${x.label}` : ""}</option>)}
      </select>}
      <div className="space-y-2.5">
        {row("Blackjack pays", <Seg small value={!!R.bj65} options={[[false, "3 to 2"], [true, "6 to 5"]]} onChange={(v) => setR("bj65", v)} />)}
        {row("Decks", <Seg small value={R.decks} options={[[1, "1"], [2, "2"], [4, "4"], [6, "6"], [8, "8"]]} onChange={(v) => setR("decks", v)} />)}
        {row("Dealer on soft 17", <Seg small value={!!R.h17} options={[[false, "Stands"], [true, "Hits"]]} onChange={(v) => setR("h17", v)} />)}
        {row("Surrender", <Seg small value={!!R.surrender} options={[[false, "No"], [true, "Yes"]]} onChange={(v) => setR("surrender", v)} />)}
        {row("Double after split", <Seg small value={R.das !== false} options={[[false, "No"], [true, "Yes"]]} onChange={(v) => setR("das", v)} />)}
        {row(<>Penetration <span className="mono" style={{ color: "var(--brass)" }}>{R.pen}%</span></>, <input type="range" min={50} max={90} step={5} value={R.pen} onChange={(e) => setR("pen", Number(e.target.value))} aria-label="Penetration" />)}
        {row("Players, you included", <Seg small value={g.seats} options={[1, 2, 3, 4, 5, 6, 7].map((k) => [k, String(k)])} onChange={(v) => setG((o) => ({ ...o, seats: v }))} />)}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <label className="block"><span className="eyebrow block mb-1.5">Table min</span>{num("min", setup ? String(setup.minBet) : "Min")}</label>
        <label className="block"><span className="eyebrow block mb-1.5">Table max</span>{num("max", setup ? String(setup.maxBet) : "Max")}</label>
      </div>
      {out && ref && (
        <div key={verdict + score} className="rounded-xl px-4 py-3.5 mt-4 rise" style={{ background: "rgba(var(--fg),.035)" }}>
          <div className="flex items-center gap-4">
            <div className="mono font-semibold leading-none" style={{ fontSize: 40, color: tone }}>{score}</div>
            <div className="min-w-0">
              <div className="text-base font-semibold" style={{ color: tone }}>{verdict}</div>
              <div className="text-xs" style={{ color: "var(--ivory-d)" }}>{why}</div>
            </div>
          </div>
          {!out.infeasible && out.ev > 0 && <>
            <div className="text-xs mt-3" style={{ color: "var(--ivory-d)" }}><span className="mono font-semibold" style={{ color: "var(--ivory)" }}>{money(out.ev)}/hr</span> with your {shortMoney(setup.bankroll)} bankroll at {pct(out.ror, out.ror < 0.01 ? 1 : 0)} risk of ruin, against {money(ref.ev)}/hr in your usual game ({rulesShort(setup.rules)}).</div>
            <div className="eyebrow mt-3 mb-1" style={{ fontSize: 9.5 }}>Best spread here</div>
            <div className="flex flex-wrap gap-1.5">{spreadLine(out.bets).map(([k, v]) => <span key={k} className="rounded-lg px-2 py-1 text-[11px]" style={{ background: "rgba(var(--fg),.05)", color: "var(--ivory-d)" }}><span className="mono" style={{ color: "var(--muted)" }}>{k}</span> <span className="mono font-semibold" style={{ color: v === "sit out" ? "var(--muted)" : "var(--ivory)" }}>{v}</span></span>)}</div>
          </>}
          {onUseRules && <button type="button" className="text-xs font-semibold mt-3" style={{ color: "var(--brass)" }} onClick={() => onUseRules({ ...appRules, ...R })}>Practice this game in the app ›</button>}
        </div>
      )}
      <Info label="About the score">The best spread this table allows, with your bankroll, risk-of-ruin cap and entry count from Bet spread. 50 is as good as your usual game ({setup ? `${rulesShort(setup.rules)}, $${setup.minBet}–$${setup.maxBet}` : "the app's saved rules"}); 100 is twice as good or better. Sit at 55 and up, think twice from 35 to 54, walk below that.</Info>
    </section>
  );
}

// ---------- a casino's score ----------
// the best game known at a casino: your saved games first, else the scouting report's best game
function gamesAt(c) {
  const mine = ((c.mark && c.mark.games) || []).filter((g) => g.rules);
  if (mine.length) return mine.map((g) => ({ rules: g.rules, min: g.min || "", max: g.max || "" }));
  const b = c.intel && c.intel.best;
  if (!b || b.bj65) return [];
  return [{ rules: { decks: b.decks || 6, h17: b.h17 !== false, das: b.das !== false, surrender: !!b.ls, rsa: !!b.rsa, pen: b.pen || 75 }, min: c.intel.min || "" }];
}
const _sc = new Map(); // setup + games → { score, ev } (null when the casino has no game to score)
const setupKey = (s) => JSON.stringify([s.bankroll, s.rorPct, s.entry, s.belowMode, s.minBet, s.maxBet, s.rules, s.seats, s.spotsMap, s.hphAuto, s.handsPerHour]);
const refOf = (setup) => { const k = "ref" + setupKey(setup); if (!_sc.has(k)) _sc.set(k, scoreGame(setup, { rules: setup.rules, min: setup.minBet, max: setup.maxBet, seats: setup.seats })); return _sc.get(k); };
function scoreCasino(setup, c, peek) {
  const games = gamesAt(c); if (!games.length) return null;
  const k = setupKey(setup) + JSON.stringify(games);
  if (_sc.has(k) || peek) return _sc.get(k);
  if (_sc.size > 4000) _sc.clear();
  const ref = refOf(setup); let best = null;
  games.forEach((g) => { const x = scoreGame(setup, g), sc = x.loses || x.infeasible ? 0 : scoreOf(x.ev, ref.ev); if (!best || sc > best.score) best = { score: sc, ev: x.loses || x.infeasible ? 0 : x.ev }; });
  _sc.set(k, best); return best;
}
export const scoreTone = (n) => (n >= 55 ? "var(--brass)" : n >= 35 ? "var(--ivory)" : "var(--rose)");
// Scores for a list of casinos. The optimizer runs once per game, so they are worked out a few at a time after the page
// has settled and kept; `get(c)` is undefined until that casino's turn has come.
export function useCasinoScores(list, on = true) {
  const [setup, setSetup] = useState(null), [, bump] = useState(0);
  useEffect(() => { if (on) spreadSetup().then(setSetup).catch(() => {}); }, [on]);
  const ids = (list || []).map((c) => c.id).join(",");
  useEffect(() => {
    if (!setup || !on) return;
    const todo = (list || []).filter((c) => gamesAt(c).length && scoreCasino(setup, c, true) === undefined);
    if (!todo.length) return;
    let i = 0, id = setTimeout(function tick() {
      const t0 = performance.now();
      try { while (i < todo.length && performance.now() - t0 < 14) scoreCasino(setup, todo[i++]); } catch (_) { i = todo.length; }
      bump((n) => n + 1); if (i < todo.length) id = setTimeout(tick, 40);
    }, 700);
    return () => clearTimeout(id);
  }, [setup, ids, on]); // eslint-disable-line
  return { setup, get: (c) => (setup ? scoreCasino(setup, c, true) : undefined) };
}
export const wideScreen = () => { try { return window.matchMedia("(min-width:1024px)").matches; } catch (_) { return false; } };

// ---------- rotation ----------
const DAY = 864e5;
const dayOf = (d) => new Date(d + "T12:00:00").getTime();
const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtWeekday = (t) => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const ago = (days) => (days <= 0 ? "today" : days === 1 ? "yesterday" : days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`);
// Rest after a visit, from two numbers you can change on the Plan page: `base` (days after an ordinary visit) and `backed`
// (days after a back-off). Medium heat, being watched, or three visits in 30 days rests a casino three times the base;
// High heat six times; a second back-off at the same casino twice the back-off rest.
export const REST_DEF = { base: 7, backed: 90 };
const restSet = (r) => ({ base: r.base, warm: r.base * 3, hot: r.base * 6, busy: r.base * 3, backed: r.backed, backedAgain: r.backed * 2 });
// days a casino rests after a visit at time t (dates: every visit so far, in ms, t included)
function restDays(c, t, dates, lastHeat, R) {
  const m = c.mark || {}, recent = dates.filter((d) => d <= t && t - d <= 30 * DAY).length;
  let days = R.base, why = "";
  if (m.heat === 2) { days = R.warm; why = "medium heat"; }
  if (lastHeat === "watched" && days < R.warm) { days = R.warm; why = "watched last visit"; }
  if (recent >= 3 && days < R.busy) { days = R.busy; why = `${recent} visits in 30 days`; }
  if (m.heat === 3) { days = R.hot; why = "high heat"; }
  return { days, why };
}
export function restOf(c, R) {
  const s = c.sess, m = c.mark || {}, dates = ((s && s.dates) || []).map(dayOf);
  const last = s && s.last ? dayOf(s.last) : null;
  if (m.status === "backed" || (s && s.backed)) {
    const on = [m.backedOn, s && s.backed].filter(Boolean).sort().pop(), from = on ? dayOf(on) : last;
    const n = Math.max(1, (s && s.backedN) || 0), days = n >= 2 ? R.backedAgain : R.backed;
    return { kind: "backed", until: from ? from + days * DAY : null, last, dates, why: n >= 2 ? `backed off ${n} times` : "backed off" };
  }
  const { days, why } = last ? restDays(c, last, dates, s.lastHeat, R) : { days: 0, why: "" };
  return { kind: "rest", until: last ? last + days * DAY : null, last, dates, why };
}
// days rested × 0.75 at a score of 0, × 1 at 50 (or unknown), × 1.25 at 100
const weightAt = (last, t, score) => ((last ? (t - last) / DAY : 365) + 1) * (0.75 + (score == null ? 50 : score) / 200);
// The next n visits, one every `gap` days: each time the ready casino with the best mix of rest and game, which then
// rests again. When nothing is ready the visit waits for the first casino to come back.
function schedule(rows, now, R, gap, n, scoreOfC) {
  const st = rows.filter((r) => r.kind !== "backed" || r.until).map((r) => ({ r, last: r.last, dates: r.dates.slice(), until: r.until, back: r.kind === "backed" }));
  const out = []; let t = now;
  for (let i = 0; i < n && st.length; i++) {
    let cand = st.filter((s) => !s.until || s.until <= t);
    if (!cand.length) { t = Math.min(...st.map((s) => s.until)); cand = st.filter((s) => s.until <= t); }
    const pick = cand.reduce((a, b) => (weightAt(b.last, t, scoreOfC(b.r.c)) > weightAt(a.last, t, scoreOfC(a.r.c)) ? b : a));
    out.push({ t, c: pick.r.c, back: pick.back, wait: i > 0 && t - out[i - 1].t > gap * DAY + 1 });
    pick.last = t; pick.dates.push(t); pick.back = false;
    pick.until = t + restDays(pick.r.c, t, pick.dates, null, R).days * DAY;
    t += gap * DAY;
  }
  return out;
}
const milesBetween = (a, b) => { const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r; return Math.sqrt(x * x + y * y) * 3959; };

const planCss = `
.prow{display:grid;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 4px;border-radius:10px;transition:background .15s}
.prow+.prow{border-top:1px solid rgba(var(--fg),.06)}
button.prow:hover{background:rgba(var(--fg),.04)}
.ptrack{position:relative;height:8px;border-radius:99px;background:rgba(var(--acc),.16)}
.ptrack>i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:rgba(var(--fg),.16)}
.ptrack>i.x{background:rgba(var(--neg),.45)}
.ptrack>b{position:absolute;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:99px;background:var(--brass);box-shadow:0 0 0 2px var(--bg2)}
.pscore{font-variant-numeric:tabular-nums;font-weight:600;font-size:13px;text-align:right}
`;
function Step({ v, set, min, max, step = 1, f = String, label }) {
  return (
    <span className="flex items-center gap-2">
      <button type="button" className="stepbtn" onClick={() => set(Math.max(min, v - step))} disabled={v <= min} aria-label={`Less: ${label}`}>−</button>
      <span className="mono text-sm font-semibold text-center" style={{ minWidth: 52, color: "var(--ivory)" }}>{f(v)}</span>
      <button type="button" className="stepbtn" onClick={() => set(Math.min(max, v + step))} disabled={v >= max} aria-label={`More: ${label}`}>+</button>
    </span>
  );
}
const WEEKS = 12;
function Rotation({ all, prefs, setPrefs, onOpen }) {
  const now = useMemo(() => Date.now(), []);
  const R = restSet(prefs.rest);
  const rows = useMemo(() => (all || []).filter((c) => (c.sess && c.sess.n) || (c.mark && (c.mark.status === "been" || c.mark.status === "backed")))
    .filter((c) => !(c.mark && c.mark.hidden)).map((c) => ({ c, ...restOf(c, R) })), [all, prefs.rest.base, prefs.rest.backed]); // eslint-disable-line
  // places with a scouting report near where you play that aren't in the rotation yet
  const near = useMemo(() => {
    const mine = rows.filter((r) => isFinite(r.c.lat + r.c.lon)); if (!mine.length) return [];
    const w = mine.map((r) => Math.max(1, (r.c.sess && r.c.sess.n) || 0)), W = w.reduce((a, b) => a + b, 0);
    const home = { lat: mine.reduce((s, r, i) => s + r.c.lat * w[i], 0) / W, lon: mine.reduce((s, r, i) => s + r.c.lon * w[i], 0) / W }, ids = new Set(rows.map((r) => r.c.id));
    return (all || []).filter((c) => !ids.has(c.id) && !(c.mark && c.mark.hidden) && isFinite(c.lat + c.lon) && gamesAt(c).length).map((c) => ({ c, mi: milesBetween(home, c) })).filter((x) => x.mi <= 250).sort((a, b) => a.mi - b.mi).slice(0, 30);
  }, [rows, all]);
  const scoreList = useMemo(() => [...rows.map((r) => r.c), ...near.map((x) => x.c)], [rows, near]);
  const sc = useCasinoScores(scoreList), scoreN = (c) => { const x = sc.get(c); return x ? x.score : null; };
  const isReady = (r) => r.kind !== "backed" && (!r.until || r.until <= now);
  const ready = rows.filter(isReady).sort((a, b) => weightAt(b.last, now, scoreN(b.c)) - weightAt(a.last, now, scoreN(a.c)));
  const resting = rows.filter((r) => !isReady(r)).sort((a, b) => (a.until || Infinity) - (b.until || Infinity));
  const plan = schedule(rows, now, R, 7 / prefs.perWeek, 6, scoreN);
  const visits = {}; plan.forEach((v) => (visits[v.c.id] = [...(visits[v.c.id] || []), v.t]));
  // where your hours went over the last 90 days
  const h90 = []; rows.forEach((r) => { const h = ((r.c.sess && r.c.sess.recs) || []).filter((x) => now - dayOf(x.date) <= 90 * DAY).reduce((s, x) => s + x.h, 0); if (h > 0) h90.push([r.c, h]); });
  h90.sort((a, b) => b[1] - a[1]);
  const tot = h90.reduce((s, x) => s + x[1], 0), heavy = h90.length && tot >= 6 && h90[0][1] / tot > 0.5 ? h90[0] : null, share = Object.fromEntries(h90.map(([c, h]) => [c.id, h / tot]));
  const scout = near.map((x) => ({ ...x, s: sc.get(x.c) })).filter((x) => x.s && x.s.score >= 35).sort((a, b) => b.s.score - a.s.score || a.mi - b.mi).slice(0, 5);
  const Score = ({ c }) => { const x = sc.get(c); return <span className="pscore" style={{ color: x ? scoreTone(x.score) : "var(--muted)" }} title={x ? `Table score ${x.score} · ${money(x.ev)}/hr` : "No game saved or reported"}>{x ? x.score : "—"}</span>; };
  const setRest = (k, v) => setPrefs({ rest: { ...prefs.rest, [k]: v } });
  const restInfo = (
    <Info label="Rest days and how the order works">
      <div className="space-y-2.5 mb-3 mt-1">
        <div className="flex items-center justify-between gap-3"><span className="text-sm">Rest after a visit</span><Step v={prefs.rest.base} set={(v) => setRest("base", v)} min={1} max={30} f={(v) => `${v} d`} label="rest after a visit" /></div>
        <div className="flex items-center justify-between gap-3"><span className="text-sm">Rest after a back-off</span><Step v={prefs.rest.backed} set={(v) => setRest("backed", v)} min={30} max={365} step={15} f={(v) => `${v} d`} label="rest after a back-off" /></div>
      </div>
      A casino rests {R.base} days after a visit; {R.warm} days if you rated its heat Medium, were watched last time, or went 3 or more times in 30 days; {R.hot} days at High heat. A back-off rests it {R.backed} days, or {R.backedAgain} days once you've been backed off there twice. The score is the casino's best game — your saved games, else its scouting report — where 50 is your usual game. Each visit goes to the ready casino with the most days rested, nudged by score: a great game counts about like a quarter more rest.
    </Info>);
  if (!rows.length) return <section className="card p-5 mb-4"><div className="eyebrow mb-1">Rotation</div><p className="text-sm" style={{ color: "var(--ivory-d)" }}>Log sessions, or mark casinos as been on the Casinos page, and this plans where to play next and when each casino is safe to go back to.</p></section>;
  return (<>
    <section className="card p-5 mb-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="eyebrow">Next visits</div>
        <span className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>Sessions a week<Step v={prefs.perWeek} set={(v) => setPrefs({ perWeek: v })} min={1} max={7} label="sessions a week" /></span>
      </div>
      {heavy && <p className="text-[11.5px] mb-2" style={{ color: "var(--neg-l)" }}>{Math.round((100 * heavy[1]) / tot)}% of your last 90 days' hours were at {heavy[0].name}. The plan spreads them out.</p>}
      {plan.map((v, i) => { const x = sc.get(v.c); return (
        <button key={i} className="prow" style={{ gridTemplateColumns: "92px minmax(0,1fr) 30px 64px" }} onClick={() => onOpen(v.c)}>
          <span className="mono text-xs" style={{ color: i === 0 ? "var(--brass)" : "var(--ivory-d)" }}>{i === 0 && v.t - now < DAY / 2 ? "Now" : fmtWeekday(v.t)}</span>
          <span className="min-w-0"><span className="block text-sm font-semibold truncate" style={{ color: i === 0 ? "var(--brass)" : "var(--ivory)" }}>{v.c.name}</span>{(v.back || v.wait) && <span className="block text-[11px] truncate" style={{ color: v.back ? "var(--neg-l)" : "var(--muted)" }}>{v.back ? "first visit since the back-off — keep it short" : "nothing is ready sooner"}</span>}</span>
          <Score c={v.c} />
          <span className="mono text-xs text-right" style={{ color: "var(--ivory-d)" }}>{x && x.ev > 0 ? sgnMoney(x.ev * prefs.sessHours) : ""}</span>
        </button>); })}
      <p className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>Score, then what a {prefs.sessHours}-hour session there is worth on average. Log a session and the plan moves on.</p>
    </section>
    <section className="card p-5 mb-4">
      <div className="flex items-baseline justify-between gap-3 mb-1"><div className="eyebrow">Your casinos</div><div className="text-[10px] font-semibold uppercase" style={{ color: "var(--muted)", letterSpacing: ".08em" }}>next {WEEKS} weeks</div></div>
      {[...ready, ...resting].map((r) => { const rd = isReady(r), frac = rd || !r.until ? (rd ? 0 : 1) : Math.min(1, (r.until - now) / (WEEKS * 7 * DAY)), sh = share[r.c.id]; return (
        <button key={r.c.id} className="prow" style={{ gridTemplateColumns: "minmax(0,1.25fr) 30px 76px minmax(0,1fr)" }} onClick={() => onOpen(r.c)}>
          <span className="min-w-0"><span className="block text-sm font-semibold truncate" style={{ color: "var(--ivory)" }}>{r.c.name}</span><span className="block text-[11px] truncate" style={{ color: "var(--muted)" }}>{r.last ? ago(Math.floor((now - r.last) / DAY)) : "no sessions"}{sh ? ` · ${Math.round(sh * 100)}% of hours` : ""}{r.why ? ` · ${r.why}` : ""}</span></span>
          <Score c={r.c} />
          <span className="text-xs font-semibold text-right" style={{ color: rd ? "var(--brass)" : r.kind === "backed" ? "var(--rose)" : "var(--ivory-d)" }}>{rd ? "Ready" : r.until ? `Back ${fmtDay(r.until)}` : "Backed off"}</span>
          <span className="ptrack" aria-hidden="true">{frac > 0 && <i className={r.kind === "backed" ? "x" : ""} style={{ width: `${frac * 100}%` }} />}{(visits[r.c.id] || []).map((t) => (t - now) / (WEEKS * 7 * DAY)).filter((f) => f <= 1).map((f, i) => <b key={i} style={{ left: `${Math.max(1.5, f * 100)}%` }} />)}</span>
        </button>); })}
      <p className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>Grey is resting, red is a back-off, green is open. Dots are the planned visits.</p>
      {restInfo}
    </section>
    {scout.length > 0 && <section className="card p-5 mb-4">
      <div className="eyebrow mb-1">Worth scouting</div>
      <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>The best reported games near where you play that aren't in your rotation yet.</p>
      {scout.map((x) => (
        <button key={x.c.id} className="prow" style={{ gridTemplateColumns: "minmax(0,1fr) 30px 64px" }} onClick={() => onOpen(x.c)}>
          <span className="min-w-0"><span className="block text-sm font-semibold truncate" style={{ color: "var(--ivory)" }}>{x.c.name}</span><span className="block text-[11px] truncate" style={{ color: "var(--muted)" }}>{[x.c.city, x.c.st].filter(Boolean).join(", ")} · about {Math.round(x.mi / 5) * 5} mi{x.c.intel && x.c.intel.min ? ` · from $${x.c.intel.min}` : ""}</span></span>
          <Score c={x.c} />
          <span className="mono text-xs text-right" style={{ color: "var(--ivory-d)" }}>{money(x.s.ev)}/hr</span>
        </button>))}
      <p className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>Miles are straight-line from the middle of the casinos you play. Reports can be out of date, so check the table before you sit.</p>
    </section>}
  </>);
}

// ---------- bankroll growth ----------
// Your current spread scaled to each table minimum (every bet × table min ÷ your min): EV grows by that factor and
// variance by its square, so the bankroll a risk of ruin needs is k · variance · −ln(risk) / (2 · EV).
const TABLE_MINS = [5, 10, 15, 25, 50, 75, 100, 200, 500];
const PLAN_RISKS = [[0.02, "2%"], [0.05, "5%"], [0.1, "10%"]];
const HORIZONS = [[26, "6 months"], [52, "1 year"], [104, "2 years"]];
function rng(seed) { let a = seed >>> 0; const u = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()); }
// 1,500 bankroll paths over `hours`: play the biggest table the bankroll covers, move up when it reaches the next
// table's bankroll, drop back when it falls below `down` for the table being played. Returns the 10th / 50th / 90th
// percentile at each step and what happened along the way.
export function growthSim({ B, lv, hours, goal }) {
  const N = 1500, steps = Math.max(8, Math.min(160, Math.round(hours / 2))), dt = hours / steps, sq = Math.sqrt(dt), z = rng(20261116);
  let s0 = 0; lv.forEach((l, i) => { if (l.need <= B) s0 = i; });
  const col = Array.from({ length: steps + 1 }, () => new Float32Array(N)), reach = lv.map(() => 0), end = lv.map(() => 0);
  let bust = 0, below = 0; const goalAt = [];
  for (let p = 0; p < N; p++) {
    let b = B, l = s0, top = s0, dead = false, g = goal > B ? -1 : 0; col[0][p] = b;
    for (let i = 1; i <= steps; i++) {
      if (!dead) {
        b += lv[l].ev * dt + lv[l].sd * sq * z();
        if (b <= 0) { b = 0; dead = true; }
        while (l < lv.length - 1 && b >= lv[l + 1].need) l++;
        while (l > 0 && b < lv[l].down) l--;
        if (l > top) top = l; if (g < 0 && b >= goal) g = i * dt;
      }
      col[i][p] = b;
    }
    if (dead) bust++; if (b < B) below++; if (g > 0) goalAt.push(g);
    for (let j = s0 + 1; j <= top; j++) reach[j]++; end[l]++;
  }
  const q = (a, f) => a[Math.min(N - 1, Math.floor(f * N))];
  const pts = col.map((a, i) => { a.sort(); return { h: i * dt, lo: q(a, 0.1), mid: q(a, 0.5), hi: q(a, 0.9) }; });
  goalAt.sort((a, b) => a - b);
  return { pts, s0, bust: bust / N, below: below / N, reach: reach.map((n) => n / N), end: end.map((n) => n / N), goalP: goalAt.length / N, goalMed: goalAt.length >= N / 2 ? goalAt[Math.floor(N / 2)] : null };
}
function GrowthChart({ sim, B, lv, flat, hours, whenOf }) {
  const W = 520, H = 220, P = { l: 44, r: 58, t: 10, b: 22 }, pts = sim.pts;
  const hiV = Math.max(...pts.map((p) => p.hi), B) * 1.04, loV = Math.min(...pts.map((p) => p.lo), B) * 0.96;
  const x = (h) => P.l + (h / hours) * (W - P.l - P.r), y = (v) => H - P.b - ((v - loV) / Math.max(1, hiV - loV)) * (H - P.t - P.b);
  const line = (k) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.h).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const band = line("hi") + pts.slice().reverse().map((p) => `L${x(p.h).toFixed(1)},${y(p.lo).toFixed(1)}`).join("") + "Z";
  const marks = lv.filter((l, i) => i > sim.s0 && l.need > loV && l.need < hiV).slice(0, 4), last = pts[pts.length - 1];
  const ticks = [0, 0.5, 1].map((f) => f * hours);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" role="img" aria-label={`Bankroll over the next ${Math.round(hours)} hours of play: median ${shortMoney(last.mid)}, usually between ${shortMoney(last.lo)} and ${shortMoney(last.hi)}`}>
      <g key={`${hours}|${B}|${lv.length}|${Math.round(last.mid)}`}>
        <path className="fadein" d={band} fill="rgba(var(--acc),.13)" />
        {marks.map((l) => <g key={l.m} className="fadein"><line x1={P.l} x2={W - P.r} y1={y(l.need)} y2={y(l.need)} stroke="rgba(var(--fg),.2)" strokeDasharray="2 4" /><text x={W - P.r + 6} y={y(l.need) + 3} fill="var(--muted)" style={{ font: "600 9.5px Inter" }}>${l.m} tables</text></g>)}
        <line className="fadein" x1={x(0)} y1={y(B)} x2={x(hours)} y2={y(B + flat * hours)} stroke="rgba(var(--fg),.4)" strokeDasharray="4 4" />
        <path className="drawline" pathLength="1" d={line("mid")} fill="none" stroke="var(--brass)" strokeWidth="2" strokeLinejoin="round" />
        <circle className="popin late" cx={x(hours)} cy={y(last.mid)} r="3.5" fill="var(--brass)" />
      </g>
      {[loV + (hiV - loV) * 0.05, (loV + hiV) / 2, hiV - (hiV - loV) * 0.05].map((v, i) => <text key={i} x={P.l - 6} y={y(v) + 3} textAnchor="end" fill="var(--muted)" style={{ font: "500 9.5px Inter" }}>{shortMoney(v)}</text>)}
      <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} stroke="rgba(var(--fg),.15)" />
      {ticks.map((h, i) => <text key={i} x={x(h)} y={H - 6} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fill="var(--muted)" style={{ font: "500 9.5px Inter" }}>{i === 0 ? "today" : `${whenOf(h)} · ${Math.round(h)} h`}</text>)}
    </svg>
  );
}
const Tile = ({ k, v, sub, tone }) => (
  <div className="rounded-2xl px-3.5 py-3" style={{ background: "rgba(var(--fg),.035)", border: "1px solid rgba(var(--fg),.05)" }}>
    <div className="text-[10.5px] font-semibold uppercase" style={{ color: "var(--muted)", letterSpacing: ".08em" }}>{k}</div>
    <div className="mono text-lg font-semibold mt-0.5" style={{ color: tone || "var(--ivory)" }}>{v}</div>
    {sub && <div className="text-[11px] leading-snug" style={{ color: "var(--muted)" }}>{sub}</div>}
  </div>);
function Growth({ r, bankroll, minBet, bets, prefs, setPrefs, go }) {
  const risk = prefs.risk, hpw = prefs.perWeek * prefs.sessHours, hours = prefs.weeks * hpw;
  const top = Math.max(0, ...COUNTS.map((c) => +bets[c] || 0));
  const whenOf = (h) => { const w = h / hpw; return w > 520 ? "10+ years" : new Date(Date.now() + w * 7 * DAY).toLocaleDateString(undefined, { month: "short", year: "numeric" }); };
  const ok = minBet > 0 && r.evHour > 0;
  const model = useMemo(() => {
    if (!ok) return null;
    const per = (r.sdHour * r.sdHour * -Math.log(risk)) / (2 * r.evHour), f = Math.log(Math.min(0.999, 2 * risk)) / Math.log(risk); // drop back once the risk has doubled
    const mins = [...new Set([...TABLE_MINS, minBet])].sort((a, b) => a - b), at = mins.indexOf(minBet);
    const mk = (m) => { const k = m / minBet; return { m, k, need: per * k, down: per * k * f, ev: r.evHour * k, sd: r.sdHour * k, top: top * k }; };
    let from = at; while (from > 0 && per * (mins[from] / minBet) > bankroll) from--; // the biggest table you qualify for, if it is below yours
    const lv = mins.slice(from).map(mk);
    let b = bankroll, hrs = 0, odds = 1, play = lv.filter((l) => l.need <= bankroll).pop() || null;
    lv.forEach((l) => {
      if (l.need <= bankroll) { l.state = l === play ? "now" : "ok"; return; }
      if (!play) { l.state = "short"; return; }
      const th = (2 * play.ev) / (play.sd * play.sd);
      odds *= (1 - Math.exp(-th * b)) / (1 - Math.exp(-th * l.need)); l.chance = odds;
      hrs += (l.need - b) / play.ev; l.hrs = hrs; l.state = "later"; b = l.need; play = l;
    });
    return { lv, cur: lv.filter((l) => l.state === "now").pop() || null };
  }, [ok, r.evHour, r.sdHour, risk, minBet, bankroll, top]);
  const goal = +prefs.goal > bankroll ? +prefs.goal : bankroll * 2;
  const sim = useMemo(() => (model && hours > 0 && bankroll > 0 ? growthSim({ B: bankroll, lv: model.lv, hours, goal }) : null), [model, hours, bankroll, goal]);
  const head = <div className="flex items-center justify-between gap-3 mb-3"><div className="eyebrow">Growing your bankroll</div><Seg small value={risk} options={PLAN_RISKS} onChange={(v) => setPrefs({ risk: v })} style={{ width: 170 }} /></div>;
  if (!ok || !model || !sim) return <section className="card p-5 mb-4">{head}<p className="text-sm" style={{ color: "var(--ivory-d)" }}>{bankroll > 0 ? "Your spread doesn't win yet, so there's nothing to grow into." : "Set your bankroll first."} <button className="font-semibold" style={{ color: "var(--brass)" }} onClick={() => go("calc")}>Open Bet spread ›</button></p></section>;
  const { lv, cur } = model, start = lv[sim.s0], last = sim.pts[sim.pts.length - 1], flatEnd = bankroll + start.ev * hours;
  const shown = lv.filter((l, i) => i <= sim.s0 + 4), endTop = sim.end.reduce((b, p, i) => (p > sim.end[b] ? i : b), 0);
  return (<>
    <section className="card p-5 mb-4">
      {head}
      <p className="text-sm mb-3" style={{ color: "var(--ivory-d)" }}>{cur ? <>Your {money(bankroll)} supports <span className="mono font-semibold" style={{ color: "var(--brass)" }}>${cur.m}</span> tables at {pct(risk, 0)} risk of ruin.</> : <>At {pct(risk, 0)} risk your {money(bankroll)} is short of the ${lv[0].m} table with this spread — the plan starts there anyway.</>} Here is {prefs.perWeek} session{prefs.perWeek === 1 ? "" : "s"} a week of {prefs.sessHours} hours, moving up as the bankroll allows.</p>
      <div className="flex items-center justify-between gap-3 mb-2">
        <Seg small value={prefs.weeks} options={HORIZONS} onChange={(v) => setPrefs({ weeks: v })} style={{ width: 250 }} />
        <span className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>Hours a session<Step v={prefs.sessHours} set={(v) => setPrefs({ sessHours: v })} min={1} max={12} f={(v) => `${v} h`} label="hours a session" /></span>
      </div>
      <GrowthChart sim={sim} B={bankroll} lv={lv} flat={start.ev} hours={hours} whenOf={whenOf} />
      <div className="flex gap-4 text-[11px] mt-1 mb-3" style={{ color: "var(--muted)" }}><span><span style={{ color: "var(--brass)" }}>━</span> typical</span><span><span style={{ color: "rgba(var(--acc),.5)" }}>█</span> 8 times in 10</span><span>┅ never moving up</span></div>
      <div className="grid grid-cols-3 gap-2">
        <Tile k="Typical" v={shortMoney(last.mid)} sub={`${shortMoney(last.lo)} to ${shortMoney(last.hi)} · ${sgnMoney(last.mid - flatEnd)} vs never moving up`} tone="var(--brass)" />
        <Tile k="Playing by then" v={`$${lv[endTop].m} tables`} sub={`${Math.round(sim.end[endTop] * 100)}% of the time`} />
        <Tile k="Behind today" v={`${Math.round(sim.below * 100)}%`} sub={sim.bust >= 0.005 ? `${pct(sim.bust, 0)} lose it all` : "almost never lose it all"} tone={sim.below > 0.3 ? "var(--neg-l)" : undefined} />
      </div>
      <div className="flex items-center justify-between gap-3 mt-4 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ivory-d)" }}>Target
          <span className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 mono" style={{ color: "var(--muted)" }}>$</span><input className="in mono" style={{ paddingLeft: 24, width: 120, height: 38 }} type="number" inputMode="numeric" min="0" placeholder={String(Math.round(bankroll * 2))} value={prefs.goal} onChange={(e) => setPrefs({ goal: e.target.value })} aria-label="Target bankroll" /></span></label>
        <span className="text-xs text-right" style={{ color: "var(--ivory-d)" }}><span className="mono font-semibold" style={{ color: "var(--ivory)" }}>{Math.round(sim.goalP * 100)}%</span> chance of touching {shortMoney(goal)} within {HORIZONS.find((h) => h[0] === prefs.weeks)[1]}{sim.goalMed ? <> · typically by <span className="mono">{whenOf(sim.goalMed)}</span></> : ""}</span>
      </div>
    </section>
    <section className="card p-5 mb-4">
      <div className="eyebrow mb-2">When to move up, when to drop back</div>
      <div className="grid text-[10px] font-semibold uppercase pb-1.5" style={{ gridTemplateColumns: "44px minmax(0,1fr) 54px 62px 62px minmax(0,1.5fr)", gap: 10, color: "var(--muted)", letterSpacing: ".08em", borderBottom: "1px solid var(--line)" }}><span>Table</span><span>Bets</span><span className="text-right">$/hour</span><span className="text-right">Move up</span><span className="text-right">Drop at</span><span className="text-right">Getting there</span></div>
      {shown.map((l, i) => (
        <div key={l.m} className="grid items-center py-2" style={{ gridTemplateColumns: "44px minmax(0,1fr) 54px 62px 62px minmax(0,1.5fr)", gap: 10, borderBottom: "1px solid var(--line)", opacity: l.state === "ok" ? 0.6 : 1 }}>
          <span className="mono text-sm font-semibold" style={{ color: l.state === "now" ? "var(--brass)" : "var(--ivory)" }}>${l.m}</span>
          <span className="mono text-xs truncate" style={{ color: "var(--ivory-d)" }}>${l.m}–{shortMoney(l.top)}</span>
          <span className="mono text-xs text-right">{money(l.ev)}</span>
          <span className="mono text-xs text-right">{shortMoney(l.need)}</span>
          <span className="mono text-xs text-right" style={{ color: "var(--muted)" }}>{i === 0 ? "—" : shortMoney(l.down)}</span>
          <span className="text-xs text-right" style={{ color: l.state === "now" ? "var(--brass)" : l.state === "short" ? "var(--neg-l)" : "var(--ivory-d)" }}>
            {l.state === "now" ? "You're here" : l.state === "ok" ? "Covered" : l.state === "short" ? `${shortMoney(l.need - bankroll)} short` : <>{whenOf(l.hrs)} · {Math.round(l.hrs).toLocaleString()} h · <span className="mono">{Math.round(l.chance * 100)}%</span></>}
          </span>
        </div>))}
      <Info label="How it works">Each row is your current spread scaled to that table's minimum, so every bet grows by the same factor. "Move up" is the bankroll that spread needs to hold risk of ruin at {pct(risk, 0)}; "Drop at" is where that risk has doubled, so a bad run sends you back a table instead of digging deeper. "Getting there" is the expected date at your pace, the hours of play, and the chance of reaching that row without going broke on the way. The chart deals 1,500 possible futures with those rules: the line is the middle one, the band holds 8 in 10, and the dashed line is the typical result if you stayed at ${start.m} tables. Luck can make it much faster or slower.</Info>
    </section>
  </>);
}

// ---------- the Plan tab ----------
const PLAN_KEY = "bj-plan-v1"; // this device only
const PLAN_DEF = { perWeek: 2, sessHours: 4, weeks: 52, risk: 0.05, goal: "", rest: REST_DEF };
let _plan = null;
export function PlanPage({ r, bankroll, minBet, bets, go }) {
  const [prefs, setP] = useState(() => _plan || PLAN_DEF), [all, setAll] = useState(null);
  useEffect(() => { (async () => {
    if (!_plan) { try { const x = await window.storage.get(PLAN_KEY, false); if (x && x.value) { const d = JSON.parse(x.value); setP((_plan = { ...PLAN_DEF, ...d, rest: { ...REST_DEF, ...(d.rest || {}) } })); } } catch (_) {} }
    try { setAll(await loadCasinoAll()); } catch (_) { setAll([]); }
  })(); }, []);
  const setPrefs = (patch) => setP((o) => { const n = { ...o, ...patch }; _plan = n; try { window.storage.set(PLAN_KEY, JSON.stringify(n), false); } catch (_) {} return n; });
  const open = (c) => { openCasinoId(c.id); go("casinos", { open: c.id }); };
  return (
    <div>
      <style>{planCss}</style>
      <div className="dgrid"><div className="dcol">
        {all && <Rotation all={all} prefs={prefs} setPrefs={setPrefs} onOpen={open} />}
      </div><div className="dcol">
        <Growth r={r} bankroll={bankroll} minBet={minBet} bets={bets} prefs={prefs} setPrefs={setPrefs} go={go} />
      </div></div>
    </div>
  );
}
