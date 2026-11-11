const corpus = require("../../utils/corpus");
const corpusOrigin = require("../../utils/corpus-origin");
const corpusGate = require("../../utils/corpus-gate");
const source = require("../../utils/poem-source");
const AI = require("../../utils/author-index");
const store = require("../../utils/store");
const R = require("../../utils/review-models");
const pinyin = require("../../utils/pinyin");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const auth = require("../../utils/auth");
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
const spot = require("../../utils/read-spot");
const readBg = require("../../utils/read-bg");
const audio = require("../../utils/poem-audio");
const audioGate = require("../../utils/audio-gate");

const FIRST_CHUNK = 24;

const CHUNK = 60;

const CHUNK_GAP = 60;

const SAVE_GAP = 400;

function seekOf(raw) {
  const m = String(raw == null ? "" : raw).match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const p = Number(m[1]);
  if (!(p > 0)) return null;
  return { p: p, y: Number(m[2]) || 0 };
}

const RESULTS = [
  { key: "bad", label: "忘记", cls: "bad" },
  { key: "fuzzy", label: "模糊", cls: "fuzzy" },
  { key: "good", label: "记住", cls: "good" }
];

const PAGE_ICONS = {
  left: icons.left, center: icons.center,
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
    bgStyle: "",
    bgId: "",
    bgList: readBg.LIST,
    name: "",
    barBelow: true,
    id: "",
    sid: "",

    loadingText: false,
    loadFailed: false,
    failText: "",
    bookId: "",
    title: "",
    titleMark: "",
    textOrigin: "",
    author: "",
    dynasty: "",
    source: "",

    selection: "",

    aliasText: "",
    rawText: "",
    verse: true,
    prose: false,
    loose: false,
    plain: [],
    tokens: [],
    translation: "",
    translationSource: "",
    hasTranslation: false,
    showTranslation: false,
    glossRows: [],
    showGloss: false,
    align: "center",
    fontDown: false,
    fontUp: true,
    gapDown: true,
    gapUp: true,
    gapStyle: "",
    fontSize: 0,
    fontMin: scale.MIN,
    fontMax: scale.MAX,
    pinyinMode: "off",
    pinyinOn: false,
    stage: "新学",
    mastery: 0,
    hint: "",
    results: RESULTS,

    reciteMode: false,

    dailyOn: false,
    dailyLocked: false,
    audioOn: false,
    audioIcon: icons.play,
    pickOn: false,
    markOn: false,
    extraTier: "pro",
    pickTier: "pro",
    icons: PAGE_ICONS,

    remote: false,

    locked: true,
    lockTitle: "诗词详情",
    lockNote: "登录后查看正文与进度",

    corpusState: "",

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
    this.seekTo = this.data.reciteMode ? null : seekOf(query.at);
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle, bgStyle: readBg.style(), bgId: readBg.current() });
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

    if (!this.audioWatch) {
      this.audioWatch = (st) => this.paintAudioIcon(st);
      audio.watch(this.audioWatch);
    }

    if (this.data.locked) this.setData({ locked: false });
    if (!this.loaded) this.openEntry();
    this.applyReading();
    if (this.loaded) this.applyTitleMark();

    this.syncDaily();
  },

  corpusScope() {
    const id = String(this.data.id);
    if (/^\d+$/.test(id)) return "";
    return /^poems-/.test(id) ? "core" : "catalogs";
  },

  openEntry() {
    const scope = this.corpusScope();
    if (!scope) {
      this.loadEntry();
      return;
    }
    corpusGate.open(this, scope, () => this.loadEntry());
  },

  onCorpusRetry() {
    this.openEntry();
  },

  applyTitleMark() {
    const titleMark = auth.isAdmin()
      ? corpusOrigin.originOf(this.data.textOrigin)
      : "";
    if (titleMark !== this.data.titleMark) this.setData({ titleMark });
  },

  audioIconOf(st) {
    return st.id === this.data.id && st.playing ? icons.pause : icons.play;
  },

  paintAudioIcon(st) {
    const icon = this.audioIconOf(st);
    if (icon !== this.data.audioIcon) this.setData({ audioIcon: icon });
  },

  syncDaily() {
    const on = store.dailyExtra().indexOf(this.data.id) >= 0;
    const extraTier = entitlement.tierOf("extra");
    this.setData({
      dailyOn: on,
      extraTier: extraTier,
      dailyLocked: !entitlement.can("extra") && entitlement.reachable(extraTier, entitlement.status().tier),
      audioOn: audio.readiness("one").visible && audio.has(this.data.id),
      audioIcon: this.audioIconOf(audio.status()),
      pickOn: cols.collectionsOf(this.data.id).length > 0,
      markOn: marks.has(this.data.id),
      pickTier: entitlement.tierOf("collections")
    });
  },

  onDockAct(e) {
    const key = (e && e.detail && e.detail.key) || "";
    if (key === "daily") this.onToggleDaily();
    else if (key === "pick") this.onAddToCollection();
    else if (key === "audio") this.onPlayAudio();
    else if (key === "mark") this.onToggleMark();
    else if (key === "text") this.onCopyText();
    else if (key === "align") this.onAlignToggle();
    else if (key === "fontDown") this.onFontDown();
    else if (key === "fontUp") this.onFontUp();
    else if (key === "gapDown") this.onGapDown();
    else if (key === "gapUp") this.onGapUp();
    else if (key === "pinyin") this.onPinyinToggle();
  },

  onDockBg(e) {
    const id = readBg.pick(e && e.detail && e.detail.id);
    this.setData({ bgStyle: readBg.style(), bgId: id });
    sync.markDirty();
  },

  foldDock() {
    const dock = this.selectComponent("#dock");
    if (dock) dock.onClose();
  },

  onAddToCollection() {
    if (!entitlement.block("collections", { page: this, loginPrompt: true })) return;
    if (cols.collectionsOf(this.data.id).length) {
      cols.removeEverywhere(this.data.id);
      sync.markDirty();
      this.syncDaily();
      wx.showToast({ title: "已移出自选", icon: "none" });
      return;
    }
    const box = this.selectComponent("#collect");
    if (box) box.ask(this.data.id, this.data.title || "");
  },

  onPlayAudio() {
    if (!audio.readiness("one").visible) {
      wx.showToast({ title: audio.readiness("one").reason, icon: "none" });
      return;
    }
    if (!audioGate.usable("one")) {
      audioGate.ask("one");
      return;
    }
    if (audio.status().id === this.data.id) audio.toggle();
    else audio.play(this.data.id);
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

  onCopyText() {
    const d = this.data;
    const head = [d.title, [d.dynasty, d.author].filter(Boolean).join(" · ")].filter(Boolean).join("　");
    const body = (d.rawText || "").trim();
    if (!body) {
      wx.showToast({ title: "正文还没取回来", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: head + "\n\n" + body,
      success: () => wx.showToast({ title: "已复制本篇", icon: "none" })
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
      return this.renderEntry(id, hit, meta, "pack");
    }

    const packed = this.catalogEntry(id, meta);
    if (packed) {
      this.setData({ loadFailed: false, failText: "", loadingText: false, hasTranslation: !!packed.tr, remote: true });
      return this.renderEntry(id, packed, meta || corpus.catalogMeta(id, packed.sid), "mysql");
    }

    if (this.catalogBook(id, meta)) return this.loadPacked(id, meta);
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
        this.renderEntry(this.data.id, { text: text, tr: "", src: "" }, meta || this.remoteMeta(poem, sid), "mirror");
      },
      (err) => {
        console.error("[reader] 正文取失败 sid=" + sid, "HTTP " + ((err && err.statusCode) || 0), (err && err.message) || "");
        if (token !== this.loadToken) return;
        this.setData({ loadingText: false, loadFailed: true, failText: failText });
      }
    );
  },

  catalogEntry(id, meta) {
    const sid = String((meta && meta.sid) || this.data.sid || "");
    if (!sid) return null;
    const spot = corpus.catalogSpot(id, sid);
    if (!spot) return null;
    const packed = corpus.catalogText(spot);
    if (!packed) return null;
    return Object.assign({ gloss: corpus.catalogGloss(spot) }, packed);
  },

  catalogBook(id, meta) {
    const spot = corpus.catalogSpot(id, String((meta && meta.sid) || this.data.sid || ""));
    return spot ? spot.b : "";
  },

  loadPacked(id, meta) {
    const book = this.catalogBook(id, meta);
    this.setData({ id, loadingText: true, loadFailed: false, failText: "" });
    corpus.fetchCatalog(book).then(() => {
      const packed = this.catalogEntry(id, meta);
      if (packed) {
        this.setData({ loadFailed: false, failText: "", loadingText: false, hasTranslation: !!packed.tr, remote: true });
        return this.renderEntry(id, packed, meta || corpus.catalogMeta(id, packed.sid), "mysql");
      }
      if (meta && meta.sid) return this.loadRemote(meta.sid, meta, "未能获取正文，点击重试");
      this.setData({ loadingText: false, loadFailed: true, failText: "本篇正文不在当前版本中", remote: false });
    });
  },

  remoteMeta(poem, sid) {
    const m = source.metaOf(poem);
    return { id: m.id, sid: String(sid), t: m.t, a: m.a, d: m.d, b: "", n: source.NAME, s: "", g: "" };
  },

  onRetryText() {
    this.loadEntry();
  },

  renderEntry(id, entry, meta, origin) {
    const settings = store.settings();
    if (!this.data.reciteMode) {
      const here = this.here(id);
      lastRead.put({
        id: id, sid: this.data.sid || meta.sid, src: !!this.data.remote,
        t: meta.t, a: meta.a, n: meta.n || meta.s, b: meta.b,
        p: here ? here.p : 0, y: here ? here.y : 0
      });
    }
    const size = scale.clamp(settings.fontSize);
    const gapStep = scale.clampGap(settings.gapStep);

    const rec = store.getRecord(id);

    this.resultAt = "";

    this.setData({
      id,
      rawText: entry.text,
      loadingText: false,
      remote: !!this.data.remote,
      textOrigin: String(origin || ""),
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
      fontSize: size,
      ...scale.flags(size),
      gapStep,
      gapStyle: "--poem-gap-scale: " + scale.gapStep(gapStep),
      ...scale.gapFlags(gapStep),
      stage: R.stageName(rec, settings.algo) + " · 掌握 " + R.levelName(rec && rec.level),
      mastery: R.mastery(rec)
    });

    wx.setNavigationBarTitle({ title: meta.t });
    if (meta.b) store.markRead(meta.b, id);
    this.loaded = true;
    this.setData({ creator: this.data.from || "" });
    this.applyTitleMark();
    this.refreshPager();
    this.syncDaily();

    this.applyReading();
    this.seekPlan = this.seekTo;
    this.seekTo = null;
    if (this.seekPlan) this.seekPara();
  },


  relayout() {
    const keep = this.data.rawText ? (this.seekPlan || this.pendingSpot) : null;
    const laid = corpus.layout(this.data.rawText, {
      size: this.data.fontSize,
      pinyin: this.data.pinyinOn,
      title: this.data.title
    });
    this.laidParas = laid.paras;
    this.laidPlain = laid.plain;
    this.alignKey = scale.alignKey(laid);
    this.chunkToken = (this.chunkToken || 0) + 1;
    this.setData({
      plain: laid.plain.slice(0, FIRST_CHUNK),
      verse: laid.verse,
      prose: laid.prose,
      loose: laid.loose,
      align: scale.alignOf(laid, store.settings())
    });
    this.appendRest(laid.plain, FIRST_CHUNK, this.chunkToken);
    if (keep) {
      this.seekPlan = keep;
      this.seekPara();
    }
  },

  appendRest(plain, from, token) {
    if (from >= plain.length) return;
    setTimeout(() => {
      if (token !== this.chunkToken) return;
      const patch = {};
      plain.slice(from, from + CHUNK).forEach((para, i) => { patch["plain[" + (from + i) + "]"] = para; });
      this.setData(patch);
      this.appendRest(plain, from + CHUNK, token);
    }, CHUNK_GAP);
  },

  applyReading() {
    const usable = pinyin.readiness().usable && entitlement.can("pinyin")
      && corpus.hanCount(this.data.rawText) <= corpus.PINYIN_MAX_HAN;
    const mode = usable ? pinyin.getMode() : "off";

    this.setData({ pinyinOn: usable, pinyinMode: mode });
    if (this.data.rawText) this.relayout();
    this.setData({ tokens: usable ? pinyin.render(this.laidParas, mode) : [] });
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
    store.saveSettings({ [this.alignKey || "align"]: align });

    sync.markDirty();
  },

  onToggleTranslation() {
    this.setData({ showTranslation: !this.data.showTranslation });
  },

  onToggleGloss() {
    this.setData({ showGloss: !this.data.showGloss });
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

  onGapDown() {
    this.stepGap(-1);
  },

  onGapUp() {
    this.stepGap(1);
  },

  stepGap(delta) {
    const gapStep = scale.clampGap(this.data.gapStep + delta);
    if (gapStep === this.data.gapStep) return;
    this.applyGap(gapStep);
    store.saveSettings({ gapStep });
    sync.markDirty();
  },

  applyGap(step) {
    this.setData(Object.assign({
      gapStep: step,
      gapStyle: "--poem-gap-scale: " + scale.gapStep(step)
    }, scale.gapFlags(step)));
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

  onPageScroll(e) {
    this.foldDock();
    const top = Math.max(0, Math.round(Number(e && e.scrollTop) || 0));
    if (!this.data.rawText || this.data.reciteMode) return;
    const at = spot.locate(top, this.data.fontSize, this.laidPlain);
    if (at.p === spot.paraOf(this.pendingSpot) && at.y === spot.offsetOf(this.pendingSpot)) return;
    this.pendingSpot = at;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.saveSpot(), SAVE_GAP);
  },

  here(id) {
    const mine = id && id === this.data.id && this.pendingSpot;
    if (mine) return mine;
    const hit = this.data.reciteMode ? null : lastRead.get();
    if (hit && hit.id === id && spot.paraOf(hit)) return { p: spot.paraOf(hit), y: spot.offsetOf(hit) };
    return null;
  },

  saveSpot() {
    this.saveTimer = null;
    const at = this.pendingSpot;
    if (!at || !this.data.rawText) return;
    lastRead.put({
      id: this.data.id, sid: this.data.sid, src: !!this.data.remote,
      t: this.data.title, a: this.data.author, n: this.data.source, b: this.data.bookId,
      p: at.p, y: at.y
    });
    if (marks.seek(this.data.id, at)) sync.markDirty();
  },

  seekPara() {
    const at = this.seekPlan;
    if (!at) return;
    this.pendingSpot = at;
    this.seekPlan = null;
    wx.pageScrollTo({
      scrollTop: spot.topOf(at.p - 1, at.y, this.data.fontSize, this.laidPlain),
      duration: 0
    });
  },

  onUnload() {
    audio.unwatch(this.audioWatch);
    this.audioWatch = null;
    corpusGate.close(this);
    if (this.advance) clearTimeout(this.advance);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.pendingSpot && this.data.rawText) this.saveSpot();
    this.loadToken = (this.loadToken || 0) + 1;
    this.chunkToken = (this.chunkToken || 0) + 1;
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
