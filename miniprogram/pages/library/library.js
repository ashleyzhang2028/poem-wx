const corpus = require("../../utils/corpus");
const gate = require("../../utils/gate");
const E = require("../../utils/entitlement");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");
const font = require("../../utils/font");

const GROUPS = [
  {
    key: "course",
    name: "课内阅读",
    note: "一至高三 · 按年级分册",
    books: ["poems"]
  },
  {
    key: "classics",
    name: "诗词漫读",
    note: "诗经、楚辞、唐诗、宋词、古文与四大名著",
    catalog: true
  }
];

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    groups: [],
    locked: true,
    reason: ""
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
    font.registerHere().catch(() => {});
  },

  onShow() {
    this.applyFont();
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
        desc: g.note || "",
        wide: !g.catalog,
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
    return { title: "课内阅读与诗词漫读", path: "/pages/library/library" };
  }
});
