const store = require("../../utils/store");
const auth = require("../../utils/auth");
const S = require("../../utils/scheduler");
const E = require("../../utils/entitlement");
const sync = require("../../utils/sync");
const speech = require("../../utils/speech");
const pinyin = require("../../utils/pinyin");
const gate = require("../../utils/gate");
const tiers = require("../../utils/tiers");

Page({
  data: {
    logged: false,
    nickname: "未登录",
    avatarUrl: "",
    gradeName: "",
    scopeName: "",
    algoName: "",
    dailyCount: 5,
    stats: { learned: 0, mastered: 0, readCount: 0 },
    tierLabel: "免费",
    tierSource: "",
    // 表格里这一行「阅读与朗读」在朗读不可用时整个不出现
    speakVisible: false,
    pinyinVisible: false,
    syncReady: false,
    syncText: "还没同步过",
    syncPending: 0,
    fullTextOn: false,

    /** 登录页的那半张卡：从 gate.guard 或首页「微信登录」按钮跳过来时自动聚焦 */
    focusLogin: false,
    adminVisible: false,
    tierNote: ""
  },

  onLoad(query) {
    // ?login=1：别人是点「去登录」过来的，登录卡要顶到最上面，
    // 而不是让用户自己在一个已经滚到一半的页面里找按钮
    this.setData({ focusLogin: query && query.login === "1" });
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const settings = store.settings();
    const profile = store.profile();
    const stats = store.stats();
    const e = E.status();
    const sy = sync.state();
    const sr = speech.readiness();
    const pr = pinyin.readiness();
    const fr = require("../../utils/text-search").readiness();

    this.setData({
      logged: !!profile.logged,
      nickname: profile.nickname || "未登录",
      avatarUrl: profile.avatarUrl || "",
      gradeName: S.gradeName(settings.grade) + S.termName(settings.term),
      scopeName: S.scopeOf(settings.scope).scopeName,
      algoName: require("../../utils/review-models").modelOf(settings.algo).name,
      dailyCount: settings.dailyCount,
      stats,
      tierLabel: e.label,
      tierSource: e.source,
      speakVisible: sr.visible,
      pinyinVisible: pr.visible,
      fullTextOn: fr.usable,
      syncReady: sy.ready,
      syncText: sy.lastText,
      syncPending: sy.pending,
      adminVisible: E.can("admin"),
      tierNote: this.tierNote(e)
    });
  },

  /**
   * 档位那一行该说什么。
   * 三个来源口径不同，混成一句会让人以为「断网就掉档」：
   *   remote —— 服务端给的，可信
   *   grant  —— 授权码，本机记着，服务端那边还没确认
   *   其余   —— 就是免费档，别说得像出错
   */
  tierNote(e) {
    if (!E.loggedIn()) return "登录后由管理员按人分配";
    if (e.source === "remote") return "由管理员分配 · 服务端确认";
    if (e.source === "grant") return "由授权码开启 · 服务端未确认";
    if (e.blocked === "unsigned") return "连不上服务器，暂按免费档算";
    return "免费档 · 登录即得";
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

  onProfile() {
    wx.getUserProfile({
      desc: "用于展示你的昵称与头像",
      success: (res) => {
        const info = res.userInfo || {};
        store.saveProfile({ nickname: info.nickName, avatarUrl: info.avatarUrl });
        this.refresh();
      },
      fail: () => {}
    });
  },

  onAvatarChoose(e) {
    const url = e.detail.avatarUrl;
    if (!url) return;
    store.saveProfile({ avatarUrl: url });
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
