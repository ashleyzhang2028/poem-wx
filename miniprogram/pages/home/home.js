const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const S = require("../../utils/scheduler");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");

/**
 * 计划行上那枚小签的文案。
 *
 * ⚠️ `extra` 这里原来是「加背」，而它说的其实是**排期凑数** ——
 * 排期器在自己排完 5 首之后还没凑够时，会从剩余池子里拣一首补上，
 * 理由是 `extra`（见 scheduler.js 最后那一段）。那件事与「用户今天主动
 * 多加了一首」是两回事，而后者在网页版里叫 `pinned`（js/app.js 的
 * withTodayExtra）。两个概念共用一个词，界面上就分不清这一首是我加的
 * 还是系统凑的 —— 所以这一版把它们拆开：
 *
 *   pinned  今天的加背 —— 用户自己加的，排在最前
 *   extra   系统凑数的 —— 排位不够时补的
 *
 * 小签的**颜色**也跟着这件事走：加背是金色（它是用户自己的选择，
 * 与全站「选中填色」同一套语言），凑数是灰的（它什么都不表示）。
 */
const REASON_TEXT = { review: "复习", new: "新学", extra: "补充", optional: "自选", pinned: "今日加背" };

/** 小签的配色：复习琥珀、新学青、加背金、其余灰 */
const REASON_CLS = { review: "amber", new: "blue", pinned: "gold" };

function reasonCls(key) {
  return REASON_CLS[key] || "ghost";
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const CN_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/** 1 → 一，17 → 十七，30 → 三十 —— 月与日都要，日期写阿拉伯数字会跟「几首」混在一起 */
function cnDay(n) {
  if (n <= 10) return CN_NUM[n];
  if (n < 20) return "十" + (n % 10 ? CN_NUM[n % 10] : "");
  return CN_NUM[Math.floor(n / 10)] + "十" + (n % 10 ? CN_NUM[n % 10] : "");
}

/** 首屏那行小字：八月十七 · 周一。不写年份 —— 今天要背哪几首，跟哪一年无关 */
function todayLabel() {
  const d = new Date();
  return CN_NUM[d.getMonth() + 1] + "月" + cnDay(d.getDate()) + "日 · " + WEEKDAYS[d.getDay()];
}

Page({
  data: {
    /** 未登录时首页是「目录」而不是「今日计划」，这两个值决定整页长相 */
    logged: false,
    guest: false,
    gradeName: "",
    termName: "",
    scopeName: "",
    plan: [],
    doneCount: 0,
    total: 0,
    percent: 0,
    /** 未登录时的书目：一年级上下册，只有篇名作者，点不动 */
    catalog: [],
    catalogCount: 0,

    /** 今天是几号 —— 首屏那行小字，让人一眼知道看到的是哪一天的计划 */
    todayLabel: "",
    /** 首屏那组大数字（参考图里最抓眼的一处）：今日 / 已背 / 待学。
        为什么放三个而不是一个进度环：环只说得清「几比几」，
        说得清「还剩几首」的是数字，而「还剩几首」才是打开这一屏要问的事。 */
    stats: { today: 0, done: 0, left: 0 },
    /** 计划里还有几首没背过 —— 决定首屏那颗按钮说「开始背」还是「再练一遍」 */
    todoCount: 0,
    /** 首屏第一次出计划要读语料，先立个骨架，别让人对着一屏空白 */
    loading: true
  },

  onShow() {
    theme.apply(this);
    // 自绘底栏：切到本页时把自己那一格点亮
    tabbar.sync(this, 0);
    this.setData({ todayLabel: todayLabel() });
    this.refresh();
    // 登录之后才有东西可同步
    if (gate.logged()) sync.now().catch(() => {});
  },

  refresh() {
    const logged = gate.logged();

    // 未登录：首页只当目录用。**不读本机设置** —— 上次停在九年级是登录用户的事，
    // 访客看到的一律是一年级，这是 Issue 点名的「首页默认列出一年级诗词」。
    if (!logged) {
      const all = corpus.course().filter((p) => p.gr === gate.GUEST_GRADE);
      const catalog = all.map((p, i) => ({
        id: p.id,
        title: p.t,
        author: p.a,
        dynasty: p.d,
        seq: i + 1
      }));
      this.setData({
        logged: false,
        guest: true,
        gradeName: S.gradeName(gate.GUEST_GRADE),
        termName: "",
        scopeName: "一年级上下册",
        plan: [],
        total: 0,
        doneCount: 0,
        percent: 0,
        catalog,
        catalogCount: catalog.length,
        stats: { today: 0, done: 0, left: 0 },
        todoCount: 0,
        loading: false
      });
      return;
    }

    const settings = store.settings();
    const all = corpus.course();

    const plan = S.generateDailyPlan({
      grade: view.grade,
      term: view.term,
      count: settings.dailyCount,
      scope: view.scope,
      allPoems: all,
      // 今日加背的条目由 store 翻好（认不出来的 id 会如实丢掉，见 store.dailyExtraPoems）
      extraPoems: store.dailyExtraPoems(),
      getRecord: store.getRecord
    });

    // 游客没有本机进度可谈：环与「已背」状态一律归零，不拿别人的数据充数
    const reads = logged ? store.reads("poems") : {};
    let done = 0;
    const rows = plan.map((it, i) => {
      const rec = store.getRecord(it.poem.id);
      const read = !!reads[it.poem.id];
      if (read) done += 1;
      return {
        id: it.poem.id,
        seq: i + 1,
        title: it.poem.t,
        author: it.poem.a,
        dynasty: it.poem.d,
        reason: REASON_TEXT[it.reason] || "",
        reasonKey: it.reason,
        tagCls: reasonCls(it.reason),
        // 阶段名与「新学 / 复习」那个标签常常是同一个词（刚学的那几首都是「新学」）
        // —— 同一行里说两遍，等于没说。只在与标签不同的时候才附上
        stage: S.stageName(rec) === REASON_TEXT[it.reason] ? "" : S.stageName(rec),
        mastery: S.mastery(rec),
        reviewed: !!(rec && rec.learned),
        read
      };
    });

    const total = rows.length;
    this.setData({
      logged: true,
      guest: false,
      gradeName: S.gradeName(settings.grade) + S.termName(settings.term),
      termName: S.termName(settings.term),
      scopeName: S.scopeOf(settings.scope).scopeName,
      plan: rows,
      doneCount: done,
      total,
      percent: total ? Math.round((done / total) * 100) : 0,
      catalog: [],
      catalogCount: 0,
      stats: { today: total, done, left: Math.max(0, total - done) },
      // 「开始背」与「再练一遍」的区别在于**还有没有没背过的**。
      // 判据用 doneCount 不行 —— 那是「读过」，而计划里的勾是「背过」，
      // 两者在「读了没背」的篇目上会打架：一个勾都没有，按钮却说再练一遍。
      todoCount: rows.filter((r) => !r.reviewed).length,
      loading: false
    });
  },

  /**
   * 点开一篇：从**页面底部弹出来背**，不跳页。
   *
   * 用户 2026-10-03 的原话：
   *   「首页的今日古诗背诵，当用户点击古诗，他不是从页面底部弹出详情页去背诵吗？
   *     请参考 /poem 代码库。这种弹出卡片式方便用户背完随即进入下一首，
   *     而不需要页面之间的切换。」
   *
   * 网页版就是这么做的（js/app.js 的 openPoem → `#modal`）：点一首诗弹层推上来，
   * 评完分弹层关掉、列表就地重排，全程一次页面跳转都没有。
   * 上一版是 navigateTo 详情页，背完再 redirectTo 下一首 —— 每首一次整页重建，
   * 用户看见的是一屏空白接着一屏空白。
   *
   * 未登录时**不弹也不静默吞掉** —— 弹一句人话，把人送去登录页。
   * 这条没变：门禁仍由首页把着（见 openSheet 里的 gate.guard），
   * 弹层自己不查（它只管读与评分）。
   */
  onOpen(e) {
    const id = e.currentTarget.dataset.id;
    this.openSheet(id);
  },

  /**
   * 开始背：从今天第一首**没背过的**弹起，弹的是首页那张背诵卡。
   *
   * 「开始」在哪儿都一样是这一件事：接着今天这一趟往下走。挑第一首没背过的
   * 而不是第一首 —— 从头再来一遍会让人以为刚才那几首白背了。
   * 全背过了才退回第一首，这时按钮上写的是「再练一遍」，从头来过正是它要说的话。
   *
   * 判据用 `reviewed`（背过）不是 `read`（读过）：这两件事在
   * 「点开看了但没评分」的篇目上是分开的，而这里要的是前者。
   * 上一版用的 `read` —— 于是背完整个计划后再进首页，按钮照样说「开始背」，
   * 点下去却从第一首开始，像是把刚背的抹了（见 data.todoCount 的同一处口径）。
   */
  onStart() {
    const first = this.data.plan.find((r) => !r.reviewed) || this.data.plan[0];
    if (!first) return;
    this.openSheet(first.id);
  },

  /** 点篇名 / 点「开始背」都是这一件事 —— 弹层收着队列，翻页由它自己走 */

  openSheet(id) {
    gate.guard("背诵", () => {
      const sheet = this.selectComponent("#sheet");
      // 「今日安排」那一列就是队列：复习轮次、加背这些都排在里面，
      // 弹层照着往下走即可 —— 队列由首页给，是刻意的（下一首是什么，
      // 只有排过计划的人知道）。
      if (sheet) sheet.open(this.data.plan, id);
    });
  },

  /** 弹层里翻到新的一首：列表要把勾点亮、进度条要跟着走 */
  onSheetOpen() {
    this.refresh();
  },

  /**
   * 今日加背动过了：立刻重排今日安排。
   *
   * **这一下是整个功能的落点** —— 加背的价值就在于「加完当场看见它排进去了」。
   * 攒着不重排（等下次 onShow）的话，用户加完盯着列表看了半天没动静，
   * 只会以为没加上，然后再点一次 —— 而第二次点的是「移出」。
   */
  onExtraChange() {
    this.refresh();
  },

  /**
   * 预览用：把首页那张加背卡里的搜索词灌进去。
   *
   * scripts/shots 认不得自定义组件的运行时，组件里的 onInput 它点不到 ——
   * 留这一个口子，截图上才看得到建议列表长什么样。
   * 它只做一件真事：调组件那一份 onInput，别的什么都不改。
   */
  onExtraInput(e) {
    const box = this.selectComponent("#extra");
    if (box) box.onInput(e);
    // 预览里组件的 setData 落不到页面 data 上（替身没有 setData），
    // 所以把结果再抄一份到 extraRows —— 展开那张卡时读的就是它
    this.setData({
      extraKeyword: (e && e.detail && e.detail.value) || "",
      extraRows: (box && box.data && box.data.rows) || []
    });
  },

  /** 今日这一趟走完了 —— 回列表，勾都在 */
  onSheetFinish() {
    this.refresh();
  },

  onSettings() {
    if (!gate.guard("背诵设置")) return;
    wx.navigateTo({ url: "/packages/settings/recite/recite" });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onBrowseAll() {
    if (!gate.guard("全部课内诗词")) return;
    wx.navigateTo({ url: "/pages/list/list?book=poems" });
  },

  /**
   * 下拉换一批。
   * 首页是「今天要背什么」，下拉是对着它最自然的动作 ——
   * 不下拉也能用，但没这一下，用户想刷新只能切页回来。
   */
  onPullDownRefresh() {
    this.refresh();
    setTimeout(() => wx.stopPullDownRefresh(), 320);
  },

  onShareAppMessage() {
    // 分享出去的是首页，未登录的人点进来看到的是目录 —— 这正是设计好的入口
    return { title: "跬步 · 每天背一首古诗文", path: "/pages/home/home" };
  },

  onShareTimeline() {
    return { title: "跬步 · 每天背一首古诗文" };
  }
});
