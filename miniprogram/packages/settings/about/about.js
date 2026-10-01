const store = require("../../../utils/store");

Page({
  data: { stats: {}, version: "1.0.0" },

  onShow() {
    this.setData({ stats: store.stats() });
  },

  onCopyFeedback() {
    wx.setClipboardData({
      data: "belem@cnb.cool",
      success: () => wx.showToast({ title: "邮箱已复制", icon: "none" })
    });
  },

  onTerms() {
    wx.showModal({
      title: "用户协议",
      content: "本小程序为古诗词背诵工具。背诵进度与设置默认只存在这台手机上，不登录不会向外发送任何数据。",
      showCancel: false
    });
  },

  onPrivacy() {
    wx.showModal({
      title: "隐私说明",
      content: "登录后只保存你的微信匿名标识用于跨设备同步，不获取昵称头像（由你主动提供才保存），不做统计、不投广告。",
      showCancel: false
    });
  }
});
