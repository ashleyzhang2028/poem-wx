const store = require("../../utils/store");
const auth = require("../../utils/auth");
const S = require("../../utils/scheduler");
const E = require("../../utils/entitlement");
const sync = require("../../utils/sync");
const pinyin = require("../../utils/pinyin");
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
    pinyinVisible: false,
    syncReady: false,
    syncText: "还没同步过",
    syncPending: 0,
    /** 云端同步是 pro 起（服务端定的）。free 档如实说明「只在本机」 */
    syncAllowed: false,
    syncNote: "",
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
    const pr = pinyin.readiness();
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
      pinyinVisible: pr.visible,
      fullTextOn: fr.usable,
      syncReady: sy.ready,
      syncText: sy.lastText,
      syncPending: sy.pending,
      syncAllowed: E.can("sync"),
      syncNote: this.syncNote(sy),
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
          wx.showToast({ title: "已登录", icon: "success" });
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
   * 同步那一行该说什么。**先说「能不能同步」，再说「同步到哪了」** ——
   * 上一版只说后者，于是 free 档用户看到「还没同步过」，
   * 点了才知道服务端 403（E_TIER）。那是「按钮亮着、点下去弹 toast」的翻版。
   */
  syncNote(sy) {
    if (!E.can("sync")) return "要 Pro 起才能跨设备同步；进度在本机一字不少";
    if (!sy.ready) return "后端未就绪 · 已攒 " + sy.pending + " 条";
    return sy.lastText;
  },

  onSync() {
    if (!E.can("sync")) {
      wx.showModal({
        title: "跨设备同步要 Pro 起",
        content:
          "进度现在只存在这台手机上，一字不少，背诵不受影响。\n\n" +
          "要换手机不丢进度，找管理员开 Pro。",
        showCancel: false,
        confirmText: "知道了"
      });
      return;
    }
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
    this.refresh();
  },

  /** 回到微信那张：去掉本机那张，优先级自然回落到 avatarUrl */
  onAvatarClear() {
    store.saveProfile({ avatarLocal: "" });
    this.refresh();
  },

  onNickname(e) {
    const nickname = (e.detail.value || "").trim();
    if (!nickname) return;
    store.saveProfile({ nickname });
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
