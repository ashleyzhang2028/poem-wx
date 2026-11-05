"use strict";

const fs = require("fs");
const path = require("path");
const seed = require("./corpus-seed");

const OUT_DIR = path.join(__dirname, "..", "deploy", "sql");

const BOOKS = ["shangshu", "zuozhuan", "zhanguoce"];

const BATCH = 20;

function literal(v) {
  if (typeof v === "number") return String(v);
  return "'" + String(v).split("\\").join("\\\\").split("'").join("''") + "'";
}

const COLUMNS = ["book_id", "pos", "title", "sid", "text", "translation", "translation_src"];

function inserts(rows) {
  if (!rows.length) return [];
  const out = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const body = rows.slice(i, i + BATCH).map(function (r) {
      return "  (" + COLUMNS.map(function (c) { return literal(r[c]); }).join(", ") + ")";
    });
    out.push("INSERT INTO `corpus_texts` (" + COLUMNS.map(function (c) { return "`" + c + "`"; }).join(", ") +
      ") VALUES\n" + body.join(",\n") + ";");
  }
  return out;
}

function build(rows, bookId) {
  const book = rows.books.filter(function (b) { return b.book_id === bookId; })[0];
  if (!book) throw new Error("语料里没有集子 " + bookId);
  const texts = rows.texts.filter(function (r) { return r.book_id === bookId; });
  const titles = {};
  texts.forEach(function (r) {
    titles[r.pos] = r.title;
  });
  return {
    book_id: bookId,
    name: book.name,
    total: book.total,
    rows: texts,
    sql: [
      "-- " + book.name + "（" + bookId + "）正文与译文补丁：只动 corpus_texts，目录与注释不动",
      "-- 由 node scripts/gen-catalog-texts-sql.js 生成",
      "-- 目录 " + book.total + " 篇，本补丁收正文 " + texts.length + " 篇；其余 " + (book.total - texts.length) +
        " 篇语料里没有正文，本篇不写（客户端按「没取到」处理）",
      "-- 执行前先切库：USE `poem`;",
      "",
      "SET NAMES utf8mb4;",
      "",
      "START TRANSACTION;",
      "DELETE FROM `corpus_texts` WHERE `book_id` = " + literal(bookId) + ";"
    ].concat(inserts(texts), ["", "COMMIT;"]).join("\n") + "\n"
  };
}

function main() {
  const rows = seed.seedRows(seed.loadCorpus());
  return BOOKS.map(function (bookId) {
    const built = build(rows, bookId);
    const file = path.join(OUT_DIR, "catalog-texts-" + bookId + ".sql");
    fs.writeFileSync(file, built.sql);
    built.file = path.relative(process.cwd(), file);
    return built;
  });
}

if (require.main === module) {
  main().forEach(function (b) {
    console.log(b.name + "（" + b.book_id + "）正文 " + b.rows.length + " / 目录 " + b.total + " → " + b.file);
  });
}

module.exports = { BOOKS, build, main, OUT_DIR };
