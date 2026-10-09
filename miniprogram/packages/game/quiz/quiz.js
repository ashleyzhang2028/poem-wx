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
    /** 正确率那一行读数（`%` 前面的整数）。见 `pctOf` —— 不写在 wxml 里 */
    pct: 0,

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
        // 还没作答：picked 为空，cls 一律是空串
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

  /**
   * 选项那一列，每格**带上状态类** `cls`。
   *
   * 为什么要多这一层：wxml 原先在 `class` 里写了三层嵌套三元 + 字符串字面量，
   * 而 WXML 的 `{{ }}` 解析不了 —— 构建时报
   * `quiz.wxml:1:2154: unexpected token '.'`，真机包直接传不上去。
   * 本仓库别处一律只用一层三元，这里跟着回同一套写法（见 `quiz.optionClass`）。
   */
  rowsWithCls(options, picked, answer) {
    return quiz.optionRows(options).map((r) =>
      Object.assign({}, r, { cls: quiz.optionClass(r, picked, answer) }));
  },

  /**
   * 结果页那一行读数：正确率的整数（`%` 前面的那个数）。
   *
   * ⚠️ 为什么在 js 里算，而不是像原先那样写在 wxml 的 `{{ }}` 里：
   * 原来的写法是对**括号表达式调用方法**：
   *
   *     {{questions.length ? (correct * 100 / questions.length).toFixed(0) : 0}}
   *
   * WXML 的表达式解析器不认 `)` 后面紧跟的 `.` —— 也就是**方法调用**，
   * 服务端直接回：
   *     ./packages/game/quiz/quiz.wxml:1:2084:
   *     Bad value with message: unexpected token `.`
   * 报的正是 `.toFixed` 那个点，而它让**整个体验版传不上去**（`-80054`）。
   *
   * ⚠️ 别以为「把嵌套三元拆开就好了」：上一轮修掉选项那格的三层嵌套三元
   * （`quiz.optionClass`）之后，包**照样传不上去** —— 因为这一处是另一类错，
   * 不在同一格、也不在同一个原因里。WXML 的 `{{ }}` 只能写
   * 「取值 + 运算 + 一层三元」，凡是**方法调用**都得挪到 js。
   *
   * 除零也不用在外面兜：题数为 0 时这个页面根本到不了（`onStart` 就拦了）。
   */
  pctOf(correct, total) {
    if (!total) return 0;
    return Math.round((correct * 100) / total);
  },

  /**
   * 题干下面那一行：**题型 · 出自《…》**。
   *
   * 与考试页同一套写法（Quiz/metaLineOf）：题型与出处并成一行，
   * 用「·」断开。「朝代」的题干就是作者名，不必再交代出处。
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
      // ⚠️ 必须**一起重算**：以前高亮是靠模板里 `{{picked ? ... }}` 在数据变化时
      //    自己重求值；现在类名在 data 里，不重算就永远不会亮。
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
      // 出分那一刻给一声；按正确率分音景，满分与及格听起来不是一件事
      sfx.rank(this.data.correct, this.data.questions.length);
      // 正确率在**这里**算好（`pctOf`），不出现在 wxml —— 见 `pctOf` 的注释
      this.setData({ stage: "result", pct: this.pctOf(this.data.correct, this.data.questions.length) });
      return;
    }
    // 翻页要把这一题的三个读数一起换掉：选项（带 ABC 字母）、
    // 题干下面那一行、以及本题作答。上一版只换 current，
    // 字母与读数就会停在上一条题上。
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
