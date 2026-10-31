"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CORPUS_DIR = path.join(__dirname, "corpus");

const COURSE_BOOK = "poems";

const EMPTY_BOOKS = [
  "classic", "yuefu", "season", "tangshi", "gushi", "songci", "yuanqu",
  "guwen", "jinxiandai", "zhaoming", "chengyu", "changshi", "mingshu",
  "mingren", "mingren-waiguo", "dwang", "dwang-waiguo"
];

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
  "data/catalog-texts.js",
  "data/catalog-notes.js",
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
  (rels || POEM_FILES).forEach(function (rel) {
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

function courseIndex(W) {
  const out = [];
  (W.SITE_INDEX || []).forEach(function (p) {
    if (p.isBook || p.book !== COURSE_BOOK) return;
    out.push({
      source: p,
      row: {
        id: p.id,
        title: p.title,
        author: p.authorName || p.author || "",
        author_alt: p.authorName && p.authorName !== p.author ? p.author : "",
        dynasty: p.dynasty || "",
        source: p.source || "",
        aliases: p.aliases && p.aliases.length ? JSON.stringify(p.aliases) : "",
        selection: p.selection || "",
        grade_group: p.group || p.gradeGroup || "",
        grade: p.grade || 0,
        term: p.term || 0
      }
    });
  });
  return out;
}

function catalogKey(title, author) {
  return (title || "").trim() + "\u0000" + (author || "").trim();
}

function courseKeys(rows) {
  const keys = {};
  rows.forEach(function (r) {
    const who = r.author || r.author_alt;
    keys[catalogKey(r.title, who)] = true;
    if (r.aliases) JSON.parse(r.aliases).forEach(function (name) { keys[catalogKey(name, who)] = true; });
  });
  return keys;
}

function authorEras(W) {
  const roster = W.SITE_ROSTER || null;
  if (!roster || !roster.length) throw noCorpus(path.join(CORPUS_DIR, "data", "site-roster.js"));
  const eras = W.AuthorIndex ? W.AuthorIndex.eras() : [];
  const meta = Object.create(null);
  roster.forEach(function (row) {
    const hit = eras.filter(function (e) { return e.at === row[0]; })[0];
    const era = hit ? hit.name : String(row[0]);
    row[1].forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(meta, name)) meta[name] = { era: era, at: row[0] };
    });
  });
  return meta;
}

function seedRows(W) {
  const catalogs = W.SITE_CATALOGS || null;
  const order = W.SITE_CATALOG_ORDER || [];
  if (!catalogs) throw noCorpus(path.join(CORPUS_DIR, "data", "site-catalogs.js"));

  const courseBooks = (W.SITE_BOOKS || []).filter(function (b) { return EMPTY_BOOKS.indexOf(b.id) < 0; });
  const poems = courseIndex(W).map(function (x, pos) {
    return Object.assign({ book_id: COURSE_BOOK, pos: pos }, x.row);
  });
  const inCourse = courseKeys(poems);

  const books = courseBooks.map(function (b, pos) {
    return {
      book_id: b.id, name: b.name, unit: b.unit, page: b.page, prefix: "", kind: "course",
      pos: pos, total: b.id === COURSE_BOOK ? poems.length : 0
    };
  });
  const catalog = [];
  order.forEach(function (bookId, i) {
    const c = catalogs[bookId];
    if (!c || !c.rows || !c.rows.length) {
      throw new Error("集子 " + bookId + " 在 data/site-catalogs.js 里没有 rows");
    }
    books.push({
      book_id: bookId, name: c.name, unit: c.unit, page: "/pages/list/list?book=" + bookId,
      prefix: String(c.src).replace(/s$/, ""), kind: "catalog",
      pos: courseBooks.length + i, total: c.rows.length
    });
    c.rows.forEach(function (r, pos) {
      catalog.push({
        book_id: bookId, pos: pos, title: r[0], author: r[1] || "", note: r[2] || "",
        in_course: inCourse[catalogKey(r[0], r[1])] ? 1 : 0
      });
    });
  });

  const meta = authorEras(W);
  const authors = Object.keys(meta).map(function (name) {
    return { name: name, era: meta[name].era, era_at: meta[name].at };
  });

  return { books: books, poems: poems, catalog: catalog, authors: authors, texts: catalogTexts(catalogs, order), gloss: catalogGloss(catalogs, order, W) };
}

function catalogTexts(catalogs, order) {
  const source = (loadCorpus(["data/catalog-texts.js"]).CATALOG_TEXTS) || {};
  const out = [];
  Object.keys(source).forEach(function (bookId) {
    if (order.indexOf(bookId) < 0) throw new Error("正文绑在了不在目录里的集子：" + bookId);
    const rows = (catalogs[bookId] || {}).rows || [];
    source[bookId].forEach(function (r) {
      const pos = Number(r[0]);
      if (!(pos >= 1 && pos <= rows.length)) {
        throw new Error(bookId + " 第 " + pos + " 条不在目录里（目录共 " + rows.length + " 条）");
      }
      out.push({ book_id: bookId, pos: pos, title: rows[pos - 1][0], sid: r[1], text: r[3], translation: r[4], translation_src: r[2] || "" });
    });
  });
  return out;
}

function catalogGloss(catalogs, order, W) {
  const source = W.CATALOG_NOTES || {};
  const out = [];
  Object.keys(source).forEach(function (bookId) {
    if (order.indexOf(bookId) < 0) throw new Error("注释挂在了不在目录里的集子：" + bookId);
    const rows = (catalogs[bookId] || {}).rows || [];
    const mine = source[bookId] || {};
    Object.keys(mine).forEach(function (key) {
      const pos = Number(key);
      if (!(pos >= 1 && pos <= rows.length)) {
        throw new Error(bookId + " 第 " + pos + " 条的注释不在目录里（目录共 " + rows.length + " 条）");
      }
      out.push({ book_id: bookId, pos: pos, title: rows[pos - 1][0], gloss: mine[key] });
    });
  });
  return out;
}

function seedStatements(rows) {
  return require("./gen-corpus-sql").statements(rows, { params: true });
}

module.exports = {
  seedStatements: seedStatements,
  CORPUS_DIR: CORPUS_DIR,
  COURSE_BOOK: COURSE_BOOK,
  POEM_FILES: POEM_FILES,
  noCorpus: noCorpus,
  loadCorpus: loadCorpus,
  courseIndex: courseIndex,
  seedRows: seedRows
};
