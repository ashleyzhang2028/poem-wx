"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CORPUS_DIR = path.join(__dirname, "corpus");
const OUT_DIR = path.join(__dirname, "..", "miniprogram", "data");

const STALE = ["texts", "shards.js"];

const SERVER_FILE = path.join(__dirname, "..", "miniprogram", "utils", "server.js");

const SERVER_KEYS = ["env", "service"];

const COURSE_BOOK = "poems";

const EMPTY_BOOKS = [
  "classic", "yuefu", "season", "tangshi", "gushi", "songci", "yuanqu",
  "guwen", "jinxiandai", "zhaoming", "chengyu", "changshi", "mingshu",
  "mingren", "mingren-waiguo", "dwang", "dwang-waiguo"
];

const TRANSLATION_SOURCES = {
  academic: "依据《唐诗鉴赏辞典》《宋词鉴赏辞典》等工具书的通行讲法",
  school: "依据统编版教材与教师用书课后释义",
  "public-domain": "原文属公有领域，依据公认注本与通行译注",
  modern: "依据现行通用选本与通行讲法"
};

const POEM_FILES = [
  "data/poems-1.js", "data/poems-2.js", "data/poems-3.js", "data/poems-4.js",
  "data/poems-5.js", "data/poems-6.js", "data/poems-7.js", "data/poems-8.js",
  "data/poems-9.js", "data/poems-10.js", "data/poems-11.js", "data/poems-12.js",
  "data/text-master.js",
  "data/poems-classic.js", "data/poems-yuefu.js",
  "data/poems-tangshi.js",
  "data/poems-gushi.js", "data/poems-songci.js", "data/poems-yuanqu.js",
  "data/poems-guwen.js", "data/poems-jinxiandai.js", "data/poems-zhaoming.js",
  "data/poems-chengyu.js", "data/poems-changshi.js", "data/poems-mingshu.js",
  "data/poems-mingren-cn.js", "data/poems-mingren-foreign.js",
  "data/poems-emperor-cn.js", "data/poems-emperor-waiguo.js",
  "data/group-order.js",
  "data/index.js",
  "data/site-books.js",
  "data/site-index.js",
  "data/site-catalogs.js",
  "data/site-roster.js",
  "data/author-index.js",
  "data/gloss-notes.js",
  "data/common-chars.js",
  "data/pinyin-table.js"
];

function noCorpus(file) {
  return new Error(
    "读不到 " + file + " —— 语料是本仓库的一部分，缺了说明 scripts/corpus/ 不完整，\n" +
    "把 poem 那一版的 data/ 与 js/ 整份拷回来即可（见 docs/from-corpus-to-page.md § 二）。"
  );
}

function loadCorpus(rels) {
  const sandbox = { window: {}, console: console, Date: Date, JSON: JSON };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = undefined;
  vm.createContext(sandbox);
  rels.forEach(function (rel) {
    const file = path.join(CORPUS_DIR, rel);
    let src;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch (e) {
      throw noCorpus(file);
    }
    vm.runInContext(src, sandbox, { filename: rel });
  });
  return sandbox.window;
}

function main() {

  const W = loadCorpus(POEM_FILES);

  const master = W.TEXT_MASTER || [];
  if (!master.length) throw noCorpus(path.join(CORPUS_DIR, "data", "text-master.js"));

  const byId = {};
  master.forEach(function (m) {
    byId[m.id] = m;
    (m.entries || []).forEach(function (e) { if (!byId[e]) byId[e] = m; });
  });

  const siteIndex = W.SITE_INDEX || [];
  const books = (W.SITE_BOOKS || []).filter(function (b) {
    return EMPTY_BOOKS.indexOf(b.id) < 0;
  });

  const notes = W.GLOSS_NOTES || {};

  const index = [];
  const courseTexts = {};

  siteIndex.forEach(function (p) {
    if (p.isBook) return;
    if (p.book !== COURSE_BOOK) return;

    const m = byId[p.id] || byId[p.originId] || null;
    const text = p.text || (m && m.text) || "";
    const translation = p.translation || (m && m.translation) || "";

    index.push({
      id: p.id,
      t: p.title,
      a: p.authorName || p.author || "",
      an: p.authorName && p.authorName !== p.author ? p.author : "",
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
      const entry = {
        text: text,
        translation: translation,
        src: TRANSLATION_SOURCES[p.translationSource] || ""
      };
      if (notes[p.id]) entry.gloss = notes[p.id];
      courseTexts[p.id] = entry;
    }
  });

  const byBook = {};
  index.forEach(function (p) {
    (byBook[p.book] = byBook[p.book] || []).push(p);
  });

  dropStale();
  writeBookIndex(byBook);
  const catalogs = writeCatalogs(W, index);

  writeModule(path.join(OUT_DIR, "books", "books.js"), books.concat(catalogs));

  writeModule(path.join(OUT_DIR, "course.js"), courseTexts);
  writePinyin(W, courseTexts);
  writeRosterExtra(W);
  writeRoster();
  writeServer();

  console.log("索引 " + index.length + " 条");
  const courseKb = Math.round(fs.statSync(path.join(OUT_DIR, "course.js")).size / 1024);
  console.log("课内正文 " + Object.keys(courseTexts).length + " 条进主包，course.js " + courseKb + "KB");
  const noted = Object.keys(courseTexts).filter(function (id) { return courseTexts[id].gloss; });
  const noteCount = noted.reduce(function (n, id) { return n + courseTexts[id].gloss.length; }, 0);
  console.log("生字生词注释 " + noted.length + " 篇 " + noteCount + " 条");
}

function dropStale() {
  STALE.forEach(function (name) {
    fs.rmSync(path.join(OUT_DIR, name), { recursive: true, force: true });
  });
}

function packBooks(byBook) {
  const dict = { d: [], g: [], sel: [], s: [] };
  const shared = {};
  const put = function (key, v) {
    if (!v) return -1;
    const at = shared[key + "\u0000" + v];
    if (at !== undefined) return at;
    dict[key].push(v);
    return (shared[key + "\u0000" + v] = dict[key].length - 1);
  };

  const books = {};
  const rows = {};

  Object.keys(byBook).forEach(function (b) {
    books[b] = byBook[b].length;
    rows[b] = byBook[b].map(function (p) {
      return [
        p.id,
        p.t,
        p.a || p.an || null,
        put("d", p.d),
        put("s", p.s),
        put("g", p.g),
        put("sel", p.sel),
        p.gr || 0,
        p.tm || 0,
        p.an || null,
        p.aka && p.aka.length ? p.aka : null
      ];
    });
  });

  writeModule(path.join(OUT_DIR, "books", "index.js"), { dict: dict, books: books, rows: rows });
  return Object.keys(books);
}

function writeBookIndex(byBook) {
  const books = packBooks(byBook);
  const dir = path.join(OUT_DIR, "books");

  fs.readdirSync(dir).forEach(function (f) {
    if (/^index\.js$/.test(f) || /^books\.js$/.test(f)) return;
    fs.rmSync(path.join(dir, f));
  });

  console.log("集子索引 " + books.join(" / ") + "，" +
    Math.round(fs.statSync(path.join(dir, "index.js")).size / 1024) + "KB");
}

function catalogKey(title, author) {
  return (title || "").trim() + "\u0000" + (author || "").trim();
}

function courseKeys(courseRows) {
  const keys = {};
  courseRows.forEach(function (p) {
    keys[catalogKey(p.t, p.a || p.an)] = true;
    if (p.aka) p.aka.forEach(function (name) { keys[catalogKey(name, p.a || p.an)] = true; });
  });
  return keys;
}

function writeCatalogs(W, courseRows) {
  const catalogs = W.SITE_CATALOGS || null;
  const order = W.SITE_CATALOG_ORDER || [];
  if (!catalogs) throw noCorpus(path.join(CORPUS_DIR, "data", "site-catalogs.js"));

  const dict = { a: [], d: [] };
  const shared = {};
  const put = function (key, v) {
    if (!v) return -1;
    const at = shared[key + "\u0000" + v];
    if (at !== undefined) return at;
    dict[key].push(v);
    return (shared[key + "\u0000" + v] = dict[key].length - 1);
  };

  const books = [];
  const rows = {};
  const prefixes = [];
  const inCourse = courseKeys(courseRows || []);
  let courseHits = 0;

  order.forEach(function (bookId) {
    const c = catalogs[bookId];
    if (!c || !c.rows || !c.rows.length) {
      throw new Error("集子 " + bookId + " 在 data/site-catalogs.js 里没有 rows");
    }
    const prefix = String(c.src).replace(/s$/, "");
    prefixes.push(prefix);
    rows[bookId] = c.rows.map(function (r, i) {
      const hit = inCourse[catalogKey(r[0], r[1])] ? 1 : 0;
      if (hit) courseHits += 1;
      return [r[0], put("a", r[1]), put("d", r[2]), hit];
    });
    books.push({ id: bookId, name: c.name, unit: c.unit, count: c.rows.length });
  });

  const drifted = order.filter(function (bookId, i) { return prefixes[i] !== bookId; });

  writeModule(path.join(OUT_DIR, "books", "catalogs.js"), {
    books: books, rows: rows, prefixes: prefixes, dict: dict, drifted: drifted
  });


  const total = books.reduce(function (n, b) { return n + b.count; }, 0);
  console.log("集子目录 " + books.length + " 部 " + total + " 条（其中课内 " + courseHits + " 条），" +
    Math.round(fs.statSync(path.join(OUT_DIR, "books", "catalogs.js")).size / 1024) + "KB");

  return books.map(function (b) {
    return { id: b.id, name: b.name, page: "/pages/list/list?book=" + b.id, unit: b.unit };
  });
}

function writePinyin(W, courseTexts) {
  const table = W.PINYIN_TABLE || null;

  if (!table) {
    console.log("读音表未生成：网页版没有 data/pinyin-table.js，注音功能整体关闭");
    return;
  }

  const chars = table;

  const words = extractWords(path.join(CORPUS_DIR, "js", "pinyin.js"), W);

  const commonSet = {};
  const freq = {};
  Object.keys(courseTexts).forEach(function (id) {
    String(courseTexts[id].text || "").split("").forEach(function (ch) {
      if (isHan(ch)) freq[ch] = (freq[ch] || 0) + 1;
    });
  });
  Object.keys(freq).forEach(function (ch) {
    if (freq[ch] > 2) commonSet[ch] = 1;
  });

  writeModule(path.join(OUT_DIR, "pinyin-table.js"), {
    chars: chars,
    words: words,
    common: commonSet,
    poly: polyphones(chars)
  });

  const size = fs.statSync(path.join(OUT_DIR, "pinyin-table.js")).size;
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

function writeRosterExtra(W) {
  const roster = W.SITE_ROSTER || null;
  if (!roster || !roster.length) {
    throw noCorpus(path.join(CORPUS_DIR, "data", "site-roster.js"));
  }

  const meta = Object.create(null);
  roster.forEach(function (row) {
    const hit = (W.AuthorIndex ? W.AuthorIndex.eras() : []).filter(function (e) {
      return e.at === row[0];
    })[0];
    const era = hit ? hit.name : String(row[0]);
    row[1].forEach(function (n) {
      if (!Object.prototype.hasOwnProperty.call(meta, n)) meta[n] = { era: era, at: row[0] };
    });
  });

  writeModule(path.join(OUT_DIR, "roster-extra.js"), { era: meta });
  console.log("名册补充 " + Object.keys(meta).length + " 位，" +
    Math.round(fs.statSync(path.join(OUT_DIR, "roster-extra.js")).size / 1024) + "KB");
}

function writeRoster() {
  const raw = process.env.POEM_ROSTER;
  const file = path.join(OUT_DIR, "roster.js");

  if (!raw) {

    writeModule(file, { generatedAt: "", note: "未导入", users: [] });
    console.log("名录未导入：用户列表只显示本机授权（要导入就设 POEM_ROSTER）");
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

  writeModule(file, { generatedAt: new Date().toISOString().slice(0, 10), note: "", users: safe });
  console.log("名录导入 " + safe.length + " 人（构建产物，不入库）");
}

function writeServer() {
  const values = { env: String(process.env.CLOUD_ENV || "").trim(), service: String(process.env.CLOUD_SERVICE || "").trim() };
  const filled = SERVER_KEYS.filter(function (k) { return values[k]; });

  if (!filled.length) {
    if (!fs.existsSync(SERVER_FILE)) {
      throw new Error(
        "miniprogram/utils/server.js 不在，而 CLOUD_ENV / CLOUD_SERVICE 也没设 —— 两头都空。\n" +
        "这个文件是**入库的空壳**（构建期只改它的值），少了它 remote.js 整条 require 链断掉，\n" +
        "首页会在 onLoad 前就 MODULE_NOT_FOUND。把它从 git 里捡回来再跑构建。"
      );
    }
    console.log("没注入云调用两栏（CLOUD_ENV / CLOUD_SERVICE 都没设）：这个包没配同步服务器");
    return;
  }

  const body = SERVER_KEYS.map(function (k) {
    return "  " + k + ": " + JSON.stringify(values[k]) + ",";
  }).join("\n").replace(/,$/, "");

  fs.writeFileSync(SERVER_FILE,
    "const CLOUD = {\n" + body + "\n};\n" +
    "\n" +
    "function cloud() {\n" +
    "  if (!CLOUD.env || !CLOUD.service) return null;\n" +
    "  return { env: CLOUD.env, service: CLOUD.service };\n" +
    "}\n" +
    "\n" +
    "module.exports = { cloud };\n");

  if (filled.length === SERVER_KEYS.length) {
    console.log("云调用两栏已注入 server.js：" + values.env + " / " + values.service);
  } else {
    console.log("云调用两栏只注入了 " + filled.join(" / ") + " —— " +
      SERVER_KEYS.filter(function (k) { return !values[k]; }).join(" / ") + " 是空的，" +
      "这个包仍算没配服务器");
  }
}

function writeModule(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "module.exports = " + JSON.stringify(data) + ";\n");
  fs.rmSync(file.replace(/\.js$/, ".json"), { force: true });
}

main();
