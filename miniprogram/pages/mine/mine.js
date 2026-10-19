const store = require("../../utils/store");
const auth = require("../../utils/auth");
const S = require("../../utils/scheduler");
const E = require("../../utils/entitlement");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const tiers = require("../../utils/tiers");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");
const loginFlow = require("../../utils/login-flow");

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
    this.setData({ barBelow: !!tabbar.sync(this, 4) });
    this.refresh();
  },

  refresh() {
    const settings = store.settings();
    const profile = store.profile();
    const stats = store.stats();
    const e = E.status();
    const sy = sync.state();
    const fr = require("../../utils/text-search").readiness();

    const nick = store.displayName();
    const src = store.avatarSrc();

    this.setData({
      logged: !!profile.logged,
      nickname: profile.logged ? nick : "未登录",
      avatarUrl: src,
      avatarChar: store.avatarChar(),

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
    return !profile.avatarLocal && store.defaultNick(profile.nickname);
  },

  onLogin() {
    loginFlow.run(this).catch(() => {});
  },

  onLogout() {
    wx.showModal({
      title: "退出登录",
      content: "退出后背诵数据不会丢，但功能要重新登录才能用。",
      confirmText: "退出",
      cancelText: "取消",
      success: (r) => {
        if (!r.confirm) return;
        auth.logout();
        this.refresh();
      }
    });
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
      else if (res.skipped === "waiting") title = "上次没同步上，" + res.retryAfter + " 秒后自动再试";
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
    store.saveProfile({ avatarLocal: url });
    this.syncBar();
    this.refresh();
  },

  onNickname(e) {
    const nickname = (e.detail.value || "").trim();
    if (!nickname) return;
    this.saveNickname(nickname);
  },

  onAvatarTap() {
    this.chooseWechatAvatar(false);
  },

  onUseWechatAvatar() {
    this.chooseWechatAvatar(false);
  },

  onUseWechatIdentity() {
    this.chooseWechatAvatar(true);
  },

  chooseWechatAvatar(withNickname) {
    wx.chooseAvatar({
      success: (r) => {
        this.storeAvatar(r && r.avatarUrl);
        if (!withNickname) {
          wx.showToast({ title: "头像已换成微信的", icon: "none" });
          return;
        }
        this.saveNickname(this.data.nickname);
        wx.showToast({ title: "头像与昵称都换成微信的了", icon: "none" });
      }
    });
  },

  storeAvatar(url) {
    if (!url) return;
    store.saveProfile({ avatarLocal: url });
    this.syncBar();
    this.refresh();
  },

  saveNickname(nickname) {
    store.saveProfile({ nickname });
    this.syncBar();
    sync.markDirty();
    auth.saveNickname(nickname);
    this.refresh();
  },

  syncBar() {
    tabbar.sync(this, 4);
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
    if (!gate.guard("自选背诵", this)) return;
    wx.navigateTo({ url: "/packages/settings/collections/collections" });
  },

  onAbout() {
    wx.navigateTo({ url: "/packages/settings/about/about" });
  },

  onLoginGate() {
    this.onLogin();
  },

  onTierGate() {
    this.onTier();
  },

  onPrivacy() {
    wx.navigateTo({ url: "/packages/settings/privacy/privacy" });
  },

  onClear() {
    wx.showModal({
      title: "清空背诵数据",
      content: "背诵进度、已读标记、今日加背都会删掉，本机与云端的记录一起清，且无法恢复。",
      confirmText: "清空",
      cancelText: "取消",
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
