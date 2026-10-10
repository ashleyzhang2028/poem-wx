const corpus = require("../../../utils/corpus");
const store = require("../../../utils/store");
const AI = require("../../../utils/author-index");
const gate = require("../../../utils/gate");
const entitlement = require("../../../utils/entitlement");
const theme = require("../../../utils/theme");

Page({
  data: {
    themeStyle: "",
    locked: true,

    eras: [],

    sections: [],

    totalPeople: 0,
    totalWorks: 0,

    author: "",
    works: [],

    filter: "全部",
    filters: [
      { key: "全部", label: "全部", icon: "all-site" },
      { key: "未读", label: "未读", icon: "title" }
    ],
    matched: 0,
    unread: 0
  },

  onShow() {
    theme.apply(this);

    if (!gate.logged() || !entitlement.can("search")) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });

    this.buildRoster();
    if (this.data.author) this.openAuthor(this.data.author);
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  allEntries() {
    const out = [];
    AI.LIT_BOOKS.forEach((b) => {
      corpus.ofBook(b).forEach((p) => out.push(p));
    });
    return out;
  },

  buildRoster() {

    const readIds = {};
    const all = store.reads();
    Object.keys(all).forEach((b) => {
      Object.keys(all[b]).forEach((id) => { readIds[id] = 1; });
    });

    const r = AI.build(this.allEntries(), { readIds: readIds });
    const sections = r.eras.map((e) => ({
      at: e.at,
      name: e.name,
      count: e.count,
      works: e.works,

      people: e.people.map((w) => ({ name: w.name, count: w.count }))
    }));

    this.roster = r;

    this.setData({
      eras: r.eras.map((e) => ({ at: e.at, name: e.name, count: e.count, works: e.works })),
      sections: sections,
      totalPeople: r.total,
      totalWorks: r.eras.reduce((n, e) => n + e.works, 0),
      unread: r.unread
    });
  },

  onJump(e) {
    const at = e.currentTarget.dataset.at;
    wx.pageScrollTo({ selector: "#era-" + at, duration: 200 });
  },

  onAuthor(e) {
    this.openAuthor(e.currentTarget.dataset.name);
  },

  openAuthor(name) {
    const w = this.roster && this.roster.people[name];
    if (!w) return;

    if (this.data.author !== name) this.setData({ author: name, filter: "全部" });
    wx.setNavigationBarTitle({ title: name });
    this.applyWorks();
  },

  onFilter(e) {
    this.setData({ filter: e.detail.value }, () => this.applyWorks());
  },

  applyWorks() {
    const name = this.data.author;
    const w = this.roster && this.roster.people[name];
    if (!w) return;

    const readIds = {};
    AI.LIT_BOOKS.forEach((b) => {
      const m = store.reads(b);
      Object.keys(m).forEach((id) => { readIds[id] = 1; });
    });

    const filter = this.data.filter;
    const list = w.items.filter((p) => filter !== "未读" || !readIds[p.id]);

    this.setData({
      works: list.map((p) => ({
        id: p.id,
        title: p.t,
        dynasty: p.d,
        bookName: p.n,
        read: !!readIds[p.id]
      })),
      matched: list.length,
      unread: w.unread
    });
  },

  onBackRoster() {
    this.setData({ author: "", works: [] });
    wx.setNavigationBarTitle({ title: "作者索引" });

  },

  onOpen(e) {
    const id = e.currentTarget.dataset.id;
    const url = "/pages/reader/reader?id=" + encodeURIComponent(id) +
      "&from=" + encodeURIComponent(this.data.author);
    wx.navigateTo({ url: url });
  },

  onShareAppMessage() {
    return { title: "跬步 · 作者索引", path: "/packages/authors/index/index" };
  }
});
