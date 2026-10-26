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
    remoteNote: "",
    loading: false,
    more: false,

    icons: { search: icons.search, clear: icons.clear },

    author: "",
    works: [],

    filter: "全部",
    filters: [
      { key: "全部", label: "全部", icon: icons.all },
      { key: "未读", label: "未读", icon: icons.off }
    ],
    matched: 0,
    unread: 0
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
    if (this.data.keyword) this.suggest(this.data.keyword);
  },

  onInput(e) {
    const kw = String(e.detail.value || "");
    this.setData({ keyword: kw }, () => this.suggest(kw));
  },

  onClear() {
    this.tick += 1;
    this.setData({ keyword: "", suggests: [], remoteNote: "" });
  },

  suggest(raw) {
    const kw = raw.trim();
    this.tick = (this.tick || 0) + 1;
    if (!kw) {
      this.setData({ suggests: [], remoteNote: "" });
      return;
    }
    const parts = AI.query(this.roster, kw);
    this.setData({ suggests: parts.slice(0, SUGGEST_MAX), remoteNote: "" });
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
    (this.data.suggests || []).forEach((s) => { seen[s.name] = 1; });
    const rows = [];
    let more = false;
    (poems || []).forEach((p) => {
      const a = (p && p.author) || {};
      const name = String(a.name || "").trim();
      if (!name) return;
      if (!seen[name]) {
        if (rows.length + this.data.suggests.length >= SUGGEST_MAX) {
          more = true;
          return;
        }
        seen[name] = 1;
        rows.push({
          name: name,
          at: AI.eraOf((p.dynasty && p.dynasty.name) || ""),
          era: AI.eraName((p.dynasty && p.dynasty.name) || ""),
          sid: a.id === undefined ? "" : String(a.id),
          count: 0,
          marked: false,
          external: true
        });
      }
    });
    const note = rows.length || more ? "课外库里还有，点一位看他的全部作品" : "";
    this.setData({ suggests: this.data.suggests.concat(rows), remoteNote: note });
  },

  onSuggest(e) {
    const name = e.currentTarget.dataset.name;
    const at = Number(e.currentTarget.dataset.at);
    const row = (this.data.suggests || []).filter((s) => s.name === name)[0];
    if (row && row.marked) {
      this.openAuthor(name);
      return;
    }
    if (row && row.external) {
      this.openRemote({
        name: name,
        at: row.at,
        sid: row.sid,
        external: true,
        items: [],
        count: 0,
        unread: 0
      });
      return;
    }
    this.openAuthor(name);
    wx.pageScrollTo({ selector: "#era-" + (at || AI.TAIL), duration: 200 });
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
    this.showAuthor(name);
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
    this.applyWorks();
  },

  openRemote(w) {
    if (!w || !w.name) return;
    this.current = w;
    this.setData({ author: w.name, filter: "全部", keyword: "", suggests: [], remoteNote: "" });
    wx.setNavigationBarTitle({ title: "作者索引 · " + w.name });
    if (w.external) {
      this.setData({ works: [], matched: 0, unread: 0, more: false, loading: false });
      this.loadRemote(true);
      return;
    }
    this.applyWorks();
  },

  loadRemote(first) {
    const w = this.current;
    if (!w || !w.external || this.busy || this.data.loading) return;
    this.busy = true;
    if (source.usable()) {
      this.setData({ loading: true });
      const page = first ? 1 : (this.page || 1) + 1;
      w.sid = w.sid || w.name;
      source.poems({ author: w.sid, page: page, page_size: 100 }).then((r) => {
        if (this.current !== w) return;
        this.page = page;
        const rows = [];
        const seen = {};
        (this.data.works || []).forEach((x) => { seen[x.id] = 1; });
        (r.items || []).forEach((p) => {
          const row = source.asResult(p, "");
          if (seen[row.id]) return;
          seen[row.id] = 1;
          rows.push({
            id: row.id,
            title: row.title,
            dynasty: row.dynasty,
            bookName: row.bookName,
            read: false
          });
        });
        const works = first ? rows : (this.data.works || []).concat(rows);
        this.busy = false;
        this.setData({
          works: works,
          matched: Number(r.total) || works.length,
          loading: false,
          more: !!r.more && rows.length > 0
        });
      }, () => {
        this.busy = false;
        if (this.current !== w) return;
        this.setData({ loading: false, more: false });
      });
      return;
    }

    this.setData({ loading: true });
    source.authors(1, source.PAGE_MAX).then((r) => {
      if (this.current !== w) return;
      const row = (r.items || []).filter((a) => String(a.name || "") === w.name)[0];
      if (!row || row.id === undefined) {
        this.busy = false;
        this.setData({ loading: false, matched: 0, works: [], more: false, unread: 0 });
        return;
      }
      return source.poems({ author: row.id, page: 1, page_size: source.PAGE_MAX }).then((p) => {
        if (this.current !== w) return;
        this.busy = false;
        this.page = 1;
        this.setData({
          works: (p.items || []).map((x) => source.asResult(x, "")).map((x) => ({
            id: x.id, title: x.title, dynasty: x.dynasty, bookName: x.bookName, read: false
          })),
          matched: Number(p.total) || (p.items || []).length,
          loading: false,
          more: !!p.more
        });
      }, (err) => {
        this.busy = false;
        throw err;
      });
    }, () => {
      this.busy = false;
      if (this.current !== w) return;
      this.setData({ loading: false, more: false });
    });
  },

  onFilter(e) {
    this.setData({ filter: e.detail.value }, () => this.applyWorks());
  },

  applyWorks() {
    const w = this.current || (this.roster && this.roster.people[this.data.author]);
    if (!w || w.external) return;

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

  onOpen(e) {
    if (guard.gap("authors:open")) return;
    guard.mark("authors:open");
    const id = e.currentTarget.dataset.id;
    const url = "/pages/reader/reader?id=" + encodeURIComponent(id) +
      "&mode=browse&from=" + encodeURIComponent(this.data.author);
    wx.navigateTo({ url: url });
  },

  onBack() {
    this.current = null;
    this.setData({ author: "", filter: "全部", works: [], matched: 0, unread: 0, more: false });
    wx.setNavigationBarTitle({ title: "作者索引" });
  },

  onReachBottom() {
    const w = this.current;
    if (!w || !w.external || !this.data.more || this.data.loading) return;
    this.loadRemote(false);
  },

  onShareAppMessage() {
    return { title: "作者索引", path: "/packages/authors/index/index" };
  }
});
