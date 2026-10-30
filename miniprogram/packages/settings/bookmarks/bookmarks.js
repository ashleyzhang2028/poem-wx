const marks = require("../../../utils/bookmarks");
const entitlement = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");
const sync = require("../../../utils/sync");
const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const icons = require("../../../utils/icons");

const PAGE_SIZE = 20;

function metaOf(b) {
  return b.a || b.n;
}

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    locked: false,
    on: false,
    tier: "pro",
    tierLocked: false,
    cap: 0,
    count: 0,
    editing: false,
    picked: 0,
    matched: 0,
    keyword: "",
    page: 1,
    pages: 1,
    rows: [],
    icons: { search: icons.search, clear: icons.clear }
  },

  pickedIds: {},

  matchedList() {
    const kw = this.data.keyword.trim().toLowerCase();
    const all = marks.list();
    if (!kw) return all;
    return all.filter((b) => [b.t, b.a, b.n].join(" ").toLowerCase().indexOf(kw) >= 0);
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
    const every = marks.list();
    const have = {};
    every.forEach((b) => { have[b.id] = true; });
    Object.keys(this.pickedIds).forEach((id) => { if (!have[id]) delete this.pickedIds[id]; });

    const hit = this.matchedList();
    const pages = Math.max(1, Math.ceil(hit.length / PAGE_SIZE));
    const page = Math.min(this.data.page, pages);
    const rows = hit.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((b) => ({
      id: b.id,
      title: b.t,
      meta: metaOf(b),
      picked: !!this.pickedIds[b.id]
    }));
    const tier = entitlement.tierOf("bookmarks");
    this.setData({
      on: entitlement.can("bookmarks"),
      tier: tier,
      tierLocked: entitlement.reachable(tier, entitlement.status().tier),
      cap: marks.capOf(),
      count: every.length,
      matched: hit.length,
      page: page,
      pages: pages,
      rows: rows,
      picked: Object.keys(this.pickedIds).length,
      editing: every.length ? this.data.editing : false
    });
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value || "", page: 1 });
    this.refresh();
  },

  onKeywordClear() {
    this.setData({ keyword: "", page: 1 });
    this.refresh();
  },

  onPrev() {
    if (this.data.page <= 1) return;
    this.setData({ page: this.data.page - 1 });
    this.refresh();
  },

  onNext() {
    if (this.data.page >= this.data.pages) return;
    this.setData({ page: this.data.page + 1 });
    this.refresh();
  },

  onEdit() {
    this.setData({ editing: !this.data.editing });
    if (!this.data.editing) this.pickedIds = {};
    this.refresh();
  },

  onPickAll() {
    const hit = this.matchedList();
    const all = hit.every((b) => this.pickedIds[b.id]);
    hit.forEach((b) => {
      if (all) delete this.pickedIds[b.id];
      else this.pickedIds[b.id] = true;
    });
    this.refresh();
  },

  onRow(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.editing) {
      const hit = marks.list().filter((b) => b.id === id)[0];
      if (hit) wx.navigateTo({ url: marks.readerUrl(hit) });
      return;
    }
    if (this.pickedIds[id]) delete this.pickedIds[id];
    else this.pickedIds[id] = true;
    this.refresh();
  },

  onRename(e) {
    const id = e.currentTarget.dataset.id;
    const row = this.data.rows.filter((r) => r.id === id)[0];
    if (!row) return;
    wx.showModal({
      title: "修改书签名",
      editable: true,
      placeholderText: row.title,
      confirmText: "保存",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) return;
        if (!marks.retitle(id, res.content)) {
          wx.showToast({ title: "名称不能为空", icon: "none" });
          return;
        }
        sync.markDirty();
        this.refresh();
      }
    });
  },

  onDeletePicked() {
    const ids = Object.keys(this.pickedIds);
    if (!ids.length) return;
    wx.showModal({
      title: "删除书签",
      content: "删除选中的 " + ids.length + " 个书签？",
      confirmText: "删除",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) return;
        const n = marks.remove(ids);
        this.pickedIds = {};
        sync.markDirty();
        this.refresh();
        wx.showToast({ title: "已删除 " + n + " 个", icon: "none" });
      }
    });
  },

  onTierGate() {
    entitlement.gateTier("bookmarks", { page: this });
  }
});
