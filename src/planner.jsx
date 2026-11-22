// Desktop-only planning tools:
//  - TableScoreCard (Casinos page): score a table's rules against your bankroll and spread settings.
//  - useCasinoScores: each casino's best table score, worked out a few at a time (Casinos list and the Plan page).
//  - PlanPage (the Plan tab): the casino rotation and the bankroll growth plan.
// Like casinos.jsx, nothing from app.jsx may be used while this file loads — only inside functions.
import { useState, useEffect, useMemo, useRef, useId } from "react";
import { Sheet, More, Fold, useGlideH, compute, sessionCash, tailFix, shoeRounds, useDeferred, Seg, Info, rulesShort, money, shortMoney, sgnMoney, fmtTC, pct, COUNTS, calFor, autoRph, roundFreqs, optimizeSpread, DEFAULT_RULES, sessEv, sessSd, Toggle, Glide } from "./app.jsx";
import { loadCasinoAll, openCasinoId } from "./casinos.jsx";
import { useNarrow } from "./phone.jsx";
import { makeGame } from "./sim.js";

// what is saved on this device about the game and the spread
const getJ = async (k, d) => { try { const r = await window.storage.get(k, false); return r && r.value ? JSON.parse(r.value) : d; } catch (_) { return d; } };
async function loadSetup() {
  const rules = { ...DEFAULT_RULES, ...(await getJ("bj-rules-v1", {})) }, sp = await getJ("bj-spread-v1", {});
  return { rules, seats: sp.seats || 4, spotsMap: sp.spotsMap || {}, bankroll: +sp.bankroll || 5000, minBet: +sp.minBet || 25, maxBet: +sp.maxBet || 500, hphAuto: sp.hphAuto !== false, handsPerHour: +sp.handsPerHour || 100 };
}

// ---------- plan settings (this device only) ----------
const PLAN_KEY = "bj-plan-v1";
export const REST_DEF = { base: 7, backed: 90 };
const PLAN_DEF = { hours: 8, weeks: 52, risk: 0.05, goal: "", rest: REST_DEF, minScore: 10, moveUp: true, game: "auto", gv: 3 }; // moveUp: the chart's "Include moving up" switch // minScore: a casino scoring under it is never suggested
// hours a week of play: the one pace setting (Nick: "instead of selecting hours and number of sessions can we just select
// hours"). A plan saved before that carried sessions a week and hours a session; their product carries over.
const hoursOf = (d) => { const h = +d.hours > 0 ? +d.hours : +d.perWeek > 0 && +d.sessHours > 0 ? d.perWeek * d.sessHours : PLAN_DEF.hours; return Math.max(1, Math.min(80, Math.round(h))); };
async function loadPlan() {
  try { const x = await window.storage.get(PLAN_KEY, false); if (x && x.value) { const d = JSON.parse(x.value); return { ...PLAN_DEF, ...d, hours: hoursOf(d), risk: d.risk > 0 && d.risk < 1 ? Math.min(RISK_MAX, Math.max(RISK_MIN, Math.round(d.risk * 1000) / 1000)) : PLAN_DEF.risk, weeks: d.weeks > 0 ? weeksOf(H_MONTHS[hIdx(d.weeks)]) : PLAN_DEF.weeks, minScore: d.minScore >= 0 && d.minScore <= 100 ? +d.minScore : PLAN_DEF.minScore, game: d.gv >= 2 && d.game ? d.game : "auto", moveUp: d.gv >= 3 ? d.moveUp !== false : true, gv: 3, rest: { ...REST_DEF, ...(d.rest || {}) } }; } } catch (_) {}
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
// the hours-a-week goal set on the Plan page, for Home's "This week" card (the Plan page's own copy if it is open)
export async function planHours() { return (_plan || (await loadPlan())).hours; }
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
const verdictOf = (s, score) => { if (s.loses) return ["Walk", "No spread wins here when every hand is played."]; if (s.infeasible) return score >= 50 ? ["Maybe", "It pays well, but it runs over your risk limit."] : score >= 40 ? ["Maybe", "Close, but it runs a little over your risk limit."] : ["Walk", "Too big for your bankroll: the risk of ruin is far over your limit."]; return score >= 50 ? ["Sit", "As good as your usual game or better, inside your risk limit."] : score >= 40 ? ["Maybe", "A little under your usual game."] : ["Walk", "Earns much less than your usual game."]; };
// 0–100: what the game is worth to you with the bankroll you have now.
//   worth = dollars an hour (every hand played, the best bets for your bankroll)
//           × the chance of not going broke playing it (1 − its risk of ruin)
//           × fit: 1 while the risk is inside your limit, else (bankroll ÷ the bankroll those bets need at the limit)²
// and the score is 100 × worth ÷ (worth + yardstick). The yardstick is your usual game played safely inside the limit
// (its $/hr × the chance of not going broke at the limit) — NOT marked down for its own risk. That is what makes the
// score follow the bankroll: a table that would wreck a small bankroll scores near 0 even if your usual game would wreck
// it too (an earlier version marked both down, so a 65%-risk table could still score 70), and the same table climbs as
// the bankroll grows and its risk falls. 50 = earns what your usual game does, safely; 67 = twice that; it never tops out.
const scoreOf = (ev, ref) => (!(ev > 0) ? 0 : ref > 0 ? Math.round((100 * ev) / (ev + ref)) : 100);
export const worthOf = (x) => (x.loses ? 0 : x.ev * Math.max(0, 1 - x.ror) * x.fit);
// the yardstick; when the usual game has no winning every-hand spread at all, 1/400 of the bankroll an hour stands in
export const yardstick = (ref, setup) => (ref && !ref.loses && ref.ev > 0 ? ref.ev * (1 - (ref.infeasible ? setup.rorPct / 100 : ref.ror)) : (setup.bankroll / 400) * (1 - setup.rorPct / 100));
export const scoreFor = (x, ref, setup) => (x.loses ? 0 : scoreOf(worthOf(x), yardstick(ref, setup)));
// Cash to bring so a session of `hours` runs out only 1 time in 20: the chance of ever dipping that far (pDip), with the
// app's fitted correction for how results bunch up inside a shoe — the same sum as "bring with you" on Bet spread.
export const cashFor = (x, hours) => (x && x.ev > 0 && x.sd > 0 && hours > 0 ? tailFix(x.rps || 0, hours * x.rph).c95 * sessionCash(0.05, x.ev, x.sd, hours) : 0);
const upTo50 = (v) => Math.ceil(v / 50) * 50;
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
  const score = out && ref ? scoreFor(out, ref, setup) : null, [verdict, why] = out && ref ? verdictOf(out, score) : ["", ""];
  const tone = score == null ? "var(--ivory)" : scoreTone(score);
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
            <div className="hl" style={{ color: tone }}>{score}</div>
            <div className="min-w-0">
              <div style={{ color: tone, fontSize: 17, fontWeight: 700, letterSpacing: "-.02em" }}>{verdict}</div>
              <div className="text-xs" style={{ color: "var(--ivory-d)" }}>{why}</div>
            </div>
          </div>
          {out.ev > 0 && <>
            <div className="text-xs mt-3" style={{ color: "var(--ivory-d)" }}><span className="mono font-semibold" style={{ color: "var(--ivory)" }}>{money(out.ev)}/hr</span> at <span className="mono font-semibold" style={{ color: out.infeasible ? "var(--rose)" : "var(--ivory)" }}>{pct(out.ror, out.ror < 0.0095 ? 1 : 0)}</span> risk of ruin with your {shortMoney(setup.bankroll)} bankroll, playing every hand. Your usual game ({rulesShort(setup.rules)}) earns {money(ref.ev)}/hr the same way.</div>
            <div className="eyebrow mt-3 mb-1" style={{ fontSize: 9.5 }}>{out.infeasible ? "Safest bets here" : "Best bets here"}</div>
            <div className="flex flex-wrap gap-1.5">{spreadLine(out.bets).map(([k, v]) => <span key={k} className="rounded-lg px-2 py-1 text-[11px]" style={{ background: "rgba(var(--fg),.05)", color: "var(--ivory-d)" }}><span className="mono" style={{ color: "var(--muted)" }}>{k}</span> <span className="mono font-semibold" style={{ color: "var(--ivory)" }}>{v}</span></span>)}</div>
          </>}
          {onUseRules && <button type="button" className="text-xs font-semibold mt-3 lnk" style={{ color: "var(--brass)" }} onClick={() => onUseRules({ ...appRules, ...R })}>Practice this game in the app ›</button>}
        </div>
      )}
      <Info label="About the score">What this table is worth to you with the bankroll you have now: its dollars an hour, playing every hand with the best bets your bankroll allows, weighed by its risk of ruin against your {setup ? setup.rorPct : 5}% limit (set on the Plan page). A table that would put your bankroll at serious risk scores near 0 however well it pays, and the same table scores higher as your bankroll grows. 50 means it earns what your usual game ({setup ? `${rulesShort(setup.rules)}, $${setup.minBet}–$${setup.maxBet}` : "the app's saved rules"}) does when played safely inside your limit; 67 is twice that, 33 half. Sit at 50 and up, think twice from 40 to 49, walk below that.</Info>
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
export function gamesAt(c) {
  const mine = ((c.mark && c.mark.games) || []).filter((g) => g.rules);
  if (mine.length) return mine.map((g) => ({ label: g.label || "", rules: g.rules, min: g.min || "", max: g.max || "" }));
  const it = c.intel; if (!it) return [];
  const out = [], b = it.best;
  // a report that doesn't say how the dealer plays soft 17 is taken as the worse rule (hits)
  if (b && !b.bj65 && (b.decks || b.h17 != null)) out.push({ label: b.where || "Best game reported", rules: { decks: [1, 2, 4, 6, 8].includes(b.decks) ? b.decks : 6, h17: b.h17 != null ? !!b.h17 : true, das: b.das != null ? !!b.das : true, surrender: !!b.ls, rsa: !!b.rsa, pen: b.pen ? Math.min(90, Math.max(50, Math.round(b.pen / 5) * 5)) : PEN_GUESS[[1, 2, 4, 6, 8].includes(b.decks) ? b.decks : 6] }, min: b.min || it.min || "", max: b.max || "" });
  // a line that spells out the same game as `best` (same decks, soft-17 rule and minimum) isn't a second game: it lends
  // `best` the limits the summary leaves out — doubling on 9–11 or 10–11 only, no resplits — so they aren't scored away
  (Array.isArray(it.games) ? it.games : []).flatMap((line) => String(line).split(";")).forEach((line) => {
    const g = reportGame(line); if (!g) return;
    const same = out.find((o) => +o.min === g.min && o.rules.decks === g.rules.decks && o.rules.h17 === g.rules.h17);
    if (!same) out.push(g);
    else if (same === out[0] && b) same.rules = { ...same.rules, ...(g.rules.dbl !== "any" ? { dbl: g.rules.dbl } : {}), ...(g.rules.maxHands ? { maxHands: g.rules.maxHands } : {}) };
  });
  return out.slice(0, 5);
}
const _sc = new Map(); // setup + games → the best game's result (null when the casino has no game to score)
const setupKey = (s) => JSON.stringify([s.bankroll, s.rorPct, s.minBet, s.maxBet, s.rules, s.seats, s.spotsMap, s.hphAuto, s.handsPerHour]);
// your usual game (the app's rules, your table min and max), scored the same way: every score is measured against it
const refOf = (setup) => { const k = "ref" + setupKey(setup); if (!_sc.has(k)) { let r = null; try { r = scoreGame(setup, { rules: setup.rules, min: setup.minBet, max: setup.maxBet, seats: setup.seats }); } catch (_) {} _sc.set(k, r); } return _sc.get(k); };
function scoreCasino(setup, c, peek) {
  const games = gamesAt(c); if (!games.length) return null;
  const k = setupKey(setup) + JSON.stringify(games);
  if (_sc.has(k) || peek) return _sc.get(k);
  if (_sc.size > 4000) _sc.clear();
  const ref = refOf(setup); let best = null;
  const mine = !!((c.mark && c.mark.games) || []).some((g) => g.rules);
  if (ref) games.forEach((g) => { const x = scoreGame(setup, g), sc = scoreFor(x, ref, setup); if (!best || sc > best.score || (sc === best.score && x.ror < best.ror)) best = { ...x, score: sc, g, mine, n: games.length }; });
  _sc.set(k, best); return best;
}
// A score's colour: one smooth run from red at 0 through amber to green at 100 (Nick's instruction), a little darker on
// the light themes so it reads on white.
export const scoreTone = (n) => {
  const t = Math.max(0, Math.min(100, +n || 0)) / 100; let light = false;
  try { light = document.documentElement.getAttribute("data-theme") === "light"; } catch (_) {}
  return `hsl(${Math.round(4 + 138 * t)} ${light ? 72 : 70}% ${light ? 35 : 60}%)`;
};
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
      try { refOf(setup); while (i < todo.length && performance.now() - t0 < 14) scoreCasino(setup, todo[i++]); } catch (_) { i = todo.length; }
      bump((n) => n + 1); if (i < todo.length) id = setTimeout(tick, 40);
    }, first.current ? 700 : 80);
    first.current = false;
    return () => clearTimeout(id);
  }, [setup, ids, on]); // eslint-disable-line
  return { setup, ref: setup ? _sc.get("ref" + setupKey(setup)) : undefined, get: (c) => (setup ? scoreCasino(setup, c, true) : undefined) };
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
// Where to play next, best first (Nick: "the next casino can just be 1 suggested with 2 sub suggestions"): the casinos
// that are ready today by rest and game (days rested, nudged by score), then the resting ones by the day they come back.
// A back-off with no end date is never offered. `t` is today for a ready casino, else the day it is ready.
export function nextUp(rows, today, scoreOfC, n = 3) {
  const live = rows.filter((r) => r.kind !== "backed" || r.until), ok = (r) => !r.until || r.until <= today;
  const ready = live.filter(ok).sort((a, b) => weightAt(b.last, today, scoreOfC(b.c)) - weightAt(a.last, today, scoreOfC(a.c)));
  const later = live.filter((r) => !ok(r)).sort((a, b) => a.until - b.until || weightAt(b.last, b.until, scoreOfC(b.c)) - weightAt(a.last, a.until, scoreOfC(a.c)));
  return [...ready, ...later].slice(0, n).map((r) => ({ c: r.c, t: ok(r) ? today : r.until, ready: ok(r), back: r.kind === "backed" }));
}
export const milesBetween = (a, b) => { const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r; return Math.sqrt(x * x + y * y) * 3959; };

const planCss = `
.prow{position:relative;display:grid;align-items:center;gap:10px;width:100%;text-align:left;padding:12px 6px;border-radius:12px;transition:background .15s var(--ez)}
/* the hairline between two rows is straight and starts at the text, as in Apple's lists (a box-shadow followed the
   row's rounded corners and drew a faint curved line at each end) */
.prow+.prow::before{content:"";position:absolute;left:6px;right:6px;top:0;height:var(--hair);background:rgba(var(--fg),.08);pointer-events:none}
.pc2+.pc2::before{left:52px;right:4px}
.por+.por::before{left:42px;right:4px}
/* A casino row (Plan, 22 Nov: "easier to understand and cleaner looking"): its score as a ring out of 100 on the left,
   its name and how it stands (ready, resting, skipped) in the middle, what it earns an hour and its risk of ruin at the
   right end, and in the rotation a bar under it that fills as it rests. One row for phone and computer. */
.pring{position:relative;display:inline-grid;place-items:center;flex:none}
.pring>svg{position:absolute;inset:0;overflow:visible}
.pring>b{position:relative;font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:1}
.pc2{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"r n v" "r s k";column-gap:12px;row-gap:2px;padding:12px 4px}
.pc2.hasbar{grid-template-areas:"r n v" "r s k" "r b b"}
.pc2>.pring{grid-area:r;align-self:center}
.pc2>.pname{grid-area:n;min-width:0;font-size:14px;line-height:1.3;font-weight:600;color:var(--ivory);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-wrap:balance}
.pc2>.psub{grid-area:s;min-width:0;font-size:11.5px;line-height:1.35;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pc2>.pval{grid-area:v;justify-self:end;font-size:14px;line-height:1.3;font-weight:650;letter-spacing:-.01em;color:var(--ivory);font-variant-numeric:tabular-nums;white-space:nowrap}
.pval .u{font-size:11px;font-weight:500;letter-spacing:0;color:var(--muted);margin-left:1px}
.pc2>.pk{grid-area:k;justify-self:end;font-size:11.5px;line-height:1.35;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.pc2>.prest{grid-area:b;margin-top:8px;height:4px}
/* a casino's name wraps onto a second line instead of being cut short ("JACK Clevelan…", "Hollywood Casino at The M…"),
   on a phone as on a computer; the line under it may still end in "…" (a place, a report's date) */
.por{grid-template-columns:auto minmax(0,1fr) auto;column-gap:10px;padding:8px 4px}
.psmall{font-size:11px;line-height:1.35;color:var(--muted);margin-top:2px}
/* the casino to play next wraps onto a second line rather than end in "…" ("Hard Rock Casino Cincinn…") */
.pclamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-wrap:balance}
@media (hover:hover){button.prow:hover{background:rgba(var(--fg),.045)}}
.phead{display:grid;gap:10px;padding:0 6px 7px;font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.ptrack{position:relative;height:6px;border-radius:99px;background:rgba(var(--fg),.08);overflow:hidden}
.ptrack>i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:rgba(var(--fg),.42);transform-origin:0 50%}
.ptrack>i.ok{background:var(--brass)}
.ptrack>i.x{background:rgba(var(--neg),.7)}
.ptrack.big{height:10px}
.pset{display:flex;align-items:center;gap:10px;min-width:0;white-space:nowrap}
.pslide{display:flex;align-items:center;gap:10px;min-width:0}
.pslide input{flex:1 1 auto;min-width:0}
.pslide.risk{width:220px}
.pslide.horizon{width:260px;max-width:100%}
.pslv{font-size:13px;font-weight:600;color:var(--ivory);white-space:nowrap;text-align:right}
.pslide.risk .pslv{min-width:38px}
.pslide.horizon .pslv{min-width:72px}
.pset>.eyebrow{font-size:12px}
.pbig{font-size:26px;line-height:1.1;font-weight:700;letter-spacing:-.02em}
.pstat>div:first-child{font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.pstat>div:nth-child(2){font-size:20px;line-height:1.15;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin-top:3px}
.pstat>div:nth-child(3){font-size:11px;line-height:1.35;color:var(--muted);margin-top:2px}
.pnote{font-size:11.5px;line-height:1.45;border-radius:12px;padding:8px 12px;background:rgba(var(--neg),.09);color:var(--neg-l)}
.pstats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
.plegend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11px;color:var(--muted)}
.plegend>span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.plegend i{width:9px;height:9px;border-radius:3px;flex:none}
.plegend i.ln{width:14px;height:2.5px;border-radius:2px}
.plegend i.dash{background:repeating-linear-gradient(90deg,rgba(var(--fg),.5) 0 4px,transparent 4px 7px)}
.pghead{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-top:14px}
.pgbig{font-size:44px;line-height:1;font-weight:650;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.pgsub{font-size:11.5px;color:var(--muted);margin-top:8px}
.pgrange{text-align:right;font-size:15px;font-weight:600;color:var(--ivory);padding-bottom:1px}
.pgset{border-top:1px solid var(--line)}
.pgset>*{padding:11px 0}
.pgset>*+*{box-shadow:0 -1px 0 rgba(var(--fg),.06)}
.pgrow{display:flex;align-items:center;justify-content:space-between;gap:10px 14px}
.pgseg{width:196px;flex:none}
.pgsum{margin:-6px -8px;padding:6px 8px;width:calc(100% + 16px);border-radius:12px}
.pplan{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:rgba(var(--fg),.04);color:var(--muted)}
.pplan .k{font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pplan .v{font-size:15px;font-weight:600;color:var(--ivory);margin-top:3px;font-variant-numeric:tabular-nums}
.pplan .s{font-size:11.5px;color:var(--ivory-d);margin-top:1px}
.pplan>div:last-child .v{color:var(--brass)}
@media (max-width:430px){.pgrow.game{flex-wrap:wrap}.pgrow.game .pgseg{width:100%!important}.pdrow.bl{flex-direction:column;align-items:flex-start;gap:8px}.pdrow.bl .pdpick{justify-content:flex-start}}
.pgbody{position:relative}
.pgbody>*{transition:opacity .3s var(--ez)}
.pgbody.stale>*:not(.pgupd){opacity:.45}
.pgbody.stale .pdeal{pointer-events:none}
.pgupd{position:absolute;top:-1px;left:0;font-size:11px;font-weight:600;color:var(--brass);letter-spacing:.02em}
.pdeal{padding:12px 14px;border-radius:14px;background:rgba(var(--fg),.04)}
.pdrow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.pdeal .btn{width:auto;flex:none;min-height:38px;font-size:14px;padding:0 16px}
.pdeal .pstats.three{gap:12px}
@media (max-width:380px){.pdpick{gap:5px}.pdpick .gchip{padding:4px 8px;font-size:11px}.pdrow{flex-wrap:wrap}.pdeal .btn{width:100%}.pgrange{font-size:13.5px}.pplan{gap:8px;padding:11px 12px}}
.pdpick{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
.pdpick .gchip{padding:4px 11px;font-size:11.5px}
.pdhl{display:inline-block;width:12px;height:2.5px;border-radius:2px;background:var(--ivory);vertical-align:middle;margin-right:7px;position:relative;top:-1px}
.pgchart text{font-variant-numeric:tabular-nums}
.pmrow{padding:11px 0;border-bottom:1px solid var(--line)}
/* phone: a casino is two lines (its name and how rested it is, then its three numbers with their names), a stat is a
   row (what it is on the left, the number on the right), and the move-up table is a short list */
@media (max-width:1023px){
.phead{display:none}
.pgrow.target{flex-wrap:wrap}
.pgrow.target>.pgoal{flex:1 1 100%;text-align:left}
.pstats{grid-template-columns:1fr;gap:0}.bj .pstats.pt-4{padding-top:2px}
.pgbig{font-size:clamp(36px,10.3vw,41px)}
.pstats>.pstat{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"k v" "s v";align-items:center;column-gap:14px;padding:12px 0}
.pstats>.pstat+.pstat{box-shadow:0 -1px 0 rgba(var(--fg),.06)}
.pstats>.pstat>div:first-child{grid-area:k;font-size:12.5px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--ivory)}
.pstats>.pstat>div:nth-child(2){grid-area:v;font-size:19px;margin-top:0;text-align:right}
.pstats>.pstat>div:nth-child(3){grid-area:s;margin-top:1px}
.pset{justify-content:space-between;width:100%}
.pbig{font-size:24px}
}
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
// a risk as a percentage: one decimal under 1%, and "<0.1%" rather than a "0.0%" that reads as no risk at all
const tinyPct = (p) => (p < 0.0005 ? "<0.1%" : pct(p, p < 0.0095 ? 1 : 0));
// A score out of 100 as a ring that fills in the score's own colour, the number inside (Nick asked for Plan to be
// "easier to understand": a bare "Score 1" didn't say out of what). `s` undefined: still being worked out; null: no
// game saved or reported, so no score.
function ScoreRing({ s, size = 36 }) {
  const w = size >= 34 ? 3 : 2.5, r = (size - w) / 2, C = 2 * Math.PI * r, v = s == null ? 0 : Math.max(0, Math.min(100, s)), c = size / 2;
  return (
    <span className="pring" style={{ width: size, height: size }} title={s == null ? (s === null ? "No score: no game saved or reported here" : "Working out the score") : `Score ${s} of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(var(--fg),.1)" strokeWidth={w} />
        {v > 0 && <circle cx={c} cy={c} r={r} fill="none" stroke={scoreTone(v)} strokeWidth={w} strokeLinecap="round" strokeDasharray={`${(C * v) / 100} ${C}`} transform={`rotate(-90 ${c} ${c})`} />}
      </svg>
      <b style={{ color: s == null ? "var(--muted)" : scoreTone(v), fontSize: size >= 34 ? 12.5 : 11 }}>{s === undefined ? "…" : s === null ? "—" : s}</b>
    </span>
  );
}
// what a casino earns an hour and its risk of ruin, for the right-hand end of its row
function Worth({ x, cap }) {
  if (!x) return <><span className="pval" style={{ color: "var(--muted)" }}>—</span><span className="pk" /></>;
  return (<>
    <span className="pval">{x.ev > 0 ? <>{money(x.ev)}<span className="u">/hr</span></> : <span style={{ color: "var(--muted)" }}>loses</span>}</span>
    <span className="pk" style={x.loses ? undefined : x.ror > cap * 1.001 ? { color: "var(--rose)" } : undefined}>{x.loses ? "" : `${tinyPct(x.ror)} risk`}</span>
  </>);
}
const scoreAt = (sc, c) => { const x = sc.get(c); return x === undefined ? (gamesAt(c).length ? undefined : null) : x ? x.score : null; };

function useRotation(all, prefs, bankroll, lite) {
  const now = useMemo(() => Date.now(), []), today = startOfDay(now);
  const R = restSet(prefs.rest);
  const rows = useMemo(() => (all || []).filter((c) => (c.sess && c.sess.n) || (c.mark && (c.mark.status === "been" || c.mark.status === "backed")))
    .filter((c) => !(c.mark && c.mark.hidden)).map((c) => ({ c, ...restOf(c, R) })), [all, prefs.rest.base, prefs.rest.backed]); // eslint-disable-line
  // places with a scouting report near where you play that aren't in the rotation yet
  const near = useMemo(() => {
    if (lite) return []; // Home's card only needs the casinos you play
    const mine = rows.filter((r) => isFinite(r.c.lat + r.c.lon)); if (!mine.length) return [];
    const w = mine.map((r) => Math.max(1, (r.c.sess && r.c.sess.n) || 0)), W = w.reduce((a, b) => a + b, 0);
    const home = { lat: mine.reduce((s, r, i) => s + r.c.lat * w[i], 0) / W, lon: mine.reduce((s, r, i) => s + r.c.lon * w[i], 0) / W }, ids = new Set(rows.map((r) => r.c.id));
    return (all || []).filter((c) => !ids.has(c.id) && !(c.mark && c.mark.hidden) && isFinite(c.lat + c.lon) && gamesAt(c).length).map((c) => ({ c, mi: milesBetween(home, c) })).filter((x) => x.mi <= 250).sort((a, b) => a.mi - b.mi).slice(0, 30);
  }, [rows, all, lite]);
  const scoreList = useMemo(() => [...rows.map((r) => r.c), ...near.map((x) => x.c)], [rows, near]);
  const sc = useCasinoScores(scoreList, true, { bankroll, rorPct: prefs.risk * 100 }), scoreN = (c) => { const x = sc.get(c); return x ? x.score : null; };
  const isReady = (r) => (r.kind !== "backed" || !!r.until) && (!r.until || r.until <= today);
  // A casino scoring under the cut-off (10 unless Nick changes it) is never suggested: it is left out of the schedule and
  // listed last as "Skipped". One with no score at all (no game saved or reported) stays in. `pending` is true until
  // every casino's score is in, so the plan doesn't name a casino and then take it back.
  const minScore = prefs.minScore, low = (c) => { const x = sc.get(c); return !!x && x.score < minScore; };
  const pending = rows.some((r) => gamesAt(r.c).length && sc.get(r.c) === undefined);
  const okRows = rows.filter((r) => !low(r.c)), skipped = rows.filter((r) => low(r.c)).sort((a, b) => scoreN(b.c) - scoreN(a.c));
  const ready = okRows.filter(isReady).sort((a, b) => weightAt(b.last, today, scoreN(b.c)) - weightAt(a.last, today, scoreN(a.c)));
  const resting = okRows.filter((r) => !isReady(r)).sort((a, b) => (a.until || Infinity) - (b.until || Infinity));
  const plan = pending ? [] : nextUp(okRows, today, scoreN, 3);
  // where your hours went over the last 90 days
  const h90 = []; rows.forEach((r) => { const h = ((r.c.sess && r.c.sess.recs) || []).filter((x) => daysBetween(dayOf(x.date), today) <= 90).reduce((s, x) => s + x.h, 0); if (h > 0) h90.push([r.c, h]); });
  const tot = h90.reduce((s, x) => s + x[1], 0), share = Object.fromEntries(h90.map(([c, h]) => [c.id, h / tot]));
  const scout = near.map((x) => ({ ...x, s: sc.get(x.c) })).filter((x) => x.s && !x.s.loses).sort((a, b) => b.s.score - a.s.score || a.s.ror - b.s.ror || a.mi - b.mi).slice(0, 5); // best score first, then the lowest risk
  return { now, today, R, rows, sc, isReady, ready, resting, skipped, low, pending, minScore, plan, share, scout, cap: prefs.risk };
}
// Left column, top: the casino to play next, and two others to fall back on
const setupB = (sc) => (sc.setup ? sc.setup.bankroll : 0);
function PlayNext({ rot, onOpen }) {
  const { today, rows, sc, ready, skipped, pending, minScore, plan, cap } = rot, first = plan[0];
  if (!rows.length) return <section className="card p-5 mb-4"><div className="eyebrow mb-2">Play next</div><p className="text-sm" style={{ color: "var(--ivory-d)" }}>Nothing to plan yet. Log a session on the Sessions page, or mark a casino as "been" on the Casinos page, and this fills in: where to play next, when each casino is safe to go back to, and what each one is worth to you.</p></section>;
  const x = first ? sc.get(first.c) : null, row = first && rows.find((r) => r.c.id === first.c.id);
  const bestSkip = skipped[0] && sc.get(skipped[0].c), allSkipped = !pending && skipped.length === rows.length;
  const over = x && !x.loses && x.ror > cap * 1.001;
  return (
    <section className="card p-5 mb-4">
      <div className="flex items-baseline justify-between gap-3"><div className="eyebrow">Play next</div>{!pending && !allSkipped && <div className="text-[11px]" style={{ color: "var(--muted)" }}>{ready.length} of {rows.length} ready now</div>}</div>
      {pending && <div className="text-sm mt-2" style={{ color: "var(--muted)" }}>Working out the scores…</div>}
      {allSkipped && <div className="mt-2">
        <div className="pbig" style={{ color: "var(--ivory)" }}>Nothing to suggest yet</div>
        <p className="text-xs mt-1.5" style={{ color: "var(--ivory-d)" }}>With {money(setupB(sc))} at your {rk(cap)} risk limit, every casino you play scores under {minScore} out of 100, so none is suggested.{bestSkip ? <> The best is {skipped[0].c.name}, at <b style={{ color: scoreTone(bestSkip.score) }}>{bestSkip.score}</b>.</> : ""} Tap one below to see why.</p>
      </div>}
      {first && <button className="block text-left w-full mt-2" onClick={() => onOpen(first.c)}>
        <div className="pbig pclamp" style={{ color: "var(--brass)" }}>{first.c.name}</div>
        <div className="text-xs mt-1" style={{ color: "var(--ivory-d)" }}>{first.ready ? "Ready now" : `Ready ${fmtWeekday(first.t)}`}{row && row.last ? ` · last visit ${ago(daysBetween(row.last, today))}` : ""}{first.back ? " · first visit since the back-off, keep it short" : ""}</div>
      </button>}
      {x ? <div className="stats three mt-4">
        <div><div className="lab">Score</div><div className="statn sm" style={{ color: scoreTone(x.score) }}>{x.score}</div><div className="psmall">out of 100</div></div>
        <div><div className="lab">Risk of ruin</div><div className="statn sm" style={over ? { color: "var(--rose)" } : undefined}>{x.loses ? "—" : tinyPct(x.ror)}</div><div className="psmall">{over ? `over your ${rk(cap)}` : `your limit ${rk(cap)}`}</div></div>
        <div><div className="lab">Earns</div><div className="statn sm">{x.ev > 0 ? money(x.ev) : "—"}</div><div className="psmall">an hour</div></div>
      </div> : first && <div className="text-xs mt-3" style={{ color: "var(--muted)" }}>{gamesAt(first.c).length ? "Working out the score…" : "No game saved or reported here, so no score yet."}</div>}
      {plan.length > 1 && <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--sep)" }}>
        <div className="lab mb-1">Or</div>
        {plan.slice(1).map((v) => (
          <button key={v.c.id} className="prow por" onClick={() => onOpen(v.c)}>
            <ScoreRing s={scoreAt(sc, v.c)} size={28} />
            <span className="text-sm font-semibold truncate" style={{ color: "var(--ivory)" }}>{v.c.name}</span>
            <span className="text-[11.5px] font-semibold whitespace-nowrap" style={{ color: v.ready ? "var(--brass)" : v.back ? "var(--rose)" : "var(--ivory-d)" }}>{v.ready ? "Ready" : `Back ${fmtDay(v.t)}`}</span>
          </button>))}
      </div>}
    </section>
  );
}
function Rotation({ rot, prefs, setPrefs, onOpen }) {
  const { now, today, R, rows, sc, isReady, ready, resting, skipped, low, minScore, share, scout, cap } = rot;
  const setRest = (k, v) => setPrefs({ rest: { ...prefs.rest, [k]: v } }), [allC, setAllC] = useState(false), [allS, setAllS] = useState(false);
  const mineRef = useGlideH(allC), scoutRef = useGlideH(allS);
  const mine = [...ready, ...resting, ...skipped], seen = allC ? mine : mine.slice(0, 5), scouts = allS ? scout : scout.slice(0, 3);
  if (!rows.length) return null;
  return (<>
    <section className="card p-5 mb-4">
      <div className="flex items-baseline justify-between gap-3 mb-1"><div className="eyebrow">Your casinos</div><span className="text-[11px]" style={{ color: "var(--muted)" }}>score out of 100</span></div>
      <div ref={mineRef}>
      {seen.map((r) => {
        const rd = isReady(r), sk = low(r.c), frac = rd ? 1 : r.until && r.from ? Math.max(0.04, Math.min(0.96, (now - r.from) / Math.max(DAY, r.until - r.from))) : 0.04;
        // how it stands, in words: ready, resting until a day, or skipped (scores under the cut-off, so never suggested)
        const [st, tone] = sk ? [`Skipped · scores under ${minScore}`, "var(--muted)"] : rd ? ["Ready", "var(--brass)"] : r.kind === "backed" ? [r.until ? `Backed off · back ${fmtDay(r.until)}` : "Backed off", "var(--rose)"] : [`Resting · back ${fmtDay(r.until)}`, "var(--ivory-d)"];
        return (
        <button key={r.c.id} className={"prow pc2" + (sk ? "" : " hasbar")} onClick={() => onOpen(r.c)}>
          <ScoreRing s={scoreAt(sc, r.c)} />
          <span className="pname">{r.c.name}</span>
          <span className="psub"><span style={{ color: tone, fontWeight: 600 }}>{st}</span><span className="ph-hide">{r.last ? ` · ${ago(daysBetween(r.last, today))}` : " · no sessions"}{r.why && !sk ? ` · ${r.why}` : ""}</span></span>
          <Worth x={sc.get(r.c)} cap={cap} />
          {!sk && <span className="ptrack prest" aria-hidden="true"><i className={"barx " + (rd ? "ok" : r.kind === "backed" ? "x" : "")} style={{ width: `${frac * 100}%` }} /></span>}
        </button>); })}
      </div>
      {mine.length > 5 && <More open={allC} onClick={() => setAllC(!allC)} className="mt-2">{allC ? "Fewer" : `All ${mine.length} casinos`}</More>}
      <Info label="How scores work">
        <b>Score</b>, out of 100: what a casino's best game is worth to you with the bankroll you have now. It is what the game earns an hour, weighed by its risk of ruin against your limit, so a table that would put your bankroll at serious risk scores near 0 however well it pays, and climbs as your bankroll grows into it. 50 earns what your usual game does, played safely inside your limit; 67 twice that, 33 half. The ring's colour runs from red at 0 to green at 100. <b>Risk</b> is the risk of ruin: the chance of losing your whole bankroll if you kept playing that table's bets and never cut them; red is over your limit. <b>$/hr</b> is what those bets earn on average. All three assume you play every hand with the best bets for your bankroll, using the games you saved for the casino, or its scouting report when you haven't saved any. The bar under a casino fills as it rests: full and green is ready, red is a back-off counting down. A casino scoring under {minScore} is skipped: never suggested as a place to play.
      </Info>
      <Info label="Rest days and lowest score">
        <div className="space-y-2.5 mb-3 mt-1">
          <div className="flex items-center justify-between gap-3"><span className="text-sm">Never suggest a casino scoring under</span><Step v={prefs.minScore} set={(v) => setPrefs({ minScore: v })} min={0} max={50} step={5} f={(v) => (v > 0 ? String(v) : "Off")} label="lowest score to suggest" /></div>
          <div className="flex items-center justify-between gap-3"><span className="text-sm">Rest after a visit</span><Step v={prefs.rest.base} set={(v) => setRest("base", v)} min={1} max={30} f={(v) => `${v} d`} label="rest after a visit" /></div>
          <div className="flex items-center justify-between gap-3"><span className="text-sm">Rest after a back-off</span><Step v={prefs.rest.backed} set={(v) => setRest("backed", v)} min={30} max={365} step={15} f={(v) => `${v} d`} label="rest after a back-off" /></div>
        </div>
        A casino rests {R.base} days after a visit; {R.warm} days if you rated its heat Medium, were watched last time, or went 3 or more times in 30 days; {R.hot} days at High heat. A back-off rests it {R.backed} days, or {R.backedAgain} days once you've been backed off there twice. Play next picks the ready casino with the most days rested, nudged by score: a great game counts about like a quarter more rest. The two under it are the next best, or the next to come back.
      </Info>
    </section>
    {scout.length > 0 && <section className="card p-5 mb-4">
      <div className="eyebrow mb-1">Worth scouting</div>
      <div ref={scoutRef}>
      {scouts.map((x) => (
        <button key={x.c.id} className="prow pc2" onClick={() => onOpen(x.c)}>
          <ScoreRing s={x.s.score} />
          <span className="pname">{x.c.name}</span>
          <span className="psub">{[x.c.city, x.c.st].filter(Boolean).join(", ")} · {Math.round(x.mi / 5) * 5} mi · ${x.s.mn} tables{x.c.intel && x.c.intel.asOf ? <span className="ph-hide"> · {x.c.intel.asOf}</span> : ""}</span>
          <Worth x={x.s} cap={cap} />
        </button>))}
      </div>
      {scout.length > 3 && <More open={allS} onClick={() => setAllS(!allS)} className="mt-2">{allS ? "Fewer" : `${scout.length - 3} more`}</More>}
      <Info label="About these reports">The best reported games for your bankroll within 250 miles of the casinos you play, that you haven't played yourself. A report is only as current as its date, so check the table before you sit.</Info>
    </section>}
  </>);
}

// ---------- bankroll growth ----------
const TABLE_MINS = [5, 10, 15, 25, 50, 75, 100, 200, 500];
// the horizon of "Where it's heading" (Nick: "a slider from 2 months to 5 years"): stops in months, saved as weeks
// (months × 52 ÷ 12, so the old 6 months / 1 year / 2 years — 26, 52, 104 weeks — land on stops exactly)
const H_MONTHS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 18, 21, 24, 30, 36, 42, 48, 54, 60];
const monthsOf = (weeks) => (weeks * 12) / 52, weeksOf = (m) => (m * 52) / 12;
const hIdx = (weeks) => { const m = monthsOf(weeks); let b = 0; H_MONTHS.forEach((x, i) => { if (Math.abs(x - m) < Math.abs(H_MONTHS[b] - m)) b = i; }); return b; };
const spanOf = (weeks) => { const m = H_MONTHS[hIdx(weeks)]; return m === 12 ? "1 year" : m % 12 === 0 ? `${m / 12} years` : m < 24 ? `${m} months` : `${Math.floor(m / 12)}\u00bd years`; };
// the risk limit (Nick: "a slider ranging from 0-20"): half-point steps from 0.5% — no bet at all meets a 0% limit
const RISK_MIN = 0.005, RISK_MAX = 0.2;
const rk = (r) => { const p = Math.round(r * 1000) / 10; return `${Number.isInteger(p) ? p : p.toFixed(1)}%`; };
// a slider that follows the finger at once but tells the page only when it settles (a moment after the last move, or
// on letting go): the risk limit re-works every casino score and the bankroll plan, too much to redo on every pixel
function PlanSlider({ value, min, max, step = 1, onCommit, label, show, className = "" }) {
  const [v, setV] = useState(value), t = useRef(0), cur = useRef(value);
  useEffect(() => { setV(value); cur.current = value; }, [value]);
  const commit = () => { clearTimeout(t.current); if (cur.current !== value) onCommit(cur.current); };
  return (
    <div className={"pslide " + className}>
      <input type="range" min={min} max={max} step={step} value={v} aria-label={label} aria-valuetext={show(v)}
        onChange={(e) => { const x = Number(e.target.value); cur.current = x; setV(x); clearTimeout(t.current); t.current = setTimeout(commit, 350); }}
        onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <span className="mono pslv">{show(v)}</span>
    </div>
  );
}
// seeded so the page shows the same picture every time the inputs are the same
function rng(seed) { let a = seed >>> 0; const u = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; return { u, z: () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()) }; }
// The tables your bankroll can be played on. `safe` is the spread being scaled — on the Plan page your own, from Bet
// spread ({ ev, sd, mn, bets }): scaled to another table minimum, EV grows with the minimum and variance with its square, so the smallest bankroll a
// table can be played on at a risk of ruin is need = (m ÷ min) · sd² · −ln(risk) ÷ (2 · EV), and the risk has doubled
// when the bankroll has fallen to need · ln(2·risk) ÷ ln(risk).
export function growthModel(safe, bankroll, risk) {
  if (!safe || safe.loses || !(safe.ev > 0) || !(safe.sd > 0) || !(safe.mn > 0) || !(bankroll > 0)) return null;
  const minBet = safe.mn, top = Math.max(0, ...COUNTS.map((c) => +safe.bets[c] || 0));
  const per = (safe.sd * safe.sd * -Math.log(risk)) / (2 * safe.ev), f = Math.log(Math.min(0.999, 2 * risk)) / Math.log(risk);
  const mins = [...new Set([...TABLE_MINS, minBet])].sort((a, b) => a - b), at = mins.indexOf(minBet), has = bankroll * 1.0005; // a hair of slack so "exactly enough" counts
  const mk = (m) => { const k = m / minBet; return { m, k, need: per * k, down: per * k * f, ev: safe.ev * k, sd: safe.sd * k, top: Math.round((top * k) / 5) * 5 }; };
  let from = at; while (from > 0 && per * (mins[from] / minBet) > has) from--; // the biggest table you qualify for, if it is below yours
  const lv = mins.slice(from).map(mk);
  return { lv: markLevels(lv, bankroll), cur: lv.filter((l) => l.state === "now").pop() || null, usual: minBet };
}
// from where you stand: the expected hours to each bigger table, and the chance of getting there before going broke,
// playing each table until the next one's bankroll is reached (a drifting walk between two walls)
function markLevels(lv, bankroll) {
  const has = bankroll * 1.0005;
  let b = bankroll, hrs = 0, odds = 1, play = lv.filter((l) => l.need <= has).pop() || null;
  lv.forEach((l) => {
    if (l.need <= has) { l.state = l === play ? "now" : "ok"; return; }
    if (!play) { l.state = "short"; return; }
    const th = (2 * play.ev) / (play.sd * play.sd);
    odds *= (1 - Math.exp(-th * b)) / (1 - Math.exp(-th * l.need)); l.chance = odds;
    hrs += (l.need - b) / play.ev; l.hrs = hrs; l.state = "later"; b = l.need; play = l;
  });
  return lv;
}
// ---------- moving up and dropping back: every count played, the best bets for each table ----------
// Nick's instruction: this table assumes every hand is played (as the casino scores do), with the optimizer's best
// bets for each table size at the risk limit. Playing every hand, a smaller minimum always earns more from the same
// bankroll (the waiting bets cost less) until that table's maximum bet holds the spread back, so the rule is simply:
// **move up when the bigger table would earn more inside the limit.** The optimizer's answer depends only on the
// bankroll counted in table minimums, so its best dollars an hour is measured once, e(u) for a bankroll of u minimums
// at the usual table, and table m with bankroll B earns m x e(B / m). Level i starts where it overtakes level i-1 (the
// smallest table starts where a winning spread first fits the limit); its bets are the optimizer's at that bankroll
// (re-run for that table, so the $5 rounding is real), and "drop at" is where those bets' risk has doubled.
// A generator, a few optimizer runs per step (about 12 ms each), so useDeferred never freezes the page.
// the optimizer for a setup and risk limit: opt(m, B) is the best every-hand spread at an $m table with bankroll B
export function optFor(setup, risk) {
  const R = { ...DEFAULT_RULES, ...(setup.rules || {}) }, cal = calFor(R, setup.seats || 4), spotsMap = setup.spotsMap || {};
  const mn0 = Math.max(1, +setup.minBet || 25), ratio = Math.max(1, (+setup.maxBet || mn0 * 20) / mn0);
  const b0 = {}; COUNTS.forEach((c) => (b0[c] = mn0));
  const rph = setup.hphAuto ? autoRph(roundFreqs(b0, spotsMap, cal), b0, spotsMap, cal) : Math.max(1, setup.handsPerHour || 100);
  const opt = (m, B) => {
    const mx = Math.max(m, Math.round((ratio * m) / 5) * 5), r = optimizeSpread({ B, mn: m, mx, cal, entry: -3, belowMode: "min", spotsMap, rorCap: risk });
    const ok = r.ev > 0 && r.ror <= risk * 1.001, va = r.va > 0 ? r.va : r.ev > 0 && r.ror > 0 && r.ror < 1 ? (-2 * r.ev * B) / Math.log(r.ror) : 0;
    return { ok, ev: ok ? r.ev * rph : 0, sd: Math.sqrt(va * rph), bets: r.bets, mx, ror: r.ror };
  };
  return { opt, rph, mn0, ratio };
}
export function* ladderSteps(setup, risk) {
  const { opt, rph, mn0 } = optFor(setup, risk);
  // 1. the smallest bankroll (in minimums) a winning every-hand spread fits the limit at
  let lo = 40, hi = 80, n = 0;
  while (!opt(mn0, hi * mn0).ok) { lo = hi; hi *= 2; yield; if (hi > 2e5) return { lv: [], rph }; }
  while (hi / lo > 1.015 && n++ < 14) { const mid = Math.sqrt(lo * hi); if (opt(mn0, mid * mn0).ok) hi = mid; else lo = mid; yield; }
  const uMin = hi;
  // 2. dollars an hour (in minimums) as the bankroll grows, until the table maximum stops it rising
  // and the swing that comes with it (V: variance an hour, in minimums squared), so a game can be resized along the curve
  const U = [], E = [], V = []; let flat = 0;
  for (let u = uMin, j = 0; j < 60 && flat < 2; u *= 1.1, j++) {
    const x = opt(mn0, u * mn0), e = x.ev / mn0, v = (x.sd * x.sd) / (mn0 * mn0), keep = E.length && e <= E[E.length - 1];
    flat = E.length && e <= E[E.length - 1] * 1.001 ? flat + 1 : 0; U.push(u); E.push(keep ? E[E.length - 1] : e); V.push(keep ? V[V.length - 1] : v); yield;
  }
  const eAt = (u) => { if (u < uMin) return 0; if (u >= U[U.length - 1]) return E[E.length - 1]; let i = 1; while (U[i] < u) i++; const t = Math.log(u / U[i - 1]) / Math.log(U[i] / U[i - 1]); return E[i - 1] + t * (E[i] - E[i - 1]); };
  // 3. each table starts where it overtakes the one below
  const mins = [...new Set([...TABLE_MINS, mn0])].sort((a, b) => a - b), lv = [], f = Math.log(Math.min(0.999, 2 * risk)) / Math.log(risk);
  for (let i = 0; i < mins.length; i++) {
    const m = mins[i]; let need = m * uMin;
    if (i > 0) {
      const p = mins[i - 1], gain = (B) => m * eAt(B / m) - p * eAt(B / p); let a = m * uMin, b = p * U[U.length - 1] * (m / p) * 1.05;
      if (gain(a) < 0) { for (let k = 0; k < 50; k++) { const mid = (a + b) / 2; if (gain(mid) < 0) a = mid; else b = mid; } need = b; }
    }
    // the real bets for this table at that bankroll (a few percent more if the $5 rounding just misses the limit)
    let x = opt(m, need), tries = 0; while (!x.ok && tries++ < 6) { need *= 1.02; x = opt(m, need); } yield;
    if (!x.ok || !(x.sd > 0)) continue;
    const per = (x.sd * x.sd * -Math.log(risk)) / (2 * x.ev);
    lv.push({ m, need: Math.max(need, lv.length ? lv[lv.length - 1].need * 1.01 : 0), down: Math.min(per, need) * f, ev: x.ev, sd: x.sd, top: Math.max(0, ...COUNTS.map((c) => +x.bets[c] || 0)), bets: x.bets, mx: x.mx });
  }
  return { lv, rph, uMin, usual: mn0, U, E, V };
}
// THE OPTIMIZED GAME (Nick, 17 Nov 2026: "optimize it for you for the target risk of ruin", from the rules selected,
// not from his own spread). At bankroll b: the table the move-up list says (the biggest whose "Move up" b has
// reached), with the best every-hand bets for that table at b — read off the curve above, so the bets are resized to
// sit at the risk limit for the bankroll he has. Below the smallest table's "Move up" no spread fits the limit, so it
// plays that table's smallest spread, over the limit (the page says so). Returns the level, the table, $/hr and swing.
const curveAt = (A, Y, u) => { if (u <= A[0]) return Y[0]; const n = A.length - 1; if (u >= A[n]) return Y[n]; let i = 1; while (A[i] < u) i++; const t = Math.log(u / A[i - 1]) / Math.log(A[i] / A[i - 1]); return Y[i - 1] + t * (Y[i] - Y[i - 1]); };
// `fix` (moving up switched off): stay at that level's table whatever the bankroll does — the bets still follow the
// bankroll along the curve, down to the table's smallest spread inside the limit (u = uMin), and below that they stay
// at that spread, over the limit ("over").
export function autoAt(lad, b, fix = null) {
  const lv = lad && lad.lv; if (!lv || !lv.length || !lad.U || !lad.U.length) return null;
  if (fix != null && lv[fix]) {
    const L = lv[fix], m = L.m;
    if (fix === 0 && b < L.need) return { i: 0, m, ev: L.ev, sd: L.sd, over: true };
    const u = b / m; return { i: fix, m, ev: m * curveAt(lad.U, lad.E, u), sd: m * Math.sqrt(curveAt(lad.U, lad.V, u)), over: u < lad.U[0] };
  }
  let i = 0; for (let k = 1; k < lv.length; k++) if (lv[k].need <= b) i = k;
  if (b < lv[0].need) return { i: 0, m: lv[0].m, ev: lv[0].ev, sd: lv[0].sd, over: true }; // the smallest table's own bets
  const m = lv[i].m, u = b / m;
  return { i, m, ev: m * curveAt(lad.U, lad.E, u), sd: m * Math.sqrt(curveAt(lad.U, lad.V, u)), over: false };
}
export function ladderModel(setup, risk) { const it = ladderSteps(setup, risk); let r; do r = it.next(); while (!r.done); return r.value; }
// your average game from the sessions you have logged: each session's own expected dollars an hour and swing (frozen
// into it when it was logged), weighted by its hours — the same average the Sessions page's Luck check uses
export function averageGame(sessions, mine) {
  let H = 0, e = 0, v = 0, n = 0;
  (sessions || []).forEach((s) => { const h = +s.hours || 0; if (!(h > 0)) return; const sd = sessSd(s, mine.sd); H += h; e += sessEv(s, mine.ev) * h; v += sd * sd * h; n++; });
  return H > 0 ? { ev: e / H, sd: Math.sqrt(v / H), n, hours: H } : null;
}
// what the bankroll has been, session by session, counted back from today's: the start of the chart
export function bankrollHistory(sessions, bankroll) {
  const L = (sessions || []).filter((s) => s && s.date && isFinite(+s.result) && isFinite(dayOf(s.date))).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.id || 0) - (b.id || 0));
  if (!L.length) return [];
  const tot = L.reduce((a, s) => a + +s.result, 0); let cum = 0;
  const pts = [{ t: dayOf(L[0].date) - DAY, v: bankroll - tot }];
  L.forEach((s) => { cum += +s.result; pts.push({ t: dayOf(s.date), v: bankroll - tot + cum }); });
  return pts;
}
// 4,000 bankroll paths over `hours`: play the biggest table the bankroll covers, move up when it reaches the next
// table's bankroll, drop back when it falls below `down` for the table being played. Steps are an hour or less of play
// (up to 960 of them, so even five years resizes about every session); inside each step the lowest and highest point of the path are drawn from their exact
// distributions, so going broke, touching a target and reaching the next table between two steps are all counted. Paths are dealt in mirrored
// pairs (every lucky draw has an unlucky twin), which steadies the typical-bankroll line. Kept at up to ~120
// checkpoints: the 10th / 50th / 90th percentile of the bankroll and every path's highest point so far (for any
// target); and for each table, the share of paths that ever sat at it and the hours by which half of them had.
// in steps (it hands back control every few paths) so useDeferred can run it a slice at a time without freezing the page;
// growthSim below runs the same steps straight through, so the checks and the page see the same numbers
// With `auto` (the move-up list with its curve: the optimized game) the bets are not fixed per table: at the start of
// every session (`sess` hours of play) they are resized to what autoAt says for the bankroll at that moment, table
// and all, and kept for the session — as a player would, between sessions, not hand by hand. Levels then follow the
// bankroll both ways at each "Move up" (the smaller table earns more below it), so there is no separate "drop at".
export function* growthSteps({ B, lv, hours, N = 4000, seed = 20261116, auto = null, sess = 4, fix = null }) {
  const steps = Math.max(60, Math.min(960, Math.ceil(hours))), stride = Math.max(1, Math.round(steps / 120)), dt = hours / steps, sq = Math.sqrt(dt), { u, z } = rng(seed);
  let s0 = 0; lv.forEach((l, i) => { if (l.need <= B * 1.0005) s0 = i; });
  const per = Math.max(1, Math.round(Math.max(dt, sess) / dt)); // steps in a session: the bets are resized every `per` steps
  const cps = []; for (let i = stride; i < steps; i += stride) cps.push(i); cps.push(steps);
  const col = [new Float32Array(N).fill(B), ...cps.map(() => new Float32Array(N))], top = cps.map(() => new Float32Array(N)), dds = new Float32Array(N), end = lv.map(() => 0);
  const first = lv.map((_, j) => new Float32Array(N).fill(j <= s0 ? 0 : Infinity)), zs = new Float64Array(steps), ua = new Float64Array(steps), ub = new Float64Array(steps);
  let bust = 0, below = 0, half = 0;
  for (let p = 0; p < N; p++) {
    const twin = p % 2 === 1; if (!twin) for (let i = 0; i < steps; i++) { zs[i] = z(); ua[i] = u(); ub[i] = u(); }
    let b = B, l = s0, rj = s0, dead = false, hi = B, pk = B, dd = 0, c = 0, g = lv[s0], low = B;
    for (let i = 1; i <= steps; i++) {
      if (!dead) {
        if (auto && (i - 1) % per === 0) { const x = autoAt(auto, b, fix); if (x) { g = x; l = x.i; } } else if (!auto) g = lv[l];
        const a = b, s = g.sd * sq, zi = twin ? -zs[i - 1] : zs[i - 1], u1 = twin ? ua[i - 1] : 1 - ua[i - 1], u2 = twin ? ub[i - 1] : 1 - ub[i - 1]; b = a + g.ev * dt + s * zi;
        const span = (b - a) * (b - a), lowest = (a + b - Math.sqrt(span - 2 * s * s * Math.log(u1 || 1e-300))) / 2, highest = (a + b + Math.sqrt(span - 2 * s * s * Math.log(u2 || 1e-300))) / 2;
        if (pk - lowest > dd) dd = Math.min(pk, pk - lowest); if (lowest < low) low = lowest;
        if (lowest <= 0) { b = 0; dead = true; if (a > hi) hi = a; }
        else {
          if (highest > hi) hi = highest; if (b > pk) pk = b;
          if (auto) { while (rj < lv.length - 1 && highest >= lv[rj + 1].need) { rj++; first[rj][p] = i * dt; } }
          else { while (l < lv.length - 1 && highest >= lv[l + 1].need) { l++; if (first[l][p] === Infinity) first[l][p] = i * dt; } while (l > 0 && b < lv[l].down) l--; }
        }
      }
      if (i === cps[c]) { col[c + 1][p] = b; top[c][p] = hi; c++; }
    }
    if (auto && !dead) { const x = autoAt(auto, b, fix); if (x) l = x.i; } // the table the final bankroll would be played at
    dds[p] = dd; if (dead) bust++; if (b < B) below++; if (low <= B / 2) half++; end[l]++;
    if ((p & 15) === 15) yield;
  }
  const q = (a, f) => a[Math.min(N - 1, Math.floor(f * N))];
  let ends = null;
  const pts = col.map((a, i) => { const x = Float32Array.from(a).sort(); if (i === col.length - 1) ends = x; return { h: i === 0 ? 0 : cps[i - 1] * dt, lo: q(x, 0.1), q1: q(x, 0.25), mid: q(x, 0.5), q3: q(x, 0.75), hi: q(x, 0.9) }; });
  dds.sort();
  const reach = first.map((a) => { const x = Float32Array.from(a).sort(); let n = 0; while (n < N && x[n] !== Infinity) n++; return { p: n / N, med: n >= N / 2 ? x[Math.floor(N / 2)] : null }; });
  return { pts, s0, N, top, reach, cpH: cps.map((i) => i * dt), ddMid: q(dds, 0.5), ddBad: q(dds, 0.9), bust: bust / N, below: below / N, half: half / N, ends, end: end.map((n) => n / N) };
}
// ---------- dealing the future with real cards ----------
// Nick: "simulate the future bankroll and show how the simulation played out on that graph", accurate, in under 10
// seconds, and "rerun a simulation more than once to see how it can change". The 4,000 futures above are drawn from
// each hour's average and swing; these are dealt with real blackjack instead, card by card, by the same simulator the
// calculator's tables were measured on (src/sim.js: the full table of players, BJA strategy and count plays, insurance
// at +3, the cut card), betting the game's own bets at every true count, two hands where Bet spread plays two. So each
// line is one whole future as it could really happen, and their spread is a check on the model.
//   game: { kind: "auto" | "fixed", lad (auto), lv (fixed: levels with `m`, `need`), bets (fixed: at lv[0]) }
// The optimized game resizes at the start of every session to the best bets for the bankroll at that moment, rounded
// down to a step of 5% of bankroll (a player resizes in steps, and the optimizer is run once per step, then kept).
// It writes into `out` as it goes (out.paths, out.rounds) and stops after the path in hand once out.stop is set.
const _betGrid = new Map(); // optimizer answers per bankroll step, kept across runs ("Deal again" starts at once)
export function* dealSteps({ setup, risk, game, B, hours, sess, rph, seed, step = 0.05 }, out) {
  const R = { ...DEFAULT_RULES, ...(setup.rules || {}) }, seats = setup.seats || 4, spotsMap = setup.spotsMap || {};
  const T = Math.max(1, Math.round(hours * rph)), S = Math.max(1, Math.round(sess * rph)), lv = game.kind === "auto" ? game.lad.lv : game.lv;
  let betsAt;
  if (game.kind === "auto") {
    const fix = game.fix == null ? null : game.fix, key = JSON.stringify([setup.rules, seats, spotsMap, setup.minBet, setup.maxBet, setup.hphAuto, setup.handsPerHour, risk, step, fix]);
    if (!_betGrid.has(key)) { if (_betGrid.size > 6) _betGrid.clear(); _betGrid.set(key, new Map()); }
    const memo = _betGrid.get(key), base = lv[0].need, st = Math.log(1 + step); let O = null;
    betsAt = (b) => {
      const k = b < base ? -1 : Math.floor(Math.log(b / base) / st + 1e-9); let x = memo.get(k);
      if (!x) { if (!O) O = optFor(setup, risk).opt; const g = k < 0 ? base : base * Math.exp(k * st), a = autoAt(game.lad, g, fix); x = { m: a.m, i: a.i, bets: O(a.m, Math.max(g, a.m * game.lad.U[0])).bets }; memo.set(k, x); }
      return x;
    };
  } else {
    const lvl = lv.map((l, i) => ({ m: l.m, i, bets: Object.fromEntries(COUNTS.map((c) => [c, i === 0 ? +game.bets[c] || 0 : Math.max(l.m, Math.round(((+game.bets[c] || 0) * l.m) / lv[0].m / 5) * 5)])) }));
    betsAt = (b) => { let i = 0; for (let k = 1; k < lvl.length; k++) if (lv[k].need <= b) i = k; return lvl[i]; };
  }
  const nSess = Math.ceil(T / S), spots = new Int8Array(10), unit = new Float64Array(10);
  for (let p = 0; !out.stop && p < (out.max || 1e9); p++) {
    const g = makeGame(R, seats, ((seed >>> 0) ^ Math.imul(p + 1, 2654435761)) >>> 0 || 1, { perShoe: true });
    const pts = new Float32Array(nSess + 1), first = lv.map((l) => (l.need <= B * 1.0005 ? 0 : Infinity));
    let b = B, low = B, peak = B, dd = 0, dead = false, deadAt = null, t = 0, j = 0, rj = 0; pts[0] = B; while (rj < lv.length - 1 && lv[rj + 1].need <= B * 1.0005) rj++;
    while (t < T) {
      const x = betsAt(b); for (let k = 0; k < 10; k++) { const c = COUNTS[k], v = +x.bets[c] || 0; unit[k] = v; spots[k] = v > 0 ? (spotsMap[c] === 2 && seats < 7 ? 2 : 1) : 0; }
      const end = Math.min(T, t + S);
      for (; t < end; t++) {
        const r = g.next((k) => spots[k]); if (!r.nu) continue;
        b += unit[r.b] * (r.x0 + (r.nu === 2 ? r.x1 : 0));
        if (b <= 0) { b = 0; dead = true; deadAt = (t + 1) / rph; break; }
        if (b < low) low = b; if (b > peak) peak = b; else if (peak - b > dd) dd = peak - b;
        while (rj < lv.length - 1 && b >= lv[rj + 1].need) { rj++; first[rj] = (t + 1) / rph; }
        if ((t & 2047) === 2047) { out.rounds += 2048; yield; }
      }
      pts[++j] = b; if (dead) { while (j < nSess) pts[++j] = 0; break; }
    }
    out.rounds += t & 2047;
    out.paths.push({ pts, end: b, low: dead ? 0 : low, high: peak, dd: dead ? peak : dd, dead, deadAt, first, table: betsAt(b).m, hands: t });
    yield;
  }
  return out;
}
export function dealSim(o, max) { const out = { paths: [], rounds: 0, stop: false, max }; const it = dealSteps(o, out); while (!it.next().done); return out; }
export function growthSim(o) { const it = growthSteps(o); let r; do r = it.next(); while (!r.done); return r.value; }
// the chance of touching `goal` within the simulated span, and the hours by which half the paths have (null if fewer do)
export function goalStats(sim, goal) {
  const frac = (a) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] >= goal) n++; return n / sim.N; };
  const p = frac(sim.top[sim.top.length - 1]); let med = null;
  if (p >= 0.5) for (let c = 0; c < sim.top.length; c++) if (frac(sim.top[c]) >= 0.5) { med = sim.cpH[c]; break; }
  return { p, med };
}
function GrowthChart({ sim, B, lv, flat, hours, whenOf, hist, ladder, dealt }) {
  // hist: what the bankroll has been ({ h, v }, h in hours of play before today at your pace, so negative), drawn to the
  // left of today. ladder: draw the table lines and the "never moving up" line (only when moving up is included).
  const narrow = useNarrow(), W = narrow ? 350 : 520, H = narrow ? 214 : 232, P = { l: 34, r: 8, t: 12, b: 24 }, past = hist && hist.length > 1 ? hist : null, h0 = past ? past[0].h : 0;
  // 4,000 paths leave the percentile lines a little ragged: a light running average steadies them for drawing only
  // (the figures printed around the chart are the exact ones). The first point stays today's bankroll.
  const pts = useMemo(() => { const raw = sim.pts, n = raw.length, w = Math.max(1, Math.round(n / 40)); return raw.map((p, i) => { if (!i) return p; const a = Math.max(1, i - w), b = Math.min(n - 1, i + w), o = { h: p.h }; ["lo", "q1", "mid", "q3", "hi"].forEach((k) => { let t = 0; for (let j = a; j <= b; j++) t += raw[j][k]; o[k] = t / (b - a + 1); }); return o; }); }, [sim]);
  const end = sim.pts[sim.pts.length - 1], cid = "gc" + useId().replace(/[^a-zA-Z0-9]/g, "");
  // the dealt futures (real cards): up to 80 drawn faintly, one bright once the deal is done. The scale makes room for
  // the bright one and for where the middle 8 in 10 of them ended; the rest are clipped at the chart's edge.
  const dl = dealt && dealt.paths && dealt.paths.length && dealt.hours === hours ? dealt : null, hi = dl ? brightOf(dl) : -1, hlP = hi >= 0 ? dl.paths[hi] : null;
  const dEnds = dl ? dl.paths.map((p) => p.end).sort((a, b) => a - b) : [], dq = (f) => dEnds[Math.min(dEnds.length - 1, Math.floor(f * dEnds.length))];
  const dRange = dl ? [...(hlP ? Array.from(hlP.pts) : []), dq(0.1), dq(0.9)] : [];
  const hiV = Math.max(...pts.map((p) => p.hi), B, ...(past ? past.map((p) => p.v) : []), ...dRange) * 1.05, loV = Math.max(0, Math.min(...pts.map((p) => p.lo), B, ...(past ? past.map((p) => p.v) : []), ...dRange) * 0.94);
  const x = (h) => P.l + ((h - h0) / (hours - h0)) * (W - P.l - P.r), y = (v) => H - P.b - ((v - loV) / Math.max(1, hiV - loV)) * (H - P.t - P.b);
  const fs = narrow ? 10.5 : 10, lab = (v) => (v >= 1e6 ? `$${+(v / 1e6).toFixed(1)}M` : v >= 1000 ? `$${+(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`);
  // round money in a gutter on the left, as wide as its longest label: three or four labels on a 1 / 2 / 2.5 / 5 step
  const raw = (hiV - loV) / 3.5, pw = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw)))), fr = raw / pw, stepV = (fr <= 1 ? 1 : fr <= 2 ? 2 : fr <= 2.5 ? 2.5 : fr <= 5 ? 5 : 10) * pw;
  const yt = []; for (let v = Math.ceil(loV / stepV) * stepV; v <= hiV; v += stepV) if (y(v) > P.t + 4 && y(v) < H - P.b - 8) yt.push(v);
  P.l = Math.max(26, ...yt.map((v) => lab(v).length * fs * 0.62 + 10));
  // table lines that fit the chart, never two labels on top of each other (room for the labels only when there are any)
  const marks = []; if (ladder) lv.forEach((l, i) => { if (i > sim.s0 && l.need > loV && l.need < hiV && marks.every((m) => Math.abs(y(m.need) - y(l.need)) > 13)) marks.push(l); }); if (marks.length) P.r = Math.max(...marks.map((l) => `$${l.m} tables`.length)) * fs * 0.6 + 12;
  const xy = (h, v) => `${x(h).toFixed(1)},${y(v).toFixed(1)}`, line = (k) => pts.map((p, i) => `${i ? "L" : "M"}${xy(p.h, p[k])}`).join("");
  const area = (a, b) => line(a) + pts.slice().reverse().map((p) => `L${xy(p.h, p[b])}`).join("") + "Z", band = area("hi", "lo"), half = area("q3", "q1");
  const ticks = past ? [h0, 0, hours] : [0, 0.5, 1].map((f) => f * hours);
  const dLine = (p) => { let d = ""; const n = p.pts.length; for (let j = 0; j < n; j++) d += `${j ? "L" : "M"}${xy(Math.min(hours, j * dl.ph), p.pts[j])}`; return d; };
  const dHl = hlP ? dLine(hlP) : "", dRest = dl ? dl.paths.slice(0, 80).filter((p) => p !== hlP).map(dLine) : [];
  const pastLine = past ? past.map((p, i) => `${i ? "L" : "M"}${xy(p.h, p.v)}`).join("") : "", pastArea = past ? `${pastLine}L${x(0).toFixed(1)},${H - P.b}L${x(h0).toFixed(1)},${H - P.b}Z` : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full block pgchart" role="img" aria-label={`${past ? `Your bankroll so far, from ${shortMoney(past[0].v)} to ${shortMoney(B)} today, then ` : ""}the next ${Math.round(hours)} hours of play: typically ${shortMoney(end.mid)}, 8 times in 10 between ${shortMoney(end.lo)} and ${shortMoney(end.hi)}`}>
      <defs><clipPath id={cid}><rect x={P.l} y={P.t - 4} width={W - P.l - P.r} height={H - P.b - P.t + 4} /></clipPath></defs>
      {yt.map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="rgba(var(--fg),.055)" /><text x={P.l - 7} y={y(v) + 3.5} textAnchor="end" fill="var(--muted)" style={{ font: `500 ${fs}px Inter` }}>{lab(v)}</text></g>)}
      <g key={`${hours}|${B}|${lv.length}|${Math.round(end.mid)}|${past ? past.length : 0}`}>
        {past && <path className="fadein" d={pastArea} fill="rgba(var(--fg),.04)" />}
        <path className="fadein" d={band} fill="rgba(var(--acc),.13)" />
        <path className="fadein" d={half} fill="rgba(var(--acc),.2)" />
        {marks.map((l) => <g key={l.m} className="fadein"><line x1={x(0)} x2={W - P.r} y1={y(l.need)} y2={y(l.need)} stroke="rgba(var(--fg),.22)" strokeDasharray="2 4" /><text x={W - P.r + 6} y={y(l.need) + 3.5} fill="var(--muted)" style={{ font: `600 ${fs}px Inter` }}>${l.m} tables</text></g>)}
        {ladder && flat != null && <line className="fadein" x1={x(0)} y1={y(B)} x2={x(hours)} y2={y(B + flat * hours)} stroke="rgba(var(--fg),.42)" strokeDasharray="4 4" />}
        {dl && <g clipPath={`url(#${cid})`}>{dRest.map((d, i) => <path key={i} d={d} fill="none" stroke="rgba(var(--fg),.16)" strokeWidth="1" strokeLinejoin="round" />)}</g>}
        {past && <path className="drawline" pathLength="1" d={pastLine} fill="none" stroke="rgba(var(--fg),.6)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />}
        <path className="fadein late" d={line("mid")} fill="none" stroke="rgba(var(--acc),.2)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
        <path className={"drawline" + (past ? " late" : "")} pathLength="1" d={line("mid")} fill="none" stroke="var(--brass)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <circle className="popin late" cx={x(hours)} cy={y(pts[pts.length - 1].mid)} r="4" fill="var(--brass)" />
        {hlP && <g key={`hl${dl.run}|${hi}`} clipPath={`url(#${cid})`}><path className="drawline" pathLength="1" d={dHl} fill="none" stroke="var(--ivory)" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" /><circle className="popin late" cx={x(hours)} cy={y(hlP.end)} r="3.4" fill="var(--ivory)" /></g>}
        {past && <line className="fadein" x1={x(0)} x2={x(0)} y1={P.t} y2={H - P.b} stroke="rgba(var(--fg),.2)" strokeDasharray="2 3" />}
        <circle className="popin" cx={x(0)} cy={y(B)} r="3.6" fill="var(--ivory)" stroke="rgba(var(--sh),.5)" strokeWidth="1" />
      </g>
      <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} stroke="rgba(var(--fg),.14)" />
      {ticks.map((h, i) => (past && i === 0 && x(0) - P.l < 78 ? null : <text key={i} x={i === 0 ? P.l : i === 2 ? W - P.r : x(h)} y={H - 7} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fill={h === 0 ? "var(--ivory-d)" : "var(--muted)"} style={{ font: `${h === 0 ? 600 : 500} ${fs}px Inter` }}>{h === 0 ? "Today" : h < 0 ? whenOf(h) : whenOf(h)}</text>))}
    </svg>
  );
}
// `mine` is your own spread as Bet spread prices it: { ev, sd, ror, mn, bets, rph, rps, loses }.
// What the chart ("Where it's heading") plays, prefs.game:
//   "auto" (the default since Nick's instruction of 17 Nov 2026): THE OPTIMIZED GAME — for the rules selected, the best
//     every-hand bets for the bankroll at the risk limit, resized every session and moved up and down the tables of the
//     move-up list (autoAt). Nothing about his own spread is used, only the rules, table ratio, seats and pace.
//   "logged": his average logged game (averageGame: each session's own snapshot, by hours), held steady, or scaled up
//     the tables when "Include moving up" is on. "spread": the spread on Bet spread today, the same way.
// The move-up list, the bar to the next table and its dates are the optimized game in every case.
// A result worked out for one key carries that key (and what it was worked out from), so a value kept on screen while
// the next is worked out can be told apart from a fresh one. Without it the page once showed the 5% chart under a
// 0.5% label for good: the chart started before the new limit's tables were ready, used the old ones, and was kept as
// the new limit's answer.
function* tagged(it, k, extra) { const r = yield* it; return r ? { ...r, _k: k, ...(extra || {}) } : r; }
function useGrowth(mine, bankroll, prefs, sessions, setup) {
  const risk = prefs.risk, hpw = prefs.hours, hours = prefs.weeks * hpw, sess = sessLenOf(mine);
  const whenOf = (h) => { const w = h / hpw; return w > 520 ? "10+ years" : new Date(addDays(Date.now(), w * 7)).toLocaleDateString(undefined, { month: "short", year: "numeric" }); };
  const avg = useMemo(() => averageGame(sessions, mine), [sessions, mine]);
  const logged = avg && avg.ev > 0 && avg.sd > 0 ? avg : null;
  const kind = prefs.game === "spread" ? "spread" : prefs.game === "logged" && logged ? "logged" : "auto";
  const game = useMemo(() => (kind === "logged" ? { ...mine, ev: logged.ev, sd: logged.sd, loses: false } : mine), [kind, logged, mine]);
  // a fixed game (logged or spread), never resized, from today's bankroll: its long-run risk of ruin and the bankroll it needs at the limit
  const wins = game.ev > 0 && game.sd > 0, gameRor = wins && bankroll > 0 ? Math.exp((-2 * game.ev * bankroll) / (game.sd * game.sd)) : 0, gameNeed = wins ? (game.sd * game.sd * -Math.log(risk)) / (2 * game.ev) : 0;
  const topBet = Math.max(0, ...COUNTS.map((c) => +(mine.bets || {})[c] || 0));
  // the ladder and its curve: worked out once per game and risk limit (it doesn't depend on the bankroll), then marked from where you stand
  const ladKey = setup ? "lad" + JSON.stringify([setup.rules, setup.seats, setup.spotsMap, setup.minBet, setup.maxBet, setup.hphAuto, setup.handsPerHour, risk]) : null;
  const lad = useDeferred(ladKey, () => tagged(ladderSteps(setup, risk), ladKey), true), ladFresh = !!lad && lad._k === ladKey;
  const ladder = useMemo(() => { if (!lad || !lad.lv || !lad.lv.length || !(bankroll > 0)) return null; const lv = markLevels(lad.lv.map((l) => ({ ...l })), bankroll); return { lv, cur: lv.filter((l) => l.state === "now").pop() || null, usual: lad.usual }; }, [lad, bankroll]);
  // the optimized game today: its table, $/hr and swing off the curve, and the real bets ($5 steps) from one optimizer run
  const today = useMemo(() => (lad && bankroll > 0 ? autoAt(lad, bankroll) : null), [lad, bankroll]);
  const todayBets = useDeferred(today && setup && ladFresh ? ladKey + "|bets|" + Math.round(bankroll) : null, () => { const L = lad.lv[today.i], x = optFor(setup, risk).opt(today.m, today.over ? L.need : bankroll); return { top: Math.max(0, ...COUNTS.map((c) => +x.bets[c] || 0)), bets: x.bets }; }, true);
  const todayRor = today && today.over ? Math.exp((-2 * today.ev * bankroll) / (today.sd * today.sd)) : 0;
  // the game the chart deals, as levels. Auto: the move-up list itself, resized along its curve. Logged / spread with
  // "Include moving up": that game as it is today until the bankroll reaches the list's "Move up" for a table bigger
  // than the one being played now, then in step with the table (a $50 table is twice a $25 one), back down below it.
  const model = useMemo(() => {
    if (!(bankroll > 0)) return null;
    if (kind === "auto") return ladder && today ? { lv: ladder.lv, auto: lad, fix: prefs.moveUp ? null : today.i, steady: !prefs.moveUp } : null;
    if (!(game.ev > 0) || !(game.sd > 0)) return null;
    const base = { m: game.mn || 0, need: 0, down: 0, ev: game.ev, sd: game.sd, top: topBet, state: "now" };
    if (!prefs.moveUp || !ladder) return { lv: [base], steady: true };
    const ref = Math.max(+game.mn || 0, ladder.cur ? ladder.cur.m : 0) || ladder.lv[0].m, ups = ladder.lv.filter((l) => l.m > ref && l.need > bankroll);
    return { lv: [{ ...base, m: ref }, ...ups.map((l) => ({ m: l.m, need: l.need, down: l.need, ev: (game.ev * l.m) / ref, sd: (game.sd * l.m) / ref, top: (topBet * l.m) / ref, state: "later" }))], steady: !ups.length };
  }, [kind, game, bankroll, prefs.moveUp, topBet, ladder, lad, today]);
  const key = model ? (model.auto ? "auto|" + ladKey + "|" + bankroll + "|" + sess + "|" + model.fix : JSON.stringify([bankroll, risk, model.lv.map((l) => [l.m, Math.round(l.need), Math.round(l.down), Math.round(l.ev * 100), Math.round(l.sd)])])) : null;
  // the simulated futures are the heavy part: they follow a moment behind, and typing a target never re-deals them.
  // They wait for fresh tables (a game that uses them), carry the levels and model they were dealt with, and the last
  // one stays on screen, marked stale, until the next is in
  const full = key && hours > 0 ? key + "|" + hours : null, needLad = kind === "auto" || !!prefs.moveUp;
  const ask = full && (!needLad || ladFresh) ? full : null;
  const simNew = useDeferred(ask, () => tagged(growthSteps({ B: bankroll, lv: model.lv, hours, auto: model.auto || null, sess, fix: model.fix == null ? null : model.fix }), ask, { lv: model.lv, model, B: bankroll, hours }), true);
  const held = useRef(null); if (simNew && simNew._k === ask) held.current = simNew;
  const sim = model ? held.current : null, simStale = !!sim && sim._k !== full;
  const goal = +prefs.goal > bankroll ? +prefs.goal : bankroll * 2, fits = (x, lv) => (x && lv && x.end.length === lv.length ? x : null);
  const goalS = useMemo(() => (sim && !simStale ? goalStats(sim, goal) : null), [sim, simStale, goal]);
  // what the bankroll has been: at most half as far back as the chart looks ahead, in hours of play at your pace
  const hist = useMemo(() => {
    const all = bankrollHistory(sessions, bankroll); if (all.length < 2 || !(hpw > 0)) return null;
    const today0 = startOfDay(Date.now()), pts = all.map((p) => ({ h: (-Math.max(0, daysBetween(p.t, today0)) / 7) * hpw, v: p.v })), back = -hours / 2;
    const cut = pts.filter((p) => p.h < back), keep = pts.filter((p) => p.h >= back);
    return [...(cut.length ? [{ h: back, v: cut[cut.length - 1].v }] : []), ...keep, { h: 0, v: bankroll }];
  }, [sessions, bankroll, hpw, hours]);
  // a much longer deal of the optimized game answers "when do I reach each table, and how often": three times the
  // expected wait for the furthest table shown
  const lastL = ladder ? ladder.lv.filter((l) => l.state === "later").slice(0, 4).pop() : null, farH = lastL ? Math.min(120000, Math.max(2000, lastL.hrs * 3)) : 0;
  const far = useDeferred(ladder && ladFresh && farH ? ladKey + "|far|" + bankroll + "|" + sess + "|" + Math.round(farH) : null, () => growthSteps({ B: bankroll, lv: ladder.lv, hours: farH, N: 3000, auto: lad, sess }), true);
  return { risk, hpw, hours, sess, whenOf, kind, model, logged, game, gameRor, gameNeed, noEdge: !!avg && !logged, goal, goalS, hist, sim, simStale, ladFresh, ladder, lad, today, todayBets, todayRor, ladBusy: !!ladKey && !lad, far: fits(far, ladder && ladder.lv), loading: (!!model && !sim) || (kind === "auto" && !!ladKey && !lad) };
}
// Deals the future with real cards on the page, a few milliseconds at a time (taps and scrolling stay live), for as
// many whole futures as fit in DEAL_MS of wall time — 12 seconds (Nick: "do the multiple real play charts again and
// showing the bright one this time give it double the time"; it was 6 s, then one future at a time) — finishing the
// one in hand, at most DEAL_MAX. "Stop" ends it early after the future in hand. Each run uses new shoes.
const DEAL_MS = 12000, DEAL_MAX = 400;
let _mc = null; const _mq = [];
const later = (f) => { try { if (!_mc) { _mc = new MessageChannel(); _mc.port1.onmessage = () => { const g = _mq.shift(); if (g) g(); }; } _mq.push(f); _mc.port2.postMessage(0); } catch (_) { setTimeout(f, 0); } };
function useDeal(gr, setup, mine, bankroll) {
  const [st, setSt] = useState(null), job = useRef(null);
  const game = !setup || !(bankroll > 0) ? null : gr.kind === "auto" ? (gr.ladFresh && gr.lad.lv && gr.lad.lv.length && gr.model ? { kind: "auto", lad: gr.lad, fix: gr.model.fix == null ? null : gr.model.fix } : null) : gr.kind === "spread" && gr.model && mine.bets ? { kind: "fixed", lv: gr.model.lv, bets: mine.bets } : null;
  const rph = gr.kind === "auto" ? gr.lad && gr.lad.rph : mine.rph;
  const key = game && rph > 0 ? JSON.stringify([gr.kind, game.kind === "fixed" ? [game.lv.map((l) => [l.m, Math.round(l.need)]), mine.bets] : game.fix, setup.rules, setup.seats, setup.spotsMap, setup.minBet, setup.maxBet, gr.risk, bankroll, gr.hours, gr.sess]) : null;
  const stop = () => { if (job.current) { job.current.cancel = true; job.current = null; } };
  useEffect(() => stop, []);
  useEffect(() => { stop(); setSt(null); }, [key]); // eslint-disable-line
  const start = () => {
    if (!key) return; stop();
    const run = (st && st.key === key ? st.run : 0) + 1, out = { paths: [], rounds: 0, stop: false, max: DEAL_MAX }, me = { cancel: false, out };
    const it = dealSteps({ setup, risk: gr.risk, game, B: bankroll, hours: gr.hours, sess: gr.sess, rph, seed: (Date.now() ^ Math.imul(run, 7919)) >>> 0 }, out);
    const t0 = performance.now(), ph = Math.round(gr.sess * rph) / rph; let pushed = 0;
    const push = (done) => setSt((o) => ({ key, run, paths: out.paths.slice(), rounds: out.rounds, ms: performance.now() - t0, done, pick: o && o.key === key ? o.pick : "mid", ph, hours: gr.hours, B: bankroll }));
    job.current = me; push(false);
    const tick = () => {
      if (me.cancel) return; const s0 = performance.now(); let r;
      do r = it.next(); while (!r.done && performance.now() - s0 < 12);
      if (performance.now() - t0 > DEAL_MS) out.stop = true;
      if (r.done) { job.current = null; push(true); return; }
      if (performance.now() - pushed > 160) { pushed = performance.now(); push(false); }
      later(tick);
    };
    later(tick);
  };
  const halt = () => { if (job.current) job.current.out.stop = true; };
  const pick = (p) => setSt((o) => (o ? { ...o, pick: p } : o));
  return { d: st && st.key === key ? st : null, start, halt, pick, can: !!key, busy: !!(st && st.key === key && !st.done) };
}
// which dealt future is drawn bright: the worst, the typical (the middle one by where it ended) or the best, or one
// picked by "Another"
export function brightOf(d) {
  if (!d || !d.done || !d.paths.length) return -1;
  const n = d.paths.length, ord = d.paths.map((p, i) => i).sort((a, b) => d.paths[a].end - d.paths[b].end);
  return typeof d.pick === "number" ? d.pick % n : d.pick === "low" ? ord[0] : d.pick === "high" ? ord[n - 1] : ord[Math.floor((n - 1) / 2)];
}
// Right column, top: where the bankroll stands today
const sessLenOf = (mine) => { const h = +(mine && mine.sessHours); return h > 0 ? Math.round(h * 4) / 4 : 4; };
const sgnShort = (v) => (v < 0 ? "\u2212" : "+") + shortMoney(Math.abs(v));
function BankrollNow({ gr, mine, bankroll, prefs, go }) {
  const { ladder, far, whenOf, risk, ladBusy } = gr, cur = ladder && ladder.cur, next = ladder ? ladder.lv.find((l) => l.state === "later" || l.state === "short") : null, ni = next ? ladder.lv.indexOf(next) : -1;
  const hpw = gr.hpw, mh = (hpw * 365.25) / 84, mEv = mine.ev * mh, mSd = mine.sd * Math.sqrt(mh), sessLen = sessLenOf(mine), cash = upTo50(cashFor(mine, sessLen)), wins = mine.ev > 0 && mine.sd > 0, over = wins && mine.ror > risk * 1.001;
  const ownNeed = wins ? (mine.sd * mine.sd * -Math.log(risk)) / (2 * mine.ev) : 0, reach = far && next && next.state === "later" ? far.reach[ni] : null;
  // how far the bankroll has come from the table it covers now (or from nothing) to the next one
  const base = cur ? cur.need : 0, way = next ? Math.max(0, Math.min(1, (bankroll - base) / Math.max(1, next.need - base))) : 0;
  return (
    <section className="card p-5 mb-4">
      <div className="flex items-baseline justify-between gap-3"><div className="eyebrow">Your bankroll</div><button className="text-[11px] font-semibold lnk" style={{ color: "var(--brass)" }} onClick={() => go("calc")}>Change spread ›</button></div>
      {!(bankroll > 0) ? <p className="text-sm mt-2" style={{ color: "var(--ivory-d)" }}>Set your bankroll on the Bet spread page first.</p> : <>
        <div className="pghead" style={{ marginTop: 10 }}>
          <div><div className="pgbig" style={{ color: "var(--ivory)" }}>{money(bankroll)}</div><div className="pgsub">{cur ? `Covers $${cur.m} tables, playing every hand at ${rk(risk)} risk` : ladder ? `Not enough for $${ladder.lv[0].m} tables yet, playing every hand at ${rk(risk)} risk` : ladBusy ? "Working out the tables…" : "No table wins playing every hand"}</div></div>
        </div>
        {next && <div className="mt-4">
          <div className="ptrack big"><i className="barx ok" style={{ width: `${Math.max(3, Math.min(100, 100 * way))}%` }} /></div>
          <div className="flex items-baseline justify-between gap-3 text-xs mt-2"><span style={{ color: "var(--ivory-d)" }}><b style={{ color: "var(--ivory)" }}>${next.m} tables</b> at {shortMoney(next.need)} · {shortMoney(Math.max(0, next.need - bankroll))} to go</span><span style={{ color: "var(--muted)" }}>{next.state !== "later" ? "" : reach && reach.med != null ? `typically ${whenOf(reach.med)}` : reach ? "a long way off" : "…"}</span></div>
        </div>}
        {/* these three use Nick's own spread from Bet spread, not the every-hand bets above: the label says so, and an
            over-limit spread is told once, in the risk's own line (it was a red box over the bar as well) */}
        {wins ? <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--sep)" }}>
          <div className="lab">Playing your spread from Bet spread{mine.mn ? ` · $${mine.mn} tables` : ""}</div>
          <div className="pstats mt-2">
            <div className="pstat"><div>A normal month</div><div style={{ color: mEv >= 0 ? "var(--ivory)" : "var(--neg-l)" }}>{sgnMoney(mEv)}</div><div>8 months in 10: {sgnShort(mEv - 1.2816 * mSd)} to {sgnShort(mEv + 1.2816 * mSd)}</div></div>
            <div className="pstat"><div>Bring per session</div><div>{cash ? money(cash) : "—"}</div><div>enough for {sessLen} hours, 19 times in 20</div></div>
            <div className="pstat"><div>Risk of ruin</div><div style={{ color: over ? "var(--rose)" : "var(--ivory)" }}>{tinyPct(mine.ror)}</div><div>{over ? `over your ${rk(risk)} limit; it needs ${shortMoney(ownNeed)}` : `inside your ${rk(risk)} limit`}</div></div>
          </div>
        </div> : <p className="text-xs mt-4 pt-4" style={{ color: "var(--ivory-d)", borderTop: "1px solid var(--sep)" }}>Your spread on Bet spread doesn't win yet, so there is no month or session to plan around.</p>}
      </>}
    </section>
  );
}
const bigN = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million` : n >= 1000 ? `${Math.round(n / 1000)},000` : String(Math.round(n)));
// "See it played out": futures dealt with real cards onto the chart, what they came to beside the 4,000, and the
// story of the bright one (the typical one by default; worst, best or another on a tap)
const pctile = (a, v) => { if (!a || !a.length) return null; let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo / a.length; };
function DealBox({ deal, gr, bankroll, span }) {
  const { d, start, halt, pick, can, busy } = deal, { whenOf, kind, ladder, sim, model } = gr;
  if (!can) return <p className="text-[11px] mt-3" style={{ color: "var(--muted)" }}>{kind === "logged" ? "Your logged average is a dollars-an-hour figure with no bets behind it, so it can't be dealt card by card. Pick Optimized or Spread now to see futures played out." : ""}</p>;
  const P = d ? d.paths : [], n = P.length, ends = P.map((p) => p.end).sort((a, b) => a - b), q = (f) => ends[Math.min(n - 1, Math.floor(f * n))];
  const broke = P.filter((p) => p.dead).length, ahead = P.filter((p) => p.end > bankroll).length, hi = brightOf(d), p = hi >= 0 ? P[hi] : null;
  const m4 = sim ? sim.pts[sim.pts.length - 1] : null, beat = p && sim ? pctile(sim.ends, p.end) : null;
  const ups = p && ladder && model && !model.steady ? ladder.lv.map((l, i) => ({ l, t: p.first[i] })).filter((x) => x.t > 0 && x.t !== Infinity && x.l.state !== "ok" && x.l.state !== "now") : [];
  // the table it started at: today's (optimized) or the game's own
  const startM = kind === "auto" && gr.today ? gr.today.m : model && model.lv[0] ? model.lv[0].m : p ? p.table : 0;
  const top = ups.length ? ups[ups.length - 1] : null, which = typeof d?.pick === "number" ? "pick" : d?.pick || "mid";
  return (
    <div className="pdeal mt-3">
      {!d ? <div className="pdrow">
        <div className="min-w-0"><div className="text-sm font-semibold" style={{ color: "var(--ivory)" }}>See it played out</div><div className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>Deals real blackjack, hand by hand, for {DEAL_MS / 1000} seconds: as many whole futures as fit, drawn on the chart.</div></div>
        <button type="button" className="btn" onClick={start}>Deal it out</button>
      </div> : busy ? <div>
        <div className="pdrow"><div className="text-sm min-w-0" style={{ color: "var(--ivory)" }}>Dealing… <span className="mono">{n}</span> {n === 1 ? "future" : "futures"} · <span className="mono">{bigN(d.rounds)}</span> hands</div><button type="button" className="text-xs font-semibold lnk shrink-0" style={{ color: "var(--brass)" }} onClick={halt}>Stop</button></div>
        <div className="ptrack mt-2.5"><i className="ok" style={{ width: `${Math.min(100, (100 * d.ms) / DEAL_MS)}%`, transition: "width .2s linear" }} /></div>
      </div> : <div>
        <div className="pdrow">
          <div className="min-w-0"><div className="text-sm font-semibold" style={{ color: "var(--ivory)" }}><span className="mono">{n}</span> {n === 1 ? "future" : "futures"} dealt with real cards</div><div className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}><span className="mono">{bigN(d.rounds)}</span> hands in <span className="mono">{(d.ms / 1000).toFixed(1)}</span> s</div></div>
          <button type="button" className="btn ghost" onClick={start}>Deal again</button>
        </div>
        <div className="pstats three mt-3">
          <div className="pstat"><div>Typical</div><div>{shortMoney(q(0.5))}</div><div>the 4,000: {m4 ? shortMoney(m4.mid) : "…"}</div></div>
          <div className="pstat"><div>{n >= 10 ? "8 in 10" : "Range"}</div><div className="text-[15px]">{n >= 10 ? `${shortMoney(q(0.1))}–${shortMoney(q(0.9))}` : `${shortMoney(ends[0])}–${shortMoney(ends[n - 1])}`}</div><div>the 4,000: {m4 ? `${shortMoney(m4.lo)}–${shortMoney(m4.hi)}` : "…"}</div></div>
          <div className="pstat"><div>Went broke</div><div style={{ color: broke ? "var(--neg-l)" : "var(--ivory)" }}>{broke} of {n}</div><div>{ahead} of {n} ended ahead</div></div>
        </div>
        {p && <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="pdrow bl">
            <div className="lab whitespace-nowrap"><i className="pdhl" />The bright line</div>
            <div className="pdpick">{[["low", "Worst"], ["mid", "Typical"], ["high", "Best"]].map(([k, t]) => <button key={k} type="button" className={"gchip" + (which === k ? " on" : "")} onClick={() => pick(k)}>{t}</button>)}{n > 2 && <button type="button" className={"gchip" + (which === "pick" ? " on" : "")} onClick={() => { let r = Math.floor(Math.random() * (n - 1)); if (r >= hi) r++; pick(r); }} aria-label="Another dealt future">Another</button>}</div>
          </div>
          <div className="text-sm mt-2" style={{ color: "var(--ivory)" }}>{p.dead ? <b style={{ color: "var(--neg-l)" }}>Went broke{p.deadAt != null ? ` in ${whenOf(p.deadAt)}` : ""}</b> : <>Ended at <b className="mono">{shortMoney(p.end)}</b> <span className="mono" style={{ color: p.end >= bankroll ? "var(--ivory-d)" : "var(--neg-l)" }}>{sgnShort(p.end - bankroll)}</span>{beat != null && <span className="text-[11.5px]" style={{ color: "var(--muted)" }}> · better than <span className="mono">{Math.round(beat * 100)}%</span> of the 4,000</span>}</>}</div>
          <div className="text-[11.5px] mt-1 leading-relaxed" style={{ color: "var(--ivory-d)" }}>Lowest <span className="mono">{shortMoney(p.low)}</span> · highest <span className="mono">{shortMoney(p.high)}</span> · worst dip <span className="mono">{shortMoney(p.dd)}</span>{top ? <> · ${top.l.m} tables from {whenOf(top.t)}{p.table < top.l.m ? <>, back at ${p.table} by the end</> : ""}</> : p.dead ? "" : p.table < startM ? <> · dropped back to ${p.table} tables</> : <> · stayed at ${p.table} tables</>}</div>
        </div>}
      </div>}
    </div>
  );
}
// part "chart" is "Where it's heading", part "ladder" the move-up list: on a computer the list continues the left
// column (.dgrid.twol, .dcol.contl) so the two columns end near each other; on a phone it stays under the chart
function Growth({ gr, deal, bankroll, prefs, setPrefs, part }) {
  const [more, setMore] = useState(false), [allT, setAllT] = useState(false), [gOpen, setGOpen] = useState(false);
  const statsRef = useGlideH(more), ladRef = useGlideH(allT);
  const { risk, whenOf, kind, model, logged, game, gameRor, gameNeed, noEdge, goal, goalS, sim, simStale, hist, loading, ladder, far, ladBusy, lad, today, todayBets, todayRor, sess } = gr;
  // the chart is drawn with what it was dealt from (a stale one, dimmed, while the next is worked out)
  const sm = sim ? sim.model : model, hours = sim ? sim.hours : gr.hours, auto = kind === "auto", span = spanOf(sim ? sim.hours / prefs.hours : prefs.weeks), up = !!(sm && !sm.steady);
  const cols = "44px minmax(0,1fr) 52px 64px minmax(0,1.3fr)";
  const getting = (l, i) => { const rc = far ? far.reach[i] : null; return l.state === "now" ? "You're here" : l.state === "ok" ? "Covered" : l.state === "short" ? `${shortMoney(l.need - bankroll)} short` : !rc ? "…" : <>{rc.med != null ? whenOf(rc.med) : "rarely"} · <span className="mono">{rc.p > 0.99 ? ">99" : Math.round(rc.p * 100)}%</span></>; };
  const tone = (l) => (l.state === "now" ? "var(--brass)" : l.state === "short" ? "var(--neg-l)" : "var(--ivory-d)");
  const lv = sim ? sim.lv : model ? model.lv : [], start = sim ? lv[sim.s0] : null, last = sim ? sim.pts[sim.pts.length - 1] : null;
  // the dashed comparison line: today's bets kept as they are (optimized), or never moving up (a fixed game moving up)
  const flat = auto ? (today ? today.ev : 0) : start ? start.ev : 0;
  const gain = sim && up ? last.mid - (bankroll + flat * hours) : 0;
  const then = auto && sim && sm.auto ? autoAt(sm.auto, last.mid, sm.fix == null ? null : sm.fix) : null, change = last ? last.mid - bankroll : 0;
  // the move-up list: the table below, the one you're at and the next two; three more behind "More tables"
  const at = ladder ? Math.max(0, ladder.lv.findIndex((l) => l.state === "now")) : 0, lastL = ladder ? ladder.lv.length - 1 : 0;
  const shown = ladder ? ladder.lv.filter((l, i) => i >= at - 1 && i <= at + (allT ? 5 : 2)) : [], hidden = Math.min(lastL, at + 5) - Math.min(lastL, at + 2);
  const games = [["auto", "Optimized"], ...(logged ? [["logged", "Logged"]] : []), ["spread", "Spread now"]];
  return (<>
    {part === "chart" && <section className="card p-5 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="eyebrow">Where it's heading</div>
        <PlanSlider className="horizon" value={hIdx(prefs.weeks)} min={0} max={H_MONTHS.length - 1} label="How far ahead" show={(i) => spanOf(weeksOf(H_MONTHS[i]))} onCommit={(i) => setPrefs({ weeks: weeksOf(H_MONTHS[i]) })} />
      </div>
      {!model ? <p className="text-sm mt-3" style={{ color: loading ? "var(--muted)" : "var(--ivory-d)" }}>{!(bankroll > 0) ? "Set your bankroll on the Bet spread page first." : loading || ladBusy ? "Working out the best bets for these rules…" : auto ? "No table size wins playing every hand with these rules, so there is nothing to project. Try other rules, or the spread you set on Bet spread." : "The spread set on Bet spread doesn't win yet, so there is nothing to project. Switch to Optimized, or find a winning spread there."}</p> : !sim ? <p className="text-sm py-10 text-center" style={{ color: "var(--muted)" }}>{loading ? "Working it out…" : ""}</p> : <>
      <div className={"pgbody" + (simStale ? " stale" : "")} aria-busy={simStale}>
      {simStale && <div className="pgupd">Updating…</div>}
      <div className="pghead">
        <div><div className="pgbig" style={{ color: last.mid < bankroll * 0.5 ? "var(--neg-l)" : "var(--brass)" }}><Glide v={last.mid} f={shortMoney} /></div><div className="pgsub">typical in {span} · <span className="mono" style={{ color: change >= 0 ? "var(--ivory-d)" : "var(--neg-l)" }}>{sgnShort(change)}</span></div></div>
        <div className="pgrange"><div><span className="mono">{shortMoney(last.lo)}</span> to <span className="mono">{shortMoney(last.hi)}</span></div><div className="pgsub">8 times in 10</div></div>
      </div>
      {auto && today && then && <div className="pplan mt-4">
        <div><div className="k">Now</div><div className="v">${today.m} tables</div><div className="s">{todayBets ? <><span className="mono">${today.m}–{shortMoney(todayBets.top)}</span> · </> : ""}<span className="mono">{money(today.ev)}</span>/hr</div></div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        <div><div className="k">By {whenOf(hours)}</div><div className="v">${then.m} tables</div><div className="s">typically · <span className="mono">{money(then.ev)}</span>/hr</div></div>
      </div>}
      {auto && today && today.over && <p className="text-[11.5px] mt-2.5 leading-snug" style={{ color: "var(--muted)" }}>Below {shortMoney(lad.lv[0].need)} it plays the smallest winning spread at ${today.m} tables, at <span style={{ color: "var(--rose)" }}>{pct(todayRor, 0)} risk of ruin</span>.</p>}
      {!auto && gameRor > risk * 1.001 && <p className="pnote mt-3">Too big for {money(bankroll)}: at this size this game goes broke {pct(gameRor, 0)} of the time sooner or later. It needs {shortMoney(gameNeed)} for your {rk(risk)} limit.</p>}
      <div className="mt-3"><GrowthChart sim={sim} B={sim.B} lv={lv} flat={auto ? null : flat} hours={hours} whenOf={whenOf} hist={hist} ladder={up} dealt={deal.d} /></div>
      <div className="plegend mt-2">{hist && <span><i className="ln" style={{ background: "rgba(var(--fg),.6)" }} />your results</span>}<span><i className="ln" style={{ background: "var(--brass)" }} />typical</span><span><i style={{ background: "rgba(var(--acc),.62)" }} />half the time</span><span><i style={{ background: "rgba(var(--acc),.3)" }} />8 in 10</span>{up && !auto && <span><i className="ln dash" />never moving up</span>}{deal.d && deal.d.paths && deal.d.paths.length > 0 && <span><i className="ln" style={{ background: "rgba(var(--fg),.32)" }} />dealt with real cards</span>}</div>
      <DealBox deal={deal} gr={gr} bankroll={bankroll} span={span} />
      <div className="pstats mt-4 pt-4" style={{ borderTop: "1px solid var(--sep)" }} ref={statsRef}>
        <div className="pstat"><div>Ending ahead</div><div style={{ color: sim.below > 0.4 ? "var(--neg-l)" : "var(--ivory)" }}>{Math.round((1 - sim.below) * 100)}%</div><div>above {shortMoney(bankroll)} in {span}</div></div>
        <div className="pstat"><div>Losing half</div><div style={{ color: sim.half > 0.1 ? "var(--neg-l)" : "var(--ivory)" }}>{sim.half < 0.005 ? "<1%" : `${Math.round(sim.half * 100)}%`}</div><div>ever down to {shortMoney(bankroll / 2)}</div></div>
        <div className="pstat"><div>Biggest drop</div><div>{shortMoney(sim.ddMid)}</div><div>from a high, typically; 1 in 10 over {shortMoney(sim.ddBad)}</div></div>
        {more && <>
          <div className="pstat"><div>Going broke</div><div style={{ color: sim.bust > 0.05 ? "var(--neg-l)" : "var(--ivory)" }}>{sim.bust < 0.005 ? "<1%" : `${Math.round(sim.bust * 100)}%`}</div><div>within {span}</div></div>
          {up && sim.s0 < lv.length - 1 && <div className="pstat"><div>Moved up</div><div>{Math.round(100 * sim.end.slice(sim.s0 + 1).reduce((a, b) => a + b, 0))}%</div><div>ending at ${lv[sim.s0 + 1].m} tables or bigger</div></div>}
          {up && !auto && <div className="pstat"><div>Moving up adds</div><div>{gain > 50 ? sgnMoney(gain) : "Not yet"}</div><div>{gain > 50 ? "to the typical result, against never moving up" : `little in ${span}`}</div></div>}
        </>}
      </div>
      <More open={more} onClick={() => setMore(!more)} className="mt-3">{more ? "Fewer stats" : "More stats"}</More>
      </div>
      </>}
      {bankroll > 0 && <div className="pgset mt-4">
        {/* the game the chart plays folds to one line (Nick, 22 Nov: Plan "cleaner looking"); the switch, what it plays
            and "Include moving up" are under Change */}
        <div>
          <button type="button" className="pgrow pgsum rowh text-left" onClick={() => setGOpen(!gOpen)} aria-expanded={gOpen}>
            <span className="text-sm shrink-0" style={{ color: "var(--ivory)" }}>Game</span>
            <span className="flex items-baseline justify-end gap-3 min-w-0"><span className="text-[12.5px] truncate" style={{ color: "var(--ivory-d)" }}>{(games.find((g) => g[0] === kind) || games[0])[1]}{model ? (prefs.moveUp ? " · moving up" : " · no moving up") : ""}</span><span className="text-xs font-semibold shrink-0" style={{ color: "var(--brass)" }}>{gOpen ? "Done" : "Change"}</span></span>
          </button>
          <Fold open={gOpen}><div className="pt-3">
          <div className="pgseg" style={{ width: "100%", maxWidth: logged ? 300 : 230 }}><Seg small value={kind} options={games} onChange={(v) => setPrefs({ game: v })} /></div>
          <div className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>{auto ? <>The best bets for your bankroll at {rk(risk)} risk, playing every hand, resized every {sess}-hour session{prefs.moveUp || !today ? "" : `, staying at $${today.m} tables`}.</> : kind === "logged" ? <>{logged.n} logged session{logged.n === 1 ? "" : "s"}: <span className="mono">{money(logged.ev)}</span>/hr, swings of <span className="mono">{money(logged.sd)}</span>, never resized.</> : game.ev > 0 ? <>Bet spread today: <span className="mono">{money(game.ev)}</span>/hr, swings of <span className="mono">{money(game.sd)}</span>, never resized.</> : "Bet spread today: no edge yet."}{noEdge && !auto ? " Your logged sessions average out to no edge." : ""}</div>
          {model && <div className="mt-1"><Toggle label="Include moving up" sub={prefs.moveUp ? "Up and down the tables in the move-up list" : auto && today ? `Stays at $${today.m} tables; the bets still follow the bankroll` : "Stays at the table you play now"} on={!!prefs.moveUp} onChange={(v) => setPrefs({ moveUp: v })} /></div>}
          </div></Fold>
        </div>
        {model && sim && <div className="pgrow target">
          <label className="flex items-center gap-3 text-sm" style={{ color: "var(--ivory)" }}>Target
            <span className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 mono" style={{ color: "var(--muted)" }}>$</span><input className="in mono" style={{ paddingLeft: 24, width: 116, height: 36 }} type="number" inputMode="numeric" min="0" placeholder={String(Math.round(bankroll * 2))} value={prefs.goal} onChange={(e) => setPrefs({ goal: e.target.value })} aria-label="Target bankroll" /></span></label>
          {goalS && <span className="text-[11.5px] text-right pgoal" style={{ color: "var(--muted)" }}><span className="mono font-semibold text-sm" style={{ color: "var(--ivory)" }}>{Math.round(goalS.p * 100)}%</span> reach {shortMoney(goal)}{goalS.med != null ? <>, typically by {whenOf(goalS.med)}</> : ""}</span>}
        </div>}
      </div>}
      {bankroll > 0 && <Info label="How this works">
        <b>Optimized</b> doesn't use your own spread. For the rules you have selected, it finds the bets that earn the most an hour while keeping your risk of ruin at {rk(risk)}, for the bankroll you have, playing every hand, with the table's maximum the same multiple of its minimum as on Bet spread. As the bankroll grows the bets grow and you move up to bigger tables at the "Move up" figures in the list below; when it shrinks they shrink, and you drop back a table below its figure. With "Include moving up" off you stay at the table you play today: the bets still grow and shrink with the bankroll, up to what that table's maximum allows and down to its smallest spread inside the limit (below that they stay at it, over the limit). That is how the risk stays at {rk(risk)} at every step, and why going broke becomes rare: a falling bankroll is met with smaller bets. The bets are resized between sessions, every {sess} hours of play (your session length on Bet spread), not hand by hand.
        <br /><br /><b>Logged</b> is the game you have actually played: each logged session's own expected dollars an hour and swing, by hours. <b>Spread now</b> is the spread on Bet spread today. Both are played at the same size from today's bankroll and never resized, so a game too big for the bankroll shows a real chance of going broke; "Include moving up" takes them up the tables in the list.
        <br /><br />The chart deals 4,000 possible futures at your pace of {prefs.hours} hours a week, an hour at a time, counting a dip that goes broke between two hours: the line is the middle one, the darker band the middle half, the lighter one 8 in 10. The pale line on the left is what your bankroll has been, counted back from today through your logged results (it can't know about money you added or took out). "Losing half" is the chance the bankroll ever falls to half of today's within the time shown. Percentages carry about a point of sampling noise.
        <br /><br /><b>Deal it out</b> plays one future with real cards instead: full shoes dealt to a table of players, hand by hand, by the same simulator the calculator's tables were measured on, betting the game's own bets at every true count (the optimized bets are re-worked each session to the nearest 5% of bankroll below). It is one way the plan could really go, drawn over the 4,000, with where it ended among them. Each deal uses new shoes, so dealing again shows how differently the same plan can go. Checked against 300 dealt futures, the 4,000 land where real cards put them.
      </Info>}
    </section>}
    {part === "ladder" && <section className="card p-5 mb-4">
      <div className="eyebrow mb-3">Moving up and dropping back</div>
      {!ladder ? <p className="text-sm" style={{ color: "var(--muted)" }}>{ladBusy ? "Working out the tables…" : bankroll > 0 ? "No table size wins playing every hand with these rules." : "Set your bankroll on the Bet spread page first."}</p> : <>
      <div ref={ladRef}>
      <div className="ph-only" style={{ borderTop: "1px solid var(--line)" }}>
        {shown.map((l) => { const i = ladder.lv.indexOf(l); return (
          <div key={l.m} className="pmrow" style={{ opacity: l.state === "ok" ? 0.55 : 1 }}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold" style={{ color: l.state === "now" ? "var(--brass)" : "var(--ivory)" }}><span className="mono">${l.m}</span> tables</span>
              <span className="text-xs text-right" style={{ color: tone(l) }}>{getting(l, i)}</span>
            </div>
            <div className="text-[11.5px] mt-0.5" style={{ color: "var(--muted)" }}>from <span className="mono" style={{ color: "var(--ivory-d)" }}>{shortMoney(l.need)}</span> · <span className="mono">${l.m}–{shortMoney(l.top)}</span> · <span className="mono">{money(l.ev)}</span>/hr</div>
          </div>); })}
      </div>
      <div className="ph-hide">
      <div className="phead" style={{ gridTemplateColumns: cols, padding: "0 0 7px", borderBottom: "1px solid var(--line)" }}><span>Table</span><span>Bets</span><span className="text-right">$/hr</span><span className="text-right">Move up</span><span className="text-right">Getting there</span></div>
      {shown.map((l) => { const i = ladder.lv.indexOf(l); return (
        <div key={l.m} className="grid items-center py-2.5" style={{ gridTemplateColumns: cols, gap: 10, borderBottom: "1px solid var(--line)", opacity: l.state === "ok" ? 0.55 : 1 }}>
          <span className="mono text-sm font-semibold" style={{ color: l.state === "now" ? "var(--brass)" : "var(--ivory)" }}>${l.m}</span>
          <span className="mono text-xs truncate" style={{ color: "var(--ivory-d)" }}>${l.m}–{shortMoney(l.top)}</span>
          <span className="mono text-xs text-right">{money(l.ev)}</span>
          <span className="mono text-xs text-right">{shortMoney(l.need)}</span>
          <span className="text-xs text-right" style={{ color: tone(l) }}>{getting(l, i)}</span>
        </div>); })}
      </div>
      </div>
      {(hidden > 0 || allT) && <More open={allT} onClick={() => setAllT(!allT)} className="mt-2">{allT ? "Fewer tables" : "More tables"}</More>}
      </>}
      <Info label="How to read this">Each table starts at its "Move up" bankroll: from there it earns more inside your {rk(risk)} risk limit than the table below. Move up when the bankroll reaches it, and drop back a table if it falls below it — in between, your bets grow and shrink with the bankroll so the risk stays at {rk(risk)}, so there is no separate point to drop at. Every row plays every hand, as the casino scores do, with the best bets the optimizer finds for that table (its maximum taken as the same multiple of its minimum as on Bet spread); "Bets" and "$/hr" are those bets at the "Move up" bankroll, and they grow from there. "Getting there" comes from 3,000 simulated futures of the optimized game at your pace: the date by which half of them have reached that table, and the share that ever do.</Info>
    </section>}
  </>);
}

// ---------- a casino's details, as a pop-up on the Plan page ----------
function CasinoPop({ c, rot, sessLen, onClose, onCasinos }) {
  const { today, rows, sc, isReady, cap } = rot, row = rows.find((x) => x.c.id === c.id), x = sc.get(c), setup = sc.setup, ref = sc.ref, se = c.sess;
  const rd = row && isReady(row), sk = !!row && rot.low(c);
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
  const cash = upTo50(cashFor(x, sessLen));
  const over = x && !x.loses && x.ror > cap * 1.001, needB = over && x.ror < 1 ? (setup.bankroll * Math.log(cap)) / Math.log(x.ror) : 0;
  // a long value (a rule set) takes the heading's row to itself, so its note keeps the full width instead of a thin column
  const Fact = ({ k, v, sub, tone, stack }) => stack ? <div className="py-3" style={{ borderTop: "1px solid var(--line)" }}><div className="flex items-baseline justify-between gap-4"><div className="factk shrink-0">{k}</div><div className="factv sm truncate" style={{ color: tone || "var(--ivory)" }}>{v}</div></div><div className="facts">{sub}</div></div> : <div className="flex items-start justify-between gap-4 py-3" style={{ borderTop: "1px solid var(--line)" }}><div className="min-w-0"><div className="factk">{k}</div><div className="facts">{sub}</div></div><div className="factv" style={{ color: tone || "var(--ivory)" }}>{v}</div></div>;
  return (
    <Sheet title={c.name} onClose={onClose}>
      <p className="text-xs -mt-2 mb-3" style={{ color: "var(--muted)" }}>{[c.city, c.st].filter(Boolean).join(", ")}</p>
      <div className="rounded-xl px-4 py-3 mb-3" style={{ background: "rgba(var(--fg),.035)" }}>
        <div className="text-sm font-semibold" style={{ color: !row || sk ? "var(--ivory)" : rd ? "var(--brass)" : row.kind === "backed" ? "var(--rose)" : "var(--ivory)" }}>{!row ? "Not in your rotation yet" : sk ? "Not suggested" : rd ? "Ready to play" : row.until ? `Resting until ${fmtWeekday(row.until)}` : "Backed off"}</div>
        <div className="text-xs mt-0.5" style={{ color: "var(--ivory-d)" }}>
          {!row ? "You haven't logged a session here. Scout it, log the session, and it joins the rotation." : <>{row.last ? `Last visit ${ago(daysBetween(row.last, today))}.` : "No sessions logged."}{!rd && row.days ? ` It rests ${row.days} days${row.why ? ` (${row.why})` : ""}.` : ""}{sk ? ` It scores under ${rot.minScore} with your bankroll, so the plan leaves it out.` : ""}</>}
        </div>
      </div>
      {x ? <>
        <div className="flex items-center gap-4 mb-1">
          <div className="hl" style={{ color: scoreTone(x.score) }}>{x.score}</div>
          <div className="min-w-0"><div style={{ color: scoreTone(x.score), fontSize: 17, fontWeight: 700, letterSpacing: "-.02em" }}>{verdict}</div><div className="text-xs" style={{ color: "var(--ivory-d)" }}>{why} The score weighs what it earns by its risk of ruin with your bankroll today.</div></div>
        </div>
        <div className="mt-3">
          <Fact k="What it earns you" v={x.ev > 0 ? `${money(x.ev)}/hr` : "—"} sub={x.ev > 0 ? `On average, playing every hand with the ${over ? "safest" : "best"} bets your ${shortMoney(setup.bankroll)} allows here.${ref && ref.ev > 0 ? ` Your usual game earns ${money(ref.ev)}/hr the same way.` : ""}` : "No spread wins here when every hand is played."} />
          {!x.loses && <Fact k="Risk of ruin" v={tinyPct(x.ror)} tone={over ? "var(--rose)" : undefined} sub={over ? `The chance of losing your whole bankroll if you kept playing these bets. That is over your ${pct(cap, 0)} limit even with the safest bets here${needB > 0 ? `: it takes about ${shortMoney(needB)} to play this table at ${pct(cap, 0)}` : ""}.` : `The chance of losing your whole bankroll if you kept playing these bets and never cut them. Inside your ${pct(cap, 0)} limit.`} />}
          {gameX != null && <Fact k="How good the game is" v={gameX <= -1 ? "Loses" : `${gameX >= 0 ? "+" : "−"}${Math.abs(Math.round(gameX * 100))}%`} sub={gameX <= -1 ? "Rules and penetration alone: the bets that win at your usual table lose money here." : `Rules and penetration alone: the same bets earn this much ${gameX >= 0 ? "more" : "less"} here than at your usual table.`} />}
          <Fact k="How it fits your bankroll" v={`${units} bets`} tone={over ? "var(--rose)" : undefined} sub={`Your bankroll is ${units} of this table's $${x.mn} minimum bets. ${over ? (needB > 0 ? `Playing every hand here at your limit takes about ${Math.round(needB / x.mn).toLocaleString()} (${shortMoney(needB)}), so it is too big for now.` : "That is too few for this table at your limit.") : topBet > x.mn ? `That is enough to spread $${x.mn}–$${topBet} (1 to ${Math.round((topBet / x.mn) * 10) / 10}) inside your limit.` : "Inside your limit, but only with flat minimum bets."}`} />
          {x.ev > 0 && <Fact k={`A ${sessLen}-hour session`} v={sgnMoney(x.ev * sessLen)} sub={`On average. Bring about ${money(cash)}: that covers 19 sessions in 20 without running out.`} />}
          <Fact stack k="The game scored" v={rulesShort({ ...DEFAULT_RULES, ...x.g.rules })} sub={`${x.g.label ? x.g.label + ", " : ""}$${x.mn}–$${x.mx}. ` + (x.mine ? `From what you saw and saved here${x.n > 1 ? ` (the best of your ${x.n} games for you)` : ""}.` : `From the scouting report${c.intel && c.intel.asOf ? ` (as of ${c.intel.asOf})` : ""}${x.n > 1 ? `, the best for you of the ${x.n} games it lists` : ""}. Save the game you see there on the Casinos page and the score uses yours instead.`)} />
        </div>
        {x.ev > 0 && <><div className="eyebrow mt-3 mb-1.5" style={{ fontSize: 9.5 }}>{over ? "Safest bets here, by true count" : "Best bets here, by true count"}</div>
          <div className="flex flex-wrap gap-1.5">{spreadLine(x.bets).map(([k, v]) => <span key={k} className="rounded-lg px-2 py-1 text-[11px]" style={{ background: "rgba(var(--fg),.05)", color: "var(--ivory-d)" }}><span className="mono" style={{ color: "var(--muted)" }}>{k}</span> <span className="mono font-semibold" style={{ color: "var(--ivory)" }}>{v}</span></span>)}</div></>}
      </> : <p className="text-sm mb-1" style={{ color: "var(--ivory-d)" }}>{x === undefined && gamesAt(c).length ? "Working out the score…" : "No score yet: there's no game saved here and no scouting report. Save the game you see on the Casinos page and it gets one."}</p>}
      {se && se.n > 0 && <div className="mt-3"><Fact k="Your record here" v={sgnMoney(se.net)} tone={se.net < 0 ? "var(--neg-l)" : undefined} sub={`${se.n} session${se.n === 1 ? "" : "s"} · ${Math.round(se.h * 10) / 10} hours · ${sgnMoney(se.h > 0 ? se.net / se.h : 0)}/hr${se.backedN ? ` · backed off ${se.backedN === 1 ? "once" : se.backedN + " times"}` : ""}`} /></div>}
      <div className="text-center mt-4"><button className="text-xs font-semibold lnk" style={{ color: "var(--brass)" }} onClick={onCasinos}>Open on the Casinos page to edit games, heat and notes ›</button></div>
    </Sheet>
  );
}

// ---------- the settings row ----------
function Settings({ bankroll, prefs, setPrefs, go }) {
  const narrow = useNarrow(), [open, setOpen] = useState(() => { const o = _planOpenSet; _planOpenSet = false; return o; });
  // on a phone the four settings fold into one line, so the page opens on where to play next
  if (narrow && !open) return (
    <button className="card px-5 py-3.5 mb-4 w-full text-left flex items-center justify-between gap-3 cardbtn" onClick={() => setOpen(true)} aria-expanded="false">
      <span className="min-w-0"><span className="eyebrow block" style={{ fontSize: 10 }}>Your plan</span><span className="block text-sm mt-0.5" style={{ color: "var(--ivory)", textWrap: "balance" }}><span className="mono font-semibold">{money(bankroll)}</span> · {rk(prefs.risk)} risk · <span className="whitespace-nowrap">{prefs.hours} h a week</span></span></span>
      <span className="text-xs font-semibold shrink-0" style={{ color: "var(--brass)" }}>Change</span>
    </button>);
  return (
    <section className="card px-5 py-4 mb-4">
      {narrow && <div className="flex items-baseline justify-between mb-3"><div className="eyebrow">Your plan</div><button className="text-xs font-semibold lnk" style={{ color: "var(--brass)" }} onClick={() => setOpen(false)}>Done</button></div>}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="pset"><span className="eyebrow">Bankroll</span><span className="mono text-base font-semibold">{money(bankroll)}</span><button className="text-xs font-semibold lnk" style={{ color: "var(--brass)" }} onClick={() => go("calc")}>Change</button></div>
        <div className="pset"><span className="eyebrow">Risk limit</span><PlanSlider className="risk" value={Math.round(prefs.risk * 1000) / 10} min={RISK_MIN * 100} max={RISK_MAX * 100} step={0.5} label="Risk of ruin limit" show={(v) => rk(v / 100)} onCommit={(v) => setPrefs({ risk: Math.round(v * 10) / 1000 })} /></div>
        <div className="pset"><span className="eyebrow">Hours a week</span><Step v={prefs.hours} set={(v) => setPrefs({ hours: v })} min={1} max={60} f={(v) => `${v} h`} label="hours a week" /></div>
      </div>
      <Info label="How this page works">
        <ol className="list-decimal pl-4 space-y-1">
          <li><b>Play next</b> picks the casino that has rested longest, nudged towards better games, and leaves out any scoring under your lowest score. Tap any casino for its details and the bets to use there.</li>
          <li><b>Scores</b> and <b>moving up</b> assume you play every hand with the best bets your bankroll allows at your risk limit. A table too big for your bankroll shows its safest bets and the risk they still carry.</li>
          <li><b>Where it's heading</b> plays those same best bets as your bankroll grows and shrinks, unless you switch its game to your logged results or your Bet spread spread.</li>
          <li>Your bankroll's <b>month, cash to bring and risk of ruin</b> use your own spread from Bet spread, as that page prices it.</li>
          <li>Every number follows your bankroll, risk limit and hours a week. Log each session after you play and the plan moves on by itself.</li>
        </ol>
      </Info>
    </section>
  );
}

// ---------- the Plan tab ----------
let _plan = null;
// Home's "next up" on a phone: the first visit of the very plan the Plan tab lays out (same rest days, scores and
// cut-off), without the scouting list. `loading` until the casinos and their scores are in.
export function usePlayNext(bankroll, on = true) {
  const [prefs, setP] = useState(() => _plan || PLAN_DEF), [all, setAll] = useState(null);
  useEffect(() => { if (!on) return; let live = true; (async () => {
    if (!_plan) { const p = await loadPlan(); _plan = p; if (live) setP(p); }
    try { const a = await loadCasinoAll(); if (live) setAll(a); } catch (_) { if (live) setAll([]); }
  })(); return () => { live = false; }; }, [on]);
  const rot = useRotation(on ? all : null, prefs, bankroll, true), first = rot.plan[0] || null, x = first ? rot.sc.get(first.c) : null;
  const row = first && rot.rows.find((r) => r.c.id === first.c.id);
  return { loading: !all || rot.pending, n: rot.rows.length, ready: rot.ready.length, first, score: x ? x.score : null, ev: x && x.ev > 0 ? x.ev : null,
    when: first ? (first.ready ? "Ready now" : fmtWeekday(first.t)) : "", last: row && row.last ? ago(daysBetween(row.last, rot.today)) : "", back: !!(first && first.back),
    none: !!all && !rot.pending && rot.rows.length > 0 && !first,
    // why nothing is suggested (every casino under the lowest score to suggest), in the words Plan's own card uses
    minScore: rot.minScore, closest: rot.skipped[0] ? rot.skipped[0].c.name : "", closestScore: rot.skipped[0] && rot.sc.get(rot.skipped[0].c) ? rot.sc.get(rot.skipped[0].c).score : null };
}
// Home's "Goal" link opens Plan with its settings unfolded on a phone (that is where the hours a week are set)
let _planOpenSet = false;
export const openPlanSettings = () => { _planOpenSet = true; };
export function PlanPage({ bankroll, mine, go }) {
  const [prefs, setP] = useState(() => _plan || PLAN_DEF), [all, setAll] = useState(null), [pop, setPop] = useState(null), [sessions, setSessions] = useState(null), [setup, setSetup] = useState(null);
  useEffect(() => { (async () => {
    if (!_plan) setP((_plan = await loadPlan()));
    try { const L = await getJ("bj-sessions-v1", []); setSessions(Array.isArray(L) ? L.filter((x) => x && typeof x === "object") : []); } catch (_) { setSessions([]); }
    try { setSetup(await loadSetup()); } catch (_) {}
    try { setAll(await loadCasinoAll()); } catch (_) { setAll([]); }
  })(); }, []);
  const setPrefs = (patch) => setP((o) => { const n = { ...o, ...patch }; _plan = n; try { window.storage.set(PLAN_KEY, JSON.stringify(n), false); } catch (_) {} return n; });
  _planRisk = prefs.risk;
  const rot = useRotation(all, prefs, bankroll), gr = useGrowth(mine, bankroll, prefs, sessions, setup), deal = useDeal(gr, setup, mine, bankroll);
  const toCasinos = (c) => { openCasinoId(c.id); go("casinos", { open: c.id }); };
  return (
    <div>
      <style>{planCss}</style>
      <Settings bankroll={bankroll} prefs={prefs} setPrefs={setPrefs} go={go} />
      <div className="dgrid twol"><div className="dcol">
        {all && <PlayNext rot={rot} onOpen={setPop} />}
        {all && <Rotation rot={rot} prefs={prefs} setPrefs={setPrefs} onOpen={setPop} />}
      </div><div className="dcol o2">
        <BankrollNow gr={gr} mine={mine} bankroll={bankroll} prefs={prefs} go={go} />
        <Growth part="chart" gr={gr} deal={deal} bankroll={bankroll} prefs={prefs} setPrefs={setPrefs} />
      </div><div className="dcol contl">
        <Growth part="ladder" gr={gr} deal={deal} bankroll={bankroll} prefs={prefs} setPrefs={setPrefs} />
      </div></div>
      {pop && <CasinoPop key={pop.id} c={pop} rot={rot} sessLen={sessLenOf(mine)} onClose={() => setPop(null)} onCasinos={() => toCasinos(pop)} />}
    </div>
  );
}
