const store = require("./store");
const tiers = require("./tiers");
const entitlement = require("./entitlement");

const TITLE_MAX = 60;

function clip(v, n) {
  return String(v == null ? "" : v).trim().slice(0, n);
}

function normalize(raw) {
  const out = [];
  const seen = {};
  (Array.isArray(raw) ? raw : []).forEach((b) => {
    const id = clip(b && b.id, 80);
    if (!id || seen[id]) return;
    seen[id] = true;
    out.push({
      id: id,
      sid: clip(b.sid, 80),
      src: b.src === true,
      t: clip(b.t, TITLE_MAX) || id,
      a: clip(b.a, 30),
      n: clip(b.n, 30),
      at: Number(b.at) > 0 ? Math.round(Number(b.at)) : 0
    });
  });
  return out;
}

function list() {
  return normalize(store.bookmarks()).sort((x, y) => y.at - x.at);
}

function capOf() {
  const n = tiers.BOOKMARK_LIMITS[entitlement.status().tier];
  return n === undefined ? 0 : n;
}

function has(id) {
  return list().some((b) => b.id === id);
}

function add(entry) {
  const cap = capOf();
  if (!cap) return { ok: false, code: "E_TIER", dropped: 0 };
  const next = normalize([Object.assign({}, entry, { at: Date.now() })].concat(list()));
  const dropped = Math.max(0, next.length - cap);
  store.saveBookmarks(next.slice(0, cap));
  return { ok: true, dropped: dropped };
}

function remove(ids) {
  const gone = {};
  (ids || []).forEach((id) => { gone[String(id)] = true; });
  const all = list();
  const left = all.filter((b) => !gone[b.id]);
  if (left.length !== all.length) store.saveBookmarks(left);
  return all.length - left.length;
}

function retitle(id, title) {
  const t = clip(title, TITLE_MAX);
  if (!t) return false;
  const all = list();
  const hit = all.filter((b) => b.id === id)[0];
  if (!hit) return false;
  hit.t = t;
  store.saveBookmarks(all);
  return true;
}

function toggle(entry) {
  if (has(entry.id)) {
    remove([entry.id]);
    return { ok: true, on: false, dropped: 0 };
  }
  const r = add(entry);
  return Object.assign({ on: r.ok }, r);
}

function readerUrl(b) {
  let url = "/pages/reader/reader?id=" + encodeURIComponent(b.id);
  if (b.sid) url += "&sid=" + encodeURIComponent(b.sid);
  if (b.src) url += "&src=1";
  return url;
}

module.exports = { TITLE_MAX, list, capOf, has, add, remove, retitle, toggle, readerUrl };
