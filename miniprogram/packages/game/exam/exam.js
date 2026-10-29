const quiz = require("../quiz/lib");
const cheer = require("../../../utils/cheer");
const gameScopes = require("../../../utils/game-scopes");
const entitlement = require("../../../utils/entitlement");
const feedback = require("../../../utils/feedback");
const sfx = require("../../../utils/sfx");
const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const rankingSubmit = require("../../../utils/ranking-submit");
const guard = require("../../../utils/guard");
const rankingSelf = require("../../../utils/ranking");
const scoreLog = require("../../../utils/score-log");

const DURATION = 20 * 60;
const URGENT_FROM = 60;
const QUESTION_COUNT = 10;

function blankAnswers(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push("");
  return a;
}

Page({
  data: {
    themeStyle: "",
    name: "",
    stage: "setup",
    preparing: false,
    scopes: [],
    scope: gameScopes.STAGE_SCOPE,
    needTitle: false,
    count: QUESTION_COUNT,
    questions: [],
    index: 0,
    current: null,

    barBelow: true,
    optionRows: [],
    stemRows: [],

    metaLine: "",

    picked: "",

    answers: [],

    graded: [],
    correct: 0,
    cheerLine: "",
    quitLine: "",
    remain: DURATION,
    urgent: false,
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
    ranked: false,
    rankSent: false,
    rankWhere: "",

    log: { count: 0, line: "", best: null }
  },

  onHide() {
    this.stopTimer();
    if (this.data.stage === "running") this.tick();
  },

  onShow() {
    this.applyFont();
    theme.apply(this);
    this.setData({ barBelow: !!tabbar.pick(this) });
    if (this.data.stage === "running" && !this.timer) this.startTimer();
    const ok = entitlement.can("exam");
    this.setData({ allowed: ok, lockNote: entitlement.hint("exam") || "登录后才能考" });
    this.loadLog();
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

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
    font.registerHere().catch(() => {});
  },

  loadLog() {
    const sum = scoreLog.summary("exam");
    this.setData({
      log: {
        count: sum.count,
        best: sum.best,
        line: sum.count
          ? "共 " + sum.count + " 次 · 最近 " + sum.last.timeText + " · " + sum.last.pct + " 分"
          : "暂无记录"
      }
    });
  },

  onLog() {
    sfx.play("tap");
    wx.navigateTo({ url: "/packages/game/log/log?mode=exam" });
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


  guardLeave(on) {
    if (on && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: "考试还在进行，现在离开这场不会计分" });
    if (!on && wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
  },

  onUnload() {
    this.prepToken = (this.prepToken || 0) + 1;
    this.stopTimer();
    this.guardLeave(false);
    feedback.close(this);
  },

  onScope(e) {
    this.setData({ scope: e.detail.value || "" });
  },

  onStart() {
    if (this.data.stage !== "setup" || this.data.preparing) return;
    const token = (this.prepToken || 0) + 1;
    this.prepToken = token;
    this.setData({ preparing: true });
    quiz.buildAsync({ scope: this.data.scope, count: QUESTION_COUNT, forms: this.data.pickedForms }).then((r) => {
      if (token !== this.prepToken) return;
      this.setData({ preparing: false });
      if (r.degraded) wx.showToast({ title: "课外阅读没取到，已用课内出题", icon: "none" });
      this.begin(r.questions);
    });
  },

  begin(questions) {
    if (!questions.length) {
      wx.showToast({ title: "当前范围无法出题", icon: "none" });
      return;
    }
    const answers = blankAnswers(questions.length);
    this.endedAt = 0;
    this.startedAt = Date.now();
    this.setData(
      {
        stage: "running",
        questions,
        index: 0,
        current: questions[0],
        optionRows: quiz.optionRows(questions[0].options),
        stemRows: quiz.stemRows(questions[0]),
        metaLine: this.metaLineOf(questions[0]),
        picked: "",
        answers,
        graded: [],
        correct: 0,
        cheerLine: "",
        quitLine: "",
        remain: DURATION,
        urgent: false,
        remainText: "20:00",
        slots: this.slotsOf(answers, 0),
        marked: 0,
        rank: null,
        best: "",
        newBest: false
      },
      () => {
        this.guardLeave(true);
        this.startTimer();
      }
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
    if (!this.startedAt) this.startedAt = Date.now() - (DURATION - this.data.remain) * 1000;
    this.timer = setInterval(() => this.tick(), 1000);
  },

  tick() {
    const remain = Math.max(0, Math.ceil((this.startedAt + DURATION * 1000 - Date.now()) / 1000));
    if (remain <= 0) {
      this.stopTimer();
      this.setData({ remain: 0, remainText: this.format(0) });
      this.finish();
      return;
    }
    if (remain === this.data.remain) return;
    this.setData({ remain, remainText: this.format(remain), urgent: remain <= URGENT_FROM });
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

  goto(index) {
    const next = this.data.questions[index];
    if (!next) return;
    this.setData({
      index,
      current: next,
      optionRows: quiz.optionRows(next.options),
      stemRows: quiz.stemRows(next),
      metaLine: this.metaLineOf(next),
      picked: this.data.answers[index] || "",
      quitLine: "",
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

  onNextTap(e) {
    if (Number(e.currentTarget.dataset.i) !== this.data.index) return;
    this.onNext();
  },

  onNext() {
    if (this.data.stage !== "running") return;
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
    if (this.endedAt || this.data.stage !== "running") return;
    this.endedAt = Date.now();
    this.stopTimer();
    this.guardLeave(false);
    const questions = this.data.questions;
    const answers = this.data.answers;
    const judge = quiz.judge;
    const graded = questions.map((q, i) => judge(q, answers[i] || ""));
    const correct = graded.filter((g) => g.ok).length;

    const total = questions.length || 1;
    const score = Math.round((correct / total) * 100);
    const rank = feedback.rankPercent(score);
    const sum = scoreLog.summary("exam");
    const prevBest = sum.best ? sum.best.pct : 0;
    scoreLog.add("exam", {
      pct: score,
      correct,
      total: questions.length,
      scope: this.data.scope || "",
      scopeName: gameScopes.nameOf(this.data.scopes, this.data.scope),
      span: Math.round((this.endedAt - (this.startedAt || this.endedAt)) / 1000)
    });
    this.loadLog();

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
      newBest: score > prevBest,
      best: sum.best ? sum.best.rankName : ""
    });
    this.report(correct, questions.length);
  },

  elapsedSec() {
    if (!this.startedAt) return 0;
    const end = this.endedAt || Date.now();
    return Math.max(0, Math.min(DURATION, Math.round((end - this.startedAt) / 1000)));
  },

  report(correct, count) {
    guard
      .once("exam:report", () => rankingSubmit.submitPlay("exam", {
        scopeId: this.data.scope || "",
        score: correct,
        total: count,
        durationSec: this.elapsedSec()
      }))
      .then((res) => {
        if (this.data.stage !== "result") return;
        const sent = !!(res && res.ok);
        this.setData({
          ranked: sent && !!res.on,
          rankSent: sent,
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
      rankSent: false,
      remain: DURATION,
      remainText: "20:00",
      endedAt: 0
    });
    this.endedAt = 0;
    this.startedAt = 0;
  },
  onShareAppMessage() {
    return { title: "古诗词考试", path: "/packages/game/exam/exam" };
  }
});
