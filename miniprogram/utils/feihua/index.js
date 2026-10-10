const corpus = require("../corpus");

const LEVELS = [
  { id: "easy", name: "常见字", min: 25 },
  { id: "normal", name: "一般字", min: 6 },
  { id: "hard", name: "难字", min: 1, max: 5 }
];

function segsOf(text, gated) {
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

function allPoems() {
  return corpus.course();
}

function scopedPoems(opt) {
  const o = opt || {};
  if (!o.scope) return allPoems();
  let S;
  try {
    S = require("../scheduler");
  } catch (e) {
    return allPoems();
  }
  const out = S.poolForScope({
    grade: o.grade,
    term: o.term,
    scope: o.scope,
    allPoems: allPoems()
  });
  return out && out.length ? out : allPoems();
}

let poolCache = null;

function pool() {
  if (poolCache) return poolCache;

  const counts = {};
  allPoems().forEach((p) => {
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
    segsOf(e.text).forEach((s) => {

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
  poolCache = out;
  return out;
}

function chars(levelId, limit) {
  const all = pool();
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
  const limit = o.limit || 60;
  const out = [];

  scopedPoems(o).forEach((p) => {
    if (out.length >= limit) return;
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
    segsOf(e.text).forEach((s) => {
      if (out.length >= limit || s.indexOf(ch) < 0) return;
      out.push({
        id: p.id,
        title: p.t,
        author: p.a,
        dynasty: p.d,
        seg: s
      });
    });
  });

  return out;
}

function strip(s) {
  return String(s).replace(/[^\u3400-\u9fff]/g, "");
}

function judge(char, input, said) {
  const ch = String(char || "").trim();
  const raw = String(input || "").trim();
  if (!ch) return { ok: false, reason: "先出一个令字" };
  if (!raw) return { ok: false, reason: "写一句带这个字的诗" };
  if (raw.indexOf(ch) < 0) return { ok: false, reason: "这句里没有「" + ch + "」" };

  const mine = strip(raw);
  if (mine.length < 4) return { ok: false, reason: "太短了，至少写四字" };

  const used = {};
  (said || []).forEach((s) => {
    used[strip(s)] = 1;
  });
  if (used[mine]) return { ok: false, reason: "这一句说过了" };

  let hit = null;
  allPoems().forEach((p) => {
    if (hit) return;
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
    segsOf(e.text, false).forEach((seg) => {
      if (hit) return;
      if (strip(seg) === mine) hit = { id: p.id, title: p.t, author: p.a, seg: seg };
    });
  });

  if (!hit) {
    return { ok: false, reason: "这一句不在课内诗文集里，换一句试试" };
  }
  return { ok: true, hit, seg: hit.seg };
}

function pick(opt) {
  const o = opt || {};
  const inScope = scopedPoems(o);
  const excl = {};
  (o.exclude || []).forEach((c) => {
    excl[c] = 1;
  });

  const inScopeChars = {};
  inScope.forEach((p) => {
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
    segsOf(e.text).forEach((s) => {
      Array.from(new Set(Array.from(s))).forEach((ch) => {
        if (/[\u3400-\u9fff]/.test(ch)) inScopeChars[ch] = 1;
      });
    });
  });

  const all = pool();
  const lv = levelOf(o.level);

  const match = (scopeOnly, levelOnly) => {
    const list = Object.keys(all)
      .map((c) => all[c])
      .filter((it) => {
        if (excl[it.char]) return false;
        if (scopeOnly && !inScopeChars[it.char]) return false;
        if (levelOnly) {
          if (lv.max ? it.count > lv.max : it.count < lv.min) return false;
        }
        return true;
      });
    return list;
  };

  const tiers = [
    match(true, true),
    match(false, true),
    match(true, false),
    match(false, false)
  ];
  const hits = tiers.find((t) => t.length) || [];
  if (!hits.length) return null;

  const it = hits[Math.floor(Math.random() * hits.length)];
  return { char: it.char, count: it.count, level: it.level };
}

module.exports = {
  LEVELS,
  pool,
  chars,
  levelOf,
  pick,
  scopedPoems,
  look,
  judge
};
