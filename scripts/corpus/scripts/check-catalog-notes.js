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

function bodies() {
  const catalog = load("data/catalog-texts.js").CATALOG_TEXTS || {};
  const tongxin = load("data/tongxin-notes.js").TONGXIN_TEXT || {};
  return Object.assign({}, catalog, tongxin);
}

function check(book, text, list, where) {
  const bad = [];
  if (!Array.isArray(list) || !list.length) return [where + " 空注释"];
  const seen = {};
  list.forEach(function (it) {
    if (!Array.isArray(it) || it.length !== 2) return bad.push(where + " 形状不对");
    const word = String(it[0] || "").trim();
    const note = String(it[1] || "").trim();
    if (!word || !note) return bad.push(where + " 空词条或空释义");
    if (seen[word]) bad.push(where + " 词条重复：" + word);
    seen[word] = true;
    if (text.indexOf(hanOnly(word) || word) < 0) bad.push(where + " 正文里没有「" + word + "」");
    if (/[：:]/.test(note)) bad.push(where + " 释义里带冒号：" + word);
    if (word.length > 8) bad.push(where + " 词条超过 8 字：" + word);
    if (note.length > 40) bad.push(where + " 释义超过 40 字：" + word);
  });
  return bad;
}

function rowText(book, pos) {
  const box = bodies()[book] || {};
  if (Array.isArray(box)) {
    const row = box.filter(function (r) { return r[0] === Number(pos); })[0];
    return row ? String(row[3] || "") : "";
  }
  const row = box[Number(pos)];
  return Array.isArray(row) ? String(row[2] || "") : "";
}

function main() {
  const texts = bodies();
  const notes = Object.assign({}, load("data/catalog-notes.js").CATALOG_NOTES || {},
    load("data/tongxin-notes.js").TONGXIN_NOTES || {});

  const bad = [];
  Object.keys(notes).forEach(function (book) {
    const mine = notes[book] || {};
    Object.keys(mine).forEach(function (pos) {
      const text = rowText(book, pos);
      if (!text) {
        bad.push(book + " #" + pos + " 目录里没有这一篇");
        return;
      }
      check(book, text, mine[pos], book + " #" + pos).forEach(function (b) { bad.push(b); });
    });
  });

  const counts = Object.keys(notes).map(function (book) {
    const box = texts[book] || {};
    return book + " " + Object.keys(notes[book] || {}).length + " / " + Object.keys(box).length;
  });

  if (bad.length) {
    console.log("✗ 注释不合口径 " + bad.length + " 处：");
    bad.slice(0, 40).forEach(function (b) { console.log("  · " + b); });
    process.exit(1);
  }

  console.log("✓ 目录注释逐条对得上正文：" + counts.join("，"));
}

main();
