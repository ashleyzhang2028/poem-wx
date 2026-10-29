const store = require("./store");
const sfx = require("./sfx");

const KEYS = { exam: "kb_game_exam_v1", feihua: "kb_game_feihua_v1" };

const RANKS = [
  { from: 100, name: "状元", note: "一字不差，这一场没有可挑的" },
  { from: 90, name: "榜眼", note: "只差一点，进这一档的人都记住了" },
  { from: 80, name: "探花", note: "错的几处正好是下一次要补的" },
  { from: 60, name: "进士", note: "过了这一档，剩下的在详情页里找" },
  { from: 40, name: "举人", note: "认得出篇，还背不下来" },
  { from: 20, name: "秀才", note: "刚认脸，先回今日诵读" },
  { from: 0, name: "童生", note: "不急，从今天那几首开始" }
];

const COMBO_SHOWN_FROM = 2;
const COMBO_HI_FROM = 5;
const FLASH_MS = 420;
const FLASH_MISS_MS = 560;
const VIBRATE_GAP_MS = 120;

let lastVibrateAt = 0;

function buzz(kind) {
  if (typeof wx === "undefined" || typeof wx.vibrateShort !== "function") return false;
  const now = Date.now();
  if (now - lastVibrateAt < VIBRATE_GAP_MS) return false;
  lastVibrateAt = now;
  try {
    wx.vibrateShort({ type: kind === "medium" ? "medium" : "light" });
  } catch (e) {
    return false;
  }
  return true;
}

function comboOf(streak) {
  const n = Number(streak) || 0;
  return { n: n, shown: n >= COMBO_SHOWN_FROM, hot: n >= COMBO_HI_FROM };
}

function flash(stage, ok) {
  if (!stage || !stage.setData) return;
  clearTimeout(stage.flashTimer);
  stage.setData({ flash: ok ? "yes" : "no" });
  stage.flashTimer = setTimeout(() => {
    stage.flashTimer = null;
    if (stage.setData) stage.setData({ flash: "" });
  }, ok ? FLASH_MS : FLASH_MISS_MS);
}

function mark(stage, ok, streak) {
  const hit = ok === true;
  flash(stage, hit);
  buzz(hit ? "light" : "medium");
  const voice = sfx.answer(hit, streak);
  return { flash: hit ? "yes" : "no", combo: comboOf(hit ? streak : 0), voice: voice };
}

function rankPercent(pct) {
  const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  const hit = RANKS.find((r) => n >= r.from) || RANKS[RANKS.length - 1];
  return { name: hit.name, note: hit.note, rank: RANKS.length - RANKS.indexOf(hit) };
}

function comboText(combo) {
  if (!combo || !combo.shown) return "";
  return "连对 " + combo.n + " 句";
}

function keep(key, box) {
  const prev = store.read(key, null);
  const before = prev && prev.rank ? prev : null;
  if (before && Number(before.pct) >= Number(box.pct)) return { best: false, before: before };
  store.write(key, box);
  return { best: true, before: before };
}

function read(key) {
  const box = store.read(key, null);
  return box && box.rank ? box : null;
}

function close(stage) {
  if (!stage) return;
  clearTimeout(stage.flashTimer);
  stage.flashTimer = null;
}

module.exports = {
  KEYS,
  RANKS,
  comboOf,
  mark,
  buzz,
  flash,
  close,
  rankPercent,
  comboText,
  keep,
  read
};
