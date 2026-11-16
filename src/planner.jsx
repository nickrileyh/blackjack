// Desktop-only tools on the Casinos page (rendered inside .deskonly sections):
//  - TableScoreCard: score a table's rules against your bankroll and spread settings, with the best spread for it.
//  - RotationCard: when each casino you've played is safe to go back to, and which one to visit next.
// Like casinos.jsx, nothing from app.jsx may be used while this file loads — only inside functions.
import { useState, useEffect, useMemo } from "react";
import { Seg, Info, rulesShort, money, shortMoney, fmtTC, pct, COUNTS, calFor, autoRph, roundFreqs, optimizeSpread, DEFAULT_RULES } from "./app.jsx";
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

// ---------- rotation ----------
const DAY = 864e5;
const dayOf = (d) => new Date(d + "T12:00:00").getTime();
const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const ago = (days) => (days <= 0 ? "today" : days === 1 ? "yesterday" : days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`);
// rest after a visit: a week by default; longer when the casino is warm, you were watched last time, or you've been a lot
// lately; six months after a back-off
export const REST = { base: 7, warm: 21, hot: 45, busy: 21, backed: 180 };
export function restOf(c, now) {
  const s = c.sess, m = c.mark || {}, dates = (s && s.dates) || [];
  const last = s && s.last ? dayOf(s.last) : null;
  if (m.status === "backed" || (s && s.backed)) {
    const on = [m.backedOn, s && s.backed].filter(Boolean).sort().pop(), from = on ? dayOf(on) : last;
    return { kind: "backed", until: from ? from + REST.backed * DAY : null, last, why: "backed off" };
  }
  const recent = dates.filter((d) => now - dayOf(d) <= 30 * DAY).length;
  let days = REST.base, why = "";
  if (m.heat === 2) { days = REST.warm; why = "medium heat"; }
  if (s && s.lastHeat === "watched" && days < REST.warm) { days = REST.warm; why = "watched last visit"; }
  if (recent >= 3 && days < REST.busy) { days = REST.busy; why = `${recent} visits in 30 days`; }
  if (m.heat === 3) { days = REST.hot; why = "high heat"; }
  return { kind: "rest", until: last ? last + days * DAY : null, last, why, recent };
}
export function RotationCard({ all, onOpen }) {
  const now = Date.now();
  const rows = useMemo(() => (all || []).filter((c) => (c.sess && c.sess.n) || (c.mark && (c.mark.status === "been" || c.mark.status === "backed")))
    .filter((c) => !(c.mark && c.mark.hidden)).map((c) => ({ c, ...restOf(c, now) })), [all]); // eslint-disable-line
  const ready = rows.filter((r) => r.kind !== "backed" && (!r.until || r.until <= now)).sort((a, b) => (a.last || 0) - (b.last || 0));
  const resting = rows.filter((r) => !ready.includes(r)).sort((a, b) => (a.until || Infinity) - (b.until || Infinity));
  // where your hours went over the last 90 days
  const h90 = useMemo(() => { const o = []; (all || []).forEach((c) => { const h = ((c.sess && c.sess.recs) || []).filter((x) => now - dayOf(x.date) <= 90 * DAY).reduce((s, x) => s + x.h, 0); if (h > 0) o.push([c, h]); }); return o.sort((a, b) => b[1] - a[1]); }, [all]); // eslint-disable-line
  const tot = h90.reduce((s, x) => s + x[1], 0), heavy = h90.length && tot >= 6 && h90[0][1] / tot > 0.5 ? h90[0] : null;
  if (!rows.length) return (
    <section className="card p-5 mb-4 deskonly"><div className="eyebrow mb-1">Rotation</div><p className="text-sm" style={{ color: "var(--ivory-d)" }}>Log sessions (or mark casinos as been) and this shows when each one is safe to go back to.</p></section>);
  const line = (r) => r.last ? `last visit ${ago(Math.floor((now - r.last) / DAY))}${r.c.sess && r.c.sess.n ? ` · ${r.c.sess.n} session${r.c.sess.n === 1 ? "" : "s"}` : ""}` : "no sessions logged";
  const Row = ({ r, right, tone, first }) => (
    <button className="crow" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }} onClick={() => onOpen(r.c)}>
      <span className="min-w-0"><span className="block text-sm font-semibold truncate" style={{ color: first ? "var(--brass)" : "var(--ivory)" }}>{r.c.name}</span><span className="block text-[11px] truncate" style={{ color: "var(--muted)" }}>{line(r)}{r.why ? ` · ${r.why}` : ""}</span></span>
      <span className="text-xs font-semibold text-right" style={{ color: tone }}>{right}</span>
    </button>
  );
  return (
    <section className="card p-5 mb-4 deskonly">
      <div className="eyebrow mb-1">Rotation</div>
      {ready.length > 0
        ? <p className="text-sm mb-2" style={{ color: "var(--ivory-d)" }}>Next up: <span className="font-semibold" style={{ color: "var(--brass)" }}>{ready[0].c.name}</span>{ready.length === 1 ? " — the only one ready." : ready[0].last ? ` — the longest rested of the ${ready.length} ready.` : "."}</p>
        : <p className="text-sm mb-2" style={{ color: "var(--ivory-d)" }}>Everywhere you've played is resting. Earliest back: <span className="font-semibold" style={{ color: "var(--ivory)" }}>{resting[0] && resting[0].until ? fmtDay(resting[0].until) : "—"}</span>.</p>}
      {heavy && <p className="text-[11.5px] mb-2" style={{ color: "var(--neg-l)" }}>{Math.round((100 * heavy[1]) / tot)}% of your last 90 days' hours were at {heavy[0].name}. Spread them out.</p>}
      {ready.length > 0 && <><div className="eyebrow mt-3" style={{ fontSize: 9.5 }}>Ready</div>{ready.map((r, i) => <Row key={r.c.id} r={r} first={i === 0} right="Ready" tone="var(--brass)" />)}</>}
      {resting.length > 0 && <><div className="eyebrow mt-3" style={{ fontSize: 9.5 }}>Resting</div>{resting.map((r) => <Row key={r.c.id} r={r} right={r.until ? `Back ${fmtDay(r.until)}` : r.kind === "backed" ? "Backed off" : "—"} tone={r.kind === "backed" ? "var(--rose)" : "var(--ivory-d)"} />)}</>}
      <Info label="How the rest days work">After a visit a casino rests {REST.base} days. It rests {REST.warm} days if you rated its heat Medium or were watched last time, {REST.busy} days after 3 or more visits in a month, and {REST.hot} days at High heat. A back-off rests it {REST.backed} days from the back-off. Heat comes from each casino's sheet and the heat you log with a session. Ready casinos are listed longest rested first, so your hours spread across them.</Info>
    </section>
  );
}
