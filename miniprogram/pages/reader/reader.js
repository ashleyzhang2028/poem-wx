const corpus = require("../../utils/corpus");
const table = require("../../utils/table");
const AI = require("../../utils/author-index");
const store = require("../../utils/store");
const R = require("../../utils/review-models");
const pinyin = require("../../utils/pinyin");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");
const cols = require("../../utils/collections");
const theme = require("../../utils/theme");
const tabbar = require("../../utils/tabbar");
const tabPage = require("../../utils/tab-page");
const trail = require("../../utils/trail");
const icons = require("../../utils/icons");

const RESULTS = [
  { key: "bad", label: "忘记", cls: "bad" },
  { key: "fuzzy", label: "模糊", cls: "fuzzy" },
  { key: "good", label: "记住", cls: "good" }
];

const FONT_MIN = -2;
const FONT_MAX = 6;

const ALIGNS = [
  { key: "left", label: "左对齐", icon: icons.left },
  { key: "center", label: "居中", icon: icons.center }
];

const PINYIN_MODES = [
  { key: "off", label: "不注音", icon: icons.off },
  { key: "all", label: "全文", icon: icons.all }
];

const PAGE_ICONS = {
  add: icons.add, added: icons.added, zoomOut: icons.zoomOut, zoomIn: icons.zoomIn, playlist: icons.playlist
};

function fontFlags(size) {
  return { fontDown: size > FONT_MIN, fontUp: size < FONT_MAX };
}

function bookTitleOf(name) {
  const raw = String(name == null ? "" : name).trim();
  if (!raw) return "";
  return /《.+》/.test(raw) ? raw : "《" + raw + "》";
}

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
    barBelow: true,
    id: "",

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
    tokens: [],
    blocks: [],
    blocksOn: false,
    tableView: false,
    translation: "",
    translationSource: "",
    hasTranslation: false,
    showTranslation: false,
    aligns: ALIGNS,
    align: "center",
    fontDown: false,
    fontUp: true,
    fontSize: 0,
    fontMin: FONT_MIN,
    fontMax: FONT_MAX,
    pinyinModes: PINYIN_MODES,
    pinyinMode: "off",
    pinyinOn: false,
    stage: "新学",
    mastery: 0,
    hint: "",
    results: RESULTS,

    reciteMode: false,

    dailyOn: false,
    pickOn: false,
    icons: PAGE_ICONS,

    locked: true,
    lockTitle: "登录后可用",
    lockNote: "",

    creator: "",
    pager: { show: false, prev: null, next: null }
  },

  onLoad(query) {
    this.setData({
      id: query.id || "",
      from: query.from || "",
      reciteMode: query.mode === "recite"
    });
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
    if (!this.data.reciteMode) {
      this.setData({ hint: "" });
    }
    if (!gate.logged()) {

      this.setData({
        locked: true,
        loadingText: false,
        lockTitle: "这篇要登录",
        lockNote: "登录后才能看正文与进度"
      });
      return;
    }

    if (this.data.locked) this.setData({ locked: false });
    if (!this.loaded) this.loadEntry();
    this.applyReading();

    this.syncDaily();
  },

  syncDaily() {
    const on = store.dailyExtra().indexOf(this.data.id) >= 0;
    if (on !== this.data.dailyOn) this.setData({ dailyOn: on });
    const picked = cols.collectionsOf(this.data.id).length > 0;
    if (picked !== this.data.pickOn) this.setData({ pickOn: picked });
  },

  onAddToCollection() {
    if (!entitlement.block("collections", { page: this })) return;
    const id = this.data.id;
    const inList = cols.collectionsOf(id);
    const names = cols.list().map((c) => cols.nameOf(c));
    const items = names.concat(["新建集合"]);
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (res.tapIndex >= names.length) {
          this.newCollection(id);
          return;
        }
        const c = cols.list()[res.tapIndex];
        const r = cols.add(c.id, [id]);
        this.afterPick(r, c);
      },
      fail: () => {
        if (!inList.length) return;
      }
    });
  },

  newCollection(poemId) {
    const cap = cols.capOf();
    if (!entitlement.gateTier("collections", { page: this })) return;
    if (cols.list().length >= cap) {
      wx.showToast({ title: "最多 " + cap + " 个集合，先删一个", icon: "none" });
      return;
    }
    wx.showModal({
      title: "新建自选集合",
      editable: true,
      placeholderText: cols.DEFAULT_NAME,
      confirmText: "新建",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) return;
        const made = cols.create(res.content);
        if (!made.ok) {
          wx.showToast({ title: "最多 " + cap + " 个集合", icon: "none" });
          return;
        }
        const r = cols.add(made.collection.id, [poemId]);
        this.afterPick(r, made.collection);
      }
    });
  },

  afterPick(r, c) {
    if (!r.ok) {
      const msg = r.code === "E_FULL"
        ? "「" + cols.nameOf(c) + "」已满 " + cols.ITEMS_MAX + " 首"
        : r.code === "E_DUP" ? "已经在「" + cols.nameOf(c) + "」里了" : "加不进去";
      wx.showToast({ title: msg, icon: "none" });
      return;
    }
    sync.markDirty();
    this.syncDaily();
    wx.showToast({ title: "已加入「" + cols.nameOf(c) + "」", icon: "none" });
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
    wx.showToast({ title: r.on ? "已加入今日背诵" : "已移出今日背诵", icon: "none" });
    sync.markDirty();
  },

  onTierGate() {
    entitlement.openTierPage();
  },

  dailyMsg(r) {
    if (r.code === "E_LIMIT") return "今日已加 " + store.DAILY_EXTRA_MAX + " 首，背完再加";
    if (r.code === "E_STORAGE") return "添加失败：空间不足或存储未开启";
    return "添加失败";
  },

  loadEntry() {
    const id = this.data.id;
    const meta = this.findMeta(id);

    if (!meta) {
      this.setData({ id, loadFailed: true, failText: "篇目数据缺失" });
      return;
    }

    let hit = null;
    try {
      hit = corpus.entry(id);
    } catch (e) {
      hit = null;
    }
    if (hit && hit.text) {
      if (this.data.loadFailed) this.setData({ loadFailed: false, failText: "" });
      return this.renderEntry(id, hit, meta);
    }

    const token = (this.loadToken || 0) + 1;
    this.loadToken = token;
    this.setData({ id, loadingText: true, loadFailed: false, failText: "" });
    return corpus
      .ensureEntry(id)
      .then((entry) => {
        if (token !== this.loadToken) return;
        if (!entry) throw new Error("这一条不在任何分片里");
        this.renderEntry(id, entry, this.findMeta(id));
      })
      ["catch"]((err) => {
        if (token !== this.loadToken) return;
        this.setData({ loadingText: false, loadFailed: true, failText: this.textFailMsg(err) });
      });
  },

  onRetryText() {
    this.loadEntry();
  },

  textFailMsg(err) {
    const code = (err && err.code) || "";
    const say = this.errSay(err);
    if (code === "E_NO_ENTRY") return "分片清单里没有这一篇";
    if (code === "E_NO_TEXT") return "这一片的正文不完整，换一篇看看";
    if (code === "E_NO_SHARD_SERVICE") return "还没接上同步服务器，退出重进再看";
    if (code === "E_NO_SHARDS") return "这个版本里没有课外正文";
    if (/102002|timed? ?out/i.test(say)) return "取正文超时了 —— 多半是服务实例刚被唤醒，重试一次";
    if (/invalid host/i.test(say)) return "平台按服务名找不到取正文的服务（云托管里没有这个服务）";
    if (/fail|Cloud API isn|service not found|env not exists/i.test(say)) return "连不上取正文的服务，重试一次";
    if (/网络|不通/.test(say)) return "网络不通，稍后再试";
    return "这一篇取不到正文";
  },

  errSay(err) {
    if (!err) return "";
    return String(err.errMsg || err.message || "");
  },

  renderEntry(id, entry, meta) {
    const settings = store.settings();
    const size = Math.max(FONT_MIN, Math.min(FONT_MAX, Number(settings.fontSize) || 0));

    const rec = store.getRecord(id);

    this.setData({
      id,
      rawText: entry.text,
      tableView: table.hasTable(entry.text),
      loadingText: false,
      bookId: meta.b,
      title: meta.t,
      author: meta.a,
      dynasty: meta.d,
      source: meta.s || bookTitleOf(meta.n),
      selection: meta.sel ? "选自" + meta.sel : "",
      aliasText: aliasTextOf(meta),
      translation: entry.tr || "",
      translationSource: entry.src || "",
      hasTranslation: !!entry.tr,
      align: settings.align,
      fontSize: size,
      ...fontFlags(size),
      stage: R.stageName(rec, settings.algo),
      mastery: rec && rec.learned ? Math.round((R.clampLevel(rec.level) / 9) * 100) : 0
    });

    wx.setNavigationBarTitle({ title: meta.t });
    store.markRead(meta.b, id);
    this.loaded = true;
    this.setData({ creator: this.data.from || "" });
    this.refreshPager();
    this.syncDaily();

    this.applyReading();
  },

  onLogin() {
    tabPage.mine();
  },

  relayout() {
    const laid = corpus.layout(this.data.rawText, {
      size: this.data.fontSize,
      pinyin: this.data.pinyinOn
    });
    this.setData({ paras: laid.paras });
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
    const pr = pinyin.readiness();
    const allowed = entitlement.can("pinyin");
    const usable = pr.usable && allowed;
    const mode = usable ? store.settings().pinyin : "off";
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

  findMeta(id) {
    return corpus.indexById(id);
  },

  onToggleTranslation() {
    this.setData({ showTranslation: !this.data.showTranslation });
  },

  onLoginGate() {
    tabPage.mine();
  },

  onPinyin(e) {
    const mode = e.detail.value;
    if (!pinyin.setMode(mode)) {
      wx.showToast({ title: "读音表未生成", icon: "none" });
      return;
    }
    this.setData({ pinyinMode: mode });
    this.applyReading();

    sync.markDirty();
  },

  onAlign(e) {
    const align = e.detail.value;
    this.setData({ align });
    store.saveSettings({ align });

    sync.markDirty();
  },

  onFontDown() {
    this.stepFont(-1);
  },

  onFontUp() {
    this.stepFont(1);
  },

  stepFont(delta) {
    const fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, this.data.fontSize + delta));
    if (fontSize === this.data.fontSize) return;
    this.setData(Object.assign({ fontSize }, fontFlags(fontSize)));
    store.saveSettings({ fontSize });
    if (this.data.rawText) this.applyReading();
    sync.markDirty();
  },

  onResult(e) {
    if (!this.data.reciteMode) return;

    if (!entitlement.can("daily")) {
      wx.showToast({ title: entitlement.hint("daily"), icon: "none" });
      return;
    }
    const result = e.detail.value;
    const settings = store.settings();
    const rec = R.review(store.getRecord(this.data.id), result, settings.algo);
    store.setRecord(this.data.id, rec);
    sync.markDirty();

    this.setData({
      stage: R.stageName(rec, settings.algo),
      mastery: Math.round((R.clampLevel(rec.level) / 9) * 100),
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
    let url = "/pages/reader/reader?id=" + encodeURIComponent(id);
    if (this.data.reciteMode) url += "&mode=recite";
    if (creator) url += "&from=" + encodeURIComponent(creator);
    return url;
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
    return { title: this.data.title + " · " + this.data.author, path: "/pages/reader/reader?id=" + this.data.id };
  }
});
