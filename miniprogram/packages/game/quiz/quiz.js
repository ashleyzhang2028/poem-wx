const quiz = require("./lib");
const gameScopes = require("../../../utils/game-scopes");
const entitlement = require("../../../utils/entitlement");
const feedback = require("../../../utils/feedback");
const sfx = require("../../../utils/sfx");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");

const COUNT = 10;

Page({
  data: {
    themeStyle: "",
    stage: "setup",
    forms: [],
    pickedForms: [],
    scopes: [],
    scope: "",
    needTitle: false,
    count: COUNT,
    questions: [],
    index: 0,
    current: null,
    picked: "",

    barBelow: true,
    optionRows: [],
    stemRows: [],

    metaLine: "",
    last: null,
    answered: 0,
    correct: 0,
    wrong: [],

    pct: 0,
    flash: "",
    combo: feedback.comboOf(0),
    streaks: [],
    streakFlags: [],
    rank: null,
    best: null,
    newBest: false,

    allowed: false
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: !!tabbar.pick(this) });
    const ok = entitlement.can("quiz");
    this.setData({ allowed: ok });
    if (!ok || this.ready) return;
    this.ready = true;

    const pickedForms = quiz.DEFAULT_FORM_KEYS.slice();
    this.setData({
      scopes: gameScopes.list(),
      pickedForms,
      forms: quiz.formRows(pickedForms),
      needTitle: !quiz.titleSpoiled(pickedForms)
    });
  },


  onScope(e) {
    this.setData({ scope: e.detail.value || "" });
  },

  onToggleForm(e) {
    const key = e.currentTarget.dataset.key;
    const has = this.data.pickedForms.indexOf(key) >= 0;
    const picked = has
      ? this.data.pickedForms.filter((k) => k !== key)
      : this.data.pickedForms.concat([key]);
    if (!picked.length) {
      wx.showToast({ title: "请至少保留一种题型", icon: "none" });
      return;
    }
    this.setData({
      pickedForms: picked,
      forms: quiz.formRows(picked),
      needTitle: !quiz.titleSpoiled(picked)
    });
  },

  onStart() {
    if (this.data.stage !== "setup") return;
    const scope = this.data.scope;
    const questions = quiz.build({
      scope,
      count: this.data.count,
      forms: this.data.pickedForms,
      sequential: false
    });
    if (!questions.length) {
      wx.showToast({ title: "当前范围无法出题", icon: "none" });
      return;
    }
    this.setData(
      {
        stage: "running",
        questions,
        index: 0,
        current: questions[0],

        optionRows: this.rowsWithCls(questions[0].options, "", questions[0].answer),
        stemRows: quiz.stemRows(questions[0]),
        metaLine: this.metaLineOf(questions[0]),
        picked: "",
        last: null,
        answered: 0,
        correct: 0,
        wrong: [],
        flash: "",
        combo: feedback.comboOf(0),
        streaks: [],
        streakFlags: [],
        rank: null,
        newBest: false
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
    if (!this.data.needTitle || !q.title) return name;
    return name + " · 出自《" + q.title + "》";
  },

  onPick(e) {
    if (this.data.picked || !this.data.current) return;
    const picked = e.currentTarget.dataset.v;
    const res = quiz.judge(this.data.current, picked);
    const combo = feedback.mark(this, res.ok, this.data.combo.n + 1);
    const streaks = res.ok
      ? this.data.streaks.concat([this.data.index])
      : this.data.streaks;
    const streakFlags = this.data.questions.map((q, i) => streaks.indexOf(i) >= 0);

    this.setData({
      picked,

      optionRows: this.rowsWithCls(this.data.current.options, picked, this.data.current.answer),
      last: res,
      answered: this.data.answered + 1,
      correct: this.data.correct + (res.ok ? 1 : 0),
      combo: combo.combo,
      streaks: streaks,
      streakFlags: streakFlags,
      wrong: res.ok
        ? this.data.wrong
        : this.data.wrong.concat([
            { stem: res.stem, title: res.title, answer: res.answer, picked: res.picked }
          ])
    });
  },

  onNext() {
    if (this.data.stage !== "running") return;
    const index = this.data.index + 1;
    if (index >= this.data.questions.length) {
      this.finish();
      return;
    }

    const next = this.data.questions[index];
    this.setData({
      index,
      current: next,
      optionRows: this.rowsWithCls(next.options, "", next.answer),
      stemRows: quiz.stemRows(next),
      metaLine: this.metaLineOf(next),
      picked: "",
      last: null,
      flash: ""
    });
  },

  finish() {
    const total = this.data.questions.length;
    const pct = this.pctOf(this.data.correct, total);
    const rank = feedback.rankPercent(pct);
    const kept = feedback.keep(feedback.KEYS.quiz, {
      pct: pct,
      at: Date.now(),
      rank: rank
    });

    sfx.rank(this.data.correct, total);

    this.setData({
      stage: "result",
      pct: pct,
      rank: rank,
      newBest: kept.best,
      best: kept.before ? kept.before.rank.name : ""
    });
  },

  onAgain() {
    feedback.close(this);
    this.setData({ stage: "setup", questions: [], wrong: [], rank: null, newBest: false, flash: "" });
  },

  onUnload() {
    feedback.close(this);
  },

  onOpen(e) {
    const q = this.data.questions[this.data.index] || {};
    if (!q.id) return;
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(q.id) + "&mode=browse" });
  }
});
