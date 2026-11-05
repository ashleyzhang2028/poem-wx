const ling = require("../../../utils/ling-index");
const gate = require("../../../utils/gate");
const entitlement = require("../../../utils/entitlement");
const sfx = require("../../../utils/sfx");
const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const store = require("../../../utils/store");
const icons = require("../../../utils/icons");
const tabbar = require("../../../utils/tabbar");

const DEFAULT_SCOPE = "stage";

Page({
  data: {
    themeStyle: "",
    locked: true,
    barBelow: true,
    icons: { search: icons.search, clear: icons.clear },
    groups: [],
    scopes: [],
    scope: DEFAULT_SCOPE,
    scopeName: "",
    term: "",
    loading: false,
    searched: false,
    items: [],
    total: 0,
    left: 0,
    more: false,
    hint: ""
  },

  onLoad(query) {
    this.applyFont();
    this.paintGroups([]);
    this.setData({ scopes: ling.scopeTable(), scopeName: this.scopeName(DEFAULT_SCOPE) });
    const term = String((query && query.char) || "").trim();
    if (term) this.setData({ term: term });
  },

  onShow() {
    this.applyFont();
    this.setData({ barBelow: !!tabbar.pick(this) });
    if (!this.allowed()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false, scopeName: this.scopeName(this.data.scope) });
    this.paintGroups();
    if (this.data.term && !this.data.searched) this.run(this.data.term);
  },

  onUnload() {
    this.token = (this.token || 0) + 1;
  },

  allowed() {
    return gate.logged() && entitlement.can("feihualing");
  },

  applyFont() {
    this.setData({ themeStyle: font.bind(theme.style()).page.themeStyle });
  },

  scopeName(id) {
    const hit = ling.scopeTable().filter((s) => s.id === id)[0];
    return hit ? hit.name : "";
  },

  paintGroups() {
    const term = String(this.data.term || "").trim();
    this.setData({
      groups: ling.GROUPS.map((g) => ({
        name: g.name,
        chars: g.chars.map((ch) => ({ ch: ch, on: ch === term }))
      }))
    });
  },

  onLogin() {
    gate.open();
  },

  onPick(e) {
    this.choose(String(e.currentTarget.dataset.ch || ""));
  },

  choose(term) {
    if (!term) return;
    sfx.play("tap");
    this.setData({ term: term });
    this.paintGroups();
    this.run(term);
  },

  onInput(e) {
    this.setData({ term: e.detail.value });
  },

  onConfirm() {
    const term = String(this.data.term || "").trim();
    if (!term) {
      this.onClear();
      return;
    }
    this.paintGroups();
    this.run(term);
  },

  onClear() {
    this.token = (this.token || 0) + 1;
    this.setData({ term: "", searched: false, loading: false, items: [], total: 0, left: 0, more: false, hint: "" });
    this.paintGroups();
  },

  onScope(e) {
    const id = String(e.currentTarget.dataset.id || "");
    if (!id || id === this.data.scope) return;
    sfx.play("tap");
    this.setData({ scope: id, scopeName: this.scopeName(id) });
    if (this.data.searched) this.run(this.data.term);
  },

  run(term) {
    const key = String(term || "").trim();
    if (!key) return;
    this.token = (this.token || 0) + 1;
    const token = this.token;
    this.setData({ searched: true, loading: true });
    ling.load().then(() => {
      if (token !== this.token) return;
      this.paint(key, token);
    });
  },

  paint(key, token) {
    const box = ling.find(key, {
      scope: this.data.scope,
      grade: store.settings().grade
    });
    if (token !== this.token) return;
    this.setData({
      loading: false,
      items: box.items,
      total: box.total,
      left: Math.max(0, box.total - box.items.length),
      more: box.more,
      hint: box.total ? "" : this.missHint(key)
    });
  },

  missHint(key) {
    return ling.counts(key).any
      ? "这一档里没有含「" + key + "」的联句，换个档位或选「不限」"
      : "诗词集子里没有含「" + key + "」的联句";
  },

  onMore() {
    if (!this.data.more) return;
    const token = this.token;
    const box = ling.find(this.data.term, {
      scope: this.data.scope,
      grade: store.settings().grade,
      from: this.data.items.length
    });
    if (token !== this.token) return;
    const items = this.data.items.concat(box.items);
    this.setData({ items: items, total: box.total, left: Math.max(0, box.total - items.length), more: box.more });
  },

  onReachBottom() {
    this.onMore();
  },

  onOpen(e) {
    const ds = e.currentTarget.dataset;
    const id = String(ds.id || "");
    if (!id) return;
    sfx.play("tap");
    const src = ds.remote ? "&src=1" : "";
    wx.navigateTo({
      url: "/pages/reader/reader?id=" + encodeURIComponent(id) + "&mode=browse" + src
    });
  },

  onShareAppMessage() {
    const term = String(this.data.term || "").trim();
    return {
      title: term ? "飞花令 · " + term : "飞花令研习",
      path: "/packages/game/ling/ling" + (term ? "?char=" + encodeURIComponent(term) : "")
    };
  }
});
