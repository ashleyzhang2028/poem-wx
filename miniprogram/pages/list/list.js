const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const gate = require("../../utils/gate");
const theme = require("../../utils/theme");

const FILTERS = [
  { key: "全部", label: "全部", icon: "all-site" },
  { key: "未读", label: "未读", icon: "title" }
];

Page({
  data: {
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

    locked: true
  },

  onLoad(query) {
    this.setData({ bookId: query.book || "poems" });
  },

  onShow() {
    theme.apply(this);

    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });

    const book = corpus.bookById(this.data.bookId) || { name: "课内诗词", unit: "首" };
    this.setData({ bookName: book.name, unit: book.unit });
    wx.setNavigationBarTitle({ title: book.name });
    this.apply();
  },

  apply() {
    const { bookId, keyword, filter } = this.data;
    let list = corpus.ofBook(bookId);

    if (keyword) list = corpus.search(keyword, { book: bookId, limit: 2000 }).items;

    const reads = store.reads(bookId);
    if (filter === "未读") list = list.filter((p) => !reads[p.id]);

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
          read: !!reads[p.id]
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
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onOpen(e) {
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
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
