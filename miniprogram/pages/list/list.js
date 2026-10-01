const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const gate = require("../../utils/gate");

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
    collapsed: false,

    locked: true
  },

  onLoad(query) {
    this.setData({ bookId: query.book || "poems" });
  },

  /**
   * 门禁放在 onShow 而不是 onLoad：从「去登录」回来时 onLoad 不会再跑，
   * 页面就会卡在锁着的样子，用户以为登录没生效。
   */
  onShow() {
    // 未登录：连书目本身都不给看 —— 「课外十七部」是 free 档的 library 能力，
    // 不在首页那一屏里。首页那几行的目录才是唯一给未登录看的。
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
    this.setData({ filter: e.currentTarget.dataset.f }, () => this.apply());
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
