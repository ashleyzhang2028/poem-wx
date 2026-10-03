const gate = require("../../../utils/gate");
const entitlement = require("../../../utils/entitlement");

/**
 * 古诗词大会 —— 这一屏是**目录**，只列三张入口卡，不在这里出题。
 *
 * 三张卡各进各的玩法页：飞花令、题库、考试。目录页不内嵌任何一个玩法：
 * 上一版把飞花令的「挑一个字 + 看答案」就地摊进这一屏，于是列表页混进了一段
 * 可玩的东西 —— 点一个字就出答案，与「先选玩法再进游戏」是两回事，
 * 也与题库 / 考试两张卡的处理对不上（那两件事都进独立页）。
 */
const MODES = [
  { key: "feihua", name: "飞花令", desc: "给一个字接句", color: "green" },
  { key: "quiz", name: "题库", desc: "抽题逐题判", color: "amber" },
  { key: "exam", name: "考试", desc: "20 分钟一卷", color: "blue" }
];

/** 三张卡各自的能力键：飞花令 / 题库 / 考试 */
const CAP = { feihua: "feihualing", quiz: "quiz", exam: "exam" };

/** 玩法页 */
const PAGE = {
  feihua: "/packages/game/feihua/feihua",
  quiz: "/packages/game/quiz/quiz",
  exam: "/packages/game/exam/exam"
};

Page({
  data: {
    /** 三张卡各自的可用性。不可用的卡照常列出，但标清差在哪一档 */
    locked: true,
    cards: []
  },

  onShow() {
    if (!gate.logged()) {
      this.setData({ locked: true, cards: [] });
      return;
    }
    // 三张卡不是一个门槛：飞花令与考试是 max，题库是 pro。
    // 所以不做「整页锁死」，而是逐卡标注 —— 让人知道要往上走一步，而不是一堵墙。
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
    const key = e.currentTarget.dataset.k;
    if (!gate.logged()) {
      this.onLogin();
      return;
    }
    const cap = CAP[key];
    if (!cap) return;
    // 差一档的卡点了不给进，但要说话 —— 不列一个点下去必然被拒的入口，
    // 也不让用户对着灰卡猜自己差在哪。
    if (!entitlement.can(cap)) {
      wx.showToast({ title: entitlement.hint(cap), icon: "none" });
      return;
    }
    wx.navigateTo({ url: PAGE[key] });
  }
});
