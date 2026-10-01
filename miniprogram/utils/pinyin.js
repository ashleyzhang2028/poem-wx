/**
 * 注音渲染。
 *
 * 与网页版 js/pinyin.js 同一套判读顺序，但把「读音表从哪来」换掉了：
 * 网页版读 window.PINYIN_TABLE（3.6 万字全表），小程序端读包内的
 * data/pinyin.json（1517 字，只留多音字与生僻字）。常用单音字不标注没有意义，
 * 砍掉它们让这张表从 55KB 降到 21KB。
 *
 * 消歧顺序（一路都没命中才落到首读音）：
 *   1. 字在表里只有一读 → 直接用
 *   2. 多音字 → 先查词组表（WORDS，117 条），命中就按词组读
 *   3. 「一」「不」按后一字的声调变读
 *   4. 都不中 → 表里第一个读音
 *
 * 网页版还有第 0 优先级的「用户注音勘误」（PinyinFix），小程序端没搬 ——
 * 那套依赖后端审核队列，属于「先不自欺」的部分。
 */
const corpus = require("./corpus");

const TONE = { 1: /[āēīōūǖ]/, 2: /[áéíóúǘ]/, 3: /[ǎěǐǒǔǚ]/, 4: /[àèìòùǜ]/ };

let table = null;

/** 读音表懒加载：只有真的开了注音才读，省一次同步 IO */
function load() {
  if (!table) table = corpus.pinyin();
  return table;
}

function readings(ch) {
  const t = load();
  return (t.chars && t.chars[ch]) || [];
}

function isHan(ch) {
  const c = String(ch || "").charCodeAt(0);
  return c >= 0x3400 && c <= 0x9fff;
}

function isPolyphone(ch) {
  return readings(ch).length > 1;
}

/** 表里没有 = 常用单音字，不需要标注 */
function needAnnotate(ch) {
  return readings(ch).length > 0;
}

function pickTone(list, tone) {
  const re = TONE[tone];
  if (re) {
    for (let i = 0; i < list.length; i++) if (re.test(list[i])) return list[i];
  }
  return list[0];
}

/** 词组表命中：在 chars 里从 i 往前找词组起点，取对应位置那一读 */
function wordAt(chars, i) {
  const words = load().words || {};
  const keys = Object.keys(words);
  for (let k = 0; k < keys.length; k++) {
    const w = Array.from(keys[k]);
    for (let off = 0; off < w.length; off++) {
      const start = i - off;
      if (start < 0) continue;
      let hit = true;
      for (let j = 0; j < w.length; j++) {
        if (chars[start + j] !== w[j]) {
          hit = false;
          break;
        }
      }
      if (hit) return words[keys[k]][off] || "";
    }
  }
  return "";
}

function isTone4(chars, i) {
  const p = readOf(chars, i);
  if (!p) return false;
  return TONE[4].test(p);
}

/** 「一」「不」的变读：后字四声则读二声，否则读四声；「一」在序数里读一声 */
function readOf(chars, i) {
  const ch = chars[i];
  const list = readings(ch);
  if (!list.length) return "";
  if (list.length === 1) return list[0];

  const hit = wordAt(chars, i);
  if (hit && ch !== "一" && ch !== "不") return hit;

  const next = chars[i + 1];
  if (ch === "不") {
    const t4 = next && isHan(next) ? isTone4(chars, i + 1) : false;
    return t4 ? pickTone(list, 2) : pickTone(list, 4);
  }
  if (ch === "一") {
    if (!next || !isHan(next)) return pickTone(list, 1);
    if (isOrdinal(chars, i)) return pickTone(list, 1);
    return isTone4(chars, i + 1) ? pickTone(list, 2) : pickTone(list, 4);
  }

  return list[0];
}

function isOrdinal(chars, i) {
  const prev = chars[i - 1];
  const next = chars[i + 1];
  const nnext = chars[i + 2];
  if (prev && /[第初十百千万]/.test(prev)) return true;
  if (next && /[二三四五六七八九十百千万零两]/.test(next)) return true;
  if (next && /[年月日班级单元课节册卷份号条张本]/.test(next)) {
    if (nnext && /[级班级单元课节册卷]/.test(nnext)) return true;
    if (nnext && /[二三四五六七八九十百千万零两]/.test(nnext)) return true;
  }
  return false;
}

/**
 * 把一行正文切成「注音单元」。
 *
 * 小程序端没有 <ruby>，注音只能自己排版：汉字 + 拼音上下两行。
 * 所以这里不返回 HTML，返回分段数组，交给 WXML 用 flex 竖排——
 * 这样字号 / 行距都由样式控制，不依赖 runtime 拼字符串。
 *
 * @param {string} text 一行正文
 * @param {"off"|"rare"|"all"} mode
 * @returns {Array<{c:string, py:string, on:boolean}>}
 */
function annotate(text, mode) {
  const src = String(text == null ? "" : text);
  if (!mode || mode === "off") return Array.from(src).map((c) => ({ c, py: "", on: false }));

  const chars = Array.from(src);
  const rareOnly = mode !== "all";

  return chars.map((ch, i) => {
    if (!isHan(ch)) return { c: ch, py: "", on: false };
    const py = readOf(chars, i);
    if (!py) return { c: ch, py: "", on: false };
    // 「生字」模式下常用单音字不标
    if (rareOnly && !isPolyphone(ch) && !isRare(ch)) return { c: ch, py: "", on: false };
    return { c: ch, py, on: true };
  });
}

/** 生僻字：表里有它，但只有一个读音 —— 表里只收生僻字与多音字，所以单音即生僻 */
function isRare(ch) {
  return readings(ch).length === 1;
}

/** 只标注生僻字的模式：返回整篇里出现的生僻字，供设置页预览 */
function rareChars(text) {
  const seen = {};
  const out = [];
  Array.from(String(text == null ? "" : text)).forEach((ch) => {
    if (seen[ch] || !isRare(ch)) return;
    seen[ch] = 1;
    out.push({ c: ch, py: readings(ch)[0] });
  });
  return out;
}

function available() {
  return Object.keys(load().chars || {}).length > 0;
}

function reset() {
  table = null;
}

module.exports = {
  load,
  readings,
  isHan,
  isRare,
  isPolyphone,
  needAnnotate,
  readOf,
  annotate,
  rareChars,
  available,
  reset
};
