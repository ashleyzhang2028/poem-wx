const CLAUSE_SPLIT = /[\n，。！？；：、]/;

const CLOSING = /[」』”’）》〉]/;

function isClauseEnd(ch, next) {
  return CLAUSE_SPLIT.test(ch) && !CLOSING.test(next);
}

function splitClauses(line) {

  const s = [];
  const chars = Array.from(String(line));
  let buf = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (isClauseEnd(ch, chars[i + 1] || "")) {
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
      const chars = Array.from(line);
      let buf = "";
      for (let i = 0; i < chars.length; i++) {
        buf += chars[i];
        if (isClauseEnd(chars[i], chars[i + 1] || "")) {
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

let booksCache = null;
const idIndex = {};
const idBook = {};
let indexCache = null;
let courseCache = null;
const bookCache = {};

const PACKED = {
  books: function () {
    return require("../data/books/books.js");
  },
  catalogs: function () {
    return require("../data/books/catalogs.js");
  },
  index: function () {
    return require("../data/books/index.js");
  },
  course: function () {
    return require("../data/course.js");
  }
};

const FIELDS = ["id", "t", "a", "d", "at", "s", "g", "sel", "gr", "tm", "aka", "an"];

let dataReady = null;

const BUILD_KEY = "kb_build_v1";

let buildCache = null;

function buildProbe() {
  if (!buildCache) {
    try {
      buildCache = JSON.parse(wx.getStorageSync(BUILD_KEY) || "");
    } catch (e) {
      buildCache = {};
    }
  }
  return typeof buildCache === "object" && buildCache ? buildCache : {};
}

const LEGACY = ["kb_probe_v1", "shards"];

function dropLegacy() {
  let keys = LEGACY.slice();
  try {
    keys = keys.concat(wx.getStorageInfoSync().keys || []);
  } catch (e) {
    keys = LEGACY.slice();
  }
  keys.forEach(function (k) {
    if (LEGACY.indexOf(k) < 0) return;
    try { wx.removeStorageSync(k); } catch (e) { return; }
  });
}

function stamp(rev) {
  const r = String(rev || "");
  if (r) {
    const p = buildProbe();
    if (p.rev !== r) {
      p.rev = r;
      buildCache = p;
      try {
        wx.setStorageSync(BUILD_KEY, JSON.stringify(p));
      } catch (e) {
        buildCache = {};
      }
    }
  }
  return buildProbe();
}

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
  const all = booksOf();
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

let catalogCache = null;

function catalogs() {
  if (catalogCache === null) {
    const pack = packed("catalogs");
    catalogCache = pack && pack.books ? pack : false;
  }
  return catalogCache || null;
}

function booksOf() {
  const pack = catalogs();
  if (!pack) return books();
  const counts = {};
  pack.books.forEach(function (b) { counts[b.id] = b.count; });
  return books().map(function (b) {
    if (counts[b.id] === undefined) return b;
    return { id: b.id, name: b.name, page: b.page, unit: b.unit, count: counts[b.id], remote: true };
  });
}

function catalog(bookId) {
  const pack = catalogs();
  if (!pack || !pack.rows[bookId]) return null;
  const meta = pack.books.filter(function (b) { return b.id === bookId; })[0] || null;
  if (!meta) return null;
  const rows = pack.rows[bookId].map(function (raw, i) {
    const id = bookId + "-" + (i + 1);
    return {
      id: id,
      sid: pack.ids[id] || "",
      t: raw[0],
      a: field(pack.dict, "a", raw[1]),
      an: field(pack.dict, "d", raw[2]),
      d: "",
      n: meta.name,
      b: bookId,
      g: "",
      inCourse: raw[3] === 1,
      remote: true
    };
  });
  return { id: bookId, name: meta.name, unit: meta.unit, count: meta.count, rows: rows };
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
    const built = catalog(bookId);
    if (built) {
      bookCache[bookId] = built.rows;
      return built.rows;
    }
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

function ensureEntry(id) {
  const inPack = courseTexts()[id];
  if (inPack) return Promise.resolve(withTranslation(indexById(id), inPack) || inPack);
  return Promise.reject(missError("E_NO_TEXT", "这一篇的正文不在这个包里：" + id));
}

function missError(code, message) {
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

function entry(id) {
  const inPack = courseTexts()[id];
  if (inPack) return withTranslation(indexById(id), inPack) || inPack;
  return null;
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
  const all = booksOf();
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
  const sources = bookId ? [bookId] : booksOf().map((b) => b.id);
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
  booksOf,
  catalog,
  bookById,
  ownerOf,
  bookOf,
  ofBook,
  course,
  courseTexts,
  withTranslation,
  dropLegacy,
  ensureEntry,
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
