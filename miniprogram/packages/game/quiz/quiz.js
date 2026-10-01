const quiz = require("../../../utils/quiz");
const corpus = require("../../../utils/corpus");
const entitlement = require("../../../utils/entitlement");
const store = require("../../../utils/store");
const sync = require("../../../utils/sync");

const COUNT = 10;

Page({
  data: {
    stage: "setup",
    forms: quiz.FORMS.map((f) => Object.assign({}, f, { on: true })),
    scopes: [],
    scopeIndex: 0,
    count: COUNT,

    questions: [],
    index: 0,
    current: null,
    picked: "",
    answered: 0,
    correct: 0,
    wrong: [],
    score: 0,

    allowed: true,
    reason: ""
  },

  onLoad() {
    const g = entitlement.can("quiz.review");
    const books = corpus.books().filter((b) => b.id !== "poems");
    this.setData({
      allowed: g.ok,
      reason: g.ok ? "" : entitlement.hint("quiz.review"),
      scopes: [{ id: "", name: "课内诗词" }].concat(books.map((b) => ({ id: b.id, name: b.name })))
    });
  },

  onToggleForm(e) {
    const key = e.currentTarget.dataset.k;
    const forms = this.data.forms.map((f) => (f.key === key ? Object.assign({}, f, { on: !f.on }) : f));
    if (!forms.some((f) => f.on)) {
      wx.showToast({ title: "至少留一种题型", icon: "none" });
      return;
    }
    this.setData({ forms });
  },

  onScope(e) {
    this.setData({ scopeIndex: Number(e.detail.value) || 0 });
  },

  onCount(e) {
    this.setData({ count: Number(e.currentTarget.dataset.n) || COUNT });
  },

  onStart() {
    const scope = this.data.scopes[this.data.scopeIndex].id;
    const forms = this.data.forms.filter((f) => f.on).map((f) => f.key);
    const questions = quiz.build({ scope, count: this.data.count, forms });

    if (!questions.length) {
      wx.showToast({ title: "这个范围出不了题", icon: "none" });
      return;
    }

    this.setData({
      stage: "running",
      questions,
      index: 0,
      current: questions[0],
      picked: "",
      answered: 0,
      correct: 0,
      wrong: []
    });
  },

  /**
   * 选答案。
   *
   * 立刻判对错并停住，让用户看清正确答案 —— 前端的题库不该抢答，
   * 答错时把正确答案一并给他，这才是练。
   */
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
              id: this.data.current.id,
              stem: this.data.current.stem,
              title: this.data.current.title,
              answer: this.data.current.answer,
              picked
            }
          ])
    });

    if (ok) wx.vibrateShort({ type: "light" });
  },

  onNext() {
    const index = this.data.index + 1;
    if (index >= this.data.questions.length) {
      this.finish();
      return;
    }
    this.setData({ index, current: this.data.questions[index], picked: "" });
  },

  finish() {
    const total = this.data.questions.length || 1;
    const score = Math.round((this.data.correct / total) * 100);

    // 答错的题挂进错题本：错题本身是一篇篇目，走同一套复习排期，
    // 这样「考试做错的」会自然出现在每日背诵里。与网页版同一口径。
    this.data.wrong.forEach((w) => {
      if (!w.id) return;
      const rec = store.getRecord(w.id);
      // 只把「还没背过」或「已经掌握」的降级，已经在复习中的不动它
      if (!rec || (rec.learned && rec.level >= 7)) {
        store.setRecord(w.id, {
          level: 0,
          learned: true,
          reps: 0,
          lapses: (rec && rec.lapses) || 0,
          lastReviewAt: Date.now(),
          nextReviewAt: Date.now() + 30 * 60 * 1000,
          history: []
        });
        sync.enqueue(w.id, { level: 0, learned: true, reps: 0, nextReviewAt: Date.now() + 1800000 });
      }
    });

    this.setData({ stage: "result", score });
  },

  onAgain() {
    this.setData({ stage: "setup", questions: [], wrong: [] });
  },

  onOpen(e) {
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
  },

  onShareAppMessage() {
    return { title: "跬步 · 题库", path: "/packages/game/quiz/quiz" };
  }
});
