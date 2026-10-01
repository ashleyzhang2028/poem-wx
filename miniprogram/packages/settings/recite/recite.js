const store = require("../../../utils/store");
const S = require("../../../utils/scheduler");
const R = require("../../../utils/review-models");
const E = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");

const GRADES = Object.keys(S.GRADE_NAMES).map((g) => Number(g));

Page({
  data: {
    grades: [],
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
        scopes,
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

  onGrade(e) {
    this.save({ grade: Number(e.currentTarget.dataset.v) });
  },

  onTerm(e) {
    this.save({ term: Number(e.currentTarget.dataset.v) });
  },

  onScope(e) {
    this.save({ scope: e.currentTarget.dataset.k });
  },

  onCount(e) {
    this.save({ dailyCount: Number(e.currentTarget.dataset.v) });
  },

  onAlgo(e) {
    const algo = e.currentTarget.dataset.k;
    if (algo === this.data.algo) return;

    if (!E.algoAllowed(algo)) {
      const need = E.CAPS.find((c) => c.key === algo);
      wx.showModal({
        title: "这一套还没开放",
        content: (need ? need.name : algo) + " 需要「" + E.status().label + "」以上。档位由管理员发放，在「我的 → 用户与权限」可以看到差在哪一档。",
        showCancel: false
      });
      return;
    }

    wx.showModal({
      title: "切换复习算法",
      content: "已有的背诵进度会按新算法折算，不会清空。",
      success: (res) => {
        if (res.confirm) this.save({ algo });
      }
    });
  }
});
