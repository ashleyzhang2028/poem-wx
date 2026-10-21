const store = require("../../utils/store");
const auth = require("../../utils/auth");
const S = require("../../utils/scheduler");
const E = require("../../utils/entitlement");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
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
    nickname: "未登录",
    avatarUrl: "",

    avatarChar: "诗",
    wechatPick: false,
    wechatFocus: false,
    identitySub: "未登录",
    gradeName: "",
    scopeName: "",
    algoName: "",
    dailyCount: 5,
    stats: { learned: 0, mastered: 0, readCount: 0 },

    tierLabel: "Free",

    manageOn: false,

    syncSub: "",
    themeName: "",
    fontName: "",
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
      themeName: theme.currentTheme().name,
      fontName: font.face().name,

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

  onNickname(e) {
    const nickname = (e.detail.value || "").trim();
    if (!nickname) return;
    this.saveNickname(nickname);
  },

  onAvatarTap() {
    if (!this.data.logged) return;
    this.setData({ wechatPick: true });
  },

  onNicknameTap(e) {
    if (!this.data.logged) return;
    if ((e.detail.value || "").trim()) return;
    this.setData({ wechatPick: true });
  },

  onWechatPickClose() {
    this.setData({ wechatPick: false });
  },

  onWechatAvatar(e) {
    this.startWechat("用微信头像");
    this.wechatGive(e && e.detail && e.detail.avatarUrl);
  },

  onWechatNickname(e) {
    this.startWechat("用微信昵称");
    this.wechatGive(this.wechatNicknameOf(e));
  },

  onWechatIdentity(e) {
    this.startWechat("用微信头像和昵称");
    this.wechatGive(e && e.detail && e.detail.avatarUrl);
  },

  startWechat(picked) {
    this.setData({ wechatPick: false });
    this.wechatTyped = "";
    this.wechatPart = "";
    const entry = loginFlow.wechatEntry(picked);
    this.wechatEntryNow = entry;
    entry.ready = (part) => this.wechatArm(part);
    entry.exit = () => this.afterWechatNickname();
    loginFlow.askWechat(this, entry).catch(() => this.afterWechatNickname());
    entry.arm(picked === "用微信昵称" ? "nickname" : "avatar");
  },

  wechatArm(part) {
    this.wechatPart = part;
    this.setData({ wechatFocus: part === "nickname" });
  },

  wechatGive(value) {
    const entry = this.wechatEntryNow;
    const part = this.wechatPart;
    if (!part || !entry) return;
    this.wechatArm("");
    entry.give(value || "");
  },

  wechatNicknameOf(e) {
    const detail = (e && e.detail) || {};
    return detail.value || this.wechatTyped || "";
  },

  onWechatNicknameInput(e) {
    const value = this.wechatNicknameOf(e);
    this.wechatTyped = value;
    if (!value || this.wechatPart !== "nickname") return;
    this.wechatGive(value);
  },

  afterWechatNickname() {
    this.syncBar();
    this.refresh();
  },

  saveNickname(nickname) {
    const before = store.profile().nickname || "";
    store.saveProfile({ nickname });
    this.syncBar();
    sync.markDirty();
    this.refresh();
    auth.saveNickname(nickname).then((r) => this.revertNickname(before, r));
  },

  revertNickname(before, r) {
    if (!r || !r.blocked) return;
    store.saveProfile({ nickname: before });
    this.syncBar();
    this.refresh();
    wx.showToast({ title: r.reason || "这个昵称不能用，换一个吧", icon: "none" });
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

  onTerms() {
    wx.navigateTo({ url: "/packages/settings/terms/terms" });
  },

  onPrivacy() {
    wx.navigateTo({ url: "/packages/settings/privacy/privacy" });
  }

});
