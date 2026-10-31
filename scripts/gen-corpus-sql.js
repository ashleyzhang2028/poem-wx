"use strict";

const fs = require("fs");
const path = require("path");
const seed = require("./corpus-seed");

const OUT = path.join(__dirname, "..", "deploy", "sql", "corpus.sql");

const BATCH = 400;

const TABLES = [
  { table: "corpus_books", key: "books", cols: ["book_id", "name", "unit", "page", "prefix", "kind", "pos", "total"] },
  {
    table: "corpus_poems", key: "poems",
    cols: ["id", "book_id", "pos", "title", "author", "author_alt", "dynasty", "source", "aliases",
      "selection", "grade_group", "grade", "term"]
  },
  { table: "corpus_catalog", key: "catalog", cols: ["book_id", "pos", "title", "author", "note", "in_course"] },
  { table: "corpus_authors", key: "authors", cols: ["name", "era", "era_at"] },
  {
    table: "corpus_texts", key: "texts", batch: 40,
    cols: ["book_id", "pos", "title", "sid", "text", "translation", "translation_src"]
  },
  { table: "corpus_gloss", key: "gloss", batch: 40, cols: ["book_id", "pos", "title", "gloss"] }
];

function literal(v) {
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) v = JSON.stringify(v);
  return "'" + String(v).split("\\").join("\\\\").split("'").join("''") + "'";
}

function statements(rows, opts) {
  const params = !!(opts && opts.params);
  if (params) return parameterized(rows);
  const out = [];
  TABLES.forEach(function (t) {
    out.push("DELETE FROM `" + t.table + "`;");
    const list = rows[t.key];
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

function placeholders(row, cols) {
  return cols.map(function (c) {
    return typeof row[c] === "number" ? String(row[c]) : "?";
  });
}

function parameterized(rows) {
  const out = [];
  TABLES.forEach(function (t) {
    out.push({ sql: "DELETE FROM `" + t.table + "`;", params: [] });
    const list = rows[t.key];
    const step = t.batch || BATCH;
    for (let i = 0; i < list.length; i += step) {
      const slice = list.slice(i, i + step);
      const body = slice.map(function (r) {
        return "  (" + placeholders(r, t.cols).join(", ") + ")";
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

function render(rows) {
  return statements(rows).join("\n") + "\n";
}

function build() {
  return render(seed.seedRows(seed.loadCorpus()));
}

if (require.main === module) {
  const sql = build();
  fs.writeFileSync(OUT, sql);
  const rows = seed.seedRows(seed.loadCorpus());
  console.log("语料入库 " + rows.books.length + " 部 / 课内 " + rows.poems.length + " 首 / 目录 " +
    rows.catalog.length + " 条 / 作者 " + rows.authors.length + " 位 / 正文与译文 " + rows.texts.length +
    " 篇 / 注释 " + rows.gloss.length + " 篇 → " + path.relative(process.cwd(), OUT));
}

module.exports = { render, statements, build, OUT, TABLES };
