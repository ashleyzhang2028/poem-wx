const source = require("../../../utils/poem-source");
const ling = require("./ling-index");
const corpus = require("../../../utils/corpus");

const SCAN = 100;

const SCAN_MAX = 20;

const PAGE_KEEP = 2;

const QUERY_MAX = 20;

const CACHE_MAX = 4;

function selOf(scope) {
  return ling.selectionOf(scope);
}

function usable(scope) {
  if (!source.usable()) return false;
  return !scope || scope === "any" || !!selOf(scope);
}

function linesOf(poem) {
  const lines = source.linesOf(poem);
  if (lines.length) return lines;
  return corpus.splitLines(source.textOf(poem)).map((ln) => ln.line);
}

function split(line) {
  return String(line).split(/[，。！？；：、,.!?;:]/).map((x) => x.trim()).filter(Boolean);
}

function clean(seg) {
  return String(seg).replace(/[^\u3400-\u9fff]/g, "");
}

function segsWith(char, poem) {
  const out = [];
  linesOf(poem).forEach((line) => {
    String(line)
      .split(/[，。！？；：、,.!?;:]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((seg) => {
        if (seg.length < 5 || seg.length > 20) return;
        if (!split(seg).some((piece) => piece.indexOf(char) >= 0)) return;
        out.push(seg);
      });
  });
  return out;
}

function phraseOf(seg, char) {
  const pieces = split(seg);
  for (let i = 0; i < pieces.length; i += 1) {
    const at = pieces[i].indexOf(char);
    if (at >= 0) return pieces[i].slice(0, at + char.length);
  }
  return String(seg).trim();
}

function headOf(seg, char) {
  const phrase = phraseOf(seg, char);
  const at = String(seg).indexOf(phrase);
  const head = at >= 0 ? String(seg).slice(0, at + phrase.length) : phrase;
  return head.slice(0, QUERY_MAX);
}

function rowOf(poem, seg, char, tag) {
  const phrase = phraseOf(seg, char);
  const at = seg.indexOf(phrase);
  return {
    id: String(poem.id),
    originId: "",
    book: "",
    scope: "source",
    stage: "",
    seg: seg,
    title: String(poem.title || ""),
    author: String((poem.author && poem.author.name) || ""),
    dynasty: String((poem.dynasty && poem.dynasty.name) || ""),
    tags: [tag || source.NAME],
    remote: true,
    head: at < 0 ? phrase : seg.slice(0, at),
    hit: at < 0 ? "" : phrase,
    tail: at < 0 ? "" : seg.slice(at + phrase.length)
  };
}

const pools = {};
const order = [];

function poolOf(char, scope) {
  const key = scope + "|" + char;
  if (!pools[key]) {
    pools[key] = { key: key, char: char, scope: scope, rows: [], seen: {}, page: 1, more: true, error: null };
    order.push(key);
    if (order.length > CACHE_MAX) delete pools[order.shift()];
  }
  return pools[key];
}

function forget() {
  Object.keys(pools).forEach((k) => delete pools[k]);
  order.length = 0;
}

function take(pool, poems) {
  const tag = (selOf(pool.scope) || {}).name || source.NAME;
  (poems || []).forEach((poem) => {
    segsWith(pool.char, poem).forEach((seg) => {
      const key = clean(seg);
      if (!key || pool.seen[key]) return;
      pool.seen[key] = 1;
      pool.rows.push(rowOf(poem, seg, pool.char, tag));
    });
  });
}

function queryOf(pool) {
  const sel = selOf(pool.scope);
  if (!sel) return pool.char;
  const last = pool.rows[pool.rows.length - 1];
  return headOf(last ? last.seg : pool.char, pool.char);
}

function scan(pool) {
  const page = pool.page;
  const q = queryOf(pool);
  return source.search(q, { type: "content", size: SCAN, page: page })
    .then((res) => {
      const items = res.items || [];
      take(pool, items);
      pool.page = page + 1;
      pool.more = !!res.more && items.length > 0 && page < SCAN_MAX;
      return pool;
    }, (err) => {
      pool.more = false;
      pool.error = err;
      return pool;
    });
}

function fill(pool, want) {
  if (pool.rows.length >= want || !pool.more) return Promise.resolve(pool);
  return scan(pool).then(() => fill(pool, want));
}

function next(char, scope, want) {
  const key = String(char || "").trim();
  if (!key || !usable(scope)) {
    return Promise.resolve({ items: [], more: false, filled: 0, error: null });
  }
  const pool = poolOf(key, scope);
  const before = pool.rows.length;
  return fill(pool, before + Math.max(1, Number(want) || ling.PAGE)).then(() => ({
    items: pool.rows.slice(before),
    more: pool.more,
    filled: pool.rows.length - before,
    error: pool.error
  }));
}

module.exports = {
  usable,
  next,
  forget,
  clean,
  headOf
};
