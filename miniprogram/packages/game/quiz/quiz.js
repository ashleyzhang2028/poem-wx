const quiz = require("../../../utils/quiz");
const corpus = require("../../../utils/corpus");

const COUNT = 10;

/**
 * 题库：抽题、逐题判对错、当场看答案。
 * 与模拟考试共用 utils/quiz.js 那套出题器与 judge()，判分口径只此一处 ——
 * 两个页面各写一遍判分，迟早会有一个先把「模糊」算成对。
 */
Page({
  data: {
    stage: "setup",
    forms: [],
    pickedForms: [],
    scopes: [],
    scopeIndex: 0,
    count: COUNT,
    questions: [],
    index: 0,
    current: null,
    picked: "",
    last: null,
    answered: 0,
    correct: 0,
    wrong: []
  },

  onLoad() {
    const books = corpus.books().filter((b) => b.id !== "poems");
    const scopes = [{ id: "", name: "课内诗词" }].concat(books.map((b) => ({ id: b.id, name: b.name })));
    this.setData({
      scopes,
      forms: quiz.FORMS,
      pickedForms: quiz.FORM_KEYS.slice()
    });
  },

  onScope(e) {
    this.setData({ scopeIndex: Number(e.detail.value) || 0 });
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

  onStart() {
    const scope = this.data.scopes[this.data.scopeIndex].id;
    const questions = quiz.build({
      scope,
      count: this.data.count,
      forms: this.data.pickedForms,
      sequential: false
    });
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
        last: null,
        answered: 0,
        correct: 0,
        wrong: []
      },
      () => this.markForm()
    );
  },

  markForm() {
    const cur = this.data.current;
    if (!cur) return;
    const f = quiz.formOf(cur.form);
    this.setData({ current: Object.assign({}, cur, { formName: f.name, color: f.color }) });
  },

  onPick(e) {
    if (this.data.picked || !this.data.current) return;
    const picked = e.currentTarget.dataset.v;
    const res = quiz.judge(this.data.current, picked);

    this.setData({
      picked,
      last: res,
      answered: this.data.answered + 1,
      correct: this.data.correct + (res.ok ? 1 : 0),
      wrong: res.ok
        ? this.data.wrong
        : this.data.wrong.concat([
            { stem: res.stem, title: res.title, answer: res.answer, picked: res.picked }
          ])
    });
  },

  onNext() {
    const index = this.data.index + 1;
    if (index >= this.data.questions.length) {
      this.setData({ stage: "result" });
      return;
    }
    this.setData({ index, current: this.data.questions[index], picked: "", last: null }, () =>
      this.markForm()
    );
  },

  onAgain() {
    this.setData({ stage: "setup", questions: [], wrong: [] });
  },

  onOpen(e) {
    const q = this.data.questions[this.data.index] || {};
    if (!q.id) return;
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(q.id) });
  }
});
