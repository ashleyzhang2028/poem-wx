const corpus = require("../../../utils/corpus");
const store = require("../../../utils/store");
const AI = require("../../../utils/author-index");
const gate = require("../../../utils/gate");
const entitlement = require("../../../utils/entitlement");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const icons = require("../../../utils/icons");
const source = require("../../../utils/poem-source");

const BATCH = 20;

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    locked: true,

    eras: [],

    sections: [],

    totalPeople: 0,
    totalWorks: 0,

    author: "",
    works: [],

    filter: "全部",
    filters: [
      { key: "全部", label: "全部", icon: icons.all },
      { key: "未读", label: "未读", icon: icons.off }
    ],
    matched: 0,
    unread: 0,

    remote: false,
    remoteMore: false,
    remoteTotal: 0,
    remoteNote: ""
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });

    if (!gate.logged() || !entitlement.can("search")) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });

    this.buildRoster();
    if (this.data.author) this.openAuthor(this.data.author);
  },


  allEntries() {
    const out = [];
    AI.LIT_BOOKS.forEach((b) => {
      corpus.ofBook(b).forEach((p) => out.push(p));
    });
    corpus.booksOf().forEach((b) => {
      if (!b.remote) return;
      corpus.ofBook(b.id).forEach((p) => out.push(p));
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
    wx.setNavigationBarTitle({ title: "作者索引 · " + name });
    this.sourceRows = null;
    this.srcToken = (this.srcToken || 0) + 1;
    if (!this.askSource()) this.applyWorks();
  },

  onFilter(e) {
    this.setData({ filter: e.detail.value }, () => this.applyWorks());
  },

  onMoreFromSource() {
    if (!this.data.remoteMore) return;
    this.askSource(this.data.works.length + BATCH);
  },

  askSource(want) {
    const name = this.data.author;
    if (!name) return null;
    const w = this.roster && this.roster.people[name];
    if (!w || !w.remote) {
      this.setData({ remote: false, remoteMore: false, remoteNote: "" });
      return null;
    }
    const token = (this.srcToken || 0) + 1;
    this.srcToken = token;
    this.setData({ remote: true });
    return source.poems({ author: name, page_size: source.PAGE_MAX }).then((r) => {
      if (token !== this.srcToken) return;
      const rows = r.items.map((p) => source.asWork(p));
      this.sourceRows = rows;
      this.setData({
        remoteTotal: r.total,
        remoteNote: r.total > rows.length ? "先看 " + rows.length + " 首，共 " + r.total + " 首" : ""
      });
      this.applyWorks(want || r.items.length);
    }, () => {
      if (token !== this.srcToken) return;
      this.setData({ remote: true, remoteMore: false, remoteNote: "课外库没连上，先显示包内的" });
    });
  },

  applyWorks(want) {
    const name = this.data.author;
    const w = this.roster && this.roster.people[name];
    if (!w) return;

    const readIds = this.readIds();
    const filter = this.data.filter;
    const rows = this.sourceRows || w.items;
    const list = rows.filter((p) => filter !== "未读" || !readIds[p.id]);
    const limit = want || list.length;

    this.setData({
      works: list.slice(0, limit).map((p) => ({
        id: p.id,
        title: p.t,
        dynasty: p.d,
        bookName: p.n,
        sub: p.b === "source" ? p.d : p.d + " · " + p.n,
        source: p.b === "source",
        read: !!readIds[p.id]
      })),
      remoteMore: this.data.remote && list.length > limit,
      matched: list.length,
      unread: w.unread
    });
  },

  readIds() {
    const readIds = {};
    AI.LIT_BOOKS.forEach((b) => {
      const m = store.reads(b);
      Object.keys(m).forEach((id) => { readIds[id] = 1; });
    });
    const remote = store.reads("source");
    Object.keys(remote).forEach((id) => { readIds[id] = 1; });
    return readIds;
  },

  onOpen(e) {
    const id = e.currentTarget.dataset.id;
    const url = "/pages/reader/reader?id=" + encodeURIComponent(id) +
      "&mode=browse&from=" + encodeURIComponent(this.data.author) +
      (e.currentTarget.dataset.src ? "&src=1" : "");
    wx.navigateTo({ url: url });
  },

  onShareAppMessage() {
    return { title: "作者索引", path: "/packages/authors/index/index" };
  }
});
