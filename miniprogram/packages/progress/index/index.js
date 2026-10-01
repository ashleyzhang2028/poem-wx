const corpus = require("../../../utils/corpus");
const store = require("../../../utils/store");
const S = require("../../../utils/scheduler");
const gate = require("../../../utils/gate");

const SPAN = 7;

/** 那七行怎么称呼：头两天说「今天 / 明天」，再往后给日期 */
function dayLabel(d) {
  if (d.offset === 0) return "今天";
  if (d.offset === 1) return "明天";
  const t = new Date(d.day);
  return t.getMonth() + 1 + "/" + t.getDate();
}

Page({
  data: {
    overview: {},
    /** 掌握度环里的百分数 */
    masteryPercent: 0,
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

    // 那几条细条要按当天计划数的峰值归一，否则每天都是满条，看不出轻重
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
      days,
      stageRows
    });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  }
});
