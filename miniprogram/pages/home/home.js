const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const S = require("../../utils/scheduler");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");

const REASON_TEXT = { review: "复习", new: "新学", extra: "补充", optional: "自选", pinned: "今日加背" };

const REASON_CLS = { review: "amber", new: "blue", pinned: "gold" };

function reasonCls(key) {
  return REASON_CLS[key] || "ghost";
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const CN_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

function cnDay(n) {
  if (n <= 10) return CN_NUM[n];
  if (n < 20) return "十" + (n % 10 ? CN_NUM[n % 10] : "");
  return CN_NUM[Math.floor(n / 10)] + "十" + (n % 10 ? CN_NUM[n % 10] : "");
}

function todayLabel() {
  const d = new Date();
  return CN_NUM[d.getMonth() + 1] + "月" + cnDay(d.getDate()) + "日 · " + WEEKDAYS[d.getDay()];
}

Page({
  data: {

    themeStyle: "",

    /* 语料没生成时的空态：data/ 是构建产物（不进仓库），
       没跑 build:data 就打开，页面给一句人话，而不是白屏（Issue #121）。 */
    noData: false,
    logged: false,
    guest: false,
    gradeName: "",
    termName: "",
    scopeName: "",
    plan: [],
    doneCount: 0,
    total: 0,
    percent: 0,

    catalog: [],
    catalogCount: 0,

    todayLabel: "",

    stats: { today: 0, done: 0, left: 0 },

    todoCount: 0,

    loading: true
  },

  onShow() {
    theme.apply(this);

    tabbar.sync(this, 0);
    this.setData({ todayLabel: todayLabel() });
    this.refresh();

    if (gate.logged()) sync.now().catch(() => {});
  },

  refresh() {

    /* 语料是构建产物。没生成时后面的 corpus.course() 都会回空，
       页面会是一片「没有诗词」—— 那看着像坏了。这里显式说清是哪一步没跑。 */
    if (!corpus.hasData()) {
      this.setData({
        noData: true,
        guest: false,
        logged: false,
        plan: [],
        catalog: [],
        catalogCount: 0,
        total: 0,
        doneCount: 0,
        percent: 0,
        stats: { today: 0, done: 0, left: 0 },
        todoCount: 0,
        loading: false
      });
      return;
    }

    const logged = gate.logged();

    if (!logged) {
      const all = corpus.course().filter((p) => p.gr === gate.GUEST_GRADE);
      const catalog = all.map((p, i) => ({
        id: p.id,
        title: p.t,
        author: p.a,
        dynasty: p.d,
        seq: i + 1
      }));
      this.setData({
        logged: false,
        guest: true,
        gradeName: S.gradeName(gate.GUEST_GRADE),
        termName: "",
        scopeName: "一年级上下册",
        plan: [],
        total: 0,
        doneCount: 0,
        percent: 0,
        catalog,
        catalogCount: catalog.length,
        stats: { today: 0, done: 0, left: 0 },
        todoCount: 0,
        loading: false
      });
      return;
    }

    const settings = store.settings();
    const all = corpus.course();

    // 登录态这一支的范围口径：全从用户设置来（游客那一支在 method 开头就 return 了，
    // 不共用这一段）。上面那次重构解冲突时把 `view` 的定义删了，却留下三处引用 ——
    // 登录用户一进首页就 ReferenceError，整个今日计划渲染不出来，看着像「没有数据」。
    const view = { grade: settings.grade, term: settings.term, scope: settings.scope };

    const plan = S.generateDailyPlan({
      grade: view.grade,
      term: view.term,
      count: settings.dailyCount,
      scope: view.scope,
      allPoems: all,

      extraPoems: store.dailyExtraPoems(),
      getRecord: store.getRecord
    });

    const reads = logged ? store.reads("poems") : {};
    let done = 0;
    const rows = plan.map((it, i) => {
      const rec = store.getRecord(it.poem.id);
      const read = !!reads[it.poem.id];
      if (read) done += 1;
      return {
        id: it.poem.id,
        seq: i + 1,
        title: it.poem.t,
        author: it.poem.a,
        dynasty: it.poem.d,
        reason: REASON_TEXT[it.reason] || "",
        reasonKey: it.reason,
        tagCls: reasonCls(it.reason),

        stage: S.stageName(rec) === REASON_TEXT[it.reason] ? "" : S.stageName(rec),
        mastery: S.mastery(rec),
        reviewed: !!(rec && rec.learned),
        read
      };
    });

    const total = rows.length;
    this.setData({
      logged: true,
      guest: false,
      gradeName: S.gradeName(settings.grade) + S.termName(settings.term),
      termName: S.termName(settings.term),
      scopeName: S.scopeOf(settings.scope).scopeName,
      plan: rows,
      doneCount: done,
      total,
      percent: total ? Math.round((done / total) * 100) : 0,
      catalog: [],
      catalogCount: 0,
      stats: { today: total, done, left: Math.max(0, total - done) },

      todoCount: rows.filter((r) => !r.reviewed).length,
      loading: false
    });
  },

  onOpen(e) {
    const id = e.currentTarget.dataset.id;
    this.openSheet(id);
  },

  onStart() {
    const first = this.data.plan.find((r) => !r.reviewed) || this.data.plan[0];
    if (!first) return;
    this.openSheet(first.id);
  },

  openSheet(id) {
    gate.guard("背诵", () => {
      const sheet = this.selectComponent("#sheet");

      if (sheet) sheet.open(this.data.plan, id);
    });
  },

  onSheetOpen() {
    this.refresh();
  },

  onExtraChange() {
    this.refresh();
  },

  onExtraInput(e) {
    const box = this.selectComponent("#extra");
    if (box) box.onInput(e);

    this.setData({
      extraKeyword: (e && e.detail && e.detail.value) || "",
      extraRows: (box && box.data && box.data.rows) || []
    });
  },

  onSheetFinish() {
    this.refresh();
  },

  onSettings() {
    if (!gate.guard("背诵设置")) return;
    wx.navigateTo({ url: "/packages/settings/recite/recite" });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onBrowseAll() {
    if (!gate.guard("全部课内诗词")) return;
    wx.navigateTo({ url: "/pages/list/list?book=poems" });
  },

  onPullDownRefresh() {
    this.refresh();
    setTimeout(() => wx.stopPullDownRefresh(), 320);
  },

  onShareAppMessage() {

    return { title: "跬步 · 每天背一首古诗文", path: "/pages/home/home" };
  },

  onShareTimeline() {
    return { title: "跬步 · 每天背一首古诗文" };
  }
});
