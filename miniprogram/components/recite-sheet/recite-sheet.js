const corpus = require("../../utils/corpus");
const table = require("../../utils/table");
const store = require("../../utils/store");
const R = require("../../utils/review-models");
const pinyin = require("../../utils/pinyin");
const entitlement = require("../../utils/entitlement");
const theme = require("../../utils/theme");
const sync = require("../../utils/sync");
const sfx = require("../../utils/sfx");
const icons = require("../../utils/icons");
const scale = require("../../utils/type-scale");
const defer = require("../../utils/defer");
const guard = require("../../utils/guard");

const RESULTS = [
  { key: "bad", icon: icons.moonNew, label: "忘记", cls: "bad" },
  { key: "fuzzy", icon: icons.moonHalf, label: "模糊", cls: "fuzzy" },
  { key: "good", icon: icons.moonFull, label: "记住", cls: "good" }
];

const DEFERS = [
  { key: "tomorrow", icon: icons.tomorrow, label: "明日再背", cls: "defer" },
  { key: "month", icon: icons.month, label: "月后再背", cls: "defer" }
];

const REOPEN_MS = 400;

const ALIGNS = [
  { key: "left", label: "左对齐", icon: icons.left },
  { key: "center", label: "居中", icon: icons.center }
];

const PINYIN_MODES = [
  { key: "off", label: "不注音", icon: icons.off },
  { key: "all", label: "全文", icon: icons.all }
];

const PAGE_ICONS = { add: icons.add, added: icons.added, zoomOut: icons.zoomOut, zoomIn: icons.zoomIn };

function idsOf(rows) {
  return (rows || []).map((it) => it.id).join("|");
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
    name: { type: String, value: "" },

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
    textMiss: "",
    stage: "",
    rawText: "",
    tableView: false,
    blocks: [],
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
    fontMin: scale.MIN,
    fontMax: scale.MAX,
    pinyinModes: PINYIN_MODES,
    pinyinMode: "off",
    pinyinOn: false,

    mastery: 0,
    hint: "",
    results: RESULTS,
    defers: DEFERS,
    icons: PAGE_ICONS,

    dailyOn: false,
    heldKey: ""
  },

  attached() {
    this.pushed = false;
    this.closedAt = 0;
    this.lastPush = "";
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
      guard.reset("sheet:result");
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

    missHead(item) {
      const meta = corpus.indexById(item.id) || item;
      return {
        id: item.id,
        navText: (this.data.index + 1) + " / " + this.data.queue.length,
        bookId: meta.b || item.b || "",
        title: meta.t || "",
        author: meta.a || "",
        dynasty: meta.d || "",
        source: meta.s || meta.n || "",
        selection: meta.sel || "",
        aliasText: aliasTextOf(meta),
        stage: "",
        mastery: 0,
        hasTranslation: false,
        translation: "",
        translationSource: "",
        showTranslation: false
      };
    },

    missText() {
      return "本篇正文不在这个包里。";
    },

    markMissing(item) {
      this.setData(Object.assign(
        { blocks: [], tokens: [], textMiss: this.missText() },
        item ? this.missHead(item) : {}
      ));
    },

    missHead(item) {
      const meta = corpus.indexById(item.id) || item;
      return {
        id: item.id,
        navText: (this.data.index + 1) + " / " + this.data.queue.length,
        bookId: meta.b || item.b || "",
        title: meta.t || "",
        author: meta.a || "",
        dynasty: meta.d || "",
        source: meta.s || meta.n || "",
        selection: meta.sel || "",
        aliasText: aliasTextOf(meta),
        stage: "",
        mastery: 0,
        hasTranslation: false,
        translation: "",
        translationSource: "",
        showTranslation: false
      };
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
      const meta = corpus.indexById(item.id);
      const hit = corpus.entry(item.id);
      if (hit && meta && hit.text) {
        this.renderCurrent(item, hit, meta);
        return;
      }
      this.setData({ open: true });
      this.markMissing(item);
    },

    renderCurrent(item, entry, meta) {
      const settings = store.settings();
      const rec = store.getRecord(item.id);
      const fontSize = scale.clamp(settings.fontSize);

      this.setData({
        id: item.id,
        bookId: meta.b,
        title: meta.t,
        author: meta.a,
        dynasty: meta.d,
        source: meta.s || meta.n || "",
        selection: meta.sel || "",
        aliasText: aliasTextOf(meta),
        textMiss: "",
        rawText: entry.text,
        tableView: table.hasTable(entry.text),
        translation: entry.tr || "",
        translationSource: entry.src || "",
        hasTranslation: !!entry.tr,
        showTranslation: false,
        align: settings.align,
        fontSize,
        ...scale.flags(fontSize),
        stage: R.stageName(rec, settings.algo) + " · 掌握 " + R.levelName(rec && rec.level),
        mastery: R.mastery(rec),
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
      const usable = pinyin.readiness().usable && entitlement.can("pinyin");
      const mode = usable ? store.settings().pinyin : "off";
      const blocks = this.tableBlocks();
      const laid = corpus.layout(this.data.rawText, { size: this.data.fontSize, pinyin: usable });
      this.setData({
        pinyinOn: usable,
        pinyinMode: mode,
        blocks,
        tokens: blocks.length ? [] : pinyin.render(laid.paras, mode)
      });
    },

    tableBlocks() {
      if (!this.data.tableView) return [];
      const parsed = table.parseText(this.data.rawText);
      if (!parsed) return [];
      const out = [];
      parsed.parts.forEach((part, i) => {
        if (part.k === "table") {
          out.push({ k: "table", key: "t" + i, table: parsed.blocks[part.i] });
          return;
        }
        const rows = this.paragraphRows(part.s);
        if (rows.length) out.push({ k: "p", key: "p" + i, rows });
      });
      return out;
    },

    paragraphRows(text) {
      if (!String(text == null ? "" : text).trim()) return [];
      return corpus.layout(text, { size: this.data.fontSize, pinyin: false }).paras;
    },

    syncDaily() {
      const on = store.dailyExtra().indexOf(this.data.id) >= 0;
      const heldKey = this.heldKeyOf(this.data.id);
      if (on !== this.data.dailyOn || heldKey !== this.data.heldKey) {
        this.setData({ dailyOn: on, heldKey: heldKey });
      }
    },

    heldKeyOf(id) {
      const hit = id ? store.deferList().filter((it) => it.wid === id && defer.isHeld(it))[0] : null;
      return hit ? defer.levelOfSpan(hit.span).key : "";
    },

    onDefer(e) {
      const level = defer.levelOf(e.currentTarget.dataset.key);
      const item = this.current();
      if (!level || !item) return;
      const on = this.data.heldKey !== level.key;
      if (on) defer.put(item.id, level.key);
      else defer.drop(item.id);
      sync.markDirty();
      this.setData({ heldKey: on ? level.key : "" });
      wx.showToast({ title: on ? level.label : "已取消「" + level.label + "」", icon: "none" });
      this.triggerEvent("defer", { id: item.id, key: level.key, on: on });
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
      wx.showToast({ title: r.on ? "已加入今日加背" : "已移出今日加背", icon: "none" });

      this.triggerEvent("change", { count: store.dailyExtra().length });
    },

    onTierGate() {
      entitlement.openPricing();
    },

    dailyMsg(r) {
      if (r.code === "E_LIMIT") return "今日已加背 " + store.DAILY_EXTRA_MAX + " 首，请先背完再添加";
      if (r.code === "E_STORAGE") return "添加失败：本机存储空间不足或未开启存储";
      return "添加失败";
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
        wx.showToast({ title: "读音表尚未生成", icon: "none" });
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
      const fontSize = scale.clamp(this.data.fontSize + delta);
      if (fontSize === this.data.fontSize) return;
      this.setData(Object.assign({ fontSize }, scale.flags(fontSize)));
      store.saveSettings({ fontSize });
      if (this.data.rawText) this.applyReading();
    },

    onResult(e) {
      if (guard.gap("sheet:result")) return;
      if (!entitlement.can("daily")) {
        wx.showToast({ title: entitlement.hint("daily"), icon: "none" });
        return;
      }
      const result = e.currentTarget.dataset.key;
      sfx.recite(result);
      const settings = store.settings();
      const rec = R.review(store.getRecord(this.data.id), result, settings.algo);
      store.setRecord(this.data.id, rec);
      sync.markDirty();
      guard.mark("sheet:result");

      this.setData({
        stage: R.stageName(rec, settings.algo) + " · 掌握 " + R.levelName(rec && rec.level),
        mastery: R.mastery(rec),
        hint: R.resultHint(settings.algo, result, rec)
      });

      this.cancelAdvance();
      this.advance = setTimeout(() => this.goNext(), 700);
    },

    cancelAdvance() {
      if (this.advance) clearTimeout(this.advance);
      this.advance = 0;
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
      this.cancelAdvance();
      if (this.data.index <= 0) return;
      this.setData({ index: this.data.index - 1 });
      this.loadCurrent();
    },

    onNext() {
      this.cancelAdvance();
      if (this.data.index + 1 >= this.data.queue.length) return;
      this.setData({ index: this.data.index + 1 });
      this.loadCurrent();
    },

    noop() {}
  }
});
