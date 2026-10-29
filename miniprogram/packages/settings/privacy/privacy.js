const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const tabPage = require("../../../utils/tab-page");

const UPDATED = "2026-10-23";
const CONTACT = "kuibuapp@163.com";

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    updated: UPDATED,
    contact: CONTACT
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
  },

  onShow() {
    this.applyFont();
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
