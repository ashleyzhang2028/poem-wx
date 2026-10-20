const corpus = require("./corpus");

let trailIds = [];

function set(ids) {
  trailIds = Array.isArray(ids) ? ids.slice() : [];
}

function sequenceOf(id) {
  if (trailIds.indexOf(id) >= 0) return trailIds;
  const meta = corpus.indexById(id);
  return meta && meta.b ? corpus.ofBook(meta.b).map((p) => p.id) : [];
}

function stub(id) {
  const meta = id ? corpus.indexById(id) : null;
  return meta ? { id: id, title: meta.t } : null;
}

function around(id, given) {
  const seq = given || sequenceOf(id);
  const at = seq.indexOf(id);
  if (at < 0) return { show: false, prev: null, next: null };
  const prev = stub(seq[at - 1]);
  const next = stub(seq[at + 1]);
  return { show: !!(prev || next), prev: prev, next: next };
}

module.exports = { set, around };
