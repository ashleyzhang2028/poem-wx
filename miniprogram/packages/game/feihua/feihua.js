const feihua = require("./lib");
const cheer = require("../../../utils/cheer");
const gameScopes = require("../../../utils/game-scopes");
const entitlement = require("../../../utils/entitlement");
const feedback = require("../../../utils/feedback");
const sfx = require("../../../utils/sfx");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const tabPage = require("../../../utils/tab-page");
const rankingSubmit = require("../../../utils/ranking-submit");
const rankingSelf = require("../../../utils/ranking");

const ANSWER_LIMIT = 80;
const ROUND_LIMIT = 90;
const URGENT_FROM = 10;

function clockPatch(left, text) {
  return { left, leftText: text, leftPct: Math.round((left / ROUND_LIMIT) * 100), urgent: left <= URGENT_FROM };
}

Page({
  data: {
    themeStyle: "",
    levels: feihua.LEVELS,
    level: "normal",
    scopes: gameScopes.list(),
    scope: "",

    barBelow: true,
    char: "",
    ask: "",

    done: [],

    streak: 0,
    best: 0,
    cheerLine: "",
    remark: "",

    lastScore: 0,
    ranked: false,
    rankWhere: "",

    input: "",
    message: "",
    messageOk: false,

    locked: false,
    flash: "",
    mark: "",

    hinted: false,

    left: ROUND_LIMIT,
    leftText: "1:30",
    leftPct: 100,
    urgent: false,

    revealed: false,
    answers: [],

    scopeName: "",

    allowed: true,
    reason: ""
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: !!tabbar.pick(this) });
    const ok = entitlement.can("feihualing");
    this.setData({
      allowed: ok,
      reason: ok ? "" : entitlement.hint("feihualing")
    });
    if (!ok || this.ready) return;
    this.ready = true;
    this.next();
  },

  scopeOpt() {
    return { scope: this.data.scope };
  },

  refreshScopeName() {
    this.setData({ scopeName: gameScopes.nameOf(this.data.scopes, this.data.scope) });
  },

  onScope(e) {
    this.setData({ scope: e.detail.value || "" }, () => {
      this.setData({ done: [], streak: 0, best: 0 });
      this.next();
    });
  },

  onLogin() {
    tabPage.mine();
  },

  onLevel(e) {
    this.setData({ level: e.detail.value }, () => {
      this.done = [];
      this.setData({ done: [], streak: 0, best: 0 });
      this.next();
    });
  },

  next() {
    this.refreshScopeName();
    const opt = this.scopeOpt();
    const exclude = this.data.done.map((d) => d.char);
    let p = feihua.pick({ level: this.data.level, scope: opt.scope, exclude: exclude });

    if (!p && exclude.length) {
      p = feihua.pick({ level: this.data.level, scope: opt.scope });
    }
    const char = p ? p.char : "";
    this.setData(
      {
        char: char,
        locked: !char,
        ask: char ? "写一句带「" + char + "」的诗词" : "这一档的令字出完了，换一档难度再来",
        input: "",
        message: "",
        messageOk: false,
        cheerLine: "",
        remark: "",
        flash: "",
        mark: "",
        hinted: false,
        revealed: false,
        answers: []
      },
      () => {
        if (!char) return;
        this.startClock();
      }
    );
  },

  startClock() {
    this.stopClock();
    this.clock = setInterval(() => {
      const left = this.data.left - 1;
      if (left <= 0) {
        this.stopClock();
        this.setData(clockPatch(0, "0:00"));
        this.endRound();
        return;
      }
      this.setData(clockPatch(left, this.format(left)));
      if (left <= URGENT_FROM) sfx.play("tick");
    }, 1000);
  },

  stopClock() {
    if (this.clock) clearInterval(this.clock);
    this.clock = null;
  },

  restartClock() {
    this.setData(clockPatch(ROUND_LIMIT, this.format(ROUND_LIMIT)));
  },

  format(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  },

  endRound() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopClock();
    if (!this.data.done.length) {
      sfx.play("gong");
      this.setData({ locked: true, message: "时间到，一句也没接上", messageOk: false });
      return;
    }
    sfx.pass();
    this.markRound();
    this.report(this.data.done.length);
    this.setData({ locked: true, message: "时间到 · 这一轮 " + this.data.done.length + " 句", messageOk: true });
  },

  onLoad() {
    this.restartClock();
  },

  markRound() {
    const said = this.data.done.length;
    this.setData({ remark: cheer.ofLing(said, said) });
  },

  onRestart() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.setData({
      done: [], streak: 0, best: 0, message: "", remark: "", locked: false,
      ranked: false, lastScore: 0
    }, () => {
      this.restartClock();
      this.next();
    });
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  onSubmit() {
    if (this.data.locked || !this.data.char) return;
    const r = feihua.judge(this.data.char, this.data.input, this.data.done.map((d) => d.seg));
    const streak = r.ok ? this.data.streak + 1 : 0;
    const fb = feedback.mark(this, r.ok, streak);

    if (!r.ok) {
      this.setData({
        message: cheer.ofSay(r.why, this.data.done.length),
        messageOk: false,
        locked: true,
        mark: "✗",
        flash: fb.flash
      });
      this.advance(1400);
      return;
    }

    const row = { char: this.data.char, seg: r.seg, title: r.hit ? r.hit.title : "" };
    const done = this.data.done.concat([row]);
    this.setData({
      done,
      streak,
      best: Math.max(this.data.best, streak),
      cheerLine: cheer.ofStreak(streak),
      message: cheer.ofSay("hit", streak) + (r.hit ? "：" + r.hit.title : ""),
      messageOk: true,
      locked: true,
      mark: "✓",
      flash: fb.flash
    });
    this.advance(900);
  },

  advance(ms) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.next();
    }, ms);
  },

  report(said) {
    rankingSubmit
      .submitPlay("fly", { scopeId: this.data.scope || "", score: said, total: said })
      .then((res) => {
        const sent = !!(res && (res.ok || res.off));
        this.setData({
          ranked: sent && !!res.on,
          lastScore: said,
          rankWhere: rankingSelf.labelOf()
        });
      });
  },

  onUnload() {
    if (this.timer) clearTimeout(this.timer);
    this.stopClock();
    feedback.close(this);
  },

  onReveal() {
    if (this.data.revealed) {
      this.setData({ revealed: false, answers: [] });
      return;
    }
    const opt = this.scopeOpt();
    const answers = feihua.look(this.data.char, Object.assign({ limit: ANSWER_LIMIT }, opt));
    this.setData({ revealed: true, answers });
  },

  onSkip() {
    if (this.timer) clearTimeout(this.timer);
    if (this.data.done.length) {
      this.markRound();
      this.report(this.data.done.length);
    }
    this.next();
  },

  onHint() {
    if (this.data.locked || this.data.hinted) return;
    const opt = this.scopeOpt();
    const h = feihua.hint(
      this.data.char,
      Object.assign({ exclude: this.data.done.map((d) => d.seg) }, opt)
    );
    if (!h) {
      wx.showToast({ title: "这个字在范围内就这几句了", icon: "none" });
      return;
    }
    feedback.buzz("light");
    this.setData({ hinted: true, message: h.head + "…… 共 " + h.total + " 字", messageOk: false });
  },

  onOpen(e) {
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) + "&mode=browse" });
  },

  onShareAppMessage() {
    return { title: "飞花令", path: "/packages/game/feihua/feihua" };
  }
});
