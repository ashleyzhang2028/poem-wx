const CLAUSE_SPLIT = /[\n，。！？；：、]/;

function splitClauses(line) {

  const s = [];
  let buf = "";
  for (const ch of String(line)) {
    if (CLAUSE_SPLIT.test(ch)) {
      if (buf.trim()) s.push(buf.trim() + ch);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) s.push(buf.trim());
  return s;
}

function splitLines(text) {
  return String(text == null ? "" : text)
    .split("\n")
    .map((line) => ({ line: line, s: splitClauses(line) }));
}

const PUNCT_END = /[，。！？；：]/;
const PUNCT_SOFT = /[，、：；]/;

const MIN_VERSE = 4;

const MAX_STANZA_BLOCK = 2;

const WALL_RUN = 6;

const RUN_LIMIT = 16;

function foldClauses(clauses) {
  const out = [];
  let buf = [];
  clauses.forEach((cl) => {
    buf.push(cl);

    const last = cl[cl.length - 1] || "";
    if (/[，。！？；：]/.test(last)) {
      out.push(buf);
      buf = [];
    }
  });
  if (!buf.length) return out;

  if (out.length) {
    out[out.length - 1] = out[out.length - 1].concat(buf);
    return out;
  }

  out.push(buf);
  return out;
}

function shortAll(clauses) {
  return clauses.every((cl) => !verseLike(cl));
}

function verseLike(seg) {
  return String(seg || "").replace(PUNCT_SOFT, "").length >= MIN_VERSE;
}

function hasStop(rows) {
  return rows.some((seg) => PUNCT_END.test(seg[seg.length - 1] || ""));
}

function wallAfter(cur, next) {
  if (!next.length) return false;
  const all = cur.concat(next);

  let run = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const row = all[i];
    if (row.length === 1 && verseLike(row[0]) && hasStop(row)) run++;
    else break;
  }
  if (run >= WALL_RUN) return true;
  if (all.length >= RUN_LIMIT && hasStop(all[all.length - 1])) return true;
  return false;
}

function layout(text) {
  const lines = splitLines(text);
  const rows = [];
  const paras = [];

  let cur = [];

  const flush = () => {
    if (cur.length) paras.push(cur);
    cur = [];
  };

  lines.forEach((ln) => {
    if (!ln.s.length) {

      flush();
      rows.push("");
      return;
    }

    const verse = ln.s.length === 1 || shortAll(ln.s);
    const cut = verse ? [ln.s] : foldClauses(ln.s);
    cut.forEach((g) => rows.push(g.join("")));

    const closeHere = wallAfter(cur, cut);
    cur = cur.concat(cut);
    if (closeHere) flush();
  });
  flush();

  while (paras.length && !paras[paras.length - 1].length) paras.pop();
  return { rows: rows, paras: paras, verse: rows.length > lines.length };
}

const BOOKS_DIR = "data/books/";
const COURSE = "data/course.json";

const MANIFEST = "data/shards.json";

const BUCKET_DIR = "data/texts/";

let booksCache = null;
let courseCache = null;
let manifestCache = null;
const bookCache = {};
const bucketCache = {};

let dataReady = null;

function hasData() {
  if (dataReady === null) {
    try {

      const fs = require("fs");
      const path = require("path");
      dataReady = fs.existsSync(path.join(__dirname, "..", "data"));
    } catch (e) {

      try {
        require("../" + BOOKS_DIR + "books.json");
        dataReady = true;
      } catch (e2) {
        dataReady = false;
      }
    }
  }
  return dataReady;
}

function loadJson(rel) {
  if (!hasData()) {
    const err = new Error(
      "语料未生成：miniprogram/data/ 不存在。\n" +
      "先在仓库根跑 `npm run build:data`（POEM_WEB_DIR 指向 poem 仓库），" +
      "再用开发者工具打开 miniprogram/。见 README「快速开始」。"
    );
    err.code = "E_NO_DATA";

    err.expected = true;
    throw err;
  }
  return require("../" + rel);
}

function readJson(rel, fallback) {
  try {
    return loadJson(rel);
  } catch (e) {
    if (e && e.code === "E_NO_DATA") return fallback;

    if (e && e.code === "MODULE_NOT_FOUND") return fallback;
    throw e;
  }
}

function books() {
  if (!booksCache) booksCache = readJson(BOOKS_DIR + "books.json", []);
  return booksCache;
}

function bookById(id) {
  return books().find((b) => b.id === id) || null;
}

function ofBook(bookId) {
  if (!bookCache[bookId]) {
    const meta = bookById(bookId);
    const rows = readJson(BOOKS_DIR + bookId + ".json", []);
    bookCache[bookId] = rows.map(function (p) {
      p.b = bookId;
      p.n = meta ? meta.name : bookId;
      p.hasT = true;
      return p;
    });
  }
  return bookCache[bookId];
}

function course() {
  return ofBook("poems");
}

function courseTexts() {
  if (!courseCache) courseCache = readJson(COURSE, {});
  return courseCache;
}

function manifest() {
  if (!manifestCache) manifestCache = readJson(MANIFEST, { map: {}, buckets: [] });
  return manifestCache;
}

function bucketOf(id) {
  return (manifest().map || {})[id] || "";
}

function bucket(name) {
  if (!bucketCache[name]) bucketCache[name] = readJson(BUCKET_DIR + name + ".json", {});
  return bucketCache[name];
}

const SHARD_CACHE_KEY = "shards";
const SHARD_CACHE_MAX = 40;

function shardCache() {
  const store = require("./store");
  return store.read(SHARD_CACHE_KEY, {}) || {};
}

function saveShard(name, payload) {
  const store = require("./store");
  const all = shardCache();
  const keys = Object.keys(all);

  if (keys.length >= SHARD_CACHE_MAX) {
    keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0));
    keys.slice(0, keys.length - SHARD_CACHE_MAX + 1).forEach((k) => delete all[k]);
  }
  all[name] = { at: Date.now(), data: payload };
  store.write(SHARD_CACHE_KEY, all);
}

function ensureBucket(name) {
  if (!name) return Promise.reject(shardError("E_NO_BUCKET", "没有这一片的名字"));
  const local = bucket(name);
  if (Object.keys(local).length) return Promise.resolve({ data: local, from: "local" });

  const cached = shardCache()[name];
  if (cached && cached.data) {
    bucketCache[name] = cached.data;
    return Promise.resolve({ data: cached.data, from: "local" });
  }

  const remote = require("./remote");
  if (!remote.shardReady()) return Promise.reject(shardError("E_NO_SHARD_SERVICE", "分片服务没接上"));

  return remote.shard(name).then(function (data) {
    const payload = (data && data.t) || data || {};
    if (!payload || !Object.keys(payload).length) throw shardError("E_EMPTY_SHARD", "这一片是空的");
    bucketCache[name] = payload;
    saveShard(name, payload);
    return { data: payload, from: "remote" };
  });
}

function ensureEntry(id) {
  const inPack = courseTexts()[id];
  if (inPack) return Promise.resolve(inPack);

  const name = bucketOf(id);
  if (!name) return Promise.resolve(null);

  return ensureBucket(name).then(function (r) {
    const hit = r.data[id] || null;
    if (!hit) throw shardError("E_NO_ENTRY", "这一片里没有这一条：" + id);
    return hit;
  });
}

function shardError(code, message) {
  const e = new Error(message);
  e.code = code;
  e.expected = true;
  return e;
}

function entry(id) {
  const inPack = courseTexts()[id];
  if (inPack) return inPack;
  const name = bucketOf(id);
  if (!name) return null;
  return bucket(name)[id] || null;
}

function entries(ids) {
  const out = {};
  (ids || []).forEach((id) => {
    const e = entry(id);
    if (e) out[id] = e;
  });
  return out;
}

function indexById(id) {
  const owner = ownerOf(id);
  if (!owner) return null;
  const full = ofBook(owner);
  for (let i = 0; i < full.length; i++) {
    if (full[i].id === id) return full[i];
  }
  return null;
}

function ownerOf(id) {
  const all = books();
  let best = "";
  for (let i = 0; i < all.length; i++) {
    const b = all[i].id;
    if (id.indexOf(b + "-") === 0 && b.length > best.length) best = b;
  }
  return best;
}

function search(keyword, opt) {
  const kw = String(keyword || "").trim().toLowerCase();
  if (!kw) return { items: [], total: 0 };
  const bookId = opt && opt.book;
  const limit = (opt && opt.limit) || 60;
  const sources = bookId ? [bookId] : books().map((b) => b.id);
  const items = [];
  let total = 0;

  for (let s = 0; s < sources.length; s++) {
    const pool = ofBook(sources[s]);
    for (let i = 0; i < pool.length; i++) {
      if (!matchEntry(pool[i], kw)) continue;
      total += 1;
      if (items.length < limit) items.push(pool[i]);
    }
  }
  return { items: items, total: total };
}

function matchEntry(p, kw) {
  return !!(
    (p.t && p.t.toLowerCase().indexOf(kw) >= 0) ||
    (p.a && p.a.toLowerCase().indexOf(kw) >= 0) ||
    (p.d && p.d.toLowerCase().indexOf(kw) >= 0) ||
    (p.s && p.s.toLowerCase().indexOf(kw) >= 0) ||
    (p.g && p.g.toLowerCase().indexOf(kw) >= 0)
  );
}

function grouped(list) {
  const order = [];
  const map = {};
  (list || []).forEach((p) => {
    const g = p.g || "";
    if (!map[g]) {
      map[g] = [];
      order.push(g);
    }
    map[g].push(p);
  });
  return order.map((g) => ({ group: g, items: map[g] }));
}

module.exports = {
  CLAUSE_SPLIT,
  splitLines,
  splitClauses,
  layout,
  books,
  bookById,
  ownerOf,
  ofBook,
  course,
  courseTexts,
  manifest,
  bucketOf,
  bucket,
  ensureBucket,
  ensureEntry,
  entry,
  entries,
  indexById,
  search,
  grouped,
  matchEntry,
  hasData
};
