const corpus = require("../../../utils/corpus");
const store = require("../../../utils/store");
const AI = require("../../../utils/author-index");
const gate = require("../../../utils/gate");
const entitlement = require("../../../utils/entitlement");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const icons = require("../../../utils/icons");
const source = require("../../../utils/poem-source");
const guard = require("../../../utils/guard");

const SUGGEST_MAX = 12;
const REMOTE_WAIT = 600;
const REMOTE_PAGE = 50;
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

    keyword: "",
    suggests: [],
    loading: false,

    icons: { search: icons.search, clear: icons.clear },

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
    if (this.data.author) this.showAuthor(this.data.author);
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
    const readIds = this.readIds();
    const r = AI.build(this.allEntries(), { readIds: readIds });
    const sections = r.eras.map((e) => ({
      at: e.at,
      name: e.name,
      count: e.count,
      works: e.works,

      people: e.people.map((w) => ({ name: w.name, count: w.count, dynasty: w.dynasty || "" }))
    }));

    this.roster = r;

    this.setData({
      eras: r.eras.map((e) => ({ at: e.at, name: e.name, count: e.count, works: e.works })),
      sections: sections,
      totalPeople: r.total,
      totalWorks: r.eras.reduce((n, e) => n + e.works, 0),
      unread: r.unread
    });
    if (this.data.keyword) this.suggest(this.data.keyword);
  },

  onInput(e) {
    const kw = String(e.detail.value || "");
    this.setData({ keyword: kw }, () => this.suggest(kw));
  },

  onClear() {
    this.tick = (this.tick || 0) + 1;
    clearTimeout(this.timer);
    this.setData({ keyword: "", suggests: [], remoteNote: "" });
  },

  suggest(raw) {
    const kw = raw.trim();
    this.tick = (this.tick || 0) + 1;
    if (!kw) {
      clearTimeout(this.timer);
      this.setData({ suggests: [], remoteNote: "" });
      return;
    }
    this.setData({ suggests: AI.query(this.roster, kw).slice(0, SUGGEST_MAX), remoteNote: "" });
    this.remoteSuggest(kw);
  },

  remoteSuggest(kw) {
    if (!entitlement.can("search") || !source.usable()) return;
    const tick = this.tick;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (tick !== this.tick) return;
      source.search(kw, { type: "author", page: 1, size: REMOTE_PAGE }).then((r) => {
        if (tick !== this.tick) return;
        this.fillRemote(kw, r.items);
      }, () => {});
    }, REMOTE_WAIT);
  },

  fillRemote(kw, poems) {
    const seen = {};
    const local = this.data.suggests || [];
    local.forEach((s) => { seen[s.name] = 1; });
    const rows = [];
    (poems || []).forEach((p) => {
      const a = (p && p.author) || {};
      const name = String(a.name || "").trim();
      if (!name || seen[name]) return;
      if (local.length + rows.length >= SUGGEST_MAX) return;
      seen[name] = 1;
      const dynasty = String((p.dynasty && p.dynasty.name) || "");
      rows.push({
        name: name,
        at: AI.eraOf(dynasty),
        era: AI.eraName(dynasty),
        sid: a.id === undefined ? "" : String(a.id),
        count: 0,
        marked: false,
        external: false
      });
    });
    const note = rows.length ? "课外库里还有 " + rows.length + " 位，点一位看他的作品" : "";
    this.setData({ suggests: local.concat(rows), remoteNote: note });
  },

  onSuggest(e) {
    const name = e.currentTarget.dataset.name;
    const at = Number(e.currentTarget.dataset.at);
    const row = (this.data.suggests || []).filter((s) => s.name === name)[0];
    if (row && row.marked) {
      this.openAuthor(name);
      return;
    }
    if (row && row.sid) {
      this.openRemote({ name: name, at: row.at, sid: row.sid });
      return;
    }
    if (this.openAuthor(name)) return;
    this.openRemote({ name: name, at: row ? row.at : 0, sid: "" });
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
    if (!w) return false;
    this.showAuthor(name);
    return true;
  },

  showAuthor(name) {
    const w = this.roster && this.roster.people[name];
    if (!w) return;
    this.current = w;
    if (w.external) {
      this.openRemote(w);
      return;
    }
    if (this.data.author !== name) this.setData({ author: name, filter: "全部" });
    wx.setNavigationBarTitle({ title: "作者索引 · " + name });
    this.askSource();
  },

  openRemote(w) {
    if (!w || !w.name) return;
    if (this.current !== w) this.sourceRows = null;
    this.current = w;
    this.setData({ author: w.name, filter: "全部", keyword: "", suggests: [], remoteNote: "" });
    wx.setNavigationBarTitle({ title: "作者索引 · " + w.name });
    if (this.askSource()) return;
    this.applyWorks();
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
    if (!w || !source.usable()) {
      if (w) this.setData({ remote: false, remoteMore: false, remoteNote: "" });
      return null;
    }
    const token = (this.srcToken || 0) + 1;
    this.srcToken = token;
    if (!this.sourceRows && w.external) this.setData({ loading: true });
    return source.poems({ author: (w.external && w.sid) || name, page_size: source.PAGE_MAX }).then((r) => {
      if (token !== this.srcToken) return;
      const rows = r.items.map((p) => source.asWork(p));
      this.sourceRows = (w.external ? [] : w.items).concat(rows);
      this.setData({
        remote: true,
        loading: false,
        remoteTotal: r.total,
        remoteNote: r.total > rows.length && !want
          ? "课外库共 " + r.total + " 首，先看 " + rows.length + " 首"
          : ""
      });
      this.applyWorks(want || this.sourceRows.length);
    }, () => {
      if (token !== this.srcToken) return;
      this.setData({ remote: false, remoteMore: false, loading: false, remoteNote: "" });
      this.applyWorks();
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
      remoteMore: !!this.sourceRows && list.length > limit,
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
    if (guard.gap("authors:open")) return;
    guard.mark("authors:open");
    const id = e.currentTarget.dataset.id;
    const url = "/pages/reader/reader?id=" + encodeURIComponent(id) +
      "&mode=browse&from=" + encodeURIComponent(this.data.author) +
      (e.currentTarget.dataset.src ? "&src=1" : "");
    wx.navigateTo({ url: url });
  },

  onBack() {
    this.current = null;
    this.sourceRows = null;
    this.srcToken = (this.srcToken || 0) + 1;
    this.setData({
      author: "", filter: "全部", works: [], matched: 0, unread: 0,
      remote: false, remoteMore: false, remoteTotal: 0, remoteNote: "", loading: false
    });
    wx.setNavigationBarTitle({ title: "作者索引" });
  },

  onReachBottom() {
    if (!this.data.remoteMore) return;
    this.onMoreFromSource();
  },

  onShareAppMessage() {
    return { title: "作者索引", path: "/packages/authors/index/index" };
  }
});
