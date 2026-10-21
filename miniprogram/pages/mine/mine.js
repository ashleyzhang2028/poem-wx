const store = require("../../utils/store");
const auth = require("../../utils/auth");
const S = require("../../utils/scheduler");
const E = require("../../utils/entitlement");
const sync = require("../../utils/sync");
const tiers = require("../../utils/tiers");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");
const font = require("../../utils/font");
const loginFlow = require("../../utils/login-flow");

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    logged: false,
    gradeName: "",
    scopeName: "",
    algoName: "",
    dailyCount: 5,
    stats: { learned: 0, mastered: 0, readCount: 0 },

    tierLabel: "Free",

    manageOn: false,

    syncSub: "",
    themeName: "",
    fontName: ""
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: !!tabbar.sync(this, 4) });
    this.refresh();
  },

  onLoad() {
    this.onLoginSettled = (res) => this.onIdentityChanged(res);
    loginFlow.watch(this.onLoginSettled);
  },

  onUnload() {
    loginFlow.unwatch(this.onLoginSettled);
  },

  refresh() {
    const settings = store.settings();
    const profile = store.profile();
    const stats = store.stats();
    const e = E.status();
    const sy = sync.state();

    this.setData({
      logged: !!profile.logged,
      gradeName: S.gradeName(settings.grade) + S.termName(settings.term),
      scopeName: S.scopeOf(settings.scope).scopeName,
      algoName: require("../../utils/review-models").modelOf(settings.algo).name,

      dailyCount: settings.dailyCount,
      stats,
      tierLabel: e.label,
      manageOn: !!profile.logged && ["owner", "admin"].indexOf(auth.role()) >= 0,
      syncSub: this.syncSub(sy),
      themeName: theme.currentTheme().name,
      fontName: font.face().name
    });
  },

  onLogin() {
    loginFlow.askLogin(this);
  },

  onIdentityChanged(res) {
    const panel = this.selectComponent("#login");
    if (panel && typeof panel.refresh === "function") panel.refresh();
    this.syncBar();
    this.refresh();
    if (res && res.logged === true && E.can("sync")) sync.now(true).catch(() => {});
  },

  syncSub(sy) {
    if (!sy.ready) {
      if (auth.offline() === "cloud") return "服务器没接上 · 进度只在这台手机";
      return "同步通道未开 · 进度只在这台手机";
    }
    if (sy.later) return sy.lastText + " · " + sy.pendingText;
    if (sy.failed) return sy.failedText + " 没同步上 · " + sy.pendingText;
    return sy.lastText + " · " + sy.pendingStatus;
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
      if (res.error) title = sync.state().later ? "同步太频繁，等一会儿再试" : "同步失败：" + res.error;
      else if (res.skipped === "offline") title = "同步通道未开 · 进度只在这台手机";
      else if (res.skipped === "throttled") title = "刚同步过，过会儿再来";
      else if (res.skipped === "waiting") title = "上次没同步上，" + sync.waitText(res.retryAfter) + "后自动再试";
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

  syncBar() {
    tabbar.sync(this, 4);
  },

  onSettings() {
    wx.navigateTo({ url: "/packages/settings/general/general" });
  },

  onTheme() {
    wx.navigateTo({ url: "/packages/settings/theme/theme" });
  },

  onRecite() {
    if (!this.requireRecite()) return;
    wx.navigateTo({ url: "/packages/settings/recite/recite" });
  },

  onProgress() {
    if (!this.requireRecite()) return;
    wx.navigateTo({ url: "/packages/progress/index/index" });
  },

  onCollections() {
    if (!this.requireRecite()) return;
    E.block("collections", { page: this, loginPrompt: false });
    if (!E.can("collections")) return;
    wx.navigateTo({ url: "/packages/settings/collections/collections" });
  },

  requireRecite() {
    E.block("daily", { page: this, loginPrompt: false });
    return E.loggedIn();
  },

  onAbout() {
    wx.navigateTo({ url: "/packages/settings/about/about" });
  },

  onTierGate() {
    this.onTier();
  },

  onTerms() {
    wx.navigateTo({ url: "/packages/settings/terms/terms" });
  },

  onPrivacy() {
    wx.navigateTo({ url: "/packages/settings/privacy/privacy" });
  }

});
