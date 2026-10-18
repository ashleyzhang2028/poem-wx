const LUNAR = require("./lunar");
const TERMS = require("./terms");
const F = require("./festivals");
const store = require("./store");
const corpus = require("./corpus");
const entitlement = require("./entitlement");

const DAY = 86400000;

const CAP = "seasonal";

function midnight(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function lunarMidnight(year, month, day) {
  if (month === 12 && day === 30) {
    for (let d = 29; d >= 21; d -= 1) {
      const at = lunarDayOf(year, 12, d);
      if (at) return at;
    }
    return 0;
  }
  return lunarDayOf(year, month, day);
}

function lunarDayOf(year, month, day) {
  const probe = new Date(year, 0, 1);
  for (let i = 0; i < 366; i += 1) {
    const d = new Date(probe.getTime() + i * DAY);
    const it = LUNAR.lunar(d);
    if (!it || it.year !== year) continue;
    if (it.month === month && it.day === day && !it.leap) return midnight(d);
  }
  return 0;
}

function dayOf(entry, year) {
  if (entry.lunar) return lunarMidnight(year, entry.lunar[0], entry.lunar[1]);
  if (entry.term) return TERMS.dayOfTerm(entry.term, year);
  if (entry.before) return TERMS.dayOfTerm(entry.before.term, year) - entry.before.days * DAY;
  return 0;
}

function windowOf(name, today) {
  const term = TERMS.NAMES.indexOf(name) >= 0 ? name : "";
  const year = today.getUTCFullYear();
  if (term) {
    const list = TERMS.around(today).filter((t) => t.key === term);
    let hit = null;
    list.forEach((t) => {
      if (t.at <= midnight(today) && (!hit || t.at > hit.at)) hit = t;
    });
    if (!hit) return null;
    const shot = TERMS.around(new Date(hit.at)).filter((t) => t.at > hit.at)[0];
    const end = shot ? shot.at : hit.at + 15 * DAY;
    const elapsed = Math.round((midnight(today) - hit.at) / DAY);
    if (elapsed < 0 || midnight(today) >= end) return null;
    return {
      key: name,
      kind: "term",
      elapsed: elapsed,
      days: Math.round((end - hit.at) / DAY),
      from: hit.at,
      to: end
    };
  }
  const entry = F.TRADITIONAL.filter((x) => x.key === name)[0];
  if (!entry) return null;
  const list = [year - 1, year, year + 1].map((y) => dayOf(entry, y)).filter((x) => x > 0);
  let hit = null;
  list.forEach((at) => {
    const elapsed = Math.round((midnight(today) - at) / DAY);
    if (elapsed >= 0 && elapsed < F.SHOW_DAYS && (!hit || at > hit.at)) hit = { at: at, elapsed: elapsed };
  });
  if (!hit) return null;
  return {
    key: name,
    kind: "festival",
    elapsed: hit.elapsed,
    days: F.SHOW_DAYS,
    from: hit.at,
    to: hit.at + F.SHOW_DAYS * DAY
  };
}

function active(today) {
  const names = [];
  F.TRADITIONAL.forEach((x) => names.push(x.key));
  TERMS.NAMES.forEach((x) => {
    if (names.indexOf(x) < 0) names.push(x);
  });
  const hits = [];
  names.forEach((name) => {
    const w = windowOf(name, today || new Date());
    if (w) hits.push(w);
  });
  hits.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "festival" ? -1 : 1;
    return b.elapsed - a.elapsed;
  });
  return hits;
}

function orderOf(fest, id) {
  const list = F.WORKS.filter((w) => w[1] === fest).map((w) => w[0]);
  const at = list.indexOf(id);
  return at < 0 ? list.length : at;
}

const UNVERIFIED_TRANSLATION = {
  "gushi-gs-67": "在阵阵爆竹声中，旧的一年过去了；春风送来暖意，大家共饮屠苏酒。\n初升的太阳照耀着千门万户，家家都把旧桃符换成新的。",
  "tangshi-ts-265": "暮春时节，长安城里处处飞舞着落花，寒食节的东风把皇宫里的柳枝吹得斜斜的。\n黄昏时分，汉宫里传出赐新火的旨意，轻烟就飘散在权贵人家的门前。",
  "tangshi-ts-335": "端午正当仲夏，白昼一天天长起来。\n盐梅早已调和了鼎中的滋味，酒曲也正用来传杯畅饮。\n古人留下节日的遗迹，年深日久，彩缕越缠越长。\n对着轩窗才知木槿正茂，靠近水边便闻到芦苇清香。\n愿亿万百姓同登长寿，愿诸位公卿共保昌盛。\n忠贞之心若能始终不变，自会留给后代子孙芬芳。",
  "tangshi-ts-254": "独自在他乡做客，每到佳节就更加思念亲人。\n遥想兄弟们登高的地方，插茱萸时唯独少了我一个。",
  "tangshi-ts-414": "勉强想要登高去，却没有人送酒来。\n遥想故园的菊花，应该正傍着战场开放。",
  "tangshi-ts-132": "老友准备了饭菜，邀我到农家做客。\n绿树环绕着村庄，青山在城郭外斜卧。\n打开窗子面对谷场菜园，端着酒谈说庄稼。\n等到重阳节，还要再来赏菊。",
  "gushi-gs-15": "四月天气清明和暖，雨刚停天转晴，正对门口的南山变得格外分明。\n再没有柳絮随风飘起，只有向日葵朝着太阳倾身。"
};

function poemsOf(hit) {
  const list = F.WORKS
    .filter((w) => w[1] === hit.key)
    .map((w) => corpus.indexById(w[0]))
    .filter(Boolean);
  list.sort((a, b) => orderOf(hit.key, a.id) - orderOf(hit.key, b.id));
  const seen = {};
  return list.filter((p) => {
    if (seen[p.id]) return false;
    seen[p.id] = true;
    return true;
  });
}

function dayStart(ms) {
  return Math.floor(ms / DAY);
}

function currentKey(now) {
  const hits = active(new Date(now === undefined ? Date.now() : now));
  return hits.length ? hits[0].key + "@" + dayStart(hits[0].from) : "";
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

function hintOf() {
  return entitlement.hint(CAP);
}

function tipOf(hit) {
  if (hit.kind !== "festival") return hit.key + " 第 " + (hit.elapsed + 1) + " 天";
  const left = hit.days - 1 - hit.elapsed;
  if (left === 0) return "今日" + hit.key;
  if (left === 1) return "明天" + hit.key;
  return left + " 天后的" + hit.key;
}

function entryOf(id) {
  if (!id) return null;
  const hit = corpus.entry(id);
  if (!hit) return null;
  const auto = UNVERIFIED_TRANSLATION[id];
  if (!auto || hit.tr) return hit;
  return Object.assign(hit, { tr: auto, src: F.UNVERIFIED_TEXT });
}

function unverified(list) {
  return list.some((p) => UNVERIFIED_TRANSLATION[p.id]);
}

function card(now) {
  if (!isOn()) return null;
  const hits = active(new Date(now === undefined ? Date.now() : now));
  if (!hits.length) return null;
  const hit = hits[0];
  const list = poemsOf(hit);
  if (!list.length) return null;
  return {
    key: hit.key,
    kind: hit.kind,
    elapsed: hit.elapsed,
    days: hit.days,
    tip: tipOf(hit),
    askCheck: unverified(list) ? F.UNVERIFIED_TEXT : "",
    poems: list
  };
}

module.exports = {
  CAP,
  DAY,
  SHOW_DAYS: F.SHOW_DAYS,
  WORKS: F.WORKS,
  TRADITIONAL: F.TRADITIONAL,
  UNVERIFIED: F.UNVERIFIED,
  ASK_CHECK: F.UNVERIFIED_TEXT,
  TERMS: TERMS.NAMES,
  entryOf,
  active,
  windowOf,
  poemsOf,
  currentKey,
  isOn,
  canSwitch,
  switched,
  setOn,
  hintOf,
  card
};
