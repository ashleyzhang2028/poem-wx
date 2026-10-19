const quiz = require("../quiz/lib");
const cheer = require("../../../utils/cheer");
const gameScopes = require("../../../utils/game-scopes");
const entitlement = require("../../../utils/entitlement");
const sfx = require("../../../utils/sfx");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const tabPage = require("../../../utils/tab-page");

const DURATION = 20 * 60;
const QUESTION_COUNT = 10;

function blankAnswers(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push("");
  return a;
}

Page({
  data: {
    themeStyle: "",
    stage: "setup",
    scopes: [],
    scope: "",
    count: QUESTION_COUNT,
    questions: [],
    index: 0,
    current: null,

    barBelow: true,
    optionRows: [],

    metaLine: "",

    picked: "",

    answers: [],

    graded: [],
    correct: 0,
    cheerLine: "",
    quitLine: "",
    dots: [],
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
    this.setData({ barBelow: !!tabbar.pick(this) });
    const ok = entitlement.can("exam");
    this.setData({ allowed: ok, reason: ok ? "" : entitlement.hint("exam") });
    if (!ok || this.ready) return;
    this.ready = true;

    this.setData({
      scopes: gameScopes.list(),
      forms: quiz.FORMS,
      pickedForms: quiz.FORM_KEYS.slice()
    });
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
    tabPage.mine();
  },

  onUnload() {
    this.stopTimer();
  },

  onScope(e) {
    this.setData({ scope: e.detail.value || "" });
  },

  onStart() {
    const scope = this.data.scope;
    const questions = quiz.build({ scope, count: QUESTION_COUNT, forms: this.data.pickedForms });
    if (!questions.length) {
      wx.showToast({ title: "这个范围出不了题", icon: "none" });
      return;
    }
    const answers = blankAnswers(questions.length);
    this.setData(
      {
        stage: "running",
        questions,
        index: 0,
        current: questions[0],
        optionRows: quiz.optionRows(questions[0].options),
        metaLine: this.metaLineOf(questions[0]),
        picked: "",
        answers,
        dots: this.dotsOf(answers),
        graded: [],
        correct: 0,
        cheerLine: "",
        quitLine: "",
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

  dotsOf(answers) {
    const index = this.data.index;
    return answers.map((a, i) => ({
      key: i,
      no: i + 1,
      done: !!a,
      here: i === index
    }));
  },

  onPick(e) {
    const picked = e.currentTarget.dataset.v;
    if (picked === this.data.picked) return;
    sfx.answer(true);

    const answers = this.data.answers.slice();
    answers[this.data.index] = picked;
    this.setData({ picked, answers, dots: this.dotsOf(answers), quitLine: "" });
  },

  goto(index) {
    const questions = this.data.questions;
    if (!questions.length) return;
    const i = Math.max(0, Math.min(questions.length - 1, index));
    const q = questions[i];
    this.setData({
      index: i,
      current: q,
      optionRows: quiz.optionRows(q.options),
      metaLine: this.metaLineOf(q),
      picked: this.data.answers[i] || "",
      dots: this.dotsOf(this.data.answers)
    });
  },

  onStep(e) {
    this.goto(this.data.index + Number(e.currentTarget.dataset.step || 0));
  },

  onJump(e) {
    this.goto(Number(e.currentTarget.dataset.i));
  },

  onNext() {
    if (this.data.index + 1 >= this.data.questions.length) {
      if (!this.confirmSubmit()) return;
      this.finish();
      return;
    }
    this.goto(this.data.index + 1);
  },

  confirmSubmit() {
    const answers = this.data.answers;
    const answered = answers.filter((a) => a).length;
    const line = cheer.ofQuit(answered, this.data.questions.length);
    if (!line) return true;
    if (this.quitLine === line) return true;
    this.setData({ quitLine: line });
    return false;
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
    const score = Math.round((correct / total) * 100);
    sfx.rank(correct, total);
    this.setData({
      stage: "result",
      cheerLine: cheer.ofScore(score, correct),
      quitLine: "",
      graded: graded.map((g) => ({
        stem: g.stem,
        title: g.title,
        answer: g.answer,
        picked: g.picked || "未作答",
        ok: g.ok
      })),
      correct,
      score
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
      cheerLine: "",
      quitLine: "",
      dots: [],
      remain: DURATION,
      remainText: "20:00"
    });
  },
  onShareAppMessage() {
    return { title: "跬步 · 古诗词考试", path: "/packages/game/exam/exam" };
  }
});
