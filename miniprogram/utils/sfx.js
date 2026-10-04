/**
 * 答题音效。对 / 错 / 过关 / 出分各一种，**现场合成，零音频文件**。
 *
 * 为什么不带 mp3 进包：主包只剩 0.7MB 余量，四条音效压在包里是拿体积换几个
 * 正弦波。Web Audio 的振荡器够用 —— 它们是「提示音」，不是音乐。
 *
 * 网页版的 js/sfx.js 是同一套思路（Issue #356 P3）。小程序这边用
 * wx.createWebAudioContext()：它在基础库 2.19+ 才有，没有就静默不响 ——
 * **不响不等于坏掉**，所以 readiness() 要如实说，界面据此决定开关显不显示。
 *
 * ⚠️ 这条与「能力不可用时界面上就不该有它」同规矩：环境没有音频接口时，
 *   设置页那张「答题音效」卡整块不渲染，不留一个点了没反应的开关。
 */
const store = require("./store");

let ctx = null;
let broken = false;

/** 环境有没有 Web Audio —— 同步探一眼，不发请求 */
function supported() {
  return typeof wx.createWebAudioContext === "function";
}

function enabled() {
  // 默认开：音效是「答题的一部分」，与「朗读」不同，它不依赖任何外部通道
  const s = store.settings();
  return s.sfx !== false;
}

/**
 * 音效**跟设备走，不跨设备同步**（见 store.js 的 DEVICE_DEFAULTS）：
 * 这台机器有没有扬声器、用户在这台机器上看题时想不想出声，
 * 换个手机重新判一次才对。所以这里不调 sync.markDirty() ——
 * 调了也只是让同步跑一趟空活。
 */
function setEnabled(on) {
  store.saveSettings({ sfx: !!on });
  return enabled();
}

/**
 * 可用性。**同步**，界面渲染时就要知道显不显示那张卡。
 * @returns {{visible:boolean, usable:boolean, state:string, reason:string}}
 */
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

/**
 * 一小段音：频率 + 时长 + 音量，起止各加 8ms 淡入淡出。
 * **一定要淡**：振荡器硬起硬停会有「啪」的一声爆音，
 * 在手机小喇叭上比音效本身还响。
 */
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

/** 四个音景，每条是「一串音」。频率选在五声音阶上，怎么排都不刺耳 */
const VOICES = {
  // 对：往上跳两度的短音，收得干脆
  ok: [
    { f: 784, ms: 90, gap: 0, v: 0.16 },
    { f: 1047, ms: 130, gap: 70, v: 0.15 }
  ],
  // 错：往下压两度，比「对」长一点，让人有时间意识到错了
  no: [
    { f: 415, ms: 140, gap: 0, v: 0.16 },
    { f: 311, ms: 200, gap: 110, v: 0.15 }
  ],
  // 过关：三连上行
  pass: [
    { f: 659, ms: 100, gap: 0, v: 0.15 },
    { f: 784, ms: 100, gap: 80, v: 0.15 },
    { f: 1047, ms: 220, gap: 80, v: 0.16 }
  ],
  // 出分：一个厚重的和音，收得慢
  rank: [
    { f: 523, ms: 420, gap: 0, v: 0.13 },
    { f: 784, ms: 420, gap: 0, v: 0.10 },
    { f: 1047, ms: 520, gap: 40, v: 0.09 }
  ]
};

/** 放一个音景。返回 false 表示没出声（环境不支持 / 关了）—— 调用方据此决定要不要提示 */
function play(name) {
  if (!enabled() || !supported()) return false;
  const c = context();
  if (!c) return false;
  const notes = VOICES[name] || VOICES.ok;
  try {
    const now = c.currentTime;
    notes.forEach((n) => tone(c, n.f, n.ms, now + n.gap / 1000, n.v));
  } catch (e) {
    // 出声失败不该让答题流程跟着挂 —— 它是提示，不是功能
    return false;
  }
  return true;
}

/** 「试听一声」用：一个干净的单音 */
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

/**
 * 出分那一档按正确率分三个音景 —— 与网页版同一口径：
 * 满 / 及格 / 不及格听起来必须是三件事，不然音效只是「响了一下」。
 */
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
