const corpus = require("../../utils/corpus");
const gate = require("../../utils/gate");
const E = require("../../utils/entitlement");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");
const tabPage = require("../../utils/tab-page");

const GROUPS = [
  {
    key: "course",
    name: "课内诗词",
    note: "一至高三 · 按年级分册",
    books: ["poems"]
  },
  {
    key: "texts",
    name: "诗文典籍",
    books: ["classic", "guwen", "yuefu", "tangshi", "gushi", "songci", "yuanqu", "jinxiandai", "zhaoming"]
  },
  {
    key: "people",
    name: "人物",
    books: ["dwang", "dwang-waiguo", "mingren", "mingren-waiguo"]
  },
  {
    key: "common",
    name: "文史常识",
    books: ["chengyu", "changshi", "mingshu"]
  }
];

function groupDesc(g, books) {
  if (g.note) return g.note;
  return books.map((b) => String(b.name).replace(/[「」]/g, "")).join(" / ");
}

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    groups: [],
    locked: true,
    reason: ""
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: !!tabbar.sync(this, 1) });

    if (!gate.logged() || !E.can("library")) {
      this.setData({ locked: true, reason: E.hint("library") });
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
      return {
        key: g.key,
        name: g.name,
        desc: groupDesc(g, books),
        books: books.map((b) => ({
          id: b.id,
          name: b.name,
          unit: b.unit,
          count: corpus.ofBook(b.id).length
        })),
        count: books.length
      };
    }).filter((g) => g.books.length);

    this.setData({ groups });
  },

  onLoginGate() {
    tabPage.mine();
  },

  onLogin() {
    tabPage.mine();
  },

  onTierGate() {
    E.openTierPage();
  },

  onOpenBook(e) {
    if (!E.block("library", { page: this })) return;
    wx.navigateTo({ url: "/pages/list/list?book=" + e.currentTarget.dataset.b });
  },

  onShareAppMessage() {
    return { title: "课外阅读", path: "/pages/library/library" };
  }
});
