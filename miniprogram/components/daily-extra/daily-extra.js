/**
 * 今日加背：搜索 + 增删。
 *
 * 由来（用户 2026-10-04）：
 *   「本项目添加 今日加背 功能了吗？可参考 /poem 代码库」
 *   「请完整实现，不要丢这个缺什么」
 *
 * 这一版之前，加背的**数据层已经全通了** —— store.dailyExtra()/setDailyExtra()
 * 有当日域与跨天归零，排期器认加背（reason 走 extra/optional），
 * 云同步真打包了 `daily_extra:v1` 一行，自检也有覆盖。
 * 缺的只有一处，但是致命的一处：**没有任何界面能往里加**。
 * setDailyExtra() 全项目只被同步回写调过一次，本机永远生不出这份数据来。
 *
 * 网页版是一整套：`js/daily-extra.js`（读写 / 上限 20 / 快照）+ 
 * `js/daily-extra-ui.js`（搜索建议 + 行内「＋ / ✓」切换）+ 首页那枚
 * placeholder 为「今日加背」的搜索框（index.html L76）。
 * 小程序端缺的正是后两个里的那半页，所以这里照着 `daily-extra-ui.js` 补。
 *
 * ## 为什么是组件而不是页面
 *
 * 它要被挂在**首页**（用户打开小程序第一眼的地方：今天想多背一首，就在这儿加），
 * 首页自己已经很长了。做成组件，将来别的页面要同一个入口，挂一次就行 ——
 * 而「同一件事两个入口各写一遍」正是这个项目反复在修的病。
 *
 * ## 上限 20 与文案
 *
 * 与网页版同一个数（MAX = 20）。超了不静默失败，也不把它加进去再说 ——
 * 明确告诉人「先背完再加」，因为加背的意义是「今天多背几首」，
 * 攒到 20 首还往里塞，明天一到全部归零，等于什么都没做。
 */
const store = require("../../utils/store");
const corpus = require("../../utils/corpus");

/** 建议一次列几条。与网页版同数（SUGGEST_MAX = 8）——
    再多就顶掉半屏，用户还得滚。 */
const SUGGEST_MAX = 8;

Component({
  options: {
    // 卡片长相走 app.wxss 的共用件，组件的 shadow 根不能把它挡在外面
    addGlobalClass: true
  },

  properties: {
    /** 页面那支主题色。组件不在页面根节点的内联样式作用范围内，
        不显式接一份的话，换主题之后这颗圆钮永远是默认那支墨。 */
    themeStyle: { type: String, value: "" }
  },

  data: {
    keyword: "",
    searched: false,
    rows: [],
    count: 0,
    /** 上限。从 store 取而不是写死 —— 界面要念出这个数（「已加 N 首」，
        满了还有一句提示）。写死就会出现「改了上限、界面还印着旧数」 */
    max: store.DAILY_EXTRA_MAX
  },

  attached() {
    this.refresh();
  },

  methods: {
    /** 今天加了几首 —— 首页、设置页都可能动过它，每次露面都得重读 */
    refresh() {
      this.setData({ count: store.dailyExtra().length, max: store.DAILY_EXTRA_MAX });
      if (this.data.keyword) this.paint(this.data.keyword);
    },

    onInput(e) {
      this.setData({ keyword: e.detail.value }, () => this.paint(e.detail.value));
    },

    onSearch() {
      this.paint(this.data.keyword);
    },

    onClear() {
      this.setData({ keyword: "", searched: false, rows: [] });
    },

    /**
     * 画建议列表。
     *
     * 匹配走 corpus.search()，它按篇名 / 作者 / 朝代 / 出处 / 分组比 ——
     * 与网页版的 matchScore 是同一批字段。这里**不引「正文全文」那一路**：
     * 倒排索引 2MB 走云端，为了「加背」这一下把整份索引下下来不划算，
     * 而加背时人心里多半已经有篇名了。搜不到就如实说搜不到。
     */
    paint(kw) {
      const keyword = String(kw || "").trim();
      if (!keyword) {
        this.setData({ rows: [], searched: false });
        return;
      }
      const r = corpus.search(keyword, { limit: SUGGEST_MAX });
      this.setData({ rows: this.decorate(r.items), searched: true });
    },

    /** 给每条挂上「加没加进去」—— 那是行首那颗圆钮的唯一判据 */
    decorate(items) {
      const have = {};
      store.dailyExtra().forEach((id) => {
        have[id] = true;
      });
      return (items || []).map((p) => ({
        id: p.id,
        title: p.t,
        author: p.a,
        dynasty: p.d,
        bookName: p.n,
        on: !!have[p.id]
      }));
    },

    /** 点行首那颗钮：加了就移出，没加就加进去 —— 两态来回切 */
    onToggle(e) {
      const id = e.currentTarget.dataset.id;
      const r = this.toggle(id);
      if (r.msg) wx.showToast({ title: r.msg, icon: "none" });
      if (r.ok === false) return;
      this.afterChange();
    },

    /** 点行本身：去看看这一首。加背这一件事不替用户代劳 ——
        想加就点那颗钮，想读就点这一行，两个动作分开 */
    onOpen(e) {
      wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
    },

    /**
     * 加 / 移这一首。**判断不在组件里** —— 上限、去重、两态全在
     * store.toggleDailyExtra()，这里只把 code 翻成人话。
     *
     * 为什么收口：这两个数（上限、当前几首）在首页、设置页、详情页、
     * 弹层四处都会显示。每处各判一次，改上限时必漏一处，
     * 而漏掉的那处会「显示 20、实际能加到 25」—— 一句对不上的读数。
     */
    toggle(id) {
      if (!id) return { ok: false, msg: "" };
      const r = store.toggleDailyExtra(id);
      if (!r.ok) return { ok: false, on: false, msg: this.msgOf(r.code) };
      return { ok: true, on: r.on, msg: r.on ? "已加入今日背诵" : "已移出今日背诵" };
    },

    /** 加背失败时那句话。四种 code 各有各的下场，不说清等于没说 */
    msgOf(code) {
      if (code === "E_LIMIT") {
        return "今天已经加了 " + store.DAILY_EXTRA_MAX + " 首，够多了 —— 先背完再加";
      }
      if (code === "E_STORAGE") return "加不进去：这台手机存不下（空间不足或未开启存储）";
      return "加不进去";
    },

    /** 加完 / 移完：圆钮、读数、以及**页面的今日安排**三处一起跟上 */
    afterChange() {
      this.refresh();
      this.triggerEvent("change", { count: store.dailyExtra().length });
    }
  }
});
