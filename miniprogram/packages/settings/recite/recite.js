const store = require("../../../utils/store");
const S = require("../../../utils/scheduler");
const R = require("../../../utils/review-models");
const E = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");

/* 学段三格。顺序由 scheduler 给（小学 → 初中 → 高中）。
   （这里原来还有一份「十二个年级」的常量 —— 学段那一格补上之后，
   年级格改由 gradeRows 按当前学段现算，那份常量就没人用了。
   「十二个年级一个不丢」这件事由 check.js V23.9 直接从 STAGE_GRADES
   与 GRADE_NAMES 验，不靠这个页面里的副本。） */
const STAGES = S.STAGE_KEYS.map((k) => ({ key: k, name: S.STAGES[k].name }));

/* 学段 → 它的随机范围。不在表里的（小初 / 全部）本身就横跨学段，
   换学段不该动它们 —— 那几个范围里没有一个字是单个学段的名字。 */
const STAGE_SCOPE = { primary: "primary", middle: "middle", high: "high" };

/** 换学段之后该落在哪个取诗范围上 */
function scopeForStage(stage, scope) {
  const to = STAGE_SCOPE[stage];
  if (!to) return scope;
  return S.SCOPES[scope] && S.SCOPES[scope].stages && S.SCOPES[scope].stages.length === 1
    ? to
    : scope;
}

const TERMS = [
  { value: 1, label: "上学期" },
  { value: 2, label: "下学期" }
];

/* 注音 / 对齐 / 字号不在这页。它们是读一首诗时的临场偏好，
   该待在详情页（pages/reader 的 .prefs）与阅读设置页（packages/settings/general），
   在诗句旁边当场调、当场看见效果。详见 recite.wxml 里的说明。 */

Page({
  data: {
    grades: [],
    terms: TERMS,
    stages: STAGES,
    grade: 1,
    /* 当前学段那一格谁亮着。判据是 grade，不另存一份 —— 两份真相会分叉 */
    stage: "primary",
    /* 年级格收窄成「当前学段里的那几个」之后，这一行读数说清剩下的是哪一段 */
    gradeNote: "",
    term: 1,
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
    theme.apply(this);
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });
    const settings = store.settings();
    const scopes = Object.keys(S.SCOPES).map((k) => ({ key: k, label: S.SCOPES[k].label }));
    this.setData(
      Object.assign({}, settings, {
        stage: S.stageOf(settings.grade),
        grades: this.gradeRows(settings.grade),
        gradeNote: this.gradeNote(settings.grade),
        scopes: scopes,
        algos: this.algoRows(settings.algo)
      }),
      () => this.updatePool()
    );
  },

  /**
   * 当前学段里的年级格：**只列这一段**。
   *
   * 上一版是十二格全列，理由是 Issue #26 那句「年级从十二格收到六格
   * （取最近六年）- 谁让你这么瞎搞的，这能收吗」—— 那句说的是「别按
   * 最近六年砍」，不是「十二格必须同屏」。这一版把学段那一格补上了：
   * 先选学段，年级格跟着只列这一段，所以砍掉的六格**一个都没丢**，
   * 只是没了「在小学段里看见高中格」这件事 —— 那本来也没人会去点。
   *
   * 不动 store 里的任何东西：外面看到的 grade / term / scope 全是原来的口径。
   */
  gradeRows(grade) {
    return S.STAGE_GRADES[S.stageOf(grade)].map((g) => ({ value: g, label: S.gradeName(g) }));
  },

  /** 年级那一行的读数：说清这一行收窄成了哪一段 */
  gradeNote(grade) {
    const key = S.stageOf(grade);
    const gs = S.STAGE_GRADES[key];
    return S.stageLabel(key) + "（" + gs[0] + "—" + gs[gs.length - 1] + " 年级）";
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
    /* 年级一变，学段那一格、年级格子、读数三处都得跟着走 ——
       三处都由 grade 算出来（不是各存一份），所以收在 save 这一个出口里，
       漏一个入口就会出现「格子换了、读数没换」那种半截状态。 */
    const grade = patch.grade === undefined ? this.data.grade : patch.grade;
    const derived = {
      stage: S.stageOf(grade),
      grades: this.gradeRows(grade),
      gradeNote: this.gradeNote(grade)
    };
    this.setData(Object.assign(patch, derived, { algos: this.algoRows(patch.algo || this.data.algo) }), () =>
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

  /**
   * 换学段。
   *
   * 学段不是第四个设置项 —— 它是「年级格怎么排」的旋钮（见 gradeRows）。
   * 但光换格子还不够：用户点「初中」，要背的是初中，不是「格子换了一排，
   * 然后还得自己再点一下七年级」。所以这里顺带做两件事：
   *
   *   1. 年级跳到这一段的第一个（已经在段内就不动它 —— 点一下学段
   *      不该把你刚选好的年级改掉）；
   *   2. **取诗范围跟着走**：原来是「小学随机」就换成「初中随机」，
   *      依此类推。范围是用户表达过的意图（「我想在小学里随机」），
   *      学段一换，那个意图里唯一变的是学段 —— 所以换的是学段那一半，
   *      不是把意图整个丢掉。
   *
   * 跟着走的**只有单学段的那三个随机范围**（小学 / 初中 / 高中随机）：
   *   · 小初随机 与 全部随机 本身就横跨学段，换学段不影响它们，原样留着；
   *   · 「本册」「本册及之前」是跟着年级走的（本册 = 本册），
   *     年级跳了它们自然跟着跳，范围那一格不用动。
   */
  onStage(e) {
    const key = e.detail.value;
    const grades = S.STAGE_GRADES[key];
    if (!grades) return;

    const prev = this.data.grade;
    const grade = grades.indexOf(prev) >= 0 ? prev : grades[0];
    const scope = scopeForStage(key, this.data.scope);

    const patch = { grade, scope };
    if (grade === prev && scope === this.data.scope) return;
    this.save(patch);
  },

  onTerm(e) {
    this.save({ term: Number(e.detail.value) });
  },

  onScope(e) {
    this.save({ scope: e.detail.value });
  },

  onCount(e) {
    this.save({ dailyCount: Number(e.detail.value) });
  },

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
