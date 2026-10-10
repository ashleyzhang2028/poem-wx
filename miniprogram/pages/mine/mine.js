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

    avatarChar: "诗",
    identitySub: "未登录",
    gradeName: "",
    scopeName: "",
    algoName: "",
    dailyCount: 5,
    stats: { learned: 0, mastered: 0, readCount: 0 },

    tierLabel: "Free",
    tierSource: "",

    sfxVisible: false,
    syncReady: false,
    syncText: "还没同步过",
    syncPending: 0,

    syncAllowed: false,
    syncNote: "",

    syncSub: "",
    fullTextOn: false,

    caps: [],
    lockedCount: 0,

    focusLogin: false,
    adminVisible: false
  },

  onLoad(query) {

    this.setData({ focusLogin: query && query.login === "1" });
  },

  onShow() {
    theme.apply(this);

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

    this.setData({
      logged: !!profile.logged,
      nickname: profile.logged ? nick : "未登录",
      avatarUrl: src,
      avatarChar: (nick || "诗").slice(0, 1),

      // 副题只说「我是谁」——「这张头像哪来的」不再是用户需要懂的事
      identitySub: !profile.logged ? "未登录" : "已登录 · 微信账号",
      gradeName: S.gradeName(settings.grade) + S.termName(settings.term),
      scopeName: S.scopeOf(settings.scope).scopeName,
      algoName: require("../../utils/review-models").modelOf(settings.algo).name,

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
      adminVisible: E.can("admin"),

      caps: E.matrix({ signedIn: !!profile.logged }),
      lockedCount: E.matrix({ signedIn: !!profile.logged }).filter((c) => !c.ok).length
    });
  },

  onLogin() {
    wx.showLoading({ title: "登录中" });
    auth
      .login()
      .then((res) => {
        wx.hideLoading();

        /* ⚠️ `res.local` 是**没打到服务端**那一支（云调用两栏没填 / 没配）。
           以前这里一律报「已登录」—— 而库里一个字节都没落，用户以为登上了
           （Issue #121）。现在如实说「还没接上服务器」，并指出去填那两栏。 */
        if (res && res.local) {
          this.tellOffline();
          this.refresh();
          return;
        }

        wx.showToast({
          title: res && res.synced ? "已登录 · 进度已认回" : "已登录",
          icon: "none",
          duration: 2500
        });
        this.refresh();
      })
      .catch((err) => {
        wx.hideLoading();
        const code = (err && err.code) || "";
        if (code === "E_WX_NOT_CONFIGURED" || code === "E_WX_CONFIG" || code === "E_WX_TABLE") {
          wx.showModal({
            title: "登录没打通",
            content: (err.message || "") + "\n\n这是服务端/部署那一侧的事，先看「关于与反馈」里的联系方式。",
            showCancel: false
          });
        } else {
          wx.showToast({ title: (err && err.message) || "登录未完成", icon: "none" });
        }
        this.refresh();
      });
  },

  /* 「没接上服务器」怎么讲，只讲一处。
     两栏没填是**运维配置**，用户填不了 —— 所以这里只说会发生什么，
     不指路去点哪个按钮（那两格在管理页里、普通用户看不到）。 */
  tellOffline() {
    const why = auth.offline();
    wx.showModal({
      title: "还没接上同步服务器",
      content: why === "cloud"
        ? "这台手机连不上同步服务器（云调用那两栏没填、或填错了）。\n\n"
          + "登录本身没问题 —— 但**账号与进度不会存到服务端**，换台手机就没了。\n\n"
          + "填一次「我的 → 用户与权限 → 云调用」两张框（要 admin/owner 才看得到）就好。"
        : "这个包还没配同步服务器，账号与进度只在这台手机上。\n\n"
          + "配上之后，登录会把进度与设置跨设备带过去。",
      showCancel: false
    });
  },

  onLogout() {
    wx.showModal({
      title: "退出登录",
      content: "退出后背诵数据不会丢，但功能要重新登录才能用。",
      confirmText: "退出",
      success: (r) => {
        if (!r.confirm) return;
        auth.logout();
        this.refresh();
      }
    });
  },

  syncNote(sy) {
    if (sy.lastSyncAt) return sy.lastText;
    if (!sy.ready) {
      /* ⚠️ 原来是「换手机进度不跟随 · 点一下重试」—— 读起来像**点一下就能好**，
         而没接上服务器时点多少下都不会好（Issue #121）。分开说：没登录是没登录，
         没接服务器是没接服务器。 */
      if (!auth.logged()) return "先登录 · 登录后进度跨设备跟随";
      const why = auth.offline();
      if (why === "cloud") return "同步服务器没接上（云调用两栏）";
      return "同步通道未开 · 进度只在这台手机";
    }
    return "还没同步过 · 点一下同步";
  },

  onSync() {
    wx.showLoading({ title: "同步中" });
    sync.now(true).then((res) => {
      wx.hideLoading();
      let title = "已同步";
      if (res.error) title = "同步失败：" + res.error;
      else if (res.skipped === "offline") title = "同步通道未开 · 进度只在这台手机";
      else if (res.skipped === "throttled") title = "刚同步过，过会儿再来";
      wx.showToast({ title, icon: "none" });
      this.refresh();
    });
  },

  onAdmin() {

    wx.navigateTo({ url: "/packages/admin/index/index" });
  },

  /* 头像就是微信头像，**只落本机、不上传**。
     平台没有「静默拿微信头像」的 API（2022 起 getUserProfile 只回匿名灰头像），
     唯一合规的路就是这一下 chooseAvatar。而它给回来的是一枚临时文件路径
     （wxfile://…）—— 那是这台机器上的东西，换台手机没有意义，
     服务端的 sanitizeImgUrl 也只收 https 与 /api/avatar/。
     所以这一格**不进同步报文**：不上传，也就不需要对象存储。 */
  onAvatarChoose(e) {
    const url = e.detail.avatarUrl;
    if (!url) return;
    store.saveProfile({ avatarLocal: url });
    this.refresh();
  },

  onNickname(e) {
    const nickname = (e.detail.value || "").trim();
    if (!nickname) return;
    store.saveProfile({ nickname });

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

  onPlans() {
    wx.navigateTo({ url: "/packages/settings/plans/plans" });
  },

  onLoginGate() {

    this.onLogin();
  },

  onExport() {
    if (!E.block("export.progress", { page: this })) return;
    const data = store.exportAll();
    wx.setClipboardData({
      data: JSON.stringify(data),
      success: () => wx.showToast({ title: "备份已复制，粘贴到安全的地方保存", icon: "none", duration: 2500 })
    });
  },

  onLogout() {
    wx.showModal({
      title: "退出登录",
      content: "退出后回到浏览模式：首页仍可看一年级诗词，其余能力要重新登录。已背的进度不会被删。",
      confirmText: "退出",
      confirmColor: "#a83b32",
      success: (res) => {
        if (!res.confirm) return;
        auth.logout();
        this.refresh();
        wx.showToast({ title: "已退出登录", icon: "none" });
      }
    });
  },

  onClear() {
    wx.showModal({
      title: "清空背诵数据",
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
