const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const fulltext = require("../../utils/fulltext");

const HOT = ["明月几时有", "李白", "春", "登鹳雀楼", "十年生死两茫茫", "王维", "轻舟已过万重山"];

Page({
  data: {
    keyword: "",
    scope: "all",
    scopes: [{ key: "all", label: "全站" }, { key: "poems", label: "课内" }],
    results: [],
    hot: HOT,
    searched: false,
    searching: false,
    /** 正文索引没拉到时的提示，如实说明这次只搜了索引字段 */
    textSearched: true,
    indexHint: ""
  },

  onLoad() {
    const s = store.read(store.KEYS.settings, {}) || {};
    if (s.lastSearch) this.setData({ keyword: s.lastSearch });
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onClear() {
    this.setData({ keyword: "", results: [], searched: false, indexHint: "" });
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

  /**
   * 检索分两层：
   *   1. 索引字段（篇名 / 作者 / 朝代 / 出处）—— 包内，秒回
   *   2. 正文 —— 要下倒排列文件，第一次会慢一点，之后走本机缓存
   *
   * 两层的结果合并去重，正文命中排在前面（用户搜的是诗句的可能性更大），
   * 并且标明「正文命中」，让他知道为什么这条会出来。
   */
  doSearch() {
    const kw = this.data.keyword.trim();
    if (!kw) {
      this.setData({ results: [], searched: false });
      return;
    }
    store.saveSettings({ lastSearch: kw });
    this.setData({ searching: true });

    const book = this.data.scope === "poems" ? "poems" : "";

    fulltext
      .search(kw, { book, limit: 80 })
      .then((res) => {
        const byField = corpus.search(kw, { book, limit: 80 });
        const seen = {};
        const rows = [];

        // 正文命中优先
        (res.hits || []).forEach((p) => {
          if (seen[p.id]) return;
          seen[p.id] = 1;
          rows.push(this.row(p, true));
        });
        byField.forEach((p) => {
          if (seen[p.id]) return;
          seen[p.id] = 1;
          rows.push(this.row(p, false));
        });

        this.setData({
          results: rows,
          searched: true,
          searching: false,
          textSearched: !!res.fulltext,
          indexHint: res.fulltext ? "" : "正文索引未接入，这次只搜了篇名与作者"
        });
      })
      .catch(() => {
        const byField = corpus.search(kw, { book, limit: 80 });
        this.setData({
          results: byField.map((p) => this.row(p, false)),
          searched: true,
          searching: false,
          textSearched: false,
          indexHint: "正文索引不可用，这次只搜了篇名与作者"
        });
      });
  },

  row(p, inText) {
    return {
      id: p.id,
      title: p.t,
      author: p.a,
      dynasty: p.d,
      bookName: p.n,
      group: p.g,
      inText: !!inText,
      hit: p.hit || ""
    };
  },

  onOpen(e) {
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
  },

  onShareAppMessage() {
    return { title: "跬步 · 全站搜索", path: "/pages/search/search" };
  }
});
