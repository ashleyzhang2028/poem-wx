const store = require("./store");

const COMBO_FROM = 5;

const VOICES = {
  tap: [{ f: 880, ms: 40, gap: 0, v: 0.1 }],
  tick: [{ f: 1400, ms: 30, gap: 0, v: 0.08 }],
  ok: [
    { f: 784, ms: 90, gap: 0, v: 0.16 },
    { f: 1047, ms: 130, gap: 70, v: 0.15 }
  ],
  no: [
    { f: 415, ms: 140, gap: 0, v: 0.16 },
    { f: 311, ms: 200, gap: 110, v: 0.15 }
  ],
  bad: [
    { f: 392, ms: 110, gap: 0, v: 0.15 },
    { f: 294, ms: 170, gap: 85, v: 0.14 }
  ],
  fuzzy: [
    { f: 494, ms: 100, gap: 0, v: 0.14 },
    { f: 466, ms: 130, gap: 85, v: 0.13 }
  ],
  good: [
    { f: 659, ms: 80, gap: 0, v: 0.15 },
    { f: 880, ms: 120, gap: 60, v: 0.14 }
  ],
  combo: [
    { f: 1047, ms: 60, gap: 0, v: 0.14 },
    { f: 1319, ms: 60, gap: 55, v: 0.14 },
    { f: 1568, ms: 120, gap: 110, v: 0.14 }
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
  ],
  gong: [{ f: 196, ms: 600, gap: 0, v: 0.18 }]
};

let ctx = null;
let broken = false;
let warmed = false;
const buffers = {};

function supported() {
  return typeof wx.createWebAudioContext === "function";
}

function enabled() {
  return store.settings().sfx !== false;
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

function load(c, name) {
  wx.getFileSystemManager().readFile({
    filePath: "/audio/" + name + ".wav",
    success: (res) => {
      c.decodeAudioData(res.data, (buf) => { buffers[name] = buf; }, () => {});
    },
    fail: () => {}
  });
}

function warm() {
  if (warmed || !enabled()) return;
  const c = context();
  if (!c) return;
  warmed = true;
  Object.keys(VOICES).forEach((name) => load(c, name));
}

function sound(name) {
  const c = context();
  if (!c) return false;
  warm();
  const key = VOICES[name] ? name : "ok";
  try {
    if (c.state === "suspended" && typeof c.resume === "function") c.resume();
    if (buffers[key]) {
      const src = c.createBufferSource();
      src.buffer = buffers[key];
      src.connect(c.destination);
      src.start(0);
    } else {
      const now = c.currentTime;
      VOICES[key].forEach((n) => tone(c, n.f, n.ms, now + n.gap / 1000, n.v));
    }
  } catch (e) {
    return false;
  }
  return true;
}

function play(name) {
  return enabled() && sound(name);
}

function preview() {
  return sound("good");
}

function answer(okFlag, streak) {
  if (okFlag && Number(streak) >= COMBO_FROM) return play("combo");
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
  warm,
  play,
  preview,
  recite: play,
  answer,
  pass,
  rank
};
