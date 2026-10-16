const theme = require("../../../utils/theme");
const tabPage = require("../../../utils/tab-page");

const UPDATED = "2026-10-16";
const CONTACT = "kuibuapp@163.com";

Page({
  data: {
    themeStyle: "",
    updated: UPDATED,
    contact: CONTACT
  },

  onShow() {
    theme.apply(this);
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
