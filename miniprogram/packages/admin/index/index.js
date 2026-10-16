const remote = require("../../../utils/remote");
const theme = require("../../../utils/theme");
const entitlement = require("../../../utils/entitlement");

Page({
  data: {
    themeStyle: "",
    logged: false,
    usersSub: ""
  },

  onShow() {
    theme.apply(this);
    this.refresh();
  },

  refresh() {
    this.setData({
      logged: entitlement.snapshot().logged,
      usersSub: remote.adminReady() ? "改档位" : "只读"
    });
  },

  onUsers() {
    wx.navigateTo({ url: "/packages/users/index/index" });
  }
});
