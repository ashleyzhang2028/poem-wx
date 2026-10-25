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
const PACK_MAX = 80;

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    keyword: "",

    results: [],

    total: 0,
    hot: HOT,
    searched: false,
    searching: false,
    locked: true,

    resultWhere: "",

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
    this.setData({
      keyword: "",
      results: [],
      total: 0,
      searched: false,
      searching: false,
      more: false
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
      this.setData({ results: [], total: 0, searched: false, more: false });
      return;
    }
    store.saveSettings({ lastSearch: kw });

    const r = this.byIndex(kw);
    this.total = r.total;
    this.setData({
      results: r.items.slice(0, BATCH),
      total: r.total,
      more: r.total > BATCH,
      searched: true,
      searching: false,
      resultWhere: "篇名作者 · 课内"
    }, () => this.refreshPicked());
  },

  runSource(kw) {
    const token = (this.sourceToken || 0) + 1;
    this.sourceToken = token;
    this.fromPack = false;
    this.busy = false;
    this.session = null;
    this.got = {};

    const ask = (type) => source.search(kw, { type: type, page: 1, size: BATCH });

    ask("all")
      .then((r) => (r.total ? r : ask("content")))
      .then((r) => {
        if (token !== this.sourceToken) return;
        if (!r.items.length) {
          this.setData({
            results: [], total: 0, searched: true, searching: false,
            more: false, loading: false, partial: false, fromFull: false,
            resultWhere: "篇名作者 · 全站"
          });
          return;
        }
        this.sourceTotal = r.total;
        this.sourcePage = 1;
        this.setData({
          results: this.decorate(r.items.map((p) => source.asResult(p, kw))),
          total: r.total,
          more: r.total > r.items.length,
          searched: true,
          searching: false,
          loading: false,
          partial: false,
          fromFull: true,
          resultWhere: "诗泉 · 全文",
          resultMore: r.total > r.items.length ? "每次 20 篇，往下拉接着出" : "就这些了"
        });
      })
      ["catch"](() => {
        if (token !== this.sourceToken) return;
        this.setData({
          results: [], total: 0, searched: true, searching: false,
          more: false, loading: false, partial: false
        });
      });
  },

  moreSource() {
    const kw = this.data.keyword.trim();
    const page = (this.sourcePage || 1) + 1;
    const token = this.sourceToken;
    this.setData({ loading: true });
    source.search(kw, { type: "all", page: page, size: BATCH }).then((r) => {
      if (token !== this.sourceToken) return;
      const seen = this.got || (this.got = {});
      const rows = [];
      r.items.forEach((p) => {
        const row = source.asResult(p, kw);
        if (seen[row.id]) return;
        seen[row.id] = 1;
        rows.push(row);
      });
      const results = this.data.results.concat(this.decorate(rows));
      this.sourcePage = page;
      this.setData({
        results: results,
        total: this.sourceTotal || r.total,
        loading: false,
        more: results.length < (this.sourceTotal || r.total),
        resultMore: results.length < (this.sourceTotal || r.total) ? "每次 20 篇，往下拉接着出" : "就这些了"
      });
    }, () => {
      if (token !== this.sourceToken) return;
      this.setData({ loading: false, more: false });
    });
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
    const list = cols.list();
    if (!list.length) {
      wx.showModal({
        title: "暂无自选集合",
        content: "请前往「我的 → 自选背诵」新建集合。",
        confirmText: "前往",
        cancelText: "取消",
        success: (res) => {
          if (res.confirm) wx.navigateTo({ url: "/packages/settings/collections/collections" });
        }
      });
      return;
    }
    if (list.length === 1) {
      this.toggleIn(list[0], id);
      return;
    }
    wx.showActionSheet({
      itemList: list.map((c) => cols.nameOf(c) + "（" + cols.idsOf(c).length + " 首）"),
      success: (res) => this.toggleIn(list[res.tapIndex], id),
      fail: () => {}
    });
  },

  toggleIn(c, poemId) {
    const inside = cols.idsOf(c).indexOf(poemId) >= 0;
    const r = inside ? cols.removeItems(c.id, [poemId]) : cols.add(c.id, [poemId]);
    if (!inside && !r.ok) {
      const msg = r.code === "E_FULL"
        ? "「" + cols.nameOf(c) + "」已满 " + cols.ITEMS_MAX + " 首"
        : "添加失败";
      wx.showToast({ title: msg, icon: "none" });
      return;
    }
    sync.markDirty();
    wx.showToast({ title: inside ? "已移出「" + cols.nameOf(c) + "」" : "已加入「" + cols.nameOf(c) + "」", icon: "none" });
    this.refreshPicked();
  },

  refreshPicked() {
    this.setData({ results: this.decorate(this.data.results) });
  },

  onReachBottom() {
    if (!this.data.more) return;
    const want = this.data.results.length + BATCH;
    const r = this.byIndex(this.data.keyword.trim(), want);
    this.setData({ results: r.items.slice(0, want), more: this.total > want }, () => this.refreshPicked());
  },

  onOpen(e) {
    trail.set(this.data.results.map((p) => p.id));
    wx.navigateTo({
      url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) + "&mode=browse"
    });
  },

  onAuthors() {
    wx.navigateTo({ url: "/packages/authors/index/index" });
  },

  onShareAppMessage() {
    return { title: "全站搜索", path: "/pages/search/search" };
  }
});
