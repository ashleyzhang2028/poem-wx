const quiz = require("../../../utils/quiz");
const corpus = require("../../../utils/corpus");
const entitlement = require("../../../utils/entitlement");
const sfx = require("../../../utils/sfx");
const theme = require("../../../utils/theme");

const COUNT = 10;

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

    optionRows: [],

    metaLine: "",
    last: null,
    answered: 0,
    correct: 0,
    wrong: [],

    pct: 0,

    allowed: false,
    reason: ""
  },

  onShow() {
    theme.apply(this);
    const ok = entitlement.can("quiz");
    this.setData({ allowed: ok, reason: ok ? "" : entitlement.hint("quiz") });
    if (!ok || this.ready) return;
    this.ready = true;

    const books = corpus.books().filter((b) => b.id !== "poems");
    const scopes = [{ id: "", name: "课内诗词" }].concat(books.map((b) => ({ id: b.id, name: b.name })));
    this.setData({
      scopes,
      forms: quiz.FORMS,
      pickedForms: quiz.FORM_KEYS.slice()
    });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onScope(e) {
    this.setData({ scopeIndex: Number(e.detail.value) || 0 });
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

        optionRows: this.rowsWithCls(questions[0].options, "", questions[0].answer),
        metaLine: this.metaLineOf(questions[0]),
        picked: "",
        last: null,
        answered: 0,
        correct: 0,
        wrong: []
      }
    );
  },

  rowsWithCls(options, picked, answer) {
    return quiz.optionRows(options).map((r) =>
      Object.assign({}, r, { cls: quiz.optionClass(r, picked, answer) }));
  },

  pctOf(correct, total) {
    if (!total) return 0;
    return Math.round((correct * 100) / total);
  },

  metaLineOf(q) {
    if (!q) return "";
    const name = quiz.formOf(q.form).name;
    if (q.form === "dynasty" || !q.title) return name;
    return name + " · 出自《" + q.title + "》";
  },

  onPick(e) {
    if (this.data.picked || !this.data.current) return;
    const picked = e.currentTarget.dataset.v;
    const res = quiz.judge(this.data.current, picked);

    sfx.answer(res.ok);

    this.setData({
      picked,

      optionRows: this.rowsWithCls(this.data.current.options, picked, this.data.current.answer),
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

      sfx.rank(this.data.correct, this.data.questions.length);

      this.setData({ stage: "result", pct: this.pctOf(this.data.correct, this.data.questions.length) });
      return;
    }

    const next = this.data.questions[index];
    this.setData({
      index,
      current: next,
      optionRows: this.rowsWithCls(next.options, "", next.answer),
      metaLine: this.metaLineOf(next),
      picked: "",
      last: null
    });
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
