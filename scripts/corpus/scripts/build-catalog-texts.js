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

const HALF = {
  ",": "，", ".": "。", "!": "！", "?": "？", ":": "：", ";": "；"
};

function tidy(s) {
  return String(s == null ? "" : s)
    .split("\u3000").join(" ")
    .replace(/[ \t]+/g, " ")
    .split("\n").map(function (line) { return line.trim(); }).filter(Boolean).join("\n")
    .replace(/[,.:;!?]/g, function (c) { return HALF[c]; });
}

function matchKey(s) {
  return String(s == null ? "" : s).replace(/[\s\u3000·・「」『』《》〈〉【】()（）\[\]"'“”‘’—－-]/g, "");
}

function han(s) {
  return String(s == null ? "" : s).replace(/[^\u3400-\u9fff]/g, "");
}

function uniqueRow(list, row, cites, opens) {
  const pai = han(String(row[0] || "").split("·")[0]);
  const cite = han(row[3]);
  const head = han(String(row[0] || "").split("·")[1]).slice(0, 2);
  const mine = list.filter(function (p) {
    return han(String(p.title || "").split("·")[0]) === pai;
  });
  const only = function (xs) {
    return xs.filter(function (p) { return opens[String(p.textRef || "")] === 1; });
  };
  const same = mine.filter(function (p) {
    return han(String(p.title || "").split("·")[1]).slice(0, 2) === head;
  });
  const opened = mine.filter(function (p) {
    const open = han(String(p.text || "")).slice(0, 2);
    return open === head || open === cite.slice(0, 2);
  });
  const matched = mine.filter(function (p) { return cites[String(p.textRef || "")] === pai + "|" + cite.slice(0, 2); });
  const pools = [cite ? matched : same, cite ? same : opened, cite ? opened : matched];
  for (let i = 0; i < pools.length; i += 1) {
    const hits = only(pools[i]);
    if (hits.length === 1) return hits;
  }
  return [];
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
  const patch = {};
  Object.keys(W.CATALOG_TEXTS_PATCH || {}).forEach(function (bookId) {
    const rows = W.CATALOG_TEXTS_PATCH[bookId] || [];
    const list = Array.isArray(rows) ? rows : Object.keys(rows).map(function (k) { return rows[k]; });
    patch[bookId] = {};
    list.forEach(function (r) { patch[bookId][Number(r[0])] = r; });
  });
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
      const key = matchKey(p.title);
      (index[key] = index[key] || []).push(p);
    });

    const cites = {};
    const byFirst = {};
    list.forEach(function (p) {
      const pai = han(String(p.title || "").split("·")[0]);
      const head = han(String(p.title || "").split("·")[1]).slice(0, 2);
      const cite = /^([^。，；！？《》「」（）]{2,14}(?:·[^。，；！？《》「」（）]{1,8})?)(?:并序)?[。，]/.exec(han(String(p.text || "")));
      const body = han(String(p.text || ""));
      cites[p.textRef] = pai + "|" + (cite ? han(cite[1]).slice(0, 2) : head);
      const key = pai + "|" + body.slice(0, 2);
      (byFirst[key] = byFirst[key] || []).push(p.textRef);
    });
    const opens = {};
    list.forEach(function (p) {
      const pai = han(String(p.title || "").split("·")[0]);
      const key = pai + "|" + han(String(p.text || "")).slice(0, 2);
      opens[p.textRef] = byFirst[key].length;
    });

    const out = [];
    catalog.rows.forEach(function (row, pos) {
      const title = String(row[0] || "").trim();
      const author = String(row[1] || "").trim();
      const hits = index[matchKey(title)] || [];
      const sameAuthor = hits.filter(function (p) { return String(p.author || "").trim() === author; });
      const over = (patch[bookId] || {})[pos + 1];
      if (over) {
        out.push([pos + 1, over[1], over[2] || "", tidy(over[3]), String(over[4] || "")]);
        return;
      }
      const pick = sameAuthor.length ? sameAuthor : uniqueRow(list, row, cites, opens);
      if (pick.length !== 1) return;
      const master = byId[pick[0].textRef];
      const text = String((master && master.text) || "").trim();
      const translation = String((master && master.translation) || "").trim();
      if (!text || !translation) return;

      out.push([
        pos + 1,
        pick[0].textRef,
        master.translationSource || "",
        tidy(text),
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
