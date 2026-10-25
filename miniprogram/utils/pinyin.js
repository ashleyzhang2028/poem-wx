const store = require("./store");

const TABLE = "data/pinyin-table.js";

const PACKED_TABLE = function () {
  return require("../data/pinyin-table.js");
};

let tableCache = null;
let missing = false;

function table() {
  if (tableCache) return tableCache;
  if (missing) return null;
  try {
    tableCache = PACKED_TABLE();
  } catch (e) {
    missing = true;
    return null;
  }
  return tableCache;
}

let charsReady = null;

function available() {
  if (charsReady === null) {
    const t = table();
    charsReady = !!(t && t.chars && Object.keys(t.chars).length);
  }
  return charsReady;
}

function readiness() {
  if (!available()) {
    return { visible: false, usable: false, state: "missing", reason: "读音表未生成" };
  }
  return { visible: true, usable: true, state: "ready", reason: "" };
}

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

const WORD_INDEX = {};

let wordTable = null;

function wordsAtChar(t) {
  if (wordTable && wordTable.t === t) return WORD_INDEX;
  wordTable = { t: t };
  Object.keys(WORD_INDEX).forEach((k) => delete WORD_INDEX[k]);
  Object.keys((t && t.words) || {}).forEach((w) => {
    const chars = Array.from(w);
    chars.forEach((ch, off) => {
      const slot = chars.length + "|" + off + "|" + w;
      (WORD_INDEX[ch] || (WORD_INDEX[ch] = [])).push(slot);
    });
  });
  Object.keys(WORD_INDEX).forEach((k) => {
    WORD_INDEX[k].sort((a, b) => parseInt(b, 10) - parseInt(a, 10) || (a < b ? -1 : 1));
  });
  return WORD_INDEX;
}

function wordAt(text, i) {
  const t = table();
  if (!t || !t.words) return "";
  const list = wordsAtChar(t)[String(text).charAt(i)];
  if (!list) return "";
  for (let k = 0; k < list.length; k++) {
    const slot = list[k];
    const cut = slot.indexOf("|");
    const len = parseInt(slot.slice(0, cut), 10);
    const off = parseInt(slot.slice(cut + 1, slot.indexOf("|", cut + 1)), 10);
    const w = slot.slice(slot.indexOf("|", cut + 1) + 1);
    const start = i - off;
    if (start < 0) continue;
    if (text.substr(start, len) === w) return t.words[w][off];
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
  const p = readOf(ch, text, i);
  return !!p && TONE_MARK[4].test(p);
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

function readOf(ch, text, i) {
  const list = readings(ch);
  if (!list.length) return "";

  const hit = wordAt(text, i);
  if (hit && ch !== "一" && ch !== "不") return hit;

  if (list.length === 1) return list[0];

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

function annotate(clause, mode, line, at) {
  const text = String(clause || "");
  const full = mode === "all";
  const context = line === undefined ? text : String(line || "");
  const offset = line === undefined ? 0 : Number(at) || 0;

  if (!full || !available()) {
    return text.split("").map((ch) => ({ ch: ch, py: "", mark: false, han: isHan(ch) }));
  }

  return text.split("").map((ch, i) => {
    if (!isHan(ch)) return { ch: ch, py: "", mark: false, han: false };
    const mark = !!readings(ch).length;
    if (!mark) return { ch: ch, py: "", mark: false, han: true };
    return { ch: ch, py: readOf(ch, context, offset + i), mark: true, han: true };
  });
}

function render(paras, mode) {
  let seq = 0;
  return (paras || []).map((para) =>
    (para || []).map((row) => {

      const line = (row || []).join("");
      let at = 0;
      return (row || []).map((clause) => {
        const out = annotate(clause, mode, line, at);
        at += clause.length;
        return { i: seq++, tokens: out };
      });
    })
  );
}

function getMode() {
  if (!available()) return "off";
  return store.settings().pinyin === "all" ? "all" : "off";
}

function setMode(mode) {
  if (!available()) return false;
  store.saveSettings({ pinyin: mode });

  try {
    require("./sync").markDirty();
  } catch (e) {

  }
  return true;
}

module.exports = {
  available,
  readiness,
  readings,
  readOf,
  annotate,
  render,
  getMode,
  setMode,
  TABLE
};
