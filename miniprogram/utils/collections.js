const store = require("./store");
const tiers = require("./tiers");
const entitlement = require("./entitlement");

const NAME_MAX = 12;

const ITEMS_MAX = tiers.COLLECTION_ITEMS_MAX;

const LIMITS = tiers.COLLECTION_LIMITS;

const DAILY_COUNTS = [3, 5, 10, 20];

const DAILY_DEFAULT = 5;

const DEFAULT_NAME = "自选背诵";

function usable() {
  return list().filter((c) => c.items.length > 0);
}

function isEmpty() {
  return list().length === 0;
}

function selfOnlyOn() {
  if (!entitlement.can("collections") || !entitlement.can("coursefree")) return false;
  if (!store.settings().selfOnly) return false;
  return usable().length > 0;
}

function capOf() {
  const tier = entitlement.status().tier;
  const n = LIMITS[tier];
  return n === undefined ? 0 : n;
}

function nameOf(c) {
  const raw = String((c && c.name) || "").trim();
  return raw || DEFAULT_NAME;
}

function trimName(raw) {
  return String(raw == null ? "" : raw).trim().slice(0, NAME_MAX);
}

function countOf(c) {
  const n = Number(c && c.dailyCount);
  return DAILY_COUNTS.indexOf(n) >= 0 ? n : DAILY_DEFAULT;
}

function slug() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function normalize(raw) {
  const out = [];
  const seen = {};
  (Array.isArray(raw) ? raw : []).forEach((c) => {
    if (!c || typeof c !== "object") return;
    const id = String(c.id || "").trim();
    if (!id || seen[id]) return;
    seen[id] = true;
    const items = [];
    const got = {};
    (Array.isArray(c.items) ? c.items : []).forEach((it) => {
      const pid = String((it && typeof it === "object" ? it.id : it) || "").trim();
      if (!pid || got[pid]) return;
      got[pid] = true;
      items.push({ id: pid });
    });
    out.push({
      id: id,
      name: trimName(c.name),
      createdAt: Number(c.createdAt) > 0 ? Math.round(Number(c.createdAt)) : 0,
      dailyCount: DAILY_COUNTS.indexOf(Number(c.dailyCount)) >= 0 ? Number(c.dailyCount) : DAILY_DEFAULT,
      items: items
    });
  });
  return out;
}

function list() {
  return normalize(store.collections());
}

function save(next) {
  store.saveCollections(normalize(next));
  store.dropDayPlan();
  return list();
}

function find(id) {
  return list().filter((c) => c.id === id)[0] || null;
}

function idsOf(c) {
  return ((c && c.items) || []).map((it) => it.id);
}

function create(name) {
  const all = list();
  const cap = capOf();
  if (all.length >= cap) {
    return { ok: false, code: "E_LIMIT", cap: cap, name: DEFAULT_NAME };
  }
  const c = {
    id: slug(),
    name: trimName(name) || DEFAULT_NAME,
    createdAt: Date.now(),
    dailyCount: DAILY_DEFAULT,
    items: []
  };
  all.push(c);
  save(all);
  return { ok: true, collection: c };
}

function rename(id, name) {
  const all = list();
  const c = all.filter((x) => x.id === id)[0];
  if (!c) return { ok: false, code: "E_NO_COLLECTION" };
  const next = trimName(name);
  if (!next) return { ok: false, code: "E_EMPTY_NAME" };
  c.name = next;
  save(all);
  return { ok: true, collection: c };
}

function setCount(id, n) {
  const all = list();
  const c = all.filter((x) => x.id === id)[0];
  if (!c) return { ok: false, code: "E_NO_COLLECTION" };
  const v = Number(n);
  if (DAILY_COUNTS.indexOf(v) < 0) return { ok: false, code: "E_BAD_COUNT" };
  c.dailyCount = v;
  save(all);
  return { ok: true, count: v };
}

function remove(id) {
  const all = list();
  const left = all.filter((x) => x.id !== id);
  if (left.length === all.length) return { ok: false, code: "E_NO_COLLECTION" };
  save(left);
  return { ok: true };
}

function clearItems(id) {
  const all = list();
  const c = all.filter((x) => x.id === id)[0];
  if (!c) return { ok: false, code: "E_NO_COLLECTION", count: 0 };
  const n = c.items.length;
  c.items = [];
  save(all);
  return { ok: true, count: n };
}

function add(id, poemIds) {
  const all = list();
  const c = all.filter((x) => x.id === id)[0];
  if (!c) return { ok: false, code: "E_NO_COLLECTION", added: 0 };
  const have = {};
  c.items.forEach((it) => { have[it.id] = true; });
  let added = 0;
  let full = 0;
  (poemIds || []).forEach((pid) => {
    const key = String(pid || "").trim();
    if (!key || have[key]) return;
    if (c.items.length >= ITEMS_MAX) { full += 1; return; }
    have[key] = true;
    c.items.push({ id: key });
    added += 1;
  });
  if (added) save(all);
  return { ok: added > 0, code: full ? "E_FULL" : added ? "" : "E_DUP", added: added, full: full, cap: ITEMS_MAX };
}

function removeItems(id, poemIds) {
  const all = list();
  const c = all.filter((x) => x.id === id)[0];
  if (!c) return { ok: false, code: "E_NO_COLLECTION", removed: 0 };
  const gone = {};
  (poemIds || []).forEach((pid) => { gone[String(pid)] = true; });
  const left = c.items.filter((it) => !gone[it.id]);
  const n = c.items.length - left.length;
  if (n) {
    c.items = left;
    save(all);
  }
  return { ok: n > 0, removed: n };
}

function collectionsOf(poemId) {
  return list()
    .filter((c) => idsOf(c).indexOf(poemId) >= 0)
    .map((c) => ({ id: c.id, name: nameOf(c), count: c.items.length }));
}

module.exports = {
  NAME_MAX,
  ITEMS_MAX,
  LIMITS,
  DAILY_COUNTS,
  DAILY_DEFAULT,
  countOf,
  setCount,
  usable,
  isEmpty,
  selfOnlyOn,
  DEFAULT_NAME,
  capOf,
  nameOf,
  trimName,
  normalize,
  list,
  save,
  find,
  idsOf,
  create,
  rename,
  remove,
  clearItems,
  add,
  removeItems,
  collectionsOf
};
