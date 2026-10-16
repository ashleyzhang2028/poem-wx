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
    paras: [],
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
    if (this.advance) clearTimeout(this.advance);
  },

  methods: {

    open(queue, id) {
      const list = (queue || []).slice();
      if (!list.length) return;
      const keep = this.current();
      const hit = list.findIndex((it) => it.id === id);
      const idx = hit >= 0 ? hit : (keep ? Math.max(0, list.findIndex((it) => it.id === keep.id)) : 0);
      this.pushed = true;
      this.lastPush = idsOf(list);
      this.missingAt = 0;
      this.missingOf = 0;
      this.setData({ open: true, index: idx, queue: list });
      this.loadCurrent();
    },

    onClose() {
      if (this.closedAt && Date.now() - this.closedAt < REOPEN_MS) return;
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
      const laid = corpus.layout(entry.text);
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
        paras: laid.paras,
        translation: entry.translation || "",
        translationSource: entry.src || "",
        hasTranslation: !!entry.translation,
        showTranslation: false,
        align: settings.align,
        fontSize,
        ...fontFlags(fontSize),
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
      const tokens = pinyin.render(this.data.paras, usable ? mode : "off");
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
