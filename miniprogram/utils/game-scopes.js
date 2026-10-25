const corpus = require("./corpus");
const store = require("./store");
const S = require("./scheduler");

const POEM_BOOKS = ["poems", "yuefu", "tangshi", "gushi", "songci", "yuanqu", "jinxiandai"];

const STAGE_SCOPE = "stage";

let scopeCache = null;

function scopeId(key) {
  return key === STAGE_SCOPE ? "poems" : key;
}

function list() {
  if (!scopeCache) {
    const scopes = [{ id: STAGE_SCOPE, name: "课内诗词·当前学段" }];
    corpus
      .books()
      .filter((b) => POEM_BOOKS.indexOf(b.id) >= 0)
      .forEach((b) => scopes.push({ id: b.id, name: b.name }));
    scopeCache = scopes;
  }
  return scopeCache;
}

function nameOf(scopes, id) {
  if (id === STAGE_SCOPE) {
    const s = store.settings();
    return S.gradeName(s.grade) + S.termName(s.term) + "学期";
  }
  const hit = (scopes || []).find((s) => s.id === id);
  return hit ? hit.name : (scopes && scopes[0] ? scopes[0].name : "");
}

let poolCache = null;

let fieldCache = null;

let stageCache = null;

function hasText(id) {
  if (corpus.courseTexts()[id]) return true;
  if (corpus.manifest().map[id]) return true;
  return !!corpus.sourceIdOf(id);
}

function collect(ids) {
  const out = [];
  ids.forEach((id) => {
    const seen = {};
    out.forEach((p) => {
      seen[p.id] = 1;
    });
    corpus.ofBook(id).forEach((p) => {
      if (seen[p.id] || !hasText(p.id)) return;
      seen[p.id] = 1;
      out.push(p);
    });
  });
  return out;
}

function pool(key) {
  if (key === STAGE_SCOPE) return stagePool();
  const id = scopeId(key);
  if (POEM_BOOKS.indexOf(id) < 0) return field();
  if (!poolCache) poolCache = {};
  if (!poolCache[id]) poolCache[id] = collect(["poems", id]);
  return poolCache[id];
}

function stagePool() {
  const s = store.settings();
  const cacheKey = Number(s.grade) + "|" + Number(s.term);
  if (!stageCache || stageCache.key !== cacheKey) {
    const grade = Number(s.grade);
    const term = Number(s.term);
    const all = corpus.course();
    stageCache = {
      key: cacheKey,
      list: all.filter((p) => p.gr < grade || (p.gr === grade && p.tm <= term))
    };
  }
  return stageCache.list;
}

function field() {
  if (!fieldCache) fieldCache = collect(POEM_BOOKS);
  return fieldCache;
}

module.exports = { POEM_BOOKS, STAGE_SCOPE, list, nameOf, pool, field };
