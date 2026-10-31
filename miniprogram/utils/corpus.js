let indexFallback = null;

function useIndexFallback(fn) {
  indexFallback = fn;
}

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

const FS_POEM = [27, 30, 33, 36, 39, 42, 46, 52, 58, 64, 72];

const PY_BOX = [31, 34, 37, 40, 44, 47, 51, 58, 64, 70, 78];

const PY_GAP = 1;

const MEASURE = 630;

const COUPLET_MAX = 2;

const FIXED_MIN = 4;

const FIXED_MAX = 9;

const STANZA_MAX_ROWS = 12;

const PROSE_LINE_HAN = 40;

const PROSE_MULTI_SENTENCE = 0.25;

const PROSE_QUOTE_MULTI = 0.2;

const PROSE_SPREAD = 0.2;

const PROSE_MIN_HAN = 60;

const PROSE_LONG_LINE_SHARE = 0.5;

const LONG_TEXT_HAN = 250;

const LONG_TEXT_LINE_HAN = 24;

const LONG_TEXT_SPREAD = 0.3;

const PINYIN_MAX_HAN = 1200;

const CI_TITLE = /^[^·]+·[^·]+$/;

const PROSE_PARA_HAN = 80;

const QUOTE = /[“”「」『』]/;

const SENTENCE_END = /[。！？”」』]$/;

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
  const title = String((opts && opts.title) || "");
  const memoKey = size + "|" + (pinyin ? 1 : 0) + "|" + title + "|" + raw;
  if (layoutMemo[memoKey]) return layoutMemo[memoKey];
  const out = layoutOf(raw, size, pinyin, title);
  layoutMemo[memoKey] = out;
  layoutMemoKeys.push(memoKey);
  if (layoutMemoKeys.length > LAYOUT_MEMO_MAX) delete layoutMemo[layoutMemoKeys.shift()];
  return out;
}

function clauseSpread(all) {
  const lens = all.map(hanLen).filter((n) => n > 0);
  if (!lens.length) return 0;
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const variance = lens.reduce((a, b) => a + (b - mean) * (b - mean), 0) / lens.length;
  return Math.sqrt(variance) / mean;
}

function multiSentenceShare(lines) {
  const body = lines.filter((ln) => ln.s.length);
  if (!body.length) return 0;
  return body.filter((ln) => /[。！？][^。！？”」』]/.test(ln.line)).length / body.length;
}

function isProse(text, lines, all, title) {
  const body = lines.filter((ln) => ln.s.length);
  const total = hanLen(text);
  const bulky = total >= LONG_TEXT_HAN;
  if (!all.length || fixedVerse(all) > 0) return false;
  if (bulky && total / body.length >= LONG_TEXT_LINE_HAN) return true;
  const named = CI_TITLE.test(title);
  if (bulky && !named && clauseSpread(all) >= LONG_TEXT_SPREAD) return true;
  const long = body.filter((ln) => hanLen(ln.line) > PROSE_LINE_HAN).length;
  if (!named && body.length && long / body.length >= PROSE_LONG_LINE_SHARE) return true;
  if (named || total < PROSE_MIN_HAN) return false;
  const multi = multiSentenceShare(lines);
  if (QUOTE.test(text) && multi >= PROSE_QUOTE_MULTI) return true;
  return multi >= PROSE_MULTI_SENTENCE && clauseSpread(all) >= PROSE_SPREAD;
}

function proseOf(lines, merge) {
  const paras = [];
  let pending = [];
  let han = 0;
  const close = () => {
    if (pending.length) paras.push([pending]);
    pending = [];
    han = 0;
  };
  lines.forEach((ln) => {
    if (!ln.s.length) {
      close();
      return;
    }
    if (!hanLen(ln.line)) {
      if (pending.length) pending[pending.length - 1] += ln.line.trim();
      return;
    }
    pending = pending.concat(ln.s);
    han += hanLen(ln.line);
    if (!merge || (han >= PROSE_PARA_HAN && SENTENCE_END.test(pending[pending.length - 1]))) close();
  });
  close();
  return paras;
}

function plainOf(paras) {
  return paras.map((para) => para.map((row) => row.join("")));
}

function layoutOf(text, size, pinyin, title) {
  const lines = splitLines(text);
  const clauses = lines.reduce((acc, ln) => acc.concat(ln.s), []);
  if (isProse(text, lines, clauses, title)) {
    const prosePara = proseOf(lines, hanLen(text) / Math.max(1, lines.filter((ln) => ln.s.length).length) < LONG_TEXT_LINE_HAN);
    return {
      rows: prosePara.map((p) => p[0].join("")),
      paras: prosePara,
      plain: plainOf(prosePara),
      verse: false,
      prose: true,
      loose: false
    };
  }
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

    if (!hanLen(ln.line)) {
      if (pending.length) pending[pending.length - 1] += ln.line.trim();
      else if (stanza.length) stanza[stanza.length - 1][stanza[stanza.length - 1].length - 1] += ln.line.trim();
      return;
    }

    if (cap === Infinity) pushRows([ln.s]);
    else pending = pending.concat(ln.s);
  });
  commit();
  closeStanza();

  const limit = Math.max(1, Math.floor(MEASURE / charWidth(size, pinyin)));
  const loose = cap === Infinity && flat.some((row) => row.reduce((n, cl) => n + costOf(cl), 0) > limit);

  return { rows: flat.map((row) => row.join("")), paras: paras, plain: plainOf(paras), verse: cap !== Infinity, prose: false, loose: loose };
}

const COURSE_BOOK = "poems";

let courseCache = null;
const idIndex = {};
const idBook = {};
const bookCache = {};

const FIELDS = ["id", "t", "a", "d", "s", "g", "sel", "gr", "tm", "an", "aka"];

const SCOPES = {
  core: ["books", "poems"],
  catalogs: ["books", "poems", "catalogs"],
  authors: ["books", "poems", "catalogs", "authors"]
};

const STALE_MS = 6 * 3600 * 1000;

const parts = {};
const inflight = {};
const bookTexts = {};

function cacheKey(part) {
  return "kb_corpus_" + part + "_v1";
}

function partKey(part, book) {
  return book ? part + ":" + book : part;
}

function held(part, book) {
  const key = partKey(part, book);
  if (parts[key] === undefined) {
    let raw = null;
    try {
      raw = typeof wx !== "undefined" ? wx.getStorageSync(cacheKey(key)) : null;
    } catch (e) {
      raw = null;
    }
    parts[key] = raw && typeof raw === "object" && raw.rev && raw.data ? raw : null;
  }
  return parts[key];
}

function dataOf(part) {
  const h = held(part);
  return h ? h.data : null;
}

function forget() {
  Object.keys(idIndex).forEach((k) => delete idIndex[k]);
  Object.keys(idBook).forEach((k) => delete idBook[k]);
  Object.keys(bookCache).forEach((k) => delete bookCache[k]);
  Object.keys(bookTexts).forEach((k) => delete bookTexts[k]);
}

function install(part, payload, book) {
  const key = partKey(part, book);
  const data = Object.assign({}, payload);
  delete data.rev;
  parts[key] = { rev: String(payload.rev), at: Date.now(), data: data };
  forget();
}

function persist(part, book) {
  const key = partKey(part, book);
  try {
    wx.setStorageSync(cacheKey(key), parts[key]);
  } catch (e) {
    return;
  }
}

function missing(scope) {
  return (SCOPES[scope || "core"] || SCOPES.core).filter((part) => !held(part));
}

function isReady(scope) {
  return missing(scope).length === 0;
}

function corpusError(part, cause) {
  const e = new Error("语料「" + part + "」没取到：" + ((cause && cause.message) || "网络不可用"));
  e.code = "E_NO_CORPUS";
  e.expected = true;
  return e;
}

function shaped(part, res) {
  if (!res || typeof res !== "object" || !res.rev) return false;
  if (part === "books") return Array.isArray(res.books) && res.books.length > 0;
  if (part === "poems") return Array.isArray(res.rows) && !!res.dict;
  if (part === "catalogs") return !!res.rows && !!res.dict;
  if (part === "texts") return !!res.rows && !!res.dict;
  if (part === "gloss") return !!res.rows && !!res.dict;
  return !!res.era;
}

function fetchPart(part, book) {
  const key = partKey(part, book);
  if (inflight[key]) return inflight[key];
  const have = held(part, book);
  const query = "?" + (book ? "book=" + encodeURIComponent(book) + "&" : "") +
    (have ? "rev=" + encodeURIComponent(have.rev) : "");
  const settle = () => { delete inflight[key]; };
  inflight[key] = Promise.resolve().then(() => {
    const remote = require("./remote");
    return remote.request(remote.PATHS.corpus + "/" + part + query, {}, "GET");
  }).then((res) => {
    if (res && res.same === true && have) {
      have.at = Date.now();
      persist(part, book);
      return false;
    }
    if (!shaped(part, res)) throw new Error("应答不完整");
    install(part, res, book);
    persist(part, book);
    return true;
  }).then((changed) => {
    settle();
    return changed;
  }, (err) => {
    settle();
    throw corpusError(part, err);
  });
  return inflight[key];
}

function ready(scope) {
  const need = missing(scope);
  if (!need.length) return Promise.resolve(true);
  return Promise.all(need.map(fetchPart)).then(() => true);
}

function refresh() {
  const now = Date.now();
  const due = Object.keys(parts).filter((part) => parts[part] && now - parts[part].at > STALE_MS);
  return Promise.all(due.map((part) => fetchPart(part).catch(() => false)));
}

function warm() {
  return ready("core")
    .then(() => ready("authors"))
    .catch(() => false)
    .then(() => refresh());
}

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
  return isReady("core");
}

function books() {
  const pack = dataOf("books");
  return pack ? pack.books : [];
}

function booksOf() {
  return books();
}

function bookById(id) {
  const all = books();
  for (let i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

function catalog(bookId) {
  const pack = dataOf("catalogs");
  const meta = bookById(bookId);
  if (!pack || !meta || !meta.remote || !pack.rows[bookId]) return null;
  const prefix = meta.prefix || bookId;
  const rows = pack.rows[bookId].map(function (raw, i) {
    return {
      id: bookId + "-" + (i + 1),
      sid: prefix + "-" + (i + 1),
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
  if (bookCache[bookId]) return bookCache[bookId];
  const meta = bookById(bookId);
  if (!meta) return [];
  const built = catalog(bookId);
  if (built) {
    bookCache[bookId] = built.rows;
    return built.rows;
  }
  const pack = bookId === COURSE_BOOK ? dataOf("poems") : null;
  if (!pack) return [];
  const list = pack.rows.map(function (raw) {
    const p = rowOf(pack.dict, raw, bookId);
    p.n = meta.name;
    idIndex[p.id] = p;
    if (idBook[p.id] === undefined) idBook[p.id] = bookId;
    p.lb = matchTextOf(p);
    return p;
  });
  bookCache[bookId] = list;
  return list;
}

function course() {
  return ofBook(COURSE_BOOK);
}

function authorEras() {
  const pack = dataOf("authors");
  return pack ? pack.era : {};
}

function courseTexts() {
  if (!courseCache) {
    try {
      courseCache = require("../data/course.js");
    } catch (e) {
      courseCache = {};
    }
  }
  return courseCache;
}

function ensureEntry(id) {
  const inPack = courseTexts()[id];
  if (inPack) return Promise.resolve(withTranslation(indexById(id), inPack) || inPack);
  return Promise.reject(missError("E_NO_TEXT", "本篇正文不在当前版本中：" + id));
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
  p.gloss = payload.gloss || null;
  return p;
}

function entry(id) {
  const inPack = courseTexts()[id];
  if (inPack) return withTranslation(indexById(id), inPack) || inPack;
  return null;
}

function textsOf(bookId) {
  if (bookTexts[bookId] !== undefined) return bookTexts[bookId];
  const pack = dataOf("texts:" + bookId);
  if (!pack || !pack.rows) {
    bookTexts[bookId] = null;
    return null;
  }
  const map = {};
  (pack.rows[bookId] || []).forEach((raw) => {
    const translation = raw[4] || "";
    if (!raw[3]) return;
    map[raw[0]] = {
      t: raw[1],
      sid: raw[2],
      text: raw[3],
      tr: translation,
      src: field(pack.dict, "s", raw[5]) || "",
      gloss: null
    };
  });
  bookTexts[bookId] = map;
  return map;
}

function notesOf(bookId) {
  const pack = dataOf("gloss:" + bookId);
  if (!pack || !pack.rows) return null;
  const map = {};
  (pack.rows[bookId] || []).forEach((raw) => {
    if (Array.isArray(raw[2]) && raw[2].length) map[raw[0]] = raw[2];
  });
  return map;
}

function catalogText(meta) {
  const book = meta && meta.b;
  if (!book || !meta.remote) return null;
  if (!held("texts", book)) {
    fetchPart("texts", book).catch(() => false);
    return null;
  }
  const map = textsOf(book);
  const row = map && map[meta.id];
  return row || null;
}

function catalogGloss(meta) {
  const book = meta && meta.b;
  if (!book || !meta.remote) return null;
  if (!held("gloss", book)) {
    fetchPart("gloss", book).catch(() => false);
    return null;
  }
  const map = notesOf(book);
  return (map && map[meta.id]) || null;
}

function courseTwin(meta) {
  if (!meta || !meta.inCourse) return null;
  const rows = ofBook("poems");
  for (let i = 0; i < rows.length; i++) {
    const names = [rows[i].t].concat(rows[i].aka || []);
    if (rows[i].a === meta.a && names.indexOf(meta.t) >= 0) return rows[i];
  }
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
  return indexFallback ? indexFallback(id) : null;
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
  PINYIN_MAX_HAN,
  hanCount: hanLen,
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
  catalogText,
  catalogGloss,
  entries,
  courseTwin,
  indexById,
  useIndexFallback,
  search,
  searchAt,
  grouped,
  matchEntry,
  hasData,
  stamp,
  install,
  isReady,
  ready,
  refresh,
  warm,
  authorEras,
};
