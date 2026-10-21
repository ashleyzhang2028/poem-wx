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
    curve: "",
    rankingOn: false,
    rankingNote: "默认关 · 打开后大会页的排行榜才能点进去"
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
    this.refresh();
    this.loadRanking();
  },

  loadRanking() {
    admin.rankingState().then((res) => {
      this.setData({
        logged: entitlement.snapshot().logged,
        rankingOn: !!res.on,
        rankingNote: res.note || (remote.adminReady()
          ? (res.on ? "已打开" : "关 · 打开后大会页的排行榜才能点进去")
          : "只读")
      });
      if (this.data.logged) this.loadStats();
    });
  },

  onRanking(e) {
    const on = !!e.detail.value;
    this.setData({ rankingOn: on, rankingNote: "正在写…" });
    admin.setRanking(on).then((res) => {
      if (!res.ok) {
        this.setData({ rankingOn: !on, rankingNote: res.msg });
        wx.showModal({ title: "没写进去", content: res.msg, showCancel: false });
        return;
      }
      this.setData({ rankingOn: !!res.on, rankingNote: res.on ? "已打开" : "已隐藏" });
    });
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
