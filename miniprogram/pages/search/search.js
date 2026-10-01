const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const textSearch = require("../../utils/text-search");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");

const HOT = ["李白", "杜甫", "苏轼", "春", "月", "登高", "王维"];

const MODES = [
  { key: "index", label: "篇名作者" },
  { key: "full", label: "正文全文" }
];

Page({
  data: {
    keyword: "",
    scope: "all",
    scopes: [{ key: "all", label: "全站" }, { key: "poems", label: "课内" }],
    modes: MODES,
    mode: "index",
    fullOn: false,
    results: [],
    hot: HOT,
    searched: false,
    searching: false,
    locked: true,
    /** 「命中 N 篇 · 在哪儿搜的」—— 让结果范围有个交代，不至于看完不知道是不是全量 */
    resultWhere: ""
  },

  onShow() {
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
    this.setData({ keyword: "", results: [], searched: false, searching: false });
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
      this.setData({ results: [], searched: false });
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

    const results = this.byIndex(kw);
    this.setData({
      results,
      searched: true,
      searching: false,
      resultWhere: this.data.scope === "poems" ? "篇名作者 · 只看课内" : "篇名作者 · 全站"
    });
  },

  /** 搜索栏上方那句提示：搜索中 / 落到索引字段时如实说 */
  byIndex(kw) {
    return corpus
      .search(kw, { book: this.data.scope === "poems" ? "poems" : "", limit: 80 })
      .map((p) => ({
        id: p.id,
        title: p.t,
        author: p.a,
        dynasty: p.d,
        bookName: p.n,
        lines: []
      }));
  },

  runFull(kw) {
    let hits = [];
    try {
      hits = textSearch.search(kw, {
        book: this.data.scope === "poems" ? "poems" : "",
        limit: 40
      });
    } catch (e) {
      hits = [];
    }

    this.setData({
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
