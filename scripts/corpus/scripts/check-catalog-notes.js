"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const seed = require("../../corpus-seed");

function load(rel) {
  const file = path.join(seed.CORPUS_DIR, rel);
  if (!fs.existsSync(file)) throw noFile(file);
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: rel });
  return sandbox.window;
}

function noFile(file) {
  return new Error("读不到 " + file);
}

function hanOnly(text) {
  return String(text || "").replace(/[^\u3400-\u9fff]/g, "");
}

function main() {
  const texts = load("data/catalog-texts.js").CATALOG_TEXTS || {};
  const notes = load("data/catalog-notes.js").CATALOG_NOTES || {};

  const bad = [];
  Object.keys(notes).forEach(function (book) {
    const rows = texts[book] || [];
    const mine = notes[book] || {};
    const byPos = {};
    rows.forEach(function (r) { byPos[r[0]] = r; });

    Object.keys(mine).forEach(function (pos) {
      const row = byPos[pos];
      if (!row) {
        bad.push(book + " #" + pos + " 目录里没有这一篇");
        return;
      }
      const text = String(row[3] || "");
      const list = mine[pos];
      if (!Array.isArray(list) || !list.length) {
        bad.push(book + " #" + pos + " 空注释");
        return;
      }
      const seen = {};
      list.forEach(function (it) {
        if (!Array.isArray(it) || it.length !== 2) {
          bad.push(book + " #" + pos + " 形状不对");
          return;
        }
        const word = String(it[0] || "").trim();
        const note = String(it[1] || "").trim();
        if (!word || !note) {
          bad.push(book + " #" + pos + " 空词条或空释义");
          return;
        }
        if (seen[word]) bad.push(book + " #" + pos + " 词条重复：" + word);
        seen[word] = true;
        if (text.indexOf(hanOnly(word) || word) < 0) {
          bad.push(book + " #" + pos + " 正文里没有「" + word + "」");
        }
        if (note.indexOf("：") >= 0 || note.indexOf(":") >= 0) {
          bad.push(book + " #" + pos + " 释义里带冒号：" + word);
        }
        if (word.length > 8) {
          bad.push(book + " #" + pos + " 词条超过 8 字：" + word);
        }
        if (note.length > 40) {
          bad.push(book + " #" + pos + " 释义超过 40 字：" + word);
        }
      });
    });
  });

  const counts = Object.keys(notes).map(function (book) {
    return book + " " + Object.keys(notes[book] || {}).length + " / " + (texts[book] || []).length;
  });

  if (bad.length) {
    console.log("✗ 注释不合口径 " + bad.length + " 处：");
    bad.slice(0, 40).forEach(function (b) { console.log("  · " + b); });
    process.exit(1);
  }

  console.log("✓ 目录注释逐条对得上正文：" + counts.join("，"));
}

main();
