// The phone layout's own pieces (below 1024px, where the tab bar is): the menus behind the Train and More tabs,
// the session timer and Home's casino-trip card. They live here so work on them doesn't collide with app.jsx.
// Like casinos.jsx: nothing imported from app.jsx may be used while this file loads, only inside components.
import { useState, useEffect, useMemo } from "react";
import { Sheet, SESS_KEY, casinoKey, localDay, loadLog, FocusCard, TESTS_KEY, testsOf, TEST_DEFS } from "./app.jsx";
import { usePlayNext, scoreTone, planHours } from "./planner.jsx";
import { useWhere, nearestCasinos, distLabel, CAS_KEY } from "./casinos.jsx";

// the phone layout is everything under the line where the sidebar takes over
export function useNarrow() {
  const q = "(max-width:1023px)";
  const [n, setN] = useState(() => { try { return window.matchMedia(q).matches; } catch (_) { return true; } });
  useEffect(() => {
    let m; try { m = window.matchMedia(q); } catch (_) { return; }
    const f = () => setN(m.matches);
    if (m.addEventListener) m.addEventListener("change", f); else m.addListener(f);
    return () => { if (m.removeEventListener) m.removeEventListener("change", f); else m.removeListener(f); };
  }, []);
  return n;
}

const Ico = ({ children, s = 22 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
const Chev = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: "var(--muted)", flex: "none" }}><path d="M9 6l6 6-6 6" /></svg>;

// ======================= session timer =======================
// Tap when you sit down, tap when you leave: the hours and the casino are filled in and only the result is left to
// type. One timer, kept on this device only (bj-timer-v1, not in the backup):
//   t0      when it started          held     milliseconds spent paused so far
//   pauseAt when the pause began     endAt    when it was ended (the clock is stopped, waiting to be logged)
// Every time is a clock time, so it keeps counting while the app is closed or the phone is asleep.
export const TIMER_KEY = "bj-timer-v1";
let _timer; // undefined until it has been read
const readTimer = () => {
  if (_timer === undefined) {
    _timer = null;
    try { const v = JSON.parse(localStorage.getItem("bj:" + TIMER_KEY)); if (v && typeof v === "object" && v.t0 > 0 && v.t0 <= Date.now() + 6e4) _timer = { t0: +v.t0, where: typeof v.where === "string" ? v.where : "", held: +v.held > 0 ? +v.held : 0, pauseAt: +v.pauseAt > 0 ? +v.pauseAt : null, endAt: +v.endAt > 0 ? +v.endAt : null }; } catch (_) {}
  }
  return _timer;
};
const writeTimer = (t) => {
  _timer = t;
  try { if (t) window.storage.set(TIMER_KEY, JSON.stringify(t), false); else window.storage.delete(TIMER_KEY, false); } catch (_) {}
  try { window.dispatchEvent(new Event("bj-timer")); } catch (_) {}
};
// time at the table so far, pauses left out
export const timerMs = (t, now = Date.now()) => (t ? Math.max(0, (t.endAt || t.pauseAt || now) - t.t0 - (t.held || 0)) : 0);
// hours for the log: to the nearest three minutes, never zero, never more than a day
export const timerHours = (ms) => Math.min(24, Math.max(0.05, Math.round((ms / 36e5) * 20) / 20));
export const timerDo = {
  start: (where) => writeTimer({ t0: Date.now(), where: String(where || "").trim(), held: 0, pauseAt: null, endAt: null }),
  pause: () => { const t = readTimer(); if (t && !t.pauseAt && !t.endAt) writeTimer({ ...t, pauseAt: Date.now() }); },
  resume: () => { const t = readTimer(); if (!t) return; const from = t.endAt || t.pauseAt; writeTimer(from ? { ...t, held: (t.held || 0) + Math.max(0, Date.now() - from), pauseAt: null, endAt: null } : t); },
  // ending stops the clock where it is; a pause that was running ends at the same moment
  end: () => { const t = readTimer(); if (t && !t.endAt) writeTimer({ ...t, endAt: t.pauseAt || Date.now(), pauseAt: null }); return readTimer(); },
  clear: () => writeTimer(null),
};
export function useSessionTimer() {
  const [t, setT] = useState(readTimer);
  useEffect(() => { const f = () => setT(readTimer()); window.addEventListener("bj-timer", f); return () => window.removeEventListener("bj-timer", f); }, []);
  return t;
}
const clock = (ms) => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const spoken = (ms) => { const m = Math.max(1, Math.round(ms / 6e4)), h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`; };
// only this text redraws each second, never the page round it
function TimerClock({ t }) {
  const [, tick] = useState(0);
  const live = !t.pauseAt && !t.endAt;
  useEffect(() => { if (!live) return; const id = setInterval(() => tick((n) => n + 1), 1000); const vis = () => tick((n) => n + 1); document.addEventListener("visibilitychange", vis); return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); }; }, [live]);
  return <span className="mono" role="timer" aria-label={`Session time ${spoken(timerMs(t))}`}>{clock(timerMs(t))}</span>;
}
// the casinos you have logged, newest first
function useRecentCasinos() {
  const [list, setList] = useState([]);
  useEffect(() => { (async () => {
    try { const r = await window.storage.get(SESS_KEY, false); const L = r && r.value ? JSON.parse(r.value) : []; const seen = new Map(); (Array.isArray(L) ? L : []).slice().reverse().forEach((s) => { const k = casinoKey(s); if (k !== "—" && !seen.has(k)) seen.set(k, s.where.trim()); }); setList([...seen.values()].slice(0, 6)); } catch (_) {}
  })(); }, []);
  return list;
}
function StartSheet({ onClose }) {
  const [where, setWhere] = useState(""), recent = useRecentCasinos(), loc = useWhere(), [near, setNear] = useState(null);
  useEffect(() => { let live = true; if (loc.pos) nearestCasinos(loc.pos, 3).then((L) => { if (live) setNear(L.filter((x) => x.mi <= 60)); }).catch(() => {}); return () => { live = false; }; }, [loc.pos]);
  // standing in a casino: offer it straight away
  useEffect(() => { if (near && near[0] && near[0].mi <= 0.6) setWhere((w) => w || near[0].c.name); }, [near]);
  const chip = (name, sub, k) => <button key={k} type="button" onClick={() => setWhere(name)} className={"chippress gchip whitespace-nowrap rounded-full px-3 text-xs font-semibold" + (where === name ? " on" : "")} style={{ height: 32, flexShrink: 0 }}>{name}{sub ? <span className="mono font-medium" style={{ opacity: 0.6 }}> · {sub}</span> : null}</button>;
  return (
    <Sheet title="Start a session" onClose={onClose}>
      <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>The clock runs until you end it, even with the app closed. Then the hours and the casino are already filled in.</p>
      <label className="block mb-2"><span className="eyebrow block mb-1.5">Casino</span><input className="in" placeholder="Where are you playing?" value={where} onChange={(e) => setWhere(e.target.value)} autoComplete="off" /></label>
      {recent.length > 0 && <div className="hidescroll flex gap-1.5 overflow-x-auto mb-2" style={{ scrollbarWidth: "none" }}>{recent.map((c) => chip(c, null, c))}</div>}
      <div className="hidescroll flex gap-1.5 overflow-x-auto mb-5 items-center" style={{ scrollbarWidth: "none", minHeight: 32 }}>
        {near && near.length > 0 ? near.map((x) => chip(x.c.name, distLabel(x.mi), x.c.id))
          : <button type="button" onClick={() => loc.ask()} className="chippress gchip whitespace-nowrap rounded-full px-3 text-xs font-semibold flex items-center gap-1.5" style={{ height: 32 }} disabled={loc.state === "asking"}><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 3 3 10.5l7.5 3 3 7.5z" /></svg>{loc.state === "asking" ? "Finding you…" : "Find the casino I'm at"}</button>}
        {loc.state === "denied" && <span className="text-[11px]" style={{ color: "var(--muted)" }}>Location is off for this app.</span>}
        {loc.state === "off" && <span className="text-[11px]" style={{ color: "var(--muted)" }}>Couldn't find you.</span>}
        {near && !near.length && loc.state === "ok" && <span className="text-[11px]" style={{ color: "var(--muted)" }}>No listed casino within 60 miles.</span>}
      </div>
      <button className="btn" onClick={() => { timerDo.start(where); onClose(); }}>Start the clock</button>
    </Sheet>
  );
}
// The timer itself, three states: running, paused, ended (waiting for its result).
function TimerBody({ t, go }) {
  const since = new Date(t.t0), sameDay = localDay(t.t0) === localDay();
  const started = `${sameDay ? "" : since.toLocaleDateString(undefined, { weekday: "short" }) + " "}${since.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  const log = () => { const e = timerDo.end(); go("sessions", { log: true, pre: { where: e.where, hours: timerHours(timerMs(e)), date: localDay(e.t0), timed: true } }); };
  const long = timerMs(t) > 16 * 36e5;
  if (t.endAt) return (
    <div>
      <div className="flex items-baseline justify-between gap-3"><div className="eyebrow">Session ended</div><div className="text-[11px]" style={{ color: "var(--muted)" }}>not logged yet</div></div>
      <div className="text-[19px] font-semibold mt-1.5 truncate" style={{ color: "var(--ivory)", letterSpacing: "-.01em" }}>{spoken(timerMs(t))}{t.where ? ` at ${t.where}` : ""}</div>
      <button className="btn mt-3.5" onClick={log}>Log the result</button>
      <div className="flex items-center justify-center gap-5 mt-3 text-xs font-semibold"><button className="lnk" style={{ color: "var(--brass)" }} onClick={() => timerDo.resume()}>Keep playing</button><ConfirmTap label="Discard" confirm="Tap again to discard" onConfirm={() => timerDo.clear()} /></div>
    </div>);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="eyebrow truncate" style={{ color: t.pauseAt ? "var(--muted)" : "var(--brass)" }}>{t.where || "Session"}</div>
        <div className="text-[11px] flex items-center gap-1.5 shrink-0" style={{ color: "var(--muted)" }}>{!t.pauseAt && <span className="livedot" aria-hidden="true" />}{t.pauseAt ? "Paused" : "Live"} · since {started}</div>
      </div>
      <div className="tclock mt-1" style={{ opacity: t.pauseAt ? 0.5 : 1 }}><TimerClock t={t} /></div>
      {long && <p className="text-[11px] mt-1" style={{ color: "var(--neg-l)" }}>Still running from {since.toLocaleDateString(undefined, { weekday: "long" })}. End it and correct the hours if you forgot.</p>}
      <div className="grid grid-cols-2 gap-2 mt-3.5">
        <button className="btn ghost" onClick={() => (t.pauseAt ? timerDo.resume() : timerDo.pause())}>{t.pauseAt ? "Resume" : "Pause"}</button>
        <button className="btn" onClick={log}>End &amp; log</button>
      </div>
    </div>);
}
function ConfirmTap({ label, confirm, onConfirm }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const id = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(id); }, [armed]);
  return <button className="lnk" style={{ color: armed ? "var(--neg-l)" : "var(--muted)" }} onClick={() => (armed ? onConfirm() : setArmed(true))}>{armed ? confirm : label}</button>;
}
// Sessions page: the running timer, or one quiet line to start it
export function TimerCard({ go }) {
  const t = useSessionTimer(), [start, setStart] = useState(false);
  return (<>
    {t ? <section className="card p-5 mb-3 focuscard rise"><TimerBody t={t} go={go} /></section>
      : <button className="trow mb-3" onClick={() => setStart(true)}><span className="ticon"><Ico s={18}><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4l2.5 2M9.5 2.5h5" /></Ico></span><span className="min-w-0 flex-1 text-left"><span className="block text-sm font-semibold" style={{ color: "var(--ivory)" }}>At the casino?</span><span className="block text-[11.5px]" style={{ color: "var(--muted)" }}>Time the session, then just enter the result</span></span><span className="text-xs font-semibold shrink-0" style={{ color: "var(--brass)" }}>Start</span></button>}
    {start && <StartSheet onClose={() => setStart(false)} />}
  </>);
}
// Home: the casino trip in one card. While a session runs it is the timer; otherwise where the plan sends you next,
// with the two things you do on the way in: start the clock, or see what is near.
export function TripCard({ go, bankroll }) {
  const t = useSessionTimer(), [start, setStart] = useState(false);
  const next = usePlayNext(bankroll, !t);
  if (t) return <section className="card p-5 mb-4 focuscard"><TimerBody t={t} go={go} /></section>;
  return (
    <section className="card p-5 mb-4">
      <div className="flex items-baseline justify-between gap-3"><div className="eyebrow">Casino trip</div><button className="text-[11px] font-semibold lnk" style={{ color: "var(--brass)" }} onClick={() => go("plan")}>Plan ›</button></div>
      {next.first ? (
        <button className="cardbtn w-full text-left flex items-center justify-between gap-3 mt-2" onClick={() => go("plan")}>
          <span className="min-w-0"><span className="block text-[11.5px]" style={{ color: "var(--muted)" }}>Next up · {next.when}{next.last ? ` · last visit ${next.last}` : ""}</span><span className="block text-[19px] font-semibold truncate mt-0.5" style={{ color: "var(--ivory)", letterSpacing: "-.01em" }}>{next.first.c.name}</span>{next.back && <span className="block text-[11px]" style={{ color: "var(--neg-l)" }}>first visit since the back-off, keep it short</span>}</span>
          {next.score != null && <span className="text-right leading-none shrink-0"><span className="block mono text-[22px] font-semibold" style={{ color: scoreTone(next.score) }}>{next.score}</span><span className="block text-[9px] font-semibold uppercase mt-1" style={{ color: "var(--muted)", letterSpacing: ".1em" }}>score</span></span>}
        </button>
      ) : (
        <p className="text-sm mt-2" style={{ color: "var(--ivory-d)" }}>{next.loading && next.n ? "Working out where to play next…" : next.none ? "Nothing to suggest right now. The Plan page says why, and when each casino is back." : "Start the clock when you sit down. When you leave, the hours and the casino are already filled in."}</p>
      )}
      <div className="grid grid-cols-2 gap-2 mt-3.5">
        <button className="btn tripbtn" style={{ minHeight: 46, padding: "0 10px", fontSize: 15 }} onClick={() => setStart(true)}>Start session</button>
        <button className="btn ghost tripbtn" style={{ minHeight: 46, padding: "0 10px", fontSize: 15 }} onClick={() => go("casinos", { near: true })}>Near me</button>
      </div>
      {start && <StartSheet onClose={() => setStart(false)} />}
    </section>
  );
}

// Home: hours played this week against the Plan page's hours-a-week goal (Nick: "make 'hours this week' section on
// home page"). This week is the phone's own calendar week (Sunday first in the US, Monday in most other places); its
// hours are the sessions logged on those days plus a session being timed now, which counts until it is logged.
const weekFirst = () => { try { const l = new Intl.Locale(navigator.language || "en-US"), w = l.getWeekInfo ? l.getWeekInfo() : l.weekInfo; if (w && w.firstDay) return w.firstDay % 7; } catch (_) {} return 1; };
const hrs = (h) => { const r = Math.round(h * 10) / 10; return `${r % 1 ? r.toFixed(1) : r} h`; };
const money0 = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
export function WeekCard({ sessions, go }) {
  const t = useSessionTimer(), [goal, setGoal] = useState(null), [, tick] = useState(0);
  useEffect(() => { let live = true; planHours().then((h) => live && setGoal(h)).catch(() => live && setGoal(8)); return () => { live = false; }; }, []);
  // a running clock adds to today's column; redraw every half minute while it runs
  useEffect(() => { if (!t || t.endAt || t.pauseAt) return; const id = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(id); }, [t]);
  const days = useMemo(() => {
    const now = new Date(), back = (now.getDay() - weekFirst() + 7) % 7, out = [];
    for (let i = 0; i < 7; i++) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back + i); out.push({ key: localDay(d.getTime()), lab: d.toLocaleDateString(undefined, { weekday: "narrow" }), today: i === back, future: i > back, h: 0 }); }
    return out;
  }, []);
  const week = useMemo(() => {
    const at = Object.fromEntries(days.map((d, i) => [d.key, i])), h = days.map(() => 0); let n = 0, res = 0;
    (sessions || []).forEach((x) => { const i = at[x && x.date]; if (i == null) return; h[i] += +x.hours || 0; res += +x.result || 0; n++; });
    return { h, n, res };
  }, [sessions, days]);
  const live = t ? timerMs(t) / 3.6e6 : 0, today = days.findIndex((d) => d.today);
  const per = week.h.map((v, i) => v + (i === today ? live : 0)), done = per.reduce((a, b) => a + b, 0);
  const g = goal || 8, frac = Math.min(1, done / g), top = Math.max(...per, g / 4, 0.5);
  return (
    <section className="card p-5 mb-4 weekcard">
      <div className="flex items-baseline justify-between gap-3">
        <div className="eyebrow">This week</div>
        <button className="text-[11px] font-semibold lnk" style={{ color: "var(--brass)" }} onClick={() => go("plan")}>{goal ? `Goal ${hrs(goal)}` : "Goal"} ›</button>
      </div>
      <button className="cardbtn w-full text-left mt-2" onClick={() => go("sessions")}>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0"><span className="disp mono text-[30px] leading-none" style={{ color: done >= g ? "var(--brass)" : "var(--ivory)" }}>{hrs(done)}</span><span className="text-sm ml-1.5" style={{ color: "var(--muted)" }}>of {hrs(g)}</span></div>
          <span className="text-xs text-right pb-0.5" style={{ color: done >= g ? "var(--brass)" : "var(--muted)" }}>{done >= g ? (done - g >= 0.05 ? `${hrs(done - g)} over` : "Goal reached") : `${hrs(g - done)} to go`}</span>
        </div>
        <div className="wkbar mt-3"><i className="barx" style={{ width: `${Math.max(done > 0 ? 2 : 0, frac * 100)}%` }} /></div>
        <div className="wkdays mt-3.5" aria-hidden="true">
          {days.map((d, i) => (
            <div key={d.key} className={"wkday" + (d.today ? " today" : "") + (d.future ? " future" : "")}>
              <div className="wkcol">{per[i] > 0 && <i className="bary" style={{ "--i": i, height: `${Math.max(10, (per[i] / top) * 100)}%` }} />}</div>
              <span>{d.lab}</span>
            </div>))}
        </div>
        <div className="text-xs mt-3" style={{ color: "var(--muted)" }}>{week.n || live ? <>{week.n} session{week.n === 1 ? "" : "s"}{live ? " + one being timed" : ""}{week.n ? <> · <span className="mono" style={{ color: week.res >= 0 ? "var(--brass)" : "var(--rose)" }}>{money0(week.res)}</span></> : ""}</> : "Nothing logged yet this week"}</div>
      </button>
    </section>
  );
}

// ======================= the More tab =======================
// Casinos and Plan sit behind one tab on a phone. Kept to those two rows on purpose (Nick asked for this menu to be
// cleaned up): Settings is the gear in the top right of every page, the rules are the pill beside it, and logging a
// session is on Home and Sessions.
export function MoreHub({ go, bankroll }) {
  const [cas, setCas] = useState(null);
  useEffect(() => { (async () => {
    try { const r = await window.storage.get(CAS_KEY, false); const d = r && r.value ? JSON.parse(r.value) : null, m = Array.isArray(d && d.marks) ? d.marks.filter((x) => x && !x.hidden) : []; setCas({ n: m.filter((x) => x.status || x.custom).length, x: m.filter((x) => x.status === "backed").length }); } catch (_) { setCas({ n: 0, x: 0 }); }
  })(); }, []);
  const next = usePlayNext(bankroll, true);
  const rows = [
    ["casinos", "Casinos", <><path d="M12 20.8s-6.6-5.9-6.6-10.9a6.6 6.6 0 0 1 13.2 0c0 5-6.6 10.9-6.6 10.9z" /><circle cx="12" cy="9.9" r="2.4" /></>, cas && cas.n ? `${cas.n} of yours${cas.x ? ` · ${cas.x} backed off` : ""}` : "The map, scouting reports and what is near you"],
    ["plan", "Plan", <><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 9.5h16M8.5 3.5v3M15.5 3.5v3M8 13.5h3M8 16.5h6" /></>, next.first ? `Next up: ${next.first.c.name}` : "Where to play next"],
  ];
  return (
    <div className="rise inturn">
      <section className="card overflow-hidden mb-4">
        {rows.map(([k, name, icon, sub]) => (
          <button key={k} className="mrow big" onClick={() => go(k)}>
            <span className="ticon"><Ico s={20}>{icon}</Ico></span>
            <span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold" style={{ color: "var(--ivory)" }}>{name}</span><span className="block text-[12px] leading-snug" style={{ color: "var(--muted)" }}>{sub}</span></span>
            <Chev />
          </button>))}
      </section>
    </div>
  );
}

// ======================= the Train tab =======================
// One menu of everything there is to practise, each tile with how it is going; a tile opens that one thing on its own.
const acc7 = (log) => {
  const now = Date.now(), wk = 7 * 864e5, m = {};
  (log || []).forEach((e) => { const r = m[e.s] || (m[e.s] = { all: 0, ok: 0, w: 0, wok: 0 }); r.all++; r.ok += e.ok; if (e.t >= now - wk) { r.w++; r.wok += e.ok; } });
  const out = {}; Object.keys(m).forEach((k) => { const r = m[k]; out[k] = { acc: Math.round(100 * (r.w ? r.wok / r.w : r.ok / r.all)), n: r.w, week: r.w > 0 }; });
  return out;
};
const tone = (a) => (a == null ? "var(--muted)" : a >= 95 ? "var(--brass)" : a >= 85 ? "var(--ivory)" : "var(--rose)");
export function TrainHub({ go }) {
  const [log, setLog] = useState(null), [tests, setTests] = useState(null);
  useEffect(() => { (async () => {
    try { setLog(await loadLog()); } catch (_) { setLog([]); }
    try { const r = await window.storage.get(TESTS_KEY, false); setTests(r && r.value ? testsOf(r.value) : {}); } catch (_) { setTests({}); }
  })(); }, []);
  const a = useMemo(() => acc7(log), [log]);
  // the weaker of two skills that share a tile
  const both = (x, y) => { const L = [a[x], a[y]].filter(Boolean); return L.length ? L.reduce((p, q) => (q.acc < p.acc ? q : p)) : null; };
  const stat = (s) => (s ? <><span className="mono font-semibold" style={{ color: tone(s.acc) }}>{s.acc}%</span><span> · {s.week ? `${s.n} this week` : "not this week"}</span></> : "Not started");
  const passed = tests ? TEST_DEFS.filter((d) => tests[d.id] && tests[d.id].pass).length : 0;
  const groups = [
    ["Strategy", [
      ["Practice", "Basic, deviations or mixed", <path d="M4 6.5h16M4 12h16M4 17.5h10" />, both("strategy", "deviation"), () => go("train", { trainView: "drill" })],
      ["Charts", "Every play at a glance", <><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="M4 10h16M4 15h16M10 4v16M15 4v16" /></>, null, () => go("train", { trainView: "charts" })],
      ["Fill the chart", "Write it from memory", <><path d="M5 19l1-4L16.5 4.5a2 2 0 0 1 3 3L9 18z" /><path d="M14.5 6.5l3 3" /></>, null, () => go("train", { trainView: "fill" })],
    ]],
    ["Counting", [
      ["Running count", "Cards, pairs or table rounds", <><rect x="6" y="3.5" width="12" height="17" rx="2" /><path d="M9.5 9h5M12 6.5v5M9.5 16h5" /></>, both("count", "pairs"), () => go("count", { drill: "count" })],
      ["True count", "Count ÷ decks left", <><circle cx="12" cy="6.5" r="1.3" fill="currentColor" stroke="none" /><path d="M5 12h14" /><circle cx="12" cy="17.5" r="1.3" fill="currentColor" stroke="none" /></>, a.tc, () => go("count", { drill: "tc" })],
      ["Hand totals", "Add a hand at a glance", <path d="M12 5v14M5 12h14" />, a.totals, () => go("count", { drill: "totals" })],
    ]],
  ];
  return (
    <div className="rise inturn">
      <FocusCard log={log} go={go} />
      {groups.map(([title, items]) => (
        <div key={title} className="mb-4">
          <div className="eyebrow mb-2 px-1">{title}</div>
          <section className="card overflow-hidden">
            {items.map(([name, sub, icon, s, run]) => (
              <button key={name} className="mrow" onClick={run}>
                <span className="ticon"><Ico s={19}>{icon}</Ico></span>
                <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold" style={{ color: "var(--ivory)" }}>{name}</span><span className="block text-[11.5px] truncate" style={{ color: "var(--muted)" }}>{s ? stat(s) : sub}</span></span>
                <Chev />
              </button>))}
          </section>
        </div>))}
      <div className="eyebrow mb-2 px-1">Ready for the casino?</div>
      <section className="card overflow-hidden mb-4">
        <button className="mrow" onClick={() => go("count", { drill: "tests" })}>
          <span className="ticon"><Ico s={19}><path d="M12 3.5l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" /></Ico></span>
          <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold" style={{ color: "var(--ivory)" }}>Casino-ready tests</span><span className="block text-[11.5px] truncate" style={{ color: "var(--muted)" }}>Three timed tests to pass</span></span>
          <span className="mono text-sm font-semibold" style={{ color: passed === TEST_DEFS.length ? "var(--brass)" : "var(--ivory-d)" }}>{passed}/{TEST_DEFS.length}</span><Chev />
        </button>
      </section>
    </div>
  );
}

// ======================= styles =======================
// Rendered once by the shell. .ph-only / .ph-hide show or hide a piece on the phone layout (under 1024px).
export const phoneCss = `
.ph-only{display:none}
.tripbtn{white-space:nowrap}
@media (max-width:350px){.tripbtn{font-size:14px!important;padding:0 6px!important}}
.ticon{display:flex;align-items:center;justify-content:center;flex:none;width:36px;height:36px;border-radius:12px;color:var(--brass);background:rgba(var(--acc),.12)}
.ptile{display:block;text-align:left;padding:15px 15px 14px;width:100%;min-width:0;transition:transform .32s var(--ez)}
.ptile:active{transform:scale(.975);transition-duration:.1s}
.mrow{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:13px 16px;min-height:60px}
.mrow+.mrow{box-shadow:0 -1px 0 rgba(var(--fg),.06)}
.mrow:active{background:rgba(var(--fg),.05)}
.mrow.big{min-height:72px;padding:15px 16px;gap:14px}.mrow.big .ticon{width:42px;height:42px;border-radius:14px}
.trow{display:flex;align-items:center;gap:12px;width:100%;padding:11px 14px;border-radius:18px;background:rgba(var(--fg),.035);box-shadow:var(--gl-lens)}
.trow:active{background:rgba(var(--fg),.06)}
.tclock{font-size:46px;line-height:1.05;font-weight:700;letter-spacing:-.03em;color:var(--ivory);font-variant-numeric:tabular-nums;transition:opacity .2s var(--ez)}
.livedot{width:7px;height:7px;border-radius:50%;background:var(--brass);box-shadow:0 0 0 3px rgba(var(--acc),.22);animation:livedot 2s var(--ez) infinite}
@keyframes livedot{50%{box-shadow:0 0 0 6px rgba(var(--acc),0)}}
.hdrback{display:none}
/* Home's This week card: every screen size */
.wkbar{position:relative;height:8px;border-radius:99px;background:rgba(var(--fg),.08);overflow:hidden}
.wkbar>i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:var(--brass);transform-origin:0 50%}
.wkdays{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}
.wkday{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0}
.wkcol{position:relative;width:100%;max-width:26px;height:34px;border-radius:7px;background:rgba(var(--fg),.05);overflow:hidden}
.wkcol>i{position:absolute;left:0;right:0;bottom:0;border-radius:7px;background:rgba(var(--acc),.62);transform-origin:50% 100%}
.wkday.today .wkcol>i{background:var(--brass)}
.wkday.future .wkcol{background:rgba(var(--fg),.025)}
.wkday>span{font-size:10.5px;font-weight:600;color:var(--muted)}
.wkday.today>span{color:var(--brass)}
@media (hover:hover){.mrow:hover,.trow:hover{filter:none;background:rgba(var(--fg),.045)}}
@media (prefers-reduced-motion:reduce){.livedot{animation:none}.ptile{transition:none}.resin{animation:none}}
@media (max-width:1023px){
.ph-only{display:block}.ph-hide{display:none!important}
/* a page behind a menu says where it came from */
.hdrback{display:inline-flex;align-items:center;gap:2px;margin:0 0 6px -3px;padding:2px 6px 2px 0;font-size:13.5px;font-weight:600;color:var(--brass)}
.hdrback:active{opacity:.6}
.topbar .tbback{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;margin:-4px 2px -4px -8px;color:var(--brass)}
/* large titles and a little more air between the title and the page */
.shell>header{margin-bottom:18px}
.shell>header h1{font-size:clamp(28px,8.4vw,34px);letter-spacing:-.03em}
.shell>header h1.long{font-size:clamp(20px,5.6vw,27px);letter-spacing:-.025em;white-space:nowrap}
.shell>header .rulespill{min-width:0}
/* Train: the answer stands where the answer buttons were */
.resin{animation:resin .42s var(--ez-soft) backwards}
@keyframes resin{from{opacity:0;transform:translate3d(0,10px,0);filter:blur(4px)}}
/* the strategy table and its answer buttons fit one screen: smaller cards, no labels inside the felt (the line under
   it names both hands), and shorter still on a short screen */
.cz-train{--cz:1}.tblrows{gap:8px}
.tbl.cz-train{padding-top:16px;padding-bottom:14px}
@media (max-width:379px){.cz-train{--cz:.94}}
@media (max-height:740px){.cz-train{--cz:.88}.shell>header{margin-bottom:12px}.shell>header h1{font-size:26px}.acts.pad>button:nth-child(-n+2){min-height:52px}.acts.pad>button{min-height:46px}}
@media (max-height:660px){.cz-train{--cz:.8}}
@media (max-height:600px){.cz-train{--cz:.64}.shell>header h1{font-size:23px}}
/* answer buttons are a pad for the thumb: two big ones, the rest under them */
.acts.pad{grid-template-columns:repeat(6,minmax(0,1fr))!important;gap:8px}
.acts.pad>button{grid-column:span 2;min-height:50px;font-size:15px!important;font-weight:600;border-radius:16px;padding-top:0;padding-bottom:0}
.acts.pad>button:nth-child(-n+2){grid-column:span 3;min-height:58px;font-size:17px!important}
.acts.pad>button:nth-child(3):last-child{grid-column:span 6}
.acts.pad>button:nth-child(3):nth-last-child(2),.acts.pad>button:nth-child(4):last-child{grid-column:span 3}
/* Home: Your skills is the last card (the rule is in the main css, "Organized", for every width under 1180px) */
/* Sessions: the log comes right after the result on a phone */
.sesspage>.dgrid{display:flex;flex-direction:column}
.sesspage .ph-a{order:-2}.sesspage .ph-b{order:-1}
/* Settings: themes are one row to swipe */
.themerow{display:flex!important;gap:10px;overflow-x:auto;scrollbar-width:none;margin:0 -20px;padding:2px 20px 4px;scroll-snap-type:x proximity}
.themerow::-webkit-scrollbar{display:none}
.themerow>*{flex:0 0 112px;scroll-snap-align:start}
}
@media (max-width:350px){.tclock{font-size:40px}.ptile{padding:13px 12px 12px}.mrow{padding-left:13px;padding-right:13px;gap:10px}}
`;
