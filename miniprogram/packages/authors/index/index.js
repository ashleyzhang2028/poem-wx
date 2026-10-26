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
const directory = require("../../../utils/author-directory");

const SUGGEST_MAX = 12;
const REMOTE_WAIT = 600;
const REMOTE_PAGE = 50;
const REMOTE_PAGES = 3;
const REMOTE_MAX = 200;

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

    remoteMore: false,
    remoteNote: "",
    moreNote: ""
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
    if (this.data.author) this.applyWorks();
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
    if (this.data.keyword) this.suggest(this.data.keyword);
  },

  onUnload() {
    this.tick = (this.tick || 0) + 1;
    clearTimeout(this.timer);
    if (this.onDirectory) directory.release(this.onDirectory);
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
    this.searched = [];
    this.watchDirectory(kw, tick);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (tick !== this.tick) return;
      this.pullAuthors(kw, 1, [], tick);
    }, REMOTE_WAIT);
  },

  watchDirectory(kw, tick) {
    if (this.onDirectory) directory.release(this.onDirectory);
    this.onDirectory = () => {
      if (tick !== this.tick) return;
      this.fillRemote(kw, this.searched || []);
    };
    directory.ensure(this.onDirectory);
    if (directory.find(kw).length) this.onDirectory();
  },

  pullAuthors(kw, page, poems, tick) {
    source.search(kw, { type: "author", page: page, size: REMOTE_PAGE }).then((r) => {
      if (tick !== this.tick) return;
      const all = poems.concat(r.items);
      this.searched = all;
      const enough = this.remoteAuthors(kw, all).length >= REMOTE_MAX;
      if (r.more && !enough && page < REMOTE_PAGES) return this.pullAuthors(kw, page + 1, all, tick);
      this.fillRemote(kw, all);
    }, () => {
      if (tick === this.tick && poems.length) this.fillRemote(kw, poems);
    });
  },

  remoteAuthors(kw, poems) {
    const seen = {};
    const rows = [];
    (poems || []).forEach((p) => {
      const a = (p && p.author) || {};
      const name = String(a.name || "").trim();
      if (!name) return;
      if (name.indexOf(kw) < 0) return;
      if (seen[name]) return;
      seen[name] = 1;
      rows.push({ name: name, dynasty: String((p.dynasty && p.dynasty.name) || ""), id: a.id });
    });
    return rows;
  },

  fillRemote(kw, poems) {
    const seen = {};
    const local = AI.query(this.roster, kw).slice(0, SUGGEST_MAX);
    local.forEach((s) => { seen[s.name] = 1; });
    const rows = [];
    directory.find(kw).concat(this.remoteAuthors(kw, poems)).forEach((a) => {
      const name = a.name;
      if (seen[name]) return;
      if (rows.length >= REMOTE_MAX) return;
      seen[name] = 1;
      const dynasty = a.dynasty;
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
    const filling = directory.complete() ? "" : "，名册还在补全";
    const note = rows.length ? "课外阅读里还有 " + rows.length + " 位（带「课外阅读」标记的行），点一位看他的作品" + filling : "";
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
    this.enter(w);
    return true;
  },

  openRemote(w) {
    if (!w || !w.name) return;
    this.enter(w);
  },

  personOf(name) {
    const listed = this.roster && this.roster.people[name];
    if (listed) return listed;
    return this.current && this.current.name === name ? this.current : null;
  },

  enter(w) {
    this.current = w;
    this.srcToken = (this.srcToken || 0) + 1;
    this.remote = { page: 0, more: false, failed: false, busy: false, total: 0, rows: [] };
    this.setData({ author: w.name, filter: "全部", keyword: "", suggests: [], remoteNote: "", moreNote: "" });
    wx.setNavigationBarTitle({ title: "作者索引 · " + w.name });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    this.applyWorks();
    this.pullWorks();
  },

  onFilter(e) {
    this.setData({ filter: e.detail.value }, () => this.applyWorks());
  },

  onMoreFromSource() {
    this.pullWorks();
  },

  pullWorks() {
    const w = this.personOf(this.data.author);
    const rem = this.remote;
    if (!w || !rem || rem.busy || !source.usable()) return;
    if (rem.page > 0 && !rem.more && !rem.failed) return;
    const token = this.srcToken;
    const page = rem.page + 1;
    const who = w.sid ? { author_id: w.sid } : { author: w.name };
    rem.busy = true;
    rem.failed = false;
    this.setData({ loading: true, moreNote: "" });
    source.poems(Object.assign({ page: page, page_size: source.PAGE_MAX }, who)).then((r) => {
      if (token !== this.srcToken) return;
      rem.busy = false;
      rem.page = page;
      rem.more = r.more;
      rem.total = r.total;
      rem.rows = rem.rows.concat(r.items.map((p) => source.asWork(p)));
      this.setData({ loading: false });
      this.applyWorks();
    }, (err) => {
      if (token !== this.srcToken) return;
      rem.busy = false;
      rem.failed = !(err && err.statusCode === 404);
      this.setData({ loading: false });
      this.applyWorks();
    });
  },

  applyWorks() {
    const w = this.personOf(this.data.author);
    if (!w) return;
    const rem = this.remote || { rows: [], more: false, failed: false, total: 0 };

    const local = w.items || [];
    const have = {};
    local.forEach((p) => { have[p.t] = 1; });
    const rows = local.concat(rem.rows.filter((p) => !have[p.t]));

    const readIds = this.readIds();
    const filter = this.data.filter;
    const list = rows.filter((p) => filter !== "未读" || !readIds[p.id]);

    let moreNote = "";
    if (rem.failed) moreNote = "课外阅读没取到，点一下重试";
    else if (rem.more) moreNote = "课外阅读共 " + rem.total + " 首，已取 " + rem.rows.length + " 首，往下拉接着取";

    this.setData({
      works: list.map((p) => ({
        id: p.id,
        title: p.t,
        dynasty: p.d,
        bookName: p.n,
        sub: p.b === "source" ? p.d : p.d + " · " + p.n,
        source: p.b === "source",
        read: !!readIds[p.id]
      })),
      remoteMore: !!rem.more,
      moreNote: moreNote,
      matched: list.length,
      unread: rows.filter((p) => !readIds[p.id]).length
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
    const ds = e.currentTarget.dataset;
    const url = "/pages/reader/reader?id=" + encodeURIComponent(ds.id) +
      "&mode=browse&from=" + encodeURIComponent(this.data.author) +
      (ds.src ? "&src=1" : "");
    wx.navigateTo({ url: url });
  },

  onBack() {
    this.current = null;
    this.remote = null;
    this.srcToken = (this.srcToken || 0) + 1;
    this.setData({
      author: "", filter: "全部", works: [], matched: 0, unread: 0,
      remoteMore: false, remoteNote: "", moreNote: "", loading: false
    }, () => wx.pageScrollTo({ scrollTop: this.rosterTop || 0, duration: 0 }));
    wx.setNavigationBarTitle({ title: "作者索引" });
  },

  onPageScroll(e) {
    if (!this.data.author) this.rosterTop = e.scrollTop;
  },

  onReachBottom() {
    if (!this.data.author || !this.data.remoteMore) return;
    this.pullWorks();
  },

  onShareAppMessage() {
    return { title: "作者索引", path: "/packages/authors/index/index" };
  }
});
