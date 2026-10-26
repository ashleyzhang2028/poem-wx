const corpus = require("../../../utils/corpus");
const gameScopes = require("../../../utils/game-scopes");
const source = require("../../../utils/poem-source");

const LIMIT = 60;

const SEARCH_PAGE = 50;

const LOOK_PAGES = 4;

const QUERY_MAX = 20;

const JUDGE_PAGES = 2;

const JUDGE_MS = 6000;

const LOOK_MS = 8000;

const LEVELS = [
  { id: "easy", name: "常见字", min: 25 },
  { id: "normal", name: "一般字", min: 6 },
  { id: "hard", name: "难字", min: 1, max: 5 }
];

function _feihua_segsOf(text, gated) {
  const out = [];

  const seen = {};
  corpus.splitLines(text).forEach((ln) => {
    ln.s.forEach((seg) => {

      if (gated !== false && (seg.length < 5 || seg.length > 20)) return;
      if (seen[seg]) return;
      seen[seg] = 1;
      out.push(seg);
    });
  });
  return out;
}

function _feihua_allPoems(scope) {
  return gameScopes.field(scope);
}

const raceTimeout = source.withTimeout;

function onSource() {
  return source.usable();
}

function inputClauses(input) {
  return String(input || "")
    .split(/[\n，。！？；：、,.!?;:]/)
    .map(_feihua_strip)
    .filter((x) => x.length >= 2);
}

function judgeAtSource(char, input) {
  const ch = String(char || "").trim();
  const clauses = inputClauses(input);
  const lead = clauses.filter((c) => c.indexOf(ch) >= 0).sort((x, y) => y.length - x.length)[0];
  if (!ch || !lead) return Promise.resolve(null);
  return findAtSource(lead.slice(0, QUERY_MAX), clauses);
}

function segsOfPoem(poem) {
  const out = [];
  source.linesOf(poem).forEach((line) => {
    String(line).split(/[，。！？；：、,.!?;:]/).map(_feihua_strip).filter(Boolean).forEach((seg) => out.push(seg));
  });
  return out;
}

function runAt(segs, clauses) {
  for (let i = 0; i + clauses.length <= segs.length; i++) {
    if (clauses.every((c, j) => segs[i + j] === c)) return i;
  }
  return -1;
}

function findAtSource(q, clauses) {
  const hop = (page) => source.search(q, { type: "content", size: SEARCH_PAGE, page: page }).then((r) => {
    const hit = (r.items || []).find((p) => runAt(segsOfPoem(p), clauses) >= 0);
    if (hit) return { ok: true, hit: { id: String(hit.id), title: hit.title }, seg: clauses.join("，") };
    if (!r.more || page >= JUDGE_PAGES) return null;
    return hop(page + 1);
  });
  return hop(1);
}

function segsWith(char, poem) {
  const out = [];
  source.linesOf(poem).forEach((line) => {
    String(line)
      .split(/[，。！？；：、,.!?;:]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((seg) => {
        if (seg.indexOf(char) < 0) return;
        if (seg.length < 5 || seg.length > 20) return;
        out.push(seg);
      });
  });
  return out;
}

function lookAtSource(char, opt) {
  const ch = String(char || "").trim();
  if (!ch) return Promise.resolve([]);
  const limit = (opt && opt.limit) || LIMIT;
  const seen = {};
  ((opt && opt.exclude) || []).forEach((seg) => {
    seen[_feihua_strip(seg)] = 1;
  });
  const out = [];
  const hop = (page) => source.search(ch, { type: "content", size: SEARCH_PAGE, page: page }).then((r) => {
    (r.items || []).forEach((p) => {
      if (out.length >= limit) return;
      segsWith(ch, p).forEach((seg) => {
        if (out.length >= limit) return;
        const key = _feihua_strip(seg);
        if (seen[key]) return;
        seen[key] = 1;
        out.push({
          id: String(p.id),
          title: p.title,
          author: (p.author || {}).name || "",
          dynasty: (p.dynasty || {}).name || "",
          seg: seg
        });
      });
    });
    if (out.length >= limit || !r.more || page >= LOOK_PAGES) return out;
    return hop(page + 1);
  });
  return hop(1);
}

function _feihua_scopedPoems(opt) {
  const o = opt || {};
  const out = gameScopes.pool(o.scope);
  return out && out.length ? out : _feihua_allPoems();
}

let poolCache = {};

function pool(scope) {
  const cacheKey = gameScopes.cacheKeyOf(scope);
  if (poolCache[cacheKey]) return poolCache[cacheKey];

  const counts = {};
  _feihua_allPoems(scope).forEach((p) => {
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
    _feihua_segsOf(e.text).forEach((s) => {

      const counted = {};
      Array.from(s).forEach((ch) => {
        if (!/[\u3400-\u9fff]/.test(ch) || counted[ch]) return;
        counted[ch] = 1;
        counts[ch] = (counts[ch] || 0) + 1;
      });
    });
  });

  const out = {};
  Object.keys(counts).forEach((ch) => {
    const n = counts[ch];
    const level = n >= 25 ? "easy" : n >= 6 ? "normal" : "hard";
    out[ch] = { char: ch, count: n, level };
  });
  poolCache[cacheKey] = out;
  return out;
}

function _feihua_chars(levelId, limit, scope) {
  const all = pool(scope);
  const lv = LEVELS.find((l) => l.id === levelId) || LEVELS[1];
  const list = Object.keys(all)
    .map((c) => all[c])
    .filter((it) => (lv.max ? it.count <= lv.max : it.count >= lv.min))
    .sort((a, b) => b.count - a.count);
  return list.slice(0, limit || 24);
}

function levelOf(id) {
  return LEVELS.find((l) => l.id === id) || LEVELS[1];
}

function look(char, opt) {
  const o = opt || {};
  const ch = String(char || "").trim();
  if (!ch) return [];
  const limit = o.limit || LIMIT;
  const out = [];

  (poolOfScope(o.scope)[ch] || []).forEach((r) => {
    if (out.length >= limit) return;
    out.push({ id: r.id, title: r.title, author: r.author, dynasty: r.dynasty, seg: r.seg });
  });

  return out;
}

function hint(char, opt) {
  const o = opt || {};
  const rows = look(char, Object.assign({ limit: parseInt(o.limit, 10) || 200 }, o));
  const seen = {};
  (o.exclude || []).forEach((t) => {
    seen[_feihua_strip(t)] = 1;
  });
  for (let i = 0; i < rows.length; i++) {
    const seg = _feihua_strip(rows[i].seg);
    if (seen[seg]) continue;
    return { head: seg.slice(0, 2), total: seg.length };
  }
  return null;
}

function _feihua_strip(s) {
  return String(s).replace(/[^\u3400-\u9fff]/g, "");
}

function judgeAsync(char, input, said, opt) {
  const scope = opt && opt.scope;
  const local = judge(char, input, said, scope);
  if (local.ok || local.why !== "absent" || !onSource()) return Promise.resolve(local);
  return raceTimeout(judgeAtSource(char, input), JUDGE_MS).then(
    (r) => r || local,
    () => Object.assign({}, local, { degraded: true })
  );
}

function judge(char, input, said, scope) {
  const ch = String(char || "").trim();
  const raw = String(input || "").trim();
  if (!ch) return { ok: false, why: "empty", reason: "先出一个令字" };
  if (!raw) return { ok: false, why: "empty", reason: "写一句带这个字的诗" };
  if (raw.indexOf(ch) < 0) return { ok: false, why: "char", reason: "这句里没有「" + ch + "」" };

  const clauses = inputClauses(raw);
  const mine = clauses.join("");
  if (mine.length < 4) return { ok: false, why: "short", reason: "太短了，至少写四字" };

  const used = {};
  (said || []).forEach((s) => {
    used[_feihua_strip(s)] = 1;
  });
  if (used[mine]) return { ok: false, why: "said", reason: "这一句说过了" };

  let hit = null;
  _feihua_allPoems(scope).forEach((p) => {
    if (hit) return;
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
    const segs = _feihua_segsOf(e.text, false);
    const at = runAt(segs.map(_feihua_strip), clauses);
    if (at >= 0) hit = { id: p.id, title: p.t, author: p.a, seg: segs.slice(at, at + clauses.length).join("，") };
  });

  if (!hit) {
    return { ok: false, why: "absent", reason: onSource() ? "诗词集里查不到这一句，换一句试试" : "这个范围里查不到这一句，换一句试试" };
  }
  return { ok: true, hit, seg: hit.seg };
}

function pick(opt) {
  const o = opt || {};
  const asked = o.exclude || [];
  const byScope = poolOfScope(o.scope);
  const hits = collect(o, byScope).filter((c) => asked.indexOf(c) < 0);
  if (!hits.length) return null;

  const it = hits[Math.floor(Math.random() * hits.length)];
  const rows = byScope[it] || [];
  return { char: it, count: rows.length };
}

function collect(o, byScope) {
  const all = pool(o.scope);
  const lv = levelOf(o.level);

  const match = (scopeOnly, levelOnly) => Object.keys(all).filter((c) => {
    const it = all[c];
    if (scopeOnly && !byScope[it.char]) return false;
    if (levelOnly && !(lv.max ? it.count <= lv.max : it.count >= lv.min)) return false;
    return true;
  });

  const tiers = [
    match(true, true),
    match(false, true),
    match(true, false),
    match(false, false)
  ];
  return tiers.find((t) => t.length) || [];
}

let segsCache = null;

function segsOfScope(scopeId) {
  const key = gameScopes.cacheKeyOf(scopeId);
  if (!segsCache) segsCache = {};
  if (segsCache[key]) return segsCache[key];

  const out = [];
  _feihua_scopedPoems({ scope: scopeId }).forEach((p) => {
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
    _feihua_segsOf(e.text).forEach((seg) => {
      out.push({ id: p.id, title: p.t, author: p.a, dynasty: p.d, seg: seg });
    });
  });

  segsCache[key] = out;
  return out;
}

let byScopeCache = null;

function poolOfScope(scopeId) {
  const key = gameScopes.cacheKeyOf(scopeId);
  if (!byScopeCache) byScopeCache = {};
  if (byScopeCache[key]) return byScopeCache[key];

  const out = {};
  segsOfScope(scopeId).forEach((r) => {
    charSetOf(r.seg).forEach((ch) => {
      if (!out[ch]) out[ch] = [];
      out[ch].push(r);
    });
  });

  byScopeCache[key] = out;
  return out;
}

function charSetOf(seg) {
  const set = new Set();
  Array.from(seg).forEach((ch) => {
    if (/[\u3400-\u9fff]/.test(ch)) set.add(ch);
  });
  return Array.from(set);
}

module.exports = {
  LEVELS,
  onSource,
  judgeAsync,
  lookAtSource: (char, opt) => raceTimeout(lookAtSource(char, opt), LOOK_MS),
  pool,
  levelOf,
  pick,
  look,
  hint,
  judge,
  charsOf: _feihua_chars,
  scopedPoems: _feihua_scopedPoems
};
