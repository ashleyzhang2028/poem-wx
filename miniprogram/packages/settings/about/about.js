const store = require("../../../utils/store");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");

Page({
  data: { themeStyle: "", barBelow: true, stats: {}, version: "1.0.0" },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
    this.setData({ stats: store.stats() });
  },

  onCopyFeedback() {
    wx.setClipboardData({
      data: "kuibuapp@163.com",
      success: () => wx.showToast({ title: "邮箱已复制", icon: "none" })
    });
  },

  onTerms() {
    wx.navigateTo({ url: "/packages/settings/terms/terms" });
  },

  onPrivacy() {
    wx.navigateTo({ url: "/packages/settings/privacy/privacy" });
  }
});
