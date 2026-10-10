const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");

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
    themeStyle: "",
    groups: [],
    current: null,
    books: [],
    locked: true,
    reason: ""
  },

  onShow() {
    theme.apply(this);

    tabbar.sync(this, 1);

    if (!gate.logged() || !entitlement.can("library")) {
      this.setData({ locked: true, reason: entitlement.hint("library") });
      return;
    }
    this.setData({ locked: false, reason: "" });
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

  onLoginGate() {
    wx.switchTab({ url: "/pages/mine/mine" });
  },

  onBack() {
    this.setData({ current: null });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onOpenBook(e) {
    if (!E.block("library.all", { page: this })) return;
    wx.navigateTo({ url: "/pages/list/list?book=" + e.currentTarget.dataset.b });
  },

  onShareAppMessage() {
    return { title: "跬步 · 课外阅读", path: "/pages/library/library" };
  }
});
