const store = require("./store");
const feedback = require("./feedback");

const KEY = "kb_exam_log_v1";
const MAX = 100;
const TOP = 3;

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

function list() {
  const raw = store.read(KEY, []);
  return Array.isArray(raw) ? raw.filter((r) => r && r.id) : [];
}

function shape(row) {
  const rank = feedback.rankPercent(row.pct);
  return Object.assign({}, row, {
    rankName: rank.name,
    rankNote: rank.note,
    crowned: rank.rank > feedback.RANKS.length - TOP,
    timeText: timeOf(row.at),
    spanText: spanOf(row.span)
  });
}

function rows() {
  return list().map(shape);
}

function latest() {
  const sum = summary();
  return sum.best ? shape(sum.best) : null;
}

function add(box) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(box && box.pct) || 0)));
  const row = {
    id: "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: Number(box && box.at) || Date.now(),
    pct: pct,
    correct: Math.max(0, Number(box && box.correct) || 0),
    total: Math.max(0, Number(box && box.total) || 0),
    scope: String((box && box.scope) || ""),
    scopeName: String((box && box.scopeName) || ""),
    span: Math.max(0, Math.round(Number(box && box.span) || 0))
  };
  store.write(KEY, [row].concat(list()).slice(0, MAX));
  return row;
}

function remove(ids) {
  const gone = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!gone.length) return 0;
  const all = list();
  const left = all.filter((r) => gone.indexOf(r.id) < 0);
  const n = all.length - left.length;
  if (n) store.write(KEY, left);
  return n;
}

function summary(all) {
  const src = Array.isArray(all) ? all : rows();
  if (!src.length) return { count: 0, best: null, last: null };
  const best = src.reduce((top, r) => (r.pct > top.pct ? r : top), src[0]);
  return { count: src.length, best: best, last: src[0] };
}

module.exports = { KEY, MAX, list, rows, latest, add, remove, summary, timeOf, spanOf };
