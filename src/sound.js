// Sound effects, made in the browser with Web Audio — no audio files, so the app stays one offline page.
// sfx(name, delayMs) plays one. The settings (this device only): on/off, volume, and two groups that can be
// switched separately — "table" (cards, chips, the shuffle) and "feedback" (right / wrong, win / lose, a test passed).
// Everything is quiet and short on purpose: recorded-style card and chip sounds built from shaped noise and short
// ringing overtones, soft wooden notes for feedback, and a touch of room so nothing sounds like a bare beep. Nothing plays until the first tap or key press (browsers require that),
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

let ctx = null, out = null, room = null, noise = null;
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
    // everything passes through a gentle limiter, so a run of cards can never spike
    const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -14; lim.knee.value = 10; lim.ratio.value = 5; lim.attack.value = 0.002; lim.release.value = 0.12;
    out = ctx.createGain(); out.gain.value = level(); out.connect(lim); lim.connect(ctx.destination);
    // a little "room": a short, soft tail on every sound. Without it synthesized sounds are bone dry and read as beeps.
    const ir = ctx.createBuffer(2, Math.floor(sr * 0.32), sr);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2); }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 4200;
    room = ctx.createGain(); room.gain.value = 0.11; room.connect(conv); conv.connect(tone); tone.connect(out);
    // two seconds of noise, reused (from random offsets) for every card, chip and shuffle
    noise = ctx.createBuffer(1, sr * 2, sr);
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
const send = (node, wet = 1) => { node.connect(out); if (wet) { const w = ctx.createGain(); w.gain.value = wet; node.connect(w); w.connect(room); } };
// filtered noise with a shaped loudness: env is [[seconds, level], …] from the start
function air(t, { dur, hp = 0, lp = 0, bp = 0, q = 0.8, env, rate = 1, wet = 1 }) {
  const s = ctx.createBufferSource(); s.buffer = noise; s.playbackRate.value = rate;
  let n = s;
  const f = (type, freq, Q) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = freq; if (Q) x.Q.value = Q; n.connect(x); n = x; };
  if (hp) f("highpass", hp); if (lp) f("lowpass", lp); if (bp) f("bandpass", bp, q);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
  env.forEach(([at, v]) => g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v), t + at));
  n.connect(g); send(g, wet);
  s.start(t, Math.random() * 1.6, dur + 0.03);
}
// one decaying sine partial
function partial(t, f, gain, decay, { glide, type = "sine", attack = 0.004, wet = 1 } = {}) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + decay);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g); send(g, wet); o.start(t); o.stop(t + decay + 0.03);
}
// a soft wooden note, like a marimba bar: the fundamental, a quiet octave, the bar's bright overtone that dies at once, and the tap of the mallet
function note(t, f, gain = 0.2, len = 0.34) {
  gain *= 0.6;
  partial(t, f, gain, len);
  partial(t, f * 2, gain * 0.22, len * 0.55);
  partial(t, f * 3.98, gain * 0.16, len * 0.2);
  air(t, { dur: 0.02, bp: Math.min(5200, f * 3), q: 1.1, env: [[0.002, gain * 0.5], [0.02, 0.0001]], wet: 0.4 });
}

// ---- the sounds ----
const SOUNDS = {
  // a card off the shoe: the slide across the felt swells and stops, then the card pats down. No two are quite alike.
  card(t) {
    const k = rnd(0.88, 1.14), v = rnd(0.5, 0.64);
    air(t, { dur: 0.1, hp: 1300 * k, lp: 7200, env: [[0.03, 0.34 * v], [0.062, 0.2 * v], [0.1, 0.0001]], rate: k });
    air(t + 0.066, { dur: 0.03, bp: 1250 * k, q: 1.3, env: [[0.002, 0.7 * v], [0.03, 0.0001]] });
    partial(t + 0.066, 210 * k, 0.16 * v, 0.045, { glide: 150, wet: 0 });
  },
  // clay chips: each touch is a bright click over a few short ringing overtones; a bet is two touches and a small bounce
  chip(t) {
    const hit = (at, g, k) => {
      air(at, { dur: 0.01, hp: 3200, env: [[0.001, 0.5 * g], [0.01, 0.0001]], wet: 0.5 });
      [[2140, 0.3, 0.06], [3380, 0.2, 0.045], [4760, 0.13, 0.03], [6520, 0.07, 0.02]].forEach(([f, a, d]) => partial(at, f * k, a * g, d, { attack: 0.001 }));
    };
    const k = rnd(0.96, 1.05);
    hit(t, 0.46, k); hit(t + rnd(0.055, 0.07), 0.29, k * 1.06); hit(t + rnd(0.13, 0.15), 0.12, k * 1.02);
  },
  // a riffle — card edges ticking past, fast in the middle — then the deck pushed together and squared on the table
  shuffle(t) {
    let at = t;
    for (let i = 0; i < 24; i++) {
      const m = Math.sin((i / 23) * Math.PI);
      air(at, { dur: 0.012, hp: 2600, lp: 9000, env: [[0.001, 0.07 + 0.14 * m], [0.012, 0.0001]], rate: rnd(0.9, 1.2), wet: 0.6 });
      at += 0.03 - 0.016 * m + rnd(0, 0.004);
    }
    air(at + 0.03, { dur: 0.2, hp: 1500, lp: 6500, env: [[0.07, 0.18], [0.2, 0.0001]] });
    air(at + 0.27, { dur: 0.035, bp: 1000, q: 1.2, env: [[0.002, 0.45], [0.035, 0.0001]] });
  },
  // answers: one bright note for right, two soft low ones stepping down for wrong
  right(t) { note(t, 1318.5, 0.19, 0.3); },
  wrong(t) { note(t, 392, 0.2, 0.2); note(t + 0.1, 311.1, 0.2, 0.3); },
  // a round: up a fifth for a win, a rising chord for a blackjack, down a third for a loss
  win(t) { note(t, 659.3, 0.18, 0.3); note(t + 0.1, 987.8, 0.19, 0.42); },
  blackjack(t) { [523.3, 659.3, 784, 1046.5].forEach((f, i) => note(t + i * 0.085, f, 0.17, i === 3 ? 0.6 : 0.32)); },
  lose(t) { note(t, 440, 0.17, 0.26); note(t + 0.12, 349.2, 0.18, 0.44); },
  // a test passed
  pass(t) { [523.3, 784, 1046.5, 1318.5, 1568].forEach((f, i) => note(t + i * 0.075, f, 0.16, i === 4 ? 0.7 : 0.3)); },
};

export function sfx(name, delayMs = 0, force) {
  if (!SOUNDS[name] || !prefs.on || (!force && !prefs[GROUP[name]])) return;
  const c = audio(); if (!c || c.state !== "running") return;   // not woken by a tap yet, or the page is asleep: stay silent rather than play late
  if (typeof document !== "undefined" && document.hidden) return;
  let t = c.currentTime + Math.max(0, delayMs) / 1000;
  if (name === "card") {
    if (t < lastCard + 0.07) t = lastCard + 0.07;        // cards that land together are heard one after another
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
