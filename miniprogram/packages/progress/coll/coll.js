const sheetText = require("../../../utils/sheet-text");
const corpus = require("../../../utils/corpus");
const cols = require("../../../utils/collections");
const store = require("../../../utils/store");
const entitlement = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const defer = require("../../../utils/defer");
const pv = require("../../../components/progress-view/progress-view");

function labelOf(name) {
  return Object.assign({}, pv.LABELS, { title: name });
}

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,

    logged: false,
    cards: [],
    defers: [],

    sheetRows: []
  },

  onLoad(query) {
    this.focusId = (query && query.coll) || "";
  },

  onReady() {
    this.ready = true;
    this.focusSelf();
  },

  onShow() {
    this.applyFont();
    this.sheetIds = this.sheetIds || [];
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
    this.refresh();
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
    font.registerHere().catch(() => {});
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
    this.focusSelf();
  },

  focusSelf() {
    if (this.focused || !this.ready) return;
    const id = this.focusId;
    if (!id) return;
    if (!(this.data.cards || []).some((c) => c.id === id)) return;
    this.focused = true;
    wx.pageScrollTo({ selector: "#coll-" + id, offsetTop: -this.headKeep(), duration: 200 });
  },

  headKeep() {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const rpx = (win.windowWidth || 375) / 750;
    return (win.statusBarHeight || 0) + 44 + 108 * rpx;
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

  onSheetNeed(e) {
    sheetText.fill(this.selectComponent("#sheet"), e.detail.id);
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
