const corpus = require("../../../utils/corpus");
const cols = require("../../../utils/collections");
const store = require("../../../utils/store");
const entitlement = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const defer = require("../../../utils/defer");
const pv = require("../../../components/progress-view/progress-view");

function labelOf(name) {
  return Object.assign({}, pv.LABELS, { title: name });
}

Page({
  data: {
    themeStyle: "",
    barBelow: true,

    logged: false,
    cards: [],
    defers: [],

    sheetRows: [],

    anchor: ""
  },

  onLoad(query) {
    this.focusId = (query && query.coll) || "";
  },

  onShow() {
    this.sheetIds = this.sheetIds || [];
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
    this.refresh();
  },

  refresh() {
    const all = corpus.course();
    const defers = defer.lists();
    const list = entitlement.can("collections") ? cols.usable() : [];
    const cards = list.map((c, i) => {
      const view = pv.collectionView(c, all, store.getRecord);
      return {
        id: c.id,
        name: c.name,
        color: pv.DOTS[i % pv.DOTS.length],
        labels: labelOf(c.name),
        ringText: "已掌握 " + view.mastered + " / 已学 " + view.learned + " · 共 " + view.total + " 首",
        sub: view.total + " 首",
        view: view
      };
    });
    this.setData({
      logged: gate.logged(),
      cards: cards,
      defers: defers,
      sheetRows: this.sheetQueue(cards)
    });
    this.focusSelf(cards);
  },

  focusSelf(cards) {
    if (this.focused) return;
    const id = this.focusId;
    if (!id) return;
    if (!cards.some((c) => c.id === id)) {
      this.focused = true;
      return;
    }
    this.focused = true;
    this.setData({ anchor: "coll-" + id });
  },

  sheetQueue(cards) {
    const ids = this.sheetIds || [];
    const fresh = {};
    cards.forEach((c) => c.view.panels.forEach((p) => p.rows.forEach((r) => { fresh[r.id] = r; })));
    return ids.map((id) => fresh[id]).filter(Boolean);
  },

  onOpen(e) {
    if (!this.requireLogin()) return;
    const ds = e.detail || {};
    const sheet = this.selectComponent("#sheet");
    if (!sheet) return;
    const rows = this.panelRows(ds.day);
    this.sheetIds = rows.map((r) => r.id);
    this.setData({ sheetRows: rows });
    sheet.open(rows, ds.id);
  },

  panelRows(offset) {
    const hit = [];
    (this.data.cards || []).forEach((c) => {
      c.view.panels.forEach((p) => {
        if (String(p.offset) !== String(offset)) return;
        p.rows.forEach((r) => hit.push(r));
      });
    });
    return hit;
  },

  onOpenDefer(e) {
    if (!this.requireLogin()) return;
    const ds = e.detail || {};
    const sheet = this.selectComponent("#sheet");
    if (!sheet) return;
    const held = (this.data.defers || []).filter((lv) => lv.key === ds.key)[0];
    const rows = held ? held.rows : [];
    if (!rows.length) return;
    this.sheetIds = rows.map((r) => r.id);
    this.setData({ sheetRows: rows });
    sheet.open(rows, ds.id);
  },

  onSheetFinish() {
    this.sheetIds = [];
    this.setData({ sheetRows: [] });
    this.refresh();
  },

  onDeferChange() {
    this.sheetIds = [];
    this.setData({ sheetRows: [] });
    this.refresh();
  },

  onLogin() {
    entitlement.block("collections", { page: this, loginPrompt: true });
  },

  onCollections() {
    if (!this.requireLogin()) return;
    if (!entitlement.block("collections", { page: this, loginPrompt: true })) return;
    wx.navigateTo({ url: "/packages/settings/collections/collections" });
  },

  requireLogin() {
    return entitlement.block("daily", { page: this });
  }
});
