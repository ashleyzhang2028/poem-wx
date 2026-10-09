/**
 * 出题内核。与网页版 js/quiz.js 同一套思路：就地取材，不接 AI、不花钱。
 *
 * 五种题型都由语料自身生成，不需要额外题库：
 *   - 下句：给上句，四选一选下句
 *   - 上句：给下句，四选一选上句
 *   - 作者：给诗句，四选一选作者
 *   - 朝代：给作者，四选一选朝代
 *   - 篇名：给诗句，四选一选篇名
 */
const corpus = require("./corpus");

/* 题型清单。名字都是**两个字** —— 题型是嵌在「题型 · 出自《…》」那一行读数里的，
   四个字会把那一行顶到折行；而且这一栏说的只是「这道题在问什么」，
   「接下句」「认作者」里的动词全是这一行给不出、也不必给的余量
   （下面是选项，选项自己会说话）。2026-10-03 用户点名收短：
   接下句 → 下句、接上句 → 上句、认作者 → 作者、填朝代 → 朝代、认篇名 → 篇名。

   另一件：**没有颜色这一栏** —— 上一版每个题型配了一个色
   （接下句 / 接上句绿、认作者 / 认篇名琥珀、填朝代蓝），显示成答题屏上
   题干上方那枚小标签。用户 2026-10-03 的要求是「标题、选项、设置、内容
   都专业精简」，而一枚彩色标签既不是读数也不是选择，只是一句广告词：

     · 它与题干下面那行「出自《春晓》」说的是**同一件事**（这道题在问什么），
       两行合成一行就够 —— 像详情页的身份行那样，用「·」断开。
     · 颜色在别处是**状态**（绿=对、红=错、琥珀=待办），借给题型用，
       同一屏里就多出三种「不说话的颜色」。
     · 五个题型里三个撞色（绿×2、琥珀×2），本来也分不开谁是谁。

   所以标签撤掉，读数并进出处那一行；`color` 这个字段一并删掉，
   免得后来的人再照抄一份。 */
const FORMS = [
  { key: "next", name: "下句" },
  { key: "prev", name: "上句" },
  { key: "author", name: "作者" },
  { key: "dynasty", name: "朝代" },
  { key: "title", name: "篇名" }
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

/* 一句的边界：到什么长度、在哪里断。

   起因是一道真的出了洋相的题：语料里《六国论》整段是**一行 223 字**，
   「给诗句认篇名」抽到它，答题卡上只剩题干、选项被顶到下一页；
   交卷后的逐题回顾里，这道题一个人吃掉两屏。而它问的只是
   「这首诗叫什么名字」—— 两百字的题干对答题毫无帮助。

   数据面的规模：5324 篇里 3384 篇的「行」超过 40 字，29 篇课内文言文
   （《核舟记》158 字、《赤壁赋》整段一段一行）都在其中。

   所以「一句」不再等于「一行」：
     1. 先按行切开（诗词本来就是这个粒度）；
     2. 行内再按**句读**切 —— 文言文用 `，。！？；` 断句，
        《无衣》的「岂曰无衣？与子同袍。」因此得到两个八字的句子，
        而不是被整行丢掉；
     3. 切完仍超过 MAX_LINE 的（长复句、引文）不算一句，不要了。

   24 字这一档：七言律诗一联 14 字，加上「。 」与序言余量，
   24 字是一眼读得完、一屏放得下的上限。 */
const MAX_LINE = 24;
const SENTENCE_END = /[，。！？；、]/;

function linesOf(p) {
  const e = corpus.entry(p.id);
  if (!e || !e.text) return [];
  const raw = String(e.text)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  // 短行直接用（诗词的正路）；长行按句读再切一刀，切不动才丢
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
      options: lettered(shuffle([answer].concat(distractors))),
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
      options: lettered(shuffle([answer].concat(distractors))),
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
      options: lettered(shuffle([p.t].concat(distractors))),
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
      options: lettered(shuffle([p.a].concat(distractors))),
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
    options: lettered(shuffle([p.d].concat(distractors))),
    id: p.id
  };
}

/**
 * 四个选项配上脚标字母 A B C D。
 *
 * 为什么要有：选项之间**没有任何序号**时，用户指着屏幕说「第三个」、
 * 我们回一句「你选的那个」，两边说的不是同一个东西；四个选项还长得
 * 一模一样（都是白底描边的一条），扫一遍才知道要找的是哪个。
 *
 * 为什么字母是**选项自带的**、而不是渲染时按下标画上去的：
 * `options` 是判分用的那一份数据（`judge` 拿 `picked === answer` 比），
 * 下标一挪，判分就错位。字母随选项一起生成、一起被打乱，
 * 就永远是「看着是 B 的那一条 = 选中的是 B」。
 *
 * 字母也**不写进 `answer`**：判分比的是原文，不是印在屏幕上的那三个字。
 * 传字母只传到 `optionRows`（给模板遍历用的那一份）。
 */
function lettered(options) {
  return options.map((v, i) => ({ key: "ABCD"[i] || String(i + 1), text: v }));
}

/**
 * 选项 ⇒ 模板要的那一份。字母是**看着的那个**，text 是**判分用的那个**。
 */
function optionRows(list) {
  return (list || []).map((v) =>
    typeof v === "string" ? { key: "", text: v } : { key: v.key || "", text: v.text });
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

/** 逐题判定，供考试与题库共用，判分口径只此一处 */
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

module.exports = { FORMS, FORM_KEYS, formOf, build, judge, optionRows };
