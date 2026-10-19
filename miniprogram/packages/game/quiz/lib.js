const corpus = require("../../../utils/corpus");
const gameScopes = require("../../../utils/game-scopes");

const FORMS = [
  { key: "next", name: "下句" },
  { key: "prev", name: "上句" },
  { key: "author", name: "作者" },
  { key: "dynasty", name: "朝代" },
  { key: "title", name: "篇名" }
];

const FORM_KEYS = FORMS.map((f) => f.key);
const DEFAULT_FORM_KEYS = FORM_KEYS.slice(0, 2);

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
const SENTENCE_END = /[，。！？；、]/;

function _quiz_linesOf(p) {
  const e = corpus.entry(p.id);
  if (!e || !e.text) return [];
  const raw = String(e.text)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const out = [];
  raw.forEach((line) => {
    if (line.length <= MAX_LINE) { out.push(line); return; }
    line.split(SENTENCE_END).forEach((seg) => {
      const t = seg.trim();
      if (t && t.length <= MAX_LINE) out.push(t);
    });
  });
  return out;
}

function build(opt) {
  const pool = gameScopes.pool(opt.scope).filter((p) => p.hasT);
  const count = opt.count || 10;
  const forms = opt.forms && opt.forms.length ? opt.forms : FORM_KEYS;
  const start = opt.start || 0;

  const questions = [];
  const used = {};
  let guard = 0;

  while (questions.length < count && guard < count * 40) {
    guard += 1;
    const p = _quiz_pick(pool);
    if (!p || used[p.id]) continue;
    const lines = _quiz_linesOf(p);
    if (lines.length < 2 && forms.indexOf("next") >= 0) continue;

    const form = opt.sequential ? forms[questions.length % forms.length] : _quiz_pick(forms);
    const q = _quiz_makeQuestion(form, p, lines, pool);
    if (!q) continue;
    used[p.id] = true;
    q.index = start + questions.length;
    questions.push(q);
  }

  return questions;
}

function _quiz_makeQuestion(form, p, lines, pool) {
  if (form === "next") {
    const idx = Math.floor(Math.random() * (lines.length - 1));
    const answer = lines[idx + 1];
    const distractors = _quiz_sampleFrom(pool, p.id, 3, (q) => {
      const ls = _quiz_linesOf(q);
      return ls.length ? _quiz_pick(ls) : "";
    });
    if (!answer) return null;
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
    const distractors = _quiz_sampleFrom(pool, p.id, 3, (q) => {
      const ls = _quiz_linesOf(q);
      return ls.length ? _quiz_pick(ls) : "";
    });
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
    const pool2 = pool.filter((q) => q.t && q.t !== p.t).map((q) => q.t);
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
    const distractorPool = pool.filter((q) => q.a && q.a !== p.a).map((q) => q.a);
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
  const dynastyPool = pool.filter((q) => q.d && q.d !== p.d).map((q) => q.d);
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

function _quiz_lettered(options) {
  return options.map((v, i) => ({ key: "ABCD"[i] || String(i + 1), text: v }));
}

function optionRows(list) {
  return (list || []).map((v) =>
    typeof v === "string" ? { key: "", text: v } : { key: v.key || "", text: v.text });
}

function _quiz_sampleFrom(pool, excludeId, n, project) {
  const out = [];
  let guard = 0;
  while (out.length < n && guard < 200) {
    guard += 1;
    const p = _quiz_pick(pool);
    if (!p || p.id === excludeId) continue;
    const v = project(p);
    if (!v || out.indexOf(v) >= 0) continue;
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
  FORMS, FORM_KEYS, DEFAULT_FORM_KEYS, formOf, formRows, build, judge, optionRows, optionClass
};
