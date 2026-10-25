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
const gate = require("../../utils/gate");
const guard = require("../../utils/guard");
const pay = require("../../utils/pay");

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    guestClass: "",
    logged: false,
    gradeName: "",
    scopeName: "",
    algoName: "",
    dailyCount: 5,
    stats: { learned: 0, mastered: 0, readCount: 0 },

    tierLabel: "Free",

    manageOn: false,
    expiry: null,

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

    this.syncClass();
    this.loadExpiry();
  },

  loadExpiry() {
    if (!this.data.logged) {
      if (this.data.expiry) this.setData({ expiry: null });
      return;
    }
    pay.expiry().then((e) => this.setData({ expiry: pay.expiryText(e) }));
  },

  onPricing() {
    wx.navigateTo({ url: "/packages/mine/pricing/pricing" });
  },

  syncClass() {
    const guestClass = this.data.logged ? "" : "guest";
    if (guestClass !== this.data.guestClass) this.setData({ guestClass });
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
      if (auth.offline() === "cloud") return "服务未连接 · 进度仅存于本机";
      return "同步未开启 · 进度仅存于本机";
    }
    if (sy.later) return sy.lastText + " · " + sy.pendingText;
    if (sy.failed) return sy.failedText + " 未同步成功 · " + sy.pendingText;
    return sy.lastText + " · " + sy.pendingStatus;
  },

  onSync() {
    if (!E.can("sync")) {
      wx.showToast({ title: E.hint("sync"), icon: "none" });
      return;
    }
    wx.showLoading({ title: "正在同步" });
    guard.once("sync:now", () => sync.now(true)).then((res) => {
      wx.hideLoading();
      if (!res || res.skipped === true) return;
      let title = "同步完成";
      if (res.error) title = sync.state().later ? "同步过于频繁，请稍后再试" : "同步失败：" + res.error;
      else if (res.skipped === "busy") title = "正在同步，请稍候";
      else if (res.skipped === "offline") title = "同步未开启，进度仅存于本机";
      else if (res.skipped === "throttled") title = "刚刚已同步，请稍后再试";
      else if (res.skipped === "waiting") title = "上次同步未成功，" + sync.waitText(res.retryAfter) + "后自动重试";
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

  onFeedback() {
    if (!gate.open(null, this)) return;
    wx.navigateTo({ url: "/packages/feedback/index/index" });
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
    if (!E.block("collections", { page: this })) return;
    wx.navigateTo({ url: "/packages/settings/collections/collections" });
  },

  requireRecite() {
    return E.block("daily", { page: this });
  },

  onAbout() {
    wx.navigateTo({ url: "/packages/settings/about/about" });
  },

  onTierGate() {
    this.onPricing();
  }

});
