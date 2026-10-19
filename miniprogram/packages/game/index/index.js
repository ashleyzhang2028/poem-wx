const gate = require("../../../utils/gate");
const entitlement = require("../../../utils/entitlement");
const feedback = require("../../../utils/feedback");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const tabPage = require("../../../utils/tab-page");

const MODES = [
  { key: "feihua", name: "飞花令", desc: "九十秒里，一个令字接到底", best: feedback.KEYS.feihua },
  { key: "quiz", name: "题库", desc: "十题一组，答完立刻揭晓", best: feedback.KEYS.quiz },
  { key: "exam", name: "考试", desc: "二十钟一卷，交卷才判", best: feedback.KEYS.exam }
];

const CAP = { feihua: "feihualing", quiz: "quiz", exam: "exam" };

const PAGE = {
  feihua: "/packages/game/feihua/feihua",
  quiz: "/packages/game/quiz/quiz",
  exam: "/packages/game/exam/exam"
};

Page({
  data: {

    themeStyle: "",
    barBelow: true,
    locked: true,
    cards: []
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: !!tabbar.pick(this) });
    if (!gate.logged()) {
      this.setData({ locked: true, cards: [] });
      return;
    }

    const cards = MODES.map((m) => {
      const ok = entitlement.can(CAP[m.key]);
      const best = ok ? feedback.read(m.best) : null;
      return Object.assign({}, m, {
        ok: ok,
        note: ok ? "" : entitlement.hint(CAP[m.key]),
        bestText: best ? best.rank.name : ""
      });
    });
    this.setData({ locked: false, cards });
  },

  onLogin() {
    tabPage.mine();
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
