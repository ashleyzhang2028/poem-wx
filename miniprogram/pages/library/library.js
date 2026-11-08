const corpus = require("../../utils/corpus");
const corpusGate = require("../../utils/corpus-gate");
const gate = require("../../utils/gate");
const E = require("../../utils/entitlement");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");
const font = require("../../utils/font");
const cols = require("../../utils/collections");
const lastRead = require("../../utils/last-read");
const trail = require("../../utils/trail");
const audio = require("../../utils/poem-audio");

const SHEET = "#read-sheet";

const GROUPS = [
  {
    key: "course",
    name: "课内阅读",
    wide: true,
    bare: true,
    books: ["poems"]
  },
  {
    key: "mine",
    name: "我的自选",
    note: "自建的集合与其中的篇目",
    wide: true,
    books: []
  },
  {
    key: "anthology",
    name: "诗词选本",
    note: "唐诗、宋词、小古文与总集",
    books: ["tangshi300", "songci300", "xiaoguwen", "tongxin", "qianjiashi", "huajianji", "gushiyuan", "yuefuji", "cizong", "chuci", "gwgz", "wenxuan"]
  },
  {
    key: "primer",
    tri: true,
    name: "蒙学",
    note: "启蒙识字与童蒙读物",
    books: ["sanzijing", "baijiaxing", "dizigui", "qianziwen", "zengguang", "shenglv", "liweng", "youxue", "longwen", "jijiu", "lishi", "wuzijian"]
  },
  {
    key: "pre-qin",
    tri: true,
    name: "先秦经典",
    note: "四书、五经与诸子",
    books: ["lunyu", "mengzi", "daxue", "zhongyong", "shijing", "shangshu", "zhouyi", "zuozhuan", "daodejing", "sunzi", "sanshiliuji", "shanhaijing"]
  },
  {
    key: "fable",
    tri: true,
    name: "童话寓言",
    note: "中外童话与寓言",
    books: ["yisuo", "gelin", "andersen"]
  },
  {
    key: "history",
    tri: true,
    name: "史籍",
    note: "战国策、史记与三国志",
    books: ["zhanguoce", "shiji", "sanguozhi"]
  },
  {
    key: "novel",
    cap: "novels",
    name: "名著小说",
    note: "章回、话本与笔记",
    books: ["honglou", "sanguo", "shuihu", "xiyou", "rulin", "liaozhai", "dongzhou", "fengshen", "jinghua", "yushi", "jingshi", "xingshi", "chuke", "erke", "suitang", "shuoyue", "xiaolin", "xiaofu"]
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
    mineWide: false,
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

  onPullDownRefresh() {
    this.onOpenRead();
    wx.stopPullDownRefresh();
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
      ids: audio.matched(cols.idsOf(c)),
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
      const selfMade = g.key === "mine";
      return {
        key: g.key,
        name: g.name,
        desc: g.note || "",
        wide: !!g.wide,
        bare: !!g.bare,
        tri: !!g.tri,
        cap: g.cap || "",
        locked: !!g.cap && !E.can(g.cap),
        tier: g.cap ? E.tierOf(g.cap) : "",
        books: books.map((b) => ({
          id: b.id,
          name: b.name,
          unit: b.unit,
          count: b.count,
          ids: audio.bookIds(b.id)
        })),
        unit: selfMade ? "个" : "部",
        count: selfMade ? mine.length : books.length
      };
    }).filter((g) => g.key === "mine" || g.books.length);

    const last = lastRead.get();
    this.setData({
      groups,
      mineOn: E.can("collections"),
      mineTier: E.tierOf("collections"),
      mine,
      mineCount: mine.length,
      mineWide: mine.length === 1,
      last: last ? { id: last.id, title: last.t } : null
    });
  },

  onTierGate() {
    E.openPricing();
  },

  onOpenRead() {
    const sheet = this.selectComponent(SHEET);
    if (sheet) sheet.open();
  },

  onReadOpened() {
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  onOpenMine(e) {
    if (!E.block("collections", { page: this })) return;
    wx.navigateTo({ url: "/pages/list/list?coll=" + encodeURIComponent(e.currentTarget.dataset.c) });
  },

  onOpenBook(e) {
    if (!E.block("library", { page: this, loginPrompt: true })) return;
    const cap = e.currentTarget.dataset.cap;
    if (cap && !E.block(cap, { page: this, loginPrompt: true })) return;
    const bookId = e.currentTarget.dataset.b;
    const book = corpus.booksOf().filter((b) => b.id === bookId)[0];
    if (book && book.count === 1) {
      const id = bookId + "-1";
      trail.set([id]);
      wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(id) + "&mode=browse" });
      return;
    }
    wx.navigateTo({ url: "/pages/list/list?book=" + bookId });
  },

  onShareAppMessage() {
    return { title: "课内阅读与诗词漫读", path: "/pages/library/library" };
  }
});
