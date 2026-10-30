const S = require("../../utils/scheduler");
const corpus = require("../../utils/corpus");

const SPAN = S.SPAN;

const FLOOR = 5;

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const BUCKETS = [
  { label: "0-19% 刚起步", cls: "b0" },
  { label: "20-39% 在记", cls: "b1" },
  { label: "40-59% 过半", cls: "b2" },
  { label: "60-79% 较熟", cls: "b3" },
  { label: "80-100% 牢固", cls: "b4" }
];


const LABELS = {
  title: "温习进度",
  stats: ["已学", "已掌握", "今日到期", "平均掌握"],
  calendar: "到期日历",
  due: "全部到期篇目",
  buckets: "掌握度分布",
  defer: "延后温习"
};

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
  if (row.a) parts.push(row.a);
  if (row.d && row.d !== row.a) parts.push(row.d);
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

function bucketsOf(list) {
  const peak = Math.max(1, ...list);
  return BUCKETS.map((b, i) => ({
    label: b.label,
    cls: b.cls,
    count: list[i],
    percent: list[i] ? Math.max(FLOOR, Math.round((list[i] / peak) * 100)) : 0
  }));
}

function calendarOf(overview) {
  const peak = Math.max(1, overview.maxDay);
  return overview.calendar.map((d) => ({
    offset: d.offset,
    label: dayLabel(d.offset, d.day),
    date: md(d.day),
    count: d.count,
    today: d.offset === 0,
    has: d.count > 0,
    height: d.count ? Math.max(FLOOR, Math.round((d.count / peak) * 100)) : 0
  }));
}

function panelsOf(due) {
  const days = due.days.map((d) => ({
    offset: d.offset,
    label: dayLabel(d.offset, d.day),
    date: d.offset === 0 ? md(d.day) : "",
    count: d.items.length,
    today: d.offset === 0,
    late: false,
    rows: rowsOf(d.items)
  }));
  const late = due.backlog.length ? [{
    offset: -1,
    label: "逾期超一周",
    date: "",
    count: due.backlog.length,
    today: false,
    late: true,
    rows: rowsOf(due.backlog)
  }] : [];
  return late.concat(days.filter((p) => p.rows.length));
}

function viewOf(overview, due, empty) {
  return {
    total: overview.total,
    learned: overview.learned,
    mastered: overview.mastered,
    dueToday: overview.dueToday,
    backlog: overview.backlog,
    avgMastery: overview.avgMastery,
    percent: overview.learned ? Math.round((overview.mastered / overview.learned) * 100) : 0,
    farther: due.farther,
    busy: overview.calendar.filter((d) => d.count > 0).length,
    calendar: calendarOf(overview),
    panels: panelsOf(due),
    buckets: bucketsOf(overview.masteryBuckets),
    empty: empty
  };
}

function courseView() {
  const all = corpus.course();
  return viewOf(S.overview(all, SPAN), S.dueList(all, SPAN), "暂无温习记录");
}

function collectionView(c, allPoems, getRecord) {
  const row = S.collectionProgress(c, {
    allPoems: allPoems,
    getRecord: getRecord,
    days: SPAN
  });
  return Object.assign(viewOf(row.overview, row.due, row.count ? "此集合尚未开始温习" : "此集合暂无篇目"), {
    id: row.id,
    name: row.name
  });
}

function deferRowsOf(list) {
  return (list || []).map((lv) => ({
    key: lv.key,
    label: lv.label,
    count: lv.count,
    rows: lv.rows.map((r) => ({
      id: r.id,
      title: r.title,
      meta: r.meta || "",
      due: r.due || ""
    }))
  }));
}

if (typeof Component === "function") {
  Component({
    options: {
      addGlobalClass: true
    },

    properties: {
      view: { type: Object, value: null },

      defers: { type: Array, value: [] },

      ringText: { type: String, value: "" },

      lead: { type: String, value: "" },

      labels: { type: Object, value: LABELS }
    },

    data: {
      cells: [],
      bars: [],
      panels: [],
      groups: [],

      percent: 0,
      busy: 0,
      backlog: 0,
      farther: 0,
      learned: 0,
      mastered: 0,
      total: 0,
      dueToday: 0,
      avgMastery: 0,
      empty: ""
    },

    observers: {
      view(v) {
        const view = v || {};
        this.setData({
          percent: view.percent || 0,
          busy: view.busy || 0,
          backlog: view.backlog || 0,
          farther: view.farther || 0,
          learned: view.learned || 0,
          mastered: view.mastered || 0,
          total: view.total || 0,
          dueToday: view.dueToday || 0,
          avgMastery: view.avgMastery || 0,
          empty: view.empty || "",
          cells: view.calendar || [],
          bars: view.buckets || [],
          panels: view.panels || []
        });
      },

      defers(list) {
        this.setData({ groups: deferRowsOf(list) });
      }
    },

    methods: {
      onOpen(e) {
        this.triggerEvent("open", e.currentTarget.dataset);
      },

      onOpenDefer(e) {
        this.triggerEvent("defer", e.currentTarget.dataset);
      }
    }
  });
}

module.exports = {
  SPAN,
  FLOOR,
  BUCKETS,
  LABELS,
  rowsOf,
  bucketsOf,
  calendarOf,
  panelsOf,
  viewOf,
  courseView,
  collectionView,
  deferRowsOf
};
