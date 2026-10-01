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

  /**
   * 题型多选。
   *
   * 上一版是自己算差异（list.splice / push 之后再 setData）。那个写法有个洞：
   * 数据是「我算出来的」，不是「用户勾出来的」，一旦两边的判断错开一格，
   * 界面上的勾与页面里的数据就再也对不上了。
   *
   * 现在只认 checkbox-group 交出的一份完整清单，页面不再自己算增删。
   * 上一版还有一处：取消掉最后一个勾时只弹了个 toast 就 return，
   * 数据没改、勾却真被用户点掉了 —— 那条路径现在被 setData 折回来。
   */
  onToggleForm(e) {
    const picked = e.detail.value || [];
    if (!picked.length) {
      wx.showToast({ title: "至少留一种题型", icon: "none" });
      // 原生控件已经把那个勾去掉了，而数据不许为空 —— 必须把选中态重设回去，
      // 否则界面（全没勾）与数据（还有一项）从此对不上，下次进这个页面会「自动」多出题型。
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
