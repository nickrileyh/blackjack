import { Component } from "react";
import { createRoot } from "react-dom/client";
import App from "./app.jsx";
const mem = {};
window.storage = {
  async get(key) { let v; try { v = localStorage.getItem("bj:" + key); } catch {} if (v == null) v = mem[key]; if (v == null) throw new Error("not found"); return { key, value: v, shared: false }; },
  async set(key, value) { try { localStorage.setItem("bj:" + key, value); } catch { mem[key] = value; } return { key, value, shared: false }; },
  async delete(key) { try { localStorage.removeItem("bj:" + key); } catch {} delete mem[key]; return { key, deleted: true, shared: false }; },
  async list(prefix) { const keys = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("bj:") && (!prefix || k.slice(3).startsWith(prefix))) keys.push(k.slice(3)); } } catch {} return { keys, shared: false }; },
};
// A newer version saved by the service worker (sw.js): remember its build stamp and tell the app. The stamp is compared
// with this page's own (the bj-build meta tag), so a message about the version already running is ignored.
window.__bjTouched = false;
try {
  const mark = () => { window.__bjTouched = true; };
  window.addEventListener("pointerdown", mark, { capture: true, passive: true }); window.addEventListener("keydown", mark, true);
  const mine = () => { const m = document.querySelector('meta[name="bj-build"]'); return m ? m.content : null; };
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => {
    const d = e.data; if (!d || d.type !== "bj-update" || !d.build || !mine() || d.build === mine()) return;
    window.__bjNew = d.build; window.dispatchEvent(new Event("bj-update"));
  });
} catch {}
// the Ask tab is gone: clear the API key and chats it kept on this device
try { localStorage.removeItem("bj:__ask-key"); localStorage.removeItem("bj:bj-ask-v1"); } catch {}
// Train's "On the chart" card is gone too: clear its "Always show" setting
try { localStorage.removeItem("bj:bj-trainchart-v1"); } catch {}
// Saved data in a shape the app doesn't expect (a wrong file pasted into Restore, a half-written sync) used to blank the
// whole app for good. Before anything reads it: a list that isn't a list is set aside under "__bad-…" (kept, not
// deleted), entries that aren't records are dropped, and a session's hours and result are made numbers.
(function repair() {
  const num = (x) => (typeof x === "number" && isFinite(x) ? x : isFinite(parseFloat(x)) ? parseFloat(x) : 0);
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fix = (key, each) => {
    try {
      const raw = localStorage.getItem("bj:" + key); if (raw == null) return;
      let v; try { v = JSON.parse(raw); } catch { v = undefined; }
      if (!Array.isArray(v)) { localStorage.setItem("bj:__bad-" + key, raw); localStorage.removeItem("bj:" + key); return; }
      const out = JSON.stringify(v.filter((x) => x && typeof x === "object" && !Array.isArray(x)).map(each));
      if (out !== raw) localStorage.setItem("bj:" + key, out);
    } catch {}
  };
  fix("bj-sessions-v1", (s) => {
    const o = { ...s };
    if (typeof o.hours !== "number" || !isFinite(o.hours) || o.hours < 0) o.hours = Math.max(0, num(o.hours));
    if (typeof o.result !== "number" || !isFinite(o.result)) o.result = num(o.result);
    if (o.where != null && typeof o.where !== "string") o.where = String(o.where);
    if (typeof o.date !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(o.date)) o.date = today;
    return o;
  });
  fix("bj-log-v1", (x) => x);
})();
// If a page ever fails to draw, show a way out instead of a blank screen. Nothing saved is touched.
class Safety extends Component {
  constructor(p) { super(p); this.state = { err: null, copied: false }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { try { console.error(err); } catch {} }
  render() {
    if (!this.state.err) return this.props.children;
    const copy = async () => { try { const out = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("bj:bj-")) out[k.slice(3)] = localStorage.getItem(k); } await navigator.clipboard.writeText(JSON.stringify(out)); this.setState({ copied: true }); } catch {} };
    const btn = { height: 46, padding: "0 20px", borderRadius: 14, fontWeight: 600, fontSize: 15, border: "1px solid rgba(255,255,255,.18)", background: "rgba(255,255,255,.08)", color: "#F2EFE6" };
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 28, background: "#07090A", color: "#F2EFE6", fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 600 }}>Something went wrong</div>
        <div style={{ fontSize: 14, opacity: 0.7, maxWidth: 320, lineHeight: 1.45 }}>This page couldn't be shown. Your sessions and progress are still saved on this device.</div>
        <button style={{ ...btn, background: "#2FA36B", borderColor: "transparent", color: "#04110A" }} onClick={() => location.reload()}>Reload the app</button>
        <button style={btn} onClick={copy}>{this.state.copied ? "Copied" : "Copy a backup of my data"}</button>
        <div style={{ fontSize: 11, opacity: 0.45, maxWidth: 320, wordBreak: "break-word" }}>{String(this.state.err && this.state.err.message || this.state.err).slice(0, 160)}</div>
      </div>
    );
  }
}
createRoot(document.getElementById("root")).render(<Safety><App /></Safety>);
