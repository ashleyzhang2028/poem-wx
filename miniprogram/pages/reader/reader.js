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
    align: "center",
    fontSize: 0,
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
    const mode = e.currentTarget.dataset.m;
    if (!pinyin.setMode(mode)) {
      wx.showToast({ title: "读音表未生成", icon: "none" });
      return;
    }
    this.applyReading();
  },

  onAlign(e) {
    const align = e.currentTarget.dataset.a;
    this.setData({ align });
    store.saveSettings({ align });
  },

  onFont(e) {
    const delta = Number(e.currentTarget.dataset.d);
    const fontSize = Math.max(-2, Math.min(4, this.data.fontSize + delta));
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
      // 不静默失败：说清是哪一步没就绪
      wx.showModal({
        title: r.state === "denied" ? "朗读未授权" : "朗读通道待接入",
        content: r.reason,
        showCancel: false
      });
      return;
    }
    this.ensurePlayer().start();
  },

  onSpeakToggle(e) {
    const idx = e.currentTarget.dataset.i;
    if (!speech.readiness().usable) {
      this.onSpeak();
      return;
    }
    this.ensurePlayer().toggle(typeof idx === "number" ? idx : undefined);
  },

  onSpeakPause() {
    if (this.player) this.player.pause();
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
