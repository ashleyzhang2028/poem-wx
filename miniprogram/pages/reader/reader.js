const corpus = require("../../utils/corpus");
const source = require("../../utils/poem-source");
const table = require("../../utils/table");
const AI = require("../../utils/author-index");
const store = require("../../utils/store");
const R = require("../../utils/review-models");
const pinyin = require("../../utils/pinyin");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");
const cols = require("../../utils/collections");
const marks = require("../../utils/bookmarks");
const lastRead = require("../../utils/last-read");
const theme = require("../../utils/theme");
const font = require("../../utils/font");
const tabbar = require("../../utils/tabbar");
const trail = require("../../utils/trail");
const icons = require("../../utils/icons");
const scale = require("../../utils/type-scale");
const gloss = require("../../utils/gloss");

const RESULTS = [
  { key: "bad", label: "忘记", cls: "bad" },
  { key: "fuzzy", label: "模糊", cls: "fuzzy" },
  { key: "good", label: "记住", cls: "good" }
];

const PAGE_ICONS = {
  left: icons.left, center: icons.center, lineUp: icons.lineUp, lineDown: icons.lineDown,
  add: icons.add, added: icons.added, zoomOut: icons.zoomOut, zoomIn: icons.zoomIn,
  playlist: icons.playlist, bookmark: icons.bookmark, off: icons.off, all: icons.all
};

function aliasTextOf(meta) {
  const raw = meta && meta.aka;
  if (!raw) return "";
  const list = (Array.isArray(raw) ? raw : [raw])
    .map((x) => String(x == null ? "" : x).trim())
    .filter((x) => x && x !== meta.t);
  const uniq = [];
  list.forEach((x) => { if (uniq.indexOf(x) < 0) uniq.push(x); });
  return uniq.length ? "又名：" + uniq.join("、") : "";
}

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    id: "",
    sid: "",

    loadingText: false,
    loadFailed: false,
    failText: "",
    bookId: "",
    title: "",
    author: "",
    dynasty: "",
    source: "",

    selection: "",

    aliasText: "",
    rawText: "",
    paras: [],
    verse: true,
    tokens: [],
    blocks: [],
    blocksOn: false,
    tableView: false,
    translation: "",
    translationSource: "",
    hasTranslation: false,
    showTranslation: false,
    glossRows: [],
    showGloss: false,
    align: "center",
    fontDown: false,
    fontUp: true,
    fontSize: 0,
    fontMin: scale.MIN,
    fontMax: scale.MAX,
    lineGap: scale.DEFAULT_GAP,
    lineDown: true,
    lineUp: true,
    pinyinMode: "off",
    pinyinOn: false,
    stage: "新学",
    mastery: 0,
    hint: "",
    results: RESULTS,

    reciteMode: false,

    dailyOn: false,
    dailyLocked: false,
    pickOn: false,
    markOn: false,
    extraTier: "pro",
    pickTier: "pro",
    icons: PAGE_ICONS,

    remote: false,

    locked: true,
    lockTitle: "诗词详情",
    lockNote: "登录后查看正文与进度",

    creator: "",
    pager: { show: false, prev: null, next: null }
  },

  onLoad(query) {
    this.setData({
      id: query.id || "",
      sid: query.sid ? decodeURIComponent(query.sid) : "",
      from: query.from || "",
      remote: query.src === "1",
      reciteMode: query.mode === "recite"
    });
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
    font.registerHere().catch(() => {});
  },

  onShow() {
    this.applyFont();
    this.setData({ barBelow: tabbar.below(this) });
    if (!this.data.reciteMode) {
      this.setData({ hint: "" });
    }
    if (!gate.logged()) {
      this.setData({ locked: true, loadingText: false });
      return;
    }

    if (this.data.locked) this.setData({ locked: false });
    if (!this.loaded) this.loadEntry();
    this.applyReading();

    this.syncDaily();
  },

  syncDaily() {
    const on = store.dailyExtra().indexOf(this.data.id) >= 0;
    const extraTier = entitlement.tierOf("extra");
    this.setData({
      dailyOn: on,
      extraTier: extraTier,
      dailyLocked: !entitlement.can("extra") && entitlement.reachable(extraTier, entitlement.status().tier),
      pickOn: cols.collectionsOf(this.data.id).length > 0,
      markOn: marks.has(this.data.id),
      pickTier: entitlement.tierOf("collections")
    });
  },

  onAddToCollection() {
    if (!entitlement.block("collections", { page: this, loginPrompt: true })) return;
    const box = this.selectComponent("#collect");
    if (box) box.ask(this.data.id, this.data.title || "");
  },

  onAuthor() {
    const name = this.data.author;
    if (!name || name === "佚名" || name === "无名氏") return;
    wx.navigateTo({ url: "/packages/authors/profile/profile?name=" + encodeURIComponent(name) });
  },

  onToggleMark() {
    if (!entitlement.block("bookmarks", { page: this, loginPrompt: true })) return;
    const d = this.data;
    const r = marks.toggle({ id: d.id, sid: d.sid, src: !!d.remote, t: d.title, a: d.author, n: d.source });
    if (r.ok) sync.markDirty();
    this.setData({ markOn: r.on });
    wx.showToast({
      title: r.on ? (r.dropped ? "已加书签，最早一枚已移出" : "已加书签") : "已移出书签",
      icon: "none"
    });
  },

  onCollectDone(e) {
    const d = (e && e.detail) || {};
    if (!d.id) return;
    sync.markDirty();
    this.syncDaily();
    wx.showToast({ title: "已加入「" + d.name + "」", icon: "none" });
  },

  onToggleDaily() {
    const r = store.toggleDailyExtra(this.data.id);
    if (r.code === "E_TIER") {
      entitlement.gateTier("extra", { page: this });
      return;
    }
    if (!r.ok) {
      wx.showToast({ title: this.dailyMsg(r), icon: "none" });
      return;
    }
    this.setData({ dailyOn: r.on });
    wx.showToast({ title: r.on ? "已加入新增温习" : "已移出新增温习", icon: "none" });
    sync.markDirty();
  },

  onTierGate() {
    entitlement.openPricing();
  },

  dailyMsg(r) {
    if (r.code === "E_LIMIT") return "今日新增上限 " + store.DAILY_EXTRA_MAX + " 首，请先完成温习";
    if (r.code === "E_STORAGE") return "添加失败：本机存储空间不足或未开启存储";
    return "添加失败";
  },

  loadEntry() {
    const id = this.data.id;
    const meta = this.findMeta(id);
    const onlySid = this.data.sid && !meta ? this.data.sid : "";

    const remoteId = /^\d+$/.test(String(id));
    if (!meta && !this.data.remote && !remoteId && !onlySid) {
      this.setData({ id, loadFailed: true, failText: "篇目数据缺失" });
      return;
    }

    const own = meta ? corpus.entry(id) : null;
    const twin = !own && meta && meta.sid ? corpus.courseTwin(meta) : null;
    const hit = own || (twin ? corpus.entry(twin.id) : null);
    if (hit && hit.text) {
      this.setData({ loadFailed: false, failText: "", loadingText: false, hasTranslation: !!hit.tr });
      return this.renderEntry(id, hit, meta);
    }

    if (meta && meta.sid) return this.loadRemote(meta.sid, meta, "未能获取正文，点击重试");
    if (onlySid) return this.loadRemote(onlySid, null, "未能获取正文，点击重试");

    if (meta && meta.b) {
      this.setData({ id, loadingText: false, loadFailed: true, failText: "本篇正文不在当前版本中", remote: false });
      return;
    }

    if (this.data.remote || remoteId) return this.loadRemote(id, null, "未能获取正文，点击重试");

    this.setData({ id, loadingText: false, loadFailed: true, failText: "本篇正文不在当前版本中", remote: false });
  },

  loadRemote(sid, meta, failText) {
    const token = (this.loadToken || 0) + 1;
    this.loadToken = token;
    this.setData({ id: this.data.id, loadingText: true, loadFailed: false, failText: "" });

    source.byId(sid, meta).then(
      (poem) => {
        if (token !== this.loadToken) return;
        const text = source.textOf(poem);
        if (!text) {
          this.setData({ loadingText: false, loadFailed: true, failText: "本篇正文为空" });
          return;
        }
        this.setData({ hasTranslation: false, remote: true, sid: String(sid) });
        this.renderEntry(this.data.id, { text: text, tr: "", src: "" }, meta || this.remoteMeta(poem, sid));
      },
      (err) => {
        console.error("[reader] 正文取失败 sid=" + sid, "HTTP " + ((err && err.statusCode) || 0), (err && err.message) || "");
        if (token !== this.loadToken) return;
        this.setData({ loadingText: false, loadFailed: true, failText: failText });
      }
    );
  },

  remoteMeta(poem, sid) {
    const m = source.metaOf(poem);
    return { id: m.id, sid: String(sid), t: m.t, a: m.a, d: m.d, b: "", n: source.NAME, s: "", g: "" };
  },

  onRetryText() {
    this.loadEntry();
  },

  renderEntry(id, entry, meta) {
    const settings = store.settings();
    if (!this.data.reciteMode) {
      lastRead.put({ id: id, sid: this.data.sid || meta.sid, src: !!this.data.remote, t: meta.t, a: meta.a, n: meta.n || meta.s, b: meta.b });
    }
    const size = scale.clamp(settings.fontSize);

    const rec = store.getRecord(id);

    this.resultAt = "";

    this.setData({
      id,
      rawText: entry.text,
      tableView: table.hasTable(entry.text),
      loadingText: false,
      remote: !!this.data.remote,
      bookId: meta.b || "",
      title: meta.t,
      author: meta.a,
      dynasty: meta.d,
      source: meta.s || meta.n || "",
      selection: meta.sel || "",
      aliasText: aliasTextOf(meta),
      translation: entry.tr || "",
      translationSource: entry.src || "",
      hasTranslation: !!entry.tr,
      glossRows: gloss.rows(entry.gloss),
      align: settings.align === "left" ? "left" : "center",
      fontSize: size,
      ...scale.flags(size),
      lineGap: scale.clampGap(settings.lineGap),
      ...scale.gapFlags(settings.lineGap),
      stage: R.stageName(rec, settings.algo) + " · 掌握 " + R.levelName(rec && rec.level),
      mastery: R.mastery(rec)
    });

    wx.setNavigationBarTitle({ title: meta.t });
    if (meta.b) store.markRead(meta.b, id);
    this.loaded = true;
    this.setData({ creator: this.data.from || "" });
    this.refreshPager();
    this.syncDaily();

    this.applyReading();
  },


  relayout() {
    const laid = corpus.layout(this.data.rawText, {
      size: this.data.fontSize,
      pinyin: this.data.pinyinOn
    });
    this.setData({ paras: laid.paras, verse: laid.verse });
  },

  paragraphRows(text) {
    if (!String(text == null ? "" : text).trim()) return [];
    return corpus.layout(text, { size: this.data.fontSize, pinyin: false }).paras;
  },

  renderBlocks() {
    const parsed = table.parseText(this.data.rawText);
    if (!parsed) return [];
    const out = [];
    parsed.parts.forEach((part, i) => {
      if (part.k === "table") {
        out.push({ k: "table", key: "t" + i, table: parsed.blocks[part.i] });
        return;
      }
      const rows = this.paragraphRows(part.s);
      if (!rows.length) return;
      out.push({ k: "p", key: "p" + i, rows: rows });
    });
    return out;
  },

  applyReading() {
    const usable = pinyin.readiness().usable && entitlement.can("pinyin");
    const mode = usable ? pinyin.getMode() : "off";
    const tableBlocks = usable && this.data.tableView;

    this.setData({
      pinyinOn: usable,
      pinyinMode: mode,
      blocksOn: tableBlocks,
      blocks: tableBlocks ? this.renderBlocks() : []
    });
    if (this.data.rawText) this.relayout();
    if (!tableBlocks) this.setData({ tokens: pinyin.render(this.data.paras, mode) });
  },

  onPinyinToggle() {
    const mode = this.data.pinyinMode === "all" ? "off" : "all";
    if (!pinyin.setMode(mode)) {
      wx.showToast({ title: "读音表尚未生成", icon: "none" });
      return;
    }
    this.setData({ pinyinMode: mode });
    this.applyReading();
  },

  findMeta(id) {
    return corpus.indexById(id);
  },

  onAlignToggle() {
    const align = this.data.align === "center" ? "left" : "center";
    this.setData({ align });
    store.saveSettings({ align });

    sync.markDirty();
  },

  onToggleTranslation() {
    this.setData({ showTranslation: !this.data.showTranslation });
  },

  onToggleGloss() {
    this.setData({ showGloss: !this.data.showGloss });
  },

  onLineDown() {
    this.stepGap(-1);
  },

  onLineUp() {
    this.stepGap(1);
  },

  stepGap(delta) {
    const lineGap = scale.clampGap(this.data.lineGap + delta);
    if (lineGap === this.data.lineGap) return;
    this.setData(Object.assign({ lineGap }, scale.gapFlags(lineGap)));
    store.saveSettings({ lineGap });
  },

  onFontDown() {
    this.stepFont(-1);
  },

  onFontUp() {
    this.stepFont(1);
  },

  stepFont(delta) {
    const fontSize = scale.clamp(this.data.fontSize + delta);
    if (fontSize === this.data.fontSize) return;
    this.setData(Object.assign({ fontSize }, scale.flags(fontSize)));
    store.saveSettings({ fontSize });
    if (this.data.rawText) this.applyReading();
    sync.markDirty();
  },

  onResult(e) {
    if (!this.data.reciteMode) return;
    if (this.data.hint || this.resultAt === this.data.id) return;

    if (!entitlement.can("daily")) {
      wx.showToast({ title: entitlement.hint("daily"), icon: "none" });
      return;
    }
    const result = e.detail.value;
    const settings = store.settings();
    const rec = R.review(store.getRecord(this.data.id), result, settings.algo);
    store.setRecord(this.data.id, rec);
    sync.markDirty();
    this.resultAt = this.data.id;

    this.setData({
      stage: R.stageName(rec, settings.algo) + " · 掌握 " + R.levelName(rec && rec.level),
      mastery: R.mastery(rec),
      hint: R.resultHint(settings.algo, result, rec)
    });

    wx.vibrateShort({ type: "light" });
    this.advance = setTimeout(() => this.goNext(), 700);
  },

  onUnload() {
    if (this.advance) clearTimeout(this.advance);
    this.loadToken = (this.loadToken || 0) + 1;
  },

  goNext() {
    if (this.data.creator) {
      this.goNextInAuthor();
      return;
    }
    const recs = store.reads(this.data.bookId);
    const list = corpus.ofBook(this.data.bookId);
    const idx = list.findIndex((p) => p.id === this.data.id);
    for (let i = idx + 1; i < list.length; i++) {
      if (!recs[list[i].id]) {
        wx.redirectTo({ url: this.readerUrl(list[i].id) });
        return;
      }
    }
    wx.navigateBack();
  },

  goNextInAuthor() {
    const next = this.siblingInAuthor(1);
    if (!next) {

      wx.navigateBack();
      return;
    }
    wx.redirectTo({
      url: this.readerUrl(next, this.data.creator)
    });
  },

  readerUrl(id, creator) {
    const sid = this.sidOf(id);
    let url = "/pages/reader/reader?id=" + encodeURIComponent(id);
    if (this.data.reciteMode) url += "&mode=recite";
    if (sid) url += "&sid=" + encodeURIComponent(sid);
    if (this.data.remote) url += "&src=1";
    if (creator) url += "&from=" + encodeURIComponent(creator);
    return url;
  },

  sidOf(id) {
    if (id === this.data.id && this.data.sid) return this.data.sid;
    const meta = corpus.indexById(id);
    return (meta && meta.sid) || "";
  },

  refreshPager() {
    const seq = this.data.creator ? this.authorIds() : null;
    this.setData({ pager: this.data.reciteMode ? { show: false } : trail.around(this.data.id, seq) });
  },

  onPage(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.redirectTo({ url: this.readerUrl(id, this.data.creator) });
  },

  authorIds() {
    const who = this.data.creator;
    if (!this.rosterCache) {
      const entries = [];
      AI.LIT_BOOKS.forEach((b) => {
        corpus.ofBook(b).forEach((p) => entries.push(p));
      });
      this.rosterCache = AI.build(entries);
    }
    return AI.worksOf(this.rosterCache, who);
  },

  siblingInAuthor(delta) {
    if (!this.data.creator) return "";
    const ids = this.authorIds();
    const idx = ids.indexOf(this.data.id);
    if (idx < 0) return "";
    const at = idx + delta;
    return at >= 0 && at < ids.length ? ids[at] : "";
  },

  onShareAppMessage() {
    return {
      title: this.data.title + " · " + this.data.author,
      path: "/pages/reader/reader?id=" + this.data.id +
        (this.data.sid ? "&sid=" + encodeURIComponent(this.data.sid) : "") +
        (this.data.remote ? "&src=1" : "")
    };
  }
});
