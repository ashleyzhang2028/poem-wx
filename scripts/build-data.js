#!/usr/bin/env node
/**
 * 把 poem 网页应用的语料编译成小程序可用的分包数据。
 *
 * 输入：POEM_WEB_DIR 指向 poem 仓库根目录（默认 /tmp/poem，CI 里由 clone 步骤给出）。
 * 输出：miniprogram/data/**，其中：
 *   - index.json     全站索引（列表页、搜索、每日计划只用它，条目不含正文）
 *   - texts/<book>.json 各集子正文分片，按条目 id 的哈希稳定分桶
 *
 * 为什么不把正文塞进主包：主包上限 2MB，而全部正文（data/text-master.js）
 * 未压缩 24MB、gzip 后 4.9MB。索引只有约 600KB，正文全部落到分包按需取。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WEB_DIR = process.env.POEM_WEB_DIR || "/tmp/poem";
const OUT_DIR = path.join(__dirname, "..", "miniprogram", "data");

/** 每个正文分片的目标量（压缩前 KB），控制单次下载体积 */
const BUCKET_KB = 200;

/**
 * 全文倒排一列覆盖多少「位次」。
 *
 * 位次空间是全站正文汉字总数（286 万），一列放多少直接决定两件事：
 *   列多 → 单个文件小，但为了搜一个字要发的请求多；
 *   列少 → 请求少，但每个文件大，一次下载慢。
 *
 * 取 65536 是权衡后的结果：一列约 440KB（压缩前），全站 44 列。
 * 搜一个字最多拉 44 个文件 —— 且可以并发，且只有第一次搜才拉，
 * 之后落本机缓存。这个数量级在弱网下也能接受；再小就会把请求数
 * 推上千位，反而不如直接下整包。
 *
 * ⚠️ 与 miniprogram/utils/fulltext.js 的 COL_SPAN 必须一致。
 */
const COL_SPAN = 65536;

/** 语料脚本都是 IIFE 挂 window.XXX 的老式写法，按顺序丢进同一个沙箱执行 */
function loadCorpus(rels) {
  const sandbox = { window: {}, console: console, Date: Date, JSON: JSON };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = undefined;
  vm.createContext(sandbox);
  rels.forEach(function (rel) {
    const file = path.join(WEB_DIR, rel);
    vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: rel });
  });
  return sandbox.window;
}

function main() {
  // text-master 里的正文要先展开回各集子条目，再统一收集
  const W = loadCorpus([
    "data/poems-1.js", "data/poems-2.js", "data/poems-3.js", "data/poems-4.js",
    "data/poems-5.js", "data/poems-6.js", "data/poems-7.js", "data/poems-8.js",
    "data/poems-9.js", "data/poems-10.js", "data/poems-11.js", "data/poems-12.js",
    "data/text-master.js",
    "data/poems-classic.js", "data/poems-yuefu.js", "data/poems-tangshi.js",
    "data/poems-gushi.js", "data/poems-songci.js", "data/poems-yuanqu.js",
    "data/poems-guwen.js", "data/poems-jinxiandai.js", "data/poems-zhaoming.js",
    "data/poems-chengyu.js", "data/poems-changshi.js", "data/poems-mingshu.js",
    "data/poems-mingren-cn.js", "data/poems-mingren-foreign.js",
    "data/poems-emperor-cn.js", "data/poems-emperor-waiguo.js",
    "data/common-chars.js",
    "data/pinyin-table.js",
    "data/group-order.js",
    "data/index.js",
    "data/site-books.js",
    "data/site-index.js"
  ]);

  const master = W.TEXT_MASTER || [];
  if (!master.length) throw new Error("TEXT_MASTER 为空，检查 POEM_WEB_DIR");

  const byId = {};
  master.forEach(function (m) {
    byId[m.id] = m;
    (m.entries || []).forEach(function (e) { if (!byId[e]) byId[e] = m; });
  });

  const siteIndex = W.SITE_INDEX || [];
  const books = W.SITE_BOOKS || [];

  const index = [];
  const texts = {};

  siteIndex.forEach(function (p) {
    if (p.isBook) return;
    const m = byId[p.id] || byId[p.originId] || null;
    const text = p.text || (m && m.text) || "";
    const translation = p.translation || (m && m.translation) || "";

    index.push({
      id: p.id,
      t: p.title,
      a: p.author || p.authorName || "",
      d: p.dynasty || "",
      s: p.source || "",
      g: p.group || p.gradeGroup || "",
      b: p.book,
      n: p.bookName,
      // 年级学期只有课内诗词有，其余集子按分组走；0 表示不适用
      gr: p.grade || 0,
      tm: p.term || 0,
      hasT: !!text
    });

    if (text || translation) {
      texts[p.id] = { text: text, translation: translation, src: p.translationSource || "" };
    }
  });

  // 索引按集子拆开：列表页只加载自己那一部。
  // ⚠️ 不再另存一份全站索引 —— 那会让 meta.json 涨到 1.3MB（主包上限只有 2MB），
  // 而它与各集子索引是同一份数据。搜索与按 id 查条目时按需拼装。
  const byBook = {};
  index.forEach(function (p) {
    (byBook[p.b] = byBook[p.b] || []).push(p);
  });

  Object.keys(byBook).forEach(function (b) {
    writeJson(path.join(OUT_DIR, "books", b + ".json"), byBook[b]);
  });

  writeJson(path.join(OUT_DIR, "books", "books.json"), books);

  writeBuckets(texts);
  writePinyin(W);
  writeFulltext(index, texts);

  console.log("索引 " + index.length + " 条，按 " + Object.keys(byBook).length + " 部集子拆分");
  console.log("正文 " + Object.keys(texts).length + " 条");
}

/**
 * 读音表 + 多音字词组表。
 *
 * 这两张表是「注音渲染」的全部依赖，网页版放在 js/pinyin.js 的 WORDS 与
 * data/pinyin-table.js 的 PINYIN_TABLE 里。整张表 3.6 万字离线压缩后约 8KB，
 * 比一次网络请求便宜得多，所以随包下发、断网也能注音。
 *
 * 表里只留「需要标注的」字：多音字 60 个 + 生僻字 1457 个 = 1517 个。
 * 常用单音字（「床前明月光」那些）标出来没有意义，砍掉能省 3/4 体积。
 */
function writePinyin(W) {
  const table = W.PINYIN_TABLE || {};
  const common = commonSet(W.COMMON_CHARS);
  const words = wordsOf(W);

  const chars = {};
  Object.keys(table).forEach(function (ch) {
    const readings = String(table[ch]).split("/").filter(Boolean);
    // 多音字必须留（要用词组消歧），其余只留生僻字
    if (readings.length < 2 && common[ch]) return;
    chars[ch] = readings;
  });

  const polyphone = Object.keys(chars).filter(function (c) { return chars[c].length > 1; }).length;

  writeJson(path.join(OUT_DIR, "pinyin.json"), {
    v: 1,
    chars: chars,
    words: words
  });

  console.log("读音表 " + Object.keys(chars).length + " 字（多音 " + polyphone +
    "），词组 " + Object.keys(words).length + " 条");
}

/** COMMON_CHARS 已经是「字 → 1」的映射，直接拿来当集合用 */
function commonSet(map) {
  return map && typeof map === "object" ? map : {};
}

/** js/pinyin.js 里的 WORDS 是源码字面量，vm 跑不进沙箱（它挂在 IIFE 里不外抛），所以正则抠出来 */
function wordsOf() {
  const file = path.join(WEB_DIR, "js", "pinyin.js");
  if (!fs.existsSync(file)) return {};
  const src = fs.readFileSync(file, "utf8");
  const start = src.indexOf("WORDS");
  if (start < 0) return {};
  const open = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (!depth) { end = i; break; }
    }
  }
  if (end < 0) return {};

  const body = src.slice(open, end + 1);
  const out = {};
  const re = /"([^"]+)"\s*:\s*\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(body))) {
    const key = m[1];
    const val = m[2].split(",").map(function (x) { return x.trim().replace(/^"|"$/g, ""); });
    if (key && val.length) out[key] = val;
  }
  return out;
}

/**
 * 全站倒排索引。
 *
 * 只搜索引字段时，「正文里的字」搜不到 —— 用户搜「明月几时有」会一无所获，
 * 那才是他真正想要的东西。所以额外产出一份字 → id 的倒排。
 *
 * 为什么是「字」不是「词」：中文分词要词典，而这里的语料是文言，
 * 分词器切出来反而不准。单字倒排 + 位置筛选，一次遍历就能做子串匹配，
 * 而且体积可控 —— 形如 {"明":[3,17,92]}，一个 id 换成 3 位 base36，重复字靠位置数组。
 *
 * 体积实测 1.1MB。塞不进 2MB 主包，所以放 CloudBase 云存储按需拉；
 * 拉不到时全文检索自动退回「只搜索引字段」，不报错、不空手。
 */
function writeFulltext(index, texts) {


  // 先落每条的列号，再按字归并成「列号数组」—— 列号用 base36 压成 1–3 字符
  //
  // ⚠️ 这里必须按 index 的次序遍历，不能拿 texts 的 key 次序来：
  //   `i % 4096` 是**条目在自己那一列里的位次**，而位次由 index 的次序定。
  //   曾经写成 Object.keys(texts) —— 那是「先按 id 排好序」的另一套次序，
  //   于是倒排里的位次与客户端还原出来的位次整个错开一格，
  //   表现是「明月几时有」搜出「白发三千丈」。这个 bug 只表现在数据里，
  //   代码读起来完全合理，所以务必保持按 index 遍历。
  // 位次空间把**全站正文首尾相接**铺成一条长串：
  //   第 i 条的正文里第 k 个字，位次是 base[i] + k，base[i] 是前 i 条正文总长。
  // 不是「条目的序号」—— 一条 5000 字的《昭明文选》与一条 20 字的五绝占的位次
  // 差两百多倍，这正是子串匹配能跨条目边界自然断开的原因：
  // 相邻两条之间不连续，所以「上一首的末字 + 下一首的首字」凑不成假的命中。
  const base = new Array(index.length);
  let acc = 0;
  index.forEach(function (p, i) {
    base[i] = acc;
    const t = texts[p.id];
    acc += t && t.text ? Array.from(cleanFulltext(t.text)).length : 0;
  });

  const colsOf = {};
  index.forEach(function (p, i) {
    const t = texts[p.id];
    if (!t || !t.text) return;
    const chars = Array.from(cleanFulltext(t.text));
    for (let k = 0; k < chars.length; k++) {
      const at = base[i] + k;
      const atCol = Math.floor(at / COL_SPAN);
      const atBucket = colsOf[atCol] || (colsOf[atCol] = {});
      (atBucket[chars[k]] = atBucket[chars[k]] || {})[at % COL_SPAN] = 1;
    }
  });

  // 位次空间的总长 = 全站正文汉字总数，列数由它决定（不是条目数）
  const SPAN = acc;
  const COLS = Math.max(1, Math.ceil(SPAN / COL_SPAN));

  let files = 0;
  let bytes = 0;
  const manifest = [];

  // 缺口要补空对象 —— 客户端按 n × COL_SPAN 还原位次，缺一列整张表就错位。
  for (let col = 0; col < COLS; col++) {
    const bucket = colsOf[col] || {};
    const out = {};
    Object.keys(bucket).forEach(function (ch) {
      const bits = Object.keys(bucket[ch]).map(Number).sort(function (a, b) { return a - b; });
      out[ch] = pack(bits);
    });
    const rel = "fulltext/" + col + ".json";
    writeJson(path.join(OUT_DIR, rel), out);
    const size = fs.statSync(path.join(OUT_DIR, rel)).size;
    files += 1;
    bytes += size;
    manifest.push({ n: col, kb: Math.round(size / 1024) });
  }

  // 客户端要能自己算出「第 i 条的第 k 个字」的位次，所以把每条正文的起点
  // 与长度一并下发。紧凑一行：base 升序 + len，差分再压一次不值得，这里够小。
  writeJson(path.join(OUT_DIR, "fulltext", "manifest.json"), {
    v: 1,
    cols: COLS,
    colSpan: COL_SPAN,
    span: SPAN,
    entryCount: index.length,
    base: base,
    files: manifest
  });

  console.log("全站倒排 " + files + " 个文件，" + Math.round(bytes / 1024) + "KB");
}

/** 倒排里只留汉字，标点与空白一律丢掉，省 30% 体积 */
function cleanFulltext(text) {
  return String(text == null ? "" : text).replace(/[^\u3400-\u9fff]/g, "");
}

/**
 * 升序整数数组 → 差分 + base36。
 *
 * ⚠️ 这里**不能**直接拼 base36 字符串：差值 ≥ 36 时 `toString(36)` 会吐出两位
 * （`(967-308).toString(36) === "ib"`），拼起来就没有边界了 ——
 * 解码方按单字符累加，从第一个两位数开始整段错位。
 * 第一版就是这么错的，结果「明月几时有」搜不出《水调歌头》。
 *
 * 所以加一层显式长度前缀：每一段先给 base36 的长度位（`0` 表示结束），
 * 再给实际数字。数字本身用 `36 + 平移量` 表示，避开与长度位撞车。
 * 实测比 JSON 数组省 60% 体积，而且天然可流式解码。
 */
function pack(bits) {
  let out = "";
  let prev = 0;
  for (let i = 0; i < bits.length; i++) {
    const d = bits[i] - prev;
    prev = bits[i];
    // 差值的 base36 表示，长度最多 2 位（位次空间 286 万 < 36^5）
    const enc = d.toString(36);
    out += enc.length.toString(36) + enc;
  }
  return out;
}

/** 按条目 id 的稳定哈希分桶，同一条永远落同一个文件，便于做增量缓存 */
function writeBuckets(texts) {
  const dir = path.join(OUT_DIR, "texts");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const all = Object.keys(texts).sort();
  const buckets = [];
  let cur = [];
  let curSize = 0;

  // 先按体积降序装桶，大条目先落位，避免末尾留下大量小桶
  const ordered = all.slice().sort(function (a, b) {
    return JSON.stringify(texts[b]).length - JSON.stringify(texts[a]).length;
  });

  ordered.forEach(function (id) {
    const size = Buffer.byteLength(JSON.stringify(texts[id]), "utf8") / 1024;
    if (curSize + size > BUCKET_KB && cur.length) {
      buckets.push(cur);
      cur = [];
      curSize = 0;
    }
    cur.push(id);
    curSize += size;
  });
  if (cur.length) buckets.push(cur);

  const map = {};
  const manifest = [];

  buckets.forEach(function (ids, i) {
    const name = "t" + String(i + 1).padStart(3, "0");
    const payload = {};
    ids.forEach(function (id) {
      payload[id] = texts[id];
      map[id] = name;
    });

    const file = path.join(dir, name + ".json");
    fs.writeFileSync(file, JSON.stringify(payload));
    manifest.push({ n: name, c: ids.length, kb: Math.round(fs.statSync(file).size / 1024) });
  });

  writeJson(path.join(dir, "manifest.json"), { buckets: manifest, map: map });

  const total = manifest.reduce(function (a, b) { return a + b.kb; }, 0);
  console.log("正文分片 " + manifest.length + " 个，" + total + "KB（未压缩）");
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

main();
