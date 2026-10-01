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
  { key: "next", name: "接下句", desc: "给上句选下句" },
  { key: "author", name: "认作者", desc: "给诗句选作者" },
  { key: "dynasty", name: "填朝代", desc: "给作者选朝代" }
];

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
  const forms = opt.forms && opt.forms.length ? opt.forms : FORMS.map((f) => f.key);

  const questions = [];
  const used = {};
  let guard = 0;

  while (questions.length < count && guard < count * 40) {
    guard += 1;
    const p = pick(pool);
    if (!p || used[p.id]) continue;
    const lines = linesOf(p);
    if (lines.length < 2 && forms.indexOf("next") >= 0) continue;

    const form = pick(forms);
    const q = makeQuestion(form, p, lines, pool);
    if (!q) continue;
    used[p.id] = true;
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

module.exports = { FORMS, build };
