const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const S = require("../../utils/scheduler");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const tabbar = require("../../utils/tabbar");

const REASON_TEXT = { review: "复习", new: "新学", extra: "加背", optional: "自选" };

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const CN_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/** 1 → 一，17 → 十七，30 → 三十 —— 月与日都要，日期写阿拉伯数字会跟「几首」混在一起 */
function cnDay(n) {
  if (n <= 10) return CN_NUM[n];
  if (n < 20) return "十" + (n % 10 ? CN_NUM[n % 10] : "");
  return CN_NUM[Math.floor(n / 10)] + "十" + (n % 10 ? CN_NUM[n % 10] : "");
}

/** 首屏那行小字：八月十七 · 周一。不写年份 —— 今天要背哪几首，跟哪一年无关 */
function todayLabel() {
  const d = new Date();
  return CN_NUM[d.getMonth() + 1] + "月" + cnDay(d.getDate()) + "日 · " + WEEKDAYS[d.getDay()];
}

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
    catalogCount: 0,

    /** 今天是几号 —— 首屏那行小字，让人一眼知道看到的是哪一天的计划 */
    todayLabel: "",
    /** 首屏那组大数字（参考图里最抓眼的一处）：今日 / 已背 / 待学。
        为什么放三个而不是一个进度环：环只说得清「几比几」，
        说得清「还剩几首」的是数字，而「还剩几首」才是打开这一屏要问的事。 */
    stats: { today: 0, done: 0, left: 0 },
    /** 首屏第一次出计划要读语料，先立个骨架，别让人对着一屏空白 */
    loading: true
  },

  onShow() {
    // 自绘底栏：切到本页时把自己那一格点亮
    tabbar.sync(this, 0);
    this.setData({ todayLabel: todayLabel() });
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
        loading: false
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
        // 阶段名与「新学 / 复习」那个标签常常是同一个词（刚学的那几首都是「新学」）
        // —— 同一行里说两遍，等于没说。只在与标签不同的时候才附上
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
      loading: false
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

  /**
   * 下拉换一批。
   * 首页是「今天要背什么」，下拉是对着它最自然的动作 ——
   * 不下拉也能用，但没这一下，用户想刷新只能切页回来。
   */
  onPullDownRefresh() {
    this.refresh();
    setTimeout(() => wx.stopPullDownRefresh(), 320);
  },

  onShareAppMessage() {
    // 分享出去的是首页，未登录的人点进来看到的是目录 —— 这正是设计好的入口
    return { title: "跬步 · 每天背一首古诗文", path: "/pages/home/home" };
  },

  onShareTimeline() {
    return { title: "跬步 · 每天背一首古诗文" };
  }
});
