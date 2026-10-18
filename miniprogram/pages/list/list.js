const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");
const cols = require("../../utils/collections");
const sync = require("../../utils/sync");
const theme = require("../../utils/theme");
const tabbar = require("../../utils/tabbar");
const tabPage = require("../../utils/tab-page");
const icons = require("../../utils/icons");

const FILTERS = [
  { key: "全部", label: "全部" },
  { key: "未读", label: "未读" }
];

Page({
  data: {
    themeStyle: "",
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

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });

    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });

    const book = corpus.bookById(this.data.bookId) || { name: "课内诗词", unit: "首" };
    this.setData({ bookName: book.name, unit: book.unit });
    wx.setNavigationBarTitle({ title: "跬步 · 课外阅读 · " + book.name });
    this.apply();
  },

  apply() {
    const { bookId, keyword, filter } = this.data;
    let list = corpus.ofBook(bookId);

    if (keyword) list = corpus.search(keyword, { book: bookId, limit: 2000 }).items;

    const reads = store.reads(bookId);
    if (filter === "未读") list = list.filter((p) => !reads[p.id]);

    const picked = this.pickedMap();
    const groups = corpus.grouped(list);
    let index = 0;
    groups.forEach((g) => {
      g.items = g.items.map((p) => {
        index += 1;
        return {
          id: p.id,
          title: p.t,
          author: p.a,
          dynasty: p.d,
          seq: index,
          read: !!reads[p.id],
          picked: !!picked[p.id]
        };
      });
    });

    this.setData({
      groups,
      matched: list.length,
      total: corpus.ofBook(bookId).length,

      groupCount: groups.length
    });
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value }, () => this.apply());
  },

  onFilter(e) {
    this.setData({ filter: e.detail.value }, () => this.apply());
  },

  onLogin() {
    tabPage.mine();
  },

  pickedMap() {
    const map = {};
    cols.list().forEach((c) => {
      cols.idsOf(c).forEach((pid) => { map[pid] = true; });
    });
    return map;
  },

  onPick(e) {
    if (!entitlement.block("collections", { page: this })) return;
    const id = e.currentTarget.dataset.id;
    const list = cols.list();
    if (!list.length) {
      wx.showModal({
        title: "还没有自选集合",
        content: "先去「我的 → 自选背诵」建一个集合。",
        confirmText: "创建",
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
      itemList: list.map((c) => cols.nameOf(c)),
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
        : "加不进去";
      wx.showToast({ title: msg, icon: "none" });
      return;
    }
    sync.markDirty();
    wx.showToast({ title: inside ? "已移出「" + cols.nameOf(c) + "」" : "已加入「" + cols.nameOf(c) + "」", icon: "none" });
    this.apply();
  },

  onOpen(e) {
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
    return { title: "跬步 · " + this.data.bookName, path: "/pages/list/list?book=" + this.data.bookId };
  }
});
