// "Ask" tab: a chat with Claude that answers from this app's own calculator. The model never does the blackjack
// arithmetic — it calls the tools in aitools.js (the calibrated model, the cover-play tables, the card simulator,
// the session log) and explains what comes back. Needs the user's own Anthropic API key, kept on this device only.
import { useState, useEffect, useRef } from "react";
import { Sheet, ConfirmLink } from "./app.jsx";
import { runTool, setupBrief } from "./aitools.js";

const KEY_LS = "bj:__ask-key", CHATS_KEY = "bj-ask-v1", API = "https://api.anthropic.com/v1/messages";
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} } };
export const askKey = () => (ls.get(KEY_LS) || "").trim();
// Two ways to run it: Claude through the user's Anthropic account (paid per question, strongest), or Google's Gemini
// through a free Google AI Studio key (no card, daily limits). The key itself says which one it is.
export const providerOf = (k) => (/^sk-ant-/.test(k || "") ? "anthropic" : k ? "google" : null);

// The app picks how hard Claude thinks from the question itself — there is nothing to choose. Anything that involves
// building a scenario goes to the strongest model with more thinking; plain look-ups go to the mid model. Each plan
// lists models to try in order (a name the account doesn't have simply falls through to the next).
const PLANS = {
  balanced: { models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"], effort: "high", max: 8000 },
  deep: { models: ["claude-opus-5-5", "claude-sonnet-5-5"], effort: "high", max: 16000 },
};
export function pickPlan(text) {
  const t = String(text || "").toLowerCase().trim();
  const lookup = t.length < 90 && /^(what('?s| is| was| are| were) my|how many|how much (have|did) i|how am i (doing|running)|show( me)?|list|when did|what'?s the (right|correct) play|what do i do with)\b/.test(t) && !/\b(if|would|should|instead|versus|vs|cover|skip|never|always|cost)\b/.test(t);
  return lookup ? "balanced" : "deep";
}

const SYSTEM = `You are the assistant built into a blackjack card-counting trainer app. The user counts cards (Hi-Lo, Blackjack Apprenticeship charts: basic strategy, Illustrious 18, Fab 4). True count = running count ÷ decks left estimated to the nearest half deck, truncated toward zero. Insurance at true count +3.

You answer questions about their game: win rate, swings, risk of ruin, bankroll, bet spreads, cover plays and what they cost, mistakes and what they cost, their logged casino results, and their practice stats.

ACCURACY RULES — these matter more than anything else:
1. Every number about win rate, edge, variance, risk of ruin, bankroll or probabilities must come from a tool call in this conversation (or the setup below). Never estimate, recall or "ballpark" such numbers yourself, and never adjust a tool's number by hand. If you need a number you don't have, call a tool. Plain arithmetic on tool numbers is fine (a difference, a total over some hours, a percentage change) — keep it simple and show what you did.
2. To answer "what would X do", call calculate with the current game ({} named "current") AND the changed scenario in the same call, then report both and the difference.
3. Build scenarios faithfully. Re-read the user's words and map each part to a field. If a detail is ambiguous and changes the answer materially, ask one short question instead of guessing; otherwise state the assumption you made in one line.
4. If something isn't modeled (a cover play with no matching field, side bets, shuffle tracking, hole-carding, other counting systems, team signaling), say plainly that the app can't calculate it. You may then offer the closest thing it can calculate, clearly labeled as a stand-in. Never invent a number for it.
5. Tool results are the source of truth even when they surprise you. If a result looks wrong, check your scenario for a mistake, rerun, and if it still stands, report it as is.
6. Combine cover plays in ONE scenario when the user means them together; use separate scenarios to show each one's cost.

WHAT THE CALCULATOR KNOWS
- Exact from the calibrated model: any bets by count, one or two hands, sitting out or leaving at low counts, bankroll, table size, speed, penetration, decks, H17/S17, surrender, DAS, double restrictions, resplit aces, split limits, 6:5.
- Measured in the card simulator and added on top (the cover object): skipping or forcing any single count play, skipping all of them, insurance variants, a few playing habits, a slip rate on close decisions, cruder or better true-count estimation, and missing a share of cards.
- Dealt live when asked (bet_policy): bets that depend on the previous hand — never more than doubling, raising only after a win, not lowering after a win, flat betting the first rounds of a shoe, a set bet off the top.
- risk_over_time uses a bell curve on hourly results; fine beyond a few hours, slightly thin in the tails for very short sessions.
- Risk of ruin assumes the same spread is played forever with no resizing, tips or outside income unless given.
- Heat, backoffs and what a pit boss notices are judgment, not math. You can share common wisdom about what draws attention, but label it as opinion and never put a number on detection risk.

HOW TO ANSWER
- Lead with the answer in a sentence, in dollars per hour and plain words. Then the few numbers that support it. Use a small table only when comparing options.
- Say "true count" (or TC after first use), "win per hour", "swing", "risk of ruin". Explain a term in a few words the first time if it's jargon (N0 = hours until skill outweighs luck).
- Round sensibly: dollars per hour to the dollar (cents only under $5), percentages to one decimal, risk of ruin to two significant figures.
- Keep it short. No headings for short answers, no filler, no closing offers unless there's a clearly useful next step.
- When a cover play costs little, say so; when it costs a lot, say that and suggest a cheaper one that achieves similar cover if the catalog has one.
- If the user's setup loses money or has a very high risk of ruin, say so directly.
- You can't change the app's settings. If they want to adopt a spread, tell them the bets to enter on the Spread tab.
- This is a training tool; counting is legal but casinos may refuse service. Don't lecture about it.`;

/* ---------- API ---------- */
class ApiError extends Error { constructor(status, type, msg) { super(msg || "request failed"); this.status = status; this.type = type; } }
const forApi = (msgs, keepThinking) => {
  // older turns: drop bulky tool output (the model can recalculate), and thinking blocks unless still inside the current turn
  let lastUser = -1; msgs.forEach((m, i) => { if (m.role === "user" && typeof m.content === "string") lastUser = i; });
  const userIdx = msgs.map((m, i) => (m.role === "user" && typeof m.content === "string" ? i : -1)).filter((i) => i >= 0), keepFrom = userIdx.length > 3 ? userIdx[userIdx.length - 3] : 0;
  return msgs.map((m, i) => {
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    let c = m.content;
    if (m.role === "assistant") c = c.filter((b) => (b.type === "thinking" || b.type === "redacted_thinking" ? keepThinking && i > lastUser : true));
    else if (i < keepFrom) c = c.map((b) => (b.type === "tool_result" && typeof b.content === "string" && b.content.length > 600 ? { ...b, content: b.content.slice(0, 500) + '… [older numbers trimmed — recalculate if needed]' } : b));
    return { role: m.role, content: c };
  }).filter((m) => typeof m.content === "string" || m.content.length);
};
async function streamOnce({ key, model, effort, max, system, tools, msgs, thinking, signal, onText }) {
  const body = { model, max_tokens: max, stream: true, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], tools, messages: forApi(msgs, thinking) };
  if (thinking) { body.thinking = { type: "adaptive" }; body.output_config = { effort }; }
  let res;
  try { res = await fetch(API, { method: "POST", signal, headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify(body) }); }
  catch (e) { if (e && e.name === "AbortError") throw e; throw new ApiError(0, "network", "network"); }
  if (!res.ok) { let type = "", msg = ""; try { const j = await res.json(); type = (j.error && j.error.type) || ""; msg = (j.error && j.error.message) || ""; } catch (_) {} throw new ApiError(res.status, type, msg); }
  const blocks = [], partial = {}; let stop = null, usage = {}, buf = "";
  const handle = (ev) => {
    if (ev.type === "content_block_start") { const b = { ...ev.content_block }; if (b.type === "tool_use") { partial[ev.index] = ""; b.input = {}; } blocks[ev.index] = b; }
    else if (ev.type === "content_block_delta") {
      const b = blocks[ev.index], d = ev.delta; if (!b || !d) return;
      if (d.type === "text_delta") { b.text = (b.text || "") + d.text; onText && onText(blocks); }
      else if (d.type === "input_json_delta") partial[ev.index] += d.partial_json || "";
      else if (d.type === "thinking_delta") b.thinking = (b.thinking || "") + d.thinking;
      else if (d.type === "signature_delta") b.signature = (b.signature || "") + d.signature;
    } else if (ev.type === "content_block_stop") { const b = blocks[ev.index]; if (b && b.type === "tool_use") { try { b.input = partial[ev.index] ? JSON.parse(partial[ev.index]) : {}; } catch (_) { b.input = {}; } onText && onText(blocks); } }
    else if (ev.type === "message_delta") { if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason; if (ev.usage) usage = { ...usage, ...ev.usage }; }
    else if (ev.type === "message_start") { if (ev.message && ev.message.usage) usage = { ...ev.message.usage }; }
    else if (ev.type === "error") throw new ApiError(529, (ev.error && ev.error.type) || "error", (ev.error && ev.error.message) || "stream error");
  };
  const reader = res.body.getReader(), dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); for (const line of chunk.split("\n")) if (line.startsWith("data:")) { const s = line.slice(5).trim(); if (s && s !== "[DONE]") { let ev = null; try { ev = JSON.parse(s); } catch (_) {} if (ev) handle(ev); } } }
  }
  return { content: blocks.filter(Boolean), stop, usage, model };
}
// tries the plan's models in order; drops the thinking settings if the account's model doesn't take them
async function callModel(state, args) {
  let last = null;
  for (let mi = state.mi || 0; mi < state.plan.models.length; mi++) {
    for (const th of state.thinking === false ? [false] : [true, false]) {
      try { const r = await streamOnce({ ...args, model: state.plan.models[mi], effort: state.plan.effort, max: state.plan.max, thinking: th }); state.mi = mi; state.thinking = th; return r; }
      catch (e) {
        if (!(e instanceof ApiError)) throw e; last = e;
        if (e.status === 404 || (e.status === 400 && /model/i.test(e.message) && !/thinking|effort|output_config/i.test(e.message))) break;
        if (th && e.status === 400 && /thinking|effort|output_config|adaptive/i.test(e.message)) continue;
        throw e;
      }
    }
  }
  throw last || new ApiError(404, "not_found", "no model available");
}
/* ---------- Google Gemini (free tier) ---------- */
const GAPI = "https://generativelanguage.googleapis.com/v1beta/";
// tool schemas in the subset Gemini accepts
const gSchema = (x) => { if (!x || typeof x !== "object") return x; const o = {}; if (x.type) o.type = x.type; if (x.description) o.description = x.description; if (Array.isArray(x.enum) && x.enum.every((v) => typeof v === "string")) o.enum = x.enum; if (x.properties) { o.properties = {}; Object.keys(x.properties).forEach((k) => (o.properties[k] = gSchema(x.properties[k]))); } if (x.items) o.items = gSchema(x.items); if (x.required) o.required = x.required; return o; };
let _gModels = null;
// the newest Flash models this key can use, best first, then the lighter ones (which have a much larger free daily allowance)
async function geminiModels(key, signal) {
  if (_gModels) return _gModels;
  const fallback = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"];
  try {
    const r = await fetch(GAPI + "models?pageSize=200", { signal, headers: { "x-goog-api-key": key } });
    if (!r.ok) { if (r.status === 400 || r.status === 401 || r.status === 403) { let m = ""; try { m = ((await r.json()).error || {}).message || ""; } catch (_) {} throw new ApiError(r.status === 400 ? 401 : r.status, "auth", m); } return fallback; }
    const j = await r.json(), flash = [], lite = [];
    (j.models || []).forEach((m) => { const x = /^models\/gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/.exec(m.name || ""); if (x && (m.supportedGenerationMethods || []).includes("generateContent")) (x[2] ? lite : flash).push([+x[1], m.name.slice(7)]); });
    const top = (a) => a.sort((p, q) => q[0] - p[0]).slice(0, 2).map((p) => p[1]), list = [...top(flash), ...top(lite)];
    return (_gModels = list.length ? list : fallback);
  } catch (e) { if (e instanceof ApiError || (e && e.name === "AbortError")) throw e; return fallback; }
}
function toGemini(msgs) {
  let lastUser = -1; msgs.forEach((m, i) => { if (m.role === "user" && typeof m.content === "string") lastUser = i; });
  const names = {}; msgs.forEach((m) => { if (m.role === "assistant" && Array.isArray(m.content)) m.content.forEach((b) => { if (b.type === "tool_use") names[b.id] = b.name; }); });
  const out = [], push = (role, parts) => { const p = out[out.length - 1]; if (p && p.role === role && p.parts.every((x) => x.text != null) && parts.every((x) => x.text != null)) p.parts.push(...parts); else out.push({ role, parts }); };
  msgs.forEach((m, i) => {
    if (typeof m.content === "string") push("user", [{ text: m.content }]);
    else if (i < lastUser) { if (m.role === "assistant") { const t = m.content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n\n"); if (t) push("model", [{ text: t }]); } } // earlier turns: the answers only
    else if (m.role === "assistant") out.push({ role: "model", parts: m._g || m.content.map((b) => (b.type === "text" ? { text: b.text } : b.type === "tool_use" ? { functionCall: { name: b.name, args: b.input } } : null)).filter(Boolean) });
    else out.push({ role: "user", parts: m.content.filter((b) => b.type === "tool_result").map((b) => { let v = b.content; try { v = JSON.parse(b.content); } catch (_) {} return { functionResponse: { name: names[b.tool_use_id] || "tool", response: { result: v } } }; }) });
  });
  return out;
}
async function callGemini(state, { key, system, tools, msgs, signal }) {
  const models = await geminiModels(key, signal);
  const body = JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: toGemini(msgs), tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: gSchema(t.input_schema) })) }], generationConfig: { maxOutputTokens: 16000 } });
  let last = null;
  for (let mi = state.mi || 0; mi < models.length; mi++) {
    let res;
    try { res = await fetch(GAPI + "models/" + models[mi] + ":generateContent", { method: "POST", signal, headers: { "content-type": "application/json", "x-goog-api-key": key }, body }); }
    catch (e) { if (e && e.name === "AbortError") throw e; throw new ApiError(0, "network", "network"); }
    if (!res.ok) {
      let msg = "", st = ""; try { const j = await res.json(); msg = (j.error && j.error.message) || ""; st = (j.error && j.error.status) || ""; } catch (_) {}
      last = new ApiError(res.status === 400 && /api key/i.test(msg) ? 401 : res.status, st, msg);
      if (res.status === 429 || res.status === 404 || res.status >= 500) continue; // this model's free allowance is used up, or it isn't offered: try the next one
      throw last;
    }
    const j = await res.json(), cand = (j.candidates || [])[0], parts = (cand && cand.content && cand.content.parts) || [];
    if (!parts.length) { last = new ApiError(500, "empty", (cand && cand.finishReason) || (j.promptFeedback && j.promptFeedback.blockReason) || "no answer"); continue; }
    state.mi = mi;
    const content = []; parts.forEach((p, k) => { if (p.functionCall) content.push({ type: "tool_use", id: p.functionCall.id || "g" + Date.now().toString(36) + k, name: p.functionCall.name, input: p.functionCall.args || {} }); else if (p.text && !p.thought) content.push({ type: "text", text: p.text }); });
    const calls = content.some((b) => b.type === "tool_use");
    return { content, _g: parts, stop: calls ? "tool_use" : cand.finishReason === "MAX_TOKENS" ? "max_tokens" : "end_turn", model: models[mi] };
  }
  throw last || new ApiError(404, "not_found", "no model available");
}
const errTextG = (e) => {
  if (e.status === 0) return "Couldn't reach Google — check your connection and try again.";
  if (e.status === 401 || e.status === 403) return "Google didn't accept this key. Check it in Settings → Ask.";
  if (e.status === 429) return "You've used up Google's free allowance for now. It refills through the day and resets overnight — try again later, or add a Claude key in Settings for unlimited questions.";
  if (e.status >= 500) return "Google's servers are busy. Try again in a moment.";
  if (e.status === 404) return "This key doesn't have access to a Gemini model the app can use.";
  return "Google returned an error: " + (e.message || e.status);
};
const errText = (e, prov) => {
  if (!(e instanceof ApiError)) return "Something went wrong: " + String((e && e.message) || e);
  if (prov === "google") return errTextG(e);
  if (e.status === 0) return "Couldn't reach Anthropic — check your connection and try again.";
  if (e.status === 401 || e.status === 403) return "Anthropic didn't accept this key. Check it in Settings → Ask.";
  if (/credit|billing|balance/i.test(e.message)) return "Your Anthropic account is out of credit. Add some at console.anthropic.com → Billing, then ask again.";
  if (e.status === 429) return "Anthropic is rate-limiting this key right now. Give it a minute and ask again.";
  if (e.status >= 500) return "Anthropic's servers are busy. Try again in a moment.";
  if (e.status === 404) return "This key doesn't have access to the models this app uses.";
  return "Anthropic returned an error: " + (e.message || e.status);
};

/* ---------- small markdown ---------- */
function inline(s, k) {
  const out = []; let i = 0, n = 0; const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g; let m;
  while ((m = re.exec(s))) { if (m.index > i) out.push(s.slice(i, m.index)); const t = m[0]; out.push(t.startsWith("**") ? <strong key={k + "b" + n++}>{t.slice(2, -2)}</strong> : t.startsWith("`") ? <code key={k + "c" + n++}>{t.slice(1, -1)}</code> : <em key={k + "i" + n++}>{t.slice(1, -1)}</em>); i = m.index + t.length; }
  if (i < s.length) out.push(s.slice(i)); return out;
}
function Md({ text }) {
  const lines = String(text || "").replace(/\r/g, "").split("\n"), out = []; let i = 0, k = 0;
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l), cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (isRow(l) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = cells(l), rows = []; i += 2; while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(<div className="asktbl" key={k++}><table><thead><tr>{head.map((c, j) => <th key={j}>{inline(c, "h" + j)}</th>)}</tr></thead><tbody>{rows.map((r, a) => <tr key={a}>{r.map((c, j) => <td key={j}>{inline(c, a + "d" + j)}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ord = /^\s*\d+[.)]\s+/.test(l), items = []; while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const L = ord ? "ol" : "ul"; out.push(<L key={k++}>{items.map((t, j) => <li key={j}>{inline(t, "l" + j)}</li>)}</L>); continue;
    }
    if (/^#{1,6}\s+/.test(l)) { out.push(<p key={k++} className="askh">{inline(l.replace(/^#{1,6}\s+/, ""), "t")}</p>); i++; continue; }
    const para = []; while (i < lines.length && lines[i].trim() && !isRow(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !/^#{1,6}\s+/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={k++}>{para.map((t, j) => <span key={j}>{j > 0 && <br />}{inline(t, "p" + j)}</span>)}</p>);
  }
  return <div className="askmd">{out}</div>;
}

/* ---------- storage ---------- */
async function loadChats() { try { const r = await window.storage.get(CHATS_KEY, false); const d = r && r.value ? JSON.parse(r.value) : null; return d && Array.isArray(d.chats) ? d.chats : []; } catch (_) { return []; } }
async function saveChats(chats) {
  let list = chats.slice().sort((a, b) => b.t - a.t).slice(0, 60);
  // stay well inside the browser's storage: shed the oldest chats first if it ever gets big
  let s = JSON.stringify({ chats: list }); while (s.length > 1500000 && list.length > 1) { list = list.slice(0, list.length - 1); s = JSON.stringify({ chats: list }); }
  try { await window.storage.set(CHATS_KEY, s, false); } catch (_) {}
}
const TOOL_LABEL = { calculate: "Ran the calculator", risk_over_time: "Worked out the odds over time", bankroll_needed: "Sized the bankroll", optimize_spread: "Optimized the spread", stop_loss_and_win_goal: "Worked out the stop rules", correct_play: "Looked up the play", session_results: "Read your sessions", training_stats: "Read your practice record" };
const TOOL_BUSY = { calculate: "Running the calculator", risk_over_time: "Working out the odds over time", bankroll_needed: "Sizing the bankroll", stop_loss_and_win_goal: "Working out the stop rules", optimize_spread: "Optimizing the spread", correct_play: "Looking up the play", session_results: "Reading your sessions", training_stats: "Reading your practice record" };

// stored messages → what's shown: one bubble per question, one per answer (its tool work folded into "the numbers")
function turns(msgs) {
  const out = []; let cur = null;
  msgs.forEach((m) => {
    if (m.role === "user" && typeof m.content === "string") { out.push({ role: "user", text: m.content }); cur = null; return; }
    if (!cur) { cur = { role: "assistant", text: "", work: [], model: null, note: null }; out.push(cur); }
    if (m.role === "assistant") { m.content.forEach((b) => { if (b.type === "text" && b.text) cur.text += (cur.text ? "\n\n" : "") + b.text; else if (b.type === "tool_use") cur.work.push({ id: b.id, name: b.name, input: b.input, out: null }); }); if (m._note) cur.note = m._note; }
    else m.content.forEach((b) => { if (b.type === "tool_result") { const w = cur.work.find((x) => x.id === b.tool_use_id); if (w) w.out = b.content; } });
  });
  return out;
}

const CSS = `
.askgrid{max-width:760px}
.askside{display:none}
.asktop{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px}
.askpill{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;padding:8px 13px;border-radius:999px;color:var(--ivory-d);background:rgba(var(--fg),.06);border:1px solid rgba(var(--fg),.1);white-space:nowrap;transition:background .15s,transform .13s,color .15s}
.askpill:active{transform:scale(.97)}.askpill:disabled{opacity:.45}
.askpill .n{font-variant-numeric:tabular-nums;font-size:11px;padding:1px 6px;border-radius:999px;background:rgba(var(--fg),.1);color:var(--ivory-d)}
.askhero{display:flex;gap:14px;align-items:flex-start;margin-bottom:22px}
.askbadge{width:44px;height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--brass);background:rgba(var(--acc),.12);border:1px solid rgba(var(--acc),.22)}
.asksug{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:13px 14px;border-radius:16px;color:var(--ivory);background:rgba(var(--fg),.04);border:1px solid rgba(var(--fg),.09);margin-bottom:8px;transition:background .15s,border-color .15s,transform .13s}
.asksug:active{transform:scale(.99)}
.asksug .k{display:block;font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--brass);margin-bottom:3px}
.asksug .q{display:block;font-size:14.5px;line-height:1.35}
.asksug svg{flex-shrink:0;color:var(--muted)}
.askmsg{margin-bottom:14px;animation:rise .25s var(--ease) both}
.askq{margin-left:auto;max-width:88%;width:fit-content;padding:10px 15px;border-radius:20px 20px 6px 20px;background:rgba(var(--acc),.15);border:1px solid rgba(var(--acc),.24);color:var(--ivory);font-size:15px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
.aska{padding:16px 16px 14px;font-size:15px;line-height:1.6;color:var(--ivory);overflow-wrap:anywhere}
.askmd p{margin:0 0 .75em}.askmd p:last-child,.askmd ul:last-child,.askmd ol:last-child,.askmd .asktbl:last-child{margin-bottom:0}.askmd ul,.askmd ol{margin:0 0 .75em;padding-left:1.25em}.askmd ul{list-style:disc}.askmd ol{list-style:decimal}.askmd li{margin:.25em 0}.askmd li::marker{color:var(--muted)}
.askmd strong{font-weight:650;color:var(--ivory)}.askmd code{font-size:.9em;padding:1px 5px;border-radius:5px;background:rgba(var(--fg),.09)}.askmd .askh{font-weight:650}
.asktbl{overflow-x:auto;margin:0 0 .85em;border:1px solid rgba(var(--fg),.1);border-radius:12px;-webkit-overflow-scrolling:touch}.asktbl table{border-collapse:collapse;width:100%;font-size:13.5px;font-variant-numeric:tabular-nums}
.asktbl th,.asktbl td{padding:8px 12px;text-align:left;white-space:nowrap;border-bottom:1px solid rgba(var(--fg),.07)}.asktbl th{font-weight:600;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase;background:rgba(var(--fg),.035)}.asktbl tr:last-child td{border-bottom:0}.asktbl td:first-child{color:var(--ivory-d)}
.askfoot{display:flex;align-items:center;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(var(--fg),.07)}
.askfoot button{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--muted);padding:5px 9px;margin-left:-9px;border-radius:8px;transition:color .15s,background .15s}
.askfoot button svg{transition:transform .2s var(--ease)}.askfoot button[aria-expanded="true"] svg.chev{transform:rotate(180deg)}
.askwork{margin-top:8px}
.askwork .w{border:1px solid rgba(var(--fg),.08);border-radius:12px;margin-bottom:8px;overflow:hidden}
.askwork .wh{display:flex;align-items:center;gap:8px;padding:9px 12px;font-size:12.5px;font-weight:600;color:var(--ivory-d);background:rgba(var(--fg),.03)}
.askwork .wb{padding:12px;font-size:13px;line-height:1.45}
.askwork .asktbl{margin-bottom:8px}
.askwork details{border-top:1px solid rgba(var(--fg),.07);padding:2px 0}
.askwork summary{cursor:pointer;font-size:12.5px;font-weight:600;color:var(--ivory-d);padding:8px 0;list-style:none;display:flex;align-items:center;gap:6px}
.askwork summary::-webkit-details-marker{display:none}
.askwork summary::before{content:"";width:6px;height:6px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(-45deg);transition:transform .15s;margin-right:2px}
.askwork details[open]>summary::before{transform:rotate(45deg)}
.nkv{margin:0}.nrow{display:flex;justify-content:space-between;gap:14px;padding:4px 0;border-bottom:1px dashed rgba(var(--fg),.06)}.nrow dt{color:var(--muted)}.nrow dd{margin:0;text-align:right;color:var(--ivory);font-variant-numeric:tabular-nums;max-width:62%}
.ngrp{padding:8px 0 4px}.ngrp>dt{font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}.ngrp>dd{margin:0;padding-left:10px;border-left:2px solid rgba(var(--acc),.2)}
.nblk{padding:6px 0;border-bottom:1px solid rgba(var(--fg),.06)}.nblk:last-child{border-bottom:0}
.askstat{display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--ivory-d)}
.askdots{display:inline-flex;gap:4px}.askdots i{width:6px;height:6px;border-radius:50%;background:var(--brass);animation:askp 1.1s ease-in-out infinite}.askdots i:nth-child(2){animation-delay:.15s}.askdots i:nth-child(3){animation-delay:.3s}
@keyframes askp{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
.askerr{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:14px;margin-bottom:14px;font-size:14px;color:var(--neg-l);background:rgba(var(--neg),.09);border:1px solid rgba(var(--neg),.25)}
.askbar{position:sticky;bottom:calc(env(safe-area-inset-bottom) + 70px);z-index:30;margin:20px -6px 0;padding:16px 6px 8px;background:rgba(var(--bgrgb),.5);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);-webkit-mask-image:linear-gradient(180deg,transparent,#000 16px);mask-image:linear-gradient(180deg,transparent,#000 16px)}
.askbox{display:flex;align-items:flex-end;gap:8px;padding:7px 7px 7px 16px;border-radius:24px;background:var(--bg2);border:1px solid rgba(var(--fg),.16);box-shadow:0 14px 34px -16px rgba(0,0,0,.75);transition:border-color .15s,box-shadow .15s}
.askbox:focus-within{border-color:rgba(var(--acc),.55);box-shadow:0 0 0 3px rgba(var(--acc),.12),0 14px 34px -16px rgba(0,0,0,.75)}
.askbox textarea{flex:1;min-width:0;background:transparent;border:0;outline:0;resize:none;color:var(--ivory);font:inherit;font-size:16px;line-height:1.4;padding:8px 0;max-height:140px}
.askbox textarea::placeholder{color:var(--muted)}
.asksend{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,var(--acc-hi),var(--brass));color:var(--ink);flex-shrink:0;transition:transform .13s,opacity .15s,background .15s}
.asksend:disabled{background:rgba(var(--fg),.1);color:var(--muted)}.asksend:not(:disabled):active{transform:scale(.93)}
.asksend.stop{background:rgba(var(--fg),.12);color:var(--ivory)}
.askhint{display:none}
.askrow{display:flex;align-items:center;gap:6px;border-bottom:1px solid rgba(var(--fg),.07)}
.askrow:last-of-type{border-bottom:0}
.askrow .main{flex:1;min-width:0;text-align:left;padding:12px 2px}
.askrow .t1{font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ivory)}.askrow.on .t1{color:var(--brass);font-weight:600}.askrow .t2{font-size:11.5px;color:var(--muted);margin-top:1px}
.askrecent{margin-top:22px}
.askstep{display:flex;gap:12px;align-items:flex-start;margin-bottom:12px;font-size:14px;color:var(--ivory-d);line-height:1.45}
.askstep b{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;flex-shrink:0;font-size:12px;font-weight:700;color:var(--brass);background:rgba(var(--acc),.13)}
@media (hover:hover){.asksug:hover{background:rgba(var(--fg),.07);border-color:rgba(var(--acc),.3)}.askpill:hover:not(:disabled){background:rgba(var(--fg),.1);color:var(--ivory)}.askfoot button:hover{color:var(--ivory);background:rgba(var(--fg),.06)}.askrow .main:hover .t1{color:var(--brass)}}
@media (min-width:640px){.asksugs{display:grid;grid-template-columns:1fr 1fr;gap:10px}.asksugs .asksug{margin-bottom:0;align-items:flex-start}.asksugs .asksug svg{margin-top:2px}}
@media (min-width:1024px){.askbar{bottom:0;padding-bottom:20px}.askhint{display:block;text-align:center;font-size:11px;color:var(--muted);margin-top:8px}}
@media (min-width:1180px){
  .askgrid{max-width:none;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:32px;align-items:start}
  .askmain{max-width:760px;min-width:0}
  .askside{display:block;position:sticky;top:44px;padding:16px}
  .asktop{display:none}
  .askrecent{display:none}
}
:root[data-theme="light"] .askbox{box-shadow:0 10px 28px -16px rgba(15,27,61,.35)}
:root[data-theme="light"] .askerr{color:var(--rose)}
@media (prefers-reduced-motion:reduce){.askmsg,.askdots i{animation:none}.askdots i{opacity:.7}}
`;
const SUGGEST = [
  ["Cover plays", "What does skipping the 16 vs 10 and 12 vs 3 plays cost me?"],
  ["Betting cover", "How much does never raising my bet after a loss cost per hour?"],
  ["Risk", "If I bring $1,500 on a trip, what are the odds I lose it all in 8 hours?"],
  ["Your results", "How am I running compared to expected?"],
];
const when = (t) => { const d = new Date(t), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
const I = {
  chat: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4.5 19.5l1.3-4.2A7.5 7.5 0 1 1 20 11.5z" /><path d="M9.5 11.5h.01M12.5 11.5h.01M15.5 11.5h.01" /></svg>,
  plus: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>,
  clock: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>,
  go: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>,
  calc: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M8.5 8h7M8.5 12.5h.01M12 12.5h.01M15.5 12.5h.01M8.5 16h.01M12 16h.01M15.5 16h.01" /></svg>,
  chev: <svg className="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>,
  up: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>,
  stop: <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect width="12" height="12" rx="2.5" fill="currentColor" /></svg>,
  warn: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}><path d="M12 8v5M12 16.5h.01" /><circle cx="12" cy="12" r="9" /></svg>,
};

/* ---------- "the numbers behind this": the calculator's inputs and outputs, laid out to be read ---------- */
const lab = (k) => { const t = String(k).replace(/_pcts?\b/g, " %").replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const isMoney = (k) => /(win|swing|bankroll|bet|expected|one_sd|net|result|drawdown|cash|biggest|dollars|typical|worse|per_hour|from|to|min|max|goal|loss)/.test(k) && !/(pct|hours|share|hands|rounds|kelly_fraction|percentile|sessions|luck|chance|tc|players|multiple|first)/.test(k);
const fmt = (v, k = "") => (typeof v === "number" ? (isMoney(k) ? (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) : v.toLocaleString(undefined, { maximumFractionDigits: 3 }) + (/_pct$/.test(k) ? "%" : "")) : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));
const plain = (x) => x === null || typeof x !== "object";
function Nice({ v, k = "" }) {
  if (v == null) return <span>—</span>;
  if (Array.isArray(v)) {
    if (!v.length) return <span>—</span>;
    if (v.every(plain)) return <span>{v.map((x) => fmt(x, k)).join(v.some((x) => String(x).length > 24) ? " · " : ", ")}</span>;
    const keys = Object.keys(v[0] || {});
    if (keys.length <= 7 && v.every((x) => x && !Array.isArray(x) && Object.keys(x).every((q) => plain(x[q])))) { const cols = Array.from(new Set(v.flatMap((x) => Object.keys(x)))); return <div className="asktbl"><table><thead><tr>{cols.map((c) => <th key={c}>{lab(c)}</th>)}</tr></thead><tbody>{v.map((x, i) => <tr key={i}>{cols.map((c) => <td key={c}>{x[c] == null ? "" : fmt(x[c], c)}</td>)}</tr>)}</tbody></table></div>; }
    return <div>{v.map((x, i) => <div key={i} className="nblk"><Nice v={x} k={k} /></div>)}</div>;
  }
  if (typeof v === "object") return <dl className="nkv">{Object.keys(v).filter((q) => !q.startsWith("_")).map((q) => (plain(v[q]) ? <div key={q} className="nrow"><dt>{lab(q)}</dt><dd>{fmt(v[q], q)}</dd></div> : <div key={q} className="ngrp"><dt>{lab(q)}</dt><dd><Nice v={v[q]} k={q} /></dd></div>))}</dl>;
  return <span>{fmt(v, k)}</span>;
}
function Work({ w }) {
  let out = null; try { out = JSON.parse(w.out); } catch (_) {}
  const res = w.name === "calculate" && out && Array.isArray(out.results) ? out.results : null;
  return (
    <div className="w">
      <div className="wh">{I.calc}{TOOL_LABEL[w.name] || w.name}</div>
      <div className="wb">
        {res ? <>
          <div className="asktbl"><table><thead><tr><th>Scenario</th><th>Win / hr</th><th>Swing / hr</th><th>Risk of ruin</th><th>Long run</th></tr></thead><tbody>{res.map((x, i) => <tr key={i}><td>{x.name}</td><td>{fmt(x.win_per_hour, "win")}</td><td>±{fmt(x.swing_per_hour_1sd, "swing")}</td><td>{x.risk_of_ruin_pct}%</td><td>{x.hours_to_long_run_n0 == null ? "never" : x.hours_to_long_run_n0.toLocaleString() + " hrs"}</td></tr>)}</tbody></table></div>
          {res.map((x, i) => <details key={i}><summary>{x.name}: every number</summary><Nice v={x} /></details>)}
        </> : out ? <Nice v={out} /> : <div className="text-xs" style={{ color: "var(--muted)" }}>{w.out || "No result."}</div>}
        {!res && w.input && Object.keys(w.input).length > 0 && <details><summary>What was asked</summary><Nice v={w.input} /></details>}
      </div>
    </div>
  );
}

function KeyForm({ onSaved, hint }) {
  const [v, setV] = useState(""), [msg, setMsg] = useState("");
  const save = () => { const k = v.replace(/[^\x21-\x7E]/g, ""); if (k.length < 30 || /\s/.test(k)) { setMsg("That doesn't look like a complete key — copy the whole thing and paste it again."); return; } ls.set(KEY_LS, k); _gModels = null; setV(""); setMsg(""); onSaved && onSaved(); };
  return (
    <div>
      <div className="flex gap-2">
        <input className="in" type="password" autoComplete="off" spellCheck={false} placeholder={hint || "Paste your key"} value={v} onChange={(e) => { setV(e.target.value); setMsg(""); }} onKeyDown={(e) => { if (e.key === "Enter") save(); }} aria-label="API key" />
        <button className="btn" style={{ width: "auto", padding: "10px 20px", fontSize: 14 }} onClick={save} disabled={!v.trim()}>Save</button>
      </div>
      {msg && <div className="text-xs mt-2" style={{ color: "var(--rose)" }} role="alert">{msg}</div>}
    </div>
  );
}
const LINK = { color: "var(--brass)", textDecoration: "underline", textUnderlineOffset: 2 };
// The two ways to turn the Ask tab on. Free is the default; Claude is there for people who want the strongest answers.
function KeySetup({ onSaved }) {
  const [paid, setPaid] = useState(false);
  return (
    <div>
      <div className="chipseg mb-4" role="tablist" aria-label="How to run it">{[[false, "Free", "Google Gemini"], [true, "Best answers", "Claude, a few cents each"]].map(([k, a, b]) => <button key={a} type="button" role="tab" aria-selected={paid === k} className={paid === k ? "on" : ""} onClick={() => setPaid(k)} style={{ padding: "8px 6px", lineHeight: 1.2 }}><span className="block text-sm font-semibold">{a}</span><span className="block text-[11px]" style={{ opacity: .75 }}>{b}</span></button>)}</div>
      {paid ? <>
        <div className="askstep"><b>1</b><span>Open <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" style={LINK}>console.anthropic.com</a>, create an API key, and add a few dollars of credit under Billing.</span></div>
        <div className="askstep" style={{ marginBottom: 14 }}><b>2</b><span>Paste the key here.</span></div>
        <KeyForm onSaved={onSaved} hint="sk-ant-…" />
        <p className="text-xs mt-4" style={{ color: "var(--muted)" }}>You pay Anthropic directly, usually a few cents a question. The key stays on this device and is sent only to Anthropic.</p>
      </> : <>
        <div className="askstep"><b>1</b><span>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={LINK}>aistudio.google.com/apikey</a> and sign in with a Google account. No card needed.</span></div>
        <div className="askstep"><b>2</b><span>Tap <strong style={{ color: "var(--ivory)" }}>Create API key</strong> and copy it.</span></div>
        <div className="askstep" style={{ marginBottom: 14 }}><b>3</b><span>Paste the key here.</span></div>
        <KeyForm onSaved={onSaved} hint="Paste your Google key" />
        <p className="text-xs mt-4" style={{ color: "var(--muted)" }}>Free, with a daily limit that's plenty for normal use. The key stays on this device and is sent only to Google. On the free plan Google may use your questions to improve its models, so don't type anything private.</p>
      </>}
    </div>
  );
}
// Settings card
export function AskKeyCard() {
  const [prov, setProv] = useState(() => providerOf(askKey()));
  return (
    <section className="card p-5 mb-4">
      <div className="eyebrow mb-1">Ask</div>
      {prov ? <>
        <p className="text-sm mb-3" style={{ color: "var(--ivory-d)" }}>{prov === "google" ? "Running on Google Gemini's free plan with your Google key, saved on this device." : "Running on Claude with your Anthropic key, saved on this device. Questions are billed to your Anthropic account, usually a few cents each."}</p>
        <ConfirmLink label={prov === "google" ? "Remove the key (to switch to Claude, or paste a new one)" : "Remove the key (to switch to the free option, or paste a new one)"} confirm="Tap again to remove" onConfirm={() => { ls.set(KEY_LS, null); _gModels = null; setProv(null); }} />
      </> : <KeySetup onSaved={() => setProv(providerOf(askKey()))} />}
    </section>
  );
}

function ChatRows({ chats, cid, onPick, onDelete, limit }) {
  const list = chats.slice().sort((a, b) => b.t - a.t).slice(0, limit || 999);
  return list.map((c) => { const n = c.msgs.filter((m) => typeof m.content === "string").length; return (
    <div key={c.id} className={"askrow" + (c.id === cid ? " on" : "")}>
      <button className="main" onClick={() => onPick(c.id)} aria-current={c.id === cid ? "true" : undefined}><div className="t1">{c.title}</div><div className="t2">{when(c.t)} · {n} question{n === 1 ? "" : "s"}</div></button>
      {onDelete && <ConfirmLink label="Delete" confirm="Delete?" onConfirm={() => onDelete(c.id)} />}
    </div>); });
}

export function AskPage() {
  const [hasKey, setHasKey] = useState(() => !!askKey());
  const [chats, setChats] = useState(null), [cid, setCid] = useState(null);
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [draft, setDraft] = useState(null), [err, setErr] = useState("");
  const [list, setList] = useState(false), [open, setOpen] = useState({});
  const abort = useRef(null), ta = useRef(null), end = useRef(null), live = useRef({ chats: [], cid: null });
  useEffect(() => { let on = true; loadChats().then((c) => { if (on) { setChats(c); live.current.chats = c; } }); return () => { on = false; if (abort.current) abort.current.abort(); }; }, []);
  const chat = (chats || []).find((c) => c.id === cid) || null, view = chat ? turns(chat.msgs) : [];
  const put = (c) => { const next = [c, ...live.current.chats.filter((x) => x.id !== c.id)]; live.current.chats = next; setChats(next); saveChats(next); };
  // follow the answer down the page, but only while the reader is already at the bottom
  const scroll = (force) => { const near = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 260; if (force || near) requestAnimationFrame(() => { if (end.current) end.current.scrollIntoView({ block: "end", behavior: force === "jump" ? "auto" : "smooth" }); }); };
  useEffect(() => { const el = ta.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(140, el.scrollHeight) + "px"; } }, [text, hasKey]);

  const send = async (q) => {
    q = String(q || "").trim(); if (!q || busy) return;
    const key = askKey(); if (!key) { setHasKey(false); return; }
    setErr(""); setText(""); setBusy(true);
    const base = live.current.chats.find((c) => c.id === live.current.cid);
    const c = base ? { ...base, msgs: base.msgs.slice() } : { id: Date.now(), title: q.length > 60 ? q.slice(0, 58) + "…" : q, msgs: [] };
    c.t = Date.now(); c.msgs.push({ role: "user", content: q }); live.current.cid = c.id; setCid(c.id); put(c);
    const prov = providerOf(key), state = { plan: PLANS[pickPlan(q)] }, ctl = new AbortController(); abort.current = ctl;
    setDraft({ text: "", status: "Thinking it through" }); scroll(true);
    const start = c.msgs.length;
    try {
      const brief = await setupBrief(), system = SYSTEM + "\n\nToday is " + new Date().toDateString() + ".\n\nTHE USER'S SETUP RIGHT NOW (from the app; numbers here came from the calculator and may be quoted):\n" + brief.text;
      for (let step = 0; step < 10; step++) {
        const r = prov === "google" ? await callGemini(state, { key, system, tools: brief.toolsFlat, msgs: c.msgs, signal: ctl.signal }) : await callModel(state, { key, system, tools: brief.tools, msgs: c.msgs, signal: ctl.signal, onText: (blocks) => { const t = blocks.filter((b) => b && b.type === "text").map((b) => b.text).join("\n\n"); const tool = blocks.find((b) => b && b.type === "tool_use"); setDraft({ text: t, status: tool ? TOOL_BUSY[tool.name] || "Working" : t ? "" : "Thinking it through" }); scroll(); } });
        if (prov === "google") { const t = r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n\n"); if (t) { setDraft({ text: t, status: "" }); scroll(); } }
        c.msgs.push({ role: "assistant", content: r.content, ...(r._g ? { _g: r._g } : {}), ...(r.stop === "max_tokens" ? { _note: "The answer was cut off at the length limit — ask it to continue." } : {}) });
        const calls = r.content.filter((b) => b.type === "tool_use");
        if (r.stop !== "tool_use" || !calls.length) break;
        setDraft((d) => ({ text: (d && d.text) || "", status: TOOL_BUSY[calls[0].name] || "Working" }));
        await new Promise((res) => setTimeout(res, 40)); // let the status paint before the calculator runs
        const results = []; for (const b of calls) { const out = await runTool(b.name, b.input); results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) }); }
        c.msgs.push({ role: "user", content: results });
        setDraft((d) => ({ text: (d && d.text) || "", status: "Writing the answer" }));
      }
    } catch (e) {
      if (!(e && e.name === "AbortError")) setErr(errText(e, prov));
      // a turn that died mid-way can't be continued by the API (dangling tool calls): drop the fragments
      const tail = c.msgs.slice(start), lastA = tail.filter((m) => m.role === "assistant").pop(), done = lastA && !lastA.content.some((b) => b.type === "tool_use");
      if (!done) { c.msgs = c.msgs.slice(0, start - 1); setText(q); } // and put the question back in the box to send again
    }
    // thinking blocks are only needed inside a turn
    c.msgs = c.msgs.map((m) => { if (!(m.role === "assistant" && Array.isArray(m.content))) return m; const { _g, ...rest } = m; return { ...rest, content: m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking") }; }).filter((m) => typeof m.content === "string" || m.content.length);
    c.t = Date.now();
    if (c.msgs.length) put(c); else { const next = live.current.chats.filter((x) => x.id !== c.id); live.current.chats = next; setChats(next); saveChats(next); live.current.cid = null; setCid(null); }
    setDraft(null); setBusy(false); abort.current = null; scroll();
  };
  const stop = () => { if (abort.current) abort.current.abort(); };
  const pick = (id) => { if (busy) return; live.current.cid = id; setCid(id); setList(false); setErr(""); setOpen({}); setTimeout(() => scroll("jump"), 60); };
  const fresh = () => { if (busy) return; live.current.cid = null; setCid(null); setErr(""); setOpen({}); setList(false); window.scrollTo({ top: 0 }); setTimeout(() => ta.current && ta.current.focus({ preventScroll: true }), 80); };
  const del = (id) => { const next = live.current.chats.filter((x) => x.id !== id); live.current.chats = next; setChats(next); saveChats(next); if (live.current.cid === id) { live.current.cid = null; setCid(null); } };
  const delAll = () => { live.current.chats = []; setChats([]); saveChats([]); live.current.cid = null; setCid(null); setList(false); };
  const nChats = chats ? chats.length : 0;

  if (!hasKey) return (
    <div className="askgrid"><style>{CSS}</style><div className="askmain">
      <section className="card p-5 mb-4">
        <div className="askhero" style={{ marginBottom: 18 }}>
          <div className="askbadge">{I.chat}</div>
          <div><div className="text-lg font-semibold" style={{ letterSpacing: "-.01em" }}>Ask about your game</div><p className="text-sm mt-1" style={{ color: "var(--ivory-d)" }}>What a cover play costs, how a change moves your risk, how you're running. The assistant answers with this app's calculator and your saved setup, so the numbers match the Spread page.</p></div>
        </div>
        <KeySetup onSaved={() => setHasKey(true)} />
      </section>
    </div></div>
  );
  return (
    <div className="askgrid"><style>{CSS}</style>
      <div className="askmain">
        <div className="asktop">
          <button className="askpill" onClick={fresh} disabled={busy || (!chat && !text)}>{I.plus}New chat</button>
          <button className="askpill" onClick={() => setList(true)} disabled={busy || !nChats}>{I.clock}History{nChats > 0 && <span className="n">{nChats}</span>}</button>
        </div>
        {!view.length && !busy && (
          <div className="rise">
            <div className="askhero">
              <div className="askbadge">{I.chat}</div>
              <div><div className="text-lg font-semibold" style={{ letterSpacing: "-.01em" }}>What do you want to know?</div><p className="text-sm mt-1" style={{ color: "var(--ivory-d)" }}>Ask in your own words. Every number comes from this app's calculator, using the rules and bets you have saved.</p></div>
            </div>
            <div className="eyebrow mb-2">Try asking</div>
            <div className="asksugs">{SUGGEST.map(([k, s]) => <button key={s} className="asksug" onClick={() => send(s)}><span style={{ flex: 1, minWidth: 0 }}><span className="k">{k}</span><span className="q">{s}</span></span>{I.go}</button>)}</div>
            {nChats > 0 && <div className="askrecent">
              <div className="flex items-center justify-between mb-1"><div className="eyebrow">Recent chats</div>{nChats > 3 && <button className="text-xs underline underline-offset-2" style={{ color: "var(--muted)" }} onClick={() => setList(true)}>See all {nChats}</button>}</div>
              <ChatRows chats={chats} cid={cid} onPick={pick} limit={3} />
            </div>}
          </div>
        )}
        <div aria-live="polite">
          {view.map((m, i) => m.role === "user" ? <div key={i} className="askmsg"><div className="askq">{m.text}</div></div> : (
            <div key={i} className="askmsg"><div className="card aska">
              {m.text ? <Md text={m.text} /> : <div className="askstat">No answer came back for this one.</div>}
              {m.note && <div className="text-xs mt-2" style={{ color: "var(--rose)" }}>{m.note}</div>}
              {m.work.length > 0 && <div className="askfoot"><button onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))} aria-expanded={!!open[i]}>{I.calc}{open[i] ? "Hide the numbers" : "Show the numbers behind this"}{I.chev}</button></div>}
              {open[i] && <div className="askwork rise">{m.work.map((w, j) => <Work key={j} w={w} />)}</div>}
            </div></div>
          ))}
          {draft && <div className="askmsg"><div className="card aska">{draft.text && <Md text={draft.text} />}{draft.status && <div className="askstat" style={{ marginTop: draft.text ? 12 : 0 }}><span className="askdots" aria-hidden="true"><i /><i /><i /></span>{draft.status}…</div>}</div></div>}
        </div>
        {err && <div className="askerr" role="alert">{I.warn}<span>{err}{text ? " Your question is back in the box." : ""}</span></div>}
        <div ref={end} style={{ height: 1 }} />
        <div className="askbar">
          <div className="askbox">
            <textarea ref={ta} rows={1} value={text} placeholder={view.length ? "Ask a follow-up…" : "Ask about your game…"} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); } }} aria-label="Your question" />
            {busy ? <button className="asksend stop" onClick={stop} aria-label="Stop">{I.stop}</button> : <button className="asksend" onClick={() => send(text)} disabled={!text.trim()} aria-label="Send">{I.up}</button>}
          </div>
          <div className="askhint">Enter to send · Shift + Enter for a new line</div>
        </div>
      </div>
      <aside className="askside card" aria-label="Chats">
        <button className="btn mb-3" style={{ fontSize: 14, padding: "10px 14px" }} onClick={fresh} disabled={busy || (!chat && !text)}>New chat</button>
        <div className="eyebrow mb-1">Your chats</div>
        {nChats ? <><ChatRows chats={chats} cid={cid} onPick={pick} onDelete={del} /><div className="pt-3 text-right">{nChats > 1 && <ConfirmLink label="Delete all" confirm="Tap again to delete all" onConfirm={delAll} />}</div></> : <p className="text-xs py-2" style={{ color: "var(--muted)" }}>Chats you start are saved here, on this device.</p>}
      </aside>
      {list && <Sheet title="History" onClose={() => setList(false)}>
        <div className="px-5 pb-6">
          {!nChats ? <p className="text-sm py-4" style={{ color: "var(--muted)" }}>No saved chats yet.</p> : <>
            <ChatRows chats={chats} cid={cid} onPick={pick} onDelete={del} />
            <div className="pt-4 flex justify-between items-center gap-3"><span className="text-xs" style={{ color: "var(--muted)" }}>Saved on this device only.</span>{nChats > 1 && <ConfirmLink label="Delete all chats" confirm="Tap again to delete all" onConfirm={delAll} />}</div>
          </>}
        </div>
      </Sheet>}
    </div>
  );
}
