/**
 * 正文全文检索。
 *
 * 语料分两处放：课内正文在主包（course.json），课外正文在分片（走 CDN）。
 * 检索要覆盖全站，但**不能把分片全量读进内存** —— 那是 23MB。
 * 分两条路：
 *
 *   1. 课内（251 首，223KB，已在包里）：现场扫，逐字匹配，零成本
 *   2. 课外：用构建时生成的倒排索引。键是单字，值是这个字出现在哪些分片、
 *      出现几次 —— 查一次先算出「相关分片」，只把这几片读进来精确定位。
 *
 * 倒排只记「字 → 分片」，不记行号和偏移：记偏移要额外 2-3 倍体积，
 * 而一片才 200KB，读进来再定位一次的花费远小于把索引撑大。
 *
 * 索引生成不出来时**整个全文检索关掉**，搜索页退回索引字段，
 * 不会静默降级成「假装搜过正文」。
 */
const corpus = require("./corpus");

const INDEX = "data/texts/idx.json";

let indexCache = null;
let missing = false;

function index() {
  if (indexCache) return indexCache;
  if (missing) return null;
  try {
    indexCache = require("../" + INDEX);
  } catch (e) {
    missing = true;
    return null;
  }
  return indexCache;
}

function available() {
  const idx = index();
  return !!(idx && idx.postings && Object.keys(idx.postings).length);
}

function readiness() {
  if (!available()) {
    return { visible: false, usable: false, state: "missing", reason: "全文索引未生成" };
  }
  return { visible: true, usable: true, state: "ready", reason: "" };
}

/** 查询切成单字。中文不分词：语料全是古诗文，单字足够，还省一张词表 */
function termsOf(keyword) {
  return String(keyword || "")
    .replace(/\s+/g, "")
    .split("")
    .filter((c) => /[\u4e00-\u9fff]/.test(c));
}

/**
 * 候选分片：取命中字最少的那一片集合打底，再逐步取交集。
 * 顺序有讲究 —— 从最挑剔的字开始，交集收敛最快。
 */
function candidateBuckets(terms) {
  const idx = index();
  if (!idx) return [];
  const lists = terms
    .map((t) => idx.postings[t] || null)
    .filter(Boolean)
    .sort((a, b) => Object.keys(a).length - Object.keys(b).length);

  if (!lists.length) return [];

  let acc = Object.keys(lists[0]);
  for (let i = 1; i < lists.length; i++) {
    const next = lists[i];
    acc = acc.filter((b) => next[b] !== undefined);
    if (!acc.length) break;
  }
  return acc;
}

/** 在一段正文里按整串找，返回命中的句子（按标点切） */
function hitLines(text, keyword) {
  const kw = String(keyword || "");
  if (!kw) return [];
  return String(text || "")
    .split(/[\n。！？；]/)
    .map((s) => s.trim())
    .filter((s) => s.indexOf(kw) >= 0);
}

function scanPack(keyword, limit) {
  const out = [];
  const all = corpus.course();
  const texts = corpus.courseTexts();
  for (let i = 0; i < all.length && out.length < limit; i++) {
    const p = all[i];
    const t = texts[p.id];
    if (!t) continue;
    const lines = hitLines(t.text, keyword);
    if (lines.length) out.push({ entry: p, lines: lines.slice(0, 2), where: "pack" });
  }
  return out;
}

function scanBuckets(keyword, buckets, limit) {
  const out = [];
  const manifest = corpus.manifest();
  const byBucket = {};
  Object.keys(manifest.map || {}).forEach((id) => {
    const b = manifest.map[id];
    if (buckets.indexOf(b) >= 0) (byBucket[b] = byBucket[b] || []).push(id);
  });

  buckets.forEach((name) => {
    if (out.length >= limit) return;
    const data = corpus.bucket(name);
    const ids = byBucket[name] || Object.keys(data);
    for (let i = 0; i < ids.length && out.length < limit; i++) {
      const payload = data[ids[i]];
      if (!payload) continue;
      const lines = hitLines(payload.text, keyword);
      if (lines.length) {
        const entry = corpus.indexById(ids[i]);
        if (entry) out.push({ entry: entry, lines: lines.slice(0, 2), where: "cloud" });
      }
    }
  });
  return out;
}

/**
 * 全文检索。
 * @param {string} keyword
 * @param {Object} [opt] book（限定集子）/ limit
 */
function search(keyword, opt) {
  const kw = String(keyword || "").trim();
  const limit = (opt && opt.limit) || 20;
  const book = opt && opt.book;
  if (!kw) return [];

  if (book && book !== "poems") {
    // 限单部课外集子：直接扫该集子涉及的分片，不必过倒排
    const manifest = corpus.manifest();
    const buckets = [];
    corpus.ofBook(book).forEach((p) => {
      const b = manifest.map[p.id];
      if (b && buckets.indexOf(b) < 0) buckets.push(b);
    });
    return scanBuckets(kw, buckets, limit);
  }

  const pack = scanPack(kw, book === "poems" ? limit : limit);
  if (book === "poems") return pack;

  const idx = index();
  if (!idx) return pack;

  const terms = termsOf(kw);
  if (!terms.length) return pack;

  const buckets = candidateBuckets(terms);
  return pack.concat(scanBuckets(kw, buckets, limit - pack.length)).slice(0, limit);
}

module.exports = { available, readiness, search, termsOf, candidateBuckets, hitLines, INDEX };
