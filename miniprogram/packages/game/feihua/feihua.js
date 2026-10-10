const feihua = require("../../../utils/feihua/index");
const entitlement = require("../../../utils/entitlement");
const sfx = require("../../../utils/sfx");
const store = require("../../../utils/store");
const S = require("../../../utils/scheduler");
const theme = require("../../../utils/theme");

const ANSWER_LIMIT = 80;

Page({
  data: {
    levels: feihua.LEVELS,
    level: "normal",

    char: "",

    done: [],

    streak: 0,
    best: 0,

    input: "",
    message: "",
    messageOk: false,

    locked: false,

    revealed: false,
    answers: [],

    scopeName: "",

    allowed: true,
    reason: ""
  },

  onShow() {
    theme.apply(this);
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
    const s = store.settings();
    return { scope: s.scope, grade: s.grade, term: s.term };
  },

  refreshScopeName() {
    const s = store.settings();
    const scope = S.scopeOf(s.scope);
    this.setData({
      scopeName: S.gradeName(s.grade) + S.termName(s.term) + " · " + scope.scopeName
    });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
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
    let p = feihua.pick({
      level: this.data.level,
      scope: opt.scope,
      grade: opt.grade,
      term: opt.term,
      exclude: exclude
    });

    if (!p && exclude.length) {
      p = feihua.pick({ level: this.data.level, scope: opt.scope, grade: opt.grade, term: opt.term });
    }
    const char = p ? p.char : "";
    this.setData(
      {
        char: char,
        input: "",
        message: "",
        messageOk: false,
        locked: false,
        revealed: false,
        answers: []
      }
    );
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  onSubmit() {
    if (this.data.locked || !this.data.char) return;
    const r = feihua.judge(this.data.char, this.data.input, this.data.done.map((d) => d.seg));
    sfx.answer(r.ok);
    wx.vibrateShort({ type: r.ok ? "light" : "medium" });

    if (!r.ok) {

      this.setData({ message: r.reason, messageOk: false, locked: true });
      this.advance(1400);
      return;
    }

    const row = { char: this.data.char, seg: r.seg, title: r.hit ? r.hit.title : "" };
    const done = this.data.done.concat([row]);
    const streak = this.data.streak + 1;
    this.setData({
      done,
      streak,
      best: Math.max(this.data.best, streak),
      message: "对上了" + (r.hit ? "：" + r.hit.title : ""),
      messageOk: true,
      locked: true
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

  onUnload() {
    if (this.timer) clearTimeout(this.timer);
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
    this.next();
  },

  onOpen(e) {
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
  },

  onShareAppMessage() {
    return { title: "跬步 · 飞花令", path: "/packages/game/feihua/feihua" };
  }
});
