const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const S = require("../../utils/scheduler");

const REASON_TEXT = { review: "复习", new: "新学", extra: "加背", optional: "自选" };

Page({
  data: {
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
      gradeName: S.gradeName(settings.grade) + S.termName(settings.term),
      termName: S.termName(settings.term),
      scopeName: S.scopeOf(settings.scope).scopeName,
      plan: rows,
      doneCount: done,
      total,
      percent: total ? Math.round((done / total) * 100) : 0
    });
  },

  onOpen(e) {
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
  },

  onStart() {
    const first = this.data.plan.find((r) => !r.read) || this.data.plan[0];
    if (first) wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(first.id) });
  },

  onSettings() {
    wx.navigateTo({ url: "/packages/settings/recite/recite" });
  },

  onShareAppMessage() {
    return { title: "跬步 · 每天背一首古诗文", path: "/pages/home/home" };
  }
});
