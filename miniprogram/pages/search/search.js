const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const textSearch = require("../../utils/text-search");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");

const HOT = ["李白", "杜甫", "苏轼", "春", "月", "登高", "王维"];

const BATCH = 20;
const PACK_MAX = 80;

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

    more: false,
    loading: false,

    fromFull: false,
    partial: false,
    resultMore: ""
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

  onUnload() {
    this.busy = false;
    this.session = null;
    clearTimeout(this.fullTimer);
    this.fullTimer = null;
  },

  onClear() {
    this.busy = false;
    this.session = null;
    clearTimeout(this.fullTimer);
    this.setData({
      keyword: "",
      results: [],
      total: 0,
      searched: false,
      searching: false,
      more: false,
      loading: false,
      partial: false
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
      this.setData({ results: [], total: 0, searched: false, more: false });
      return;
    }
    store.saveSettings({ lastSearch: kw });

    this.busy = false;
    this.session = null;

    const r = this.byIndex(kw);
    if (r.total >= (this.data.fullOn ? BATCH : 1)) {
      this.fromPack = true;
      this.total = r.total;
      this.setData({
        results: r.items.slice(0, BATCH),
        total: r.total,
        more: r.total > BATCH,
        searched: true,
        searching: false,
        loading: false,
        fromFull: false,
        resultWhere: "篇名作者 · 全站"
      });
      return;
    }

    if (!this.data.fullOn) {
      this.setData({
        results: [],
        total: 0,
        more: false,
        searched: true,
        searching: false,
        loading: false,
        fromFull: false,
        resultWhere: "篇名作者 · 全站"
      });
      return;
    }

    this.setData({ searching: true, searched: false, more: false, loading: false, partial: false });

    clearTimeout(this.fullTimer);
    this.fullTimer = setTimeout(() => this.runFull(kw), 16);
  },

  byIndex(kw, limit) {
    const r = corpus.search(kw, { limit: limit || PACK_MAX });
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
    let session = null;
    try {
      session = textSearch.makeSession(kw, {});
    } catch (e) {
      session = null;
    }
    if (!session) {
      this.setData({ results: [], total: 0, searched: true, searching: false, more: false, loading: false });
      return;
    }
    this.session = session;
    this.busy = true;
    this.fromPack = false;
    this.got = {};
    this.pushBatch();
  },

  onReachBottom() {
    if (!this.data.more || this.data.loading) return;
    if (this.fromPack) {
      const want = this.data.results.length + BATCH;
      const r = this.byIndex(this.data.keyword.trim(), want);
      this.setData({ results: r.items.slice(0, want), more: this.total > want });
      return;
    }
    this.pushBatch();
  },

  pushBatch() {
    const session = this.session;
    if (!this.busy || !session) return;

    this.setData({ loading: true });

    let batch = [];
    try {
      batch = textSearch.nextBatch(session, BATCH);
    } catch (e) {
      batch = [];
    }
    if (!this.busy || this.session !== session) return;

    const more = batch.length > BATCH;
    const rows = [];
    const seen = this.got || (this.got = {});
    const fullHit = this.gotFull || batch.some((h) => h.where !== "pack");
    this.gotFull = fullHit;
    (more ? batch.slice(0, BATCH) : batch).forEach((h) => {
      if (seen[h.entry.id]) return;
      seen[h.entry.id] = 1;
      rows.push({
        id: h.entry.id,
        title: h.entry.t,
        author: h.entry.a,
        dynasty: h.entry.d,
        bookName: h.entry.n,
        lines: h.lines,
        where: h.where === "pack" ? "课内" : "课外"
      });
    });

    const results = this.data.results.concat(rows);

    this.setData({
      results: results,
      total: results.length,
      more: more && !session.done,
      loading: false,
      searched: true,
      searching: false,
      fromFull: true,
      partial: session.partial,
      resultMore: more
        ? "每次 20 篇，往下拉接着出"
        : session.partial
        ? "命中的片很多，先扫了命中字最多的那几片"
        : "就这些了",
      resultWhere: fullHit ? "正文全文 · 全站" : "篇名作者 · 全站"
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
