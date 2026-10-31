const store = require("./store");
const entitlement = require("./entitlement");
const source = require("./poem-source");
const remote = require("./remote");

const CAP = "dailypoem";

const KEY = "kb_daily_poem_v2";

const RETRY_MAX = 5;

function shownTitle(title) {
  return String(title).split("·").filter((part, i, all) => i === 0 || part !== all[i - 1]).join("·");
}

function cardOf(res) {
  const pos = Number(res && res.pos);
  const size = Number(res && res.size);
  const title = String((res && res.title) || "");
  const author = String((res && res.author) || "");
  const valid = Number.isInteger(pos) && Number.isInteger(size) && size >= 1 && pos >= 0 && pos < size;
  if (!valid || !title || !author) throw new Error("每日一诗数据不完整");
  return {
    key: "daily-" + pos,
    pos: pos,
    size: size,
    title: title,
    shown: shownTitle(title),
    author: author,
    dynasty: String(res.dynasty || ""),
    label: String(res.label || "")
  };
}

function saved(day) {
  const raw = store.read(KEY, null);
  return raw && raw.day === day && raw.card ? raw.card : null;
}

function remember(day, hit) {
  store.write(KEY, { day: day, card: hit });
}

function card(now) {
  return saved(store.dayKey(now));
}

function fetchCard(day, pos) {
  const query = pos === undefined ? "day=" + encodeURIComponent(day) : "pos=" + pos;
  return remote.request(remote.PATHS.dailyPoems + "?" + query, {}, "GET").then(cardOf);
}

function redraw(now) {
  const day = store.dayKey(now);
  const base = saved(day);
  return (base ? Promise.resolve(base) : fetchCard(day))
    .then((cur) => {
      if (cur.size < 2) return false;
      const next = (cur.pos + 1 + Math.floor(Math.random() * (cur.size - 1))) % cur.size;
      return fetchCard(day, next).then((hit) => {
        remember(day, hit);
        return true;
      });
    })
    .catch((err) => {
      console.error("[daily] 换一首失败", (err && err.message) || "");
      return false;
    });
}

function load(hit) {
  return source.byId(hit.key, { t: hit.title, a: hit.author }).then((poem) => {
    const lines = source.linesOf(poem);
    if (!lines.length) throw new Error("正文为空");
    return { lines: lines, apiId: poem && poem.id !== undefined ? String(poem.id) : "" };
  });
}

function loadCurrent(now) {
  const day = store.dayKey(now);
  let tries = 0;
  const attempt = (hit) => load(hit).then(
    (got) => {
      remember(day, hit);
      return Object.assign({ card: hit }, got);
    },
    (err) => {
      if (tries >= RETRY_MAX || hit.size < 2) throw err;
      tries += 1;
      return fetchCard(day, (hit.pos + 1) % hit.size).then(attempt);
    }
  );
  const first = saved(day);
  return (first ? Promise.resolve(first) : fetchCard(day)).then(attempt);
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

module.exports = { CAP, RETRY_MAX, card, fetchCard, redraw, load, loadCurrent, isOn, canSwitch, switched, setOn, tier, locked };
