const quiz = require("../../../utils/quiz");
const corpus = require("../../../utils/corpus");
const entitlement = require("../../../utils/entitlement");
const sfx = require("../../../utils/sfx");
const theme = require("../../../utils/theme");

const DURATION = 20 * 60;
const QUESTION_COUNT = 10;

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

    optionRows: [],

    metaLine: "",

    picked: "",

    answers: [],

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

  onToggleForm(e) {
    const picked = e.detail.value || [];
    if (!picked.length) {
      wx.showToast({ title: "至少留一种题型", icon: "none" });

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
        optionRows: quiz.optionRows(questions[0].options),
        metaLine: this.metaLineOf(questions[0]),
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

    const next = this.data.questions[index];
    this.setData({
      index,
      current: next,
      optionRows: quiz.optionRows(next.options),
      metaLine: this.metaLineOf(next),
      picked: this.data.answers[index] || ""
    });
  },

  metaLineOf(q) {
    if (!q) return "";
    const name = quiz.formOf(q.form).name;

    if (q.form === "dynasty" || !q.title) return name;
    return name + " · 出自《" + q.title + "》";
  },

  finish() {
    this.stopTimer();
    const questions = this.data.questions;
    const answers = this.data.answers;
    const judge = quiz.judge;
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
