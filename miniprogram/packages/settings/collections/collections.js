const store = require("../../../utils/store");
const corpus = require("../../../utils/corpus");
const cols = require("../../../utils/collections");
const S = require("../../../utils/scheduler");
const entitlement = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");
const sync = require("../../../utils/sync");
const theme = require("../../../utils/theme");
const tabPage = require("../../../utils/tab-page");

Page({
  data: {
    themeStyle: "",
    themeHex: "",

    locked: false,
    on: false,
    hint: "",
    cap: 0,
    count: 0,

    collections: [],
    openId: "",
    picked: {},
    pickedCount: 0,

    searchId: "",
    keyword: "",
    found: [],
    searched: false,
    suggestMax: 8,

    counts: cols.DAILY_COUNTS,

    nameMax: cols.NAME_MAX,
    itemsMax: cols.ITEMS_MAX
  },

  onShow() {
    theme.apply(this);
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });
    this.refresh();
  },

  refresh() {
    const list = cols.list();
    const all = corpus.course();
    const rows = list.map((c) => {
      const plan = S.collectionPlan(c, {
        count: cols.countOf(c),
        allPoems: all,
        getRecord: store.getRecord
      });
      const ov = S.collectionOverview(all, c);
      return {
        id: c.id,
        name: cols.nameOf(c),
        count: c.items.length,
        learned: ov.learned,
        due: ov.due,
        planned: plan.length,
        dailyCount: cols.countOf(c),
        open: this.data.openId === c.id
      };
    });
    const openId = rows.some((r) => r.open) ? this.data.openId : "";
    this.setData({
      on: entitlement.can("collections"),
      hint: entitlement.can("collections") ? "" : entitlement.hint("collections"),
      cap: cols.capOf(),
      count: list.length,
      collections: rows,
      openId: openId,
      searchId: openId === this.data.searchId ? this.data.searchId : "",
      items: openId ? this.itemRows(openId) : [],
      picked: {},
      pickedCount: 0
    });
  },

  itemRows(id) {
    const c = cols.find(id);
    if (!c) return [];
    const picked = this.data.picked || {};
    return cols.idsOf(c).map((pid, i) => {
      const p = corpus.indexById(pid);
      return {
        id: pid,
        seq: i + 1,
        title: p ? p.t : pid,
        meta: p ? [p.d, p.a, p.n].filter(Boolean).join(" · ") : "这一条不在语料里",
        picked: !!picked[pid]
      };
    });
  },

  onLogin() {
    tabPage.mine();
  },

  onCount(e) {
    const id = e.currentTarget.dataset.id;
    const n = Number(e.detail.value);
    const c = cols.find(id);
    if (!c || n === cols.countOf(c)) return;
    const r = cols.setCount(id, n);
    if (!r.ok) return;
    sync.markDirty();
    this.refresh();
  },

  onCreate() {
    if (!entitlement.block("collections", { page: this })) return;
    if (this.data.count >= this.data.cap) {
      wx.showToast({ title: "最多 " + this.data.cap + " 个集子，先删一个", icon: "none" });
      return;
    }
    wx.showModal({
      title: "新建自选集子",
      editable: true,
      placeholderText: cols.DEFAULT_NAME,
      success: (res) => {
        if (!res.confirm) return;
        const r = cols.create(res.content);
        if (!r.ok) {
          wx.showToast({ title: "最多 " + this.data.cap + " 个集子", icon: "none" });
          return;
        }
        sync.markDirty();
        this.setData({ openId: r.collection.id, picked: {}, pickedCount: 0 }, () => this.refresh());
        wx.showToast({ title: "已新建", icon: "none" });
      }
    });
  },

  onToggleList(e) {
    const id = e.currentTarget.dataset.id;
    const openId = this.data.openId === id ? "" : id;
    this.setData({ openId: openId, picked: {}, pickedCount: 0 }, () => this.refresh());
  },

  onRename(e) {
    const id = e.currentTarget.dataset.id;
    const c = cols.find(id);
    if (!c) return;
    wx.showModal({
      title: "改集子名",
      editable: true,
      placeholderText: cols.nameOf(c),
      success: (res) => {
        if (!res.confirm) return;
        const r = cols.rename(id, res.content);
        if (!r.ok) {
          wx.showToast({ title: r.code === "E_EMPTY_NAME" ? "名字不能为空" : "没找到这个集子", icon: "none" });
          return;
        }
        sync.markDirty();
        this.refresh();
      }
    });
  },

  onRemove(e) {
    const id = e.currentTarget.dataset.id;
    const c = cols.find(id);
    if (!c) return;
    wx.showModal({
      title: "删除集子",
      content: "「" + cols.nameOf(c) + "」连同里面 " + c.items.length + " 首一起删掉？背诵进度一个字都不动。",
      confirmText: "删除",
      confirmColor: "#a83b32",
      success: (res) => {
        if (!res.confirm) return;
        cols.remove(id);
        sync.markDirty();
        this.setData({ openId: this.data.openId === id ? "" : this.data.openId }, () => this.refresh());
        wx.showToast({ title: "已删除", icon: "none" });
      }
    });
  },

  onClear(e) {
    const id = e.currentTarget.dataset.id;
    const c = cols.find(id);
    if (!c || !c.items.length) return;
    wx.showModal({
      title: "清空集子",
      content: "把「" + cols.nameOf(c) + "」里 " + c.items.length + " 首全部移出？集子本身留着。",
      confirmText: "清空",
      cancelText: "算了",
      success: (res) => {
        if (!res.confirm) return;
        const r = cols.clearItems(id);
        sync.markDirty();
        this.setData({ picked: {}, pickedCount: 0 }, () => this.refresh());
        wx.showToast({ title: "已移出 " + r.count + " 首", icon: "none" });
      }
    });
  },

  onAdd(e) {
    const id = e.currentTarget.dataset.id;
    const next = this.data.searchId === id ? "" : id;
    this.setData({ searchId: next, keyword: "", found: [], searched: false });
  },

  onKeyword(e) {
    const kw = e.detail.value;
    this.setData({ keyword: kw }, () => this.suggest(kw));
  },

  onSuggestClear() {
    this.setData({ keyword: "", found: [], searched: false });
  },

  suggest(kw) {
    const keyword = String(kw || "").trim();
    if (!keyword) {
      this.setData({ found: [], searched: false });
      return;
    }
    const inside = {};
    cols.idsOf(cols.find(this.data.searchId)).forEach((pid) => { inside[pid] = true; });
    const r = corpus.search(keyword, { limit: this.data.suggestMax });
    this.setData({
      searched: true,
      found: r.items.map((p) => ({
        id: p.id,
        title: p.t,
        meta: [p.d, p.a, p.n].filter(Boolean).join(" · "),
        on: !!inside[p.id]
      }))
    });
  },

  onAddOne(e) {
    const id = this.data.searchId;
    const pid = e.currentTarget.dataset.id;
    const c = cols.find(id);
    if (!c) return;
    const inside = cols.idsOf(c).indexOf(pid) >= 0;
    const r = inside ? cols.removeItems(c.id, [pid]) : cols.add(c.id, [pid]);
    if (!inside && !r.ok) {
      const msg = r.code === "E_FULL"
        ? "「" + cols.nameOf(c) + "」已满 " + cols.ITEMS_MAX + " 首"
        : "加不进去";
      wx.showToast({ title: msg, icon: "none" });
      return;
    }
    sync.markDirty();
    this.refresh();
    this.suggest(this.data.keyword);
  },

  onPick(e) {
    const picked = {};
    (e.detail.value || []).forEach((pid) => { picked[pid] = true; });
    this.setData({
      picked: picked,
      pickedCount: Object.keys(picked).length,
      items: this.itemRows(this.data.openId)
    });
  },

  onPickAll() {
    const picked = {};
    this.data.items.forEach((it) => { picked[it.id] = true; });
    this.setData({ picked: picked, pickedCount: Object.keys(picked).length, items: this.itemRows(this.data.openId) });
  },

  onPickNone() {
    this.setData({ picked: {}, pickedCount: 0, items: this.itemRows(this.data.openId) });
  },

  onRemovePicked() {
    const ids = Object.keys(this.data.picked || {});
    if (!ids.length) {
      wx.showToast({ title: "还没选中任何一篇", icon: "none" });
      return;
    }
    const r = cols.removeItems(this.data.openId, ids);
    sync.markDirty();
    this.setData({ picked: {}, pickedCount: 0 }, () => this.refresh());
    wx.showToast({ title: r.removed ? "已移出 " + r.removed + " 首" : "这几首已经不在集子里了", icon: "none" });
  },

});
