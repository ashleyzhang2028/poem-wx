"use strict";

const fs = require("fs");
const path = require("path");
const seed = require("./corpus-seed");

const SQL_DIR = path.join(__dirname, "..", "deploy", "sql");
const OUT = path.join(SQL_DIR, "corpus.sql");

const BATCH = 400;

const TABLES = [
  { table: "corpus_books", key: "books", cols: ["book_id", "name", "unit", "page", "prefix", "kind", "pos", "total"] },
  {
    table: "corpus_poems", key: "poems",
    cols: ["id", "book_id", "pos", "title", "author", "author_alt", "dynasty", "source", "aliases",
      "selection", "grade_group", "grade", "term", "audio"]
  },
  {
    table: "corpus_catalog", key: "catalog", book: true,
    cols: ["book_id", "pos", "title", "author", "note", "in_course", "audio"]
  },
  { table: "corpus_authors", key: "authors", cols: ["name", "era", "era_at"] },
  {
    table: "corpus_texts", key: "texts", batch: 40, book: true,
    cols: ["book_id", "pos", "title", "sid", "text", "translation", "translation_src"]
  },
  { table: "corpus_gloss", key: "gloss", batch: 40, book: true, cols: ["book_id", "pos", "title", "gloss"] }
];

function literal(v) {
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) v = JSON.stringify(v);
  return "'" + String(v).split("\\").join("\\\\").split("'").join("''") + "'";
}

function clear(t, bookId, only) {
  if (!(t.book && bookId)) return "DELETE FROM `" + t.table + "`;";
  if (!only) return "DELETE FROM `" + t.table + "` WHERE `book_id` = " + literal(bookId) + ";";
  return "DELETE FROM `" + t.table + "` WHERE `book_id` = " + literal(bookId) +
    " AND `pos` IN (" + only.slice().sort(function (a, b) { return a - b; }).join(", ") + ");";
}

function statements(rows, opts) {
  const params = !!(opts && opts.params);
  if (params) return parameterized(rows);
  const bookId = (opts && opts.book) || "";
  const only = (opts && opts.only) || null;
  const out = [];
  TABLES.forEach(function (t) {
    const list = rows[t.key];
    if (!list.length) return;
    out.push(clear(t, bookId, only));
    const step = t.batch || BATCH;
    for (let i = 0; i < list.length; i += step) {
      const body = list.slice(i, i + step).map(function (r) {
        return "  (" + t.cols.map(function (c) { return literal(r[c]); }).join(", ") + ")";
      });
      out.push("INSERT INTO `" + t.table + "` (" + t.cols.map(function (c) { return "`" + c + "`"; }).join(", ") +
        ") VALUES\n" + body.join(",\n") + ";");
    }
  });
  return out;
}

function placeholders(cols) {
  return cols.map(function () {
    return "?";
  });
}

function parameterized(rows) {
  const out = [];
  TABLES.forEach(function (t) {
    out.push({ sql: clear(t), params: [] });
    const list = rows[t.key];
    const step = t.batch || BATCH;
    for (let i = 0; i < list.length; i += step) {
      const slice = list.slice(i, i + step);
      const marks = "  (" + placeholders(t.cols).join(", ") + ")";
      const body = slice.map(function () {
        return marks;
      });
      const params = [];
      slice.forEach(function (r) {
        t.cols.forEach(function (c) {
          const v = r[c];
          params.push(Array.isArray(v) ? JSON.stringify(v) : (typeof v === "number" ? v : String(v == null ? "" : v)));
        });
      });
      out.push({
        sql: "INSERT INTO `" + t.table + "` (" + t.cols.map(function (c) { return "`" + c + "`"; }).join(", ") +
          ") VALUES\n" + body.join(",\n") + ";",
        params: params
      });
    }
  });
  return out;
}

function render(rows, opts) {
  return statements(rows, opts).join("\n") + "\n";
}

function build() {
  return render(seed.seedRows(seed.loadCorpus()));
}

function bookRows(rows, bookId, only) {
  const out = {};
  TABLES.forEach(function (t) {
    out[t.key] = t.book ? rows[t.key].filter(function (r) {
      if (r.book_id !== bookId) return false;
      return !only || only.indexOf(r.pos) >= 0;
    }) : [];
  });
  return out;
}

function updateBook(rows, bookId) {
  const list = rows.catalog.filter(function (r) { return r.book_id === bookId && r.audio; });
  if (!list.length) return [];
  const body = list.map(function (r) {
    return "  (" + [literal(bookId), r.pos, literal(r.audio)].join(", ") + ")";
  });
  return ["INSERT INTO `corpus_catalog` (`book_id`, `pos`, `audio`) VALUES\n" + body.join(",\n") +
    "\nON DUPLICATE KEY UPDATE `audio` = VALUES(`audio`);"];
}

function writeAudio(rows) {
  const poem = rows.poems.map(function (r) {
    return "  (" + [literal(r.id), literal(r.audio)].join(", ") + ")";
  });
  let out = [
    "-- 朗读文件名补丁：只改 corpus_poems / corpus_catalog 的 audio 一列，篇目、正文、注释一个不动",
    "-- 由 node scripts/gen-corpus-sql.js 从 audio/*_map.md 生成，重跑语料 SQL 也会写入同样的值",
    "-- 执行前先切库",
    "",
    "SET NAMES utf8mb4;",
    "",
    "START TRANSACTION;",
    "INSERT INTO `corpus_poems` (`id`, `audio`) VALUES"
  ];
  poem.forEach(function (line, i) {
    const tail = i === poem.length - 1 ? ";" : ",";
    out.push(line + tail);
  });
  out.push("ON DUPLICATE KEY UPDATE `audio` = VALUES(`audio`);");
  out.push("");
  BOOKS.forEach(function (bookId) {
    out = out.concat(updateBook(rows, bookId), [""]);
  });
  out.push("COMMIT;");
  return out.join("\n") + "\n";
}

function buildBook(rows, bookId, only) {
  const list = bookRows(rows, bookId, only);
  const book = rows.books.filter(function (b) {
    return b.book_id === bookId;
  })[0];
  const body = statements(list, { book: bookId, only: only });
  const range = only ? bookRange(bookId) : null;
  return [
    "-- " + (book ? book.name : bookId) + "（" + bookId + "）单集补丁，其余 " + (rows.books.length - 1) +
      " 部不动",
    "-- 由 node scripts/gen-corpus-sql.js 生成，语句与 deploy/sql/corpus.sql 同源",
    "-- 目录与索引 " + list.catalog.length + " 条、正文与译文 " + list.texts.length + " 篇、注释 " +
      list.gloss.length + " 篇；执行前先切库",
    "-- corpus_poems / corpus_catalog 的 audio 一列不在本文件里：整表重灌会把它冲成空串，",
    "-- 要连朗读一起重灌就跑 deploy/sql/corpus-audio.sql（同样由本脚本生成）",
    range ? "-- 只重灌第 " + range[0] + "–" + range[1] + " 条（改订过的篇目）：别的条目与别的集子一个不动" : ''
  ].filter(function (line) { return line !== ''; }).concat(["", "SET NAMES utf8mb4;", "", "START TRANSACTION;", ""], body, ["", "COMMIT;"]).join("\n") + "\n";
}

function bookRange(bookId) {
  const patch = require("./corpus-patch")[bookId];
  if (!patch) return null;
  return [Math.min.apply(null, patch), Math.max.apply(null, patch)];
}

const BOOKS = ["tangshi300", "songci300", "tongxin"];

if (require.main === module) {
  const rows = seed.seedRows(seed.loadCorpus());
  fs.writeFileSync(OUT, render(rows));
  BOOKS.forEach(function (bookId) {
    const out = path.join(SQL_DIR, "corpus-" + bookId + ".sql");
    fs.writeFileSync(out, buildBook(rows, bookId, require("./corpus-patch")[bookId]));
    console.log("单集补丁 → " + path.relative(process.cwd(), out));
  });
  const audio = path.join(SQL_DIR, "corpus-audio.sql");
  fs.writeFileSync(audio, writeAudio(rows));
  console.log("朗读文件名 → " + path.relative(process.cwd(), audio));
  console.log("语料入库 " + rows.books.length + " 部 / 课内 " + rows.poems.length + " 首 / 目录 " +
    rows.catalog.length + " 条 / 作者 " + rows.authors.length + " 位 / 正文与译文 " + rows.texts.length +
    " 篇 / 注释 " + rows.gloss.length + " 篇 → " + path.relative(process.cwd(), OUT));
}

module.exports = { render, statements, build, buildBook, bookRows, writeAudio, OUT, SQL_DIR, TABLES };
