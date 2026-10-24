const gate = require("../../../utils/gate");
const entitlement = require("../../../utils/entitlement");
const scoreLog = require("../../../utils/score-log");
const sfx = require("../../../utils/sfx");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");

const MODES = [
  { key: "feihua", glyph: "令", name: "飞花令", desc: "九十秒里，一个令字接到底", log: "feihua", tier: "max" },
  { key: "quiz", glyph: "题", name: "题库", desc: "十题一组，答完立刻揭晓", tier: "pro" },
  { key: "exam", glyph: "考", name: "考试", desc: "二十钟一卷，交卷才判", log: "exam", tier: "max" }
];

const CAP = { feihua: "feihualing", quiz: "quiz", exam: "exam" };

const PAGE = {
  feihua: "/packages/game/feihua/feihua",
  quiz: "/packages/game/quiz/quiz",
  exam: "/packages/game/exam/exam"
};

function lastTextOf(box) {
  if (!box || !box.rank || !box.rank.name) return "";
  return box.rank.name;
}

function topRank(boxes) {
  return boxes.reduce((top, box) => (box && (!top || box.rank.rank > top.rank.rank) ? box : top), null);
}

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    locked: true,
    cards: [],
    heroMark: "会",
    heroTitle: "",
    heroSub: ""
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: !!tabbar.pick(this) });
    sfx.warm();
    if (!gate.logged()) {
      this.setData({ locked: true, cards: [] });
      return;
    }

    const boxes = MODES.map((m) => (m.log && entitlement.can(CAP[m.key]) ? scoreLog.latest(m.log) : null));
    const cards = MODES.map((m, i) => Object.assign({}, m, {
      ok: entitlement.can(CAP[m.key]),
      lastText: lastTextOf(boxes[i])
    }));
    const top = topRank(boxes);
    this.setData({
      locked: false,
      cards,
      heroMark: top ? top.rank.name.slice(0, 1) : "会",
      heroTitle: top ? top.rank.name : "",
      heroSub: top ? top.rank.note : "三个擂台，先挑一个上场"
    });
  },

  onRanking() {
    sfx.play("tap");
    wx.navigateTo({ url: "/packages/ranking/index/index" });
  },


  onMode(e) {
    if (!gate.logged()) {
      entitlement.block("feihualing", { page: this });
      return;
    }
    const key = e.currentTarget.dataset.k;
    const cap = CAP[key];
    if (!cap) return;

    if (!entitlement.can(cap)) {
      wx.showToast({ title: entitlement.hint(cap), icon: "none" });
      return;
    }
    sfx.play("tap");
    wx.navigateTo({ url: PAGE[key] });
  }
});
