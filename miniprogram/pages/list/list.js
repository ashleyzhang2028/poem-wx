const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const gate = require("../../utils/gate");

/* 筛选只有两个值，做成图标分段（样式见 app.wxss「分段控件」）——
   一排两个圆圈加两个字，在列表页顶上是白占一行。 */
const FILTERS = [
  { key: "全部", label: "全部", icon: "all-site" },
  { key: "未读", label: "未读", icon: "title" }
];

Page({
  data: {
    bookId: "",
    bookName: "",
    unit: "篇",
    // 页头那行小字说「按什么排的」—— 语料的原始次序（集子自己的顺序），
    // 不是字母序也不是热度，这件事得让人知道，否则会以为排错了
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
    // 2000 比任何一部集子都大（最大的昭明文选 480 篇），所以这里拿到的是全量，
    // search() 返回 { items, total } 之后要取 .items —— 直接遍历对象会静默得到空列表
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
      // 页头那行小字要报「几组」—— 分组数得等 apply 完才知道
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
