"use strict";

const fs = require("fs");
const path = require("path");
const seed = require("../../corpus-seed");

const OUT = path.join(seed.CORPUS_DIR, "data", "catalog-texts.js");

const SOURCE_BOOK = {
  tangshi300: "POEMS_TANGSHI",
  songci300: "POEMS_SONGCI",
  gwgz: "POEMS_GUWEN"
};

const NOISE = /[\s\u3000·・・,，.。、!！?？:：;；'"“”‘’()（）\[\]【】《》<>—－-]/g;

function norm(s) {
  return String(s == null ? "" : s).replace(NOISE, "");
}

function loaded(rel) {
  return path.join(seed.CORPUS_DIR, rel);
}

function required(rel) {
  const file = loaded(rel);
  if (!fs.existsSync(file)) throw seed.noCorpus(file);
  return fs.readFileSync(file, "utf8");
}

function main() {
  const W = seed.loadCorpus();
  const byId = {};
  (W.TEXT_MASTER || []).forEach(function (m) {
    byId[m.id] = m;
    (m.entries || []).forEach(function (e) {
      if (!byId[e]) byId[e] = m;
    });
  });

  const catalogs = W.SITE_CATALOGS || {};
  const books = {};

  Object.keys(SOURCE_BOOK).forEach(function (bookId) {
    const catalog = catalogs[bookId];
    const file = catalog && catalog.src;
    if (!catalog || !file) throw new Error("目录里没有 " + bookId);
    const list = W[SOURCE_BOOK[bookId]];
    if (!list || !list.length) {
      throw new Error("读不到分卷 " + SOURCE_BOOK[bookId] + "（" + bookId + "）");
    }
    const index = {};
    list.forEach(function (p) {
      const key = norm(p.title);
      (index[key] = index[key] || []).push(p);
    });

    const out = [];
    catalog.rows.forEach(function (row, pos) {
      const title = String(row[0] || "").trim();
      const author = String(row[1] || "").trim();
      const hits = index[norm(title)] || [];
      const mine = hits.filter(function (p) { return String(p.author || "").trim() === author; });
      const pick = mine.length === 1 ? mine : (hits.length === 1 ? hits : []);
      if (pick.length !== 1) return;
      const master = byId[pick[0].textRef];
      const text = String((master && master.text) || "").trim();
      const translation = String((master && master.translation) || "").trim();
      if (!text || !translation) return;

      out.push([
        pos + 1,
        pick[0].textRef,
        master.translationSource || "",
        norm(text),
        translation
      ]);
    });

    books[bookId] = out;
  });

  write(books);

  const lines = Object.keys(books).map(function (b) {
    const n = books[b].length;
    const catalog = catalogs[b];
    return b + " " + n + " / " + catalog.rows.length;
  });
  console.log("目录绑定的正文与译文：" + lines.join("，") + " → " + path.relative(process.cwd(), OUT));
}

function write(books) {
  const body = Object.keys(books).map(function (b) {
    const rows = books[b].map(function (r) {
      return "    [" + r.map(function (v) {
        return typeof v === "number" ? String(v) : JSON.stringify(v);
      }).join(", ") + "]";
    });
    return "    " + b + ": [\n" + rows.join(",\n") + "\n    ]";
  }).join(",\n");

  fs.writeFileSync(OUT,
    "(function () {\n  \"use strict\";\n\n  window.CATALOG_TEXTS = {\n" + body + "\n  };\n})();\n");
}

main();
