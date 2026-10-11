const corpus = require("../../utils/corpus");
const AI = require("../../utils/author-index");
const store = require("../../utils/store");
const R = require("../../utils/review-models");
const pinyin = require("../../utils/pinyin");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");
const theme = require("../../utils/theme");

const RESULTS = [
  { key: "bad", label: "忘记", cls: "bad" },
  { key: "fuzzy", label: "模糊", cls: "fuzzy" },
  { key: "good", label: "记住", cls: "good" }
];

const FONT_MIN = -2;
const FONT_MAX = 4;

const ALIGNS = [
  { key: "left", label: "左对齐" },
  { key: "center", label: "居中" }
];

const PINYIN_MODES = [
  { key: "off", label: "不注音" },
  { key: "rare", label: "生字" },
  { key: "all", label: "全文" }
];

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
    id: "",

    loadingText: false,
    bookId: "",
    title: "",
    author: "",
    dynasty: "",
    source: "",

    selection: "",

    aliasText: "",
    paras: [],
    tokens: [],
    translation: "",
    translationSource: "",
    hasTranslation: false,
    showTranslation: false,
    aligns: ALIGNS,
    align: "center",
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

    dailyOn: false,

    locked: true,
    lockTitle: "登录后可用",
    lockNote: "",

    creator: ""
  },

  onLoad(query) {
    this.setData({ id: query.id || "", from: query.from || "" });
  },

  onShow() {
    theme.apply(this);
    if (!gate.logged()) {

      this.setData({
        locked: true,
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
  },

  onToggleDaily() {
    const r = store.toggleDailyExtra(this.data.id);
    if (!r.ok) {
      wx.showToast({ title: this.dailyMsg(r), icon: "none" });
      return;
    }
    this.setData({ dailyOn: r.on });
    wx.showToast({ title: r.on ? "已加入今日背诵" : "已移出今日背诵", icon: "none" });
    sync.markDirty();
  },

  dailyMsg(r) {
    if (r.code === "E_LIMIT") return "今天已经加了 " + store.DAILY_EXTRA_MAX + " 首，先背完再加";
    if (r.code === "E_STORAGE") return "加不进去：这台手机存不下（空间不足或未开启存储）";
    return "加不进去";
  },

  loadEntry() {
    const id = this.data.id;
    const meta = this.findMeta(id);

    if (!meta) {
      this.setData({ id });
      wx.showToast({ title: "篇目数据缺失", icon: "none" });
      return;
    }

    let hit = null;
    try {
      hit = corpus.entry(id);
    } catch (e) {
      hit = null;
    }
    if (hit) return this.renderEntry(id, hit, meta);

    this.setData({ id, loadingText: true });
    return corpus
      .ensureEntry(id)
      .then((entry) => {
        if (!entry) throw new Error("这一条不在任何分片里");
        this.renderEntry(id, entry, meta);
      })
      ["catch"]((err) => {
        this.setData({ loadingText: false });
        wx.showToast({ title: this.textFailMsg(err), icon: "none" });
      });
  },

  textFailMsg(err) {
    const code = (err && err.code) || "";
    if (code === "E_NO_SHARD_SERVICE") return "还没接上同步服务器（云调用两栏）";
    if (code === "E_NO_SHARDS") return "这个版本里没有课外正文";
    if (err && /网络|超时|不通/.test(err.message || "")) return "网络不通，稍后再试";
    return "这一篇取不到正文";
  },

  renderEntry(id, entry, meta) {
    const settings = store.settings();

    const rec = store.getRecord(id);

    const laid = corpus.layout(entry.text);

    this.setData({
      id,
      loadingText: false,
      bookId: meta.b,
      title: meta.t,
      author: meta.a,
      dynasty: meta.d,
      source: meta.s || meta.n,
      selection: meta.sel || "",
      aliasText: aliasTextOf(meta),
      paras: laid.paras,
      translation: entry.translation || "",
      translationSource: entry.src || "",
      hasTranslation: !!entry.translation,
      align: settings.align,
      fontSize: settings.fontSize,
      stage: R.stageName(rec, settings.algo),
      mastery: rec && rec.learned ? Math.round((R.clampLevel(rec.level) / 9) * 100) : 0
    });

    wx.setNavigationBarTitle({ title: meta.t });
    store.markRead(meta.b, id);
    this.loaded = true;
    this.setData({ creator: this.data.from || "" });
    this.syncDaily();

    this.applyReading();
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  applyReading() {
    const pr = pinyin.readiness();
    const allowed = entitlement.can("pinyin");
    const usable = pr.usable && allowed;
    const mode = usable ? store.settings().pinyin : "off";

    const tokens = usable ? pinyin.render(this.data.paras, mode) : [];
    this.setData({ pinyinOn: usable, pinyinMode: mode, tokens });
  },

  findMeta(id) {
    return corpus.indexById(id);
  },

  onToggleTranslation() {
    this.setData({ showTranslation: !this.data.showTranslation });
  },

  onLoginGate() {
    wx.switchTab({ url: "/pages/mine/mine" });
  },

  onPinyin(e) {
    const mode = e.detail.value;
    if (!pinyin.setMode(mode)) {
      wx.showToast({ title: "读音表未生成", icon: "none" });
      return;
    }
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
    this.setData({ fontSize });
    store.saveSettings({ fontSize });
    sync.markDirty();
  },

  onResult(e) {

    if (!entitlement.can("daily")) {
      wx.showToast({ title: entitlement.hint("daily"), icon: "none" });
      return;
    }
    const result = e.currentTarget.dataset.r;
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
        wx.redirectTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(list[i].id) });
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
      url: "/pages/reader/reader?id=" + encodeURIComponent(next) +
        "&from=" + encodeURIComponent(this.data.creator)
    });
  },

  siblingInAuthor(delta) {
    const who = this.data.creator;
    if (!who) return "";
    if (!this.rosterCache) {
      const entries = [];
      AI.LIT_BOOKS.forEach((b) => {
        corpus.ofBook(b).forEach((p) => entries.push(p));
      });
      this.rosterCache = AI.build(entries);
    }
    const ids = AI.worksOf(this.rosterCache, who);
    const idx = ids.indexOf(this.data.id);
    if (idx < 0) return "";
    const at = idx + delta;
    return at >= 0 && at < ids.length ? ids[at] : "";
  },

  onShareAppMessage() {
    return { title: this.data.title + " · " + this.data.author, path: "/pages/reader/reader?id=" + this.data.id };
  }
});
