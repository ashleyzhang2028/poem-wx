const scoreLog = require("../../../utils/score-log");
const feedback = require("../../../utils/feedback");
const sfx = require("../../../utils/sfx");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");

const MODES = {
  exam: { title: "考试成绩记录", empty: "还没有考试记录", tip: "交卷就留一条，历次成绩都在这页", score: "分" },
  feihua: { title: "飞花令成绩记录", empty: "还没有飞花令记录", tip: "一轮结束就留一条，每轮接上的句数都在这页", score: "句" }
};

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    mode: "exam",
    copy: MODES.exam,
    unit: "分",
    rows: [],
    picked: [],
    picking: false,
    allPicked: false,
    summary: { count: 0, best: null },
    bestPct: 0,
    ranks: []
  },

  onLoad(query) {
    const mode = query && MODES[query.mode] ? query.mode : "exam";
    this.setData({ mode: mode, copy: MODES[mode], unit: MODES[mode].score });
    wx.setNavigationBarTitle({ title: MODES[mode].title });
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: !!tabbar.pick(this) });
    this.load();
  },

  load() {
    const mode = this.data.mode;
    const rows = scoreLog.rows(mode);
    const sum = scoreLog.summary(mode, rows);
    const alive = this.data.picked.filter((id) => rows.some((r) => r.id === id));
    this.setData({
      rows,
      picked: alive,
      picking: alive.length > 0,
      allPicked: rows.length > 0 && alive.length === rows.length,
      summary: sum,
      bestPct: sum.best ? sum.best.pct : 0,
      ranks: feedback.RANKS.slice(0, 3)
    });
  },

  onToggle(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    sfx.play("tap");
    const picked = this.data.picked.indexOf(id) >= 0
      ? this.data.picked.filter((x) => x !== id)
      : this.data.picked.concat([id]);
    this.setData({
      picked,
      picking: picked.length > 0,
      allPicked: this.data.rows.length > 0 && picked.length === this.data.rows.length
    });
  },

  onPickAll() {
    sfx.play("tap");
    const all = this.data.allPicked;
    const picked = all ? [] : this.data.rows.map((r) => r.id);
    this.setData({ picked, picking: picked.length > 0, allPicked: !all });
  },

  onCancel() {
    sfx.play("tap");
    this.setData({ picked: [], picking: false, allPicked: false });
  },

  remove(ids, done) {
    const n = scoreLog.remove(this.data.mode, ids);
    this.load();
    if (!n) return;
    wx.showToast({ title: "已删除 " + n + " 条", icon: "none" });
    if (done) done();
  },

  confirm(title, content, done) {
    wx.showModal({
      title,
      content,
      confirmColor: "#c0392b",
      success: (res) => {
        if (res.confirm) done();
      }
    });
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    const row = this.data.rows.find((r) => r.id === id);
    if (!row) return;
    sfx.play("tap");
    this.confirm("删除这一条？", row.timeText + " · " + row.hitText + " · " + row.rankName, () => {
      this.remove([id]);
    });
  },

  onDeletePicked() {
    const ids = this.data.picked.slice();
    if (!ids.length) return;
    sfx.play("tap");
    this.confirm("删除选中的 " + ids.length + " 条？", "删掉之后不能恢复", () => {
      this.remove(ids, () => this.setData({ picked: [], picking: false, allPicked: false }));
    });
  }
});
