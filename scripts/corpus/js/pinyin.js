(function () {
  "use strict";

  const TABLE = window.PINYIN_TABLE || {};

  const COMMON = window.COMMON_CHARS || {};

  const TONE4 = /[àèìòùǜ]/;

  const WORDS = {

    "曲项": ["qū", "xiàng"],
    "绿水": ["lǜ", "shuǐ"],
    "荷叶": ["hé", "yè"],
    "莲叶": ["lián", "yè"],
    "叶公": ["shè", "gōng"],
    "间关": ["jiān", "guān"],
    "中间": ["zhōng", "jiān"],
    "之间": ["zhī", "jiān"],
    "还家": ["huán", "jiā"],
    "还有": ["hái", "yǒu"],
    "还是": ["hái", "shì"],
    "当午": ["dāng", "wǔ"],
    "当日": ["dāng", "rì"],
    "汗滴": ["hàn", "dī"],
    "盘中": ["pán", "zhōng"],
    "中庭": ["zhōng", "tíng"],
    "少小": ["shào", "xiǎo"],
    "多少": ["duō", "shǎo"],
    "少年": ["shào", "nián"],
    "少时": ["shào", "shí"],
    "行行": ["háng", "háng"],
    "道行": ["dào", "háng"],
    "银台": ["yín", "tái"],
    "台阁": ["tái", "gé"],
    "处处": ["chù", "chù"],
    "处士": ["chǔ", "shì"],
    "处理": ["chǔ", "lǐ"],
    "相处": ["xiāng", "chǔ"],
    "长啸": ["cháng", "xiào"],

    "长天": ["cháng", "tiān"],
    "长空": ["cháng", "kōng"],
    "长大": ["zhǎng", "dà"],
    "长得": ["zhǎng", "de"],
    "长相思": ["cháng", "xiāng", "sī"],
    "相思": ["xiāng", "sī"],
    "相看": ["xiāng", "kàn"],
    "相国": ["xiàng", "guó"],
    "应怜": ["yīng", "lián"],
    "应当": ["yīng", "dāng"],
    "应声": ["yìng", "shēng"],
    "答应": ["dā", "ying"],
    "为学": ["wéi", "xué"],
    "为人": ["wéi", "rén"],
    "为何": ["wèi", "hé"],
    "以为": ["yǐ", "wéi"],
    "因为": ["yīn", "wèi"],
    /* 「作为」是历代名家条目的字段标签（每一条都有），也是个常用词。
       「为」的首读是 wèi，不固定住就会被读成「作 wèi」。作名词（作为）
       与作动词（作为…）都读 wéi，无歧义。 */
    "作为": ["zuò", "wéi"],
    "重山": ["chóng", "shān"],
    "重复": ["chóng", "fù"],
    "重要": ["zhòng", "yào"],
    "万重": ["wàn", "chóng"],
    "燕山": ["yān", "shān"],
    "燕子": ["yàn", "zi"],
    "种豆": ["zhòng", "dòu"],
    "种子": ["zhǒng", "zi"],
    "一行": ["yī", "háng"],
    "挑促织": ["tiǎo", "cù", "zhī"],
    "挑灯": ["tiǎo", "dēng"],
    "好景": ["hǎo", "jǐng"],
    "好学": ["hào", "xué"],
    "好之": ["hào", "zhī"],
    "降于": ["jiàng", "yú"],
    "投降": ["tóu", "xiáng"],
    "乐山": ["yào", "shān"],
    "乐水": ["yào", "shuǐ"],
    "知者乐水": ["zhī", "zhě", "yào", "shuǐ"],
    "鲜有": ["xiǎn", "yǒu"],
    "鲜活": ["xiān", "huó"],
    "薄雾": ["bó", "wù"],
    "薄暮": ["bó", "mù"],
    "刻薄": ["kè", "bó"],
    "载重": ["zài", "zhòng"],
    "载入": ["zài", "rù"],
    "记载": ["jì", "zǎi"],
    "三年五载": ["sān", "nián", "wǔ", "zǎi"],
    "边塞": ["biān", "sài"],
    "塞外": ["sài", "wài"],
    "舍去": ["shě", "qù"],
    "屋舍": ["wū", "shè"],
    "参差": ["cēn", "cī"],
    "差池": ["cī", "chí"],
    "佛印": ["fó", "yìn"],
    "仿佛": ["fǎng", "fú"],
    "着地": ["zhuó", "dì"],
    "着力": ["zhuó", "lì"],
    "兴尽": ["xìng", "jìn"],
    "兴起": ["xīng", "qǐ"],
    "号呼": ["háo", "hū"],
    "号叫": ["háo", "jiào"],
    "号称": ["hào", "chēng"],
    "汤汤": ["shāng", "shāng"],
    "省亲": ["xǐng", "qīn"],
    "反省": ["fǎn", "xǐng"],
    "卷起": ["juǎn", "qǐ"],
    "卷帙": ["juàn", "zhì"],
    "手卷": ["shǒu", "juàn"],
    "脉搏": ["mài", "bó"],
    "脉脉": ["mò", "mò"],
    "宁可": ["nìng", "kě"],
    "宁死": ["nìng", "sǐ"],
    "安宁": ["ān", "níng"],
    "遗民": ["yí", "mín"],
    "遗之": ["wèi", "zhī"],
    "缥缈": ["piāo", "miǎo"],
    "发了": ["fā", "le"],
    "白发": ["bái", "fà"],
    "头发": ["tóu", "fa"],
    "云鬓": ["yún", "bìn"],
    "数重": ["shù", "chóng"],
    "数枝": ["shù", "zhī"],
    "可汗": ["kè", "hán"],
    "但使": ["dàn", "shǐ"],
    "度日": ["dù", "rì"],
    "扁舟": ["piān", "zhōu"],
    "小舟": ["xiǎo", "zhōu"],
    "恰好": ["qià", "hǎo"],
    "见牛羊": ["xiàn", "niú", "yáng"],

    /* ── Issue #539 · 荀子《劝学》全文（《古文》那一条） ──────────────────
       这一篇的单字默认音有九处对不上，逐条钉住。判据是**中学语文教科书
       的读法**（与课内那一课同一套），不另立一套：                         */
    /* 「虽有槁暴」——「暴」同「曝」，晒干，读 pù（不是 bào）。 */
    "槁暴": ["gǎo", "pù"],
    /* 「君子博学而日参省乎己」——「参」是「检验」（同「三」的活用），
       读 cān 不读 cēn；「省」读 xǐng（反省），不是 shěng。 */
    "参省": ["cān", "xǐng"],
    /* 「则知明而行无过矣」——「知」同「智」，读 zhì。 */
    "知明": ["zhì", "míng"],
    /* 「君子生非异也」——「生」同「性」，读 xìng。 */
    "生非异": ["xìng", "fēi", "yì"],
    /* 「学恶乎始？恶乎终？」——「恶」读 wū（哪里、怎么）。 */
    "恶乎": ["wū", "hū"],
    /* 「锲而不舍」——「舍」是「舍弃」，读 shě；单字默认的 shè 到这儿会错。
       「驽马十驾，功在不舍」「故学数有终，若其义则不可须臾舍也」同。 */
    "不舍": ["bù", "shě"],
    "而舍": ["ér", "shě"],
    "须臾舍": ["xū", "yú", "shě"],
    /* 「顺者不可胜数也」——「数」读 shǔ（计算），不是 shù。 */
    "胜数": ["shēng", "shǔ"],
    "不可胜数": ["bù", "kě", "shēng", "shǔ"],
    /* 「树成荫」——旧读 yìn，普通话「荫」在「树荫 / 成荫」里读 yīn。
       通行表里两读并存，表里只收了 yìn，这里按普通话钉住。 */
    "成荫": ["chéng", "yīn"]
  };

  function readings(ch) {
    const raw = TABLE[ch];
    return raw ? raw.split("/") : [];
  }

  function isHan(ch) {
    return /\p{Script=Han}/u.test(ch);
  }

  var FIX_WID = "";
  var FIX_LINE = "";
  var FIX_MAP = null;

  function fixStore() {
    return typeof window !== "undefined" && window.PinyinFix ? window.PinyinFix : null;
  }

  function begin(wid, line) {
    FIX_WID = String(wid == null ? "" : wid);
    FIX_LINE = String(line == null ? "" : line).trim();
    FIX_MAP = null;
    if (!FIX_WID || !FIX_LINE) return;
    var F = fixStore();
    if (!F || typeof F.mapOf !== "function") return;
    try { FIX_MAP = F.mapOf(FIX_WID) || null; } catch (e) { FIX_MAP = null; }
  }

  function end() { begin("", ""); }

  function nthIn(chars, i) {
    var ch = chars[i];
    var n = 0;
    for (var k = 0; k <= i; k++) if (chars[k] === ch) n++;
    return n;
  }

  // Stored lines are capped at 120 chars (PinyinFix.LINE_MAX), so match on the same prefix.
  function fixAt(ch, chars, i) {
    if (!FIX_MAP || !FIX_LINE) return "";
    if (!isPolyphone(ch)) return "";
    var base = FIX_LINE.slice(0, 120) + "\u0000" + nthIn(chars, i) + "\u0000";
    var v = FIX_MAP[base + ch] || FIX_MAP[base];
    return v ? String(v) : "";
  }

  function readOf(ch, text, i) {
    const list = readings(ch);
    if (!list.length) return "";

    const fixed = fixAt(ch, text, i);
    if (fixed) return fixed;

    /* ⚠️ 词表要**排在**「单音字直接返回」前面（Issue #539）。
       原先的顺序是 `if (list.length === 1) return list[0]` 先跑，
       于是**单音字的词表条永远轮不到** —— 「恶」（表里只有 è）在
       「恶乎」（wū）里照样读 è；「暴」（bào）在「槁暴」（pù）里读 bào；
       「知」（zhī）在「知明」（zhì）里读 zhī。
       这些正是古汉语里最常见的通假 / 活用，恰好多是单音字 ——
       词表本来就是为它们准备的，卡在前面等于白写。
       顺序改成：勘误 → 词表 → 单音字 → 多音字规则。 */
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

  const TONE_MARK = { 1: /[āēīōūǖ]/, 2: /[áéíóúǘ]/, 3: /[ǎěǐǒǔǚ]/, 4: /[àèìòùǜ]/ };

  function isTone4(ch, text, i) {
    const p = readOf(ch, text, i);
    if (!p) return false;
    if (TONE_MARK[4].test(p)) return true;

    return false;
  }

  function pickTone(list, tone) {
    const re = TONE_MARK[tone];
    if (re) {
      for (let i = 0; i < list.length; i++) if (re.test(list[i])) return list[i];
    }
    return list[0];
  }

  function isOrdinal(text, i) {
    const arr = Array.from(text);
    const prev = arr[i - 1];
    const next = arr[i + 1];
    const nnext = arr[i + 2];

    if (prev && /[第初十百千万]/.test(prev)) return true;

    if (next && /[二三四五六七八九十百千万零两]/.test(next)) return true;

    if (next && /[年月日班級级单元课课节册卷份号条只张本]/.test(next)) {

      if (nnext && /[级級班单元课节册卷班]/.test(nnext)) return true;
      if (nnext && /[二三四五六七八九十百千万零两]/.test(nnext)) return true;
    }
    return false;
  }

  /* 词表里**多字词**优先于单字词：`Object.keys` 是按插入顺序来的，
     "恶"（单字）排在 "恶乎" 前面时，`wordAt` 先撞上单字那条就返回了，
     后面那条多字词永远轮不到。按长度从长到短排一次，长的先试。
     ⚠️ 只排一次、缓存在 `WORD_KEYS` 上 —— 词表是模块级常量，不会中途变。 */
  let WORD_KEYS = null;
  function wordKeys() {
    if (!WORD_KEYS) {
      WORD_KEYS = Object.keys(WORDS).sort(function (a, b) {
        return Array.from(b).length - Array.from(a).length;
      });
    }
    return WORD_KEYS;
  }

  function wordAt(text, i) {
    const keys = wordKeys();
    for (let k = 0; k < keys.length; k++) {
      const w = keys[k];
      const arr = Array.from(w);

      for (let off = 0; off < arr.length; off++) {
        const start = i - off;
        if (start < 0) continue;
        let ok = true;
        for (let j = 0; j < arr.length; j++) {
          if (text[start + j] !== arr[j]) {
            ok = false;
            break;
          }
        }
        if (ok) return WORDS[w][off];
      }
    }
    return "";
  }

  function isCommon(ch) {
    return !!COMMON[ch];
  }

  function needAnnotate(ch) {
    if (!readings(ch).length) return false;
    return !isCommon(ch) || isPolyphone(ch);
  }

  function isPolyphone(ch) {
    return readings(ch).length > 1;
  }

  function annotateHtml(text, mode) {
    const rare = (mode || "rare") !== "all";
    const src = String(text == null ? "" : text);
    const chars = Array.from(src);
    let out = "";
    chars.forEach(function (ch, i) {
      if (!isHan(ch)) {
        out += ch === "\n" ? "<br>" : escapeHtml(ch);
        return;
      }

      if (rare && !needAnnotate(ch)) {
        out += escapeHtml(ch);
        return;
      }
      const p = readOf(ch, chars, i);
      if (!p) {
        out += escapeHtml(ch);
        return;
      }
      out += "<ruby>" + escapeHtml(ch) + "<rt>" + escapeHtml(p) + "</rt></ruby>";
    });
    return out;
  }

  function rareChars(text) {
    const seen = Object.create(null);
    const list = [];
    Array.from(String(text == null ? "" : text)).forEach(function (ch) {
      if (!isHan(ch) || seen[ch] || !needAnnotate(ch)) return;
      seen[ch] = 1;
      list.push(ch);
    });
    return list;
  }

  function annotatePoem(wid, text, mode) {
    const src = String(text == null ? "" : text);
    const w = String(wid == null ? "" : wid);
    const F = fixStore();
    const on = !!w && !!F && typeof F.mapOf === "function";
    const lines = src.split("\n");
    const out = lines.map(function (line) {
      if (!on) return annotateHtml(line, mode);
      begin(w, line.trim());
      try { return annotateHtml(line, mode); } finally { FIX_MAP = null; }
    });
    return out.join("<br>");
  }

  function annotatePoemText(wid, text, mode) {
    const src = String(text == null ? "" : text);
    const w = String(wid == null ? "" : wid);
    const F = fixStore();
    const on = !!w && !!F && typeof F.mapOf === "function";
    return src.split("\n").map(function (line) {
      if (!on) return annotateText(line, mode);
      begin(w, line.trim());
      try { return annotateText(line, mode); } finally { FIX_MAP = null; }
    }).join("\n");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function annotateText(text, mode) {
    const rare = (mode || "rare") !== "all";
    const src = String(text == null ? "" : text);
    const chars = Array.from(src);
    return chars.map(function (ch, i) {
      if (!isHan(ch)) return ch;
      if (rare && !needAnnotate(ch)) return ch;
      return ch + "(" + (readOf(ch, chars, i) || "") + ")";
    });
  }

  function read(ch) {
    const l = readings(ch);
    return l.length ? l[0] : "";
  }

  window.Pinyin = {
    annotateHtml: annotateHtml,
    annotateText: annotateText,
    annotatePoem: annotatePoem,
    annotatePoemText: annotatePoemText,
    begin: begin,
    end: end,
    rareChars: rareChars,
    isCommon: isCommon,
    needAnnotate: needAnnotate,
    isPolyphone: isPolyphone,
    readOf: function (ch, text, i) { return readOf(ch, text || ch, i || 0); },
    readings: function (ch) { return readings(ch).slice(); },
    read: read,
    has: function (ch) { return !!TABLE[ch]; },
    size: function () { return Object.keys(TABLE).length; },
    commonSize: function () { return Object.keys(COMMON).length; },
    isHan: isHan
  };
})();
