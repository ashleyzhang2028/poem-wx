const store = require("./store");

let ctx = null;
let broken = false;

function supported() {
  return typeof wx.createWebAudioContext === "function";
}

function enabled() {

  const s = store.settings();
  return s.sfx !== false;
}

function setEnabled(on) {
  store.saveSettings({ sfx: !!on });
  return enabled();
}

function readiness() {
  if (!supported()) {
    return { visible: false, usable: false, state: "unsupported", reason: "当前环境没有 Web Audio，答题不出声" };
  }
  if (!enabled()) {
    return { visible: true, usable: false, state: "denied", reason: "答题音效已关闭" };
  }
  return { visible: true, usable: true, state: "ready", reason: "" };
}

function context() {
  if (ctx || broken || !supported()) return ctx;
  try {
    ctx = wx.createWebAudioContext();
  } catch (e) {
    broken = true;
    ctx = null;
  }
  return ctx;
}

function tone(c, freq, ms, at, vol) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(c.destination);

  const t0 = at || c.currentTime;
  const dur = ms / 1000;
  const fade = 0.008;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + fade);
  gain.gain.setValueAtTime(vol, t0 + dur - fade);
  gain.gain.linearRampToValueAtTime(0, t0 + dur);
  osc.start(t0);
  osc.stop(t0 + dur + 0.01);
}

const VOICES = {

  ok: [
    { f: 784, ms: 90, gap: 0, v: 0.16 },
    { f: 1047, ms: 130, gap: 70, v: 0.15 }
  ],

  no: [
    { f: 415, ms: 140, gap: 0, v: 0.16 },
    { f: 311, ms: 200, gap: 110, v: 0.15 }
  ],

  pass: [
    { f: 659, ms: 100, gap: 0, v: 0.15 },
    { f: 784, ms: 100, gap: 80, v: 0.15 },
    { f: 1047, ms: 220, gap: 80, v: 0.16 }
  ],

  rank: [
    { f: 523, ms: 420, gap: 0, v: 0.13 },
    { f: 784, ms: 420, gap: 0, v: 0.10 },
    { f: 1047, ms: 520, gap: 40, v: 0.09 }
  ]
};

function play(name) {
  if (!enabled() || !supported()) return false;
  const c = context();
  if (!c) return false;
  const notes = VOICES[name] || VOICES.ok;
  try {
    const now = c.currentTime;
    notes.forEach((n) => tone(c, n.f, n.ms, now + n.gap / 1000, n.v));
  } catch (e) {

    return false;
  }
  return true;
}

function preview() {
  if (!supported()) return false;
  const c = context();
  if (!c) return false;
  try {
    tone(c, 784, 160, c.currentTime, 0.16);
    return true;
  } catch (e) {
    return false;
  }
}

function answer(okFlag) {
  return play(okFlag ? "ok" : "no");
}

function pass() {
  return play("pass");
}

function rank(right, total) {
  const pct = total ? right / total : 0;
  if (pct >= 1) return play("pass");
  if (pct >= 0.6) return play("rank");
  return play("no");
}

module.exports = {
  VOICES,
  supported,
  enabled,
  setEnabled,
  readiness,
  play,
  preview,
  answer,
  pass,
  rank
};
