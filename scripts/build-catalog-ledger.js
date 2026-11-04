"use strict";

const fs = require("fs");
const path = require("path");
const seed = require("./corpus-seed");

const OUT = path.join(__dirname, "..", "miniprogram", "data", "catalog-ledger.js");

const IN_INDEX = ["tangshi300", "songci300"];

function main() {
  const W = seed.loadCorpus();
  const rows = seed.seedRows(W);
  const cats = W.SITE_CATALOGS || {};

  const byOrigin = {};
  (W.SITE_INDEX || []).forEach(function (p) {
    if (p.isBook || !p.originId) return;
    byOrigin[p.book + "|" + p.originId] = p;
  });

  const books = {};
  Object.keys(cats).forEach(function (id) {
    books[id] = { count: cats[id].rows.length };
  });

  const sidOf = {};
  rows.texts.forEach(function (t) {
    if (IN_INDEX.indexOf(t.book_id) < 0) return;
    if (!sidOf[t.book_id]) sidOf[t.book_id] = {};
    sidOf[t.book_id][t.pos] = t.sid;
  });

  const texts = {};
  IN_INDEX.forEach(function (book) {
    Object.keys(sidOf[book] || {}).forEach(function (pos) {
      const origin = String(sidOf[book][pos]).split("-").slice(1).join("-");
      const hit = byOrigin["tangshi|" + origin] || byOrigin["songci|" + origin];
      if (!hit || !hit.text) return;
      texts[book + "-" + pos] = hit.text;
    });
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, "module.exports = " + JSON.stringify({ books: books, texts: texts }) + ";\n");
  console.log("集子台账 " + Object.keys(books).length + " 部，选集正文 " + Object.keys(texts).length + " 条入库");
}

main();
