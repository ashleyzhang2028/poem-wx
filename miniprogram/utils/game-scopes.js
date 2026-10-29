const corpus = require("./corpus");
const store = require("./store");
const S = require("./scheduler");

const STAGE_SCOPE = "stage";
const COURSE_ALL_SCOPE = "course_all";
const EXTRA_SCOPE = "extra";
const ANY_SCOPE = "any";

const SCOPES = [
  { id: STAGE_SCOPE, name: "课内·当前学段" },
  { id: COURSE_ALL_SCOPE, name: "课内" },
  { id: EXTRA_SCOPE, name: "诗词漫读" },
  { id: ANY_SCOPE, name: "不限" }
];

const LABELS = {
  [COURSE_ALL_SCOPE]: "小学·初中·高中",
  [EXTRA_SCOPE]: "课内 + 诗词漫读十部集子",
  [ANY_SCOPE]: "诗词漫读随机，不限范围"
};

function list() {
  return SCOPES;
}

function nameOf(scopes, id) {
  if (id === STAGE_SCOPE) {
    const s = store.settings();
    return S.gradeName(s.grade) + S.termName(s.term) + "学期";
  }
  if (LABELS[id]) return LABELS[id];
  const hit = (scopes || []).find((s) => s.id === id);
  return hit ? hit.name : (scopes && scopes[0] ? scopes[0].name : "");
}

let stageCache = null;

function pool(key) {
  if (key === COURSE_ALL_SCOPE || key === EXTRA_SCOPE || key === ANY_SCOPE) return corpus.course();
  return stagePool();
}

function field(key) {
  return pool(key);
}

function stageKey() {
  const s = store.settings();
  return Number(s.grade) + "|" + Number(s.term);
}

function cacheKeyOf(key) {
  return key === STAGE_SCOPE || !key ? STAGE_SCOPE + "|" + stageKey() : key;
}

function stagePool() {
  const key = stageKey();
  if (!stageCache || stageCache.key !== key) {
    const grade = Number(store.settings().grade);
    const term = Number(store.settings().term);
    stageCache = {
      key: key,
      list: corpus.course().filter((p) => p.gr < grade || (p.gr === grade && p.tm <= term))
    };
  }
  return stageCache.list;
}

module.exports = {
  STAGE_SCOPE, COURSE_ALL_SCOPE, EXTRA_SCOPE, ANY_SCOPE,
  list, nameOf, pool, field, cacheKeyOf
};
