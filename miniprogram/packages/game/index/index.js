const gate = require("../../../utils/gate");
const entitlement = require("../../../utils/entitlement");
const theme = require("../../../utils/theme");

const MODES = [
  { key: "feihua", name: "飞花令", desc: "给一个字接句", color: "green" },
  { key: "quiz", name: "题库", desc: "抽题逐题判", color: "amber" },
  { key: "exam", name: "考试", desc: "20 分钟一卷", color: "blue" }
];

const CAP = { feihua: "feihualing", quiz: "quiz", exam: "exam" };

const PAGE = {
  feihua: "/packages/game/feihua/feihua",
  quiz: "/packages/game/quiz/quiz",
  exam: "/packages/game/exam/exam"
};

Page({
  data: {

    locked: true,
    cards: []
  },

  onShow() {
    theme.apply(this);
    if (!gate.logged()) {
      this.setData({ locked: true, cards: [] });
      return;
    }

    const cards = MODES.map((m) => {
      const ok = entitlement.can(CAP[m.key]);
      return Object.assign({}, m, { ok: ok, note: ok ? "" : entitlement.hint(CAP[m.key]) });
    });
    this.setData({ locked: false, cards });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onMode(e) {

    if (!gate.logged()) {
      if (!entitlement.block("feihualing", { page: this })) return;
      return;
    }
    const key = e.currentTarget.dataset.k;
    const cap = CAP[key];
    if (!cap) return;

    if (!entitlement.can(cap)) {
      wx.showToast({ title: entitlement.hint(cap), icon: "none" });
      return;
    }
    wx.navigateTo({ url: PAGE[key] });
  }
});
