const corpus = require("../../../utils/corpus");
const store = require("../../../utils/store");
const S = require("../../../utils/scheduler");
const gate = require("../../../utils/gate");

const SPAN = 7;

Page({
  data: {
    overview: {},
    days: [],
    backlogCount: 0,
    farther: 0,
    stageRows: [],
    locked: false
  },

  onShow() {
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });

    const all = corpus.course();
    const overview = S.overview(all);
    const fc = S.forecast(all, SPAN);
    const algo = S.algoKey();

    // 记忆阶段分布：把每条记录折算到当前算法的档位名上
    const buckets = {};
    all.forEach((p) => {
      const rec = store.getRecord(p.id);
      if (!rec || !rec.learned) return;
      const name = S.stageName(rec);
      buckets[name] = (buckets[name] || 0) + 1;
    });

    const stageRows = Object.keys(buckets)
      .map((name) => ({ name, count: buckets[name] }))
      .sort((a, b) => b.count - a.count);

    this.setData({
      overview,
      backlogCount: fc.backlog.length,
      farther: fc.farther,
      days: fc.days.map((d) => ({
        label: d.offset === 0 ? "今天" : d.offset === 1 ? "明天" : (new Date(d.day).getMonth() + 1) + "/" + new Date(d.day).getDate(),
        count: d.items.length,
        items: d.items.slice(0, 8)
      })),
      stageRows
    });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  }
});
