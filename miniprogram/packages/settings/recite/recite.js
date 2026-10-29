const store = require("../../../utils/store");
const corpus = require("../../../utils/corpus");
const sync = require("../../../utils/sync");
const S = require("../../../utils/scheduler");
const R = require("../../../utils/review-models");
const E = require("../../../utils/entitlement");
const cols = require("../../../utils/collections");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");

const STAGES = S.STAGE_KEYS.map((k) => ({ key: k, name: S.STAGES[k].name }));

const STAGE_SCOPE = { primary: "primary", middle: "middle", high: "high" };

function scopeForStage(stage, scope) {
  const to = STAGE_SCOPE[stage];
  const s = S.SCOPES[scope];
  const oneStage = !!s && !!s.stages && s.stages.length === 1;
  if (!to || !oneStage) return scope;
  return STAGE_SCOPE[s.stages[0]] ? to : scope;
}

const TERMS = [
  { value: 1, label: "上学期" },
  { value: 2, label: "下学期" }
];

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    grades: [],
    terms: TERMS,
    stages: STAGES,
    grade: 1,

    stage: "primary",

    term: 1,
    scope: "upto",
    scopes: [],
    dailyCount: 5,
    counts: S.DAILY_COUNTS,
    algo: "ebbinghaus",
    algos: [],

    daily: [],
    dailyMax: 20,
    poolSize: 0,

    selfOnlyOn: false,
    selfOnly: false,
    selfOnlyTier: "pro",
    selfOnlyRows: 0,
    selfOnlyPoems: 0
  },

  onShow() {
    this.applyFont();
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
    const settings = store.settings();
    const scopes = Object.keys(S.SCOPES).map((k) => ({ key: k, label: S.SCOPES[k].label }));
    this.setData(
      Object.assign({}, settings, {
        stage: S.stageOf(settings.grade),
        grades: this.gradeRows(settings.grade),
        scopes: scopes,
        algos: this.algoRows(settings.algo),
        daily: this.dailyRows(),
        dailyMax: store.DAILY_EXTRA_MAX
      }),
      () => {
        this.updatePool();
        this.updateSelfOnly();
      }
    );
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
    font.registerHere().catch(() => {});
  },

  updateSelfOnly() {
    const rows = cols.usable();
    const on = E.can("collections") && E.can("coursefree");
    this.setData({
      selfOnlyOn: on,
      selfOnly: on && !!store.settings().selfOnly,
      selfOnlyTier: E.can("collections") ? E.tierOf("coursefree") : E.tierOf("collections"),
      selfOnlyLocked: !on && E.reachable(E.tierOf("coursefree"), E.status().tier),
      selfOnlyRows: rows.length,
      selfOnlyPoems: rows.reduce((n, c) => n + c.items.length, 0)
    });
  },

  onSelfOnly(e) {
    const want = !!e.detail.value;
    if (want && !cols.usable().length) {
      this.setData({ selfOnly: false });
      wx.showToast({ title: "请先新建集合并添加篇目", icon: "none" });
      return;
    }
    this.setData({ selfOnly: want });
    this.save({ selfOnly: want });
  },

  onCollections() {
    gate.open(() => wx.navigateTo({ url: "/packages/settings/collections/collections" }), this);
  },

  dailyRows() {
    return store
      .dailyExtra()
      .map((id) => corpus.indexById(id))
      .filter(Boolean)
      .map((p) => ({
        id: p.id,
        title: p.t,
        meta: [p.d, p.a, p.n].filter(Boolean).join(" · "),
        picked: false
      }));
  },

  onDailyPick(e) {
    const picked = {};
    (e.detail.value || []).forEach((id) => {
      picked[id] = true;
    });
    this.setData({
      daily: this.data.daily.map((it) => Object.assign({}, it, { picked: !!picked[it.id] }))
    });
  },

  setDailyPicked(on) {
    this.setData({ daily: this.data.daily.map((it) => Object.assign({}, it, { picked: on })) });
  },

  onDailyAll() {
    this.setDailyPicked(true);
  },

  onDailyNone() {
    this.setDailyPicked(false);
  },

  onDailyRemove() {
    const ids = this.data.daily.filter((it) => it.picked).map((it) => it.id);
    if (!ids.length) {
      wx.showToast({ title: "未选择篇目", icon: "none" });
      return;
    }
    const n = store.removeDailyExtra(ids);
    this.refreshDaily();
    wx.showToast({ title: n ? "已移出 " + n + " 首" : "所选篇目已不在今日加背中", icon: "none" });
    sync.markDirty();
  },

  onDailyClear() {
    const n = store.dailyExtra().length;
    if (!n) return;
    wx.showModal({
      title: "清空今日加背",
      content: "移出今日加背的全部 " + n + " 首？已背进度与掌握度不受影响。",
      confirmText: "清空",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) return;
        const gone = store.clearDailyExtra();
        this.refreshDaily();
        wx.showToast({ title: gone ? "已清空今日加背 " + gone + " 首" : "所选篇目已不在今日加背中", icon: "none" });
        sync.markDirty();
      }
    });
  },

  refreshDaily() {
    this.setData({ daily: this.dailyRows(), dailyMax: store.DAILY_EXTRA_MAX });
  },

  gradeRows(grade) {
    return S.STAGE_GRADES[S.stageOf(grade)].map((g) => ({ value: g, label: S.gradeName(g) }));
  },

  algoRows(current) {
    return R.list().map((m) => {
      const allowed = E.algoAllowed(m.key);
      return {
        key: m.key,
        name: m.name,
        years: m.years,
        describe: m.describe,
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
    store.dropDayPlan();

    sync.markDirty();

    const grade = patch.grade === undefined ? this.data.grade : patch.grade;
    const derived = {
      stage: S.stageOf(grade),
      grades: this.gradeRows(grade)
    };
    this.setData(Object.assign(patch, derived, { algos: this.algoRows(patch.algo || this.data.algo) }), () =>
      this.updatePool()
    );
  },

  onGrade(e) {
    this.save({ grade: Number(e.detail.value) });
  },

  onStage(e) {
    const key = e.detail.value;
    const grades = S.STAGE_GRADES[key];
    if (!grades) return;

    const prev = this.data.grade;
    const grade = grades.indexOf(prev) >= 0 ? prev : grades[0];
    const scope = scopeForStage(key, this.data.scope);

    const patch = { grade, scope };
    if (grade === prev && scope === this.data.scope) return;
    this.save(patch);
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

  onAlgo(e) {
    const algo = e.detail.value;
    if (algo === this.data.algo || !E.algoAllowed(algo)) return;
    this.save({ algo });
  }
});
