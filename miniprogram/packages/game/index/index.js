const corpus = require("../../../utils/corpus");
const gate = require("../../../utils/gate");
const entitlement = require("../../../utils/entitlement");

/**
 * 古诗词大会：飞花令 + 题库 + 模拟考试。
 * 判分内核在 utils/quiz.js（就地取材，不接 AI、不花钱），考试页复用同一份。
 *
 * 飞花令这一版补齐了「轮」：给一个字，从课内 251 首里挑句，
 * 玩家先说一句再翻答案 —— 网页版是纯浏览，小程序端多做一步「接句」，
 * 才配叫飞花令，否则只是高级搜索。
 */
const MODES = [
  { key: "feihua", name: "飞花令", desc: "给一个字，轮流说出含这个字的诗句", color: "green" },
  { key: "quiz", name: "题库", desc: "按范围抽题，逐题给对错", color: "amber" },
  { key: "exam", name: "模拟考试", desc: "限时 20 分钟，交卷后统一批", color: "blue" }
];

const CHARS = ["月", "春", "花", "风", "山", "水", "云", "夜", "江", "秋", "天", "人"];

Page({
  data: {
    modes: MODES,
    keyword: "月",
    chars: CHARS,
    lines: [],
    hitCount: 0,
    revealed: false,
    page: 1,
    pageSize: 12,
    pagedLines: [],

    /** 三张卡各自的可用性。不可用的卡照常列出，但标清差在哪一档 */
    locked: true,
    cards: []
  },

  onShow() {
    if (!gate.logged()) {
      this.setData({ locked: true, cards: [] });
      return;
    }
    // 三张卡不是一个门槛：飞花令与模拟考试是 max，题库是 pro。
    // 所以不做「整页锁死」，而是逐卡标注 —— 让人知道要往上走一步，而不是一堵墙。
    const cards = MODES.map((m) => {
      const key = m.key === "feihua" ? "feihualing" : m.key === "quiz" ? "quiz" : "exam";
      const ok = entitlement.can(key);
      return Object.assign({}, m, { ok: ok, note: ok ? "" : entitlement.hint(key) });
    });
    this.setData({ locked: false, cards });
    if (cards.some((c) => c.ok)) this.computeLines();
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  computeLines() {
    const kw = this.data.keyword;
    const hits = [];
    const all = corpus.course();

    for (let i = 0; i < all.length && hits.length < 60; i++) {
      const p = all[i];
      const text = corpus.entry(p.id);
      if (!text || !text.text) continue;
      if (text.text.indexOf(kw) < 0) continue;
      String(text.text)
        .split(/[\n，。！？；：、]/)
        .forEach((seg) => {
          const s = seg.trim();
          if (s.indexOf(kw) >= 0 && hits.length < 60) {
            hits.push({ id: p.id, title: p.t, author: p.a, seg: s });
          }
        });
    }

    this.hits = hits;
    this.setData({ lines: hits, hitCount: hits.length, revealed: false, page: 1 }, () => this.page(1));
  },

  page(n) {
    const { pageSize } = this.data;
    const start = (n - 1) * pageSize;
    this.setData({
      page: n,
      pagedLines: (this.hits || []).slice(start, start + pageSize)
    });
  },

  onPrevPage() {
    if (this.data.page > 1) this.page(this.data.page - 1);
  },

  onNextPage() {
    const max = Math.ceil(this.data.hitCount / this.data.pageSize);
    if (this.data.page < max) this.page(this.data.page + 1);
  },

  onChar(e) {
    this.setData({ keyword: e.currentTarget.dataset.c }, () => this.computeLines());
  },

  onReveal() {
    if (!entitlement.can("feihualing")) {
      wx.showToast({ title: entitlement.hint("feihualing"), icon: "none" });
      return;
    }
    this.setData({ revealed: !this.data.revealed });
  },

  onMode(e) {
    const key = e.currentTarget.dataset.key || e.currentTarget.dataset.k;
    if (!gate.logged()) {
      this.onLogin();
      return;
    }
    if (key === "exam" && !entitlement.can("exam")) {
      wx.showToast({ title: entitlement.hint("exam"), icon: "none" });
      return;
    }
    if (key === "quiz" && !entitlement.can("quiz")) {
      wx.showToast({ title: entitlement.hint("quiz"), icon: "none" });
      return;
    }
    if (key === "feihua" && !entitlement.can("feihualing")) {
      wx.showToast({ title: entitlement.hint("feihualing"), icon: "none" });
      return;
    }
    if (key === "exam") {
      wx.navigateTo({ url: "/packages/game/exam/exam" });
      return;
    }
    if (key === "quiz") {
      wx.navigateTo({ url: "/packages/game/quiz/quiz" });
      return;
    }
    if (key === "feihua") {
      // 「查一查」留在本页（就地翻句最快），「闯关」进独立页 ——
      // 闯关要输入、要判句、要记轮次，塞进这个列表页就把它压塌了
      wx.navigateTo({ url: "/packages/game/feihua/feihua?kind=level" });
      return;
    }
    this.setData({ page: 1 }, () => this.page(1));
  },

  onOpen(e) {
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
  }
});
