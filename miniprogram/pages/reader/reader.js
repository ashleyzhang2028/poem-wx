const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const R = require("../../utils/review-models");
const pinyin = require("../../utils/pinyin");
const speech = require("../../utils/speech");
const entitlement = require("../../utils/entitlement");
const sync = require("../../utils/sync");

const RESULTS = [
  { key: "bad", label: "忘记", cls: "bad" },
  { key: "fuzzy", label: "模糊", cls: "fuzzy" },
  { key: "good", label: "记住", cls: "good" }
];

Page({
  data: {
    id: "",
    bookId: "",
    title: "",
    author: "",
    dynasty: "",
    source: "",
    /** 每行切成注音单元：[{c, py, on}]，on=false 表示这个字不标音 */
    lines: [],
    pinyinMode: "rare",
    hasPinyin: false,
    translation: "",
    translationSource: "",
    hasTranslation: false,
    showTranslation: false,
    align: "center",
    fontSize: 0,
    stage: "新学",
    mastery: 0,
    hint: "",
    results: RESULTS,
    /** 朗读状态 */
    speaking: false,
    ttsReady: false,
    ttsHint: "",
    algo: "ebbinghaus"
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

    this.setData({
      id,
      bookId: meta.b,
      title: meta.t,
      author: meta.a,
      dynasty: meta.d,
      source: meta.s || meta.n,
      translation: entry.translation || "",
      translationSource: entry.src || "",
      hasTranslation: !!entry.translation,
      align: settings.align,
      fontSize: settings.fontSize,
      pinyinMode: settings.pinyin,
      hasPinyin: pinyin.available(),
      stage: R.stageName(rec, settings.algo),
      mastery: rec && rec.learned ? Math.round((R.clampLevel(rec.level) / 9) * 100) : 0,
      algo: settings.algo
    });

    this.rawText = String(entry.text || "");
    this.renderLines();

    this.refreshTts();
    wx.setNavigationBarTitle({ title: meta.t });
    store.markRead(meta.b, id);
  },

  onUnload() {
    speech.stop();
  },

  onHide() {
    speech.stop();
    this.setData({ speaking: false });
  },

  findMeta(id) {
    return corpus.indexById(id);
  },

  refreshTts() {
    const g = speech.gate();
    this.setData({
      ttsReady: g.ok && speech.available(),
      ttsHint: g.ok ? (speech.available() ? "" : "TTS 服务未接通") : g.reason
    });
  },

  /**
   * 按当前注音模式把正文渲染成「注音单元」。
   *
   * 小程序端没有 <ruby>，拼音只能自己排版 —— 返回分段数组而不是 HTML，
   * 字号与行距交给 WXSS，运行时不拼字符串。这也避开了 rich-text 的白名单麻烦。
   */
  renderLines() {
    const mode = this.data.pinyinMode;
    const lines = String(this.rawText || "")
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => ({ units: pinyin.annotate(t, mode), t }));

    this.setData({ lines });
  },

  onPinyin(e) {
    const pinyinMode = e.currentTarget.dataset.m;
    store.saveSettings({ pinyin: pinyinMode });
    this.setData({ pinyinMode }, () => this.renderLines());

    if (pinyinMode !== "off" && !pinyin.available()) {
      wx.showToast({ title: "读音表未生成，先跑 build-data", icon: "none", duration: 2500 });
    }
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

  onToggleTranslation() {
    this.setData({ showTranslation: !this.data.showTranslation });
  },

  /**
   * 朗读。
   *
   * 只有正文，不带标题与译文 —— 背诗的时候听「静夜思 唐 李白」很出戏。
   * 句与句之间保留换行，TTS 自己会停顿；合成时按句读切段，见 utils/speech.js。
   */
  onSpeak() {
    if (this.data.speaking) {
      speech.stop();
      this.setData({ speaking: false });
      return;
    }

    if (!this.data.ttsReady) {
      wx.showModal({
        title: "朗读不可用",
        content: this.data.ttsHint || "TTS 服务未接通",
        showCancel: false,
        confirmText: "知道了"
      });
      return;
    }

    const text = String(this.rawText || "").replace(/\n/g, "");
    if (!text) return;

    this.setData({ speaking: true });
    speech.speak(text, {
      onEnd: () => this.setData({ speaking: false }),
      onError: (err) => {
        this.setData({ speaking: false });
        wx.showToast({ title: err.message || "朗读失败", icon: "none", duration: 2500 });
      }
    });
  },

  onResult(e) {
    const result = e.currentTarget.dataset.r;
    const settings = store.settings();
    const rec = R.review(store.getRecord(this.data.id), result, settings.algo);
    store.setRecord(this.data.id, rec);

    // 进度改动先落本机，再挂到同步队列。同步失败不影响背诵
    sync.enqueue(this.data.id, {
      level: rec.level,
      nextReviewAt: rec.nextReviewAt,
      learned: rec.learned,
      reps: rec.reps,
      history: (rec.history || []).slice(-200)
    });

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
    return {
      title: this.data.title + " · " + this.data.author,
      path: "/pages/reader/reader?id=" + this.data.id
    };
  }
});
