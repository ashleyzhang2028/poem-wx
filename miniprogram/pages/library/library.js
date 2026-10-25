const corpus = require("../../utils/corpus");
const gate = require("../../utils/gate");
const E = require("../../utils/entitlement");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");

const GROUPS = [
  {
    key: "course",
    name: "课内诗词",
    note: "一至高三 · 按年级分册",
    books: ["poems"]
  },
  {
    key: "classics",
    name: "课外集子",
    note: "目录在包里 · 正文即时取",
    catalog: true
  }
];

function groupDesc(g) {
  return g.note || "";
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
    const all = corpus.booksOf();
    const byId = {};
    all.forEach((b) => {
      byId[b.id] = b;
    });

    const groups = GROUPS.map((g) => {
      const books = g.catalog
        ? all.filter((b) => b.remote)
        : g.books.map((id) => byId[id]).filter(Boolean);
      return {
        key: g.key,
        name: g.name,
        desc: groupDesc(g),
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

  onTierGate() {
    E.openPricing();
  },

  onOpenBook(e) {
    if (!E.block("library", { page: this, loginPrompt: true })) return;
    wx.navigateTo({ url: "/pages/list/list?book=" + e.currentTarget.dataset.b });
  },

  onShareAppMessage() {
    return { title: "课内诗词", path: "/pages/library/library" };
  }
});
