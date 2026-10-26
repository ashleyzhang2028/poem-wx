const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const source = require("../../utils/poem-source");
const gate = require("../../utils/gate");
const loginFlow = require("../../utils/login-flow");
const guard = require("../../utils/guard");
const entitlement = require("../../utils/entitlement");
const cols = require("../../utils/collections");
const sync = require("../../utils/sync");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");
const icons = require("../../utils/icons");
const trail = require("../../utils/trail");

const HOT = ["李白", "杜甫", "苏轼", "春", "月", "登高"];

const BATCH = 20;

function workKey(row) {
  return String(row.title || "").trim() + "\u0000" + String(row.author || "").trim();
}

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    keyword: "",

    results: [],

    total: 0,
    packTotal: 0,
    full: false,
    loading: false,
    hot: HOT,
    searched: false,
    searching: false,
    locked: true,

    more: false,

    icons: { search: icons.search, clear: icons.clear, playlist: icons.playlist }
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: !!tabbar.sync(this, 3) });

    if (!gate.logged() || !entitlement.can("search")) {
      this.setData({ locked: true });
      return;
    }
    const saved = store.settings();
    this.setData({
      locked: false,
      keyword: this.data.keyword || saved.lastSearch || ""
    });
  },

  onTierGate() {
    entitlement.openPricing();
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onClear() {
    this.token = (this.token || 0) + 1;
    this.sourcePage = 0;
    this.packTotal = 0;
    this.setData({
      keyword: "",
      results: [],
      total: 0,
      searched: false,
      searching: false,
      more: false,
      full: false,
      loading: false
    });
  },

  onHot(e) {
    this.setData({ keyword: e.currentTarget.dataset.k }, () => this.doSearch());
  },

  doSearch() {
    if (!gate.logged()) {
      loginFlow.run(this);
      return;
    }
    const kw = this.data.keyword.trim();
    if (!kw) {
      this.setData({ results: [], total: 0, searched: false, more: false, full: false, loading: false });
      return;
    }
    store.saveSettings({ lastSearch: kw });

    this.token = (this.token || 0) + 1;
    this.sourcePage = 0;
    this.sourceIds = {};
    const token = this.token;

    const pack = this.byIndex(kw);
    this.setData({
      results: this.decorate(pack.items.slice(0, BATCH)),
      packTotal: pack.total,
      total: pack.total,
      more: pack.total > BATCH,
      searched: true,
      searching: false,
      full: false,
      loading: false
    }, () => this.refreshPicked());

    if (pack.total <= BATCH) this.askSource(kw, 1, token);
  },

  askSource(kw, page, token) {
    if (!source.usable()) {
      if (token === this.token) this.setData({ loading: false, more: this.packLeft() > 0 });
      return;
    }
    this.setData({ loading: true });
    source.search(kw, { type: "all", page: page, size: BATCH }).then((r) => {
      if (token !== this.token) return;
      this.sourcePage = page;
      this.appendSource(r.items, kw, r.more);
    }, () => {
      if (token !== this.token) return;
      this.setData({ loading: false, more: this.packLeft() > 0 || (this.sourcePage > 0 && this.data.more) });
    });
  },

  appendSource(items, kw, hasNext) {
    const seen = this.sourceIds;
    const have = {};
    (this.data.results || []).forEach((r) => { have[workKey(r)] = 1; });
    const rows = [];
    (items || []).forEach((p) => {
      const row = source.asResult(p, kw);
      if (!row.id || seen[row.id] || have[workKey(row)]) return;
      seen[row.id] = 1;
      have[workKey(row)] = 1;
      rows.push(row);
    });
    const list = this.decorate(this.data.results.concat(rows));
    this.setData({
      results: list,
      total: (this.packTotal || 0) + Object.keys(seen).length,
      more: this.packLeft() > 0 || !!hasNext,
      full: !hasNext,
      loading: false
    });
  },

  packLeft() {
    const rest = (this.packTotal || 0) - (this.data.results || []).length;
    return rest > 0 ? rest : 0;
  },

  byIndex(kw) {
    const found = corpus.search(kw, { limit: Infinity });
    return {
      total: found.total,
      items: found.items.map((p) => ({
        id: p.id,
        title: p.t,
        author: p.a,
        dynasty: p.d,
        bookName: p.n,
        lines: []
      }))
    };
  },

  pickedMap() {
    const map = {};
    cols.list().forEach((c) => {
      cols.idsOf(c).forEach((pid) => { map[pid] = true; });
    });
    return map;
  },

  decorate(items) {
    const map = this.pickedMap();
    return (items || []).map((it) => Object.assign({}, it, { picked: !!map[it.id] }));
  },

  onPick(e) {
    e.stopPropagation && e.stopPropagation();
    if (!entitlement.block("collections", { page: this, loginPrompt: true })) return;
    if (guard.gap("search:pick")) return;
    guard.mark("search:pick");
    const id = e.currentTarget.dataset.id;
    const row = (this.data.results || []).filter((p) => p.id === id)[0] || {};
    const box = this.selectComponent("#collect");
    if (box) box.ask(id, row.title || "");
  },

  onCollectDone(e) {
    const d = (e && e.detail) || {};
    if (!d.id) return;
    sync.markDirty();
    this.refreshPicked();
    wx.showToast({ title: "已加入「" + d.name + "」", icon: "none" });
  },

  refreshPicked() {
    this.setData({ results: this.decorate(this.data.results) });
  },

  onReachBottom() {
    if (this.data.loading || !this.data.more) return;
    const kw = this.data.keyword.trim();
    if (this.packLeft() === 0) return this.askSource(kw, (this.sourcePage || 0) + 1, this.token);
    const want = Math.min(this.packTotal || 0, (this.data.results || []).length + BATCH);
    const pack = this.byIndex(kw);
    const rows = pack.items.slice(0, want);
    this.setData({
      results: this.decorate(rows),
      total: rows.length,
      more: true
    }, () => this.refreshPicked());
    if (rows.length >= (this.packTotal || 0)) this.askSource(kw, 1, this.token);
  },

  onOpen(e) {
    const id = e.currentTarget.dataset.id;
    trail.set(this.data.results.map((p) => p.id));
    wx.navigateTo({
      url: "/pages/reader/reader?id=" + encodeURIComponent(id) + "&mode=browse" +
        (corpus.indexById(id) ? "" : "&src=1")
    });
  },

  onAuthors() {
    wx.navigateTo({ url: "/packages/authors/index/index" });
  },

  onShareAppMessage() {
    return { title: "搜索", path: "/pages/search/search" };
  }
});
