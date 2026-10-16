const remote = require("../../../utils/remote");
const theme = require("../../../utils/theme");
const entitlement = require("../../../utils/entitlement");
const tabPage = require("../../../utils/tab-page");

Page({
  data: {
    themeStyle: "",
    logged: false,
    status: {},
    heads: [],
    compareGroups: [],
    compareSummary: [],
    stats: { caps: 0, enabled: 0 },

    usersSub: ""
  },

  onShow() {
    theme.apply(this);
    this.refresh();
  },

  refresh() {
    const snap = entitlement.snapshot();
    const ready = remote.adminReady();

    this.setData({
      logged: snap.logged,
      status: snap,
      heads: entitlement.compareCols(snap),
      compareGroups: entitlement.compareGroups(snap),
      compareSummary: entitlement.compareSummary(snap),
      stats: entitlement.stats(),
      usersSub: ready ? "改档位 · 改角色" : "只读"
    });
  },

  onLogin() {
    tabPage.mine();
  },

  onUsers() {
    wx.navigateTo({ url: "/packages/users/index/index" });
  }
});
