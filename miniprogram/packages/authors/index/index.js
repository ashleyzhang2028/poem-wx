const corpus = require("../../../utils/corpus");
const store = require("../../../utils/store");
const AI = require("../../../utils/author-index");
const gate = require("../../../utils/gate");
const entitlement = require("../../../utils/entitlement");
const theme = require("../../../utils/theme");

/**
 * 作者索引：朝代 → 作者 → 作品。
 *
 * 用户原话（Issue #480，网页版那条就是照它做的）：
 *
 *   「搜索大类功能，增加作者作品索引页，按时间朝代顺序，将中国所有作品的
 *     作者列在一页，上面是朝代索引列表，点击朝代可以下面的具体朝代，
 *     朝代下面是各个作者，例如唐代 李白，点击李白，显示李白所有作品列表，
 *     再点击列表，进入详情页，详情页的上一页下一页都是该作者的作品。
 *     返回就回到李白列表。」
 *
 * ## 两层，都在这一页里，不新开页面
 *
 *   ① 名册 —— 朝代表 + 一段一段的作者。这里**只是名单**，点一位进 ②
 *   ② 一位作者的作品 —— 复用列表页那一套（分组标题 + 行 + 已读标记）
 *
 * 为什么不分两个页面：小程序的「返回」是页面栈给的，而用户要的是
 * **一层退一层**（详情 → 作品列表 → 名册）。分成两个页面的话，从详情页
 * 返回是回到作品列表（对），从作品列表返回是回到名册（对），但
 * 「名册」自己又是从搜索页进来的 —— 一共三层栈，返回手势要连点三次，
 * 中间任何一层被系统回收（小程序后台超过 5 个页面就开始回收），
 * 用户就被弹回搜索页了。
 *
 * ## 为什么入口在搜索页
 *
 * 网页版第二轮用户点名：「从搜索页进，不是从课外阅读集子页进」。
 * 这边同理 —— 搜索页除了那颗搜索框，下面多一行入口。
 *
 * ## 名册是现算的，不是进包的数据
 *
 * 十部集子的索引本来就在包里（各集子的列表页要用），名册只是把它们
 * 按作者重摆一遍。**488 位作者 / 1919 条，实测 60ms** —— 比多背一份
 * 「作者 → 条目」的静态表划算，也不会跟语料错开版本。
 *
 * （2030 是十部的条目总数，1919 是名册收下的：差掉的是结集 4 条
 *  + 课内已经背过、在选集里只剩一条壳的 107 条。）
 */
Page({
  data: {
    locked: true,
    /** ① 层的朝代索引卡：每段的名字与两个读数（几家 / 几条） */
    eras: [],
    /** ① 层铺开的名字册，一段一张卡 */
    sections: [],
    /** 名册合计（页头那行小字要用）：488 位作者 / 1919 条 */
    totalPeople: 0,
    totalWorks: 0,
    /** ② 层：当前看着这一位，空串就是在 ① 层 */
    author: "",
    works: [],
    /** ② 层那一筛：全部 / 未读。与列表页同一套分段 */
    filter: "全部",
    filters: [
      { key: "全部", label: "全部", icon: "all-site" },
      { key: "未读", label: "未读", icon: "title" }
    ],
    matched: 0,
    unread: 0
  },

  onShow() {
    theme.apply(this);
    // 作者索引是 free 档的搜索能力之一，但同样要先登录。
    // 与「课外阅读」同一条线：进门容易，用起来要求登录。
    if (!gate.logged() || !entitlement.can("search")) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });
    /* 每次都重算名册 —— 已读标记会在这一页外面变（详情页评完分、
       列表页点开一首），缓存的读数会骗人：「还有 59 条没读」那一行
       与「未读」那一筛都得跟着走。
       在②层时 `openAuthor` 会把这一位重新摊开一次（不重置到①层）——
       从详情页回来看到的就是刚更新的那一份。 */
    this.buildRoster();
    if (this.data.author) this.openAuthor(this.data.author);
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  /** 全站条目摊平 —— 十部集子，与网页版 LIT_BOOKS 同一份名单 */
  allEntries() {
    const out = [];
    AI.LIT_BOOKS.forEach((b) => {
      corpus.ofBook(b).forEach((p) => out.push(p));
    });
    return out;
  },

  buildRoster() {
    // 已读标记按集子分 key 存，这里摊成一张 id 表 —— 名册要知道
    // 「这一位还有几首没读」，而一条一条去 store.reads() 查是近两千次读存储
    const readIds = {};
    const all = store.reads();
    Object.keys(all).forEach((b) => {
      Object.keys(all[b]).forEach((id) => { readIds[id] = 1; });
    });

    const r = AI.build(this.allEntries(), { readIds: readIds });
    const sections = r.eras.map((e) => ({
      at: e.at,
      name: e.name,
      count: e.count,
      works: e.works,
      /* 每格只带 WXML 真用到的两样。`dynasty` / `unread` 在 `roster` 里
         留着（阅读页与自检要），但不进 `setData` —— 名册是「有谁」，
         一格里多塞两个字段，488 格就是多搬 976 个值过 setData 那座桥 */
      people: e.people.map((w) => ({ name: w.name, count: w.count }))
    }));

    this.roster = r;
    /* 名册一次全铺（488 位、1919 条，实测 60ms）。不做「先铺两段、点开再看
       全部」那一套：朝代表在顶上，点一格就跳到那一段 —— 想要的分段能力
       已经有了，再叠一层折叠/展开是第二个说法。而且折叠态下用索引卡跳
       一个**还没铺出来**的朝代，要么跳个空、要么得先自动展开，
       两种都比「全铺」多一处会错的地方。 */
    this.setData({
      eras: r.eras.map((e) => ({ at: e.at, name: e.name, count: e.count, works: e.works })),
      sections: sections,
      totalPeople: r.total,
      totalWorks: r.eras.reduce((n, e) => n + e.works, 0),
      unread: r.unread
    });
  },

  /** 索引卡点一格：就地滚到那一段。与列表页同一份做法、同一道高亮 */
  onJump(e) {
    const at = e.currentTarget.dataset.at;
    wx.pageScrollTo({ selector: "#era-" + at, duration: 200 });
  },

  /* ---------- ② 一位作者的作品 ---------- */

  onAuthor(e) {
    this.openAuthor(e.currentTarget.dataset.name);
  },

  openAuthor(name) {
    const w = this.roster && this.roster.people[name];
    if (!w) return;
    /* 已经在这一位的②层时（`onShow` 那次重算）**不重置那一筛** ——
       用户正看着「未读」，从详情页退回来看见的该还是「未读」，
       不该被弹回「全部」。`author` 相同即视为同一次会话。 */
    if (this.data.author !== name) this.setData({ author: name, filter: "全部" });
    wx.setNavigationBarTitle({ title: name });
    this.applyWorks();
  },

  onFilter(e) {
    this.setData({ filter: e.detail.value }, () => this.applyWorks());
  },

  applyWorks() {
    const name = this.data.author;
    const w = this.roster && this.roster.people[name];
    if (!w) return;

    // 已读标记与列表页同一份来源（本机、按集子分 key 存）
    const readIds = {};
    AI.LIT_BOOKS.forEach((b) => {
      const m = store.reads(b);
      Object.keys(m).forEach((id) => { readIds[id] = 1; });
    });

    const filter = this.data.filter;
    const list = w.items.filter((p) => filter !== "未读" || !readIds[p.id]);

    this.setData({
      works: list.map((p) => ({
        id: p.id,
        title: p.t,
        dynasty: p.d,
        bookName: p.n,
        read: !!readIds[p.id]
      })),
      matched: list.length,
      unread: w.unread
    });
  },

  /** ② 层退回 ① 层。这一层不是页面栈上的一层，所以是「收起来」不是「返回」 */
  onBackRoster() {
    this.setData({ author: "", works: [] });
    wx.setNavigationBarTitle({ title: "作者索引" });
    // 名册那一段还留在原位（`sections` 没动），滚回去就看得到 —— 不重建 DOM
  },

  onOpen(e) {
    const id = e.currentTarget.dataset.id;
    const url = "/pages/reader/reader?id=" + encodeURIComponent(id) +
      "&from=" + encodeURIComponent(this.data.author);
    wx.navigateTo({ url: url });
  },

  onShareAppMessage() {
    return { title: "跬步 · 作者索引", path: "/packages/authors/index/index" };
  }
});
