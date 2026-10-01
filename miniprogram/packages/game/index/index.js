const corpus = require("../../../utils/corpus");

/**
 * 古诗词大会：飞花令 + 题库 + 模拟考试。
 * 网页版整套判分内核在 js/quiz.js（不接 AI、不花钱），
 * 小程序端先落地最有辨识度的飞花令与题库入口，题目内核见 utils/quiz.js。
 */
const MODES = [
  { key: "feihua", name: "飞花令", desc: "给一个字，轮流说出含这个字的诗句", color: "green" },
  { key: "quiz", name: "题库", desc: "按范围抽题，逐题给对错", color: "amber" },
  { key: "exam", name: "模拟考试", desc: "限时 20 分钟，交卷后统一批", color: "blue" }
];

Page({
  data: {
    modes: MODES,
    keyword: "月",
    chars: ["月", "春", "花", "风", "山", "水", "云", "夜"],
    lines: [],
    hitCount: 0
  },

  onLoad() {
    this.computeLines();
  },

  computeLines() {
    const kw = this.data.keyword;
    const hits = [];
    const all = corpus.course();

    for (let i = 0; i < all.length && hits.length < 30; i++) {
      const p = all[i];
      const text = corpus.entry(p.id);
      if (!text || !text.text) continue;
      if (text.text.indexOf(kw) < 0) continue;
      String(text.text)
        .split(/[\n，。！？；：、]/)
        .forEach((seg) => {
          if (seg.indexOf(kw) >= 0 && hits.length < 30) {
            hits.push({ id: p.id, title: p.t, author: p.a, seg });
          }
        });
    }

    this.setData({ lines: hits, hitCount: hits.length });
  },

  onChar(e) {
    this.setData({ keyword: e.currentTarget.dataset.c }, () => this.computeLines());
  },

  onMode(e) {
    const key = e.currentTarget.dataset.k;
    if (key === "exam") {
      wx.navigateTo({ url: "/packages/game/exam/exam" });
      return;
    }
    wx.showToast({ title: key === "feihua" ? "在上面挑个字试试" : "题库内核正在接入", icon: "none" });
  },

  onOpen(e) {
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
  }
});
