const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const textSearch = require("../../utils/text-search");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");
const tabbar = require("../../utils/tabbar");

const HOT = ["李白", "杜甫", "苏轼", "春", "月", "登高", "王维"];

const MODES = [
  { key: "index", label: "篇名作者", icon: "title" },
  { key: "full", label: "正文全文", icon: "full" }
];

/**
 * 一次列出多少条。
 *
 * 上一版写死 80 却不说 —— 搜「春」全站命中 528 篇，界面照样只写「命中 80 篇」，
 * 剩下 448 篇像是不存在。这一版把上限摆到明面上：先拿到**总数**，
 * 界面写「命中 528 篇 · 列出前 80 篇」，没截断就不提这一句。
 *
 * 为什么不做「加载更多」：全站索引只能逐集子现遍历（主包 2MB 的线不能碰），
 * 5575 条遍历一次在真机上已经要等一拍。先如实交代，不做假分页。
 */
const PAGE_MAX = 80;

Page({
  data: {
    keyword: "",
    scope: "all",
    // 图标按 key 取（.ic-all-site / .ic-course / .ic-title / .ic-full），
    // 样式在 app.wxss 的「分段控件」一节 —— 全 app 只有那一处画图标
    scopes: [
      { key: "all", label: "全站", icon: "all-site" },
      { key: "poems", label: "课内", icon: "course" }
    ],
    modes: MODES,
    mode: "index",
    fullOn: false,
    results: [],
    /** 截断前的命中总数 —— 「命中 N 篇」说的是它，不是 results.length */
    total: 0,
    hot: HOT,
    searched: false,
    searching: false,
    locked: true,
    /** 「命中 N 篇 · 在哪儿搜的」—— 让结果范围有个交代，不至于看完不知道是不是全量 */
    resultWhere: ""
  },

  onShow() {
    // 自绘底栏：切到本页时把自己那一格点亮
    tabbar.sync(this, 2);
    // 搜索是 free 档能力，但同样要先登录。
    // 搜索页在 tabBar 上，未登录点进来不该是一屏空壳。
    if (!gate.logged() || !entitlement.can("search")) {
      this.setData({ locked: true });
      return;
    }
    const saved = store.settings();
    const fr = textSearch.readiness();
    this.setData({
      locked: false,
      keyword: this.data.keyword || saved.lastSearch || "",
      fullOn: fr.usable,
      mode: fr.usable ? saved.lastSearchMode || "index" : "index"
    });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onClear() {
    this.setData({ keyword: "", results: [], total: 0, searched: false, searching: false });
  },

  onScope(e) {
    const scope = e.detail.value;
    this.setData({ scope }, () => {
      if (this.data.keyword) this.doSearch();
    });
  },

  onMode(e) {
    const mode = e.detail.value;
    store.saveSettings({ lastSearchMode: mode });
    this.setData({ mode }, () => {
      if (this.data.keyword) this.doSearch();
    });
  },

  onHot(e) {
    this.setData({ keyword: e.currentTarget.dataset.k }, () => this.doSearch());
  },

  doSearch() {
    if (!gate.logged()) {
      this.onLogin();
      return;
    }
    const kw = this.data.keyword.trim();
    if (!kw) {
      this.setData({ results: [], total: 0, searched: false });
      return;
    }
    store.saveSettings({ lastSearch: kw });

    if (this.data.mode === "full" && this.data.fullOn) {
      this.setData({ searching: true, searched: false });
      // 分片读取是同步的（require），但界面先让出一个 tick，
      // 免得大结果集把点击反馈吞掉 —— 让人以为没反应是最糟的体验
      setTimeout(() => this.runFull(kw), 16);
      return;
    }

    const r = this.byIndex(kw);
    this.setData({
      results: r.items,
      total: r.total,
      searched: true,
      searching: false,
      resultWhere: this.data.scope === "poems" ? "篇名作者 · 只看课内" : "篇名作者 · 全站"
    });
  },

  /** 搜索栏上方那句提示：搜索中 / 落到索引字段时如实说 */
  byIndex(kw) {
    const r = corpus.search(kw, {
      book: this.data.scope === "poems" ? "poems" : "",
      limit: PAGE_MAX
    });
    return {
      total: r.total,
      items: r.items.map((p) => ({
        id: p.id,
        title: p.t,
        author: p.a,
        dynasty: p.d,
        bookName: p.n,
        lines: []
      }))
    };
  },

  runFull(kw) {
    let hits = [];
    // 全文检索走倒排索引，命中动辄几千条，比索引字段更容易截断 ——
    // 上限同样摆在明面上（「命中 N 篇 · 列出前 40 篇」），不闷声砍掉
    const fullMax = 40;
    try {
      hits = textSearch.search(kw, {
        book: this.data.scope === "poems" ? "poems" : "",
        limit: fullMax + 1
      });
    } catch (e) {
      hits = [];
    }
    // 多要一条只是为了知道「有没有第 41 条」；索引层报不出总数，就用它当界
    const truncated = hits.length > fullMax;
    if (truncated) hits = hits.slice(0, fullMax);

    this.setData({
      total: truncated ? fullMax + 1 : hits.length,
      results: hits.map((h) => ({
        id: h.entry.id,
        title: h.entry.t,
        author: h.entry.a,
        dynasty: h.entry.d,
        bookName: h.entry.n,
        lines: h.lines,
        where: h.where === "pack" ? "课内" : "课外"
      })),
      searched: true,
      searching: false,
      resultWhere: this.data.scope === "poems" ? "正文全文 · 只看课内" : "正文全文 · 全站"
    });
  },

  onOpen(e) {
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
  },

  onShareAppMessage() {
    return { title: "跬步 · 全站搜索", path: "/pages/search/search" };
  }
});
