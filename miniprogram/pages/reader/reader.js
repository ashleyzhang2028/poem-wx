const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const R = require("../../utils/review-models");
const speech = require("../../utils/speech");
const pinyin = require("../../utils/pinyin");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");

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
    speakTotal: 0,

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
        lockNote: "从分享链接直接点进来也一样要微信登录。登录只为两件事：把进度带走、让管理员知道档位发给谁 —— 不读你的隐私信息。"
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
    // 一句一行才读得下去 —— 整行当一个块排，居中是一坨、朗读整段一起合成。
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

    // 从设置页回来、或刚登录完，注音与朗读状态都可能变了
    this.applyReading();
    this.applySpeech();
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onUnload() {
    if (this.player) this.player.destroy();
    this.player = null;
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
    // 按**句**合成：整行交给 TTS，长一段听下来断不开，也没法「只听这一句」。
    // 顺序取自 segments()，与注音里的 `cl.i` 同序 —— 朗读报「第 5 句」，
    // 正文凭它找到那一行；两处各数一遍，早晚会差一句。
    // 标点交给通道自己断 —— 少了标点，`，` 与 `。` 的停顿差别就没了。
    this.player.load(this.segments().map((sg) => ({ text: sg.text, gap: 320 })));
    return this.player;
  },

  /**
   * 拍平的句子表，**与注音 tokens 同序**。
   * 版式只有一份（corpus.layout），顺序也只有这一处算 ——
   * 朗读按它合成、注音按同一份编号，界面才可能对得上。
   */
  segments() {
    const out = [];
    (this.data.paras || []).forEach((para) => {
      (para || []).forEach((row) => {
        (row || []).forEach((clause) => {
          if (clause.trim()) out.push({ text: clause.trim() });
        });
      });
    });
    return out;
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
