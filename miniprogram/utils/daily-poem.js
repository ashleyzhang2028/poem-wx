const store = require("./store");
const entitlement = require("./entitlement");
const source = require("./poem-source");

const CAP = "dailypoem";

const KEY = "kb_daily_poem_v1";

const RETRY_MAX = 5;

function poolOf() {
  try {
    const pack = require("../data/daily-pool.js");
    return Array.isArray(pack) ? pack : [];
  } catch (e) {
    return [];
  }
}

function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function saved(day) {
  const raw = store.read(KEY, null);
  return raw && raw.day === day && Number.isInteger(raw.pos) ? raw.pos : -1;
}

function posOf(day, size) {
  const at = saved(day);
  return at >= 0 && at < size ? at : hashOf(day) % size;
}

function shownTitle(title) {
  return String(title).split("·").filter((part, i, all) => i === 0 || part !== all[i - 1]).join("·");
}

function cardAt(pool, pos) {
  const hit = pool[pos];
  return { key: "daily-" + pos, pos: pos, title: hit[0], shown: shownTitle(hit[0]), author: hit[1], dynasty: hit[2], label: hit[3] };
}

function card(now) {
  const pool = poolOf();
  if (!pool.length) return null;
  return cardAt(pool, posOf(store.dayKey(now), pool.length));
}

function redraw(now) {
  const pool = poolOf();
  if (pool.length < 2) return false;
  const day = store.dayKey(now);
  const now0 = posOf(day, pool.length);
  const next = (now0 + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length;
  store.write(KEY, { day: day, pos: next });
  return true;
}

function load(hit) {
  return source.byId(hit.key, { t: hit.title, a: hit.author }).then((poem) => {
    const lines = source.linesOf(poem);
    if (!lines.length) throw new Error("正文为空");
    return { lines: lines, apiId: poem && poem.id !== undefined ? String(poem.id) : "" };
  });
}

function loadCurrent(now) {
  const pool = poolOf();
  if (!pool.length) return Promise.reject(new Error("候选池是空的"));
  const day = store.dayKey(now);
  let tries = 0;
  const attempt = (pos) => {
    const hit = cardAt(pool, pos);
    return load(hit).then(
      (got) => {
        store.write(KEY, { day: day, pos: pos });
        return Object.assign({ card: hit }, got);
      },
      (err) => {
        if (tries >= RETRY_MAX) throw err;
        tries += 1;
        return attempt((pos + 1) % pool.length);
      }
    );
  };
  return attempt(posOf(day, pool.length));
}

function isOn() {
  if (!entitlement.can(CAP)) return true;
  return store.settings().seasonal !== false;
}

function canSwitch() {
  return entitlement.can(CAP);
}

function switched() {
  return entitlement.can(CAP) && store.settings().seasonal === false;
}

function setOn(on) {
  if (!canSwitch()) return entitlement.decide(CAP);
  store.saveSettings({ seasonal: !!on });
  return { ok: true, reason: "ok", name: CAP, login: false };
}

function tier() {
  return entitlement.tierOf(CAP);
}

function locked() {
  return !canSwitch() && entitlement.reachable(tier(), entitlement.status().tier);
}

module.exports = { CAP, RETRY_MAX, poolOf, card, redraw, load, loadCurrent, isOn, canSwitch, switched, setOn, tier, locked };
