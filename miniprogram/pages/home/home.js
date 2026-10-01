const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const S = require("../../utils/scheduler");
const E = require("../../utils/entitlement");

const REASON_TEXT = { review: "复习", new: "新学", extra: "加背", optional: "自选" };

Page({
  data: {
    logged: false,
    /** 游客态：首页只列本册，整页只读，点不动 */
    readOnly: false,
    lockedHint: "",
    gradeName: "",
    termName: "",
    scopeName: "",
    plan: [],
    doneCount: 0,
    total: 0,
    percent: 0
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const logged = E.signedIn();
    const settings = store.settings();

    // 游客不看用户设置里的范围 —— 游客只有本册
    const view = logged
      ? { grade: settings.grade, term: settings.term, scope: settings.scope, readOnly: false }
      : E.guestScope();

    const byId = {};
    const all = corpus.course();
    all.forEach((p) => {
      byId[p.id] = p;
    });

    const plan = S.generateDailyPlan({
      grade: view.grade,
      term: view.term,
      count: settings.dailyCount,
      scope: view.scope,
      allPoems: all,
      extraPoems: logged ? store.dailyExtra().map((id) => byId[id]).filter(Boolean) : [],
      getRecord: store.getRecord
    });

    // 游客没有本机进度可谈：环与「已背」状态一律归零，不拿别人的数据充数
    const reads = logged ? store.reads("poems") : {};
    let done = 0;
    const rows = plan.map((it) => {
      const rec = logged ? store.getRecord(it.poem.id) : null;
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
      logged,
      readOnly: !!view.readOnly,
      lockedHint: view.readOnly ? E.hint("recite.basic") : "",
      gradeName: S.gradeName(view.grade) + S.termName(view.term),
      termName: S.termName(view.term),
      scopeName: view.readOnly ? view.title : S.scopeOf(view.scope).scopeName,
      plan: rows,
      doneCount: done,
      total,
      percent: total ? Math.round((done / total) * 100) : 0
    });
  },

  /** 游客点任何一篇 / 任何按钮，都走同一个门禁 */
  onLoginGate() {
    wx.switchTab({ url: "/pages/mine/mine" });
  },

  onOpen(e) {
    if (this.data.readOnly) {
      E.block("recite.basic", { page: this, content: "不登录可以看首页列出的诗词，点开阅读需要先登录。" });
      return;
    }
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
  },

  onStart() {
    if (this.data.readOnly) {
      E.block("recite.basic", { page: this, content: "不登录可以看首页列出的诗词，开始背诵需要先登录。" });
      return;
    }
    const first = this.data.plan.find((r) => !r.read) || this.data.plan[0];
    if (first) wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(first.id) });
  },

  onSettings() {
    if (this.data.readOnly) {
      E.block("recite.basic", { page: this, content: "背诵范围、每日首数是登录后的设置项。" });
      return;
    }
    wx.navigateTo({ url: "/packages/settings/recite/recite" });
  },

  onShareAppMessage() {
    return { title: "跬步 · 每天背一首古诗文", path: "/pages/home/home" };
  }
});
