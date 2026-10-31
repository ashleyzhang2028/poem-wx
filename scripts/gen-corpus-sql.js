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
  { table: "corpus_authors", key: "authors", cols: ["name", "era", "era_at"] }
];

function literal(v) {
  if (typeof v === "number") return String(v);
  return "'" + String(v).split("\\").join("\\\\").split("'").join("''") + "'";
}

function render(rows) {
  const out = [];
  TABLES.forEach(function (t) {
    out.push("DELETE FROM `" + t.table + "`;");
    const list = rows[t.key];
    for (let i = 0; i < list.length; i += BATCH) {
      const body = list.slice(i, i + BATCH).map(function (r) {
        return "  (" + t.cols.map(function (c) { return literal(r[c]); }).join(", ") + ")";
      });
      out.push("INSERT INTO `" + t.table + "` (" + t.cols.map(function (c) { return "`" + c + "`"; }).join(", ") +
        ") VALUES\n" + body.join(",\n") + ";");
    }
  });
  return out.join("\n") + "\n";
}

function build() {
  return render(seed.seedRows(seed.loadCorpus()));
}

if (require.main === module) {
  const sql = build();
  fs.writeFileSync(OUT, sql);
  const rows = seed.seedRows(seed.loadCorpus());
  console.log("语料入库 " + rows.books.length + " 部 / 课内 " + rows.poems.length + " 首 / 目录 " +
    rows.catalog.length + " 条 / 作者 " + rows.authors.length + " 位 → " + path.relative(process.cwd(), OUT));
}

module.exports = { render, build, OUT, TABLES };
