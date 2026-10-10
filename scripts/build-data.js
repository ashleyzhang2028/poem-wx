#!/usr/bin/env node
/**
 * 把 poem 的语料编译成 miniprogram/data/**：
 *   books/<book>.json     各集子索引（不含正文）
 *   course.json           课内 251 首正文与译文（进主包）
 *   texts/<bucket>.json   其余正文分片，按条目 id 哈希稳定分桶，走云端
 *   texts/idx.json        正文倒排索引（字 → 分片），走 CDN
 *   pinyin-table.json     读音表（进主包，离线注音用）
 *
 * 全部正文 24MB 塞不进 2MB 的主包；课内那 251 首只有 223KB，进包换掉一次云端往返，
 * 且不再进分片，避免同一份正文两处各存一份。
 *
 * 输入：POEM_WEB_DIR 指向 poem 仓库根（默认 /tmp/poem）。
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
 * 译文的来源说明。poem 网页版把 `translationSource` 当键、拿
 * `window.translationSourceText()` 翻成人话，小程序移植时只搬了键 ——
 * 于是详情页把 `school` / `academic` / `modern` 这几个英文 token 原样
 * 印在译文下面（Issue #49 走查 reader-trans 屏时看见的）。
 * 口径与 poem 的 `data/index.js` 同一份，改这边记得对那边。
 */
const TRANSLATION_SOURCES = {
  academic: "依据《唐诗鉴赏辞典》《宋词鉴赏辞典》等工具书的通行讲法",
  school: "依据统编版教材与教师用书课后释义",
  "public-domain": "原文属公有领域，依据公认注本与通行译注",
  modern: "依据现行通用选本与通行讲法"
};

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
    "data/group-order.js",
    "data/index.js",
    "data/site-books.js",
    "data/site-index.js",
    "data/common-chars.js",
    "data/pinyin-table.js"
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
  // 课内诗词单独走一份 course.json（进主包），不进分片
  const courseTexts = {};

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
      /* 题名异写（「又名 xxxx」，Issue #516）：只有少数篇目有，数组或字符串,
         没有就是 undefined（判定处一律用真值判断，不设空数组）。
         详情页标题底下取用，与网页版 reader-core.js 的 renderAliases 同口径 */
      aka: p.aliases || null,
      /* 第二重出处（Issue #512）：`source` 写这首诗所出之书（《杜工部集》），
         `selection` 记收它的选本（《唐诗三百首》）。两者在详情页并列，
         `source` 在前 —— 与网页版 reader-core.js 那个 <span class="tag"> 一致。
         只有《唐诗》《词》《曲》《昭明文选》四部的选本条目有 */
      sel: p.selection || "",
      g: p.group || p.gradeGroup || "",
      book: p.book,
      bookName: p.bookName,
      // 年级学期只有课内诗词有，其余集子按分组走；0 表示不适用
      gr: p.grade || 0,
      tm: p.term || 0
      /* ⚠️ `b`（集子 id）/ `n`（集子名）/ `hasT` 三个字段**故意不落盘** ——
         它们各自占 76KB / 60KB / 63KB，而前两个在每个文件里是**同一个常数**
         （书籍已经按集子拆文件了），`hasT` 更是 5854 条全是 true。

         2026-10-09 这一轮把主包顶过了 2MB（1.90 → 2.05MB）：补录进来 255 条
         （5599 → 5854）、出处勘正又给 337+288+480 条加了 `sel`。三者合计
         199KB，去掉就回到预算里，且**一个字的正文都没动**。

         补回来的地方只有一处：`utils/corpus.js` 的 `ofBook()` ——
         它读文件时按文件名把 `b` / `n` 填回去（`hasT` 直接给 true）。
         语料的每一层都走 `ofBook()`（列表 / 检索 / 阅读 / 作者索引 / 试题），
         所以外面看到的形状**与从前一模一样**。 */
    });

    if (text || translation) {
      // 存的是**说明**不是 token —— 认不得的 token 一律留空，
      // 界面上少一行灰字，好过印一串英文
      const payload = {
        text: text,
        translation: translation,
        src: TRANSLATION_SOURCES[p.translationSource] || ""
      };
      if (p.grade || p.term) courseTexts[p.id] = payload;
      else texts[p.id] = payload;
    }
  });

  // 索引按集子拆开：列表页只加载自己那一部。
  // ⚠️ 不再另存一份全站索引 —— 那会让 meta.json 涨到 1.3MB（主包上限只有 2MB），
  // 而它与各集子索引是同一份数据。搜索与按 id 查条目时按需拼装。
  const byBook = {};
  index.forEach(function (p) {
    (byBook[p.book] = byBook[p.book] || []).push(p);
  });

  Object.keys(byBook).forEach(function (b) {
    /* 落盘时把 `book` / `bookName` 摘掉 —— 它们在每个文件里是同一个常数
       （见上面写入注释里那段账）。`books.json` 里已经有一份 id → 名字的表，
       `utils/corpus.js` 的 `ofBook()` 读文件时按文件名填回去。 */
    const rows = byBook[b].map(function (p) {
      const copy = {};
      Object.keys(p).forEach(function (k) {
        /* `book` / `bookName` 摘掉（见下）；空的字段也摘掉 ——
           `aka: null` / `sel: ""` / `gr: 0` / `g: ""` 在 JSON 里各自占
           十几个字节，5854 条累起来是几十 KB 的纯空。读的人一律用
           真值判断（`if (p.sel)`），缺字段与空值在那边是同一件事。 */
        if (k === "book" || k === "bookName") return;
        const v = p[k];
        if (v === null || v === undefined || v === "" || v === 0) return;
        copy[k] = v;
      });
      return copy;
    });
    writeJson(path.join(OUT_DIR, "books", b + ".json"), rows);
  });

  writeJson(path.join(OUT_DIR, "books", "books.json"), books);

  writeJson(path.join(OUT_DIR, "course.json"), courseTexts);
  writeBuckets(texts);
  writePinyin(W, index, courseTexts, texts);
  writeTextIndex(courseTexts, texts, W);
  writeRoster();

  console.log("索引 " + index.length + " 条，按 " + Object.keys(byBook).length + " 部集子拆分");
  const courseKb = Math.round(fs.statSync(path.join(OUT_DIR, "course.json")).size / 1024);
  console.log("课内正文 " + Object.keys(courseTexts).length + " 条进主包，course.json " + courseKb + "KB");
  console.log("正文分片 " + Object.keys(texts).length + " 条走云端");
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

/**
 * 读音表。两条来源：
 *   1. poem 网页版的 data/pinyin-table.js（有就用，口径与网页端一致）
 *   2. 自建：对每个出现在语料里的汉字取拼音。汉字面约 6000，压成一份 json 只有几十 KB。
 *
 * 多音字靠**词组表**消歧：先收两字与三字词（语料自带的词条），运行时优先整词取值，
 * 词组里没有才回退单字。这条跟网页版同一思路 —— 单字表永远猜不准「长」「还」「为」。
 */
function writePinyin(W, index, courseTexts, texts) {
  const table = W.PINYIN_TABLE || null;
  const common = W.COMMON_CHARS || null;

  if (!table) {
    console.log("读音表未生成：网页版没有 data/pinyin-table.js，注音功能整体关闭");
    return;
  }

  // 原表是 "字:pī/yīn" 的字符串，多音字列表；直接透传，运行时按词组消歧
  const chars = table;

  // 词组表：**从网页版 js/pinyin.js 里原样取**。
  // 抄一份到构建脚本里就等于给自己留了个会漂的副本 —— 那边改了多音字规则，
  // 这边不会知道，然后同一首诗两端口音不一样。
  const words = extractWords(path.join(WEB_DIR, "js", "pinyin.js"), W);

  // 「常用字」表决定「生字」模式标哪些字：网页版是标「非常用字 + 多音字」。
  // 拿不到常用字表就退回频次判据（语料里出现 ≤2 次算生僻），虽是下策但不至于全标。
  let commonSet = {};
  if (common) {
    Object.keys(common).forEach(function (ch) { commonSet[ch] = 1; });
  } else {
    const freq = {};
    const count = function (text) {
      String(text || "").split("").forEach(function (ch) {
        if (isHan(ch)) freq[ch] = (freq[ch] || 0) + 1;
      });
    };
    Object.keys(courseTexts).forEach(function (id) { count(courseTexts[id].text); });
    Object.keys(texts).forEach(function (id) { count(texts[id].text); });
    Object.keys(freq).forEach(function (ch) {
      if (freq[ch] > 2) commonSet[ch] = 1;
    });
    console.log("常用字表缺失，生僻字改用频次判据");
  }

  writeJson(path.join(OUT_DIR, "pinyin-table.json"), {
    chars: chars,
    words: words,
    common: commonSet,
    poly: polyphones(chars)
  });

  const size = fs.statSync(path.join(OUT_DIR, "pinyin-table.json")).size;
  console.log(
    "读音表 " + Object.keys(chars).length + " 字，词组 " + Object.keys(words).length +
    " 条，常用字 " + Object.keys(commonSet).length + " 个，" +
    Math.round(size / 1024) + "KB（进主包）"
  );
}

function isHan(ch) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch);
}

/** 多音字集合：读音超过一种的字，「生字」模式下也要标 */
function polyphones(chars) {
  const out = {};
  Object.keys(chars).forEach(function (ch) {
    if (String(chars[ch]).indexOf("/") >= 0) out[ch] = true;
  });
  return out;
}

/** 从 js/pinyin.js 里抠出 WORDS 那张表。抠不到返回空表，运行时退回单字首读。 */
function extractWords(file, W) {
  if (W.Pinyin && W.Pinyin.words) return W.Pinyin.words;
  if (!fs.existsSync(file)) return {};
  const src = fs.readFileSync(file, "utf8");
  const start = src.indexOf("const WORDS = {");
  if (start < 0) return {};
  const end = src.indexOf("\n  };", start);
  const body = src.slice(start + "const WORDS = {".length, end < 0 ? src.length : end);
  try {
    return JSON.parse("{" + body.replace(/\/\*[\s\S]*?\*\//g, "") + "}");
  } catch (e) {
    console.log("词组表解析失败：" + e.message);
    return {};
  }
}

/**
 * 正文全文的倒排索引：字 → { 分片: 出现次数 }。
 *
 * 只记到「分片」这一层，不记行号与偏移。行号能把索引撑到 2-3 倍，
 * 而一片才 200KB，读进来再定位一次的开销远小于把索引做大 —— 索引本身走 CDN。
 * 课内正文不进索引：它已经在主包里，现场扫比查索引还快。
 */
function writeTextIndex(courseTexts, texts, W) {
  // writeBuckets 已经把映射写在 manifest 里，这里读回来，免得再算一遍哈希
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "texts", "manifest.json"), "utf8"));
  const postings = {};

  Object.keys(texts).forEach(function (id) {
    const payload = texts[id];
    if (!payload || !payload.text) return;
    const bucket = manifest.map[id];
    if (!bucket) return;
    String(payload.text).split("").forEach(function (ch) {
      if (!isHan(ch)) return;
      const row = postings[ch] || (postings[ch] = {});
      row[bucket] = (row[bucket] || 0) + 1;
    });
  });

  const size = Buffer.byteLength(JSON.stringify({ postings: postings }), "utf8");
  writeJson(path.join(OUT_DIR, "texts", "idx.json"), { postings: postings });
  console.log("全文倒排索引 " + Object.keys(postings).length + " 字，" + Math.round(size / 1024) + "KB（走云端）");
}

/**
 * 管理名录。
 *
 * poem 网页版有一条硬规矩（docs/auth-design.md §4.4，Issue #276）：
 * **「首次打开这个浏览器就是管理员」那种兜底已经被删掉**，理由是
 * 「清一次浏览器存储就能当管理员的所谓权限，不是权限」。
 * 小程序端照抄这条结论，所以这里的名录必须来自**服务端导入**，
 * 不是本机自己认领。
 *
 * 名单里是别人的账号标识，**不能进代码库**。所以走环境变量：
 *   POEM_ROSTER  —— JSON 数组，[{"id":"...","label":"...","tier":"max"}]，
 *                   或一行一个 `id,label,tier`
 * 没有这个变量就不生成文件，管理页如实显示「名录未导入」。
 */
function writeRoster() {
  const raw = process.env.POEM_ROSTER;
  const file = path.join(OUT_DIR, "roster.json");

  if (!raw) {
    // 空名册也要落文件：admin.js 里的 require 必须是字面量，
    // 文件时有时无会让微信的打包器直接报错 —— 那就成了「有名单才跑得起来」
    writeJson(file, { generatedAt: "", note: "未导入", users: [] });
    console.log("名录未导入：管理页只显示本机授权（要导入就设 POEM_ROSTER）");
    return;
  }

  let users = [];
  try {
    users = JSON.parse(raw);
  } catch (e) {
    users = String(raw)
      .split("\n")
      .map(function (line) { return line.trim(); })
      .filter(Boolean)
      .map(function (line) {
        const parts = line.split(",");
        return { id: parts[0].trim(), label: (parts[1] || "").trim(), tier: (parts[2] || "free").trim() };
      });
  }

  // 脱敏：名录只留一个短标签，不留完整标识 —— 这份文件要跟界面打交道
  const safe = users
    .filter(function (u) { return u && u.id; })
    .map(function (u) {
      return {
        id: String(u.id),
        label: String(u.label || u.id).slice(0, 8),
        tier: ["free", "pro", "max"].indexOf(u.tier) >= 0 ? u.tier : "free"
      };
    });

  writeJson(file, { generatedAt: new Date().toISOString().slice(0, 10), note: "", users: safe });
  console.log("名录导入 " + safe.length + " 人（构建产物，不入库）");
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

main();
