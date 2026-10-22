const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");

Page({
  data: { themeStyle: "", barBelow: true, version: "1.0.0" },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
  },

  onFeedback() {
    wx.navigateTo({ url: "/packages/feedback/index/index" });
  },

  onTerms() {
    wx.navigateTo({ url: "/packages/settings/terms/terms" });
  },

  onPrivacy() {
    wx.navigateTo({ url: "/packages/settings/privacy/privacy" });
  }
});
