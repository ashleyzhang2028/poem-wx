const store = require("../../../utils/store");
const corpus = require("../../../utils/corpus");
const sync = require("../../../utils/sync");
const S = require("../../../utils/scheduler");
const R = require("../../../utils/review-models");
const E = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");

const STAGES = S.STAGE_KEYS.map((k) => ({ key: k, name: S.STAGES[k].name }));

const STAGE_SCOPE = { primary: "primary", middle: "middle", high: "high" };

function scopeForStage(stage, scope) {
  const to = STAGE_SCOPE[stage];
  if (!to) return scope;
  return S.SCOPES[scope] && S.SCOPES[scope].stages && S.SCOPES[scope].stages.length === 1
    ? to
    : scope;
}

const TERMS = [
  { value: 1, label: "上学期" },
  { value: 2, label: "下学期" }
];

Page({
  data: {
    themeStyle: "",
    grades: [],
    terms: TERMS,
    stages: STAGES,
    grade: 1,

    stage: "primary",

    gradeNote: "",
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
    locked: false
  },

  onShow() {
    theme.apply(this);
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });
    const settings = store.settings();
    const scopes = Object.keys(S.SCOPES).map((k) => ({ key: k, label: S.SCOPES[k].label }));
    this.setData(
      Object.assign({}, settings, {
        stage: S.stageOf(settings.grade),
        grades: this.gradeRows(settings.grade),
        gradeNote: this.gradeNote(settings.grade),
        scopes: scopes,
        algos: this.algoRows(settings.algo),
        daily: this.dailyRows(),
        dailyMax: store.DAILY_EXTRA_MAX
      }),
      () => this.updatePool()
    );
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
      wx.showToast({ title: "还没选中任何一篇", icon: "none" });
      return;
    }
    const n = store.removeDailyExtra(ids);
    this.refreshDaily();
    wx.showToast({ title: n ? "已移出 " + n + " 首" : "这几首已经不在今天的加背里了", icon: "none" });
    sync.markDirty();
  },

  onDailyClear() {
    const n = store.dailyExtra().length;
    if (!n) return;
    wx.showModal({
      title: "清空今日加背",
      content: "把今天加背的 " + n + " 首全部移出？已经背过的进度与掌握度一个字都不动。",
      confirmText: "清空",
      cancelText: "算了",
      success: (res) => {
        if (!res.confirm) return;
        const gone = store.clearDailyExtra();
        this.refreshDaily();
        wx.showToast({ title: "今天的加背已清空 " + gone + " 首", icon: "none" });
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

  gradeNote(grade) {
    const key = S.stageOf(grade);
    const gs = S.STAGE_GRADES[key];
    return S.stageLabel(key) + "（" + gs[0] + "—" + gs[gs.length - 1] + " 年级）";
  },

  algoRows(current) {
    return R.list().map((m) => {
      const allowed = E.algoAllowed(m.key);
      return {
        key: m.key,
        name: m.name,
        blurb: m.blurb,
        years: m.years,
        allowed,

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

    sync.markDirty();

    const grade = patch.grade === undefined ? this.data.grade : patch.grade;
    const derived = {
      stage: S.stageOf(grade),
      grades: this.gradeRows(grade),
      gradeNote: this.gradeNote(grade)
    };
    this.setData(Object.assign(patch, derived, { algos: this.algoRows(patch.algo || this.data.algo) }), () =>
      this.updatePool()
    );
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
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
