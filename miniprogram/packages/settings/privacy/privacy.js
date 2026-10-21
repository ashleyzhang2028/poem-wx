const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const tabPage = require("../../../utils/tab-page");

const UPDATED = "2026-10-21";
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

  onMine() {
    tabPage.mine();
  }
});
