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
      "selection", "grade_group", "grade", "term"]
  },
  {
    table: "corpus_catalog", key: "catalog", book: true,
    cols: ["book_id", "pos", "title", "author", "note", "in_course"]
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

function clear(t, bookId) {
  return t.book && bookId ? "DELETE FROM `" + t.table + "` WHERE `book_id` = " + literal(bookId) + ";" :
    "DELETE FROM `" + t.table + "`;";
}

function statements(rows, opts) {
  const params = !!(opts && opts.params);
  if (params) return parameterized(rows);
  const bookId = (opts && opts.book) || "";
  const out = [];
  TABLES.forEach(function (t) {
    const list = rows[t.key];
    if (!list.length) return;
    out.push(clear(t, bookId));
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

function bookRows(rows, bookId) {
  const out = {};
  TABLES.forEach(function (t) {
    out[t.key] = t.book ? rows[t.key].filter(function (r) {
      return r.book_id === bookId;
    }) : [];
  });
  return out;
}

function buildBook(rows, bookId) {
  const list = bookRows(rows, bookId);
  const book = rows.books.filter(function (b) {
    return b.book_id === bookId;
  })[0];
  const body = statements(list, { book: bookId });
  return [
    "-- " + (book ? book.name : bookId) + "（" + bookId + "）单集补丁，其余 " + (rows.books.length - 1) +
      " 部不动",
    "-- 由 node scripts/gen-corpus-sql.js 生成，语句与 deploy/sql/corpus.sql 同源",
    "-- 正文与译文 " + list.texts.length + " 篇、注释 " + list.gloss.length + " 篇；执行前先切库",
    "",
    "SET NAMES utf8mb4;",
    "",
    "START TRANSACTION;"
  ].concat(body, ["", "COMMIT;"]).join("\n") + "\n";
}

const BOOKS = ["tongxin"];

if (require.main === module) {
  const rows = seed.seedRows(seed.loadCorpus());
  fs.writeFileSync(OUT, render(rows));
  BOOKS.forEach(function (bookId) {
    const out = path.join(SQL_DIR, "corpus-" + bookId + ".sql");
    fs.writeFileSync(out, buildBook(rows, bookId));
    console.log("单集补丁 → " + path.relative(process.cwd(), out));
  });
  console.log("语料入库 " + rows.books.length + " 部 / 课内 " + rows.poems.length + " 首 / 目录 " +
    rows.catalog.length + " 条 / 作者 " + rows.authors.length + " 位 / 正文与译文 " + rows.texts.length +
    " 篇 / 注释 " + rows.gloss.length + " 篇 → " + path.relative(process.cwd(), OUT));
}

module.exports = { render, statements, build, buildBook, bookRows, OUT, SQL_DIR, TABLES };
