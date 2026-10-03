const store = require("../../../utils/store");
const S = require("../../../utils/scheduler");
const R = require("../../../utils/review-models");
const E = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");

const GRADES = Object.keys(S.GRADE_NAMES).map((g) => Number(g));

const TERMS = [
  { value: 1, label: "上学期" },
  { value: 2, label: "下学期" }
];

/* 注音 / 对齐 / 字号不在这页。它们是读一首诗时的临场偏好，
   该待在详情页（pages/reader 的 .prefs）与阅读设置页（packages/settings/general），
   在诗句旁边当场调、当场看见效果。详见 recite.wxml 里的说明。 */

Page({
  data: {
    grades: [],
    terms: TERMS,
    grade: 1,
    term: 1,
    scope: "upto",
    scopes: [],
    dailyCount: 5,
    counts: S.DAILY_COUNTS,
    algo: "ebbinghaus",
    algos: [],
    poolSize: 0,
    lockedHint: "",
    locked: false
  },

  onShow() {
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });
    const settings = store.settings();
    const scopes = Object.keys(S.SCOPES).map((k) => ({ key: k, label: S.SCOPES[k].label }));
    this.setData(
      Object.assign({}, settings, {
        grades: GRADES.map((g) => ({ value: g, label: S.gradeName(g) })),
        scopes: scopes,
        algos: this.algoRows(settings.algo)
      }),
      () => this.updatePool()
    );
  },

  /**
   * 算法列表带门禁。
   * 上一版直接列四套、点击只提示「换算法不清进度」，但门禁其实会把它挡回去 ——
   * 那是个假按钮。这里把 allowed 提前算出来，界面照它灰掉。
   */
  algoRows(current) {
    return R.list().map((m) => {
      const allowed = E.algoAllowed(m.key);
      return {
        key: m.key,
        name: m.name,
        blurb: m.blurb,
        years: m.years,
        allowed,
        // 灰掉的那几套要说清为什么灰 —— 光一个 disabled 会让人以为是坏了
        lockHint: allowed ? "" : E.hint(m.key),
        active: m.key === current
      };
    });
  },

  updatePool() {
    const s = this.data;
    const pool = S.poolForScope({
      grade: s.grade,
      term: s.term,
      scope: s.scope,
      allPoems: require("../../../utils/corpus").course()
    });
    this.setData({ poolSize: pool.length });
  },

  save(patch) {
    store.saveSettings(patch);
    this.setData(Object.assign(patch, { algos: this.algoRows(patch.algo || this.data.algo) }), () =>
      this.updatePool()
    );
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  /* 单选组统一从这里取新值：radio-group 的 e.detail.value 就是选中那一项的 value */
  onGrade(e) {
    this.save({ grade: Number(e.detail.value) });
  },

  onTerm(e) {
    this.save({ term: Number(e.detail.value) });
  },

  onScope(e) {
    this.save({ scope: e.detail.value });
  },

  onCount(e) {
    this.save({ dailyCount: Number(e.detail.value) });
  },

  /**
   * 换算法。
   *
   * 门禁那一圈留着，但换成原生控件的写法：不可用的那几套 radio 直接 disabled，
   * 点都点不到，也就不会再走到这儿。原来那个「这一套还没开放」的弹窗因此删了 ——
   * 弹窗本该是「要你决定」，用来播报「你不能点」是错位的。
   * 「换算法不清进度」也改成页面上的常驻说明，不再每次点都拦一下。
   */
  onAlgo(e) {
    const algo = e.detail.value;
    if (algo === this.data.algo || !E.algoAllowed(algo)) return;
    this.save({ algo });
  }
});
