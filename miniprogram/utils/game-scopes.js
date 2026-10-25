const corpus = require("./corpus");
const store = require("./store");
const S = require("./scheduler");

const STAGE_SCOPE = "stage";

let scopeCache = null;

function list() {
  if (!scopeCache) scopeCache = [{ id: STAGE_SCOPE, name: "课内·当前学段" }];
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

let stageCache = null;

function pool(key) {
  void key;
  return stagePool();
}

function field() {
  return stagePool();
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

module.exports = { STAGE_SCOPE, list, nameOf, pool, field };
