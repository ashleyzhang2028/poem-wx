const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const S = require("../../utils/scheduler");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");

const REASON_TEXT = { review: "复习", new: "新学", extra: "加背", optional: "自选" };

Page({
  data: {
    /** 未登录时首页是「目录」而不是「今日计划」，这两个值决定整页长相 */
    logged: false,
    guest: false,
    gradeName: "",
    termName: "",
    scopeName: "",
    plan: [],
    doneCount: 0,
    total: 0,
    percent: 0,
    /** 未登录时的书目：一年级上下册，只有篇名作者，点不动 */
    catalog: [],
    catalogCount: 0
  },

  onShow() {
    this.refresh();
    // 登录之后才有东西可同步
    if (gate.logged()) sync.now().catch(() => {});
  },

  refresh() {
    const logged = gate.logged();

    // 未登录：首页只当目录用。**不读本机设置** —— 上次停在九年级是登录用户的事，
    // 访客看到的一律是一年级，这是 Issue 点名的「首页默认列出一年级诗词」。
    if (!logged) {
      const all = corpus.course().filter((p) => p.gr === gate.GUEST_GRADE);
      const catalog = all.map((p) => ({ id: p.id, title: p.t, author: p.a, dynasty: p.d }));
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
        catalogCount: catalog.length
      });
      return;
    }

    const settings = store.settings();
    const byId = {};
    const all = corpus.course();
    all.forEach((p) => {
      byId[p.id] = p;
    });

    const plan = S.generateDailyPlan({
      grade: settings.grade,
      term: settings.term,
      count: settings.dailyCount,
      scope: settings.scope,
      allPoems: all,
      extraPoems: store.dailyExtra().map((id) => byId[id]).filter(Boolean),
      getRecord: store.getRecord
    });

    const reads = store.reads("poems");
    let done = 0;
    const rows = plan.map((it) => {
      const rec = store.getRecord(it.poem.id);
      const read = !!reads[it.poem.id];
      if (read) done += 1;
      return {
        id: it.poem.id,
        title: it.poem.t,
        author: it.poem.a,
        dynasty: it.poem.d,
        reason: REASON_TEXT[it.reason] || "",
        reasonKey: it.reason,
        stage: S.stageName(rec),
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
      catalogCount: 0
    });
  },

  /**
   * 点开一篇。
   * 未登录时**不跳转也不静默吞掉** —— 弹一句人话，把人送去登录页。
   * 直接 navigateTo 到详情页由那边拦也行，但那会让用户先看到一屏空白再被弹窗，
   * 不如在首页就把话说清。
   */
  onOpen(e) {
    const id = e.currentTarget.dataset.id;
    gate.guard("背诵", () => {
      wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(id) });
    });
  },

  onStart() {
    if (!gate.guard("每日背诵")) return;
    const first = this.data.plan.find((r) => !r.read) || this.data.plan[0];
    if (first) wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(first.id) });
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

  onShareAppMessage() {
    return { title: "跬步 · 每天背一首古诗文", path: "/pages/home/home" };
  }
});
