/**
 * 注音渲染。
 *
 * 读音表在构建时进包（data/pinyin-table.json，几十 KB），离线可用、不联网查。
 * 多音字消歧这套逻辑**与 poem 网页版 js/pinyin.js 逐条对齐**：
 * 词组优先 → 「一 / 不」变调 → 序数词判读 → 回退首读。
 * 网页版那边改了口径，构建脚本会把新的词组表原样搬过来，
 * 所以不会出现同一首诗两端口音不一样。
 *
 * ⚠️ 读音表没生成出来时**整个注音能力关掉**：设置项不渲染、正文不标音，
 *   不留一个点了没反应的开关。
 */
const store = require("./store");

const TABLE = "data/pinyin-table.json";

let tableCache = null;
let missing = false;

function table() {
  if (tableCache) return tableCache;
  if (missing) return null;
  try {
    tableCache = require("../" + TABLE);
  } catch (e) {
    missing = true;
    return null;
  }
  return tableCache;
}

function available() {
  const t = table();
  return !!(t && t.chars && Object.keys(t.chars).length);
}

function readiness() {
  if (!available()) {
    return { visible: false, usable: false, state: "missing", reason: "读音表未生成" };
  }
  return { visible: true, usable: true, state: "ready", reason: "" };
}

/* ---------- 单字读取 ---------- */

const TONE_MARK = { 1: /[āēīōūǖ]/, 2: /[áéíóúǘ]/, 3: /[ǎěǐǒǔǚ]/, 4: /[àèìòùǜ]/ };

function isHan(ch) {
  return !!(ch && /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch));
}

function readings(ch) {
  const t = table();
  if (!t) return [];
  const raw = t.chars[ch];
  return raw ? String(raw).split("/") : [];
}

/** 词组命中：往回最多两字找起点，与网页版 wordAt 同一算法（三字 > 两字） */
function wordAt(text, i) {
  const t = table();
  if (!t || !t.words) return "";
  const keys = Object.keys(t.words);
  for (let k = 0; k < keys.length; k++) {
    const w = keys[k];
    for (let off = 0; off < w.length; off++) {
      const start = i - off;
      if (start < 0) continue;
      if (text.substr(start, w.length) === w) return t.words[w][off];
    }
  }
  return "";
}

function pickTone(list, tone) {
  const re = TONE_MARK[tone];
  if (re) {
    for (let i = 0; i < list.length; i++) {
      if (re.test(list[i])) return list[i];
    }
  }
  return list[0];
}

function isTone4(ch, text, i) {
  const list = readings(ch);
  if (list.length === 1) return TONE_MARK[4].test(list[0]);
  if (list.length < 2) return false;
  // 避免递归：直接看这个词组/首读，不用完整 readOf
  const hit = wordAt(text, i);
  const p = hit || list[0];
  return TONE_MARK[4].test(p);
}

function isOrdinal(text, i) {
  const prev = text[i - 1];
  const next = text[i + 1];
  const nnext = text[i + 2];
  if (prev && /[第初十百千万]/.test(prev)) return true;
  if (next && /[二三四五六七八九十百千万零两]/.test(next)) return true;
  if (next && /[年月日班级级单元课节册卷份号条只张本]/.test(next)) {
    if (nnext && /[级班单元课节册卷]/.test(nnext)) return true;
    if (nnext && /[二三四五六七八九十百千万零两]/.test(nnext)) return true;
  }
  return false;
}

/**
 * 一个字在具体上下文里读什么。
 * 单音字直接给；多音字按 词组 → 一/不 变调 → 首读 的顺序定。
 */
function readOf(ch, text, i) {
  const list = readings(ch);
  if (!list.length) return "";
  if (list.length === 1) return list[0];

  const hit = wordAt(text, i);
  if (hit && ch !== "一" && ch !== "不") return hit;

  const next = text[i + 1];
  if (ch === "不") {
    return next && isTone4(next, text, i + 1) ? pickTone(list, 2) : pickTone(list, 4);
  }
  if (ch === "一") {
    if (!next || !isHan(next)) return pickTone(list, 1);
    if (isOrdinal(text, i)) return pickTone(list, 1);
    return isTone4(next, text, i + 1) ? pickTone(list, 2) : pickTone(list, 4);
  }

  return list[0];
}

/* ---------- 标不标 ---------- */

/**
 * 「生字」模式标什么：与网页版 needAnnotate 一致 —— 非常用字，或多音字。
 * 多音字即使常用也标，因为那正是最容易读错的一类。
 */
function needAnnotate(ch) {
  const t = table();
  if (!t) return false;
  if (!readings(ch).length) return false;
  const common = (t.common || {})[ch] === 1;
  const poly = (t.poly || {})[ch] === true;
  return !common || poly;
}

/**
 * 把一句正文切成 [{ ch, py, mark }]。
 * mark 为真表示这个字要显示注音 —— 界面照着渲染即可，不必再判模式。
 *
 * `line` / `at` 是这一句在**整行**里的位置：多音字消歧要看得到词组，
 * 而词组往往跨句（「白发」在 `高堂明镜悲白发，` 这一句里就够了，
 * 但「无为」这种可能一半在上一句尾上）。
 *
 * @param {string} clause 这一句（带尾标点）
 * @param {string} mode off / rare / all
 * @param {string} [line] 整行文字；不传就按这一句自己判
 * @param {number} [at] 这一句在 line 里的起点
 */
function annotate(clause, mode, line, at) {
  const text = String(clause || "");
  const context = line === undefined ? text : String(line || "");
  const offset = line === undefined ? 0 : Number(at) || 0;
  if (mode === "off" || !available()) {
    return text.split("").map((ch) => ({ ch: ch, py: "", mark: false }));
  }

  return text.split("").map((ch, i) => {
    if (!isHan(ch)) return { ch: ch, py: "", mark: false };
    const mark = mode === "all" ? !!readings(ch).length : needAnnotate(ch);
    if (!mark) return { ch: ch, py: "", mark: false };
    return { ch: ch, py: readOf(ch, context, offset + i), mark: true };
  });
}

/**
 * 段落 → 行 → 句 → 字。**版式由 corpus.layout() 给，这里只负责标音。**
 *
 * 自己切句是不行的 —— 句子由语料层切、标点留在句尾（`鹅，` 而不是 `鹅`），
 * 这里再切一遍标点就没了，正文读起来少一个字。
 * 消歧窗口仍是**同一行里的整段文字**：读「发」靠的是词组「白发」，
 * 跨句也要看得见；而折叠过的行里，本来相邻的两个短句就不会被拆开。
 *
 * @param {string[][][]} paras corpus.layout().paras
 * @param {string} mode off / rare / all
 * @returns {Array<Array<Array<{ch,py,mark}>>>} 与 paras 同形
 */
function render(paras, mode) {
  const probe = mode === "off" || !available() ? null : table();
  // 句子上挂 `i`：朗读是**按句合成**的（speech.load 吃一个拍平的列表），
  // 界面按句号高亮那一行就得知道「这一句是第几句」。序号在这里一次算清，
  // 页面不再自己数 —— 数错一次，读到第 5 句会高亮第 4 行。
  let seq = 0;
  return (paras || []).map((para) =>
    (para || []).map((row) => {
      // 消歧要看见整行：先把行里所有句拼成一行文字，再逐句标
      const line = (row || []).join("");
      let at = 0;
      return (row || []).map((clause) => {
        const out = probe ? annotate(clause, mode, line, at) : [];
        at += clause.length;
        return { i: seq++, tokens: out };
      });
    })
  );
}

/* ---------- 偏好 ---------- */

function getMode() {
  if (!available()) return "off";
  return store.settings().pinyin || "rare";
}

function setMode(mode) {
  if (!available()) return false;
  store.saveSettings({ pinyin: mode });
  return true;
}

module.exports = {
  available,
  readiness,
  readings,
  readOf,
  needAnnotate,
  annotate,
  render,
  getMode,
  setMode,
  TABLE
};
