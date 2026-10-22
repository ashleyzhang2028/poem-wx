const LUNAR = require("./lunar");
const TERMS = require("./terms");
const F = require("./festivals");
const store = require("./store");
const corpus = require("./corpus");
const entitlement = require("./entitlement");

const DAY = 86400000;

const LIMIT = 3;

const REDRAW_MAX = 9;

const REDRAW_KEY = "kb_seasonal_redraw_v1";

const KIND_NAME = { festival: "节日", term: "节气" };

const CAP = "seasonal";

function dayStart(ms) {
  return Math.floor(ms / DAY);
}

function rng(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function next() {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return Math.floor(((h >>> 0) / 4294967296) * 4096);
  };
}

function uniqOf(list) {
  const seen = {};
  return list.filter((p) => {
    if (!p || seen[p.id]) return false;
    seen[p.id] = true;
    return true;
  });
}

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

const LUNAR_YEAR = {};

function lunarYearDays(year) {
  if (LUNAR_YEAR[year]) return LUNAR_YEAR[year];
  const at = [];
  const start = Date.UTC(year, 0, 1);
  for (let i = 0; i < 366; i += 1) {
    const d = new Date(start + i * DAY);
    const it = LUNAR.lunar(d);
    if (!it || it.year !== year || it.leap) continue;
    at[it.month * 32 + it.day] = midnight(d);
  }
  LUNAR_YEAR[year] = at;
  return at;
}

function lunarDayOf(year, month, day) {
  return lunarYearDays(year)[month * 32 + day] || 0;
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

function poemsOf(hit, kind) {
  const keys = keysOf(hit);
  const list = F.WORKS
    .filter((w) => keys.indexOf(w[1]) >= 0)
    .map((w) => corpus.indexById(w[0]))
    .filter(Boolean);
  list.sort((a, b) => orderOf(keys, a.id) - orderOf(keys, b.id));
  const all = uniqOf(list);
  if (!kind) return all;
  return uniqOf(F.WORKS.filter((w) => w[1] === kind).map((w) => corpus.indexById(w[0])))
    .concat(all);
}

function perTerm(hit) {
  return hit.kind === "term";
}

function picksOf(id, seed) {
  const rnd = rng(seed + "#" + id);
  const days = [];
  for (let i = 0; i < LIMIT; i += 1) days.push(rnd());
  return days;
}

function take(list, seen, seed, now, rnd) {
  const freshList = list.filter((p) => !seen[p.id] && picksOf(p.id, seed).indexOf(dayStart(now)) >= 0);
  if (freshList.length) return freshList[0];
  const left = list.filter((p) => !seen[p.id]);
  return left.length ? left[rnd() % left.length] : null;
}

function fill(out, list, seed, now, rnd) {
  const seen = {};
  out.forEach((p) => { seen[p.id] = true; });
  const want = Math.min(LIMIT, list.length);
  while (out.filter((p) => list.indexOf(p) >= 0).length < want) {
    const p = take(list, seen, seed, now, rnd);
    if (!p) break;
    seen[p.id] = true;
    out.push(p);
  }
  return out;
}

function pairOf(hit, now, seed) {
  const rnd = rng(seed + "@" + dayStart(now));
  const out = [];
  Object.keys(KIND_NAME).forEach((kind) => {
    const list = poemsOf(hit, KIND_NAME[kind]);
    if (list.length > LIMIT) fill(out, list, seed, now, rnd);
  });
  return out;
}

function picks(hit, seed, now) {
  if (hit.kind !== "festival" && !perTerm(hit)) return poemsOf(hit);
  const picked = pairOf(hit, now, seed);
  return picked.length ? picked : poemsOf(hit);
}

function kindOf(hit) {
  if (hit.kind === "festival") return { key: hit.key, name: "festival" };
  if (hit.kind === "term") return { key: hit.key, name: "term" };
  return { key: hit.of || "", name: "season" };
}

function readRedraw() {
  const raw = store.read(REDRAW_KEY, null);
  if (!raw || raw.day !== store.dayKey()) return { day: store.dayKey(), rows: {} };
  return { day: raw.day, rows: raw.rows || {} };
}

function current(now) {
  const at = now === undefined ? Date.now() : now;
  if (!isOn()) return null;
  const hits = active(new Date(at));
  for (let i = 0; i < hits.length; i += 1) {
    if (poemsOf(hits[i]).length) return hits[i];
  }
  return null;
}

function card(now) {
  const at = now === undefined ? Date.now() : now;
  const hit = current(at);
  if (!hit) return null;
  return Object.assign(shapeOf(hit, at), {
    refresh: !!redrawOf(hit),
    redraw: redrawKeyOf(hit, at)
  });
}

function redrawOf(hit) {
  const now = readRedraw();
  const row = now.rows[kindOf(hit).key];
  return row ? { day: now.day, count: row.count || 0 } : null;
}

function redrawKeyOf(hit, now) {
  const row = redrawOf(hit);
  return kindOf(hit).key + "@" + store.dayKey(now) + "#" + (row ? row.count : 0);
}

function shapeOf(hit, now) {
  const view = viewOf(hit, now);
  return {
    key: hit.key || F.seasonOf(hit.of),
    kind: hit.kind,
    elapsed: hit.elapsed,
    days: hit.days,
    tag: tagOf(hit),
    tip: tipOf(hit),
    from: hit.from,
    poems: view.poems,
    more: view.more
  };
}

function viewOf(hit, now) {
  const all = poemsOf(hit);
  if (!all.length) return { poems: all, more: false };
  const row = redrawOf(hit);
  const seed = row ? kindOf(hit).key + "#" + row.count : all.map((p) => p.id).join(",");
  return {
    poems: picks(hit, seed, now),
    more: all.length > LIMIT
  };
}

function redraw(now) {
  const hit = current(now);
  if (!hit) return false;
  const row = redrawOf(hit);
  if (!row && poemsOf(hit).length <= LIMIT) return false;
  const all = readRedraw();
  all.rows[kindOf(hit).key] = { count: Math.min(REDRAW_MAX, (row ? row.count : 0) + 1) };
  return store.write(REDRAW_KEY, all);
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

function tier() {
  return entitlement.tierOf(CAP);
}

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

module.exports = {
  CAP,
  DAY,
  LIMIT,
  REDRAW_MAX,
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
  tier,
  redraw,
  card
};
