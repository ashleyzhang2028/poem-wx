#!/usr/bin/env node
/**
 * 把 poem 网页应用的语料编译成小程序可用的分包数据。
 *
 * 输入：POEM_WEB_DIR 指向 poem 仓库根目录（默认 /tmp/poem，CI 里由 clone 步骤给出）。
 * 输出：miniprogram/data/**，其中：
 *   - index.json     全站索引（列表页、搜索、每日计划只用它，条目不含正文）
 *   - texts/<book>.json 各集子正文分片，按条目 id 的哈希稳定分桶
 *
 * 为什么不把正文塞进主包：主包上限 2MB，而全部正文（data/text-master.js）
 * 未压缩 24MB、gzip 后 4.9MB。索引只有约 600KB，正文全部落到分包按需取。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WEB_DIR = process.env.POEM_WEB_DIR || "/tmp/poem";
const OUT_DIR = path.join(__dirname, "..", "miniprogram", "data");

/** 每个正文分片的目标量（压缩前 KB），控制单次下载体积 */
const BUCKET_KB = 200;

/** 语料脚本都是 IIFE 挂 window.XXX 的老式写法，按顺序丢进同一个沙箱执行 */
function loadCorpus(rels) {
  const sandbox = { window: {}, console: console, Date: Date, JSON: JSON };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = undefined;
  vm.createContext(sandbox);
  rels.forEach(function (rel) {
    const file = path.join(WEB_DIR, rel);
    vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: rel });
  });
  return sandbox.window;
}

function main() {
  // text-master 里的正文要先展开回各集子条目，再统一收集
  const W = loadCorpus([
    "data/poems-1.js", "data/poems-2.js", "data/poems-3.js", "data/poems-4.js",
    "data/poems-5.js", "data/poems-6.js", "data/poems-7.js", "data/poems-8.js",
    "data/poems-9.js", "data/poems-10.js", "data/poems-11.js", "data/poems-12.js",
    "data/text-master.js",
    "data/poems-classic.js", "data/poems-yuefu.js", "data/poems-tangshi.js",
    "data/poems-gushi.js", "data/poems-songci.js", "data/poems-yuanqu.js",
    "data/poems-guwen.js", "data/poems-jinxiandai.js", "data/poems-zhaoming.js",
    "data/poems-chengyu.js", "data/poems-changshi.js", "data/poems-mingshu.js",
    "data/poems-mingren-cn.js", "data/poems-mingren-foreign.js",
    "data/poems-emperor-cn.js", "data/poems-emperor-waiguo.js",
    "data/group-order.js",
    "data/index.js",
    "data/site-books.js",
    "data/site-index.js"
  ]);

  const master = W.TEXT_MASTER || [];
  if (!master.length) throw new Error("TEXT_MASTER 为空，检查 POEM_WEB_DIR");

  const byId = {};
  master.forEach(function (m) {
    byId[m.id] = m;
    (m.entries || []).forEach(function (e) { if (!byId[e]) byId[e] = m; });
  });

  const siteIndex = W.SITE_INDEX || [];
  const books = W.SITE_BOOKS || [];

  const index = [];
  const texts = {};

  siteIndex.forEach(function (p) {
    if (p.isBook) return;
    const m = byId[p.id] || byId[p.originId] || null;
    const text = p.text || (m && m.text) || "";
    const translation = p.translation || (m && m.translation) || "";

    index.push({
      id: p.id,
      t: p.title,
      a: p.author || p.authorName || "",
      d: p.dynasty || "",
      s: p.source || "",
      g: p.group || p.gradeGroup || "",
      b: p.book,
      n: p.bookName,
      // 年级学期只有课内诗词有，其余集子按分组走；0 表示不适用
      gr: p.grade || 0,
      tm: p.term || 0,
      hasT: !!text
    });

    if (text || translation) {
      texts[p.id] = { text: text, translation: translation, src: p.translationSource || "" };
    }
  });

  // 索引按集子拆开：列表页只加载自己那一部。
  // ⚠️ 不再另存一份全站索引 —— 那会让 meta.json 涨到 1.3MB（主包上限只有 2MB），
  // 而它与各集子索引是同一份数据。搜索与按 id 查条目时按需拼装。
  const byBook = {};
  index.forEach(function (p) {
    (byBook[p.b] = byBook[p.b] || []).push(p);
  });

  Object.keys(byBook).forEach(function (b) {
    writeJson(path.join(OUT_DIR, "books", b + ".json"), byBook[b]);
  });

  writeJson(path.join(OUT_DIR, "books", "books.json"), books);

  writeBuckets(texts);

  console.log("索引 " + index.length + " 条，按 " + Object.keys(byBook).length + " 部集子拆分");
  console.log("正文 " + Object.keys(texts).length + " 条");
}

/** 按条目 id 的稳定哈希分桶，同一条永远落同一个文件，便于做增量缓存 */
function writeBuckets(texts) {
  const dir = path.join(OUT_DIR, "texts");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const all = Object.keys(texts).sort();
  const buckets = [];
  let cur = [];
  let curSize = 0;

  // 先按体积降序装桶，大条目先落位，避免末尾留下大量小桶
  const ordered = all.slice().sort(function (a, b) {
    return JSON.stringify(texts[b]).length - JSON.stringify(texts[a]).length;
  });

  ordered.forEach(function (id) {
    const size = Buffer.byteLength(JSON.stringify(texts[id]), "utf8") / 1024;
    if (curSize + size > BUCKET_KB && cur.length) {
      buckets.push(cur);
      cur = [];
      curSize = 0;
    }
    cur.push(id);
    curSize += size;
  });
  if (cur.length) buckets.push(cur);

  const map = {};
  const manifest = [];

  buckets.forEach(function (ids, i) {
    const name = "t" + String(i + 1).padStart(3, "0");
    const payload = {};
    ids.forEach(function (id) {
      payload[id] = texts[id];
      map[id] = name;
    });

    const file = path.join(dir, name + ".json");
    fs.writeFileSync(file, JSON.stringify(payload));
    manifest.push({ n: name, c: ids.length, kb: Math.round(fs.statSync(file).size / 1024) });
  });

  writeJson(path.join(dir, "manifest.json"), { buckets: manifest, map: map });

  const total = manifest.reduce(function (a, b) { return a + b.kb; }, 0);
  console.log("正文分片 " + manifest.length + " 个，" + total + "KB（未压缩）");
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

main();
