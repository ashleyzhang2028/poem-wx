const corpus = require("../../../utils/corpus");
const store = require("../../../utils/store");
const S = require("../../../utils/scheduler");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");

const SPAN = 7;

function dayLabel(d) {
  if (d.offset === 0) return "今天";
  if (d.offset === 1) return "明天";
  const t = new Date(d.day);
  return t.getMonth() + 1 + "/" + t.getDate();
}

Page({
  data: {
    overview: {},

    masteryPercent: 0,
    days: [],
    backlogCount: 0,
    farther: 0,
    locked: false
  },

  onShow() {
    theme.apply(this);
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });

    const all = corpus.course();
    const overview = S.overview(all);
    const fc = S.forecast(all, SPAN);

    const peak = Math.max(1, ...fc.days.map((d) => d.items.length));
    const days = fc.days.map((d) => ({
      label: dayLabel(d),
      count: d.items.length,
      today: d.offset === 0,
      percent: Math.round((d.items.length / peak) * 100),
      items: d.items.slice(0, 8)
    }));

    this.setData({
      overview,
      masteryPercent: overview.learned ? Math.round((overview.mastered / overview.learned) * 100) : 0,
      backlogCount: fc.backlog.length,
      farther: fc.farther,
      days
    });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  }
});
