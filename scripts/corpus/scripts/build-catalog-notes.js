"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const seed = require("../../corpus-seed");

const OUT = path.join(seed.CORPUS_DIR, "data", "catalog-notes.js");

function load(rel) {
  const file = path.join(seed.CORPUS_DIR, rel);
  if (!fs.existsSync(file)) throw seed.noCorpus(file);
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: rel });
  return sandbox.window;
}

function mergeBySid(texts, notes) {
  const merged = load("data/catalog-notes.js").CATALOG_NOTES || {};
  Object.keys(merged).forEach(function (book) {
    const bySid = {};
    (texts[book] || []).forEach(function (r) {
      const sid = String(r[1] || "");
      if (sid) (bySid[sid] = bySid[sid] || []).push(String(r[0]));
    });
    Object.keys(bySid).forEach(function (sid) {
      const same = bySid[sid];
      if (same.length < 2) return;
      const want = [];
      same.forEach(function (pos) {
        const list = (merged[book] || {})[pos] || [];
        list.forEach(function (it) {
          const word = String(it[0] || "").trim();
          if (word && !want.filter(function (w) { return w[0] === word; }).length) want.push(it);
        });
      });
      same.forEach(function (pos) {
        const list = merged[book] && merged[book][pos];
        if (!list) return;
        const have = {};
        list.forEach(function (it) { have[String(it[0] || "").trim()] = true; });
        want.forEach(function (it) {
          const word = String(it[0] || "").trim();
          if (!have[word]) list.push([word, it[1]]);
        });
      });
    });
  });
  Object.keys(merged).forEach(function (book) {
    if (notes[book] === null || notes[book] === undefined) return;
    notes[book] = merged[book] || {};
  });
}

function main() {
  const texts = load("data/catalog-texts.js").CATALOG_TEXTS || {};
  const W = seed.loadCorpus();

  const gaps = [];
  Object.keys(texts).forEach(function (book) {
    const total = (W.SITE_CATALOGS[book] || {}).rows || [];
    const got = texts[book].length;
    if (got !== total.length) {
      gaps.push(book + " 缺 " + (total.length - got) + " 篇（已收 " + got + " / " + total.length + "）");
    }
  });

  console.log(gaps.length ? gaps.join("；") : "三个集子的正文与译文齐了");

  const notes = {};
  Object.keys(texts).forEach(function (book) {
    notes[book] = texts[book].length ? {} : null;
  });
  mergeBySid(texts, notes);
  fs.writeFileSync(OUT, "(function () {\n  \"use strict\";\n\n  window.CATALOG_NOTES = " +
    JSON.stringify(notes, null, 2).replace(/\n/g, "\n  ") + ";\n})();\n");
}

main();
