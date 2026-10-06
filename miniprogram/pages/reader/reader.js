const corpus = require("../../utils/corpus");
const AI = require("../../utils/author-index");
const store = require("../../utils/store");
const R = require("../../utils/review-models");
const pinyin = require("../../utils/pinyin");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");
const theme = require("../../utils/theme");

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
   不引图片 —— 主包只有 0.7MB 余量，拿体积换几个方块不划算。

   ## 文案取全称，不缩写

   这两组控件也出现在详情页那一行里（用户 2026-10-03：
   「一行内显示（整体居中）：左对齐 居中 不注音 生字 全文 A- A+」）。
   一度想过在详情页把档名缩成单字给字号腾宽度，但用户那句话里每个档
   都是全称 —— 缩字是他没要的东西。宽度靠别处省：这一行把字收一档
   （--fs-caption），七段量出来 499rpx，卡片内容宽 596rpx，够。
   算式与读数写在 reader.wxss 的 .prefs 一节。 */
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

    /** 这一首是不是今天的加背。与偏好那几项分开存 —— 它不是版式偏好 */
    dailyOn: false,

    // 这一页**没有任何朗读元素**：TTS 通道个人主体申请不下来，
    // 用户 2026-10-02 明确裁决不做。见 docs/todo.md 第 1 条。
    // 留一个「待开通」的灰按钮等于每次进来都杵着一块死内容 —— 没有比没有更糟。

    /** 未登录时整页换成一句话 —— 不从 URL 放行，也不渲染半张空壳 */
    locked: true,
    lockTitle: "登录后可用",
    lockNote: "",

    /**
     * 这位作者的名字 —— 作者索引进来时才有（`?from=李白`）。
     *
     * 它带来的只有一件事：**评完分往下的那一首不跨作者**。
     * 用户对作者索引的原话是「详情页的上一页下一页都是该作者的作品」——
     * 小程序端的「下一页」只有一处，就是评完分自动跳的那一首
     * （`goNext()`），所以这一条落在那儿。
     *
     * 存成 `creator`（不是 `from`）：`from` 是 URL 上的参数名，
     * 存进 data 会让「这一页自己认不认得出来源」与「URL 怎么写」
     * 变成同一个词 —— 改 URL 就改了语义。
     */
    creator: ""
  },

  onLoad(query) {
    this.setData({ id: query.id || "", from: query.from || "" });
  },

  /**
   * 门禁与内容装载都在 onShow 里做，因为从「去登录」回来时 onLoad 不会再跑 ——
   * 放在 onLoad 就会出现「登录成功了，页面还锁着」。
   */
  onShow() {
    theme.apply(this);
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
    // 从设置页回来时，这一首可能已被移出今日加背 —— 按钮得跟着变
    this.syncDaily();
  },

  /**
   * 这一首在不在今天的加背里。
   * 存的是 id 列表，不是每首一个标志位 —— 真相只有一处（store），
   * 页面这一格只是它的一次投影。
   */
  syncDaily() {
    const on = store.dailyExtra().indexOf(this.data.id) >= 0;
    if (on !== this.data.dailyOn) this.setData({ dailyOn: on });
  },

  /**
   * 加 / 移这一首。
   * 判断（上限、去重、两态）全在 store.toggleDailyExtra()，
   * 页面只把 code 翻成人话 —— 措辞散在十几处，口径早晚不一致。
   */
  onToggleDaily() {
    const r = store.toggleDailyExtra(this.data.id);
    if (!r.ok) {
      wx.showToast({ title: this.dailyMsg(r), icon: "none" });
      return;
    }
    this.setData({ dailyOn: r.on });
    wx.showToast({ title: r.on ? "已加入今日背诵" : "已移出今日背诵", icon: "none" });
    sync.markDirty();
  },

  /** 加背失败时那句话。四种 code 各有各的下场，不说清等于没说 */
  dailyMsg(r) {
    if (r.code === "E_LIMIT") return "今天已经加了 " + store.DAILY_EXTRA_MAX + " 首，先背完再加";
    if (r.code === "E_STORAGE") return "加不进去：这台手机存不下（空间不足或未开启存储）";
    return "加不进去";
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
    this.setData({ creator: this.data.from || "" });
    this.syncDaily();

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
    // 注音口径也是「我这一套」的一部分，换部手机该还是这个
    sync.markDirty();
  },

  onAlign(e) {
    const align = e.detail.value;
    this.setData({ align });
    store.saveSettings({ align });
    // 对齐方式也要跨设备（用户 2026-10-04：登录之后一切跟着账号走）。
    // markDirty 只记账、不发网络，随写随调不心疼。
    sync.markDirty();
  },

  /* 字号：这一行装的是两个端点按钮，不是滑块。
     滑块要有横向量程才操作得准（原来那一版给它整行），而这一行要装
     对齐 / 注音 / 字号三组，量程放不下 —— 一步一档的按钮反而正好。
     到头了就不动（界面上那一头退成灰，见 .pref-opt.off），
     不做「到头了还存一次」这种事。 */
  onFontDown() {
    this.stepFont(-1);
  },

  onFontUp() {
    this.stepFont(1);
  },

  stepFont(delta) {
    const fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, this.data.fontSize + delta));
    if (fontSize === this.data.fontSize) return;
    this.setData({ fontSize });
    store.saveSettings({ fontSize });
    sync.markDirty();
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

  /**
   * 背完一首往下一首走。**下一首在哪，取决于从哪进来的。**
   *
   * 从作者索引进来的（`?from=李白`）：下一首是**这一位作者名下**的下一首 ——
   * 用户对作者索引的原话是「详情页的上一页下一页都是该作者的作品」。
   * 走到头就退回**这位作者的作品列表**（不是退回集子，也不是回默认的
   * 今日计划）—— 那才是「返回就回到李白列表」。
   *
   * 从集子列表进来的：还是原来那一条（同一部集子里的下一首未读），
   * 走完退回列表页。这一条一个字没改，作者索引只是**多了一个入口**。
   *
   * ⚠️ 作者的作品顺序取的是 `author-index` 摆好的那一份（按集子 + 组 + id），
   *    与②层列出来的一模一样 —— 两处各自排一遍，早晚对不上，
   *    而且「列表里看到的顺序」与「下一篇的顺序」不一致，用户会当成 bug。
   */
  goNext() {
    if (this.data.creator) {
      this.goNextInAuthor();
      return;
    }
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

  /** 作者名下的下一首。走到头就回到**这位作者的列表**（返回栈上那一层） */
  goNextInAuthor() {
    const next = this.siblingInAuthor(1);
    if (!next) {
      // 到头了：退回作者索引那一页（它就在返回栈上一层，②层还记得是哪位）
      wx.navigateBack();
      return;
    }
    wx.redirectTo({
      url: "/pages/reader/reader?id=" + encodeURIComponent(next) +
        "&from=" + encodeURIComponent(this.data.creator)
    });
  },

  /**
   * 同一位作者名下的邻居（`delta` = ±1）。没有就返回空串 ——
   * **不跨作者**：跨了就不是「该作者的作品」了。
   *
   * ⚠️ 名单**必须**与作者索引②层列出来的是同一份，否则「列表里看到的
   *    顺序」与「下一篇跳到的顺序」对不上（李白那儿差 17 条：写作里
   *    写着「李白」的 77 条，名册判重之后只收 60 条）。
   *
   *    所以这里不自己筛，而是**现算一遍名册**（`AI.build`，488 位 60ms），
   *    再从里面取这一位 —— 与作者索引那一页走的是同一个函数、同一份判重。
   *    现算而不是把那 60 个 id 顺着 URL 传过来：一条 URL 塞 60 个 id
   *    又长又脆（上一个页面改判重口径、这边就拿到一份过期名单），
   *    而 60ms 是一次点击的量级，不是每帧。
   *
   *    第一次算完缓起来（`this.rosterCache`）—— 同一位作者连翻十首，
   *    不该算十遍。
   */
  siblingInAuthor(delta) {
    const who = this.data.creator;
    if (!who) return "";
    if (!this.rosterCache) {
      const entries = [];
      AI.LIT_BOOKS.forEach((b) => {
        corpus.ofBook(b).forEach((p) => entries.push(p));
      });
      this.rosterCache = AI.build(entries);
    }
    const ids = AI.worksOf(this.rosterCache, who);
    const idx = ids.indexOf(this.data.id);
    if (idx < 0) return "";
    const at = idx + delta;
    return at >= 0 && at < ids.length ? ids[at] : "";
  },

  onShareAppMessage() {
    return { title: this.data.title + " · " + this.data.author, path: "/pages/reader/reader?id=" + this.data.id };
  }
});
