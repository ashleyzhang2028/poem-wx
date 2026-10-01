const corpus = require("../../utils/corpus");
const store = require("../../utils/store");

const FILTERS = ["全部", "未读"];

Page({
  data: {
    bookId: "",
    bookName: "",
    unit: "篇",
    keyword: "",
    filter: "全部",
    filters: FILTERS,
    groups: [],
    total: 0,
    matched: 0,
    collapsed: false
  },

  onLoad(query) {
    const bookId = query.book || "poems";
    const book = corpus.bookById(bookId) || { name: "课内诗词", unit: "首" };
    this.setData({ bookId, bookName: book.name, unit: book.unit });
    wx.setNavigationBarTitle({ title: book.name });
    this.apply();
  },

  apply() {
    const { bookId, keyword, filter } = this.data;
    let list = corpus.ofBook(bookId);
    if (keyword) list = corpus.search(keyword, { book: bookId, limit: 2000 });

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
      total: corpus.ofBook(bookId).length
    });
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value }, () => this.apply());
  },

  onFilter(e) {
    this.setData({ filter: e.detail.value }, () => this.apply());
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
