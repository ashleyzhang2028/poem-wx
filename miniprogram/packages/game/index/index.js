const corpus = require("../../../utils/corpus");
const entitlement = require("../../../utils/entitlement");

/**
 * 古诗词大会入口。
 *
 * 网页版的四种玩法里，小程序端做三个：
 *   飞花令（查一查 / 闯关）、题库、模拟考试。
 * 「考试」与「文学常识考试」依赖后端的组卷与判分，还没接，所以不列出来 ——
 * 列一个点不动的入口比没有更糟。
 */
const MODES = [
  { key: "feihua", name: "飞花令", desc: "查一查含令字的句子，或闯关自己写", color: "green", cap: "feihualing" },
  { key: "quiz", name: "题库", desc: "六种题型，答错进复习排期", color: "amber", cap: "quiz.review" },
  { key: "exam", name: "模拟考试", desc: "限时 20 分钟，交卷后统一批", color: "blue", cap: "exam.paper" }
];

Page({
  data: {
    modes: [],
    tierLabel: ""
  },

  onShow() {
    const E = entitlement.identity();
    this.setData({
      tierLabel: E.label,
      modes: MODES.map((m) => {
        const r = E.can(m.cap);
        return Object.assign({}, m, {
          locked: !r.ok,
          hint: r.ok ? "" : E.hint(m.cap)
        });
      })
    });
  },

  onMode(e) {
    const key = e.currentTarget.dataset.k;
    const mode = this.data.modes.find((m) => m.key === key);
    if (!mode) return;

    if (mode.locked) {
      wx.showModal({
        title: mode.name,
        content: mode.hint + "。在「我的 → 管理层级」可以查看当前的权限。",
        showCancel: false,
        confirmText: "知道了"
      });
      return;
    }

    if (key === "exam") {
      wx.navigateTo({ url: "/packages/game/exam/exam" });
      return;
    }
    wx.navigateTo({ url: "/packages/game/" + key + "/" + key });
  },

  onShareAppMessage() {
    return { title: "跬步 · 古诗词大会", path: "/packages/game/index/index" };
  }
});
