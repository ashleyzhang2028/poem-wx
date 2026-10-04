/**
 * 背诵弹层：从页面底部推上来的那张卡。
 *
 * 由来（用户 2026-10-03）：
 *   「首页的今日古诗背诵，当用户点击古诗，他不是从页面底部弹出详情页去背诵吗？
 *     请参考 /poem 代码库。这种弹出卡片式方便用户背完随即进入下一首，
 *     而不需要页面之间的切换。」
 *
 * 网页版就是这个做法：`#modal` 的 `.modal-box` 在 `align-items: flex-end` 的
 * 容器里，从底部滑上来；`handleResult()` 里评完分就 closeModal + 重排今日列表 ——
 * 整个过程一次页面跳转都没有。小程序这边原来走的是 navigateTo 详情页，
 * 背完再 redirectTo 到下一首，每一次都是**整页重建**（导航动画 + 一屏空白）。
 *
 * 所以这一版把「详情 + 评分」收进一个组件，首页点篇名／点「开始背」都走它：
 *   · 打开时把这首**插进今日队列**（网页版的 openPoem(p, planItem) 也是这么给的）
 *   · 评完分顺势进队列下一首（网页版关掉弹层回列表，小程序多走半步）
 *   · 队列走完，弹层自己收掉 —— 用户回到列表上，勾已经点好了
 *
 * 它只负责「读 + 评分 + 翻页」，**不发网络、不查门禁** ——
 * 那是页面的事（gate / sync），组件替页面做决定，页面就没法统一口径。
 */
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

/* 与通用设置页同一套档位（详情页原本就是从 settings 读的）。
   区间只给端点按钮用，值本身仍是设置里那一份 —— 在弹层里调一次，
   下次打开、以及设置页，看到的都是同一个数。 */
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

Component({
  options: {
    // 弹层内的 fixed 定位要罩住整屏，不能被组件的 shadow 根裁掉
    addGlobalClass: true
  },

  properties: {
    /** 页面那支主题色（`theme.apply()` 塞在页面 data 里的那一串变量）。
        组件不在页面根节点的内联样式作用范围内，`page{}` 上那一份
        var(--theme) 也够不着组件自己的节点 —— 所以显式接一份，
        挂在 .sheet 上，卡里的按钮 / 选中态 / 大数字才跟着主题走。
        没有它，换主题之后这张卡永远是默认那支墨，而**这是用户走过去才发现**
        的那类漏（截图里看不出：它只是「没换色」，不像坏了）。 */
    themeStyle: { type: String, value: "" },

    /** 队列：首页今日计划那一份 `[{ id, title, reasonKey, reason }]`。
        空数组 = 不显示。用它而不是单个 id，是因为「下一首」这件事
        只有首页知道（它的计划里有复习轮次、加背这些它自己排的东西）。 */
    queue: {
      type: Array,
      value: [],
      observer() {
        if (this.data.open) this.loadCurrent();
      }
    }
  },

  data: {
    open: false,
    /** 队列里的第几首 —— 「第 3 / 5 首」那行小字靠它 */
    index: 0,
    total: 0,
    navText: "",

    id: "",
    bookId: "",
    title: "",
    author: "",
    dynasty: "",
    source: "",
    stage: "",
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

    mastery: 0,
    hint: "",
    results: RESULTS,

    /** 这一首是不是今天的加背（与详情页同一个判据：store） */
    dailyOn: false
  },

  attached() {
    this.loaded = false;
  },

  methods: {
    /** 打开：首页点篇目 / 点「开始背」都走这里 —— 由 `queue` 决定从哪一首起 */
    open(queue, id) {
      const list = (queue || []).slice();
      if (!list.length) return;
      const idx = Math.max(0, list.findIndex((it) => it.id === id));
      this.setData({ open: true, index: idx });
      this.loadCurrent();
    },

    onClose() {
      this.setData({ open: false, showTranslation: false, hint: "" });
    },

    /** 队列里当前这一首 —— 页面在打开之后把队列换掉（勾了、重排了），这里也认 */
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
        wx.showToast({ title: "篇目数据缺失", icon: "none" });
        this.onClose();
        return;
      }

      const settings = store.settings();
      const rec = store.getRecord(item.id);
      const laid = corpus.layout(entry.text);

      this.setData({
        id: item.id,
        bookId: meta.b,
        title: meta.t,
        author: meta.a,
        dynasty: meta.d,
        source: meta.s || meta.n,
        paras: laid.paras,
        translation: entry.translation || "",
        translationSource: entry.src || "",
        hasTranslation: !!entry.translation,
        showTranslation: false,
        align: settings.align,
        fontSize: settings.fontSize,
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
      // 翻页时把这一首的「身份」也说给首页听：它要重排列表、点亮勾
      this.triggerEvent("open", { id: item.id });
    },

    /**
     * 注音：不可用就不渲染 tokens，正文按原样走。
     * 门禁与 readiness 是两件事 —— readiness 说「读音表在不在」，
     * 这里还要过一遍「这一档有没有注音」。
     */
    applyReading() {
      const pr = pinyin.readiness();
      const allowed = entitlement.can("pinyin");
      const usable = pr.usable && allowed;
      const mode = usable ? store.settings().pinyin : "off";
      const tokens = usable ? pinyin.render(this.data.paras, mode) : [];
      this.setData({ pinyinOn: usable, pinyinMode: mode, tokens });
    },

    /** 翻到哪一首，那一首的加背状态就重算一次 —— 翻页不刷新它就会串味 */
    syncDaily() {
      const on = store.dailyExtra().indexOf(this.data.id) >= 0;
      if (on !== this.data.dailyOn) this.setData({ dailyOn: on });
    },

    /** 加 / 移当前这一首。判断在 store.toggleDailyExtra()，这里只翻人话 */
    onToggleDaily() {
      const r = store.toggleDailyExtra(this.data.id);
      if (!r.ok) {
        wx.showToast({ title: this.dailyMsg(r), icon: "none" });
        return;
      }
      this.setData({ dailyOn: r.on });
      wx.showToast({ title: r.on ? "已加入今日背诵" : "已移出今日背诵", icon: "none" });
      // 加背变了，队列也跟着变（首页要重排，可能就从这一列里多出 / 少掉一首）
      this.triggerEvent("change", { count: store.dailyExtra().length });
    },

    dailyMsg(r) {
      if (r.code === "E_LIMIT") return "今天已经加了 " + store.DAILY_EXTRA_MAX + " 首，先背完再加";
      if (r.code === "E_STORAGE") return "加不进去：本机存储用不了";
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
      this.applyReading();
    },

    /* 字号一步一档，与详情页/设置页同一套区间。
       到头了就不动（界面上那一头退成灰），不做「到头了还存一次」这种事。 */
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
    },

    /* ---------- 评分与翻页 ---------- */

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
      // 评分这一下要让人看见（掌握度涨了、提示语出来了），再翻页 ——
      // 网页版是先弹一句 toast 再关弹层，这里把那一下留在卡片里
      setTimeout(() => this.goNext(), 700);
    },

    /** 背完这一首顺势进下一首；队列到头就把弹层收掉，人回到列表上 */
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

    /** 上一首：翻回去看看可以，但不改评分 —— 评分只由那三格写 */
    onPrev() {
      if (this.data.index <= 0) return;
      this.setData({ index: this.data.index - 1 });
      this.loadCurrent();
    },

    /** 点遮罩：与详情页的返回同义 —— 走人，不评分 */
    noop() {}
  }
});
