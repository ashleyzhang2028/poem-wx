const corpus = require("../../../utils/corpus");
const S = require("../../../utils/scheduler");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const tabPage = require("../../../utils/tab-page");

const SPAN = S.SPAN;

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const BUCKETS = [
  { label: "0-19% 刚起步", cls: "b0" },
  { label: "20-39% 在记", cls: "b1" },
  { label: "40-59% 过半", cls: "b2" },
  { label: "60-79% 较熟", cls: "b3" },
  { label: "80-100% 牢固", cls: "b4" }
];

const FLOOR = 5;

function md(ts) {
  const d = new Date(ts);
  return d.getMonth() + 1 + "/" + d.getDate();
}

function dayLabel(offset, ts) {
  if (offset === 0) return "今天";
  if (offset === 1) return "明天";
  return WEEKDAYS[new Date(ts).getDay()];
}

function dueText(daysLeft) {
  if (daysLeft < 0) return "逾期 " + -daysLeft + " 天";
  if (daysLeft === 0) return "今天";
  return "还有 " + daysLeft + " 天";
}

function metaOf(row) {
  const parts = [];
  if (row.author) parts.push(row.author);
  if (row.dynasty && row.dynasty !== row.author) parts.push(row.dynasty);
  return parts.join(" · ");
}

function rowsOf(items) {
  return items.map((it) => ({
    id: it.id,
    title: it.title,
    meta: metaOf(it),
    mastery: it.mastery + "%",
    due: dueText(it.daysLeft),
    late: it.daysLeft < 0
  }));
}

Page({
  data: {
    themeStyle: "",
    barBelow: true,

    overview: {},

    masteryPercent: 0,

    calendar: [],
    calSub: "",

    panels: [],
    farther: 0,

    buckets: [],
    bucketsSub: "",

    backlogCount: 0,

    sheetRows: [],

    locked: false
  },

  onShow() {
    this.sheetIds = this.sheetIds || [];
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });
    this.refresh();
  },

  refresh() {
    const all = corpus.course();
    const overview = S.overview(all, SPAN);
    const due = S.dueList(all, SPAN);
    const peak = Math.max(1, overview.maxDay);

    const calendar = overview.calendar.map((d) => ({
      offset: d.offset,
      label: dayLabel(d.offset, d.day),
      date: md(d.day),
      count: d.count,
      today: d.offset === 0,
      has: d.count > 0,
      height: d.count ? Math.max(FLOOR, Math.round((d.count / peak) * 100)) : 0
    }));

    const busy = overview.calendar.filter((d) => d.count > 0).length;

    const days = due.days.map((d) => ({
      offset: d.offset,
      label: d.offset === 0 ? "今天" : dayLabel(d.offset, d.day),
      date: d.offset === 0 ? md(d.day) : "",
      count: d.items.length,
      today: d.offset === 0,
      late: false,
      rows: rowsOf(d.items)
    }));
    const panels = (due.backlog.length ? [{
      offset: -1,
      label: "逾期超一周",
      date: "",
      count: due.backlog.length,
      today: false,
      late: true,
      rows: rowsOf(due.backlog)
    }] : []).concat(days.filter((d) => d.rows.length));

    const bucketMax = Math.max(1, ...overview.masteryBuckets);
    const buckets = BUCKETS.map((b, i) => {
      const count = overview.masteryBuckets[i];
      return {
        label: b.label,
        cls: b.cls,
        count,
        percent: count ? Math.max(FLOOR, Math.round((count / bucketMax) * 100)) : 0
      };
    });

    this.setData({
      overview,
      masteryPercent: overview.learned ? Math.round((overview.mastered / overview.learned) * 100) : 0,
      backlogCount: overview.backlog,
      calendar,
      calSub: busy ? busy + " 天有复习" : "七天内无到期",
      panels,
      farther: due.farther,
      buckets,
      bucketsSub: overview.learned ? "平均 " + overview.avgMastery + "%" : "",
      sheetRows: this.sheetQueue(panels)
    });
  },

  sheetQueue(panels) {
    const ids = this.sheetIds || [];
    const fresh = {};
    panels.forEach((p) => p.rows.forEach((r) => { fresh[r.id] = r; }));
    return ids.map((id) => fresh[id]).filter(Boolean);
  },

  onOpen(e) {
    const ds = e.currentTarget.dataset;
    gate.guard("背诵", this, () => {
      const sheet = this.selectComponent("#sheet");
      if (!sheet) return;
      const panel = this.data.panels.filter((p) => String(p.offset) === String(ds.day))[0];
      const rows = panel ? panel.rows : [];
      this.sheetIds = rows.map((r) => r.id);
      this.setData({ sheetRows: rows });
      sheet.open(rows, ds.id);
    });
  },

  onSheetFinish() {
    this.sheetIds = [];
    this.setData({ sheetRows: [] });
    this.refresh();
  },

  onLogin() {
    tabPage.mine();
  }
});
