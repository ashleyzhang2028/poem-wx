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
  { key: "prev", name: "接上句", desc: "给下句选上句" },
  { key: "author", name: "认作者", desc: "给诗句选作者" },
  { key: "dynasty", name: "填朝代", desc: "给作者选朝代" },
  { key: "title", name: "猜篇名", desc: "给诗句选出处" },
  { key: "fill", name: "填字", desc: "补出空缺的那个字" }
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

  if (form === "prev") {
    // 接上句：给下句选上句。与「接下句」共用取词逻辑，只是取的位置不同
    if (lines.length < 2) return null;
    const idx = Math.floor(Math.random() * (lines.length - 1));
    const answer = lines[idx];
    const distractors = sampleFrom(pool, p.id, 3, (q) => {
      const ls = linesOf(q);
      return ls.length ? pick(ls) : "";
    });
    return {
      form: "prev",
      stem: lines[idx + 1],
      title: p.t,
      answer,
      options: shuffle([answer].concat(distractors)),
      id: p.id
    };
  }

  if (form === "title") {
    // 猜篇名：给一句诗，问出自哪一篇。干扰项只取同一作者的另一篇会太容易，
    // 所以从整个池子里抽，且保证不是同一篇
    const distractorPool = pool.filter((q) => q.t && q.id !== p.id).map((q) => q.t);
    const distractors = uniqueSample(distractorPool, 3);
    if (!lines.length || distractors.length < 3) return null;
    return {
      form: "title",
      stem: pick(lines),
      answer: p.t,
      author: p.a,
      options: shuffle([p.t].concat(distractors)),
      id: p.id
    };
  }

  if (form === "fill") {
    // 填字：挖掉一句里的一个字，四个候选都是语料里真实出现过的字。
    // 干扰项从别的句子里取同一个位置的字符 —— 比随机取字更难，也更像真题
    const line = pick(lines);
    const chars = Array.from(line).filter((c) => /[\u3400-\u9fff]/.test(c));
    if (chars.length < 4) return null;

    const at = Math.floor(Math.random() * chars.length);
    const answer = chars[at];
    // 空处用「□」占位，选项里给足四个不同的字
    const blank = Array.from(line);
    let seen = 0;
    for (let i = 0; i < blank.length; i++) {
      if (!/[\u3400-\u9fff]/.test(blank[i])) continue;
      if (seen === at) {
        blank[i] = "□";
        break;
      }
      seen += 1;
    }

    const picked = {};
    picked[answer] = 1;
    const distractors = [];
    for (let g = 0; g < 60 && distractors.length < 3; g++) {
      const q = pick(pool);
      const ls = linesOf(q);
      if (!ls.length) continue;
      const cs = Array.from(pick(ls)).filter((c) => /[\u3400-\u9fff]/.test(c));
      const c = cs[Math.floor(Math.random() * cs.length)];
      if (!c || picked[c]) continue;
      picked[c] = 1;
      distractors.push(c);
    }
    if (distractors.length < 3) return null;

    return {
      form: "fill",
      stem: blank.join(""),
      answer,
      title: p.t,
      author: p.a,
      options: shuffle([answer].concat(distractors)),
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
