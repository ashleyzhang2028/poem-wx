const remote = require("../../../utils/remote");
const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const entitlement = require("../../../utils/entitlement");
const admin = require("../../../utils/admin");
const icons = require("../../../utils/icons");
const guard = require("../../../utils/guard");
const adminFb = require("../../../utils/admin-feedback");
const dots = require("../../../utils/dots");

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    logged: false,
    usersSub: "",
    feedbackSub: "",
    feedbackDot: false,
    usersDot: false,

    icons: { chart: icons.chart, trend: icons.trend },
    lineColor: "",
    stats: null,
    range: admin.defaultRange(),
    tab: "bar",
    chart: null,
    curve: ""
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
  },

  onShow() {
    this.applyFont();
    this.setData({ barBelow: tabbar.below(this) });
    this.refresh();
  },

  refresh() {
    this.setData({
      logged: entitlement.snapshot().logged,
      usersSub: remote.adminReady() ? "改档位" : "只读",
      feedbackSub: remote.adminReady() ? "列表 · 回复" : "只读",
      lineColor: theme.currentTheme().rgba
    });
    this.loadStats();
    this.loadDots();
  },

  loadDots() {
    if (!remote.adminReady()) return;
    guard.once("admin:feedback", () => adminFb.list()).then((res) => {
      if (res && res.ok) this.setData({ feedbackDot: dots.fresh("adminFeedback", res.latest) });
    });
  },

  loadStats() {
    if (!remote.adminReady()) return;
    guard.once("admin:stats", () => admin.list()).then((res) => {
      if (!res || res.error || !res.stats) return;
      this.setData({ usersDot: dots.fresh("users", res.newest) });
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
  },

  onPay() {
    wx.navigateTo({ url: "/packages/admin/pay/pay" });
  },

  onFeedback() {
    wx.navigateTo({ url: "/packages/admin/feedback/index" });
  }
});
