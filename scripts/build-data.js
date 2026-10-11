"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WEB_DIR = process.env.POEM_WEB_DIR || "/tmp/poem";
const OUT_DIR = path.join(__dirname, "..", "miniprogram", "data");

const BUCKET_KB = 200;

const TRANSLATION_SOURCES = {
  academic: "依据《唐诗鉴赏辞典》《宋词鉴赏辞典》等工具书的通行讲法",
  school: "依据统编版教材与教师用书课后释义",
  "public-domain": "原文属公有领域，依据公认注本与通行译注",
  modern: "依据现行通用选本与通行讲法"
};

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

      aka: p.aliases || null,

      sel: p.selection || "",
      g: p.group || p.gradeGroup || "",
      book: p.book,
      bookName: p.bookName,

      gr: p.grade || 0,
      tm: p.term || 0

    });

    if (text || translation) {

      const payload = {
        text: text,
        translation: translation,
        src: TRANSLATION_SOURCES[p.translationSource] || ""
      };
      if (p.grade || p.term) courseTexts[p.id] = payload;
      else texts[p.id] = payload;
    }
  });

  const byBook = {};
  index.forEach(function (p) {
    (byBook[p.book] = byBook[p.book] || []).push(p);
  });

  Object.keys(byBook).forEach(function (b) {

    const rows = byBook[b].map(function (p) {
      const copy = {};
      Object.keys(p).forEach(function (k) {

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

function writeBuckets(texts) {
  const dir = path.join(OUT_DIR, "texts");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const all = Object.keys(texts).sort();
  const buckets = [];
  let cur = [];
  let curSize = 0;

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

  writeJson(path.join(OUT_DIR, "shards.json"), { buckets: manifest, map: map });

  const total = manifest.reduce(function (a, b) { return a + b.kb; }, 0);
  console.log("正文分片 " + manifest.length + " 个，" + total + "KB（未压缩）");
}

function writePinyin(W, index, courseTexts, texts) {
  const table = W.PINYIN_TABLE || null;
  const common = W.COMMON_CHARS || null;

  if (!table) {
    console.log("读音表未生成：网页版没有 data/pinyin-table.js，注音功能整体关闭");
    return;
  }

  const chars = table;

  const words = extractWords(path.join(WEB_DIR, "js", "pinyin.js"), W);

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

function polyphones(chars) {
  const out = {};
  Object.keys(chars).forEach(function (ch) {
    if (String(chars[ch]).indexOf("/") >= 0) out[ch] = true;
  });
  return out;
}

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

function writeTextIndex(courseTexts, texts, W) {

  const manifest = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "shards.json"), "utf8"));
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

function writeRoster() {
  const raw = process.env.POEM_ROSTER;
  const file = path.join(OUT_DIR, "roster.json");

  if (!raw) {

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
