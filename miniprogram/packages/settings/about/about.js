const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const auth = require("../../../utils/auth");
const loginFlow = require("../../../utils/login-flow");
const tabPage = require("../../../utils/tab-page");
const fb = require("../../../utils/feedback-api");
const dots = require("../../../utils/dots");

Page({
  data: { themeStyle: "", name: "", barBelow: true, version: "1.0.0", logged: false, replyDot: false },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
  },

  onShow() {
    this.applyFont();
    this.setData({ barBelow: tabbar.below(this), logged: auth.logged() });
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

  onLogout() {
    if (!auth.logged()) return;
    wx.showModal({
      title: "退出登录",
      content: "吟咏笔录，积日累月，皆藏云笈。\n此行暂歇，他日重至，诗章犹在。",
      confirmText: "退出",
      cancelText: "留步",
      success: (r) => (r && r.confirm ? this.leave() : null)
    });
  },

  leave() {
    auth.logout();
    loginFlow.report();
    tabPage.mine();
  }
});
