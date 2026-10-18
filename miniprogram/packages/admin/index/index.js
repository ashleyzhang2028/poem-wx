const remote = require("../../../utils/remote");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const entitlement = require("../../../utils/entitlement");
const admin = require("../../../utils/admin");
const icons = require("../../../utils/icons");

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    logged: false,
    usersSub: "",

    icons: { chart: icons.chart, trend: icons.trend },
    lineColor: "",
    stats: null,
    range: admin.defaultRange(),
    tab: "bar",
    chart: null,
    curve: ""
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
    this.refresh();
    this.loadStats();
  },

  refresh() {
    this.setData({
      logged: entitlement.snapshot().logged,
      usersSub: remote.adminReady() ? "改档位" : "只读",
      lineColor: theme.currentTheme().rgba
    });
  },

  loadStats() {
    if (!remote.adminReady()) return;
    admin.list().then((res) => {
      if (res.error || !res.stats) return;
      this.setData({ stats: res.stats });
      this.paint();
    });
  },

  paint() {
    const stats = this.data.stats;
    if (!stats) return;
    const range = stats.ranges.filter((r) => r.key === this.data.range)[0] || stats.ranges[0];
    this.setData({
      range: range.key,
      chart: {
        added: range.added,
        avg: range.avg,
        days: range.days
      },
      curve: range.line
    });
  },

  onRange(e) {
    this.setData({ range: e.detail.value });
    this.paint();
  },

  onTab(e) {
    this.setData({ tab: e.detail.value });
  },

  onUsers() {
    wx.navigateTo({ url: "/packages/users/index/index" });
  }
});
