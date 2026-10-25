const remote = require("./remote");
const store = require("./store");

const NAME = "诗泉";

const CAPS = {
  poems: "/poems",
  search: "/poems/search",
  random: "/poems/random",
  authors: "/authors",
  dynasties: "/dynasties",
  types: "/types",
  stats: "/stats",
  health: "/health"
};

const TTL_MS = 5 * 60 * 1000;

const FRESH_MS = 24 * 60 * 60 * 1000;

const CACHE_MAX = 60;

const CACHE_KEY = "kb_poem_source_cache_v1";

const STATE_KEY = "kb_poem_source_state_v1";

const PAGE_MAX = 100;

const SEO_MAX = 200;

const HEALTH_STALE_MS = 10 * 60 * 1000;

let cache = null;
let cacheWx = null;

function cacheBox() {
  if (cache && cacheWx === wx) return cache;
  const raw = store.read(CACHE_KEY, {});
  cache = raw && typeof raw === "object" ? raw : {};
  cacheWx = wx;
  return cache;
}

function cacheGet(key) {
  const row = cacheBox()[key];
  if (!row || typeof row.at !== "number") return null;
  if (Date.now() - row.at > FRESH_MS) {
    delete cacheBox()[key];
    return null;
  }
  return row.v;
}

function cachePut(key, value) {
  const box = cacheBox();
  const keys = Object.keys(box);
  if (keys.length >= CACHE_MAX) {
    keys.sort((a, b) => (box[a].at || 0) - (box[b].at || 0));
    keys.slice(0, keys.length - CACHE_MAX + 1).forEach((k) => delete box[k]);
  }
  box[key] = { at: Date.now(), v: value };
  if (!store.write(CACHE_KEY, box)) {
    cache = null;
    cacheWx = null;
  }
}

function state() {
  return store.read(STATE_KEY, {}) || {};
}

function markDown(reason) {
  const now = Date.now();
  const keep = state();
  if (now - (keep.at || 0) < 30000 && keep.ok === false && keep.reason === reason) return;
  store.write(STATE_KEY, { at: now, ok: false, reason: reason || "" });
}

function markUp() {
  const keep = state();
  if (keep.ok === true && Date.now() - (keep.at || 0) < HEALTH_STALE_MS) return;
  store.write(STATE_KEY, { at: Date.now(), ok: true, reason: "" });
}

function readiness() {
  const hard = hardOff();
  if (hard) return { visible: true, usable: false, state: "denied", reason: hard };
  const down = state();
  if (down.ok === false && Date.now() - (down.at || 0) < HEALTH_STALE_MS) {
    return { visible: true, usable: false, state: "awaiting", reason: down.reason || "通道还没接上" };
  }
  return { visible: true, usable: true, state: "ready", reason: "" };
}

function usable() {
  return readiness().usable;
}

function hardOff() {
  if (!remote.configured()) return "还没接上同步服务器";
  return "";
}

function qs(params) {
  const parts = [];
  Object.keys(params || {}).forEach((k) => {
    const v = params[k];
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) {
      v.forEach((x) => parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(x))));
      return;
    }
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
  });
  return parts.length ? "?" + parts.join("&") : "";
}

function failure(err) {
  const e = new Error((err && (err.errMsg || err.message)) || "取不到诗泉");
  e.code = (err && err.code) || "E_POEM_SOURCE";
  e.expected = true;
  e.statusCode = Number(err && err.statusCode) || 0;
  e.source = NAME;
  markDown(e.message);
  return e;
}

function call(path, params, opt) {
  const o = opt || {};
  const key = path + qs(params);
  if (!o.fresh) {
    const hit = cacheGet(key);
    if (hit) return Promise.resolve(hit);
  }
  const hard = hardOff();
  if (hard) return Promise.reject(failure({ message: hard, code: "E_POEM_SOURCE_OFF" }));

  return remote
    .source(path, params, { timeout: o.timeout })
    .then((res) => {
      markUp();
      if (o.fresh) return res;
      cachePut(key, res);
      return res;
    }, (err) => {
      throw failure(err);
    });
}

function data(res) {
  if (res && res.data !== undefined) return res.data;
  return res;
}

function list(res) {
  const d = data(res);
  return Array.isArray(d) ? d : [];
}

function rows(res) {
  const d = data(res);
  if (Array.isArray(d)) return d;
  return [];
}

function paged(res) {
  const d = data(res);
  const page = (res && res.pagination) || {};
  return {
    items: Array.isArray(d) ? d : [],
    total: Number(page.total) || 0,
    page: Number(page.page) || 0,
    size: Number(page.page_size) || 0,
    pages: Number(page.total_pages) || 0,
    cursor: String(page.next_cursor || ""),
    more: !!page.has_next_page
  };
}

function health() {
  return call(CAPS.health, {}, { fresh: true, timeout: 8000 }).then(
    (res) => ({ ok: true, note: (res && res.status) || "healthy" }),
    (err) => ({ ok: false, note: err.message || "通道还没接上" })
  );
}

function stats() {
  return call(CAPS.stats, {});
}

function dynasties() {
  return call(CAPS.dynasties, {}).then(rows);
}

function types() {
  return call(CAPS.types, {}).then(rows);
}

function authors(page, size) {
  return call(CAPS.authors, { page: page || 1, page_size: Math.min(PAGE_MAX, size || 20) }).then(paged);
}

function author(id) {
  if (!id) return Promise.reject(failure({ message: "没有给作者 id", code: "E_BAD_ID" }));
  return call(CAPS.authors + "/" + encodeURIComponent(String(id)), {}).then(data);
}

function poems(query) {
  const q = Object.assign({ page_size: 20 }, query || {});
  q.page_size = Math.min(PAGE_MAX, Number(q.page_size) || 20);
  return call(CAPS.poems, q).then(paged);
}

function search(keyword, opt) {
  const o = opt || {};
  const q = {
    q: keyword,
    type: o.type || "all",
    page: o.page || 1,
    page_size: Math.min(PAGE_MAX, Number(o.size) || 20)
  };
  return call(CAPS.search, q).then(paged);
}

function random(opt) {
  return call(CAPS.random, opt || {}, { fresh: true }).then(data);
}

function poem(id) {
  return call("/poems/" + encodeURIComponent(String(id)), {}).then(data);
}

function byChar(char) {
  if (!char) return Promise.reject(failure({ message: "没有给令字", code: "E_BAD_CHAR" }));
  return call(CAPS.random, { char: char }, { fresh: true }).then(data);
}

function linesOf(poem) {
  const c = poem && poem.content;
  if (Array.isArray(c)) return c.map((x) => String(x == null ? "" : x).trim()).filter(Boolean);
  return String(c == null ? "" : c)
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function textOf(poem) {
  return linesOf(poem).join("\n");
}

function metaOf(poem) {
  const p = poem || {};
  return {
    id: p.id === undefined ? "" : String(p.id),
    t: String(p.title || ""),
    a: String((p.author && p.author.name) || ""),
    d: String((p.dynasty && p.dynasty.name) || ""),
    g: String((p.type && p.type.name) || ""),
    text: textOf(p),
    lines: linesOf(p)
  };
}

function withMeta(meta, poem) {
  const p = meta || {};
  const entry = asEntry(poem);
  entry.id = String(p.id || entry.id);
  entry.t = String(p.t || entry.t);
  entry.a = String(p.a || entry.a);
  entry.d = String(p.d || entry.d);
  entry.n = String(p.n || entry.n);
  entry.b = String(p.b || entry.b);
  entry.g = String(p.g || entry.g);
  entry.src = "";
  return entry;
}

function asEntry(poem) {
  const p = poem || {};
  return {
    id: p.id === undefined ? "" : String(p.id),
    t: String(p.title || ""),
    a: String((p.author && p.author.name) || ""),
    d: String((p.dynasty && p.dynasty.name) || ""),
    g: String((p.type && p.type.name) || ""),
    n: String((p.type && p.type.name) || NAME),
    b: "source",
    text: textOf(p),
    translation: "",
    src: "",
    tr: "",
    source: NAME
  };
}

function asResult(poem, keyword) {
  const p = poem || {};
  const kw = String(keyword || "");
  const lines = kw ? linesOf(p).filter((l) => l.indexOf(kw) >= 0) : [];
  return {
    id: p.id === undefined ? "" : String(p.id),
    title: String(p.title || ""),
    author: String((p.author && p.author.name) || ""),
    dynasty: String((p.dynasty && p.dynasty.name) || ""),
    bookName: String((p.type && p.type.name) || NAME),
    lines: lines.slice(0, 2),
    source: NAME
  };
}

function charCount(char) {
  return search(char, { type: "content", size: 1 }).then((r) => r.total);
}

function segments(poem, gated) {
  const out = [];
  const seen = {};
  linesOf(poem).forEach((line) => {
    String(line)
      .split(/[，。！？；：、]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((seg) => {
        if (gated !== false && (seg.length < 5 || seg.length > 20)) return;
        if (seen[seg]) return;
        seen[seg] = 1;
        out.push(seg);
      });
  });
  return out;
}

function forget() {
  store.drop(CACHE_KEY);
  cache = null;
  cacheWx = null;
}

function probe() {
  if (usable()) return Promise.resolve(readiness());
  return health().then((h) => (h.ok ? readiness() : { visible: true, usable: false, state: "awaiting", reason: h.note }));
}

module.exports = {
  NAME,
  CAPS,
  TTL_MS,
  PAGE_MAX,
  SEO_MAX,
  readiness,
  usable,
  probe,
  health,
  stats,
  dynasties,
  types,
  authors,
  author,
  poems,
  search,
  random,
  poem,
  byChar,
  charCount,
  linesOf,
  textOf,
  metaOf,
  asEntry,
  withMeta,
  asResult,
  segments,
  forget
};
