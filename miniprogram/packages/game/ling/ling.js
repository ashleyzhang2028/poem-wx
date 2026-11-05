const ling = require("../utils/ling-index");
const lingPool = require("../utils/ling-pool");
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
    more: false,
    loadingMore: false,
    pulling: false,
    remoteDone: false,
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
    this.setData({
      term: "", searched: false, loading: false, items: [],
      more: false, loadingMore: false, pulling: false, remoteDone: false, hint: ""
    });
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
    lingPool.forget();
    this.setData({
      searched: true, loading: true, items: [],
      more: false, loadingMore: false, pulling: false, remoteDone: false, hint: ""
    });
    ling.load().then(() => {
      if (this.stale(token)) return;
      const box = this.local(key, 0, ling.PAGE);
      if (this.stale(token)) return;
      this.setData({
        loading: false,
        items: box.items,
        more: box.more,
        hint: box.total ? "" : this.missHint()
      });
      if (box.items.length >= ling.PAGE) return;
      this.pull(token, ling.PAGE - box.items.length);
    });
  },

  stale(token) {
    return token !== this.token;
  },

  local(key, from, size) {
    return ling.find(key, {
      scope: this.data.scope,
      grade: store.settings().grade,
      from: from || 0,
      size: size || ling.PAGE
    });
  },

  pull(token, want) {
    if (this.data.pulling || this.data.remoteDone) return;
    const key = String(this.data.term || "").trim();
    if (!key) return;
    if (!lingPool.usable(this.data.scope)) {
      this.setData({ pulling: false, remoteDone: true });
      return;
    }
    this.setData({ pulling: true });
    lingPool.next(key, this.data.scope, want || ling.PAGE).then((page) => {
      if (this.stale(token)) return;
      this.merge(page);
    });
  },

  merge(page) {
    const seen = {};
    this.data.items.forEach((row) => { seen[lingPool.clean(row.seg)] = 1; });
    const fresh = page.items.filter((row) => !seen[lingPool.clean(row.seg)]);
    const items = this.data.items.concat(fresh);
    this.setData({
      items: items,
      pulling: false,
      remoteDone: !page.more,
      hint: items.length ? "" : this.missHint()
    });
    if (!items.length) return;
    if (fresh.length >= ling.PAGE || !page.more) return;
    this.pull(this.token, ling.PAGE - fresh.length);
  },

  missHint() {
    if (!lingPool.usable(this.data.scope)) return "这一档里没有含「" + this.data.term + "」的联句，换个档位或选「不限」";
    if (!this.data.remoteDone) return "";
    return "诗词漫读里也没找到含「" + this.data.term + "」的联句，换个令字试试";
  },

  onMore() {
    const key = String(this.data.term || "").trim();
    if (!key || this.data.loading || this.data.loadingMore || this.data.pulling) return;
    if (!this.data.more && this.data.remoteDone) return;
    const token = this.token;
    if (this.data.more) {
      const box = this.local(key, this.data.items.length, ling.PAGE);
      const items = this.data.items.concat(box.items);
      this.setData({ items: items, more: box.more, loadingMore: false });
      if (box.more || this.data.remoteDone) return;
    }
    this.pull(token, ling.PAGE);
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
