const gate = require("../../../utils/gate");
const entitlement = require("../../../utils/entitlement");
const feedback = require("../../../utils/feedback");
const sfx = require("../../../utils/sfx");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const remote = require("../../../utils/remote");

const MODES = [
  { key: "feihua", glyph: "令", name: "飞花令", desc: "九十秒里，一个令字接到底", best: feedback.KEYS.feihua },
  { key: "quiz", glyph: "题", name: "题库", desc: "十题一组，答完立刻揭晓", best: feedback.KEYS.quiz },
  { key: "exam", glyph: "考", name: "考试", desc: "二十钟一卷，交卷才判", best: feedback.KEYS.exam }
];

const CAP = { feihua: "feihualing", quiz: "quiz", exam: "exam" };

const PAGE = {
  feihua: "/packages/game/feihua/feihua",
  quiz: "/packages/game/quiz/quiz",
  exam: "/packages/game/exam/exam"
};

const RANKING_HINT = { on: "分学段 · 分年级 · 分学期 · 按日周月年", off: "榜单暂未开放", unknown: "点进去看看名次" };

function anyOn(list) {
  return list.some((v) => v && v.on);
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
    heroSub: "",
    rankingState: "unknown",
    rankingSub: RANKING_HINT.unknown
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: !!tabbar.pick(this) });
    sfx.warm();
    if (!gate.logged()) {
      this.setData({ locked: true, cards: [] });
      return;
    }

    const boxes = MODES.map((m) => (entitlement.can(CAP[m.key]) ? feedback.read(m.best) : null));
    const cards = MODES.map((m, i) => {
      const ok = entitlement.can(CAP[m.key]);
      return Object.assign({}, m, {
        ok: ok,
        note: ok ? "" : entitlement.hint(CAP[m.key]),
        bestText: boxes[i] ? boxes[i].rank.name : ""
      });
    });
    const top = topRank(boxes);
    this.setData({
      locked: false,
      cards,
      heroMark: top ? top.rank.name.slice(0, 1) : "会",
      heroTitle: top ? top.rank.name : "",
      heroSub: top ? top.rank.note : "三个擂台，先挑一个上场"
    });
    this.loadRanking();
  },

  loadRanking() {
    Promise.all([
      remote.rankingVisible("exam").catch(() => ({ on: false, offline: true })),
      remote.rankingVisible("fly").catch(() => ({ on: false, offline: true }))
    ]).then((list) => {
      const offline = list.some((v) => v.offline);
      const state = offline ? "unknown" : anyOn(list) ? "on" : "off";
      this.setData({ rankingState: state, rankingSub: RANKING_HINT[state] });
    });
  },

  onRanking() {
    sfx.play("tap");
    if (this.data.rankingState === "off") {
      wx.showToast({ title: "榜单还没开，等管理员打开", icon: "none" });
      return;
    }
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
