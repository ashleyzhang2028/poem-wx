const quiz = require("../quiz/lib");
const cheer = require("../../../utils/cheer");
const gameScopes = require("../../../utils/game-scopes");
const entitlement = require("../../../utils/entitlement");
const feedback = require("../../../utils/feedback");
const sfx = require("../../../utils/sfx");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const tabPage = require("../../../utils/tab-page");
const rankingSubmit = require("../../../utils/ranking-submit");
const rankingSelf = require("../../../utils/ranking");

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
    needTitle: false,
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
    remain: DURATION,
    remainText: "20:00",
    score: 0,
    forms: [],
    pickedForms: [],
    cardSet: false,

    slots: [],
    marked: 0,
    rank: null,
    best: "",
    newBest: false,

    allowed: false,
    reason: "",
    ranked: false,
    rankOff: false,
    rankSent: false,
    rankWhere: ""
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: !!tabbar.pick(this) });
    const ok = entitlement.can("exam");
    this.setData({ allowed: ok, reason: ok ? "" : entitlement.hint("exam") });
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

  onToggleForm(e) {
    const key = e.currentTarget.dataset.key;
    const has = this.data.pickedForms.indexOf(key) >= 0;
    const picked = has
      ? this.data.pickedForms.filter((k) => k !== key)
      : this.data.pickedForms.concat([key]);
    if (!picked.length) {
      wx.showToast({ title: "至少留一种题型", icon: "none" });
      return;
    }
    this.setData({
      pickedForms: picked,
      forms: quiz.formRows(picked),
      needTitle: !quiz.titleSpoiled(picked)
    });
  },

  onLogin() {
    tabPage.mine();
  },

  onUnload() {
    this.stopTimer();
    feedback.close(this);
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
        graded: [],
        correct: 0,
        cheerLine: "",
        quitLine: "",
        remain: DURATION,
        remainText: "20:00",
        slots: this.slotsOf(answers, 0),
        marked: 0,
        rank: null,
        best: "",
        newBest: false
      },
      () => this.startTimer()
    );
  },

  slotsOf(answers, index) {
    return (answers || []).map((a, i) => {
      let cls = "";
      if (a) cls = "on";
      if (i === index) cls = (cls + " now").trim();
      return { i: i, cls: cls };
    });
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
    feedback.buzz("light");

    const answers = this.data.answers.slice();
    answers[this.data.index] = picked;
    const slots = this.slotsOf(answers, this.data.index);
    this.setData({
      picked,
      answers,
      slots,
      marked: answers.filter((a) => a).length,
      quitLine: ""
    });
  },

  slotsOf(answers, index) {
    return (answers || []).map((a, i) => {
      let cls = "";
      if (a) cls = "on";
      if (i === index) cls = (cls + " now").trim();
      return { i: i, cls: cls };
    });
  },

  goto(index) {
    const next = this.data.questions[index];
    if (!next) return;
    this.setData({
      index,
      current: next,
      optionRows: quiz.optionRows(next.options),
      metaLine: this.metaLineOf(next),
      picked: this.data.answers[index] || "",
      slots: this.slotsOf(this.data.answers, index)
    });
  },

  onJump(e) {
    const index = Number(e.currentTarget.dataset.i);
    if (!(index >= 0) || index === this.data.index || index >= this.data.questions.length) return;
    this.goto(index);
  },

  onPrev() {
    if (this.data.index <= 0) return;
    this.goto(this.data.index - 1);
  },

  confirmSubmit() {
    const answers = this.data.answers;
    const answered = answers.filter((a) => a).length;
    const line = cheer.ofQuit(answered, this.data.questions.length);
    if (!line) return true;
    if (this.data.quitLine === line) return true;
    this.setData({ quitLine: line });
    return false;
  },

  onNext() {
    if (this.data.index + 1 >= this.data.questions.length) {
      if (!this.confirmSubmit()) return;
      this.finish();
      return;
    }
    this.goto(this.data.index + 1);
  },

  metaLineOf(q) {
    if (!q) return "";
    const name = quiz.formOf(q.form).name;
    if (!this.data.needTitle || !q.title) return name;
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
    const rank = feedback.rankPercent(score);
    const kept = feedback.keep(feedback.KEYS.exam, { pct: score, at: Date.now(), rank: rank });

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
      score,
      rank,
      newBest: kept.best,
      best: kept.before ? kept.before.rank.name : ""
    });
    this.report(correct, questions.length);
  },

  report(correct, count) {
    rankingSubmit
      .submitPlay("exam", {
        scopeId: this.data.scope || "",
        score: correct,
        total: count,
        durationSec: DURATION - this.data.remain
      })
      .then((res) => {
        if (this.data.stage !== "result") return;
        this.setData({
          ranked: !!(res && res.ok && res.on),
          rankOff: !!(res && res.ok && !res.on),
          rankSent: !!(res && res.ok),
          rankWhere: rankingSelf.labelOf()
        });
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
      slots: [],
      marked: 0,
      rank: null,
      best: "",
      newBest: false,
      ranked: false,
      rankOff: false,
      rankSent: false,
      remain: DURATION,
      remainText: "20:00"
    });
  },
  onShareAppMessage() {
    return { title: "古诗词考试", path: "/packages/game/exam/exam" };
  }
});
