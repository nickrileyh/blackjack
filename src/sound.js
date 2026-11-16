// Sound effects, made in the browser with Web Audio — no audio files, so the app stays one offline page.
// sfx(name, delayMs) plays one. The settings (this device only): on/off, volume, and two groups that can be
// switched separately — "table" (cards, chips, the shuffle) and "feedback" (right / wrong, win / lose, a test passed).
// Everything is quiet and short on purpose. Nothing plays until the first tap or key press (browsers require that),
// and a phone's silent switch mutes it like any other sound.

const KEY = "bj:bj-sound-v1";
const prefs = { on: true, vol: 0.8, table: true, feedback: true };
try {
  const raw = localStorage.getItem(KEY);
  if (raw === "0" || raw === "1") prefs.on = raw === "1";            // the first version stored only on/off
  else if (raw) { const o = JSON.parse(raw); for (const k in prefs) if (typeof o[k] === typeof prefs[k]) prefs[k] = o[k]; }
  prefs.vol = Math.max(0.2, Math.min(1, prefs.vol));
} catch (_) {}
const GROUP = { card: "table", chip: "table", shuffle: "table", right: "feedback", wrong: "feedback", win: "feedback", blackjack: "feedback", lose: "feedback", pass: "feedback" };
const level = () => 1.4 * prefs.vol * prefs.vol;   // 0.8 on the slider is the level the sounds were balanced at

let ctx = null, out = null, noise = null;
let lastCard = 0;           // when the last card flick is scheduled, so a burst of cards becomes a quick riffle instead of one loud click
const lastAt = {};          // when each other sound last played, to drop accidental doubles

function audio() {
  if (ctx) return ctx;
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    ctx = new AC();
    out = ctx.createGain(); out.gain.value = level(); out.connect(ctx.destination);
    // one second of soft noise, reused for every card and chip
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (_) { ctx = null; }
  return ctx;
}
// browsers only let sound start from a tap or key press: wake the audio on the first one
function unlock() { if (!prefs.on) return; const c = audio(); if (c && c.state !== "running") { try { c.resume(); } catch (_) {} } }
if (typeof window !== "undefined") {
  ["pointerdown", "keydown", "touchend"].forEach((e) => window.addEventListener(e, unlock, { capture: true, passive: true }));
}

// ---- building blocks ----
function hiss(t, { dur = 0.07, from = 2600, to = 1300, q = 0.9, gain = 0.3, rate = 1 }) {
  const s = ctx.createBufferSource(); s.buffer = noise; s.playbackRate.value = rate;
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = q;
  f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(out);
  s.start(t, Math.random() * 0.8, dur + 0.02);
}
function tone(t, { f = 880, to, dur = 0.12, gain = 0.12, type = "sine" }) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.03);
}

// ---- the sounds ----
const SOUNDS = {
  // a card sliding off the shoe: a short breath of noise that falls in pitch
  card(t) { hiss(t, { dur: 0.09, from: 2400 + Math.random() * 900, to: 1100, q: 0.7, gain: 0.7, rate: 0.9 + Math.random() * 0.25 }); },
  // two clay chips touching
  chip(t) {
    [[0, 2500], [0.055, 3100]].forEach(([d, f]) => { tone(t + d, { f: f + Math.random() * 120, dur: 0.05, gain: 0.2, type: "triangle" }); hiss(t + d, { dur: 0.02, from: 5200, to: 3800, q: 1.4, gain: 0.45 }); });
  },
  // a riffle, then the deck squared up
  shuffle(t) {
    for (let i = 0; i < 16; i++) hiss(t + i * 0.027, { dur: 0.032, from: 3000, to: 1700, gain: 0.22 + 0.38 * Math.sin((i / 15) * Math.PI) });
    hiss(t + 0.52, { dur: 0.1, from: 1100, to: 500, q: 0.7, gain: 0.7 });
  },
  // (small phone speakers barely play anything under about 250 Hz, so even the low notes sit above that)
  right(t) { tone(t, { f: 1175, dur: 0.12, gain: 0.2 }); },
  wrong(t) { tone(t, { f: 330, to: 247, dur: 0.2, gain: 0.26, type: "triangle" }); },
  win(t) { tone(t, { f: 784, dur: 0.17, gain: 0.19, type: "triangle" }); tone(t + 0.09, { f: 1175, dur: 0.24, gain: 0.19, type: "triangle" }); },
  blackjack(t) { [784, 988, 1319].forEach((f, i) => tone(t + i * 0.085, { f, dur: 0.24, gain: 0.19, type: "triangle" })); },
  lose(t) { tone(t, { f: 392, to: 277, dur: 0.26, gain: 0.22, type: "triangle" }); },
  // a test passed
  pass(t) { [659, 880, 1175, 1568].forEach((f, i) => tone(t + i * 0.08, { f, dur: 0.26, gain: 0.18, type: "triangle" })); },
};

export function sfx(name, delayMs = 0, force) {
  if (!SOUNDS[name] || !prefs.on || (!force && !prefs[GROUP[name]])) return;
  const c = audio(); if (!c || c.state !== "running") return;   // not woken by a tap yet, or the page is asleep: stay silent rather than play late
  if (typeof document !== "undefined" && document.hidden) return;
  let t = c.currentTime + Math.max(0, delayMs) / 1000;
  if (name === "card") {
    if (t < lastCard + 0.05) t = lastCard + 0.05;        // cards that land together are heard one after another
    if (t - c.currentTime > 2.5) return;                 // …but never a backlog
    lastCard = t;
  } else {
    if (lastAt[name] != null && Math.abs(t - lastAt[name]) < 0.09) return;
    lastAt[name] = t;
  }
  try { SOUNDS[name](t); } catch (_) {}
}
export const soundPrefs = () => ({ ...prefs });
// change one or more settings: { on, vol, table, feedback }. A sample plays so you hear what you just chose.
export function setSoundPrefs(patch) {
  const was = { ...prefs };
  for (const k in prefs) if (patch && typeof patch[k] === typeof prefs[k]) prefs[k] = patch[k];
  prefs.vol = Math.max(0.2, Math.min(1, prefs.vol));
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) {}
  if (out && ctx) { try { out.gain.setTargetAtTime(level(), ctx.currentTime, 0.02); } catch (_) { out.gain.value = level(); } }
  if (prefs.on) {
    unlock();
    const sample = prefs.feedback && !was.feedback ? "right" : prefs.table && !was.table ? "chip" : !was.on || prefs.vol !== was.vol ? "chip" : null;
    if (sample) setTimeout(() => sfx(sample, 0, true), 70);
  }
  try { window.dispatchEvent(new Event("bj-sound")); } catch (_) {}
}
export const soundOn = () => prefs.on;
export const setSound = (v) => setSoundPrefs({ on: !!v });
