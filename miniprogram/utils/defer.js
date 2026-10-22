const store = require("./store");
const R = require("./review-models");
const corpus = require("./corpus");

const LEVELS = [
  { key: "tomorrow", label: "明日再背", span: 1, cls: "tomorrow" },
  { key: "month", label: "月后再背", span: 30, cls: "month" }
];

const DAY = R.DAY;

function levelOf(key) {
  return LEVELS.filter((lv) => lv.key === key)[0] || null;
}

function levelOfSpan(span) {
  return levelOf(Number(span) === 30 ? "month" : "tomorrow");
}

function shiftDay(day, days) {
  const parts = String(day).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !isFinite(n))) return "";
  return R.dayStamp(R.startOfDay(new Date(parts[0], parts[1] - 1, parts[2]).getTime()) + days * DAY);
}

function untilOf(day, span) {
  return shiftDay(day, span);
}

function isHeld(item) {
  if (!item || !item.day) return false;
  return store.dayKey() <= (item.until || untilOf(item.day, 1));
}

function heldIds() {
  const box = {};
  store.deferList().forEach((it) => {
    if (isHeld(it)) box[it.wid] = true;
  });
  return box;
}

function listWid(list) {
  const out = [];
  (list || []).forEach((it) => {
    if (it && it.wid && out.indexOf(it.wid) < 0) out.push(it.wid);
  });
  return out;
}

function daysLeftOf(item) {
  const until = item.until || untilOf(item.day, 1);
  const parts = until.split("-").map(Number);
  if (parts.length !== 3) return 0;
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / DAY);
}

function put(id, levelKey) {
  if (!id) return false;
  const lv = levelOf(levelKey);
  if (!lv) return false;
  const day = store.dayKey();
  const until = untilOf(day, lv.span);
  const kept = store.deferList().filter((it) => it.wid !== id);
  kept.push({ wid: id, day: day, at: Date.now(), until: until, span: lv.span });
  store.setDefer(kept);
  return true;
}

function drop(id) {
  const list = store.deferList();
  const kept = list.filter((it) => it.wid !== id);
  if (kept.length === list.length) return false;
  store.setDefer(kept);
  return true;
}

function rowsOf(ids, list) {
  const all = list || store.deferList();
  return ids
    .map((id) => {
      const meta = corpus.indexById(id);
      const item = all.filter((it) => it.wid === id)[0];
      if (!meta || !item) return null;
      const left = daysLeftOf(item);
      return {
        id: id,
        title: meta.t,
        meta: [meta.a, meta.d].filter((v, i, all) => v && all.indexOf(v) === i).join(" · "),
        label: item.span === 30 ? "月后再背" : "明日再背",
        due: left <= 0 ? "今天回来" : "还有 " + left + " 天",
        until: item.until || untilOf(item.day, 1)
      };
    })
    .filter(Boolean);
}

function lists() {
  const all = store.deferList().filter(isHeld);
  return LEVELS.map((lv) => {
    const ids = listWid(all.filter((it) => levelOfSpan(it.span) === lv));
    const rows = rowsOf(ids, all);
    return { key: lv.key, label: lv.label, cls: lv.cls, count: rows.length, rows: rows };
  }).filter((lv) => lv.count > 0);
}

module.exports = {
  LEVELS,
  levelOf,
  levelOfSpan,
  untilOf,
  shiftDay,
  isHeld,
  heldIds,
  daysLeftOf,
  put,
  drop,
  lists,
  rowsOf
};
