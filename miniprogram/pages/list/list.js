const corpus = require("../../utils/corpus");
const corpusGate = require("../../utils/corpus-gate");
const store = require("../../utils/store");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");
const cols = require("../../utils/collections");
const sync = require("../../utils/sync");
const theme = require("../../utils/theme");
const font = require("../../utils/font");
const tabbar = require("../../utils/tabbar");
const icons = require("../../utils/icons");
const guard = require("../../utils/guard");
const trail = require("../../utils/trail");
const marks = require("../../utils/bookmarks");
const lastRead = require("../../utils/last-read");

const PAGE_SIZE = 50;

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
    collId: "",
    collName: "",
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
    shown: 0,
    last: null,
    locked: true,
    corpusState: "",
    icons: { search: icons.search, playlist: icons.playlist }
  },

  onLoad(query) {
    const collId = String((query && query.coll) || "");
    this.setData({
      collId,
      bookId: collId ? "" : (query && query.book) || "poems"
    });
  },

  resetFilters() {
    this.forgetMatch();
    this.setData({ keyword: "", filter: "全部", shown: 0 });
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
    font.registerHere().catch(() => {});
  },

  onShow() {
    this.applyFont();
    this.setData({ barBelow: tabbar.below(this) });

    const shown = this.data.collId || this.data.bookId;
    if (shown !== this.shownBook) this.resetFilters();
    this.shownBook = shown;

    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });

    corpusGate.open(this, this.scopeOf(), () => this.showBook());
  },

  scopeOf() {
    if (this.data.collId) return "catalogs";
    return this.data.bookId === "poems" ? "core" : "catalogs";
  },

  onCorpusRetry() {
    corpusGate.open(this, this.scopeOf(), () => this.showBook());
  },

  onUnload() {
    corpusGate.close(this);
  },

  showBook() {
    const coll = this.data.collId ? cols.find(this.data.collId) : null;
    if (coll) {
      const name = cols.nameOf(coll);
      this.setData({ collName: name, bookName: name, unit: "首", last: null });
      wx.setNavigationBarTitle({ title: name });
      this.apply();
      return;
    }
    const book = corpus.bookById(this.data.bookId) || { name: "课内阅读", unit: "首" };
    this.setData({ bookName: book.name, unit: book.unit });
    wx.setNavigationBarTitle({ title: book.name });
    this.apply();
    const last = lastRead.get();
    this.setData({ last: last && last.b === this.data.bookId ? { title: last.t } : null });
  },

  onContinue() {
    const last = lastRead.get();
    if (last) wx.navigateTo({ url: marks.readerUrl(last) });
  },

  apply() {
    if (this.data.collId) {
      this.applyCollection();
      return;
    }
    const { bookId, keyword, filter } = this.data;
    const book = corpus.bookById(bookId);
    const cataloged = !!(book && book.remote);
    const all = cataloged ? this.catalogRows(bookId) : corpus.ofBook(bookId);
    const at = !cataloged && keyword ? this.matched(bookId, keyword) : null;

    const reads = store.reads(bookId);
    const picked = this.pickedMap();
    const inMatch = {};
    (at || []).forEach((i) => { inMatch[i] = true; });
    const kept = all.filter((p, i) => (!at || inMatch[i]) && !(filter === "未读" && reads[p.id]));

    const want = cataloged ? Math.max(this.data.shown, PAGE_SIZE) : kept.length;
    const limit = Math.min(kept.length, want);

    const order = [];
    const map = {};
    kept.slice(0, limit).forEach((p, i) => {
      const g = p.g || "";
      if (!map[g]) {
        map[g] = [];
        order.push(g);
      }
      map[g].push(this.rowOf(p, i + 1, reads, picked));
    });

    const groups = order.map((g) => ({ group: g, items: map[g] }));

    this.setData({
      groups,
      shown: limit,
      matched: kept.length,
      total: all.length,
      groupCount: groups.length
    });
  },

  applyCollection() {
    const keyword = this.data.keyword.trim().toLowerCase();
    const coll = cols.find(this.data.collId);
    const all = coll
      ? cols.idsOf(coll).map((id) => corpus.indexById(id)).filter(Boolean)
      : [];
    const kept = keyword ? all.filter((p) => corpus.matchEntry(p, keyword)) : all;
    const reads = this.readsAnywhere();
    const picked = this.pickedMap();
    const groups = kept.length
      ? [{ group: "", items: kept.map((p, i) => this.rowOf(p, i + 1, reads, picked)) }]
      : [];
    this.setData({
      groups,
      shown: kept.length,
      matched: kept.length,
      total: all.length,
      groupCount: groups.length
    });
  },

  readsAnywhere() {
    const seen = {};
    return (id) => {
      const book = corpus.bookOf(id) || "poems";
      if (!seen[book]) seen[book] = store.reads(book);
      return !!seen[book][id];
    };
  },

  onReachBottom() {
    if (this.data.shown >= this.data.matched) return;
    this.setData({ shown: this.data.shown + PAGE_SIZE }, () => this.apply());
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
    this.setData({ keyword: e.detail.value, shown: 0 }, () => this.apply());
  },

  onFilter(e) {
    this.setData({ filter: e.detail.value, shown: 0 }, () => this.apply());
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
    const id = e.currentTarget.dataset.id;
    trail.set(this.shownIds(id));
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(id) + "&mode=browse" });
  },

  shownIds(id) {
    const ids = this.data.groups.reduce((acc, g) => acc.concat(g.items.map((p) => p.id)), []);
    const at = ids.indexOf(id);
    return at < 0 ? [id] : ids.slice(at);
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
    if (this.data.collId) {
      return { title: this.data.collName, path: "/pages/library/library" };
    }
    return { title: this.data.bookName, path: "/pages/list/list?book=" + this.data.bookId };
  }
});
