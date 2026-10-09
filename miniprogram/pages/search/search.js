const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const textSearch = require("../../utils/text-search");
const gate = require("../../utils/gate");
const entitlement = require("../../utils/entitlement");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");

const HOT = ["李白", "杜甫", "苏轼", "春", "月", "登高", "王维"];

/* 「怎么搜」不再是用户选的一件事。
   用户原话是「搜索页的 范围 方式选项卡片删除 搜索框内已经有提示，
   不要再增加用户选择成本」。

   按这个口径，两件事都从界面上撤掉，改成**由系统定**：

   · 方式 —— 一律先按篇名作者匹配，没结果再自动落到正文全文。
     两条路都不花钱、都在本机，没有「该走哪条」需要用户判断。
     上一版把它做成二选一，用户得先猜「我想搜的这句在标题里还是在正文里」，
     而那恰好是他不知道的事。
   · 范围 —— 一律搜全站（课内 251 首 + 课外十七部集子）。也一视同仁地列出。

   留下的只有「命中几篇 · 在哪儿捞到的」这一行读数：它不要求用户做任何事，
   只说清这次结果是哪来的。 */

/**
 * 一次列出多少条。
 *
 * 上一版写死 80 却不说 —— 搜「春」全站命中 528 篇，界面照样只写「命中 80 篇」，
 * 剩下 448 篇像是不存在。这一版把上限摆到明面上：先拿到**总数**，
 * 界面写「命中 528 篇 · 列出前 80 篇」，没截断就不提这一句。
 *
 * 为什么不做「加载更多」：全站索引只能逐集子现遍历（主包 2MB 的线不能碰），
 * 5599 条遍历一次在真机上已经要等一拍。先如实交代，不做假分页。
 */
const PAGE_MAX = 80;

Page({
  data: {
    keyword: "",
    // 范围与方式都由系统定（见 MODES 上面的注释），页面上只剩读数
    fullOn: false,
    results: [],
    /** 截断前的命中总数 —— 「命中 N 篇」说的是它，不是 results.length */
    total: 0,
    hot: HOT,
    searched: false,
    searching: false,
    locked: true,
    /** 「命中 N 篇 · 在哪儿搜的」—— 让结果范围有个交代，不至于看完不知道是不是全量 */
    resultWhere: "",
    /** 命中的篇目落在正文里的哪一句 —— 只在落到全文那一步时才有 */
    fromFull: false
  },

  onShow() {
    theme.apply(this);
    // 自绘底栏：切到本页时把自己那一格点亮
    tabbar.sync(this, 2);
    // 搜索是 free 档能力，但同样要先登录。
    // 搜索页在 tabBar 上，未登录点进来不该是一屏空壳。
    if (!gate.logged() || !entitlement.can("search")) {
      this.setData({ locked: true });
      return;
    }
    const saved = store.settings();
    const fr = textSearch.readiness();
    this.setData({
      locked: false,
      keyword: this.data.keyword || saved.lastSearch || "",
      fullOn: fr.usable
    });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onClear() {
    this.setData({ keyword: "", results: [], total: 0, searched: false, searching: false });
  },

  onHot(e) {
    this.setData({ keyword: e.currentTarget.dataset.k }, () => this.doSearch());
  },

  doSearch() {
    if (!gate.logged()) {
      this.onLogin();
      return;
    }
    const kw = this.data.keyword.trim();
    if (!kw) {
      this.setData({ results: [], total: 0, searched: false });
      return;
    }
    store.saveSettings({ lastSearch: kw });

    /* 先按篇名作者找。找得到就到此为止 —— 名儿都对上了，
       再翻一遍正文只是把同一批篇目换个理由列一次。 */
    const r = this.byIndex(kw);
    if (r.total) {
      this.setData({
        results: r.items,
        total: r.total,
        searched: true,
        searching: false,
        fromFull: false,
        resultWhere: "篇名作者 · 全站"
      });
      return;
    }

    /* 一篇都没对上（或者根本没有正文索引），才落到正文全文 ——
       「春」「月」这种词就在正文里，用户不该先去猜「在哪儿搜」。 */
    if (!this.data.fullOn) {
      this.setData({
        results: [],
        total: 0,
        searched: true,
        searching: false,
        fromFull: false,
        resultWhere: "篇名作者 · 全站"
      });
      return;
    }

    this.setData({ searching: true, searched: false });
    // 分片读取是同步的（require），但界面先让出一个 tick，
    // 免得大结果集把点击反馈吞掉 —— 让人以为没反应是最糟的体验
    setTimeout(() => this.runFull(kw), 16);
  },

  /** 命中统计那行小字：如实说这次是拿什么比出来的 */
  byIndex(kw) {
    const r = corpus.search(kw, { limit: PAGE_MAX });
    return {
      total: r.total,
      items: r.items.map((p) => ({
        id: p.id,
        title: p.t,
        author: p.a,
        dynasty: p.d,
        bookName: p.n,
        lines: []
      }))
    };
  },

  runFull(kw) {
    let hits = [];
    // 全文检索走倒排索引，命中动辄几千条，比索引字段更容易截断 ——
    // 上限同样摆在明面上（「命中 N 篇 · 列出前 40 篇」），不闷声砍掉
    const fullMax = 40;
    try {
      hits = textSearch.search(kw, { limit: fullMax + 1 });
    } catch (e) {
      hits = [];
    }
    // 多要一条只是为了知道「有没有第 41 条」；索引层报不出总数，就用它当界
    const truncated = hits.length > fullMax;
    if (truncated) hits = hits.slice(0, fullMax);

    this.setData({
      total: truncated ? fullMax + 1 : hits.length,
      results: hits.map((h) => ({
        id: h.entry.id,
        title: h.entry.t,
        author: h.entry.a,
        dynasty: h.entry.d,
        bookName: h.entry.n,
        lines: h.lines,
        where: h.where === "pack" ? "课内" : "课外"
      })),
      searched: true,
      searching: false,
      fromFull: true,
      resultWhere: "正文全文 · 全站"
    });
  },

  onOpen(e) {
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
  },

  /**
   * 作者索引。它在分包里（`packages/authors`），主包不为它多背一行。
   *
   * 入口放在搜索页而不是课外阅读集子页，是网页版第二轮的裁决
   * （Issue #480），这边跟着走 —— 两端的入口位置不一样，用户换端会找不到。
   */
  onAuthors() {
    wx.navigateTo({ url: "/packages/authors/index/index" });
  },

  onShareAppMessage() {
    return { title: "跬步 · 全站搜索", path: "/pages/search/search" };
  }
});
