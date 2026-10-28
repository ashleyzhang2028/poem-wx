const store = require("../../../utils/store");
const corpus = require("../../../utils/corpus");
const cols = require("../../../utils/collections");
const S = require("../../../utils/scheduler");
const entitlement = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");
const sync = require("../../../utils/sync");
const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const icons = require("../../../utils/icons");
const guard = require("../../../utils/guard");

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,

    locked: false,
    on: false,
    hint: "",
    cap: 0,
    count: 0,

    collections: [],

    searchId: "",
    keyword: "",
    found: [],
    searched: false,
    suggestMax: 8,

    counts: cols.DAILY_COUNTS,

    icons: { search: icons.search, clear: icons.clear, add: icons.add, added: icons.added },

    nameMax: cols.NAME_MAX,
    itemsMax: cols.ITEMS_MAX
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
  },

  onShow() {
    this.applyFont();
    this.setData({ barBelow: tabbar.below(this) });
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });
    this.refresh();
  },

  refresh() {
    this.keepPicks();
    const list = cols.list();
    const all = corpus.course();
    const closed = this.closedList();
    const rows = list.map((c) => {
      const progress = S.collectionProgress(c, {
        allPoems: all,
        getRecord: store.getRecord,
        count: cols.countOf(c)
      });
      const stat = progress.overview;
      return {
        id: c.id,
        name: cols.nameOf(c),
        count: c.items.length,
        learned: stat.learned,
        due: stat.dueToday + stat.backlog,
        mastered: stat.mastered,
        avgMastery: stat.avgMastery,
        masteredPercent: stat.learned ? Math.round((stat.mastered / stat.learned) * 100) : 0,
        done: progress.doneNow,
        planned: progress.planned,
        dailyCount: cols.countOf(c),
        items: this.itemRows(c.id, (this.kept || {})[c.id]),
        open: closed.indexOf(c.id) < 0
      };
    });
    this.setData({
      on: entitlement.can("collections"),
      tier: entitlement.tierOf("collections"),
      tierLocked: entitlement.reachable(entitlement.tierOf("collections"), entitlement.status().tier),
      cap: cols.capOf(),
      count: list.length,
      collections: rows,
      searchId: list.some((c) => c.id === this.data.searchId) ? this.data.searchId : ""
    });
  },

  closedList() {
    const kept = this.closed || [];
    const ids = cols.list().map((c) => c.id);
    this.closed = kept.filter((id) => ids.indexOf(id) >= 0);
    return this.closed;
  },

  setClosed(list) {
    this.closed = list;
  },

  keepPicks() {
    const kept = {};
    this.data.collections.forEach((c) => {
      const on = c.items.filter((it) => it.picked).map((it) => it.id);
      kept[c.id] = on;
    });
    this.kept = kept;
  },

  pickedIds(id) {
    const row = this.data.collections.filter((c) => c.id === id)[0];
    return row ? row.items.filter((it) => it.picked).map((it) => it.id) : [];
  },

  setItems(id, items) {
    this.setData({
      collections: this.data.collections.map((c) => (c.id === id
        ? Object.assign({}, c, { items: items })
        : c))
    });
  },

  itemRows(id, picked) {
    const c = cols.find(id);
    if (!c) return [];
    const on = {};
    (picked || []).forEach((pid) => { on[pid] = true; });
    return cols.idsOf(c).map((pid, i) => {
      const p = corpus.indexById(pid);
      return {
        id: pid,
        seq: i + 1,
        title: p ? p.t : pid,
        meta: p ? [p.d, p.a, p.n].filter(Boolean).join(" · ") : "这一条不在语料里",
        picked: !!on[pid]
      };
    });
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
    if (!entitlement.block("collections", { page: this, loginPrompt: true })) return;
    if (this.data.count >= this.data.cap) {
      wx.showToast({ title: "集合已达上限（" + this.data.cap + " 个），请先删除一个", icon: "none" });
      return;
    }
    wx.showModal({
      title: "新建集合",
      editable: true,
      placeholderText: cols.DEFAULT_NAME,
      confirmText: "新建",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) return;
        if (!guard.enter("cols:create")) return;
        const r = cols.create(res.content);
        guard.leave("cols:create");
        if (!r.ok) {
          wx.showToast({ title: "最多 " + this.data.cap + " 个集合", icon: "none" });
          return;
        }
        sync.markDirty();
        this.setClosed(this.closedList().filter((x) => x !== r.collection.id));
        this.refresh();
        wx.showToast({ title: "已新建", icon: "none" });
      }
    });
  },

  onProgress(e) {
    const id = (e.currentTarget.dataset || {}).id;
    wx.navigateTo({ url: "/packages/progress/coll/coll?coll=" + encodeURIComponent(id) });
  },

  onToggleList(e) {
    const id = e.currentTarget.dataset.id;
    const closed = this.closedList();
    this.setClosed(closed.indexOf(id) >= 0 ? closed.filter((x) => x !== id) : closed.concat(id));
    this.refresh();
  },

  onRename(e) {
    const id = e.currentTarget.dataset.id;
    const c = cols.find(id);
    if (!c) return;
    wx.showModal({
      title: "重命名集合",
      editable: true,
      placeholderText: cols.nameOf(c),
      confirmText: "重命名",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) return;
        if (!guard.enter("cols:rename:" + id)) return;
        const r = cols.rename(id, res.content);
        guard.leave("cols:rename:" + id);
        if (!r.ok) {
          wx.showToast({ title: r.code === "E_EMPTY_NAME" ? "名称不能为空" : "集合不存在", icon: "none" });
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
      title: "删除集合",
      content: "删除「" + cols.nameOf(c) + "」及其中 " + c.items.length + " 首篇目？背诵进度不受影响。",
      confirmText: "删除",
      cancelText: "取消",
      confirmColor: "#a83b32",
      success: (res) => {
        if (!res.confirm) return;
        if (!guard.enter("cols:remove:" + id)) return;
        cols.remove(id);
        guard.leave("cols:remove:" + id);
        sync.markDirty();
        this.refresh();
        wx.showToast({ title: "已删除", icon: "none" });
      }
    });
  },

  onClear(e) {
    const id = e.currentTarget.dataset.id;
    const c = cols.find(id);
    if (!c || !c.items.length) return;
    wx.showModal({
      title: "清空集合",
      content: "移出「" + cols.nameOf(c) + "」中全部 " + c.items.length + " 首篇目？集合本身将保留。",
      confirmText: "清空",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) return;
        if (!guard.enter("cols:clear:" + id)) return;
        const r = cols.clearItems(id);
        guard.leave("cols:clear:" + id);
        sync.markDirty();
        this.refresh();
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
    if (!guard.enter("cols:add:" + id)) return;
    const pid = e.currentTarget.dataset.id;
    const c = cols.find(id);
    if (!c) {
      guard.leave("cols:add:" + id);
      return;
    }
    const inside = cols.idsOf(c).indexOf(pid) >= 0;
    const r = inside ? cols.removeItems(c.id, [pid]) : cols.add(c.id, [pid]);
    if (!inside && !r.ok) {
      const msg = r.code === "E_FULL"
        ? "「" + cols.nameOf(c) + "」已满 " + cols.ITEMS_MAX + " 首"
        : "添加失败";
      wx.showToast({ title: msg, icon: "none" });
      guard.leave("cols:add:" + id);
      return;
    }
    guard.leave("cols:add:" + id);
    sync.markDirty();
    this.refresh();
    this.suggest(this.data.keyword);
  },

  onPick(e) {
    const id = e.currentTarget.dataset.id;
    const pid = e.currentTarget.dataset.pid;
    const row = this.data.collections.filter((c) => c.id === id)[0];
    if (!row || !pid) return;
    const items = row.items.map((it) => (it.id === pid
      ? Object.assign({}, it, { picked: !it.picked })
      : it));
    this.setItems(id, items);
  },

  onPickAll(e) {
    const id = e.currentTarget.dataset.id;
    this.setItems(id, this.itemRows(id).map((it) => Object.assign({}, it, { picked: true })));
  },

  onPickNone(e) {
    const id = e.currentTarget.dataset.id;
    this.setItems(id, this.itemRows(id));
  },

  onRemovePicked(e) {
    const id = e.currentTarget.dataset.id;
    const ids = this.pickedIds(id);
    const c = cols.find(id);
    if (!c) return;
    if (!ids.length) {
      wx.showToast({ title: "未选择篇目", icon: "none" });
      return;
    }
    wx.showModal({
      title: "移出篇目",
      content: "将所选 " + ids.length + " 首移出「" + cols.nameOf(c) + "」？背诵进度不受影响。",
      confirmText: "移出",
      cancelText: "取消",
      confirmColor: "#a83b32",
      success: (res) => {
        if (!res.confirm) return;
        if (!guard.enter("cols:unpick:" + id)) return;
        cols.removeItems(id, ids);
        guard.leave("cols:unpick:" + id);
        sync.markDirty();
        this.refresh();
        wx.showToast({ title: "已移出 " + ids.length + " 首", icon: "none" });
      }
    });
  },

});
