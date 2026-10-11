const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const R = require("../../utils/review-models");
const pinyin = require("../../utils/pinyin");
const entitlement = require("../../utils/entitlement");
const theme = require("../../utils/theme");
const sync = require("../../utils/sync");

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

Component({
  options: {

    addGlobalClass: true
  },

  properties: {

    themeStyle: { type: String, value: "" },

    queue: {
      type: Array,
      value: [],
      observer() {
        if (this.data.open) this.loadCurrent();
      }
    }
  },

  data: {
    open: false,

    index: 0,
    total: 0,
    navText: "",

    id: "",
    bookId: "",
    title: "",
    author: "",
    dynasty: "",
    source: "",

    selection: "",
    aliasText: "",
    stage: "",
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

    mastery: 0,
    hint: "",
    results: RESULTS,

    dailyOn: false
  },

  attached() {
    this.loaded = false;
  },

  detached() {
    if (this.advance) clearTimeout(this.advance);
  },

  methods: {

    open(queue, id) {
      const list = (queue || []).slice();
      if (!list.length) return;
      const idx = Math.max(0, list.findIndex((it) => it.id === id));
      this.setData({ open: true, index: idx });
      this.loadCurrent();
    },

    onClose() {
      this.setData({ open: false, showTranslation: false, hint: "" });
    },

    current() {
      return this.data.queue[this.data.index] || null;
    },

    loadCurrent() {
      const item = this.current();
      if (!item) {
        this.onClose();
        return;
      }
      const entry = corpus.entry(item.id);
      const meta = corpus.indexById(item.id);
      if (!entry || !meta) {
        wx.showToast({ title: "篇目数据缺失", icon: "none" });
        this.onClose();
        return;
      }

      const settings = store.settings();
      const rec = store.getRecord(item.id);
      const laid = corpus.layout(entry.text);

      this.setData({
        id: item.id,
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
        showTranslation: false,
        align: settings.align,
        fontSize: settings.fontSize,
        stage: R.stageName(rec, settings.algo),
        mastery: rec && rec.learned ? Math.round((R.clampLevel(rec.level) / 9) * 100) : 0,
        index: this.data.index,
        total: this.data.queue.length,
        navText: (this.data.index + 1) + " / " + this.data.queue.length,
        hint: ""
      });

      store.markRead(meta.b, item.id);
      this.syncDaily();
      this.applyReading();

      this.triggerEvent("open", { id: item.id });
    },

    applyReading() {
      const pr = pinyin.readiness();
      const allowed = entitlement.can("pinyin");
      const usable = pr.usable && allowed;
      const mode = usable ? store.settings().pinyin : "off";
      const tokens = usable ? pinyin.render(this.data.paras, mode) : [];
      this.setData({ pinyinOn: usable, pinyinMode: mode, tokens });
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

      this.triggerEvent("change", { count: store.dailyExtra().length });
    },

    dailyMsg(r) {
      if (r.code === "E_LIMIT") return "今天已经加了 " + store.DAILY_EXTRA_MAX + " 首，先背完再加";
      if (r.code === "E_STORAGE") return "加不进去：这台手机存不下（空间不足或未开启存储）";
      return "加不进去";
    },

    onToggleTranslation() {
      this.setData({ showTranslation: !this.data.showTranslation });
    },

    onAlign(e) {
      const align = e.detail.value;
      this.setData({ align });
      store.saveSettings({ align });
    },

    onPinyin(e) {
      const mode = e.detail.value;
      if (!pinyin.setMode(mode)) {
        wx.showToast({ title: "读音表未生成", icon: "none" });
        return;
      }
      this.applyReading();
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

    goNext() {
      const next = this.data.index + 1;
      if (next >= this.data.queue.length) {
        this.onClose();
        this.triggerEvent("finish");
        return;
      }
      this.setData({ index: next });
      this.loadCurrent();
    },

    onPrev() {
      if (this.data.index <= 0) return;
      this.setData({ index: this.data.index - 1 });
      this.loadCurrent();
    },

    noop() {}
  }
});
