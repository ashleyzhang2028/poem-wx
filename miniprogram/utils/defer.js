const store = require("./store");
const R = require("./review-models");
const corpus = require("./corpus");

const LEVELS = [
  { key: "tomorrow", label: "明日温习", span: 1, cls: "tomorrow" },
  { key: "month", label: "月后温习", span: 30, cls: "month" }
];

const DAY = R.DAY;

function levelOf(key) {
  return LEVELS.filter((lv) => lv.key === key)[0] || null;
}

function levelOfSpan(span) {
  return LEVELS.filter((lv) => lv.span === Number(span))[0] || levelOf("tomorrow");
}

function dayOf(day) {
  const parts = String(day).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !isFinite(n))) return 0;
  return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
}

function shiftDay(day, days) {
  const at = dayOf(day);
  if (!at) return "";
  return R.dayStamp(R.startOfDay(at) + days * DAY);
}

function normDay(day) {
  const at = dayOf(day);
  return at ? R.dayStamp(at) : "";
}

function untilOn(item) {
  return normDay(item && item.until) || shiftDay(item && item.day, Number(item && item.span) || 1);
}

function isHeld(item) {
  if (!item || !item.day) return false;
  return store.dayKey() < untilOn(item);
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
  const at = dayOf(untilOn(item));
  if (!at) return 0;
  return Math.round((R.startOfDay(at) - R.startOfDay(Date.now())) / DAY);
}

function put(id, levelKey) {
  if (!id) return false;
  const lv = levelOf(levelKey);
  if (!lv) return false;
  const day = store.dayKey();
  const until = shiftDay(day, lv.span);
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
        label: (levelOfSpan(item.span) === levelOf("month") ? "月后温习" : "明日温习"),
        due: left <= 0 ? "今天回来" : "还有 " + left + " 天",
        until: untilOn(item)
      };
    })
    .filter(Boolean);
}

function lists() {
  const all = store.deferList().filter(isHeld).sort((a, b) => daysLeftOf(a) - daysLeftOf(b));
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
  shiftDay,
  normDay,
  isHeld,
  untilOn,
  heldIds,
  daysLeftOf,
  put,
  drop,
  lists,
  rowsOf
};
