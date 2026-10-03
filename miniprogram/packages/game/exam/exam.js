const quiz = require("../../../utils/quiz");
const corpus = require("../../../utils/corpus");
const entitlement = require("../../../utils/entitlement");
const sfx = require("../../../utils/sfx");
const theme = require("../../../utils/theme");

const DURATION = 20 * 60;
const QUESTION_COUNT = 10;

/* 卷子每道题一份「答卷」—— 判分不再边答边做，而是交卷时统一批。
   用户原话是「所有题目答完后再给分给对错」，所以答题途中页面拿不到
   `answer` 这个东西：选项上只有「没选 / 选了」两态（见 exam.wxml）。
   留的是 picked，每道题一个格子，答完停在原地也能回头改。 */
function blankAnswers(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push("");
  return a;
}

Page({
  data: {
    stage: "setup",
    scopes: [],
    scopeIndex: 0,
    count: QUESTION_COUNT,
    questions: [],
    index: 0,
    current: null,
    /** 当前这道题选了什么（= answers[index] 的镜像，WXML 里要它判高亮） */
    picked: "",
    /** 逐题的作答。顺序与 questions 一一对应 —— 交卷时按它批 */
    answers: [],
    /** 批完之后逐题的结果（含对的，不只是错题） */
    graded: [],
    correct: 0,
    remain: DURATION,
    remainText: "20:00",
    score: 0,
    forms: [],
    pickedForms: [],
    cardSet: false,

    allowed: false,
    reason: ""
  },

  onShow() {
    theme.apply(this);
    const ok = entitlement.can("exam");
    this.setData({ allowed: ok, reason: ok ? "" : entitlement.hint("exam") });
    if (!ok || this.ready) return;
    this.ready = true;

    const books = corpus.books().filter((b) => b.id !== "poems");
    const scopes = [{ id: "", name: "课内诗词" }].concat(books.map((b) => ({ id: b.id, name: b.name })));
    this.setData({ scopes, forms: quiz.FORMS, pickedForms: quiz.FORM_KEYS.slice() });
  },

  /**
   * 题型多选。
   *
   * 上一版是自己算差异（list.splice / push 之后再 setData）。那个写法有个洞：
   * 数据是「我算出来的」，不是「用户勾出来的」，一旦两边的判断错开一格，
   * 界面上的勾与页面里的数据就再也对不上了。
   *
   * 现在只认 checkbox-group 交出的一份完整清单，页面不再自己算增删。
   * 上一版还有一处：取消掉最后一个勾时只弹了个 toast 就 return，
   * 数据没改、勾却真被用户点掉了 —— 那条路径现在被 setData 折回来。
   */
  onToggleForm(e) {
    const picked = e.detail.value || [];
    if (!picked.length) {
      wx.showToast({ title: "至少留一种题型", icon: "none" });
      // 原生控件已经把那个勾去掉了，而数据不许为空 —— 必须把选中态重设回去，
      // 否则界面（全没勾）与数据（还有一项）从此对不上，下次进这个页面会「自动」多出题型。
      this.setData({ pickedForms: this.data.pickedForms.slice() });
      return;
    }
    this.setData({ pickedForms: picked });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onUnload() {
    this.stopTimer();
  },

  onScope(e) {
    this.setData({ scopeIndex: Number(e.detail.value) || 0 });
  },

  onStart() {
    const scope = this.data.scopes[this.data.scopeIndex].id;
    const questions = quiz.build({ scope, count: QUESTION_COUNT, forms: this.data.pickedForms });
    if (!questions.length) {
      wx.showToast({ title: "这个范围出不了题", icon: "none" });
      return;
    }
    this.setData(
      {
        stage: "running",
        questions,
        index: 0,
        current: questions[0],
        picked: "",
        answers: blankAnswers(questions.length),
        graded: [],
        correct: 0,
        remain: DURATION,
        remainText: "20:00"
      },
      () => this.startTimer()
    );
  },

  startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => {
      const remain = this.data.remain - 1;
      if (remain <= 0) {
        this.stopTimer();
        this.finish();
        return;
      }
      this.setData({ remain, remainText: this.format(remain) });
    }, 1000);
  },

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },

  format(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  },

  /**
   * 选一个答案。
   *
   * 这里**不判对错**（用户原话「所有题目答完后再给分给对错」）——
   * 只是把这一格记下来，并且**可以改**：答完了想回头换一题是常事，
   * 上一版点一下就锁死、0.8 秒后自动翻页，等于不给回头。
   *
   * 但该响一声还是响 —— 没有反馈的话用户不知道这一下点没点着。
   * 上一版这里用的是「答对 / 答错」两种音效，而它等于当场把答案说了出来；
   * 现在一律走 sfx.answer(true)：那是「记下了」的一声，不是「对了」的一声。
   */
  onPick(e) {
    const picked = e.currentTarget.dataset.v;
    if (picked === this.data.picked) return;
    sfx.answer(true);

    const answers = this.data.answers.slice();
    answers[this.data.index] = picked;
    this.setData({ picked, answers });
  },

  onNext() {
    const index = this.data.index + 1;
    if (index >= this.data.questions.length) {
      this.finish();
      return;
    }
    // 回头改过的答案要恢复：下一题的高亮取的是它自己的那一格
    this.setData({ index, current: this.data.questions[index], picked: this.data.answers[index] || "" });
  },

  /**
   * 交卷：从这里开始才有对错。
   *
   * 判分仍走 utils/quiz.js 的 judge（与题库页同一份口径，只此一处），
   * 但**批的是整份答卷**：逐题摊开，对的也列 ——
   * 「我哪几道是对的」和「我哪几道错了」一样是这场考试的信息。
   *
   * 时间到与主动交卷走同一条路，所以「没答完」这件事是在这里被如实交代的：
   * 空白格判为答错（judge 对空答案返回 false），不假装没这回事。
   */
  finish() {
    this.stopTimer();
    const questions = this.data.questions;
    const answers = this.data.answers;
    const judge = quiz.judge;   // 与题库页同一份判分口径，只此一处
    const graded = questions.map((q, i) => judge(q, answers[i] || ""));
    const correct = graded.filter((g) => g.ok).length;

    const total = questions.length || 1;
    sfx.rank(correct, total);
    this.setData({
      stage: "result",
      graded: graded.map((g) => ({
        stem: g.stem,
        title: g.title,
        answer: g.answer,
        picked: g.picked || "未作答",
        ok: g.ok
      })),
      correct,
      score: Math.round((correct / total) * 100)
    });
  },

  onAgain() {
    this.setData({
      stage: "setup",
      questions: [],
      answers: [],
      graded: [],
      picked: "",
      correct: 0,
      remain: DURATION,
      remainText: "20:00"
    });
  },
  onShareAppMessage() {
    return { title: "跬步 · 古诗词考试", path: "/packages/game/exam/exam" };
  }
});
