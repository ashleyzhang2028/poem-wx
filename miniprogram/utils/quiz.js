/**
 * 出题内核。与网页版 js/quiz.js 同一套思路：就地取材，不接 AI、不花钱。
 *
 * 三种题型都由语料自身生成，不需要额外题库：
 *   - 接下句：给上句，四选一选下句
 *   - 认作者：给诗句，四选一选作者
 *   - 填朝代：给作者，四选一选朝代
 */
const corpus = require("./corpus");

const FORMS = [
  { key: "next", name: "接下句", color: "green" },
  { key: "prev", name: "接上句", color: "green" },
  { key: "author", name: "认作者", color: "amber" },
  { key: "dynasty", name: "填朝代", color: "blue" },
  { key: "title", name: "认篇名", color: "amber" }
];

const FORM_KEYS = FORMS.map((f) => f.key);

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function linesOf(p) {
  const e = corpus.entry(p.id);
  if (!e || !e.text) return [];
  return String(e.text)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 出卷。
 * @param {Object} opt scope（集子 id，空串为全站课内）/ count / forms
 */
function build(opt) {
  const pool = (opt.scope ? corpus.ofBook(opt.scope) : corpus.course()).filter((p) => p.hasT);
  const count = opt.count || 10;
  const forms = opt.forms && opt.forms.length ? opt.forms : FORM_KEYS;
  const start = opt.start || 0;

  const questions = [];
  const used = {};
  let guard = 0;

  while (questions.length < count && guard < count * 40) {
    guard += 1;
    const p = pick(pool);
    if (!p || used[p.id]) continue;
    const lines = linesOf(p);
    if (lines.length < 2 && forms.indexOf("next") >= 0) continue;

    // 顺序出题时按 forms 轮转，随机出题时抽签 —— 顺序卷更好对答案
    const form = opt.sequential ? forms[questions.length % forms.length] : pick(forms);
    const q = makeQuestion(form, p, lines, pool);
    if (!q) continue;
    used[p.id] = true;
    q.index = start + questions.length;
    questions.push(q);
  }

  return questions;
}

function makeQuestion(form, p, lines, pool) {
  if (form === "next") {
    const idx = Math.floor(Math.random() * (lines.length - 1));
    const answer = lines[idx + 1];
    const distractors = sampleFrom(pool, p.id, 3, (q) => {
      const ls = linesOf(q);
      return ls.length ? pick(ls) : "";
    });
    if (!answer) return null;
    return {
      form: "next",
      stem: lines[idx],
      title: p.t,
      answer,
      options: shuffle([answer].concat(distractors)),
      id: p.id
    };
  }

  if (form === "prev") {
    if (lines.length < 2) return null;
    const idx = Math.floor(Math.random() * (lines.length - 1)) + 1;
    const answer = lines[idx - 1];
    const distractors = sampleFrom(pool, p.id, 3, (q) => {
      const ls = linesOf(q);
      return ls.length ? pick(ls) : "";
    });
    return {
      form: "prev",
      stem: lines[idx],
      title: p.t,
      answer,
      options: shuffle([answer].concat(distractors)),
      id: p.id
    };
  }

  if (form === "title") {
    if (!p.t || !lines.length) return null;
    const pool2 = pool.filter((q) => q.t && q.t !== p.t).map((q) => q.t);
    const distractors = uniqueSample(pool2, 3);
    if (distractors.length < 3) return null;
    return {
      form: "title",
      stem: pick(lines),
      title: p.t,
      answer: p.t,
      options: shuffle([p.t].concat(distractors)),
      id: p.id
    };
  }

  if (form === "author") {
    if (!p.a || !lines.length) return null;
    const distractorPool = pool.filter((q) => q.a && q.a !== p.a).map((q) => q.a);
    const distractors = uniqueSample(distractorPool, 3);
    if (distractors.length < 3) return null;
    return {
      form: "author",
      stem: pick(lines),
      title: p.t,
      answer: p.a,
      options: shuffle([p.a].concat(distractors)),
      id: p.id
    };
  }

  if (!p.d || !p.a) return null;
  const dynastyPool = pool.filter((q) => q.d && q.d !== p.d).map((q) => q.d);
  const distractors = uniqueSample(dynastyPool, 3);
  if (distractors.length < 3) return null;
  return {
    form: "dynasty",
    stem: p.a,
    title: p.t,
    answer: p.d,
    options: shuffle([p.d].concat(distractors)),
    id: p.id
  };
}

function sampleFrom(pool, excludeId, n, project) {
  const out = [];
  let guard = 0;
  while (out.length < n && guard < 200) {
    guard += 1;
    const p = pick(pool);
    if (!p || p.id === excludeId) continue;
    const v = project(p);
    if (!v || out.indexOf(v) >= 0) continue;
    out.push(v);
  }
  return out;
}

function uniqueSample(list, n) {
  const uniq = [];
  list.forEach((v) => {
    if (uniq.indexOf(v) < 0) uniq.push(v);
  });
  return shuffle(uniq).slice(0, n);
}

/** 逐题判定，供模拟考试与题库共用，判分口径只此一处 */
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

function formOf(key) {
  return FORMS.find((f) => f.key === key) || FORMS[0];
}

module.exports = { FORMS, FORM_KEYS, formOf, build, judge };
