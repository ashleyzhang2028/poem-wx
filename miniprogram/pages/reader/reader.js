const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const R = require("../../utils/review-models");
const pinyin = require("../../utils/pinyin");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");

const RESULTS = [
  { key: "bad", label: "忘记", cls: "bad" },
  { key: "fuzzy", label: "模糊", cls: "fuzzy" },
  { key: "good", label: "记住", cls: "good" }
];

/* 与设置页同一套档位 —— 阅读页是「当场要调一下」的地方，
   两个页面给出不同的范围，用户会以为设置没生效 */
const FONT_MIN = -2;
const FONT_MAX = 4;

/* 对齐与注音都做成图标分段控件：图标说「是什么」，文字只是补充。
   key 同时是图标的类名后缀（.ic-left / .ic-rare …），纯 CSS 画的，
   不引图片 —— 主包只有 0.7MB 余量，拿体积换几个方块不划算。 */
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

    // 这一页**没有任何朗读元素**：TTS 通道个人主体申请不下来，
    // 用户 2026-10-02 明确裁决不做。见 docs/todo.md 第 1 条。
    // 留一个「待开通」的灰按钮等于每次进来都杵着一块死内容 —— 没有比没有更糟。

    /** 未登录时整页换成一句话 —— 不从 URL 放行，也不渲染半张空壳 */
    locked: true,
    lockTitle: "登录后可用",
    lockNote: ""
  },

  onLoad(query) {
    this.setData({ id: query.id || "" });
  },

  /**
   * 门禁与内容装载都在 onShow 里做，因为从「去登录」回来时 onLoad 不会再跑 ——
   * 放在 onLoad 就会出现「登录成功了，页面还锁着」。
   */
  onShow() {
    if (!gate.logged()) {
      // 没登录就直说。不静默跳走、不渲染半页再弹窗 ——
      // 用户从分享链接点进来，看到的第一句应该是为什么。
      this.setData({
        locked: true,
        lockTitle: "这篇要登录",
        lockNote: "登录后才能看正文与进度"
      });
      return;
    }
    // 登录了就把锁摘掉。这一行与上面那个分支是一对：
    // 只设 true 不设 false，等于给所有人上锁 —— 页面永远停在那张卡上
    if (this.data.locked) this.setData({ locked: false });
    if (!this.loaded) this.loadEntry();
    this.applyReading();
  },

  loadEntry() {
    const id = this.data.id;

    const settings = store.settings();
    const entry = corpus.entry(id);
    const meta = this.findMeta(id);

    if (!entry || !meta) {
      this.setData({ id });
      wx.showToast({ title: "篇目数据缺失", icon: "none" });
      return;
    }

    const rec = store.getRecord(id);
    // 版式（段落 / 折行 / 断句）只此一份，在 corpus.layout()。
    // 七绝律诗一句一行是作者排的；《琵琶行》的序、《左传》的长句折开之后
    // 一句一行才读得下去 —— 整行当一个块排，居中是一坨、断句也无从谈起。
    const laid = corpus.layout(entry.text);

    this.setData({
      id,
      bookId: meta.b,
      title: meta.t,
      author: meta.a,
      dynasty: meta.d,
      source: meta.s || meta.n,
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

    // 从设置页回来、或刚登录完，注音状态可能变了
    this.applyReading();
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },


  /**
   * 注音：不可用就不渲染 tokens，正文按原样走。
   * 门禁与 readiness 是两件事 —— readiness 说「读音表在不在」，
   * 这里还要过一遍「这一档有没有注音」。上一版只看了前面的，
   * 于是 free 档点一下开关照样能注音。
   */
  applyReading() {
    const pr = pinyin.readiness();
    const allowed = entitlement.can("pinyin");
    const usable = pr.usable && allowed;
    const mode = usable ? store.settings().pinyin : "off";
    // 段落由 corpus.layout() 给（含标点），这里只管标音。
    // 标音时消歧窗口是**整行** —— 分组的事交给它，不在这重复。
    const tokens = usable ? pinyin.render(this.data.paras, mode) : [];
    this.setData({ pinyinOn: usable, pinyinMode: mode, tokens });
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

  /* ---------- 背诵评分 ---------- */

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
