const corpus = require("../../utils/corpus");
const store = require("../../utils/store");

const HOT = ["李白", "杜甫", "苏轼", "春", "月", "登高", "王维"];

Page({
  data: {
    keyword: "",
    scope: "all",
    scopes: [{ key: "all", label: "全站" }, { key: "poems", label: "课内" }],
    results: [],
    hot: HOT,
    searched: false
  },

  onLoad() {
    const kw = store.read(store.KEYS.settings, {}) || {};
    if (kw.lastSearch) this.setData({ keyword: kw.lastSearch });
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onClear() {
    this.setData({ keyword: "", results: [], searched: false });
  },

  onScope(e) {
    const scope = e.currentTarget.dataset.s;
    this.setData({ scope }, () => {
      if (this.data.keyword) this.doSearch();
    });
  },

  onHot(e) {
    this.setData({ keyword: e.currentTarget.dataset.k }, () => this.doSearch());
  },

  doSearch() {
    const kw = this.data.keyword.trim();
    if (!kw) {
      this.setData({ results: [], searched: false });
      return;
    }
    store.saveSettings({ lastSearch: kw });

    const list = corpus.search(kw, {
      book: this.data.scope === "poems" ? "poems" : "",
      limit: 80
    });

    this.setData({
      results: list.map((p) => ({
        id: p.id,
        title: p.t,
        author: p.a,
        dynasty: p.d,
        bookName: p.n,
        group: p.g
      })),
      searched: true
    });
  },

  onOpen(e) {
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
  },

  onShareAppMessage() {
    return { title: "跬步 · 全站搜索", path: "/pages/search/search" };
  }
});
