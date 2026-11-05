"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const DIR = path.join(__dirname, "..");
const SRC = path.join(__dirname, "tongxin-notes-src.js");
const OUT = path.join(DIR, "data", "tongxin-notes.js");

const BODY_FIXES = {
  "岸苇": "苇岸",
  "浓阴": "阴浓",
  "欲语": "未语"
};

const BY_TITLE = {
  9: 10,
  117: 118,
  184: 185
};

function load(file) {
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  return sandbox.window;
}

function han(text) {
  return String(text || "").replace(/[^\u3400-\u9fff]/g, "");
}

function boxed(book) {
  return Object.keys(book || {}).map(function (pos) {
    const row = book[pos];
    const body = Array.isArray(row[2]) ? row[2].join("") : row[2];
    return { pos: Number(pos), body: String(body || ""), translation: String(row[3] || "") };
  });
}

function main() {
  const old = load(SRC);
  const cur = load(OUT);
  const oldTexts = boxed(old.TONGXIN_TEXT.tongxin);
  const newTexts = boxed(cur.TONGXIN_TEXT.tongxin);
  const oldNotes = old.TONGXIN_NOTES.tongxin || {};

  const byBody = {};
  newTexts.forEach(function (row) {
    const key = han(row.body);
    (byBody[key] = byBody[key] || []).push(row.pos);
  });

  const notes = {};
  const report = { matched: 0, renamed: 0, fresh: 0, dropped: [], missing: [] };
  const used = {};
  oldTexts.forEach(function (row) {
    const hits = byBody[han(row.body)] || [];
    if (hits.length !== 1 || used[hits[0]]) {
      report.dropped.push(row);
      return;
    }
    used[hits[0]] = true;
    if (oldNotes[row.pos]) {
      notes[hits[0]] = oldNotes[row.pos];
      report.matched += 1;
    }
  });

  Object.keys(BY_TITLE).forEach(function (pos) {
    notes[pos] = oldNotes[BY_TITLE[pos]];
    report.renamed += 1;
  });
  report.fresh = Object.keys(cur.TONGXIN_NOTES.tongxin || {}).length;
  Object.keys(notes).forEach(function (pos) {
    notes[pos] = notes[pos].map(function (it) {
      return [BODY_FIXES[han(it[0])] || it[0], it[1]];
    });
  });

  const order = Object.keys(notes).map(Number).filter(function (pos) {
    return notes[pos];
  }).sort(function (a, b) { return a - b; });
  const body = order.map(function (pos) {
    return "      \"" + pos + "\": " + JSON.stringify(notes[pos], null, 2).replace(/\n/g, "\n      ");
  }).join(",\n");

  const text = fs.readFileSync(OUT, "utf8");
  const start = text.indexOf("  window.TONGXIN_NOTES = {\n    \"tongxin\": ") + "  window.TONGXIN_NOTES = {\n    \"tongxin\": ".length;
  const head = "\n    }\n  };\n})();\n";
  const end = text.indexOf(head, start);
  if (start < 0 || end < 0 || text.slice(end + head.length)) throw new Error("找不到 TONGXIN_NOTES 的位置");
  const patched = text.slice(0, start) + "{\n" + body + "\n    }\n  };\n})();\n";
  fs.writeFileSync(OUT, patched);
  verify(notes, oldNotes, newTexts, order);

  console.log("注释 " + order.length + " 条（旧 " + Object.keys(oldNotes).length + " 条、现 " +
    report.fresh + " 条），按正文带回 " + report.matched + " 条，按标题认领 " + report.renamed +
    " 条，新目录里已无正文 " + report.dropped.length + " 条");
}

function verify(notes, oldNotes, newTexts, order) {
  const body = {};
  newTexts.forEach(function (row) { body[row.pos] = han(row.body); });
  const bad = [];
  order.forEach(function (pos) {
    if (!body[pos]) return bad.push("#" + pos + " 没有正文");
    notes[pos].forEach(function (it) {
      if (body[pos].indexOf(han(it[0])) < 0) bad.push("#" + pos + " 正文里没有「" + it[0] + "」");
    });
  });
  if (bad.length) throw new Error("注释对不上正文：\n" + bad.join("\n"));
  const words = Object.keys(oldNotes).reduce(function (n, pos) { return n + oldNotes[pos].length; }, 0);
  const kept = order.reduce(function (n, pos) { return n + notes[pos].length; }, 0);
  console.log("词条 " + kept + " / " + words + "，逐条对得上正文");
}

main();
