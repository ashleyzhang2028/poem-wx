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
    const from = at - F.LEAD * DAY;
    const elapsed = Math.round((midnight(today) - at) / DAY);
    if (elapsed >= -F.LEAD && elapsed < F.SHOW_DAYS - F.LEAD
      && (!hit || at > hit.at)) hit = { at: at, from: from, elapsed: elapsed };
  });
  if (!hit) return null;
  return {
    key: name,
    kind: "festival",
    elapsed: hit.elapsed + F.LEAD,
    days: F.SHOW_DAYS,
    from: hit.from,
    to: hit.from + F.SHOW_DAYS * DAY
  };
}

function utcMidnight(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function seasonWindow(of, today) {
  const head = (F.SEASON_TERMS[of] || [])[0];
  if (TERMS.NAMES.indexOf(head) < 0) return null;
  const from = windowOf(head, today);
  if (!from) return null;
  const to = windowOf(head, new Date(today.getTime() + from.days * DAY));
  if (!to || to.from <= from.from) return null;
  return {
    key: "",
    of: of,
    kind: "season",
    elapsed: from.elapsed,
    days: Math.round((to.from - from.from) / DAY),
    from: from.from,
    to: to.from
  };
}

function active(today) {
  const day = today || new Date();
  const names = [];
  F.TRADITIONAL.forEach((x) => names.push(x.key));
  TERMS.NAMES.forEach((x) => {
    if (names.indexOf(x) < 0) names.push(x);
  });
  const hits = [];
  names.forEach((name) => {
    const w = windowOf(name, day);
    if (w) hits.push(w);
  });
  F.SEASONS.forEach((of) => {
    const w = seasonWindow(of, day);
    if (w) hits.push(w);
  });
  hits.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "festival" ? -1 : 1;
    return b.elapsed - a.elapsed;
  });
  return hits;
}

function orderOf(keys, id) {
  const list = F.WORKS.filter((w) => keys.indexOf(w[1]) >= 0).map((w) => w[0]);
  const at = list.indexOf(id);
  return at < 0 ? list.length : at;
}

function keysOf(hit) {
  if (hit.kind === "season") return [hit.of, F.seasonOf(hit.of)].filter(Boolean);
  return [hit.key, F.seasonOf(hit.key)].filter(Boolean);
}

function poemsOf(hit) {
  const keys = keysOf(hit);
  const list = F.WORKS
    .filter((w) => keys.indexOf(w[1]) >= 0)
    .map((w) => corpus.indexById(w[0]))
    .filter(Boolean);
  list.sort((a, b) => orderOf(keys, a.id) - orderOf(keys, b.id));
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
  const hit = card(now);
  return hit ? hit.key + "@" + dayStart(hit.from) : "";
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

const KIND_NAME = { festival: "节日", term: "节气" };

function tagOf(hit) {
  return (KIND_NAME[hit.kind] || "") + " · " + hit.key;
}

function tipOf(hit) {
  if (hit.kind !== "festival") return tagOf(hit);
  const left = hit.days - 1 - hit.elapsed;
  const when = left === 0 ? "" : (left === 1 ? "明日" : left + "日后");
  return when ? when + " · " + hit.key : hit.key;
}

function entryOf(id) {
  return id ? corpus.entry(id) : null;
}

function card(now) {
  if (!isOn()) return null;
  const hits = active(new Date(now === undefined ? Date.now() : now));
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    const list = poemsOf(hit);
    if (!list.length) continue;
    return {
      key: hit.key || F.seasonOf(hit.of),
      kind: hit.kind,
      elapsed: hit.elapsed,
      days: hit.days,
      tag: tagOf(hit),
      tip: tipOf(hit),
      from: hit.from,
      poems: list
    };
  }
  return null;
}

module.exports = {
  CAP,
  DAY,
  SHOW_DAYS: F.SHOW_DAYS,
  WORKS: F.WORKS,
  TRADITIONAL: F.TRADITIONAL,
  SEASONS: F.SEASONS,
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
