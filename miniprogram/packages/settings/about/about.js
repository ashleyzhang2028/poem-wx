const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const auth = require("../../../utils/auth");
const loginFlow = require("../../../utils/login-flow");
const tabPage = require("../../../utils/tab-page");
const fb = require("../../../utils/feedback-api");
const dots = require("../../../utils/dots");
const errors = require("../../../utils/error-log");

Page({
  data: { themeStyle: "", name: "", barBelow: true, version: "1.0.0", logged: false, replyDot: false, faults: 0 },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
  },

  onShow() {
    this.applyFont();
    this.setData({ barBelow: tabbar.below(this), logged: auth.logged(), faults: errors.count() });
    this.loadDot();
  },

  loadDot() {
    if (!auth.logged()) {
      this.setData({ replyDot: false });
      return;
    }
    fb.mine().then((res) => {
      this.setData({ replyDot: dots.fresh("reply", fb.latestReply(res.threads)) });
    });
  },

  onFeedback() {
    wx.navigateTo({ url: "/packages/feedback/index/index" });
  },

  onTerms() {
    wx.navigateTo({ url: "/packages/settings/terms/terms" });
  },

  onPrivacy() {
    wx.navigateTo({ url: "/packages/settings/privacy/privacy" });
  },

  onFaults() {
    const text = errors.dump();
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: "记录已复制", icon: "none" })
    });
  },

  onFaultsClear() {
    if (!errors.count()) return;
    wx.showModal({
      title: "清空记录",
      content: "清空后这些记录不再保留，问题未复现时不必清空。",
      confirmText: "清空",
      cancelText: "取消",
      success: (r) => {
        if (!r || !r.confirm) return;
        errors.clear();
        this.setData({ faults: 0 });
      }
    });
  },

  onLogout() {
    if (!auth.logged()) return;
    wx.showModal({
      title: "退出登录",
      content: "退出后数据保留在云端，重新登录即可恢复。",
      confirmText: "退出",
      cancelText: "取消",
      success: (r) => (r && r.confirm ? this.leave() : null)
    });
  },

  leave() {
    auth.logout();
    loginFlow.report();
    tabPage.mine();
  }
});
