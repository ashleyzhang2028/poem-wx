const corpus = require("./corpus");

const POEM_BOOKS = ["poems", "yuefu", "tangshi", "gushi", "songci", "yuanqu", "jinxiandai"];

let scopeCache = null;

function list() {
  if (!scopeCache) {
    scopeCache = corpus
      .books()
      .filter((b) => POEM_BOOKS.indexOf(b.id) >= 0)
      .map((b) => ({ id: b.id, name: b.name }));
  }
  return scopeCache;
}

function nameOf(scopes, id) {
  const hit = (scopes || []).find((s) => s.id === id);
  return hit ? hit.name : (scopes && scopes[0] ? scopes[0].name : "");
}

let poolCache = null;

let fieldCache = null;

function hasText(id) {
  if (corpus.courseTexts()[id]) return true;
  return !!corpus.manifest().map[id];
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

function pool(scopeId) {
  if (POEM_BOOKS.indexOf(scopeId) < 0) return field();
  if (!poolCache) poolCache = {};
  if (!poolCache[scopeId]) poolCache[scopeId] = collect(["poems", scopeId]);
  return poolCache[scopeId];
}

function field() {
  if (!fieldCache) fieldCache = collect(POEM_BOOKS);
  return fieldCache;
}

module.exports = { POEM_BOOKS, list, nameOf, pool, field };
