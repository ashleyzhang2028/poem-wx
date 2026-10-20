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

const RESULTS = [
  { key: "bad", icon: icons.frown, label: "忘记", cls: "bad" },
  { key: "fuzzy", icon: icons.meh, label: "模糊", cls: "fuzzy" },
  { key: "good", icon: icons.smile, label: "记住", cls: "good" }
];

const FONT_MIN = -2;
const FONT_MAX = 6;

const REOPEN_MS = 400;

const TRANSIENT_ERR = /1020|timeout|timed? ?out|ETIMEDOUT|ENET|网络|超时|请稍后|-1\b/i;

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
    loadingText: false,
    textMiss: "",
    syncable: false,
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
    fontMin: FONT_MIN,
    fontMax: FONT_MAX,
    pinyinModes: PINYIN_MODES,
    pinyinMode: "off",
    pinyinOn: false,

    mastery: 0,
    hint: "",
    results: RESULTS,
    icons: PAGE_ICONS,

    dailyOn: false
  },

  attached() {
    this.pushed = false;
    this.closedAt = 0;
    this.lastPush = "";
    this.loadToken = 0;
    this.textErr = "";
    this.errSay = "";
    this.missAt = -1;
  },

  detached() {
    this.cancelAdvance();
    this.cancelLoad();
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
      this.cancelLoad();
      this.setData({ open: true, index: idx, queue: list });
      this.loadCurrent();
    },

    onClose() {
      if (this.closedAt && Date.now() - this.closedAt < REOPEN_MS) return;
      this.cancelAdvance();
      this.closedAt = Date.now();
      this.pushed = false;
      this.cancelLoad();
      this.setData({ open: false, loadingText: false, showTranslation: false, hint: "" });
    },

    cancelLoad() {
      this.loadToken = (this.loadToken || 0) + 1;
    },

    failText() {
      if (!sync.ready()) return "登录后能取回这一首的正文";
      return "再取一次";
    },

    whyText() {
      const code = this.textErr;
      if (code === "E_NO_ENTRY") return "这一首不在正文分片的清单里。";
      if (code === "E_NO_TEXT") return "这一片的正文不完整。";
      if (code === "E_NO_SHARDS") return "服务端这个版本没带正文分片。";
      if (code === "E_NO_SHARD_SERVICE") return "这个包没接上取正文的服务。";
      if (/102002|timed? ?out/i.test(this.errSay)) return "取正文超时了，多半是服务刚被唤醒。";
      if (/invalid host|env not exists|service not found/i.test(this.errSay)) return "平台按服务名找不到取正文的服务。";
      if (/网络|不通/.test(this.errSay)) return "网络不通。";
      return "";
    },

    retryable() {
      if (!sync.ready()) return false;
      return TRANSIENT_ERR.test(this.textErr + " " + this.errSay);
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
      if (!sync.ready()) return "这一首的正文没取到，登录后能取回来。";
      const why = this.whyText();
      if (why) return "这一首的正文没取到。" + why + (this.retryable() ? "再取一次。" : "");
      return "这一首的正文没取到。多半是网络没通，再取一次。";
    },

    markMissing(item) {
      this.setData(Object.assign(
        {
          loadingText: false,
          blocks: [],
          tokens: [],
          textMiss: this.missText(),
          syncable: this.retryable()
        },
        item ? this.missHead(item) : {}
      ));
      if (this.data.id && this.missAt === this.data.index) return;
      this.missAt = this.data.index;
      this.askMissing(item);
    },

    askMissing(item) {
      const why = this.whyText();
      const name = (item && item.title) || "";
      wx.showModal({
        title: "正文加载",
        content: "第 " + (this.data.index + 1) + " / " + this.data.queue.length + " 首"
          + (name ? "「" + name + "」" : "") + "的正文没取到。"
          + (why ? "\n\n" + why : "")
          + "\n\n" + (sync.ready() ? "点「同步」再取一次。" : "登录后能取回这一首的正文。"),
        confirmText: "同步",
        cancelText: "取消",
        success: (res) => {
          if (res.confirm) this.onSyncText();
        }
      });
    },

    onSyncText() {
      if (!sync.ready()) {
        wx.showToast({ title: this.failText(), icon: "none" });
        return;
      }
      const item = this.current();
      if (!item || this.data.loadingText) return;
      corpus.forgetText(item.id);
      this.fetchText(item);
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
      this.cancelLoad();
      const meta = corpus.indexById(item.id);
      const hit = corpus.entry(item.id);
      if (hit && meta) {
        this.renderCurrent(item, hit, meta);
        return;
      }
      this.fetchText(item);
    },

    fetchText(item) {
      this.cancelLoad();
      const token = this.loadToken;
      this.setData({
        open: true,
        loadingText: true,
        showTranslation: false,
        hint: "",
        blocks: [],
        tokens: [],
        textMiss: "",
        syncable: sync.ready()
      });

      corpus
        .ensureEntry(item.id)
        .then((entry) => {
          if (token !== this.loadToken) return;
          const got = entry || corpus.entry(item.id);
          const now = corpus.indexById(item.id);
          if (!got || !now) throw new Error("这一首的正文没取到");
          this.cancelLoad();
          this.renderCurrent(item, got, now);
        })
        ["catch"]((err) => {
          if (token !== this.loadToken) return;
          this.cancelLoad();
          this.textErr = (err && err.code) || "";
          this.errSay = (err && err.message) || "";
          this.markMissing(item);
        });
    },

    renderCurrent(item, entry, meta) {
      const settings = store.settings();
      const rec = store.getRecord(item.id);
      const fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, Number(settings.fontSize) || 0));

      this.setData({
        id: item.id,
        bookId: meta.b,
        title: meta.t,
        author: meta.a,
        dynasty: meta.d,
        source: meta.s || meta.n || "",
        selection: meta.sel || "",
        aliasText: aliasTextOf(meta),
        loadingText: false,
        textMiss: "",
        syncable: sync.ready(),
        rawText: entry.text,
        tableView: table.hasTable(entry.text),
        translation: entry.tr || "",
        translationSource: entry.src || "",
        hasTranslation: !!entry.tr,
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
      if (on !== this.data.dailyOn) this.setData({ dailyOn: on });
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

      this.triggerEvent("change", { count: store.dailyExtra().length });
    },

    onTierGate() {
      entitlement.openTierPage();
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
      const result = e.currentTarget.dataset.key;
      sfx.recite(result);
      const settings = store.settings();
      const rec = R.review(store.getRecord(this.data.id), result, settings.algo);
      store.setRecord(this.data.id, rec);
      sync.markDirty();

      this.setData({
        stage: R.stageName(rec, settings.algo),
        mastery: Math.round((R.clampLevel(rec.level) / 9) * 100),
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
