const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");

const UPDATED = "2026-10-23";
const CONTACT = "kuibuapp@163.com";

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    updated: UPDATED,
    contact: CONTACT
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
  },

  onCopyContact() {
    wx.setClipboardData({
      data: CONTACT,
      success: () => wx.showToast({ title: "邮箱已复制", icon: "none" })
    });
  },

  onPrivacy() {
    wx.navigateTo({ url: "/packages/settings/privacy/privacy" });
  }
});
