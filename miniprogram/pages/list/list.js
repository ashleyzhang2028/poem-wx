const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");
const cols = require("../../utils/collections");
const sync = require("../../utils/sync");
const theme = require("../../utils/theme");
const font = require("../../utils/font");
const tabbar = require("../../utils/tabbar");
const icons = require("../../utils/icons");
const trail = require("../../utils/trail");
const guard = require("../../utils/guard");

const FILTERS = [
  { key: "全部", label: "全部" },
  { key: "未读", label: "未读" }
];

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    bookId: "",
    bookName: "",
    unit: "篇",

    sortLabel: "按原书次序",
    keyword: "",
    filter: "全部",
    filters: FILTERS,
    groups: [],
    total: 0,
    matched: 0,
    groupCount: 0,
    collapsed: false,

    pickId: "",
    locked: true,
    icons: { search: icons.search, playlist: icons.playlist }
  },

  onLoad(query) {
    this.setData({ bookId: (query && query.book) || "poems" });
  },

  resetFilters() {
    this.forgetMatch();
    this.setData({ keyword: "", filter: "全部" });
  },

  onShow() {
    this.applyFont();
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });

    if (this.data.bookId !== this.shownBook) this.resetFilters();
    this.shownBook = this.data.bookId;

    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });

    const book = corpus.bookById(this.data.bookId) || { name: "课内阅读", unit: "首" };
    this.setData({ bookName: book.name, unit: book.unit });
    wx.setNavigationBarTitle({ title: book.name });
    this.apply();
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
    font.registerHere().catch(() => {});
  },

  apply() {
    const { bookId, keyword, filter } = this.data;
    const book = corpus.bookById(bookId);
    const cataloged = !!(book && book.remote);
    const all = cataloged ? this.catalogRows(bookId) : corpus.ofBook(bookId);
    const at = !cataloged && keyword ? this.matched(bookId, keyword) : null;

    const reads = store.reads(bookId);
    const picked = this.pickedMap();
    const inMatch = {};
    (at || []).forEach((i) => { inMatch[i] = true; });
    const order = [];
    const map = {};
    let seq = 0;
    let matched = 0;

    all.forEach((p, i) => {
      if (at && !inMatch[i]) return;
      if (filter === "未读" && reads[p.id]) return;
      matched += 1;
      const g = p.g || "";
      if (!map[g]) {
        map[g] = [];
        order.push(g);
      }
      seq += 1;
      map[g].push(this.rowOf(p, seq, reads, picked));
    });

    const groups = order.map((g) => ({ group: g, items: map[g] }));
    cataloged && groups.forEach((g) => g.items.forEach((p, i) => { p.seq = i + 1; }));

    this.setData({
      groups,
      matched,
      total: all.length,
      groupCount: groups.length
    });
  },

  rowOf(p, seq, reads, picked) {
    return {
      id: p.id,
      title: p.t,
      inCourse: !!p.inCourse,
      author: p.a,
      dynasty: p.d,
      seq: seq,
      read: !!reads[p.id],
      picked: !!picked[p.id]
    };
  },

  catalogRows(bookId) {
    const keyword = this.data.keyword.trim().toLowerCase();
    const all = corpus.ofBook(bookId);
    return keyword ? all.filter((p) => corpus.matchEntry(p, keyword)) : all;
  },

  matched(bookId, keyword) {
    const key = bookId + "\u0000" + keyword;
    if (this.matchKey === key) return this.matchAt;
    this.matchKey = key;
    this.matchAt = corpus.searchAt(bookId, keyword).at;
    return this.matchAt;
  },

  forgetMatch() {
    this.matchKey = "";
    this.matchAt = null;
  },

  onSearch(e) {
    this.forgetMatch();
    this.setData({ keyword: e.detail.value }, () => this.apply());
  },

  onFilter(e) {
    this.setData({ filter: e.detail.value }, () => this.apply());
  },


  onTierGate() {
    entitlement.openPricing();
  },

  pickedMap() {
    const map = {};
    cols.list().forEach((c) => {
      cols.idsOf(c).forEach((pid) => { map[pid] = true; });
    });
    return map;
  },

  onPick(e) {
    if (!entitlement.block("collections", { page: this, loginPrompt: true })) return;
    if (guard.gap("list:pick")) return;
    guard.mark("list:pick");
    const box = this.selectComponent("#collect");
    if (box) box.ask(e.currentTarget.dataset.id, e.currentTarget.dataset.title || "");
  },

  onCollectDone(e) {
    const d = (e && e.detail) || {};
    if (!d.id) return;
    sync.markDirty();
    this.apply();
    wx.showToast({ title: "已加入「" + d.name + "」", icon: "none" });
  },

  onOpen(e) {
    trail.set(this.data.groups.reduce((ids, g) => ids.concat(g.items.map((p) => p.id)), []));
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) + "&mode=browse" });
  },

  onJump(e) {
    const id = e.currentTarget.dataset.g;
    this.setData({ collapsed: true });
    wx.pageScrollTo({ selector: "#g-" + id, duration: 200 });
  },

  onToggleIndex() {
    this.setData({ collapsed: !this.data.collapsed });
  },

  onShareAppMessage() {
    return { title: this.data.bookName, path: "/pages/list/list?book=" + this.data.bookId };
  }
});
