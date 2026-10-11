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

function hitLines(text, keyword) {
  const kw = String(keyword || "");
  if (!kw) return [];
  return String(text || "")
    .split(/[\n。！？；]/)
    .map((s) => s.trim())
    .filter((s) => s.indexOf(kw) >= 0);
}

function scanPackStage(keyword, offset) {
  const items = [];
  const all = corpus.course();
  const texts = corpus.courseTexts();
  for (let i = offset; i < all.length; i++) {
    const p = all[i];
    const t = texts[p.id];
    if (!t) continue;
    const lines = hitLines(t.text, keyword);
    if (lines.length) items.push({ entry: p, lines: lines.slice(0, 2), where: "pack" });
  }
  return { items: items, next: all.length };
}

function shardsOf(keyword, book) {
  const manifest = corpus.manifest();
  const byBucket = {};
  const picks = [];

  if (book && book !== "poems") {
    const seen = {};
    corpus.ofBook(book).forEach((p) => {
      const name = (manifest.map || {})[p.id];
      if (!name || seen[name]) return;
      seen[name] = 1;
      picks.push(name);
    });
  } else {
    const terms = termsOf(keyword);
    if (!terms.length) return { buckets: [], byBucket: byBucket };
    picks.push.apply(picks, candidateBuckets(terms));
  }

  picks.forEach((name) => {
    const ids = [];
    Object.keys(manifest.map || {}).forEach((id) => {
      if (manifest.map[id] === name) ids.push(id);
    });
    byBucket[name] = ids;
  });

  return { buckets: picks, byBucket: byBucket };
}

function scanShardStage(keyword, state) {
  const items = [];
  while (state.at < state.buckets.length) {
    const name = state.buckets[state.at];
    const data = corpus.bucket(name);
    const ids = state.byBucket[name] || Object.keys(data);
    for (let i = state.pos; i < ids.length; i++) {
      const payload = data[ids[i]];
      if (!payload) continue;
      const lines = hitLines(payload.text, keyword);
      if (lines.length) {
        const entry = corpus.indexById(ids[i]);
        if (entry) items.push({ entry: entry, lines: lines.slice(0, 2), where: "cloud" });
      }
    }
    state.pos = ids.length;
    state.at += 1;
  }
  return { items: items, next: state.buckets.length };
}

function makeSession(keyword, opt) {
  const kw = String(keyword || "").trim();
  const book = opt && opt.book;
  let stage;
  if (!book || book === "poems") {
    stage = { parts: [{ scan: scanPackStage, state: 0 }] };
  } else {
    stage = { parts: [] };
  }

  const shards = shardsOf(kw, book);
  if (shards.buckets.length) {
    stage.parts.push({
      scan: scanShardStage,
      state: { buckets: shards.buckets, byBucket: shards.byBucket, at: 0, pos: 0 }
    });
  }

  const session = {
    keyword: kw,
    stage: stage,
    searched: 0,
    done: false
  };
  return session;
}

function nextBatch(session, size) {
  const out = [];
  const want = (size || 20) + 1;
  while (out.length < want && session.stage.parts.length) {
    const part = session.stage.parts[0];
    let chunk;
    try {
      chunk = part.scan(session.keyword, part.state);
    } catch (e) {
      chunk = { items: [], next: 0 };
    }
    out.push.apply(out, chunk.items);
    part.state = chunk.next;
    session.searched += chunk.items.length;
    if (!chunk.items.length) session.stage.parts.shift();
  }
  if (!session.stage.parts.length) session.done = true;
  return out;
}

function search(keyword, opt) {
  const session = makeSession(keyword, opt);
  const limit = (opt && opt.limit) || 20;
  let out = [];
  while (out.length < limit && !session.done) {
    out = out.concat(nextBatch(session, limit));
  }
  return out.slice(0, limit);
}

module.exports = {
  available,
  readiness,
  search,
  makeSession,
  nextBatch,
  termsOf,
  candidateBuckets,
  hitLines,
  INDEX
};
