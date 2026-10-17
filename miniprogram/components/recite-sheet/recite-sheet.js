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

const RESULT_KEYS = RESULTS.map((it) => it.key);

const FONT_MIN = -2;
const FONT_MAX = 6;

const REOPEN_MS = 400;

const ALIGNS = [
  { key: "left", label: "左对齐", icon: "left" },
  { key: "center", label: "居中", icon: "center" }
];

const PINYIN_MODES = [
  { key: "off", label: "不注音", icon: "off" },
  { key: "rare", label: "生字", icon: "rare" },
  { key: "all", label: "全文", icon: "all" }
];

function idsOf(rows) {
  return (rows || []).map((it) => it.id).join("|");
}

function fontFlags(size) {
  return { fontDown: size > FONT_MIN, fontUp: size < FONT_MAX };
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

Component({
  options: {

    addGlobalClass: true
  },

  properties: {

    themeStyle: { type: String, value: "" },

    queue: {
      type: Array,
      value: [],
      observer(rows) {
        if (!rows || !rows.length) return;
        const mark = idsOf(rows);
        if (mark === this.lastPush) return;
        this.lastPush = mark;
        if (!this.data.open) return;
        const keep = this.current();
        const index = keep ? Math.max(0, rows.findIndex((it) => it.id === keep.id)) : this.data.index;
        this.setData({ queue: rows, index }, () => this.loadCurrent());
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
    rawText: "",
    tokens: [],
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

    mastery: 0,
    hint: "",
    last: "",
    results: RESULTS,

    dailyOn: false
  },

  attached() {
    this.pushed = false;
    this.closedAt = 0;
    this.lastPush = "";
    this.missingAt = 0;
    this.missingOf = 0;
  },

  detached() {
    this.cancelAdvance();
  },

  methods: {

    open(queue, id) {
      const list = (queue || []).slice();
      if (!list.length) return;
      const keep = this.current();
      const hit = list.findIndex((it) => it.id === id);
      const idx = hit >= 0 ? hit : (keep ? Math.max(0, list.findIndex((it) => it.id === keep.id)) : 0);
      this.cancelAdvance();
      this.pushed = true;
      this.lastPush = idsOf(list);
      this.missingAt = 0;
      this.missingOf = 0;
      this.setData({ open: true, index: idx, queue: list });
      this.loadCurrent();
    },

    onClose() {
      if (this.closedAt && Date.now() - this.closedAt < REOPEN_MS) return;
      this.cancelAdvance();
      this.closedAt = Date.now();
      this.pushed = false;
      this.setData({ open: false, showTranslation: false, hint: "" });
    },

    noticeMissing() {
      if (!this.missingAt) return;
      const at = this.missingAt;
      const of = this.missingOf;
      this.missingAt = 0;
      this.missingOf = 0;
      wx.showModal({
        title: "这版没带上正文",
        content: "第 " + at + " / " + of + " 首的正文不在包里。"
          + "\n\n点「去同步」把它取回来。",
        confirmText: "去同步",
        cancelText: "知道了",
        success: (res) => {
          if (res.confirm) {
            sync.now(true);
            wx.showToast({ title: "正在同步正文", icon: "none" });
          }
        }
      });
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
        this.missingAt = this.data.index + 1;
        this.missingOf = this.data.queue.length;
        this.onClose();
        this.noticeMissing();
        return;
      }

      const settings = store.settings();
      const rec = store.getRecord(item.id);
      const fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, Number(settings.fontSize) || 0));

      this.setData({
        id: item.id,
        bookId: meta.b,
        title: meta.t,
        author: meta.a,
        dynasty: meta.d,
        source: meta.s || meta.n,
        selection: meta.sel || "",
        aliasText: aliasTextOf(meta),
        rawText: entry.text,
        translation: entry.translation || "",
        translationSource: entry.src || "",
        hasTranslation: !!entry.translation,
        showTranslation: false,
        align: settings.align,
        fontSize,
        ...fontFlags(fontSize),
        stage: R.stageName(rec, settings.algo),
        mastery: rec && rec.learned ? Math.round((R.clampLevel(rec.level) / 9) * 100) : 0,
        last: "",
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
      const laid = corpus.layout(this.data.rawText, { size: this.data.fontSize, pinyin: usable });
      this.setData({
        pinyinOn: usable,
        pinyinMode: mode,
        tokens: pinyin.render(laid.paras, usable ? mode : "off")
      });
    },

    syncDaily() {
      const on = store.dailyExtra().indexOf(this.data.id) >= 0;
      if (on !== this.data.dailyOn) this.setData({ dailyOn: on });
    },

    onToggleDaily() {
      const r = store.toggleDailyExtra(this.data.id);
      if (r.code === "E_TIER") {
        this.askDailyUpgrade();
        return;
      }
      if (!r.ok) {
        wx.showToast({ title: this.dailyMsg(r), icon: "none" });
        return;
      }
      this.setData({ dailyOn: r.on });
      wx.showToast({ title: r.on ? "已加入今日背诵" : "已移出今日背诵", icon: "none" });

      this.triggerEvent("change", { count: store.dailyExtra().length });
    },

    askDailyUpgrade() {
      wx.showModal({
        title: "今日加背 · Pro / Max 专享",
        content: "「今日加背」是 Pro 与 Max 的计划容量：除了每天固定的篇目，还能自己再挑几首一起背。\n\n"
          + "你现在的档位是 " + entitlement.status().label + "，阅读与搜索不受影响。"
          + "如果想让今天多背几首，升级到 Pro 或 Max 就能自己加。\n\n"
          + "感谢你认真对待每一次背诵。",
        confirmText: "知道了",
        showCancel: false
      });
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
      this.setData({ pinyinMode: mode });
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
      this.setData(Object.assign({ fontSize }, fontFlags(fontSize)));
      store.saveSettings({ fontSize });
      if (this.data.rawText) this.applyReading();
    },

    onResult(e) {
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
        last: "",
        hint: R.resultHint(settings.algo, result, rec)
      });

      this.cancelAdvance();
      this.advance = setTimeout(() => this.goNext(result), 700);
    },

    cancelAdvance() {
      if (this.advance) clearTimeout(this.advance);
      this.advance = 0;
    },

    nextResult(r) {
      const i = RESULT_KEYS.indexOf(r);
      return RESULT_KEYS[i < 0 ? 0 : i + 1] || RESULT_KEYS[RESULT_KEYS.length - 1];
    },

    goNext(prev) {
      const next = this.data.index + 1;
      if (next >= this.data.queue.length) {
        this.onClose();
        this.triggerEvent("finish");
        return;
      }
      this.setData({ index: next, last: this.nextResult(prev) });
      this.loadCurrent();
    },

    onPrev() {
      this.cancelAdvance();
      if (this.data.index <= 0) return;
      this.setData({ index: this.data.index - 1, last: "" });
      this.loadCurrent();
    },

    onNext() {
      this.cancelAdvance();
      if (this.data.index + 1 >= this.data.queue.length) return;
      this.setData({ index: this.data.index + 1, last: "" });
      this.loadCurrent();
    },

    noop() {}
  }
});
