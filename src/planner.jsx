// Desktop-only planning tools:
//  - TableScoreCard (Casinos page): score a table's rules against your bankroll and spread settings.
//  - useCasinoScores: each casino's best table score, worked out a few at a time (Casinos list and the Plan page).
//  - PlanPage (the Plan tab): the casino rotation and the bankroll growth plan.
// Like casinos.jsx, nothing from app.jsx may be used while this file loads — only inside functions.
import { useState, useEffect, useMemo, useRef } from "react";
import { Sheet, compute, sessionCash, tailFix, shoeRounds, useDeferred, Seg, Info, rulesShort, money, shortMoney, sgnMoney, fmtTC, pct, COUNTS, calFor, autoRph, roundFreqs, optimizeSpread, DEFAULT_RULES } from "./app.jsx";
import { loadCasinoAll, openCasinoId } from "./casinos.jsx";
import { loadSetup } from "./aitools.js";

// ---------- plan settings (this device only) ----------
const PLAN_KEY = "bj-plan-v1";
export const REST_DEF = { base: 7, backed: 90 };
const PLAN_DEF = { perWeek: 2, sessHours: 4, weeks: 52, risk: 0.05, goal: "", rest: REST_DEF };
async function loadPlan() {
  try { const x = await window.storage.get(PLAN_KEY, false); if (x && x.value) { const d = JSON.parse(x.value); return { ...PLAN_DEF, ...d, risk: d.risk > 0 && d.risk < 1 ? d.risk : PLAN_DEF.risk, rest: { ...REST_DEF, ...(d.rest || {}) } }; } } catch (_) {}
  return PLAN_DEF;
}

// ---------- table score ----------
// Every score assumes you play every hand at the table (no sitting out) — Nick's instruction — and uses your bankroll,
// table limits and two-hand counts from Bet spread with the risk limit set on the Plan page. The optimizer finds the
// most profit per hour the table allows under that limit, or its safest spread when nothing fits.
async function spreadSetup() {
  const base = await loadSetup(), plan = _planRisk || (await loadPlan()).risk;
  return { ...base, entry: -3, belowMode: "min", rorPct: plan * 100 };
}
let _planRisk = 0; // the Plan page's live risk limit, so the Casinos page scores match it without a reload
export function scoreGame(setup, g) {
  const R = { ...DEFAULT_RULES, ...(g.rules || {}) }, seats = g.seats || setup.seats || 4, cal = calFor(R, seats), B = setup.bankroll, cap = setup.rorPct / 100;
  const mn = +g.min > 0 ? +g.min : setup.minBet, mx = Math.max(mn, +g.max > 0 ? +g.max : setup.maxBet), spotsMap = setup.spotsMap || {};
  const b0 = {}; COUNTS.forEach((c) => (b0[c] = mn));
  const rph = setup.hphAuto ? autoRph(roundFreqs(b0, spotsMap, cal), b0, spotsMap, cal) : Math.max(1, setup.handsPerHour || 100);
  const res = optimizeSpread({ B, mn, mx, cal, entry: -3, belowMode: "min", spotsMap, rorCap: cap });
  // nothing fits the risk limit → the optimizer hands back its safest spread. That is what gets scored, marked down by
  // how short the bankroll is: short = bankroll ÷ the bankroll those bets need at the limit (= ln risk ÷ ln limit), and
  // fit = short². (To the first power the table's size cancels out — a table twice as big earns twice as much with the
  // same bets — so the square is what makes a table twice too big count half.)
  const loses = !(res.ev > 0), over = !loses && res.ror > cap * 1.001;
  const va = res.va > 0 ? res.va : !loses && res.ror > 0 && res.ror < 1 ? (-2 * res.ev * B) / Math.log(res.ror) : 0;
  let rps = 0; try { rps = shoeRounds(roundFreqs(res.bets, spotsMap, cal), res.bets, spotsMap, cal, R.pen); } catch (_) {}
  return { rps, ev: loses ? 0 : res.ev * rph, sd: Math.sqrt(va * rph), ror: loses ? 1 : res.ror, bets: res.bets, infeasible: over, fit: over ? Math.pow(Math.min(1, Math.log(Math.min(0.999999, res.ror)) / Math.log(cap)), 2) : 1, loses, rph, mn, mx };
}
const verdictOf = (s, score) => { if (s.loses) return ["Walk", "No spread wins here when every hand is played."]; if (s.infeasible) return score >= 50 ? ["Maybe", "Better for you than your usual game, but too big for your bankroll at your risk limit."] : score >= 40 ? ["Maybe", "Close to your usual game, but too big for your bankroll at your risk limit."] : ["Walk", "Too big for your bankroll at your risk limit."]; return score >= 50 ? ["Sit", "As good as your usual game or better."] : score >= 40 ? ["Maybe", "Worth playing if nothing better is open."] : ["Walk", "Much worse for you than your usual game."]; };
// 0–100 from what the game earns you per hour (your bankroll, every hand played, your risk limit) against your usual
// game: the same money is 50, twice is 67, three times 75, half 33. It never tops out, so two great games still rank
// against each other. Both sides are marked down by `fit` when they are too big for the bankroll, so 50 is always "as
// good as your usual game".
// Cash to bring so a session of `hours` runs out only 1 time in 20: the chance of ever dipping that far (pDip), with the
// app's fitted correction for how results bunch up inside a shoe — the same sum as "bring with you" on Bet spread.
export const cashFor = (x, hours) => (x && x.ev > 0 && x.sd > 0 && hours > 0 ? tailFix(x.rps || 0, hours * x.rph).c95 * sessionCash(0.05, x.ev, x.sd, hours) : 0);
const upTo50 = (v) => Math.ceil(v / 50) * 50;
const scoreOf = (ev, ref) => (!(ev > 0) ? 0 : ref > 0 ? Math.round((100 * ev) / (ev + ref)) : 100);
export const scoreFor = (x, ref) => (x.loses ? 0 : scoreOf(x.ev * x.fit, ref.ev * ref.fit));
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
  const score = out && ref ? scoreFor(out, ref) : null, [verdict, why] = out && ref ? verdictOf(out, score) : ["", ""];
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
          {out.ev > 0 && <>
            <div className="text-xs mt-3" style={{ color: "var(--ivory-d)" }}><span className="mono font-semibold" style={{ color: "var(--ivory)" }}>{money(out.ev)}/hr</span> at <span className="mono font-semibold" style={{ color: out.infeasible ? "var(--rose)" : "var(--ivory)" }}>{pct(out.ror, out.ror < 0.0095 ? 1 : 0)}</span> risk of ruin with your {shortMoney(setup.bankroll)} bankroll, playing every hand. Your usual game ({rulesShort(setup.rules)}) earns {money(ref.ev)}/hr the same way.</div>
            <div className="eyebrow mt-3 mb-1" style={{ fontSize: 9.5 }}>{out.infeasible ? "Safest bets here" : "Best bets here"}</div>
            <div className="flex flex-wrap gap-1.5">{spreadLine(out.bets).map(([k, v]) => <span key={k} className="rounded-lg px-2 py-1 text-[11px]" style={{ background: "rgba(var(--fg),.05)", color: "var(--ivory-d)" }}><span className="mono" style={{ color: "var(--muted)" }}>{k}</span> <span className="mono font-semibold" style={{ color: "var(--ivory)" }}>{v}</span></span>)}</div>
          </>}
          {onUseRules && <button type="button" className="text-xs font-semibold mt-3" style={{ color: "var(--brass)" }} onClick={() => onUseRules({ ...appRules, ...R })}>Practice this game in the app ›</button>}
        </div>
      )}
      <Info label="About the score">What this table earns you per hour against your usual game ({setup ? `${rulesShort(setup.rules)}, $${setup.minBet}–$${setup.maxBet}` : "the app's saved rules"}), playing every hand with the best bets your bankroll allows at your risk limit ({setup ? setup.rorPct : 5}%, set on the Plan page). 50 earns the same, 67 twice as much, 33 half. Sit at 50 and up, think twice from 40 to 49, walk below that. A table too big for your bankroll is scored on its safest bets and marked down by how far over your limit they run.</Info>
    </section>
  );
}

// ---------- a casino's score ----------
// A game written out in a scouting report ("Main floor: 8 decks, H17, DAS, $15–$2,500, about 20 tables, 1.5 decks cut
// off (…)") → the app's rule shape. Only lines that state decks, the soft-17 rule and both limits are used; side games
// and 6:5 tables are left out. A rule the line doesn't mention is taken as not offered.
export function reportGame(line) {
  const s = String(line || "");
  if (/6\s*:\s*5|6 to 5|spanish|free bet|switch|super fun|double exposure|video|electronic|stadium/i.test(s)) return null;
  const w = s.match(/\b(single|double)[- ]deck\b/i), d = w || s.match(/(?<![\d.])([12468])[- ]decks?\b(?!\s*cut)/i), h = s.match(/\b([HS])17\b/), lim = s.match(/\$(\d[\d,]*)\s*[–-]\s*\$(\d[\d,]*)/);
  if (!d || !h || !lim) return null;
  const decks = w ? (/single/i.test(w[1]) ? 1 : 2) : +d[1], min = +lim[1].replace(/,/g, ""), max = +lim[2].replace(/,/g, "");
  if (!(min > 0) || !(max >= min)) return null;
  const cut = s.match(/([\d.]+)\s*(?:of\s*\d\s*)?decks?\s*cut/i), pen = cut && +cut[1] > 0 && +cut[1] < decks ? Math.min(90, Math.max(50, Math.round(((decks - +cut[1]) / decks) * 20) * 5)) : PEN_GUESS[decks];
  const label = (s.match(/^([^:(,]{3,40}):/) || [])[1];
  return { label: label ? label.trim() : `${decks === 2 ? "Double deck" : decks === 1 ? "Single deck" : decks + " decks"}, ${h[1]}17`, min, max,
    rules: { decks, h17: h[1] === "H", das: /\bDAS\b/.test(s) && !/no DAS|NDAS/i.test(s), surrender: /surrender|\bLS\b/i.test(s) && !/no (late )?surrender/i.test(s), rsa: /resplit aces|\bRSA\b/i.test(s) && !/no resplit/i.test(s), pen,
      dbl: /double on 10\s*[–-]\s*11/i.test(s) ? "10-11" : /double on 9\s*[–-]\s*11/i.test(s) ? "9-11" : "any", ...(/no resplits?\b/i.test(s) ? { maxHands: 2 } : {}) } };
}
const PEN_GUESS = { 1: 50, 2: 60, 4: 70, 6: 75, 8: 75 }; // when a report doesn't say where the cut card goes
// The games known at a casino: the ones you saved there, and only when you have saved none, the scouting report's — its
// "best" game and every game line it spells out in full, so a cheaper main-floor table can win when the best rules sit
// on a table too big for your bankroll.
function gamesAt(c) {
  const mine = ((c.mark && c.mark.games) || []).filter((g) => g.rules);
  if (mine.length) return mine.map((g) => ({ label: g.label || "", rules: g.rules, min: g.min || "", max: g.max || "" }));
  const it = c.intel; if (!it) return [];
  const out = [], b = it.best;
  // a report that doesn't say how the dealer plays soft 17 is taken as the worse rule (hits)
  if (b && !b.bj65 && (b.decks || b.h17 != null)) out.push({ label: b.where || "Best game reported", rules: { decks: [1, 2, 4, 6, 8].includes(b.decks) ? b.decks : 6, h17: b.h17 != null ? !!b.h17 : true, das: b.das != null ? !!b.das : true, surrender: !!b.ls, rsa: !!b.rsa, pen: b.pen ? Math.min(90, Math.max(50, Math.round(b.pen / 5) * 5)) : PEN_GUESS[[1, 2, 4, 6, 8].includes(b.decks) ? b.decks : 6] }, min: b.min || it.min || "", max: b.max || "" });
  (Array.isArray(it.games) ? it.games : []).flatMap((line) => String(line).split(";")).forEach((line) => { const g = reportGame(line); if (g && !out.some((o) => +o.min === g.min && o.rules.decks === g.rules.decks && o.rules.h17 === g.rules.h17)) out.push(g); });
  return out.slice(0, 5);
}
const _sc = new Map(); // setup + games → the best game's result (null when the casino has no game to score)
const setupKey = (s) => JSON.stringify([s.bankroll, s.rorPct, s.minBet, s.maxBet, s.rules, s.seats, s.spotsMap, s.hphAuto, s.handsPerHour]);
// your usual game (the app's rules, your table min and max), scored the same way: every score is measured against it
// the same game with the bets that make risk of ruin as small as it can be: the bankroll plan scales these
const safeOf = (setup) => { const k = "safe" + setupKey(setup); if (!_sc.has(k)) { let r = null; try { r = scoreGame({ ...setup, rorPct: 1e-7 }, { rules: setup.rules, min: setup.minBet, max: setup.maxBet, seats: setup.seats }); } catch (_) {} _sc.set(k, r); } return _sc.get(k); };
const refOf = (setup) => { const k = "ref" + setupKey(setup); if (!_sc.has(k)) { let r = null; try { r = scoreGame(setup, { rules: setup.rules, min: setup.minBet, max: setup.maxBet, seats: setup.seats }); } catch (_) {} _sc.set(k, r); } return _sc.get(k); };
function scoreCasino(setup, c, peek) {
  const games = gamesAt(c); if (!games.length) return null;
  const k = setupKey(setup) + JSON.stringify(games);
  if (_sc.has(k) || peek) return _sc.get(k);
  if (_sc.size > 4000) _sc.clear();
  const ref = refOf(setup); let best = null;
  const mine = !!((c.mark && c.mark.games) || []).some((g) => g.rules);
  if (ref) games.forEach((g) => { const x = scoreGame(setup, g), sc = scoreFor(x, ref); if (!best || sc > best.score || (sc === best.score && x.ror < best.ror)) best = { ...x, score: sc, g, mine, n: games.length }; });
  _sc.set(k, best); return best;
}
export const scoreTone = (n) => (n >= 50 ? "var(--brass)" : n >= 40 ? "var(--ivory)" : "var(--rose)");
// Scores for a list of casinos. The optimizer runs once per game, so they are worked out a few at a time after the page
// has settled and kept; `get(c)` is undefined until that casino's turn has come. `over` lets a page pass the live
// bankroll and risk limit instead of the saved ones.
export function useCasinoScores(list, on = true, over) {
  const [base, setBase] = useState(null), [, bump] = useState(0), first = useRef(true);
  useEffect(() => { if (on) spreadSetup().then(setBase).catch(() => {}); }, [on]);
  const ob = over && over.bankroll, orr = over && over.rorPct;
  const setup = useMemo(() => (base ? { ...base, ...(ob > 0 ? { bankroll: ob } : {}), ...(orr > 0 ? { rorPct: orr } : {}) } : null), [base, ob, orr]);
  const ids = (list || []).map((c) => c.id).join(",");
  useEffect(() => {
    if (!setup || !on) return;
    const todo = (list || []).filter((c) => gamesAt(c).length && scoreCasino(setup, c, true) === undefined);
    if (_sc.has("ref" + setupKey(setup)) && !todo.length) return;
    let i = 0, id = setTimeout(function tick() {
      const t0 = performance.now();
      try { refOf(setup); safeOf(setup); while (i < todo.length && performance.now() - t0 < 14) scoreCasino(setup, todo[i++]); } catch (_) { i = todo.length; }
      bump((n) => n + 1); if (i < todo.length) id = setTimeout(tick, 40);
    }, first.current ? 700 : 80);
    first.current = false;
    return () => clearTimeout(id);
  }, [setup, ids, on]); // eslint-disable-line
  return { setup, ref: setup ? _sc.get("ref" + setupKey(setup)) : undefined, safe: setup ? _sc.get("safe" + setupKey(setup)) : undefined, get: (c) => (setup ? scoreCasino(setup, c, true) : undefined) };
}
export const wideScreen = () => { try { return window.matchMedia("(min-width:1024px)").matches; } catch (_) { return false; } };

// ---------- rotation ----------
const DAY = 864e5;
// Dates are whole local days (midnight), and days are added on the calendar, so a clock change never moves a date and
// a session logged yesterday is "yesterday" at any time of day.
const dayOf = (d) => { const [y, m, dd] = String(d).split("-").map(Number); return new Date(y, (m || 1) - 1, dd || 1).getTime(); };
const startOfDay = (t) => { const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); };
export const addDays = (t, n) => { const x = new Date(t); x.setDate(x.getDate() + Math.round(n)); return x.getTime(); };
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);
const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtWeekday = (t) => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const ago = (days) => (days <= 0 ? "today" : days === 1 ? "yesterday" : days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`);
const oneIn = (p) => (p < 0.005 ? "Almost never" : p > 0.5 ? `About ${Math.round(p * 10)} times in 10` : `About 1 time in ${Math.max(2, Math.round(1 / p))}`);
// Rest after a visit, from two numbers you can change on the Plan page: `base` (days after an ordinary visit) and `backed`
// (days after a back-off). Medium heat, being watched, or three visits in 30 days rests a casino three times the base;
// High heat six times; a second back-off at the same casino twice the back-off rest.
export const restSet = (r) => ({ base: r.base, warm: r.base * 3, hot: r.base * 6, busy: r.base * 3, backed: r.backed, backedAgain: r.backed * 2 });
// days a casino rests after a visit on day t (dates: every visit so far, as days, t included)
function restDays(c, t, dates, lastHeat, R) {
  const m = c.mark || {}, recent = dates.filter((d) => d <= t && daysBetween(d, t) <= 30).length;
  let days = R.base, why = "";
  if (m.heat === 2) { days = R.warm; why = "medium heat"; }
  if (lastHeat === "watched" && days < R.warm) { days = R.warm; why = "watched last visit"; }
  if (recent >= 3 && days < R.busy) { days = R.busy; why = `${recent} visits in 30 days`; }
  if (m.heat === 3) { days = R.hot; why = "high heat"; }
  return { days, why };
}
// `until` is the first day the casino can be played again
export function restOf(c, R) {
  const s = c.sess, m = c.mark || {}, dates = ((s && s.dates) || []).map(dayOf);
  const last = s && s.last ? dayOf(s.last) : null;
  if (m.status === "backed" || (s && s.backed)) {
    const on = [m.backedOn, s && s.backed].filter(Boolean).sort().pop(), from = on ? dayOf(on) : last;
    const n = Math.max(1, (s && s.backedN) || 0), days = n >= 2 ? R.backedAgain : R.backed;
    return { kind: "backed", from, until: from ? addDays(from, days) : null, last, dates, days, why: n >= 2 ? `backed off ${n} times` : "backed off" };
  }
  const { days, why } = last ? restDays(c, last, dates, s.lastHeat, R) : { days: 0, why: "" };
  return { kind: "rest", from: last, until: last ? addDays(last, days) : null, last, dates, days, why };
}
// days rested × 0.75 at a score of 0, × 1 at 50 (or unknown), × 1.25 at 100
const weightAt = (last, t, score) => ((last ? Math.max(0, daysBetween(last, t)) : 365) + 1) * (0.75 + (score == null ? 50 : score) / 200);
// The next n visits, `perWeek` a week from `today`: each goes to the ready casino with the best mix of rest and game,
// which then rests again. When nothing is ready the visit waits for the first casino to come back.
export function schedule(rows, today, R, perWeek, n, scoreOfC) {
  const st = rows.filter((r) => r.kind !== "backed" || r.until).map((r) => ({ r, last: r.last, dates: r.dates.slice(), until: r.until, back: r.kind === "backed" }));
  const out = [], gap = 7 / Math.max(1, perWeek); let d = 0;
  for (let i = 0; i < n && st.length; i++) {
    let t = addDays(today, Math.round(d)), cand = st.filter((s) => !s.until || s.until <= t), wait = false;
    if (!cand.length) { t = Math.min(...st.map((s) => s.until)); d = daysBetween(today, t); cand = st.filter((s) => s.until <= t); wait = true; }
    const pick = cand.reduce((a, b) => (weightAt(b.last, t, scoreOfC(b.r.c)) > weightAt(a.last, t, scoreOfC(a.r.c)) ? b : a));
    out.push({ t, c: pick.r.c, back: pick.back, wait });
    pick.last = t; pick.dates.push(t); pick.back = false;
    pick.until = addDays(t, restDays(pick.r.c, t, pick.dates, null, R).days);
    d += gap;
  }
  return out;
}
const milesBetween = (a, b) => { const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r; return Math.sqrt(x * x + y * y) * 3959; };

const planCss = `
.prow{display:grid;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 4px;border-radius:10px;transition:background .15s}
.prow+.prow{border-top:1px solid rgba(var(--fg),.06)}
button.prow:hover{background:rgba(var(--fg),.04)}
.phead{display:grid;gap:10px;padding:0 4px 6px;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line)}
.ptrack{position:relative;height:8px;border-radius:99px;background:rgba(var(--fg),.09);overflow:hidden}
.ptrack>i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:rgba(var(--fg),.5);transform-origin:0 50%}
.ptrack>i.ok{background:var(--brass)}
.ptrack>i.x{background:rgba(var(--neg),.75)}
.pnum{font-variant-numeric:tabular-nums;font-weight:600;font-size:12.5px;text-align:right;white-space:nowrap}
.pset{display:flex;flex-direction:column;gap:6px;min-width:0}
`;
function Step({ v, set, min, max, step = 1, f = String, label }) {
  return (
    <span className="flex items-center gap-2">
      <button type="button" className="stepbtn" onClick={() => set(Math.max(min, v - step))} disabled={v <= min} aria-label={`Less: ${label}`}>−</button>
      <span className="mono text-sm font-semibold text-center" style={{ minWidth: 44, color: "var(--ivory)" }}>{f(v)}</span>
      <button type="button" className="stepbtn" onClick={() => set(Math.min(max, v + step))} disabled={v >= max} aria-label={`More: ${label}`}>+</button>
    </span>
  );
}
const Tile = ({ k, v, sub, tone }) => (
  <div className="rounded-2xl px-3.5 py-3 h-full" style={{ background: "rgba(var(--fg),.035)", border: "1px solid rgba(var(--fg),.05)" }}>
    <div className="text-[10.5px] font-semibold uppercase" style={{ color: "var(--muted)", letterSpacing: ".08em" }}>{k}</div>
    <div className="mono text-lg font-semibold mt-0.5 truncate" style={{ color: tone || "var(--ivory)" }}>{v}</div>
    {sub && <div className="text-[11px] leading-snug" style={{ color: "var(--muted)" }}>{sub}</div>}
  </div>);
// the three numbers every casino row carries: score, risk of ruin, dollars an hour
function Nums({ x, cap }) {
  const dash = <span className="pnum" style={{ color: "var(--muted)" }}>—</span>;
  if (!x) return <>{dash}{dash}{dash}</>;
  return (<>
    <span className="pnum" style={{ color: scoreTone(x.score) }}>{x.score}</span>
    <span className="pnum" style={{ color: x.loses ? "var(--muted)" : x.ror > cap * 1.001 ? "var(--rose)" : "var(--ivory-d)" }}>{x.loses ? "—" : pct(x.ror, x.ror < 0.0095 ? 1 : 0)}</span>
    <span className="pnum" style={{ color: "var(--ivory-d)" }}>{x.ev > 0 ? money(x.ev) : "—"}</span>
  </>);
}
const NUMCOLS = "34px 40px 44px";

function useRotation(all, prefs, bankroll) {
  const now = useMemo(() => Date.now(), []), today = startOfDay(now);
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
  const sc = useCasinoScores(scoreList, true, { bankroll, rorPct: prefs.risk * 100 }), scoreN = (c) => { const x = sc.get(c); return x ? x.score : null; };
  const isReady = (r) => (r.kind !== "backed" || !!r.until) && (!r.until || r.until <= today);
  const ready = rows.filter(isReady).sort((a, b) => weightAt(b.last, today, scoreN(b.c)) - weightAt(a.last, today, scoreN(a.c)));
  const resting = rows.filter((r) => !isReady(r)).sort((a, b) => (a.until || Infinity) - (b.until || Infinity));
  const plan = schedule(rows, today, R, prefs.perWeek, 6, scoreN);
  const visits = {}; plan.forEach((v) => (visits[v.c.id] = [...(visits[v.c.id] || []), v.t]));
  // where your hours went over the last 90 days
  const h90 = []; rows.forEach((r) => { const h = ((r.c.sess && r.c.sess.recs) || []).filter((x) => daysBetween(dayOf(x.date), today) <= 90).reduce((s, x) => s + x.h, 0); if (h > 0) h90.push([r.c, h]); });
  h90.sort((a, b) => b[1] - a[1]);
  const tot = h90.reduce((s, x) => s + x[1], 0), heavy = h90.length > 0 && rows.length > 1 && tot >= 6 && h90[0][1] / tot > 0.5 ? h90[0] : null, share = Object.fromEntries(h90.map(([c, h]) => [c.id, h / tot]));
  const scout = near.map((x) => ({ ...x, s: sc.get(x.c) })).filter((x) => x.s && x.s.score >= 40).sort((a, b) => b.s.score - a.s.score || a.mi - b.mi).slice(0, 5);
  return { now, today, R, rows, sc, isReady, ready, resting, plan, visits, heavy, tot, share, scout, cap: prefs.risk };
}
function Rotation({ rot, prefs, setPrefs, onOpen }) {
  const { now, today, R, rows, sc, isReady, ready, resting, plan, heavy, tot, share, scout, cap } = rot;
  const setRest = (k, v) => setPrefs({ rest: { ...prefs.rest, [k]: v } });
  const numHead = <><span className="text-right">Score</span><span className="text-right">Risk</span><span className="text-right">$/hr</span></>;
  if (!rows.length) return <section className="card p-5 mb-4"><div className="eyebrow mb-1">Where to play</div><p className="text-sm" style={{ color: "var(--ivory-d)" }}>Nothing to plan yet. Log a session on the Sessions page, or mark a casino as "been" on the Casinos page, and this fills in: where to play next, when each casino is safe to go back to, and what each one is worth to you.</p></section>;
  return (<>
    <section className="card p-5 mb-4">
      <div className="eyebrow">Next visits</div>
      <p className="text-xs mt-0.5 mb-3" style={{ color: "var(--muted)" }}>Where to play and when, at {prefs.perWeek} session{prefs.perWeek === 1 ? "" : "s"} a week. Click a casino for the details.</p>
      {heavy && <p className="text-[11.5px] mb-2" style={{ color: "var(--neg-l)" }}>{Math.round((100 * heavy[1]) / tot)}% of your last 90 days' hours were at {heavy[0].name}. This plan spreads them out.</p>}
      <div className="phead" style={{ gridTemplateColumns: `84px minmax(0,1fr) ${NUMCOLS}` }}><span>When</span><span>Casino</span>{numHead}</div>
      {plan.map((v, i) => { const x = sc.get(v.c), topScore = Math.max(0, ...plan.map((q) => (sc.get(q.c) || {}).score || 0)), note = v.back ? "first visit since the back-off — keep it short" : x && x.loses ? "no winning spread here — skip it" : x && x.score < 40 && topScore >= 50 ? "much weaker than your other casinos" : v.wait ? "nothing is ready sooner" : ""; return (
        <button key={i} className="prow" style={{ gridTemplateColumns: `84px minmax(0,1fr) ${NUMCOLS}` }} onClick={() => onOpen(v.c)}>
          <span className="mono text-xs" style={{ color: i === 0 ? "var(--brass)" : "var(--ivory-d)" }}>{v.t <= today ? "Today" : fmtWeekday(v.t)}</span>
          <span className="min-w-0"><span className="block text-sm font-semibold truncate" style={{ color: i === 0 ? "var(--brass)" : "var(--ivory)" }}>{v.c.name}</span>{note && <span className="block text-[11px] truncate" style={{ color: note === "nothing is ready sooner" ? "var(--muted)" : "var(--neg-l)" }}>{note}</span>}</span>
          <Nums x={x} cap={cap} />
        </button>); })}
      <p className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>Log each session after you play and the plan moves on by itself.</p>
    </section>
    <section className="card p-5 mb-4">
      <div className="eyebrow">Your casinos</div>
      <p className="text-xs mt-0.5 mb-3" style={{ color: "var(--muted)" }}>What each one is worth to you, and when it's safe to go back.</p>
      <div className="phead" style={{ gridTemplateColumns: `minmax(0,1fr) ${NUMCOLS} 92px` }}><span>Casino</span>{numHead}<span className="text-right">Rested</span></div>
      {[...ready, ...resting].map((r) => { const rd = isReady(r), frac = rd ? 1 : r.until && r.from ? Math.max(0.04, Math.min(0.96, (now - r.from) / Math.max(DAY, r.until - r.from))) : 0.04, sh = share[r.c.id]; return (
        <button key={r.c.id} className="prow" style={{ gridTemplateColumns: `minmax(0,1fr) ${NUMCOLS} 92px` }} onClick={() => onOpen(r.c)}>
          <span className="min-w-0"><span className="block text-sm font-semibold truncate" style={{ color: "var(--ivory)" }}>{r.c.name}</span><span className="block text-[11px] truncate" style={{ color: "var(--muted)" }}>{r.last ? ago(daysBetween(r.last, today)) : "no sessions"}{sh ? ` · ${Math.round(sh * 100)}% of hours` : ""}{r.why ? ` · ${r.why}` : ""}</span></span>
          <Nums x={sc.get(r.c)} cap={cap} />
          <span className="min-w-0"><span className="block text-[11px] font-semibold text-right mb-1" style={{ color: rd ? "var(--brass)" : r.kind === "backed" ? "var(--rose)" : "var(--ivory-d)" }}>{rd ? "Ready" : r.until ? `Back ${fmtDay(r.until)}` : "Backed off"}</span>
            <span className="ptrack block" aria-hidden="true"><i className={"barx " + (rd ? "ok" : r.kind === "backed" ? "x" : "")} style={{ width: `${frac * 100}%` }} /></span></span>
        </button>); })}
      <Info label="What the columns mean">
        <b>Score</b>: how much the casino's best game is worth to you against your usual game. 50 is the same, 67 twice as much, 33 half. It counts dollars an hour and marks a table down when it runs over your risk limit. <b>Risk</b>: the risk of ruin there, meaning the chance of losing your whole bankroll if you kept playing that table's best bets and never cut them. Red is over your limit. <b>$/hr</b>: what those bets earn on average. All three assume you play every hand, and use the games you saved for that casino, or its scouting report when you haven't saved any. <b>Rested</b>: the bar fills as the casino rests. Full and green is ready; red is a back-off counting down.
      </Info>
      <Info label="Change the rest days">
        <div className="space-y-2.5 mb-3 mt-1">
          <div className="flex items-center justify-between gap-3"><span className="text-sm">Rest after a visit</span><Step v={prefs.rest.base} set={(v) => setRest("base", v)} min={1} max={30} f={(v) => `${v} d`} label="rest after a visit" /></div>
          <div className="flex items-center justify-between gap-3"><span className="text-sm">Rest after a back-off</span><Step v={prefs.rest.backed} set={(v) => setRest("backed", v)} min={30} max={365} step={15} f={(v) => `${v} d`} label="rest after a back-off" /></div>
        </div>
        A casino rests {R.base} days after a visit; {R.warm} days if you rated its heat Medium, were watched last time, or went 3 or more times in 30 days; {R.hot} days at High heat. A back-off rests it {R.backed} days, or {R.backedAgain} days once you've been backed off there twice. Each visit goes to the ready casino with the most days rested, nudged by score: a great game counts about like a quarter more rest.
      </Info>
    </section>
    {scout.length > 0 && <section className="card p-5 mb-4">
      <div className="eyebrow">Worth scouting</div>
      <p className="text-xs mt-0.5 mb-3" style={{ color: "var(--muted)" }}>The best reported games near where you play that aren't in your rotation yet.</p>
      <div className="phead" style={{ gridTemplateColumns: `minmax(0,1fr) ${NUMCOLS}` }}><span>Casino</span>{numHead}</div>
      {scout.map((x) => (
        <button key={x.c.id} className="prow" style={{ gridTemplateColumns: `minmax(0,1fr) ${NUMCOLS}` }} onClick={() => onOpen(x.c)}>
          <span className="min-w-0"><span className="block text-sm font-semibold truncate" style={{ color: "var(--ivory)" }}>{x.c.name}</span><span className="block text-[11px] truncate" style={{ color: "var(--muted)" }}>{[x.c.city, x.c.st].filter(Boolean).join(", ")} · about {Math.round(x.mi / 5) * 5} mi · from ${x.s.mn}</span></span>
          <Nums x={x.s} cap={cap} />
        </button>))}
      <p className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>Miles are straight-line from the middle of the casinos you play. Reports can be out of date, so check the table before you sit.</p>
    </section>}
  </>);
}

// ---------- bankroll growth ----------
// The planner's own spread — every hand played, the bets that keep risk of ruin lowest at your usual game (`safeOf`) —
// scaled to each table minimum (every bet × table min ÷ your min): EV grows by that factor and variance by its square,
// so the bankroll a risk of ruin needs is k · variance · −ln(risk) / (2 · EV). That is the smallest bankroll each table
// can be played on at the limit.
const TABLE_MINS = [5, 10, 15, 25, 50, 75, 100, 200, 500];
const PLAN_RISKS = [[0.02, "2%"], [0.05, "5%"], [0.1, "10%"], [0.2, "20%"]];
const HORIZONS = [[26, "6 months"], [52, "1 year"], [104, "2 years"]];
// seeded so the page shows the same picture every time the inputs are the same
function rng(seed) { let a = seed >>> 0; const u = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; return { u, z: () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()) }; }
// The tables your bankroll can be played on. `safe` is the usual game's lowest-risk every-hand spread (from scoreGame):
// scaled to another table minimum, EV grows with the minimum and variance with its square, so the smallest bankroll a
// table can be played on at a risk of ruin is need = (m ÷ min) · sd² · −ln(risk) ÷ (2 · EV), and the risk has doubled
// when the bankroll has fallen to need · ln(2·risk) ÷ ln(risk).
export function growthModel(safe, bankroll, risk) {
  if (!safe || safe.loses || !(safe.ev > 0) || !(safe.sd > 0) || !(bankroll > 0)) return null;
  const minBet = safe.mn, top = Math.max(0, ...COUNTS.map((c) => +safe.bets[c] || 0));
  const per = (safe.sd * safe.sd * -Math.log(risk)) / (2 * safe.ev), f = Math.log(Math.min(0.999, 2 * risk)) / Math.log(risk);
  const mins = [...new Set([...TABLE_MINS, minBet])].sort((a, b) => a - b), at = mins.indexOf(minBet), has = bankroll * 1.0005; // a hair of slack so "exactly enough" counts
  const mk = (m) => { const k = m / minBet; return { m, k, need: per * k, down: per * k * f, ev: safe.ev * k, sd: safe.sd * k, top: Math.round((top * k) / 5) * 5 }; };
  let from = at; while (from > 0 && per * (mins[from] / minBet) > has) from--; // the biggest table you qualify for, if it is below yours
  const lv = mins.slice(from).map(mk);
  // from where you stand: the expected hours to each bigger table, and the chance of getting there before going broke,
  // playing each table until the next one's bankroll is reached (a drifting walk between two walls)
  let b = bankroll, hrs = 0, odds = 1, play = lv.filter((l) => l.need <= has).pop() || null;
  lv.forEach((l) => {
    if (l.need <= has) { l.state = l === play ? "now" : "ok"; return; }
    if (!play) { l.state = "short"; return; }
    const th = (2 * play.ev) / (play.sd * play.sd);
    odds *= (1 - Math.exp(-th * b)) / (1 - Math.exp(-th * l.need)); l.chance = odds;
    hrs += (l.need - b) / play.ev; l.hrs = hrs; l.state = "later"; b = l.need; play = l;
  });
  return { lv, cur: lv.filter((l) => l.state === "now").pop() || null, usual: minBet };
}
// 3,000 bankroll paths over `hours`: play the biggest table the bankroll covers, move up when it reaches the next
// table's bankroll, drop back when it falls below `down` for the table being played. Steps are an hour or less of play
// (up to 480 of them); inside each step the lowest and highest point of the path are drawn from their exact
// distributions, so going broke and touching a target between two steps are both counted. Kept at up to 120 checkpoints:
// the 10th / 50th / 90th percentile of the bankroll, and every path's highest point so far (for any target).
export function growthSim({ B, lv, hours, N = 3000, seed = 20261116 }) {
  const steps = Math.max(60, Math.min(480, Math.ceil(hours))), stride = Math.max(1, Math.round(steps / 120)), dt = hours / steps, sq = Math.sqrt(dt), { u, z } = rng(seed);
  let s0 = 0; lv.forEach((l, i) => { if (l.need <= B * 1.0005) s0 = i; });
  const cps = []; for (let i = stride; i < steps; i += stride) cps.push(i); cps.push(steps);
  const col = [new Float32Array(N).fill(B), ...cps.map(() => new Float32Array(N))], top = cps.map(() => new Float32Array(N)), dds = new Float32Array(N), end = lv.map(() => 0);
  let bust = 0, below = 0;
  for (let p = 0; p < N; p++) {
    let b = B, l = s0, dead = false, hi = B, pk = B, dd = 0, c = 0;
    for (let i = 1; i <= steps; i++) {
      if (!dead) {
        const a = b, s = lv[l].sd * sq; b = a + lv[l].ev * dt + s * z();
        const span = (b - a) * (b - a), lowest = (a + b - Math.sqrt(span - 2 * s * s * Math.log(1 - u()))) / 2, highest = (a + b + Math.sqrt(span - 2 * s * s * Math.log(1 - u()))) / 2;
        if (pk - lowest > dd) dd = Math.min(pk, pk - lowest);
        if (lowest <= 0) { b = 0; dead = true; if (a > hi) hi = a; }
        else {
          if (highest > hi) hi = highest; if (b > pk) pk = b;
          while (l < lv.length - 1 && b >= lv[l + 1].need) l++;
          while (l > 0 && b < lv[l].down) l--;
        }
      }
      if (i === cps[c]) { col[c + 1][p] = b; top[c][p] = hi; c++; }
    }
    dds[p] = dd; if (dead) bust++; if (b < B) below++; end[l]++;
  }
  const q = (a, f) => a[Math.min(N - 1, Math.floor(f * N))];
  const pts = col.map((a, i) => { const x = Float32Array.from(a).sort(); return { h: i === 0 ? 0 : cps[i - 1] * dt, lo: q(x, 0.1), mid: q(x, 0.5), hi: q(x, 0.9) }; });
  dds.sort();
  return { pts, s0, N, top, cpH: cps.map((i) => i * dt), ddMid: q(dds, 0.5), ddBad: q(dds, 0.9), bust: bust / N, below: below / N, end: end.map((n) => n / N) };
}
// the chance of touching `goal` within the simulated span, and the hours by which half the paths have (null if fewer do)
export function goalStats(sim, goal) {
  const frac = (a) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] >= goal) n++; return n / sim.N; };
  const p = frac(sim.top[sim.top.length - 1]); let med = null;
  if (p >= 0.5) for (let c = 0; c < sim.top.length; c++) if (frac(sim.top[c]) >= 0.5) { med = sim.cpH[c]; break; }
  return { p, med };
}
function GrowthChart({ sim, B, lv, flat, hours, whenOf }) {
  const W = 520, H = 220, P = { l: 44, r: 62, t: 10, b: 22 }, pts = sim.pts;
  const hiV = Math.max(...pts.map((p) => p.hi), B) * 1.04, loV = Math.min(...pts.map((p) => p.lo), B) * 0.96;
  const x = (h) => P.l + (h / hours) * (W - P.l - P.r), y = (v) => H - P.b - ((v - loV) / Math.max(1, hiV - loV)) * (H - P.t - P.b);
  const line = (k) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.h).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const band = line("hi") + pts.slice().reverse().map((p) => `L${x(p.h).toFixed(1)},${y(p.lo).toFixed(1)}`).join("") + "Z";
  // table lines that fit the chart, never two labels on top of each other
  const marks = []; lv.forEach((l, i) => { if (i > sim.s0 && l.need > loV && l.need < hiV && marks.every((m) => Math.abs(y(m.need) - y(l.need)) > 13)) marks.push(l); });
  const last = pts[pts.length - 1], ticks = [0, 0.5, 1].map((f) => f * hours);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" role="img" aria-label={`Bankroll over the next ${Math.round(hours)} hours of play: typically ${shortMoney(last.mid)}, 8 times in 10 between ${shortMoney(last.lo)} and ${shortMoney(last.hi)}`}>
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
function useGrowth(safe, bankroll, prefs) {
  const risk = prefs.risk, hpw = prefs.perWeek * prefs.sessHours, hours = prefs.weeks * hpw;
  const whenOf = (h) => { const w = h / hpw; return w > 520 ? "10+ years" : new Date(addDays(Date.now(), w * 7)).toLocaleDateString(undefined, { month: "short", year: "numeric" }); };
  const model = useMemo(() => growthModel(safe, bankroll, risk), [safe, risk, bankroll]);
  // the 3,000 futures are the heavy part: they follow a moment behind, and typing a target never re-deals them
  const sim = useDeferred(model && hours > 0 ? JSON.stringify([bankroll, risk, hours, model.lv.map((l) => [l.m, Math.round(l.ev * 100), Math.round(l.sd)])]) : null, () => growthSim({ B: bankroll, lv: model.lv, hours }), true);
  const goal = +prefs.goal > bankroll ? +prefs.goal : bankroll * 2;
  const goalS = useMemo(() => (sim ? goalStats(sim, goal) : null), [sim, goal]);
  return { risk, hpw, hours, whenOf, model, goal, goalS, sim: sim && model && sim.end.length === model.lv.length ? sim : null, loading: safe === undefined || (!!model && !sim) };
}
function Growth({ gr, bankroll, prefs, setPrefs, go }) {
  const [more, setMore] = useState(false);
  const { risk, hours, whenOf, model, goal, goalS, sim, loading } = gr;
  if (!model || !sim) return <section className="card p-5 mb-4"><div className="eyebrow mb-2">Growing your bankroll</div><p className="text-sm" style={{ color: "var(--ivory-d)" }}>{loading ? "Working it out…" : bankroll > 0 ? "No spread wins at your usual game when every hand is played, so there's nothing to grow into. Check the game rules and table limits." : "Set your bankroll on the Bet spread page first."} {!loading && <button className="font-semibold" style={{ color: "var(--brass)" }} onClick={() => go("calc")}>Open Bet spread ›</button>}</p></section>;
  const { lv, cur, usual } = model, start = lv[sim.s0], last = sim.pts[sim.pts.length - 1], flatEnd = bankroll + start.ev * hours, gain = last.mid - flatEnd;
  const shown = lv.filter((l, i) => i <= sim.s0 + 4), endTop = sim.end.reduce((b, p, i) => (p > sim.end[b] ? i : b), 0), span = HORIZONS.find((h) => h[0] === prefs.weeks)[1];
  return (<>
    <section className="card p-5 mb-4">
      <div className="flex items-center justify-between gap-3">
        <div className="eyebrow">Growing your bankroll</div>
        <Seg small value={prefs.weeks} options={HORIZONS} onChange={(v) => setPrefs({ weeks: v })} style={{ width: 240 }} />
      </div>
      <p className="text-xs mt-1.5 mb-3" style={{ color: "var(--muted)" }}>{cur ? <>Your {money(bankroll)} covers <b style={{ color: "var(--brass)" }}>${cur.m} tables</b> at {pct(risk, 0)} risk{cur.m < usual ? <>, not the ${usual} tables you usually play</> : ""}.</> : <>Your {money(bankroll)} is short of even ${lv[0].m} tables at {pct(risk, 0)} risk, so the plan starts there anyway.</>} Here is where it's likely to go over {span}, moving up a table each time the bankroll allows.</p>
      <GrowthChart sim={sim} B={bankroll} lv={lv} flat={start.ev} hours={hours} whenOf={whenOf} />
      <div className="flex gap-4 text-[11px] mt-1 mb-3" style={{ color: "var(--muted)" }}><span><span style={{ color: "var(--brass)" }}>━</span> typical</span><span><span style={{ color: "rgba(var(--acc),.5)" }}>█</span> 8 times in 10</span><span>┅ staying at ${start.m} tables</span></div>
      <div className="grid grid-cols-3 gap-2">
        <Tile k="Typical bankroll" v={shortMoney(last.mid)} sub={`after ${span}. 8 times in 10: ${shortMoney(last.lo)} to ${shortMoney(last.hi)}.`} tone="var(--brass)" />
        <Tile k="Chance of a loss" v={`${Math.round(sim.below * 100)}%`} sub={`${oneIn(sim.below)} you have less than today's ${shortMoney(bankroll)} after ${span}.`} tone={sim.below > 0.3 ? "var(--neg-l)" : undefined} />
        <Tile k="Going broke" v={sim.bust < 0.005 ? "<1%" : `${Math.round(sim.bust * 100)}%`} sub={`chance of losing it all within ${span}, dropping back when the plan says to.`} tone={sim.bust > 0.05 ? "var(--neg-l)" : undefined} />
        {more && <>
          <Tile k="Moving up adds" v={gain > 50 ? sgnMoney(gain) : "Not yet"} sub={gain > 50 ? `to your typical bankroll, against staying at $${start.m} tables the whole time.` : `In ${span} you rarely get far past the next table. Give it longer.`} />
          <Tile k="Table by then" v={`$${lv[endTop].m}`} sub={`the most likely table you're playing, ${Math.round(sim.end[endTop] * 100)}% of the time.`} />
          <Tile k="Worst dip" v={shortMoney(sim.ddMid)} sub={`biggest drop from a high point to expect. 1 time in 10 it passes ${shortMoney(sim.ddBad)}.`} />
        </>}
      </div>
      <button type="button" onClick={() => setMore(!more)} className="text-xs font-semibold mt-3" style={{ color: "var(--brass)" }} aria-expanded={more}>{more ? "Fewer stats ▴" : "More stats — moving up, table by then, worst dip ▾"}</button>
      <div className="flex items-center justify-between gap-3 mt-4 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ivory-d)" }}>Target
          <span className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 mono" style={{ color: "var(--muted)" }}>$</span><input className="in mono" style={{ paddingLeft: 24, width: 120, height: 38 }} type="number" inputMode="numeric" min="0" placeholder={String(Math.round(bankroll * 2))} value={prefs.goal} onChange={(e) => setPrefs({ goal: e.target.value })} aria-label="Target bankroll" /></span></label>
        <span className="text-xs text-right" style={{ color: "var(--ivory-d)" }}><span className="mono font-semibold" style={{ color: "var(--ivory)" }}>{Math.round(goalS.p * 100)}%</span> chance of reaching {shortMoney(goal)} within {span}{goalS.med != null ? <>, typically by <span className="mono">{whenOf(goalS.med)}</span></> : ""}</span>
      </div>
      <Info label="Where these numbers come from">The plan plays every hand with the bets that keep risk lowest at your usual game, scaled to each table size, so "Move up" is the smallest bankroll each table can be played on at your limit. "Move up" and "Drop at" are exact for those bets. The chart deals 3,000 possible futures at your pace ({prefs.perWeek} × {prefs.sessHours} hours a week): the line is the middle one, the band holds 8 in 10, and the dashed line is the typical result if you never moved up. Luck can make it much faster or slower. Risk of ruin assumes you could always make the next bet, so with a bankroll of only a few big bets the real risk runs a little higher.</Info>
    </section>
    <section className="card p-5 mb-4">
      <div className="eyebrow">When to move up, when to drop back</div>
      <p className="text-xs mt-0.5 mb-3" style={{ color: "var(--muted)" }}>Move to the next table when your bankroll reaches "Move up". If it falls to "Drop at", go back down a table.</p>
      <div className="phead" style={{ gridTemplateColumns: "44px minmax(0,1fr) 46px 58px 58px minmax(0,1.5fr)", padding: "0 0 6px" }}><span>Table</span><span>Bets</span><span className="text-right">$/hr</span><span className="text-right">Move up</span><span className="text-right">Drop at</span><span className="text-right">Getting there</span></div>
      {shown.map((l, i) => (
        <div key={l.m} className="grid items-center py-2" style={{ gridTemplateColumns: "44px minmax(0,1fr) 46px 58px 58px minmax(0,1.5fr)", gap: 10, borderBottom: "1px solid var(--line)", opacity: l.state === "ok" ? 0.6 : 1 }}>
          <span className="mono text-sm font-semibold" style={{ color: l.state === "now" ? "var(--brass)" : "var(--ivory)" }}>${l.m}</span>
          <span className="mono text-xs truncate" style={{ color: "var(--ivory-d)" }}>${l.m}–{shortMoney(l.top)}</span>
          <span className="mono text-xs text-right">{money(l.ev)}</span>
          <span className="mono text-xs text-right">{shortMoney(l.need)}</span>
          <span className="mono text-xs text-right" style={{ color: "var(--muted)" }}>{i === 0 ? "—" : shortMoney(l.down)}</span>
          <span className="text-xs text-right" style={{ color: l.state === "now" ? "var(--brass)" : l.state === "short" ? "var(--neg-l)" : "var(--ivory-d)" }}>
            {l.state === "now" ? "You're here" : l.state === "ok" ? "Covered" : l.state === "short" ? `${shortMoney(l.need - bankroll)} short` : <>{whenOf(l.hrs)} · {Math.round(l.hrs).toLocaleString()} h · <span className="mono">{Math.round(l.chance * 100)}%</span></>}
          </span>
        </div>))}
      <Info label="How to read this">"Bets" is the smallest and biggest bet at that table. "Move up" is the bankroll those bets need to keep risk of ruin at {pct(risk, 0)}; "Drop at" is where that risk has doubled, so a bad run sends you back a table instead of digging deeper. "Getting there" is the expected date at your pace, the hours of play it takes, and the chance of reaching that row without going broke on the way.</Info>
    </section>
  </>);
}

// ---------- a casino's details, as a pop-up on the Plan page ----------
function CasinoPop({ c, rot, prefs, onClose, onCasinos }) {
  const { today, rows, sc, isReady, visits, cap } = rot, row = rows.find((x) => x.c.id === c.id), x = sc.get(c), setup = sc.setup, ref = sc.ref, se = c.sess;
  const rd = row && isReady(row), planned = (visits[c.id] || []).map(fmtWeekday);
  // the same bets dealt at this table and at your usual one: what the rules and penetration alone are worth
  const gameX = useMemo(() => {
    if (!x || !setup || !ref || ref.loses) return null;
    try {
      const ev = (R) => compute({ bankroll: setup.bankroll, handsPerHour: 100, bets: ref.bets, cal: calFor({ ...DEFAULT_RULES, ...R }, setup.seats || 4), spotsMap: setup.spotsMap }).evHand;
      const a = ev(x.g.rules), b = ev(setup.rules); return b > 0 ? a / b - 1 : null;
    } catch (_) { return null; }
  }, [x, setup, ref]);
  const units = x && setup ? Math.round(setup.bankroll / x.mn) : null, topBet = x ? Math.max(0, ...COUNTS.map((k) => +x.bets[k] || 0)) : 0;
  const [verdict, why] = x ? verdictOf(x, x.score) : ["", ""];
  const cash = upTo50(cashFor(x, prefs.sessHours));
  const over = x && !x.loses && x.ror > cap * 1.001, needB = over && x.ror < 1 ? (setup.bankroll * Math.log(cap)) / Math.log(x.ror) : 0;
  const Fact = ({ k, v, sub, tone }) => <div className="flex items-start justify-between gap-4 py-2.5" style={{ borderTop: "1px solid var(--line)" }}><div className="min-w-0"><div className="text-sm" style={{ color: "var(--ivory)" }}>{k}</div><div className="text-[11.5px] leading-snug" style={{ color: "var(--muted)" }}>{sub}</div></div><div className="mono text-sm font-semibold text-right whitespace-nowrap" style={{ color: tone || "var(--ivory)" }}>{v}</div></div>;
  return (
    <Sheet title={c.name} onClose={onClose}>
      <p className="text-xs -mt-2 mb-3" style={{ color: "var(--muted)" }}>{[c.city, c.st].filter(Boolean).join(", ")}</p>
      <div className="rounded-xl px-4 py-3 mb-3" style={{ background: "rgba(var(--fg),.035)" }}>
        <div className="text-sm font-semibold" style={{ color: !row ? "var(--ivory)" : rd ? "var(--brass)" : row.kind === "backed" ? "var(--rose)" : "var(--ivory)" }}>{!row ? "Not in your rotation yet" : rd ? "Ready to play" : row.until ? `Resting until ${fmtWeekday(row.until)}` : "Backed off"}</div>
        <div className="text-xs mt-0.5" style={{ color: "var(--ivory-d)" }}>
          {!row ? "You haven't logged a session here. Scout it, log the session, and it joins the rotation." : <>{row.last ? `Last visit ${ago(daysBetween(row.last, today))}.` : "No sessions logged."}{!rd && row.days ? ` It rests ${row.days} days${row.why ? ` (${row.why})` : ""}.` : ""}{planned.length ? ` Planned: ${planned.join(", ")}.` : rd ? "" : " Not in the next six visits."}</>}
        </div>
      </div>
      {x ? <>
        <div className="flex items-center gap-4 mb-1">
          <div className="mono font-semibold leading-none" style={{ fontSize: 40, color: scoreTone(x.score) }}>{x.score}</div>
          <div className="min-w-0"><div className="text-base font-semibold" style={{ color: scoreTone(x.score) }}>{verdict}</div><div className="text-xs" style={{ color: "var(--ivory-d)" }}>{why} A score of 50 is your usual game.</div></div>
        </div>
        <div className="mt-3">
          <Fact k="What it earns you" v={x.ev > 0 ? `${money(x.ev)}/hr` : "—"} sub={x.ev > 0 ? `On average, playing every hand with the ${over ? "safest" : "best"} bets your ${shortMoney(setup.bankroll)} allows here.${ref && ref.ev > 0 ? ` Your usual game earns ${money(ref.ev)}/hr the same way.` : ""}` : "No spread wins here when every hand is played."} />
          {!x.loses && <Fact k="Risk of ruin" v={pct(x.ror, x.ror < 0.0095 ? 1 : 0)} tone={over ? "var(--rose)" : undefined} sub={over ? `The chance of losing your whole bankroll if you kept playing these bets. That is over your ${pct(cap, 0)} limit even with the safest bets here${needB > 0 ? `: it takes about ${shortMoney(needB)} to play this table at ${pct(cap, 0)}` : ""}.` : `The chance of losing your whole bankroll if you kept playing these bets and never cut them. Inside your ${pct(cap, 0)} limit.`} />}
          {gameX != null && <Fact k="How good the game is" v={`${gameX >= 0 ? "+" : "−"}${Math.abs(Math.round(gameX * 100))}%`} sub={`Rules and penetration alone: the same bets earn this much ${gameX >= 0 ? "more" : "less"} here than at your usual table.`} />}
          <Fact k="How it fits your bankroll" v={`${units} bets`} tone={over ? "var(--rose)" : undefined} sub={`Your bankroll is ${units} of this table's $${x.mn} minimum bets. ${over ? (needB > 0 ? `Playing every hand here at your limit takes about ${Math.round(needB / x.mn).toLocaleString()} (${shortMoney(needB)}), so it is too big for now.` : "That is too few for this table at your limit.") : topBet > x.mn ? `That is enough to spread $${x.mn}–$${topBet} (1 to ${Math.round((topBet / x.mn) * 10) / 10}) inside your limit.` : "Inside your limit, but only with flat minimum bets."}`} />
          {x.ev > 0 && <Fact k={`A ${prefs.sessHours}-hour session`} v={sgnMoney(x.ev * prefs.sessHours)} sub={`On average. Bring about ${money(cash)}: that covers 19 sessions in 20 without running out.`} />}
          <Fact k="The game scored" v={rulesShort({ ...DEFAULT_RULES, ...x.g.rules })} sub={`${x.g.label ? x.g.label + ", " : ""}$${x.mn}–$${x.mx}. ` + (x.mine ? `From what you saw and saved here${x.n > 1 ? ` (the best of your ${x.n} games for you)` : ""}.` : `From the scouting report${c.intel && c.intel.asOf ? ` (as of ${c.intel.asOf})` : ""}${x.n > 1 ? `, the best for you of the ${x.n} games it lists` : ""}. Save the game you see there on the Casinos page and the score uses yours instead.`)} />
        </div>
        {x.ev > 0 && <><div className="eyebrow mt-3 mb-1.5" style={{ fontSize: 9.5 }}>{over ? "Safest bets here, by true count" : "Best bets here, by true count"}</div>
          <div className="flex flex-wrap gap-1.5">{spreadLine(x.bets).map(([k, v]) => <span key={k} className="rounded-lg px-2 py-1 text-[11px]" style={{ background: "rgba(var(--fg),.05)", color: "var(--ivory-d)" }}><span className="mono" style={{ color: "var(--muted)" }}>{k}</span> <span className="mono font-semibold" style={{ color: "var(--ivory)" }}>{v}</span></span>)}</div></>}
      </> : <p className="text-sm mb-1" style={{ color: "var(--ivory-d)" }}>{x === undefined && gamesAt(c).length ? "Working out the score…" : "No score yet: there's no game saved here and no scouting report. Save the game you see on the Casinos page and it gets one."}</p>}
      {se && se.n > 0 && <div className="mt-3"><Fact k="Your record here" v={sgnMoney(se.net)} tone={se.net < 0 ? "var(--neg-l)" : undefined} sub={`${se.n} session${se.n === 1 ? "" : "s"} · ${Math.round(se.h * 10) / 10} hours · ${sgnMoney(se.h > 0 ? se.net / se.h : 0)}/hr${se.backedN ? ` · backed off ${se.backedN === 1 ? "once" : se.backedN + " times"}` : ""}`} /></div>}
      <div className="text-center mt-4"><button className="text-xs font-semibold" style={{ color: "var(--brass)" }} onClick={onCasinos}>Open on the Casinos page to edit games, heat and notes ›</button></div>
    </Sheet>
  );
}

// ---------- the top of the page: your settings and the whole plan in a few lines ----------
function Glance({ rot, gr, bankroll, prefs, setPrefs, onOpen, go }) {
  const { today, rows, sc, ready, plan, R, cap } = rot, first = plan[0], ref = sc.ref, hpw = gr.hpw;
  const xs = plan.map((v) => sc.get(v.c)).filter((x) => x && x.ev > 0), base = xs.length ? xs : ref && ref.ev > 0 ? [ref] : [];
  const mh = (hpw * 30) / 7, ev = base.reduce((s, x) => s + x.ev, 0) / (base.length || 1), sd = Math.sqrt(base.reduce((s, x) => s + x.sd * x.sd, 0) / (base.length || 1)), mEv = ev * mh, mSd = sd * Math.sqrt(mh);
  const cash = upTo50(cashFor(ref, prefs.sessHours));
  const next = gr.model ? gr.model.lv.find((l) => l.state === "later") : null, cur = gr.model && gr.model.cur;
  const need = Math.max(1, Math.ceil((prefs.perWeek * R.base) / 7)), active = rows.filter((x) => x.kind !== "backed").length;
  const fx = first ? sc.get(first.c) : null, isToday = first && first.t <= today;
  const notes = [], usualLv = gr.model ? gr.model.lv.find((l) => l.m === gr.model.usual) : null;
  if (ref && !ref.loses && ref.ror > cap * 1.001) notes.push([`Playing every hand at your usual $${ref.mn} tables runs ${pct(ref.ror, 0)} risk of ruin with ${shortMoney(bankroll)}, over your ${pct(cap, 0)} limit. ${cur ? `$${cur.m} tables fit your bankroll` : "No table fits your bankroll yet"}${usualLv ? `; $${usualLv.m} tables need ${shortMoney(usualLv.need)}.` : "."}`, true]);
  if (rows.length) notes.push(active >= need
    ? [`${ready.length} of your ${rows.length} casino${rows.length === 1 ? "" : "s"} ${ready.length === 1 ? "is" : "are"} ready. ${prefs.perWeek} session${prefs.perWeek === 1 ? "" : "s"} a week needs ${need} casino${need === 1 ? "" : "s"} to keep every visit rested, and you have ${active}.`, false]
    : [`${prefs.perWeek} sessions a week needs ${need} casinos to keep every visit rested, and you have ${active}. Add ${need - active} from "Worth scouting", or play fewer sessions.`, true]);
  return (
    <section className="card p-5 mb-4">
      <div className="grid gap-4 pb-4 mb-4" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))", borderBottom: "1px solid var(--line)" }}>
        <div className="pset"><span className="eyebrow">Bankroll</span><span className="flex items-baseline gap-2"><span className="mono text-lg font-semibold">{money(bankroll)}</span><button className="text-xs font-semibold" style={{ color: "var(--brass)" }} onClick={() => go("calc")}>Change</button></span></div>
        <div className="pset"><span className="eyebrow">Risk limit</span><Seg small value={prefs.risk} options={PLAN_RISKS} onChange={(v) => setPrefs({ risk: v })} /></div>
        <div className="pset"><span className="eyebrow">Sessions a week</span><Step v={prefs.perWeek} set={(v) => setPrefs({ perWeek: v })} min={1} max={7} label="sessions a week" /></div>
        <div className="pset"><span className="eyebrow">Hours a session</span><Step v={prefs.sessHours} set={(v) => setPrefs({ sessHours: v })} min={1} max={12} f={(v) => `${v} h`} label="hours a session" /></div>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        {first ? <button className="text-left min-w-0" onClick={() => onOpen(first.c)}><Tile k="Play next" v={first.c.name} sub={`${isToday ? "Ready today" : fmtWeekday(first.t)}${fx ? ` · score ${fx.score} · ${fx.loses ? "no winning spread" : pct(fx.ror, 0) + " risk"}` : ""}`} tone="var(--brass)" /></button> : <Tile k="Play next" v="—" sub="Log a session to start the rotation." />}
        <Tile k="A normal month" v={base.length ? sgnMoney(mEv) : "—"} sub={base.length ? `on average, over ${Math.round(mh)} hours. 8 months in 10: ${sgnMoney(mEv - 1.2816 * mSd)} to ${sgnMoney(mEv + 1.2816 * mSd)}.` : sc.ref === undefined ? "Working it out…" : "No winning spread yet."} />
        <Tile k="Bring per session" v={cash ? money(cash) : "—"} sub={cash ? `for ${prefs.sessHours} hours at your usual $${ref.mn} table. Lasts the session 19 times in 20.` : ""} />
        <Tile k="Next move up" v={next ? `$${next.m} tables` : cur ? `$${cur.m} tables` : "—"} sub={next ? `at a ${shortMoney(next.need)} bankroll, about ${gr.whenOf(next.hrs)} at your pace.` : cur ? "You're at the top of the list." : gr.model ? `$${gr.model.lv[0].m} tables need ${shortMoney(gr.model.lv[0].need)} at your risk limit.` : ""} />
      </div>
      {notes.map(([t, bad], i) => <p key={i} className="text-xs mt-3" style={{ color: bad ? "var(--neg-l)" : "var(--ivory-d)" }}>{t}</p>)}
      <Info label="How this page works">
        <ol className="list-decimal pl-4 space-y-1">
          <li>Set your risk limit and pace in the top row. Every number on the page follows them and your bankroll.</li>
          <li>The plan assumes you play every hand at the table, with no sitting out, and works out the best bets for each casino at your risk limit. When a table is too big for your bankroll it shows the safest bets and the risk they carry.</li>
          <li>"Next visits" says where to play and when. Log each session after you play and the plan moves on.</li>
          <li>Click any casino for its score, risk of ruin, what it earns you and the bets to use there.</li>
          <li>The bankroll cards show where your money is likely to go and when to move up or drop back a table.</li>
        </ol>
      </Info>
    </section>
  );
}

// ---------- the Plan tab ----------
let _plan = null;
export function PlanPage({ bankroll, go }) {
  const [prefs, setP] = useState(() => _plan || PLAN_DEF), [all, setAll] = useState(null), [pop, setPop] = useState(null);
  useEffect(() => { (async () => {
    if (!_plan) setP((_plan = await loadPlan()));
    try { setAll(await loadCasinoAll()); } catch (_) { setAll([]); }
  })(); }, []);
  const setPrefs = (patch) => setP((o) => { const n = { ...o, ...patch }; _plan = n; try { window.storage.set(PLAN_KEY, JSON.stringify(n), false); } catch (_) {} return n; });
  _planRisk = prefs.risk;
  const rot = useRotation(all, prefs, bankroll), gr = useGrowth(rot.sc.safe, bankroll, prefs);
  const toCasinos = (c) => { openCasinoId(c.id); go("casinos", { open: c.id }); };
  return (
    <div>
      <style>{planCss}</style>
      <Glance rot={rot} gr={gr} bankroll={bankroll} prefs={prefs} setPrefs={setPrefs} onOpen={setPop} go={go} />
      <div className="dgrid"><div className="dcol">
        {all && <Rotation rot={rot} prefs={prefs} setPrefs={setPrefs} onOpen={setPop} />}
      </div><div className="dcol">
        <Growth gr={gr} bankroll={bankroll} prefs={prefs} setPrefs={setPrefs} go={go} />
      </div></div>
      {pop && <CasinoPop key={pop.id} c={pop} rot={rot} prefs={prefs} onClose={() => setPop(null)} onCasinos={() => toCasinos(pop)} />}
    </div>
  );
}
