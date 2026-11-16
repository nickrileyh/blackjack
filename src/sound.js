// Sound effects. The table sounds — a card dealt, a chip bet, the shuffle — are real recordings (src/sound-data.js,
// from Kenney's CC0 "Casino Audio" pack), embedded so the app stays one offline page. The optional answer and
// result notes are made with Web Audio. sfx(name, delayMs) plays one.
// Settings (this device only): on/off, volume, and two groups — "table" (on) and "feedback" (the notes, off unless asked for).
// Nothing plays until the first tap or key press (browsers require that), and a phone's silent switch mutes it like any other sound.
import { CLIPS } from "./sound-data.js";

const KEY = "bj:bj-sound-v1";
// The answer and win/lose notes are off unless asked for: Nick found them too much, so the table sounds are the default set.
const prefs = { on: true, vol: 0.8, table: true, feedback: false };
const VER = 2;   // 2: the notes became opt-in — a setting saved before that is switched off once
try {
  const raw = localStorage.getItem(KEY);
  if (raw === "0" || raw === "1") prefs.on = raw === "1";            // the first version stored only on/off
  else if (raw) { const o = JSON.parse(raw); for (const k in prefs) if (typeof o[k] === typeof prefs[k]) prefs[k] = o[k]; if (!(o.v >= VER)) prefs.feedback = false; }
  prefs.vol = Math.max(0.2, Math.min(1, prefs.vol));
} catch (_) {}
const GROUP = { card: "table", chip: "table", shuffle: "table", right: "feedback", wrong: "feedback", win: "feedback", blackjack: "feedback", lose: "feedback", pass: "feedback" };
const level = () => 1.4 * prefs.vol * prefs.vol;   // 0.8 on the slider is the level the sounds were balanced at
// how loud each recording plays next to the others: cards are the most frequent, so they sit lowest
const TRIM = { card: 0.4, chip: 0.44, shuffle: 0.4 };

let ctx = null, out = null, room = null, noise = null, loading = null;
const clips = {};           // group -> [{ buf, from }] once decoded
const lastClip = {};        // so the same recording isn't played twice in a row
let lastCard = 0;           // when the last card is scheduled, so cards that land together are heard one after another
const lastAt = {};          // when each other sound last played, to drop accidental doubles
const rnd = (a, b) => a + Math.random() * (b - a);

function audio() {
  if (ctx) return ctx;
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    ctx = new AC();
    const sr = ctx.sampleRate;
    // a safety net only: it does nothing to a single card or chip, and stops a pile-up of them from spiking
    const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -5; lim.knee.value = 6; lim.ratio.value = 3; lim.attack.value = 0.003; lim.release.value = 0.15;
    out = ctx.createGain(); out.gain.value = level(); out.connect(lim); lim.connect(ctx.destination);
    // a little "room" for the notes, so they aren't bone-dry beeps (the recordings carry their own and skip this)
    const ir = ctx.createBuffer(2, Math.floor(sr * 0.32), sr);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2); }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 4200;
    room = ctx.createGain(); room.gain.value = 0.11; room.connect(conv); conv.connect(tone); tone.connect(out);
    noise = ctx.createBuffer(1, sr, sr);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    loading = load();
  } catch (_) { ctx = null; }
  return ctx;
}
// decode the recordings once. MP3 decoders differ in how much silence they leave at the front, so each clip is
// measured and played from where its sound actually starts.
function load() {
  const one = (b64) => new Promise((res) => {
    try {
      const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const done = (buf) => {
        const d = buf.getChannelData(0); let pk = 0; for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; }
        let i0 = 0; while (i0 < d.length && Math.abs(d[i0]) < pk * 0.02) i0++;
        res({ buf, from: Math.max(0, i0 / buf.sampleRate - 0.003) });
      };
      const p = ctx.decodeAudioData(bytes.buffer, done, () => res(null));
      if (p && p.catch) p.catch(() => res(null));
    } catch (_) { res(null); }
  });
  return Promise.all(Object.keys(CLIPS).map((g) => Promise.all(CLIPS[g].map(one)).then((a) => { clips[g] = a.filter(Boolean); }))).catch(() => {});
}
// browsers only let sound start from a tap or key press: wake the audio on the first one
function unlock() { if (!prefs.on) return; const c = audio(); if (c && c.state !== "running") { try { c.resume(); } catch (_) {} } }
if (typeof window !== "undefined") {
  ["pointerdown", "keydown", "touchend"].forEach((e) => window.addEventListener(e, unlock, { capture: true, passive: true }));
}

// ---- the recordings ----
function clip(group, t, { gain = 1, rate = [0.97, 1.03] } = {}) {
  const set = clips[group]; if (!set || !set.length) return;      // still decoding (the first instant after the first tap): stay silent
  let i = Math.floor(Math.random() * set.length); if (set.length > 1 && i === lastClip[group]) i = (i + 1) % set.length;
  lastClip[group] = i;
  const s = ctx.createBufferSource(); s.buffer = set[i].buf; s.playbackRate.value = rnd(rate[0], rate[1]);
  const g = ctx.createGain(); g.gain.value = TRIM[group] * gain;
  s.connect(g); g.connect(out); s.start(t, set[i].from);
}

// ---- the notes (optional) ----
const send = (node, wet = 1) => { node.connect(out); if (wet) { const w = ctx.createGain(); w.gain.value = wet; node.connect(w); w.connect(room); } };
function partial(t, f, gain, decay) {
  const o = ctx.createOscillator(); o.frequency.setValueAtTime(f, t);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g); send(g); o.start(t); o.stop(t + decay + 0.03);
}
// a soft wooden note, like a marimba bar: the fundamental, a quiet octave, a bright overtone that dies at once, and the tap of the mallet
function note(t, f, gain = 0.2, len = 0.34) {
  gain *= 0.6;
  partial(t, f, gain, len); partial(t, f * 2, gain * 0.22, len * 0.55); partial(t, f * 3.98, gain * 0.16, len * 0.2);
  const s = ctx.createBufferSource(); s.buffer = noise;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = Math.min(5200, f * 3); bp.Q.value = 1.1;
  const g = ctx.createGain(); g.gain.setValueAtTime(gain * 0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
  s.connect(bp); bp.connect(g); send(g, 0.4); s.start(t, Math.random() * 0.9, 0.05);
}

const SOUNDS = {
  card(t) { clip("card", t, { gain: rnd(0.85, 1) }); },
  chip(t) { clip("chip", t); },
  shuffle(t) { clip("shuffle", t, { rate: [1, 1] }); },
  right(t) { note(t, 1318.5, 0.19, 0.3); },
  wrong(t) { note(t, 392, 0.2, 0.2); note(t + 0.1, 311.1, 0.2, 0.3); },
  win(t) { note(t, 659.3, 0.18, 0.3); note(t + 0.1, 987.8, 0.19, 0.42); },
  blackjack(t) { [523.3, 659.3, 784, 1046.5].forEach((f, i) => note(t + i * 0.085, f, 0.17, i === 3 ? 0.6 : 0.32)); },
  lose(t) { note(t, 440, 0.17, 0.26); note(t + 0.12, 349.2, 0.18, 0.44); },
  pass(t) { [523.3, 784, 1046.5, 1318.5, 1568].forEach((f, i) => note(t + i * 0.075, f, 0.16, i === 4 ? 0.7 : 0.3)); },
};

export function sfx(name, delayMs = 0, force) {
  if (!SOUNDS[name] || !prefs.on || (!force && !prefs[GROUP[name]])) return;
  const c = audio(); if (!c || c.state !== "running") return;   // not woken by a tap yet, or the page is asleep: stay silent rather than play late
  if (typeof document !== "undefined" && document.hidden) return;
  let t = c.currentTime + Math.max(0, delayMs) / 1000;
  if (name === "card") {
    if (t < lastCard + 0.09) t = lastCard + 0.09;        // cards that land together are heard one after another
    if (t - c.currentTime > 2.5) return;                 // …but never a backlog
    lastCard = t;
  } else {
    if (lastAt[name] != null && Math.abs(t - lastAt[name]) < 0.09) return;
    lastAt[name] = t;
  }
  try { SOUNDS[name](t); } catch (_) {}
}
// resolves once the recordings are decoded (for tests; the app never needs to wait)
export const soundReady = () => { audio(); return loading || Promise.resolve(); };
export const soundPrefs = () => ({ ...prefs });
// change one or more settings: { on, vol, table, feedback }. A sample plays so you hear what you just chose.
export function setSoundPrefs(patch) {
  const was = { ...prefs };
  for (const k in prefs) if (patch && typeof patch[k] === typeof prefs[k]) prefs[k] = patch[k];
  prefs.vol = Math.max(0.2, Math.min(1, prefs.vol));
  try { localStorage.setItem(KEY, JSON.stringify({ ...prefs, v: VER })); } catch (_) {}
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
