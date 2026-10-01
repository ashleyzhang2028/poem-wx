const quiz = require("../../../utils/quiz");
const corpus = require("../../../utils/corpus");
const entitlement = require("../../../utils/entitlement");

const DURATION = 20 * 60;
const QUESTION_COUNT = 10;

Page({
  data: {
    stage: "setup",
    scopes: [],
    scopeIndex: 0,
    count: QUESTION_COUNT,
    questions: [],
    index: 0,
    current: null,
    picked: "",
    answered: 0,
    correct: 0,
    remain: DURATION,
    remainText: "20:00",
    wrong: [],
    score: 0,
    forms: [],
    pickedForms: [],
    cardSet: false,

    allowed: false,
    reason: ""
  },

  onShow() {
    const ok = entitlement.can("exam");
    this.setData({ allowed: ok, reason: ok ? "" : entitlement.hint("exam") });
    if (!ok || this.ready) return;
    this.ready = true;

    const books = corpus.books().filter((b) => b.id !== "poems");
    const scopes = [{ id: "", name: "课内诗词" }].concat(books.map((b) => ({ id: b.id, name: b.name })));
    this.setData({ scopes, forms: quiz.FORMS, pickedForms: quiz.FORM_KEYS.slice() });
  },

  onToggleForm(e) {
    const key = e.currentTarget.dataset.k;
    const list = this.data.pickedForms.slice();
    const i = list.indexOf(key);
    if (i >= 0) {
      if (list.length === 1) {
        wx.showToast({ title: "至少留一种题型", icon: "none" });
        return;
      }
      list.splice(i, 1);
    } else {
      list.push(key);
    }
    this.setData({ pickedForms: list });
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
        answered: 0,
        correct: 0,
        wrong: [],
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
    if (this.data.picked) return;
    const picked = e.currentTarget.dataset.v;
    // 判分走 quiz.judge，与题库页同一份口径
    const res = quiz.judge(this.data.current, picked);

    this.setData({
      picked,
      answered: this.data.answered + 1,
      correct: this.data.correct + (res.ok ? 1 : 0),
      wrong: res.ok
        ? this.data.wrong
        : this.data.wrong.concat([
            { stem: res.stem, title: res.title, answer: res.answer, picked: res.picked }
          ])
    });

    setTimeout(() => this.next(), 800);
  },

  next() {
    const index = this.data.index + 1;
    if (index >= this.data.questions.length) {
      this.finish();
      return;
    }
    this.setData({ index, current: this.data.questions[index], picked: "" });
  },

  finish() {
    this.stopTimer();
    const total = this.data.questions.length || 1;
    this.setData({ stage: "result", score: Math.round((this.data.correct / total) * 100) });
  },

  onAgain() {
    this.setData({ stage: "setup", questions: [], wrong: [], picked: "" });
  },
  onShareAppMessage() {
    return { title: "跬步 · 古诗词模拟考试", path: "/packages/game/exam/exam" };
  }
});
