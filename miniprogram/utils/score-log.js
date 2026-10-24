const store = require("./store");
const feedback = require("./feedback");
const entitlement = require("./entitlement");
const tiers = require("./tiers");
const remote = require("./remote");

const MODES = {
  exam: { key: "kb_exam_log_v1", game: "exam", unit: "分", total: 100 },
  feihua: { key: "kb_feihua_log_v1", game: "fly", unit: "句", total: 0 }
};

const TOP = 3;

function modeOf(name) {
  return MODES[name] || MODES.exam;
}

function pad(n) {
  return (n < 10 ? "0" : "") + n;
}

function timeOf(ts) {
  const d = new Date(Number(ts) || 0);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
    + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function spanOf(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0));
  return Math.floor(n / 60) + "'" + pad(n % 60) + "\"";
}

function pctOf(mode, box) {
  if (mode === "feihua") return Math.min(100, (Number(box && box.hit) || 0) * 10);
  return box && box.pct;
}

function keep(tier) {
  const n = tiers.RECORD_LIMITS[tier];
  return Number(n) > 0 ? Number(n) : 0;
}

function limit() {
  return keep(entitlement.status().tier);
}

function syncOn() {
  return remote.configured() && entitlement.loggedIn() && limit() > 0;
}

function list(name) {
  const raw = store.read(modeOf(name).key, []);
  return Array.isArray(raw) ? raw.filter((r) => r && r.id) : [];
}

function shape(name, row) {
  const mode = modeOf(name);
  const rank = feedback.rankPercent(pctOf(name, row));
  const hit = Math.max(0, Math.round(Number(row.hit) || 0));
  return Object.assign({}, row, {
    hit: hit,
    hitText: mode.key === MODES.feihua.key ? hit + " 句" : row.pct + " 分",
    rankName: rank.name,
    rankNote: rank.note,
    crowned: rank.rank > feedback.RANKS.length - TOP,
    timeText: timeOf(row.at),
    spanText: spanOf(row.span)
  });
}

function rows(name) {
  return list(name).map((r) => shape(name, r));
}

function latest(name) {
  const raw = list(name)[0];
  if (!raw) return null;
  const row = shape(name, raw);
  return { pct: pctOf(name, raw), hit: row.hit, rank: feedback.rankPercent(pctOf(name, raw)) };
}

function push(name, row) {
  const cap = limit();
  if (!cap) return;
  store.write(modeOf(name).key, [row].concat(list(name)).slice(0, cap));
}

function add(name, box) {
  const row = {
    id: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: Number(box && box.at) || Date.now(),
    pct: Math.max(0, Math.min(100, Math.round(Number(box && box.pct) || 0))),
    hit: Math.max(0, Math.round(Number(box && box.hit) || 0)),
    correct: Math.max(0, Number(box && box.correct) || 0),
    total: Math.max(0, Number(box && box.total) || 0),
    scope: String((box && box.scope) || ""),
    scopeName: String((box && box.scopeName) || ""),
    span: Math.max(0, Math.round(Number(box && box.span) || 0))
  };
  push(name, row);
  return row;
}

function forget(name, ids) {
  const gone = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!gone.length) return 0;
  const all = list(name);
  const left = all.filter((r) => gone.indexOf(r.id) < 0);
  const n = all.length - left.length;
  if (n) store.write(modeOf(name).key, left);
  return n;
}

function remove(name, ids) {
  const gone = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  const n = forget(name, gone);
  if (!n || !syncOn()) return n;
  const game = modeOf(name).game;
  gone.forEach((id) => {
    remote.rankingDelete(game, id).then((res) => {
      if (res && res.ok) return null;
      const back = list(name);
      const row = back.filter((r) => r.id === id)[0];
      if (row) push(name, row);
      return null;
    });
  });
  return n;
}

function summary(name, all) {
  const src = Array.isArray(all) ? all : rows(name);
  if (!src.length) return { count: 0, best: null, last: null };
  const best = src.reduce((top, r) => (pctOf(name, r) > pctOf(name, top) ? r : top), src[0]);
  return { count: src.length, best: best, last: src[0] };
}

module.exports = { MODES, modeOf, keep, list, rows, latest, add, remove, summary, timeOf, spanOf, limit };
