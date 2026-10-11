const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const textSearch = require("../../utils/text-search");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");

const HOT = ["李白", "杜甫", "苏轼", "春", "月", "登高", "王维"];

const PAGE_MAX = 80;

const FULL_MAX = 40;

Page({
  data: {
    themeStyle: "",
    keyword: "",

    fullOn: false,
    results: [],

    total: 0,
    hot: HOT,
    searched: false,
    searching: false,
    locked: true,

    resultWhere: "",

    fromFull: false,
    partial: false
  },

  onShow() {
    theme.apply(this);

    tabbar.sync(this, 2);

    if (!gate.logged() || !entitlement.can("search")) {
      this.setData({ locked: true });
      return;
    }
    const saved = store.settings();
    const fr = textSearch.readiness();
    this.setData({
      locked: false,
      keyword: this.data.keyword || saved.lastSearch || "",
      fullOn: fr.usable
    });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onClear() {
    clearTimeout(this.fullTimer);
    this.setData({ keyword: "", results: [], total: 0, searched: false, searching: false, partial: false });
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

    const r = this.byIndex(kw);
    if (r.total) {
      this.setData({
        results: r.items,
        total: r.total,
        searched: true,
        searching: false,
        fromFull: false,
        resultWhere: "篇名作者 · 全站"
      });
      return;
    }

    if (!this.data.fullOn) {
      this.setData({
        results: [],
        total: 0,
        searched: true,
        searching: false,
        fromFull: false,
        resultWhere: "篇名作者 · 全站"
      });
      return;
    }

    this.setData({ searching: true, searched: false, partial: false });

    clearTimeout(this.fullTimer);
    this.fullTimer = setTimeout(() => this.runFull(kw), 16);
  },

  byIndex(kw) {
    const r = corpus.search(kw, { limit: PAGE_MAX });
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

  onUnload() {
    clearTimeout(this.fullTimer);
    this.fullTimer = null;
  },

  runFull(kw) {
    let hits = [];

    try {
      hits = textSearch.search(kw, { limit: FULL_MAX + 1 });
    } catch (e) {
      hits = [];
    }
    const partial = !!hits.partial;
    const truncated = hits.length > FULL_MAX;
    if (truncated) hits = hits.slice(0, FULL_MAX);

    this.setData({
      partial: partial,
      total: truncated ? FULL_MAX + 1 : hits.length,
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
      fromFull: true,
      resultWhere: partial ? "正文全文 · 命中片较多，只扫了部分" : "正文全文 · 全站"
    });
  },

  onOpen(e) {
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
  },

  onAuthors() {
    wx.navigateTo({ url: "/packages/authors/index/index" });
  },

  onShareAppMessage() {
    return { title: "跬步 · 全站搜索", path: "/pages/search/search" };
  }
});
