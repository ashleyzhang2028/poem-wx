const cols = require("../../../utils/collections");
const entitlement = require("../../../utils/entitlement");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const defer = require("../../../utils/defer");
const pv = require("../../../components/progress-view/progress-view");

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,

    view: null,
    ringText: "",

    defers: [],

    selfOn: false,
    selfCount: 0,
    selfSub: "",

    sheetRows: []
  },

  onShow() {
    this.sheetIds = this.sheetIds || [];
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
    this.refresh();
  },

  refresh() {
    const view = pv.courseView();
    const list = entitlement.can("collections") ? cols.usable() : [];
    this.setData({
      view: view,
      ringText: "已掌握 " + view.mastered + " / 已学 " + view.learned,
      defers: defer.lists(),
      selfOn: entitlement.can("collections"),
      selfCount: list.length,
      selfSub: list.length ? list.length + " 个集合 · 逐集合摊开" : "还没有自选集合",
      sheetRows: this.sheetQueue(view.panels)
    });
  },

  sheetQueue(panels) {
    const ids = this.sheetIds || [];
    const fresh = {};
    panels.forEach((p) => p.rows.forEach((r) => { fresh[r.id] = r; }));
    return ids.map((id) => fresh[id]).filter(Boolean);
  },

  onOpen(e) {
    if (!this.requireLogin()) return;
    const ds = e.detail || {};
    const sheet = this.selectComponent("#sheet");
    if (!sheet) return;
    const panel = (this.data.view.panels || []).filter((p) => String(p.offset) === String(ds.day))[0];
    const rows = panel ? panel.rows : [];
    this.sheetIds = rows.map((r) => r.id);
    this.setData({ sheetRows: rows });
    sheet.open(rows, ds.id);
  },

  onSheetFinish() {
    this.sheetIds = [];
    this.setData({ sheetRows: [] });
    this.refresh();
  },

  onOpenDefer(e) {
    if (!this.requireLogin()) return;
    const ds = e.detail || {};
    const sheet = this.selectComponent("#sheet");
    if (!sheet) return;
    const held = this.data.defers.filter((lv) => lv.key === ds.key)[0];
    const rows = held ? held.rows : [];
    if (!rows.length) return;
    this.sheetIds = rows.map((r) => r.id);
    this.setData({ sheetRows: rows });
    sheet.open(rows, ds.id);
  },

  onDeferChange() {
    this.sheetIds = [];
    this.setData({ sheetRows: [] });
    this.refresh();
  },

  onSelf() {
    if (!this.requireLogin()) return;
    if (!entitlement.block("collections", { page: this, loginPrompt: true })) return;
    wx.navigateTo({ url: "/packages/progress/coll/coll" });
  },

  requireLogin() {
    return entitlement.block("daily", { page: this });
  }
});
