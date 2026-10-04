const store = require("../../utils/store");
const auth = require("../../utils/auth");
const S = require("../../utils/scheduler");
const E = require("../../utils/entitlement");
const sync = require("../../utils/sync");
const sfx = require("../../utils/sfx");
const gate = require("../../utils/gate");
const tiers = require("../../utils/tiers");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");

Page({
  data: {
    logged: false,
    nickname: "未登录",
    avatarUrl: "",
    /** 没头像时圆的那个字：昵称首字，昵称也没有就用「诗」 */
    avatarChar: "诗",
    /** 这张头像哪来的（自己传的 / 微信的 / 还没有） */
    avatarFromText: "还没有头像",
    hasLocalAvatar: false,
    identitySub: "未登录",
    gradeName: "",
    scopeName: "",
    algoName: "",
    dailyCount: 5,
    stats: { learned: 0, mastered: 0, readCount: 0 },
    tierLabel: "免费",
    tierSource: "",
    /** 答题音效那一页的入口：环境没有 Web Audio 时整行不出现 */
    sfxVisible: false,
    syncReady: false,
    syncText: "还没同步过",
    syncPending: 0,
    /** 登录即得（2026-10-04 起不再分档）。留着这个字段是因为界面
        仍要区分「渠道没就绪」（后端没配）与「档位不给」，只是后者已不存在 */
    syncAllowed: false,
    syncNote: "",
    /** 同步那一行的副标题。数据层给的是「已攒 N 条」这类事实，
        这里把它和「能不能同步」拼成一句人话 */
    syncSub: "",
    fullTextOn: false,

    /** 登录页的那半张卡：从 gate.guard 或首页「微信登录」按钮跳过来时自动聚焦 */
    focusLogin: false,
    adminVisible: false
  },

  onLoad(query) {
    // ?login=1：别人是点「去登录」过来的，登录卡要顶到最上面，
    // 而不是让用户自己在一个已经滚到一半的页面里找按钮
    this.setData({ focusLogin: query && query.login === "1" });
  },

  onShow() {
    theme.apply(this);
    // 自绘底栏：切到本页时把自己那一格点亮
    tabbar.sync(this, 3);
    this.refresh();
  },

  refresh() {
    const settings = store.settings();
    const profile = store.profile();
    const stats = store.stats();
    const e = E.status();
    const sy = sync.state();
    const fr = require("../../utils/text-search").readiness();

    const nick = profile.nickname || "我的古诗词";
    const src = store.avatarSrc();
    const local = store.hasLocalAvatar();

    this.setData({
      logged: !!profile.logged,
      nickname: profile.logged ? nick : "未登录",
      avatarUrl: src,
      avatarChar: (nick || "诗").slice(0, 1),
      hasLocalAvatar: local,
      // 说清这张是哪来的：自己传的排第一（与 store.avatarSrc 同一口径）
      avatarFromText: !src ? "还没有头像" : local ? "本机设置的头像" : "微信头像",
      identitySub: profile.logged ? (local ? "已登录 · 本机头像" : "已登录") : "未登录",
      gradeName: S.gradeName(settings.grade) + S.termName(settings.term),
      scopeName: S.scopeOf(settings.scope).scopeName,
      algoName: require("../../utils/review-models").modelOf(settings.algo).name,
      // 主题色那一行的副题就是当前色的名字（「天青」这类），当场知道选的是哪个
      themeName: theme.currentTheme().name,
      dailyCount: settings.dailyCount,
      stats,
      tierLabel: e.label,
      tierSource: e.source,
      sfxVisible: sfx.readiness().visible,
      fullTextOn: fr.usable,
      syncReady: sy.ready,
      syncText: sy.lastText,
      syncPending: sy.pending,
      syncAllowed: E.can("sync"),
      syncNote: this.syncNote(sy),
      syncSub: this.syncNote(sy),
      adminVisible: E.can("admin")
    });
  },

  /**
   * 微信登录：只取一个稳定的匿名标识，用来在云端认回这台设备的进度。
   * 昵称头像是用户自己的事，走 chooseAvatar / nickname 输入，不静默抓取。
   */
  onLogin() {
    wx.showLoading({ title: "登录中" });
    auth
      .login()
      .then((res) => {
        wx.hideLoading();
        if (res && res.local) {
          wx.showToast({
            title: "已登录（本机身份）",
            icon: "none",
            duration: 2500
          });
        } else {
          // 登录顺带把云端那份认回来（auth.login 里做的）。
          // 这里说清「认回来了」还是「这条通道没开」——
          // 新机器上这两种情况长得一模一样：都是「我刚登录，进度呢？」
          wx.showToast({
            title: res && res.synced ? "已登录 · 进度已认回" : "已登录 · 后端未就绪",
            icon: "none",
            duration: 2500
          });
        }
        this.refresh();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: (err && err.message) || "登录未完成", icon: "none" });
      });
  },

  onLogout() {
    wx.showModal({
      title: "退出登录",
      content: "退出后本机进度不会丢，但功能要重新登录才能用。",
      confirmText: "退出",
      success: (r) => {
        if (!r.confirm) return;
        auth.logout();
        this.refresh();
      }
    });
  },

  /**
   * 同步那一行该说什么。**先说「能不能同步」，再说「同步到哪了」**。
   *
   * 上一版第一句是不必要的：同步当时挂在 Pro 档上 —— 用户 2026-10-04
   * 裁决把这条边界撤了，登录就全部提供。现在只剩两种状态：
   * 后端就绪（说清同步到哪了）/ 后端没就绪（说清攒了多少条）。
   */
  syncNote(sy) {
    if (!sy.ready) return "后端未就绪 · 已攒 " + sy.pending + " 条";
    return sy.lastText;
  },

  onSync() {
    wx.showLoading({ title: "同步中" });
    sync.now(true).then((res) => {
      wx.hideLoading();
      let title = "本机数据只在本机";
      if (res.error) title = "同步失败：" + res.error;
      else if (!res.skipped) title = "已同步";
      else if (res.skipped === "offline") title = "后端或登录未就绪";
      else if (res.skipped === "throttled") title = "刚同步过，过会儿再来";
      wx.showToast({ title, icon: "none" });
      this.refresh();
    });
  },

  onAdmin() {
    // 管理页是 pro 起的能力。普通用户点进来看到的是「当前授权 + 能力矩阵」，
    // 也就是「我这一档有什么」；改别人的档位要管理员。
    wx.navigateTo({ url: "/packages/admin/index/index" });
  },

  /**
   * 换头像。chooseAvatar 是平台给的入口 —— 它一次给两条路：
   * **微信头像**（用当前微信那张）与**从相册选 / 拍照**（自己传一张）。
   *
   * 结果一律落到 profile.avatarLocal（本机那张），而不是 avatarUrl：
   *   · 用户点了这个按钮，就是「我要换头像」——无论选的是哪条路，
   *     结果都是他刚挑的那张，**该压过微信默认那张**；
   *   · 存成分开的两份，登录时刷新微信那张才不会把用户的图冲掉。
   *
   * ⚠️ 这里**不调 wx.getUserProfile** —— 它自 2022 年起只返回匿名
   * 「微信用户 + 灰头像」，调用它等于把一张假图盖到用户脸上。
   */
  onAvatarChoose(e) {
    const url = e.detail.avatarUrl;
    if (!url) return;
    store.saveProfile({ avatarLocal: url });
    // 头像也要跨设备（用户 2026-10-04）。微信那张登录时会重新下发，
    // **用户自己挑的这张不会** —— 不推上去，换台手机就没了。
    sync.markDirty();
    this.refresh();
  },

  /** 回到微信那张：去掉本机那张，优先级自然回落到 avatarUrl */
  onAvatarClear() {
    store.saveProfile({ avatarLocal: "" });
    sync.markDirty();
    this.refresh();
  },

  onNickname(e) {
    const nickname = (e.detail.value || "").trim();
    if (!nickname) return;
    store.saveProfile({ nickname });
    // 昵称留在本机也够用（微信不重新下发它），但既然要「换机还是我那一套」，
    // 就一起走这一趟 —— 它不占报文体积，也不必单独设计一条通道
    sync.markDirty();
    this.refresh();
  },

  onSettings() {
    wx.navigateTo({ url: "/packages/settings/general/general" });
  },

  onTheme() {
    wx.navigateTo({ url: "/packages/settings/theme/theme" });
  },

  onRecite() {
    wx.navigateTo({ url: "/packages/settings/recite/recite" });
  },

  onReader() {
    wx.navigateTo({ url: "/packages/settings/reader/reader" });
  },

  onProgress() {
    wx.navigateTo({ url: "/packages/progress/index/index" });
  },

  onGame() {
    wx.navigateTo({ url: "/packages/game/index/index" });
  },

  onAbout() {
    wx.navigateTo({ url: "/packages/settings/about/about" });
  },

  onExport() {
    const data = store.exportAll();
    wx.setClipboardData({
      data: JSON.stringify(data),
      success: () => wx.showToast({ title: "备份已复制，粘贴到安全的地方保存", icon: "none", duration: 2500 })
    });
  },

  onClear() {
    wx.showModal({
      title: "清空本机数据",
      content: "背诵进度、已读标记、自选集合都会删掉，且无法恢复。",
      confirmText: "清空",
      confirmColor: "#a83b32",
      success: (res) => {
        if (!res.confirm) return;
        store.clearProgress();
        this.refresh();
        wx.showToast({ title: "已清空", icon: "success" });
      }
    });
  }
});
