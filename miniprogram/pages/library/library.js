const corpus = require("../../utils/corpus");
const store = require("../../utils/store");

/** 网页版把十七部集子压成四张卡，这里沿用同一套分组口径 */
const GROUPS = [
  {
    key: "course",
    name: "课内诗词",
    desc: "一至高三 · 按年级分册",
    books: ["poems"]
  },
  {
    key: "texts",
    name: "诗文典籍",
    desc: "古文 / 乐府 / 唐诗 / 词 / 曲 / 文选",
    books: ["classic", "guwen", "yuefu", "tangshi", "gushi", "songci", "yuanqu", "jinxiandai", "zhaoming"]
  },
  {
    key: "people",
    name: "人物",
    desc: "帝王 · 历代名家",
    books: ["dwang", "dwang-waiguo", "mingren", "mingren-waiguo"]
  },
  {
    key: "common",
    name: "文史常识",
    desc: "成语 / 文学常识 / 名著导读",
    books: ["chengyu", "changshi", "mingshu"]
  }
];

Page({
  data: {
    groups: [],
    current: null,
    books: []
  },

  onShow() {
    const all = corpus.books();
    const byId = {};
    all.forEach((b) => {
      byId[b.id] = b;
    });

    const groups = GROUPS.map((g) => {
      const books = g.books.map((id) => byId[id]).filter(Boolean);
      return Object.assign({}, g, {
        books: books.map((b) => ({
          id: b.id,
          name: b.name,
          unit: b.unit,
          count: corpus.ofBook(b.id).length
        })),
        count: books.length
      });
    }).filter((g) => g.books.length);

    this.setData({ groups, current: null });
  },

  onOpenGroup(e) {
    this.setData({ current: e.currentTarget.dataset.k });
  },

  onBack() {
    this.setData({ current: null });
  },

  onOpenBook(e) {
    wx.navigateTo({ url: "/pages/list/list?book=" + e.currentTarget.dataset.b });
  },

  onShareAppMessage() {
    return { title: "跬步 · 课外阅读", path: "/pages/library/library" };
  }
});
