const store = require("../../../utils/store");
const S = require("../../../utils/scheduler");
const R = require("../../../utils/review-models");
const E = require("../../../utils/entitlement");

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
    logged: false,
    poolSize: 0
  },

  onLoad() {
    const settings = store.settings();
    const scopes = Object.keys(S.SCOPES).map((k) => ({ key: k, label: S.SCOPES[k].label }));
    const algos = R.list().map((m) => ({ key: m.key, name: m.name, blurb: m.blurb, years: m.years }));

    // 每个算法标上是否要登录，模板据此置灰；不用模板里写死哪个 key 要登录
    const algosView = algos.map((m) =>
      Object.assign({}, m, { locked: !E.can(m.key === "leitner" ? "algo.leitner" : "algo.ebbinghaus").ok })
    );

    this.setData(
      Object.assign({}, settings, {
        logged: E.signedIn(),
        grades: GRADES.map((g) => ({ value: g, label: S.gradeName(g) })),
        scopes,
        algos: algosView
      }),
      () => this.updatePool()
    );
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
    this.setData(patch, () => this.updatePool());
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

  onLoginGate() {
    wx.switchTab({ url: "/pages/mine/mine" });
  },

  onAlgo(e) {
    const algo = e.currentTarget.dataset.k;
    if (algo === this.data.algo) return;
    // 算法属于背诵能力，登录后才可切；游客看到的开关是灰的
    if (!E.block(algo === "leitner" ? "algo.leitner" : "algo.ebbinghaus", { page: this })) return;
    wx.showModal({
      title: "切换复习算法",
      content: "已有的背诵进度会按新算法折算，不会清空。",
      success: (res) => {
        if (res.confirm) this.save({ algo });
      }
    });
  }
});
