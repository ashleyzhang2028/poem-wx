const quiz = require("../../../utils/quiz");
const corpus = require("../../../utils/corpus");

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
    score: 0
  },

  onLoad() {
    const books = corpus.books().filter((b) => b.id !== "poems");
    const scopes = [{ id: "", name: "课内诗词" }].concat(books.map((b) => ({ id: b.id, name: b.name })));
    this.setData({ scopes });
  },

  onUnload() {
    this.stopTimer();
  },

  onScope(e) {
    this.setData({ scopeIndex: Number(e.detail.value) || 0 });
  },

  onStart() {
    const scope = this.data.scopes[this.data.scopeIndex].id;
    const questions = quiz.build({ scope, count: QUESTION_COUNT });
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
    const ok = picked === this.data.current.answer;
    this.setData({
      picked,
      answered: this.data.answered + 1,
      correct: this.data.correct + (ok ? 1 : 0),
      wrong: ok
        ? this.data.wrong
        : this.data.wrong.concat([
            {
              stem: this.data.current.stem,
              title: this.data.current.title,
              answer: this.data.current.answer,
              picked
            }
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
    this.setData({ stage: "setup", questions: [], wrong: [] });
  },
  onShareAppMessage() {
    return { title: "跬步 · 古诗词模拟考试", path: "/packages/game/exam/exam" };
  }
});
