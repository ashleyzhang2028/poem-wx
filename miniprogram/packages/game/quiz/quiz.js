const quiz = require("../../../utils/quiz");
const corpus = require("../../../utils/corpus");
const entitlement = require("../../../utils/entitlement");
const sfx = require("../../../utils/sfx");
const theme = require("../../../utils/theme");

const COUNT = 10;

/**
 * 题库：抽题、逐题判对错、当场看答案。
 * 与考试共用 utils/quiz.js 那套出题器与 judge()，判分口径只此一处 ——
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
    /** 当前这道题的选项（带 A B C D 脚标字母）—— 字母只到这一层 */
    optionRows: [],
    /** 题干下面那一行读数：题型 · 出自《…》。缺哪一段就不印哪一段 */
    metaLine: "",
    last: null,
    answered: 0,
    correct: 0,
    wrong: [],

    allowed: false,
    reason: ""
  },

  /**
   * 门禁放 onShow：从「去登录」回来时 onLoad 不会再跑，
   * 页面就会卡在锁着的样子。从分享链接直接进来的也要过这一关。
   */
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
        optionRows: quiz.optionRows(questions[0].options),
        metaLine: this.metaLineOf(questions[0]),
        picked: "",
        last: null,
        answered: 0,
        correct: 0,
        wrong: []
      }
    );
  },

  /**
   * 题干下面那一行：**题型 · 出自《…》**。
   *
   * 与考试页同一套写法（Quiz/metaLineOf）：题型与出处并成一行，
   * 用「·」断开。「填朝代」的题干就是作者名，不必再交代出处。
   */
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

    // 对错当场给一声：眼睛在看下一题的题干，耳朵负责说「刚才那下算数」
    sfx.answer(res.ok);

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
      // 出分那一刻给一声；按正确率分音景，满分与及格听起来不是一件事
      sfx.rank(this.data.correct, this.data.questions.length);
      this.setData({ stage: "result" });
      return;
    }
    // 翻页要把这一题的三个读数一起换掉：选项（带 ABC 字母）、
    // 题干下面那一行、以及本题作答。上一版只换 current，
    // 字母与读数就会停在上一条题上。
    const next = this.data.questions[index];
    this.setData({
      index,
      current: next,
      optionRows: quiz.optionRows(next.options),
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
