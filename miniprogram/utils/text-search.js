const corpus = require("./corpus");

const INDEX = "data/texts/idx.json";

const SCAN_CAP = 12;

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

function termsOf(keyword) {
  return String(keyword || "")
    .replace(/\s+/g, "")
    .split("")
    .filter((c) => /[\u4e00-\u9fff]/.test(c));
}

function candidateBuckets(terms) {
  const idx = index();
  if (!idx) return [];
  const lists = terms
    .map((t) => ({ t: t, row: idx.postings[t] || null }))
    .filter((x) => x.row)
    .sort((a, b) => Object.keys(a.row).length - Object.keys(b.row).length);

  if (!lists.length) return [];

  const hit = Object.keys(lists[0].row).filter((b) =>
    lists.slice(1).every((l) => l.row[b] !== undefined)
  );
  if (!hit.length) return [];

  const score = {};
  hit.forEach((b) => {
    score[b] = lists.reduce((n, l) => n + l.row[b], 0);
  });

  hit.sort((a, b) => score[a] - score[b]);
  const out = hit.slice(0, SCAN_CAP);
  out.total = hit.length;
  out.capped = hit.length > SCAN_CAP;
  return out;
}

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

function search(keyword, opt) {
  const kw = String(keyword || "").trim();
  const limit = (opt && opt.limit) || 20;
  const book = opt && opt.book;
  if (!kw) return [];

  if (book && book !== "poems") {

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
  const rest = limit - pack.length;
  const out = rest <= 0 ? pack : pack.concat(scanBuckets(kw, buckets, rest)).slice(0, limit);
  out.scanned = rest <= 0 ? 0 : buckets.length;
  out.partial = !!buckets.capped;
  return out;
}

module.exports = { available, readiness, search, termsOf, candidateBuckets, hitLines, INDEX, SCAN_CAP };
