import { createRoot } from "react-dom/client";
import App from "./app.jsx";
const mem = {};
window.storage = {
  async get(key) { let v; try { v = localStorage.getItem("bj:" + key); } catch {} if (v == null) v = mem[key]; if (v == null) throw new Error("not found"); return { key, value: v, shared: false }; },
  async set(key, value) { try { localStorage.setItem("bj:" + key, value); } catch { mem[key] = value; } return { key, value, shared: false }; },
  async delete(key) { try { localStorage.removeItem("bj:" + key); } catch {} delete mem[key]; return { key, deleted: true, shared: false }; },
  async list(prefix) { const keys = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("bj:") && (!prefix || k.slice(3).startsWith(prefix))) keys.push(k.slice(3)); } } catch {} return { keys, shared: false }; },
};
createRoot(document.getElementById("root")).render(<App />);
