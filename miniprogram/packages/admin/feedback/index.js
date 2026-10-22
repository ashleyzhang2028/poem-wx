const adminFb = require("../../../utils/admin-feedback");
const admin = require("../../../utils/admin");
const loginFlow = require("../../../utils/login-flow");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    logged: false,
    canWrite: false,

    groups: [],
    counts: {},
    reason: ""
  },

  onLogin() {
    loginFlow.run(this);
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this), logged: admin.loggedIn(), canWrite: admin.canWrite() });
    this.load();
  },

  load() {
    if (!this.data.logged) return;
    this.setData({ reason: "" });
    adminFb.list().then((res) => {
      this.setData({
        groups: res.groups,
        counts: res.counts,
        reason: res.ok ? "" : res.reason
      });
    });
  },

  onOpen(e) {
    const tid = e.currentTarget.dataset.tid;
    if (!tid) return;
    wx.navigateTo({ url: "/packages/admin/feedback/detail/detail?tid=" + encodeURIComponent(tid) });
  }
});
