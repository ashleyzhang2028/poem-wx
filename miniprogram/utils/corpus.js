const CLAUSE_SPLIT = /[\n，。！？；：、]/;

function splitClauses(line) {

  const s = [];
  let buf = "";
  for (const ch of String(line)) {
    if (CLAUSE_SPLIT.test(ch)) {
      const cl = (buf + ch).trim();
      if (cl) s.push(cl);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) s.push(buf.trim());
  return s;
}

function splitDisplay(text) {
  const rows = [];
  String(text == null ? "" : text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      let buf = "";
      for (const ch of line) {
        buf += ch;
        if (CLAUSE_SPLIT.test(ch)) {
          rows.push(buf);
          buf = "";
        }
      }
      if (buf) rows.push(buf);
    });
  return rows;
}

function splitLines(text) {
  return String(text == null ? "" : text)
    .split("\n")
    .map((line) => ({ line: line, s: splitClauses(line) }));
}

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/;

const BOX_DRAWING = /[─━│┃┌┬┐├┼┤└┴┘┏┳┓┣╋┫┗┻┛═║╔╦╗╠╬╣╚╩╝]/;

const FS_POEM = [30, 33, 36, 39, 42, 46, 52, 58, 64];

const PY_BOX = [34, 37, 40, 44, 47, 51, 58, 64, 70];

const PY_GAP = 1;

const MEASURE = 630;

const COUPLET_MAX = 2;

const FIXED_MIN = 4;

const FIXED_MAX = 9;

const STANZA_MAX_ROWS = 12;

function charWidth(size, pinyin) {
  const at = Math.max(0, Math.min(FS_POEM.length - 1, Number(size) + 2));
  return pinyin ? PY_BOX[at] + PY_GAP * 2 : FS_POEM[at];
}

function hanLen(seg) {
  let n = 0;
  for (const ch of String(seg || "")) if (HAN.test(ch)) n++;
  return n;
}

function fixedVerse(clauses) {
  if (clauses.length < COUPLET_MAX) return 0;
  let len = 0;
  for (let i = 0; i < clauses.length; i++) {
    const han = hanLen(clauses[i]);
    if (han < FIXED_MIN || han > FIXED_MAX) return 0;
    if (!len) len = han;
    else if (han !== len) return 0;
  }
  return len;
}

function costOf(cl) {
  return hanLen(cl) || String(cl).length;
}

function noHan(str) {
  for (let i = 0; i < str.length; i++) if (HAN.test(str[i])) return false;
  return true;
}

function costFast(cl) {
  const s = String(cl);
  return noHan(s) ? s.length : costOf(s);
}

function softTail(buf) {
  return buf.length > 1 && /[、：；]$/.test(buf[buf.length - 1]);
}

function sentenceCut(buf, limit) {
  for (let i = buf.length - 1; i > 0; i--) {
    if (!/[。！？]$/.test(buf[i - 1])) continue;
    const keep = buf.slice(0, i).reduce((n, cl) => n + costOf(cl), 0);
    return keep * 2 >= limit || buf.length - i <= 2 ? i : 0;
  }
  return 0;
}

function packClauses(clauses, size, pinyin, cap) {
  const limit = Math.max(1, Math.floor(MEASURE / charWidth(size, pinyin)));
  const out = [];
  let buf = [];
  let used = 0;

  clauses.forEach((cl) => {
    const cost = costFast(cl);
    const mark = noHan(String(cl));
    const full = used + cost > limit;
    const capped = cap && buf.length >= cap;
    if (buf.length && !mark && (full || capped)) {
      const cut = sentenceCut(buf, limit);
      if (cut > 0) {
        out.push(buf.slice(0, cut));
        buf = buf.slice(cut);
        used = buf.reduce((n, x) => n + costOf(x), 0);
      } else {
        const tail = softTail(buf) ? buf.pop() : null;
        out.push(buf);
        buf = tail ? [tail] : [];
        used = buf.reduce((n, x) => n + costOf(x), 0);
      }
    }
    buf.push(cl);
    used += cost;
  });
  if (buf.length) out.push(buf);
  return out;
}

const LAYOUT_MEMO_MAX = 160;

const layoutMemo = {};
const layoutMemoKeys = [];

function layout(text, opts) {
  const size = opts && opts.size !== undefined ? Number(opts.size) || 0 : 0;
  const pinyin = !!(opts && opts.pinyin);
  const raw = String(text == null ? "" : text);
  const memoKey = size + "|" + (pinyin ? 1 : 0) + "|" + raw;
  if (layoutMemo[memoKey]) return layoutMemo[memoKey];
  const out = layoutOf(raw, size, pinyin);
  layoutMemo[memoKey] = out;
  layoutMemoKeys.push(memoKey);
  if (layoutMemoKeys.length > LAYOUT_MEMO_MAX) delete layoutMemo[layoutMemoKeys.shift()];
  return out;
}

function layoutOf(text, size, pinyin) {
  const lines = splitLines(text);
  const flat = [];
  const paras = [];

  let all = [];
  lines.forEach((ln) => { if (ln.s.length) all = all.concat(ln.s); });
  const cap = fixedVerse(all) > 0 ? COUPLET_MAX : Infinity;

  let stanza = [];
  let pending = [];

  const closeStanza = () => {
    if (stanza.length) paras.push(stanza);
    stanza = [];
  };

  const pushRows = (rows) => {
    rows.forEach((row) => {
      flat.push(row);
      stanza.push(row);
      if (stanza.length >= STANZA_MAX_ROWS) closeStanza();
    });
  };

  const commit = () => {
    if (pending.length) pushRows(packClauses(pending, size, pinyin, cap));
    pending = [];
  };

  lines.forEach((ln) => {
    if (!ln.s.length) {
      commit();
      closeStanza();
      return;
    }

    if (BOX_DRAWING.test(ln.line)) {
      commit();
      closeStanza();
      pushRows([[ln.line]]);
      closeStanza();
      return;
    }

    if (!hanLen(ln.line)) {
      if (pending.length) pending[pending.length - 1] += ln.line.trim();
      return;
    }

    pending = pending.concat(ln.s);
  });
  commit();
  closeStanza();

  return { rows: flat.map((row) => row.join("")), paras: paras };
}

const COURSE = "data/course.js";

const MANIFEST = "data/shards.js";

const BUCKET_DIR = "data/texts/";

const SHARD_FILE_RE = /^t\d{3}$/;

let booksCache = null;
const idIndex = {};
const idBook = {};
let indexCache = null;
let courseCache = null;
let manifestCache = null;
const bookCache = {};
const bucketCache = {};

const PACKED = {
  books: function () {
    return require("../data/books/books.js");
  },
  index: function () {
    return require("../data/books/index.js");
  },
  course: function () {
    return require("../data/course.js");
  },
  manifest: function () {
    return require("../data/shards.js");
  }
};

const FIELDS = ["id", "t", "a", "d", "at", "s", "g", "sel", "gr", "tm", "aka", "an"];

let dataReady = null;

function hasData() {
  if (dataReady === null) {
    try {
      PACKED.books();
      dataReady = true;
    } catch (e) {
      dataReady = false;
    }
  }
  return dataReady;
}

function loadJson(rel) {
  if (!hasData()) {
    const err = new Error(
      "包里没有 data/books/books.js —— 这一版没带上语料。\n" +
      "在开发者工具里重新编译一次（读的是打包结果，不是磁盘上的目录）。"
    );
    err.code = "E_NO_DATA";

    err.expected = true;
    throw err;
  }
  return require("../" + rel);
}

function packed(name) {
  try {
    return PACKED[name]();
  } catch (e) {
    return null;
  }
}

function readJson(rel, fallback) {
  try {
    return loadJson(rel);
  } catch (e) {
    if (e && e.code === "E_NO_DATA") return fallback;
    return fallback;
  }
}

function books() {
  if (!booksCache) booksCache = packed("books") || [];
  return booksCache;
}

function bookById(id) {
  const all = books();
  for (let i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

function indexPack() {
  if (indexCache === null) {
    try {
      indexCache = PACKED.index();
    } catch (e) {
      indexCache = false;
    }
  }
  return indexCache || null;
}

function field(dict, key, at) {
  if (at < 0 || at === undefined) return "";
  const list = dict && dict[key];
  return (list && list[at]) || "";
}

function rowOf(dict, raw, bookId) {
  const p = {};
  FIELDS.forEach(function (k, i) { p[k] = raw[i]; });
  p.a = p.a || "";
  p.d = field(dict, "d", p.d);
  p.s = field(dict, "s", p.s);
  p.g = field(dict, "g", p.g);
  p.sel = field(dict, "sel", p.sel);
  p.aka = p.aka || null;
  p.an = p.an || "";
  p.a = p.a || p.an;
  p.b = bookId;
  p.hasT = true;
  return p;
}

function ofBook(bookId) {
  if (!bookCache[bookId]) {
    const meta = bookById(bookId);
    const pack = indexPack();
    const rows = pack && pack.rows[bookId] ? pack.rows[bookId] : [];
    const list = rows.map(function (raw) {
      const p = rowOf(pack.dict, raw, bookId);
      p.n = meta ? meta.name : bookId;
      idIndex[p.id] = p;
      if (idBook[p.id] === undefined) idBook[p.id] = bookId;
      p.lb = matchTextOf(p);
      return p;
    });
    bookCache[bookId] = list;
  }
  return bookCache[bookId];
}

function course() {
  return ofBook("poems");
}

function courseTexts() {
  if (!courseCache) courseCache = packed("course") || readJson(COURSE, {});
  return courseCache;
}

function manifest() {
  if (!manifestCache) {
    const m = packed("manifest");
    manifestCache = m && m.map ? m : readJson(MANIFEST, { map: {}, buckets: [] });
  }
  return manifestCache;
}

const PROBE_KEY = "kb_probe_v1";

let probeCache = null;

function probe() {
  if (!probeCache) {
    try {
      probeCache = JSON.parse(wx.getStorageSync(PROBE_KEY) || "");
    } catch (e) {
      probeCache = {};
    }
  }
  return typeof probeCache === "object" && probeCache ? probeCache : {};
}

function stamp(rev) {
  const r = String(rev || "");
  if (r) {
    const p = probe();
    if (p.rev !== r) {
      p.rev = r;
      probeCache = p;
      try {
        wx.setStorageSync(PROBE_KEY, JSON.stringify(p));
      } catch (e) {
        probeCache = {};
      }
    }
  }
  return probe();
}

function bucketOf(id) {
  return (manifest().map || {})[id] || "";
}

const BUCKET_ARMED = [];

function onBucketReady(fn) {
  if (typeof fn === "function" && BUCKET_ARMED.indexOf(fn) < 0) BUCKET_ARMED.push(fn);
}

function armBucket(name, payload) {
  bucketCache[name] = payload;
  books().forEach(function (b) { armBook(b.id, payload); });
  BUCKET_ARMED.forEach(function (fn) { fn(name, payload); });
}

function bucket(name) {
  if (!bucketCache[name]) {
    const data = readJson(BUCKET_DIR + name + ".js", {});
    if (Object.keys(data).length) armBucket(name, data);
    else bucketCache[name] = data;
  }
  return bucketCache[name];
}

const SHARD_CACHE_KEY = "shards";
const SHARD_CACHE_MAX = 40;

let shardBox = null;
let shardBoxWx = null;

function shardCache() {
  if (shardBox && shardBoxWx === wx) return shardBox;
  const store = require("./store");
  const raw = store.read(SHARD_CACHE_KEY, {});
  shardBox = raw && typeof raw === "object" ? raw : {};
  shardBoxWx = wx;
  return shardBox;
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
  if (store.write(SHARD_CACHE_KEY, all)) return;
  delete all[name];
  if (shardBox === all) {
    shardBox = null;
    shardBoxWx = null;
  }
}

function shardFile(name) {
  if (!name || !SHARD_FILE_RE.test(name)) return "";
  return BUCKET_DIR + name + ".js";
}

function shardFromDisk(name) {
  const rel = shardFile(name);
  if (!rel) return null;
  if (!hasData()) return null;
  try {
    const raw = require("fs").readFileSync(require("path").join(__dirname, "..", rel), "utf8");
    const data = JSON.parse(raw);
    return data && Object.keys(data).length ? data : null;
  } catch (e) {
    return null;
  }
}

function ensureBucket(name) {
  if (!name) return Promise.reject(shardError("E_NO_BUCKET", "没有这一片的名字"));
  const local = bucket(name);
  if (Object.keys(local).length) return Promise.resolve({ data: local, from: "local" });

  const cached = shardCache()[name];
  if (cached && cached.data) {
    armBucket(name, cached.data);
    return Promise.resolve({ data: cached.data, from: "local" });
  }

  const disk = shardFromDisk(name);
  if (disk) {
    armBucket(name, disk);
    saveShard(name, disk);
    return Promise.resolve({ data: disk, from: "disk" });
  }

  const remote = require("./remote");
  if (!remote.shardReady()) return Promise.reject(shardError("E_NO_SHARD_SERVICE", "分片服务没接上"));

  return remote.shard(name).then(function (data) {
    const payload = (data && data.t) || data || {};
    if (!payload || !Object.keys(payload).length) throw shardError("E_EMPTY_SHARD", "这一片是空的");
    armBucket(name, payload);
    saveShard(name, payload);
    return { data: payload, from: "remote" };
  });
}

function ensureEntry(id) {
  const inPack = courseTexts()[id];
  if (inPack) return Promise.resolve(inPack);

  const name = bucketOf(id);
  if (!name) return Promise.reject(shardError("E_NO_ENTRY", "分片清单里没有这一条：" + id));

  return ensureBucket(name).then(function (r) {
    const hit = r.data[id] || null;
    if (!hit || !hit.text) throw shardError("E_NO_TEXT", "这一片里没有这一条的正文：" + id);
    return arm(indexById(id), hit) || hit;
  });
}

function shardError(code, message) {
  const e = new Error(message);
  e.code = code;
  e.expected = true;
  return e;
}

function withTranslation(p, payload) {
  if (!p || !payload) return null;
  p.text = payload.text || "";
  p.translation = payload.translation || "";
  p.src = payload.src || "";
  p.tr = p.translation;
  return p;
}

function arm(p, payload) {
  return p && payload && p.at >= 0 ? withTranslation(p, payload) : p;
}

function armBook(bookId, payload) {
  const rows = bookCache[bookId];
  if (!rows || !payload) return;
  const ids = Object.keys(payload);
  rows.forEach(function (p) {
    if (p.at >= 0 && ids[p.at] === p.id) arm(p, payload[p.id]);
  });
}

function entry(id) {
  const inPack = courseTexts()[id];
  if (inPack) return withTranslation(indexById(id), inPack) || inPack;
  const name = bucketOf(id);
  if (!name) return null;
  const hit = bucket(name)[id] || null;
  if (!hit) return null;
  const meta = indexById(id);
  return meta ? arm(meta, hit) : hit;
}

function forgetText(id) {
  const name = bucketOf(id);
  if (!name || !bucketCache[name]) return;
  delete bucketCache[name];
  const all = shardCache();
  if (!all[name]) return;
  delete all[name];
  if (require("./store").write(SHARD_CACHE_KEY, all)) return;
  shardBox = null;
  shardBoxWx = null;
}

function entries(ids) {
  const out = {};
  (ids || []).forEach((id) => {
    const e = entry(id);
    if (e) out[id] = e;
  });
  return out;
}

function ownerOf(id) {
  const all = books();
  let best = "";
  const s = String(id || "");
  for (let i = 0; i < all.length; i++) {
    const b = all[i].id;
    if (s.indexOf(b + "-") === 0 && b.length > best.length) best = b;
  }
  return best;
}

function indexById(id) {
  if (idIndex[id]) return idIndex[id];
  const owner = ownerOf(id);
  const hit = owner ? pick(ofBook(owner), id) : null;
  if (hit) return hit;
  const all = books();
  for (let i = 0; i < all.length; i++) {
    const other = pick(ofBook(all[i].id), id);
    if (other) return other;
  }
  return null;
}

function bookOf(id) {
  if (idBook[id] !== undefined) return idBook[id];
  const meta = indexById(id);
  return (meta && meta.b) || "";
}

function pick(rows, id) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === id) return rows[i];
  }
  return null;
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

const LOWER_FIELDS = ["t", "a", "d", "s", "g"];

function matchTextOf(p) {
  const parts = [];
  for (let i = 0; i < LOWER_FIELDS.length; i++) {
    const v = p[LOWER_FIELDS[i]];
    if (v) parts.push(String(v).toLowerCase());
  }
  return parts.join("\n");
}

function matchEntry(p, kw) {
  return (p.lb === undefined ? matchTextOf(p) : p.lb).indexOf(kw) >= 0;
}

function searchAt(bookId, keyword) {
  const kw = String(keyword || "").trim().toLowerCase();
  if (!kw || !bookId) return { at: [], total: 0 };
  const pool = ofBook(bookId);
  const at = [];
  for (let i = 0; i < pool.length; i++) {
    if (matchEntry(pool[i], kw)) at.push(i);
  }
  return { at: at, total: at.length };
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
  splitDisplay,
  layout,
  books,
  bookById,
  ownerOf,
  bookOf,
  ofBook,
  course,
  courseTexts,
  withTranslation,
  manifest,
  bucketOf,
  bucket,
  ensureBucket,
  ensureEntry,
  forgetText,
  onBucketReady,
  entry,
  entries,
  indexById,
  search,
  searchAt,
  grouped,
  matchEntry,
  hasData,
  stamp,
};
