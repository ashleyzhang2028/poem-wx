const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const R = require("../../utils/review-models");
const E = require("../../utils/entitlement");

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
    lines: [],
    translation: "",
    translationSource: "",
    hasTranslation: false,
    showTranslation: false,
    align: "center",
    fontSize: 0,
    locked: false,
    lockedHint: "",
    stage: "新学",
    mastery: 0,
    hint: "",
    results: RESULTS
  },

  onLoad(query) {
    // 深链与分享能绕过首页直达详情，所以这里也认一次登录
    if (!E.can("recite.basic").ok) {
      this.setData({ locked: true, lockedHint: E.hint("recite.basic") });
      wx.setNavigationBarTitle({ title: "需要登录" });
      return;
    }
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
    const lines = String(entry.text || "").split("\n").map((t) => ({ t }));

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
    if (!E.block("pinyin.helper", { page: this })) return;
    const pinyin = e.currentTarget.dataset.m;
    store.saveSettings({ pinyin });
    // 注音依赖读音表，第一版只记住偏好，渲染留待读音表接入后开启
    wx.showToast({ title: pinyin === "off" ? "已关闭注音" : "注音将在下个版本接入", icon: "none" });
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

  onSpeak() {
    if (!E.block("read.aloud", { page: this })) return;
    if (!this.data.lines.length) return;
    // 朗读用微信同声传译插件的系统 TTS 会额外收费，这里先用小程序自带的朗读接口
    // 不可用时明确告知，不做静默失败
    if (!wx.createInnerAudioContext) {
      wx.showToast({ title: "当前环境不支持朗读", icon: "none" });
      return;
    }
    wx.showToast({ title: "朗读功能需要接入 TTS 服务", icon: "none" });
  },

  onResult(e) {
    if (!E.block("recite.basic", { page: this })) return;
    const result = e.currentTarget.dataset.r;
    const settings = store.settings();
    const rec = R.review(store.getRecord(this.data.id), result, settings.algo);
    store.setRecord(this.data.id, rec);

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
