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

function pool(scopeId) {
  const bookId = POEM_BOOKS.indexOf(scopeId) >= 0 ? scopeId : "poems";
  if (!poolCache) poolCache = {};
  if (poolCache[bookId]) return poolCache[bookId];

  const manifest = corpus.manifest().map || {};
  const seen = {};
  const out = [];

  POEM_BOOKS.forEach((id) => {
    if (bookId !== "poems" && id !== "poems" && id !== bookId) return;
    corpus.ofBook(id).forEach((p) => {
      if (seen[p.id] || !manifest[p.id]) return;
      seen[p.id] = 1;
      out.push(p);
    });
  });

  poolCache[bookId] = out;
  return out;
}

module.exports = { POEM_BOOKS, list, nameOf, pool };
