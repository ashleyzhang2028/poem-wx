const store = require("../../../utils/store");
const S = require("../../../utils/scheduler");
const R = require("../../../utils/review-models");
const E = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");

const GRADES = Object.keys(S.GRADE_NAMES).map((g) => Number(g));

const TERMS = [
  { value: 1, label: "上学期" },
  { value: 2, label: "下学期" }
];

/* 字号两档与阅读页同源：阅读页是「当场要调一下」的地方，
   两个页面给出不同的范围，用户会以为设置没生效。 */
const FONT_MIN = -2;
const FONT_MAX = 4;

/* 十二个年级一行放不下，取最近六年。**这一屏只用来调背诵范围**，
   年份的余数不必年年换；等真的有人抱怨「我只能背一年级」再补一条横滑。 */
const RECENT = 6;

/* 注音三档。与阅读页同一套 key，图标这一屏不要（见 WXML 里的注释）。 */
const PINYIN_MODES = [
  { key: "off", label: "不注音" },
  { key: "rare", label: "生字" },
  { key: "all", label: "全文" }
];

const ALIGNS = [
  { key: "left", label: "左对齐" },
  { key: "center", label: "居中" }
];

Page({
  data: {
    grades: [],
    terms: TERMS,
    grade: 1,
    term: 1,
    pinyinModes: PINYIN_MODES,
    pinyinMode: "off",
    aligns: ALIGNS,
    align: "center",
    fontSize: 0,
    fontMin: FONT_MIN,
    fontMax: FONT_MAX,
    /* 两颗字号按钮到没到头。判据在页面里算，不写进 WXML ——
       WXML 的 `{{fontSize >= fontMax}}` 里那个 `>` 会把标签提前截断，
       按钮文案的断言就量不准（一条两个字的按钮被判成十九个字）。 */
    fontCanDown: true,
    fontCanUp: true,
    scope: "upto",
    scopes: [],
    dailyCount: 5,
    counts: S.DAILY_COUNTS,
    algo: "ebbinghaus",
    algos: [],
    poolSize: 0,
    lockedHint: "",
    locked: false
  },

  onShow() {
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });
    const settings = store.settings();
    const scopes = Object.keys(S.SCOPES).map((k) => ({ key: k, label: S.SCOPES[k].label }));
    const grades = GRADES.filter((g) => g >= settings.grade && g < settings.grade + RECENT);

    this.setData(
      Object.assign({}, settings, {
        grades: grades.map((g) => ({ value: g, label: S.gradeName(g) })),
        scopes: scopes,
        algos: this.algoRows(settings.algo)
      }),
      () => {
        this.updatePool();
        this.syncFontBtns(settings.fontSize);
      }
    );
  },

  /**
   * 算法列表带门禁。
   * 上一版直接列四套、点击只提示「换算法不清进度」，但门禁其实会把它挡回去 ——
   * 那是个假按钮。这里把 allowed 提前算出来，界面照它灰掉。
   */
  algoRows(current) {
    return R.list().map((m) => {
      const allowed = E.algoAllowed(m.key);
      return {
        key: m.key,
        name: m.name,
        blurb: m.blurb,
        years: m.years,
        allowed,
        // 灰掉的那几套要说清为什么灰 —— 光一个 disabled 会让人以为是坏了
        lockHint: allowed ? "" : E.hint(m.key),
        active: m.key === current
      };
    });
  },

  updatePool() {
    const s = this.data;
    const pool = S.poolForScope({
      grade: s.grade,
      term: s.term,
      scope: s.scope,
      allPoems: require("../../../utils/corpus").course()
    });
    this.setData({ poolSize: pool.length });
  },

  save(patch) {
    store.saveSettings(patch);
    this.setData(Object.assign(patch, { algos: this.algoRows(patch.algo || this.data.algo) }), () =>
      this.updatePool()
    );
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  /* 单选组统一从这里取新值：radio-group 的 e.detail.value 就是选中那一项的 value */
  onGrade(e) {
    this.save({ grade: Number(e.detail.value) });
  },

  onTerm(e) {
    this.save({ term: Number(e.detail.value) });
  },

  onScope(e) {
    this.save({ scope: e.detail.value });
  },

  onPinyin(e) {
    this.save({ pinyinMode: e.detail.value });
  },

  onAlign(e) {
    this.save({ align: e.detail.value });
  },

  /**
   * 字号两档。
   *
   * 上一版这里是详情页那根原生 slider 的镜像 —— 一屏里两颗圆钮、两条轨道，
   * 而两边共用同一份 settings.fontSize，改哪边都一样。
   * 这一版把这一屏的滑块换成 A- / A+ 两颗：一行七个段，横向量程是最缺的东西。
   *
   * 边界不再靠滑块的轨道端点提示，所以点不动时就无声 —— 两颗按钮在临界档上
   * 直接 disabled（见 WXML），按下什么都不会发生，也就不会出现
   * 「点了没反应」那种最差的体验。
   */
  onFontDown() {
    this.stepFont(-1);
  },

  onFontUp() {
    this.stepFont(1);
  },

  stepFont(delta) {
    const next = Math.max(FONT_MIN, Math.min(FONT_MAX, this.data.fontSize + delta));
    if (next === this.data.fontSize) return;
    this.save({ fontSize: next });
    this.syncFontBtns(next);
  },

  /** 到临界档就把那颗按钮压暗 —— 点不动的一颗不该看着能点 */
  syncFontBtns(size) {
    this.setData({ fontCanDown: size > FONT_MIN, fontCanUp: size < FONT_MAX });
  },

  /**
   * 换算法。
   *
   * 「换算法不清进度」原来是个确认弹窗，现在也去掉了 —— 那句话是**常驻在页面上的说明**，
   * 每次点都拦一下，等于把「我已知晓」问了四遍。真要说风险，说一次就够。
   * 门禁照旧：不可用的那几套 radio 直接 disabled，点不动，也不会走到这儿。
   */
  /**
   * 换算法。
   *
   * 门禁那一圈留着，但换成原生控件的写法：不可用的那几套 radio 直接 disabled，
   * 点都点不到，也就不会再走到这儿。原来那个「这一套还没开放」的弹窗因此删了 ——
   * 弹窗本该是「要你决定」，用来播报「你不能点」是错位的。
   * 「换算法不清进度」也改成页面上的常驻说明，不再每次点都拦一下。
   */
  onAlgo(e) {
    const algo = e.detail.value;
    if (algo === this.data.algo || !E.algoAllowed(algo)) return;
    this.save({ algo });
  }
});
