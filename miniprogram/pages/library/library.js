const corpus = require("../../utils/corpus");
const corpusGate = require("../../utils/corpus-gate");
const gate = require("../../utils/gate");
const E = require("../../utils/entitlement");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");
const font = require("../../utils/font");
const marks = require("../../utils/bookmarks");
const cols = require("../../utils/collections");
const lastRead = require("../../utils/last-read");

const RECENT_MAX = 4;

const GROUPS = [
  {
    key: "mine",
    name: "我的自选",
    note: "自建的集合与其中的篇目",
    wide: true,
    books: []
  },
  {
    key: "course",
    name: "课内阅读",
    note: "一至高三 · 按年级分册",
    wide: true,
    books: ["poems"]
  },
  {
    key: "anthology",
    name: "诗词选本",
    note: "唐诗、宋词、古文与乐府",
    books: ["tangshi300", "songci300", "tongxin", "gwgz", "wenxuan", "yuefuji", "huajianji", "chuci"]
  },
  {
    key: "pre-qin",
    name: "先秦经典",
    note: "诗经、四书、诸子与左传",
    books: ["shijing", "sishu", "jingzhuan", "daodejing", "zhuangzi", "zhuzi", "zuozhuan", "bingfa", "shanhaijing"]
  },
  {
    key: "novel",
    name: "名著小说",
    note: "四大名著与章回、话本",
    books: ["sanguo", "shuihu", "xiyou", "honglou", "rulin", "jinghua", "fengshen", "dongzhou", "yushi", "jingshi", "erke", "liaozhai"]
  }
];

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    groups: [],
    mineOn: false,
    mineTier: "pro",
    mine: [],
    mineCount: 0,
    marks: [],
    markCount: 0,
    last: null,
    locked: true,
    reason: "",
    corpusState: ""
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
    corpusGate.open(this, "core", () => this.showShelves());
  },

  onCorpusRetry() {
    corpusGate.open(this, "core", () => this.showShelves());
  },

  onUnload() {
    corpusGate.close(this);
  },

  mineRows() {
    return cols.list().map((c) => ({
      id: c.id,
      name: cols.nameOf(c),
      count: c.items.length
    }));
  },

  showShelves() {
    const all = corpus.booksOf();
    const byId = {};
    all.forEach((b) => {
      byId[b.id] = b;
    });

    const mine = this.mineRows();
    const groups = GROUPS.map((g) => {
      const books = g.books.map((id) => byId[id]).filter(Boolean);
      return {
        key: g.key,
        name: g.name,
        desc: g.note || "",
        wide: !!g.wide,
        books: books.map((b) => ({
          id: b.id,
          name: b.name,
          unit: b.unit,
          count: b.count
        })),
        count: books.length
      };
    }).filter((g) => g.key === "mine" || g.books.length);

    const all2 = E.can("bookmarks") ? marks.list() : [];
    const last = lastRead.get();
    this.setData({
      groups,
      mineOn: E.can("collections"),
      mineTier: E.tierOf("collections"),
      mine,
      mineCount: mine.length,
      last: last ? { id: last.id, title: last.t, sub: [last.a, last.n].filter(Boolean).join(" · ") } : null,
      markCount: all2.length,
      marks: all2.slice(0, RECENT_MAX).map((b) => ({ id: b.id, title: b.t }))
    });
  },

  onTierGate() {
    E.openPricing();
  },

  onContinue() {
    const last = lastRead.get();
    if (last) wx.navigateTo({ url: marks.readerUrl(last) });
  },

  onOpenMark(e) {
    const hit = marks.list().filter((b) => b.id === e.currentTarget.dataset.id)[0];
    if (hit) wx.navigateTo({ url: marks.readerUrl(hit) });
  },

  onAllMarks() {
    wx.navigateTo({ url: "/packages/settings/bookmarks/bookmarks" });
  },

  onOpenMine(e) {
    if (!E.block("collections", { page: this })) return;
    wx.navigateTo({ url: "/pages/list/list?coll=" + encodeURIComponent(e.currentTarget.dataset.c) });
  },

  onOpenBook(e) {
    if (!E.block("library", { page: this, loginPrompt: true })) return;
    wx.navigateTo({ url: "/pages/list/list?book=" + e.currentTarget.dataset.b });
  },

  onShareAppMessage() {
    return { title: "课内阅读与诗词漫读", path: "/pages/library/library" };
  }
});
