const store = require("../../utils/store");
const auth = require("../../utils/auth");
const S = require("../../utils/scheduler");
const E = require("../../utils/entitlement");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const tiers = require("../../utils/tiers");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");

Page({
  data: {
    themeStyle: "",
    barBelow: true,
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

    manageOn: false,

    syncSub: "",
    fullTextOn: false,

    grantLead: false
  },

  onShow() {
    theme.apply(this);

    const bar = tabbar.sync(this, 4);
    this.setData({ barBelow: !bar });
    if (bar) tabbar.show(this);
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

      identitySub: !profile.logged ? "未登录" : "已登录 · 微信账号",
      gradeName: S.gradeName(settings.grade) + S.termName(settings.term),
      scopeName: S.scopeOf(settings.scope).scopeName,
      algoName: require("../../utils/review-models").modelOf(settings.algo).name,

      dailyCount: settings.dailyCount,
      stats,
      tierLabel: e.label,
      manageOn: !!profile.logged && ["owner", "admin"].indexOf(auth.role()) >= 0,
      fullTextOn: fr.usable,
      syncSub: this.syncSub(sy),

      grantLead: this.grantLead(profile)
    });
  },

  grantLead(profile) {
    if (!profile.logged) return false;
    if (profile.identityAsked) return false;
    return !profile.avatarLocal && this.defaultNick(profile);
  },

  defaultNick(profile) {
    const nick = profile.nickname || "";
    return !nick || nick === "我的古诗词";
  },

  onLogin() {
    wx.showLoading({ title: "登录中" });
    auth
      .login()
      .then((res) => {
        wx.hideLoading();

        if (res && res.synced) {
          wx.showToast({ title: "已登录 · 进度已认回", icon: "none", duration: 2500 });
        } else {
          wx.showToast({ title: "已登录 · 这台手机上的记录还在", icon: "none", duration: 2500 });
        }
        this.refresh();
      })
      .catch((err) => {
        wx.hideLoading();
        console.error("[mine] onLogin fail", err);
        const code = (err && err.code) || "";
        if (code === "E_NOT_CONFIGURED") {
          this.tellOffline();
        } else if (code === "E_CLOUD_OFF" || code === "E_CLOUD_INIT") {
          wx.showModal({
            title: "同步服务器没接上",
            content:
              "登录与课外正文都要连服务器，这个包还没接上。\n\n"
              + "这不是这台手机能改的，找部署方（见「关于」）。",
            showCancel: false,
            confirmText: "知道了"
          });
        } else if (code === "E_WX_NOT_CONFIGURED" || code === "E_WX_CONFIG" || code === "E_WX_TABLE") {
          wx.showModal({
            title: "登录没打通",
            content: (err.message || "") + "\n\n这是服务端/部署那一侧的事，先看「关于」里的联系方式。",
            showCancel: false
          });
        } else if (err && err.cloudFail) {
          wx.showModal({
            title: "登录没有连上服务器",
            content: (err.message || "") + "\n\n这不是这台手机能改的，把这整段发给部署方。",
            showCancel: false
          });
        } else {
          wx.showToast({ title: (err && err.message) || "登录未完成", icon: "none" });
        }
        this.refresh();
      });
  },

  tellOffline() {
    wx.showModal({
      title: "还没接上同步服务器",
      content:
        "登录连不上服务器，账号与进度只在这台手机上，换台手机就没了。\n\n"
        + "这不是这台手机能改的，找部署方（见「关于」）。",
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

  syncSub(sy) {
    if (sy.ready) return sy.lastText + " · " + sy.pendingStatus;
    if (!sy.ready && auth.offline() === "cloud") return "服务器没接上 · 进度只在这台手机";
    return "同步通道未开 · 进度只在这台手机";
  },

  onSync() {
    if (!E.can("sync")) {
      wx.showToast({ title: E.hint("sync"), icon: "none" });
      return;
    }
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

  onTier() {
    wx.navigateTo({ url: "/packages/mine/tier/tier" });
  },

  onManage() {
    wx.navigateTo({ url: "/packages/admin/index/index" });
  },

  onAvatarChoose(e) {
    const url = e.detail.avatarUrl;
    if (!url) return;
    store.saveProfile({ avatarLocal: url, identityAsked: true });
    this.refresh();
  },

  onNickname(e) {
    const nickname = (e.detail.value || "").trim();
    if (!nickname) return;
    store.saveProfile({ nickname });

    sync.markDirty();
    auth.saveNickname(nickname);
    this.refresh();
    this.settleGrant(nickname);
  },

  settleGrant(nickname) {
    if (!nickname || nickname === "我的古诗词") return;
    store.saveProfile({ identityAsked: true });
  },

  onGrantLeadSkip() {
    store.saveProfile({ identityAsked: true });
    this.refresh();
  },

  onSettings() {
    wx.navigateTo({ url: "/packages/settings/general/general" });
  },

  onRecite() {
    wx.navigateTo({ url: "/packages/settings/recite/recite" });
  },

  onProgress() {
    wx.navigateTo({ url: "/packages/progress/index/index" });
  },

  onCollections() {
    if (!gate.guard("自选背诵")) return;
    wx.navigateTo({ url: "/packages/settings/collections/collections" });
  },

  onAbout() {
    wx.navigateTo({ url: "/packages/settings/about/about" });
  },

  onLoginGate() {

    this.onLogin();
  },

  onPrivacy() {
    wx.navigateTo({ url: "/packages/settings/privacy/privacy" });
  },

  onClear() {
    wx.showModal({
      title: "清空背诵数据",
      content: "背诵进度、已读标记、今日加背都会删掉，本机与云端的记录一起清，且无法恢复。",
      confirmText: "清空",
      confirmColor: "#a83b32",
      success: (res) => {
        if (!res.confirm) return;
        store.clearProgress();
        sync.markDirty();
        this.refresh();
        wx.showToast({ title: "已清空", icon: "success" });
      }
    });
  }
});
