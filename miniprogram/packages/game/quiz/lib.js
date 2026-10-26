const corpus = require("../../../utils/corpus");
const gameScopes = require("../../../utils/game-scopes");
const source = require("../../../utils/poem-source");

const REMOTE_PICK = 12;
const REMOTE_MIN = 6;
const REMOTE_MS = 6000;
const REMOTE_BATCH = 6;
const REMOTE_SHARE = 0.4;

const FORMS = [
  { key: "next", name: "下句" },
  { key: "prev", name: "上句" },
  { key: "author", name: "作者" },
  { key: "dynasty", name: "朝代" },
  { key: "title", name: "篇名" }
];

const FORM_KEYS = FORMS.map((f) => f.key);
const DEFAULT_FORM_KEYS = FORM_KEYS.slice(0, 2);

const TITLE_SPOILED = ["next", "prev", "title", "author"];

function titleSpoiled(forms) {
  return (forms || []).some((k) => TITLE_SPOILED.indexOf(k) >= 0);
}

function _quiz_pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function _quiz_shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

const MAX_LINE = 24;

const TEXTUAL = /[0-9A-Za-z\u3400-\u4dbf\u4e00-\u9fff]/;

function _quiz_usable(v) {
  return typeof v === "string" && TEXTUAL.test(v);
}

function _quiz_linesOf(p) {
  const e = p.text ? { text: p.text } : corpus.entry(p.id);
  if (!e || !e.text) return [];

  const out = [];
  corpus.splitLines(e.text).forEach((ln) => {
    const segs = ln.s;
    if (segs.length > 1) {
      segs.forEach((seg) => out.push(seg));
      return;
    }
    if (segs.length && segs[0].length <= MAX_LINE) out.push(segs[0]);
  });
  return out;
}

function build(opt) {
  const extra = (opt.extra || []).filter((p) => p.hasT);
  const base = opt.scope === gameScopes.ANY_SCOPE && extra.length ? [] : gameScopes.pool(opt.scope);
  const pool = base.filter((p) => p.hasT).concat(extra);
  const count = opt.count || 10;
  const forms = opt.forms && opt.forms.length ? opt.forms : FORM_KEYS;
  const start = opt.start || 0;

  const questions = [];
  const used = {};
  let guard = 0;

  while (questions.length < count && guard < count * 40) {
    guard += 1;
    const p = extra.length && Math.random() < REMOTE_SHARE ? _quiz_pick(extra) : _quiz_pick(pool);
    if (!p || used[p.id]) continue;
    const lines = _quiz_linesOf(p);
    if (lines.length < 2 && forms.indexOf("next") >= 0) continue;

    const form = pickedForm(forms, questions.length, opt);
    const q = _quiz_makeQuestion(form, p, lines, pool);
    if (!q) continue;
    used[p.id] = true;
    q.remote = !!p.remote;
    q.index = start + questions.length;
    questions.push(q);
  }

  return questions;
}

function remoteRows() {
  const rows = [];
  corpus.booksOf().forEach((b) => {
    if (!b.remote) return;
    corpus.ofBook(b.id).forEach((r) => {
      if (r.sid && r.a) rows.push(r);
    });
  });
  return rows;
}

function remoteEntry(poem) {
  const m = source.metaOf(poem);
  if (!m.text || !m.t) return null;
  return { id: m.id, t: m.t, a: m.a, d: m.d, text: m.text, hasT: true, remote: true, b: "source" };
}

function fetchRandom() {
  const run = (n) => Promise.all(Array.from({ length: n }, () =>
    source.withTimeout(source.random(), REMOTE_MS).then(remoteEntry, () => null)));
  return run(REMOTE_BATCH)
    .then((first) => run(REMOTE_PICK - REMOTE_BATCH).then((second) => first.concat(second)))
    .then((list) => list.filter(Boolean));
}

function fetchCatalog() {
  const picked = _quiz_shuffle(remoteRows()).slice(0, REMOTE_PICK);
  const run = (batch) => Promise.all(batch.map((r) =>
    source.withTimeout(source.byId(r.sid, r), REMOTE_MS).then(remoteEntry, () => null)));
  return run(picked.slice(0, REMOTE_BATCH))
    .then((first) => run(picked.slice(REMOTE_BATCH)).then((second) => first.concat(second)))
    .then((list) => list.filter(Boolean));
}

const FETCH_BY_SCOPE = {
  [gameScopes.EXTRA_SCOPE]: fetchCatalog,
  [gameScopes.ANY_SCOPE]: fetchRandom
};

function buildAsync(opt) {
  const local = (degraded) => ({ questions: build(opt), remote: 0, degraded: degraded });
  const fetchExtra = FETCH_BY_SCOPE[opt.scope];
  if (!fetchExtra) return Promise.resolve(local(false));
  if (!source.usable()) return Promise.resolve(local(true));
  return fetchExtra().then((extra) => {
    if (extra.length < REMOTE_MIN) return local(true);
    return { questions: build(Object.assign({}, opt, { extra: extra })), remote: extra.length, degraded: false };
  }, () => local(true));
}

function pickedForm(forms, index, opt) {
  if (opt && opt.sequential) return forms[index % forms.length];
  return _quiz_pick(forms);
}

function _quiz_makeQuestion(form, p, lines, pool) {
  if (form === "next") {
    const idx = Math.floor(Math.random() * (lines.length - 1));
    const answer = lines[idx + 1];
    if (!_quiz_usable(answer)) return null;
    const distractors = _quiz_sampleFrom(pool, p.id, 3, (q) => {
      const ls = _quiz_linesOf(q);
      return ls.length ? _quiz_pick(ls) : "";
    }, [answer]);
    return {
      form: "next",
      stem: lines[idx],
      title: p.t,
      answer,
      options: _quiz_lettered(_quiz_shuffle([answer].concat(distractors))),
      id: p.id
    };
  }

  if (form === "prev") {
    if (lines.length < 2) return null;
    const idx = Math.floor(Math.random() * (lines.length - 1)) + 1;
    const answer = lines[idx - 1];
    if (!_quiz_usable(answer)) return null;
    const distractors = _quiz_sampleFrom(pool, p.id, 3, (q) => {
      const ls = _quiz_linesOf(q);
      return ls.length ? _quiz_pick(ls) : "";
    }, [answer]);
    return {
      form: "prev",
      stem: lines[idx],
      title: p.t,
      answer,
      options: _quiz_lettered(_quiz_shuffle([answer].concat(distractors))),
      id: p.id
    };
  }

  if (form === "title") {
    if (!p.t || p.t.length > MAX_LINE || !lines.length) return null;
    const pool2 = pool.filter((q) => q.t && q.t !== p.t).map((q) => q.t).filter(_quiz_usable);
    const distractors = _quiz_uniqueSample(pool2, 3);
    if (distractors.length < 3) return null;
    return {
      form: "title",
      stem: _quiz_pick(lines),
      title: p.t,
      answer: p.t,
      options: _quiz_lettered(_quiz_shuffle([p.t].concat(distractors))),
      id: p.id
    };
  }

  if (form === "author") {
    if (!p.a || !lines.length) return null;
    const distractorPool = pool.filter((q) => q.a && q.a !== p.a).map((q) => q.a).filter(_quiz_usable);
    const distractors = _quiz_uniqueSample(distractorPool, 3);
    if (distractors.length < 3) return null;
    return {
      form: "author",
      stem: _quiz_pick(lines),
      title: p.t,
      answer: p.a,
      options: _quiz_lettered(_quiz_shuffle([p.a].concat(distractors))),
      id: p.id
    };
  }

  if (!p.d || !p.a) return null;
  const dynastyPool = pool.filter((q) => q.d && q.d !== p.d).map((q) => q.d).filter(_quiz_usable);
  const distractors = _quiz_uniqueSample(dynastyPool, 3);
  if (distractors.length < 3) return null;
  return {
    form: "dynasty",
    stem: p.a,
    title: p.t,
    answer: p.d,
    options: _quiz_lettered(_quiz_shuffle([p.d].concat(distractors))),
    id: p.id
  };
}

function stemRows(question) {
  const stem = question && question.stem;
  const rows = corpus.splitDisplay(stem);
  while (rows.length < 3) rows.push("");
  return rows;
}

function _quiz_lettered(options) {
  return options.map((v, i) => ({ key: "ABCD"[i] || String(i + 1), text: v }));
}

function optionRows(list) {
  return (list || []).map((v) =>
    typeof v === "string" ? { key: "", text: v } : { key: v.key || "", text: v.text });
}

function _quiz_sampleFrom(pool, excludeId, n, project, skip) {
  const out = [];
  let guard = 0;
  while (out.length < n && guard < 200) {
    guard += 1;
    const p = _quiz_pick(pool);
    if (!p || p.id === excludeId) continue;
    const v = project(p);
    if (!_quiz_usable(v) || out.indexOf(v) >= 0 || (skip && skip.indexOf(v) >= 0)) continue;
    out.push(v);
  }
  return out;
}

function _quiz_uniqueSample(list, n) {
  const uniq = [];
  list.forEach((v) => {
    if (uniq.indexOf(v) < 0) uniq.push(v);
  });
  return _quiz_shuffle(uniq).slice(0, n);
}

function judge(question, picked) {
  const ok = !!question && picked === question.answer;
  return {
    ok: ok,
    answer: question ? question.answer : "",
    picked: picked,
    form: question ? question.form : "",
    stem: question ? question.stem : "",
    title: question ? question.title : "",
    id: question ? question.id : ""
  };
}

function formRows(picked) {
  return FORMS.map((f) => Object.assign({}, f, { on: (picked || []).indexOf(f.key) >= 0 }));
}

function formOf(key) {
  return FORMS.find((f) => f.key === key) || FORMS[0];
}

function optionClass(row, picked, answer) {
  if (!picked || !row) return "";
  if (row.text === answer) return "right";
  if (row.text === picked) return "wrong";
  return "";
}

module.exports = {
  FORMS, FORM_KEYS, DEFAULT_FORM_KEYS, formOf, formRows, build, buildAsync, judge, optionRows, optionClass,
  stemRows, titleSpoiled, usable: _quiz_usable
};
