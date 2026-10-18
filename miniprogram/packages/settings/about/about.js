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
    wx.showModal({
      title: "用户协议",
      content:
        "本小程序为古诗词背诵工具。背诵进度与设置默认只存在这台手机上，" +
        "不登录不会向外发送任何数据；登录后可跨设备同步，你随时可以清空。",
      showCancel: false
    });
  },

  onPrivacy() {
    wx.navigateTo({ url: "/packages/settings/privacy/privacy" });
  }
});
