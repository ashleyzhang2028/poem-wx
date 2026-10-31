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
  fs.writeFileSync(OUT, "(function () {\n  \"use strict\";\n\n  window.CATALOG_NOTES = " +
    JSON.stringify(notes, null, 2).replace(/\n/g, "\n  ") + ";\n})();\n");
}

main();
