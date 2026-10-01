const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const R = require("../../utils/review-models");
const speech = require("../../utils/speech");
const pinyin = require("../../utils/pinyin");
const sync = require("../../utils/sync");

const RESULTS = [
  { key: "bad", label: "忘记", cls: "bad" },
  { key: "fuzzy", label: "模糊", cls: "fuzzy" },
  { key: "good", label: "记住", cls: "good" }
];

/** 整篇读完到自动跳下一首之间留一口气，不然会显得被赶着走 */
const AUTO_NEXT_GAP = 900;

/* 与设置页同一套档位 —— 阅读页是「当场要调一下」的地方，
   两个页面给出不同的范围，用户会以为设置没生效 */
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

Page({
  data: {
    id: "",
    bookId: "",
    title: "",
    author: "",
    dynasty: "",
    source: "",
    lines: [],
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

    // 以下三项是「朗读是否出现在这个界面上」的全部依据。
    // speakVisible 为假时，工具栏整块、设置里的朗读卡、我的页入口都不渲染。
    speakVisible: false,
    speakReady: false,
    speakState: "denied",
    speakReason: "",
    speakLabel: "",
    speakPlaying: false,
    speakLoading: false,
    speakIndex: 0,
    speakTotal: 0
  },

  onLoad(query) {
    const id = query.id || "";
    const settings = store.settings();
    const entry = corpus.entry(id);
    const meta = this.findMeta(id);

    if (!entry || !meta) {
      this.setData({ id });
      wx.showToast({ title: "篇目数据缺失", icon: "none" });
      return;
    }

    const rec = store.getRecord(id);
    const lines = String(entry.text || "").split("\n");

    this.setData({
      id,
      bookId: meta.b,
      title: meta.t,
      author: meta.a,
      dynasty: meta.d,
      source: meta.s || meta.n,
      lines,
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

    this.applyReading();
    this.applySpeech();
  },

  onShow() {
    // 从设置页回来，注音与朗读状态可能都变了，重算一次
    this.applyReading();
  },

  onUnload() {
    if (this.player) this.player.destroy();
    this.player = null;
  },

  /** 注音：不可用就不渲染 tokens，正文按原样走 */
  applyReading() {
    const pr = pinyin.readiness();
    const mode = pr.usable ? store.settings().pinyin : "off";
    const tokens = pr.usable ? pinyin.render(this.data.lines, mode) : [];
    this.setData({ pinyinOn: pr.usable, pinyinMode: mode, tokens });
  },

  /**
   * 朗读：把「能不能用」换算成界面上的三个值。
   *   visible=false → 整个播放界面不存在
   *   ready=false   → 显示但灰着，点了给一句原因，不静默失败
   */
  applySpeech() {
    const r = speech.readiness();
    this.setData({
      speakVisible: r.visible,
      speakReady: r.usable,
      speakState: r.state,
      speakReason: r.reason,
      speakLabel: r.state === "ready" ? "朗读" : "待开通"
    });
    if (!r.visible && this.player) {
      this.player.destroy();
      this.player = null;
    }
  },

  findMeta(id) {
    return corpus.indexById(id);
  },

  onToggleTranslation() {
    this.setData({ showTranslation: !this.data.showTranslation });
  },

  onPinyin(e) {
    const mode = e.detail.value;
    if (!pinyin.setMode(mode)) {
      wx.showToast({ title: "读音表未生成", icon: "none" });
      return;
    }
    this.applyReading();
  },

  onAlign(e) {
    const align = e.detail.value;
    this.setData({ align });
    store.saveSettings({ align });
  },

  onFontSlide(e) {
    const fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, Number(e.detail.value)));
    if (fontSize === this.data.fontSize) return;
    this.setData({ fontSize });
    store.saveSettings({ fontSize });
  },

  /* ---------- 朗读 ---------- */

  ensurePlayer() {
    if (this.player) return this.player;
    this.player = speech.create({
      onChange: (s) =>
        this.setData({
          speakPlaying: s.playing,
          speakLoading: s.loading,
          speakIndex: s.index,
          speakTotal: s.total
        }),
      onFinish: () => this.onSpeakFinish(),
      onError: (err) => wx.showToast({ title: err.message || "朗读失败", icon: "none" })
    });
    this.player.load(this.data.lines.map((t) => ({ text: t, gap: 320 })));
    return this.player;
  },

  onSpeak() {
    const r = speech.readiness();
    if (!r.visible) return;

    if (!r.usable) {
      // 按钮此时是灰的、点不动；这一句是兜住「刚好在这一刻掉线」，
      // 所以给 toast 而不是弹窗 —— 弹窗是「要你决定」，这里只是「告诉你」
      wx.showToast({ title: r.reason || "朗读通道没就绪", icon: "none", duration: 2500 });
      return;
    }
    this.ensurePlayer().start();
  },

  /** 拖进度条 = 指定从第几句起播 */
  onSpeakSeek(e) {
    if (!this.player) return;
    this.player.seek(Number(e.detail.value));
  },

  onSpeakToggle(e) {
    const idx = e.currentTarget.dataset.i;
    if (!speech.readiness().usable) {
      this.onSpeak();
      return;
    }
    this.ensurePlayer().toggle(typeof idx === "number" ? idx : undefined);
  },

  onSpeakNext() {
    if (this.player) this.player.next();
  },

  onSpeakPrev() {
    if (this.player) this.player.prev();
  },

  onSpeakStop() {
    if (this.player) this.player.stop();
  },

  onSpeakFinish() {
    if (!store.settings().speechAutoNext) return;
    setTimeout(() => {
      if (this.data.speakVisible) wx.showToast({ title: "读完了，自己接着背吧", icon: "none" });
    }, AUTO_NEXT_GAP);
  },

  /* ---------- 背诵评分 ---------- */

  onResult(e) {
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
    setTimeout(() => this.goNext(), 700);
  },

  /** 背完一首直接跳今日下一首，省得退回列表再点 */
  goNext() {
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

  onShareAppMessage() {
    return { title: this.data.title + " · " + this.data.author, path: "/pages/reader/reader?id=" + this.data.id };
  }
});
