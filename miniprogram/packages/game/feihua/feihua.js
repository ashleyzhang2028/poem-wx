const feihua = require("./lib");
const cheer = require("../../../utils/cheer");
const gameScopes = require("../../../utils/game-scopes");
const entitlement = require("../../../utils/entitlement");
const feedback = require("../../../utils/feedback");
const sfx = require("../../../utils/sfx");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const rankingSubmit = require("../../../utils/ranking-submit");
const rankingSelf = require("../../../utils/ranking");
const guard = require("../../../utils/guard");
const scoreLog = require("../../../utils/score-log");

const ANSWER_LIMIT = 80;
const ROUND_LIMIT = 90;
const URGENT_FROM = 10;
const REPORT_MIN = 2;

function clockPatch(left, text) {
  return { left, leftText: text, leftPct: Math.round((left / ROUND_LIMIT) * 100), urgent: left <= URGENT_FROM };
}

Page({
  data: {
    themeStyle: "",
    name: "",
    levels: feihua.LEVELS,
    level: "normal",
    scopes: gameScopes.list(),
    scope: gameScopes.STAGE_SCOPE,

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

    started: false,
    over: false,
    judging: false,
    revealing: false,
    msgHint: false,

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

    log: { count: 0, line: "" }
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: !!tabbar.pick(this) });
    const ok = entitlement.can("feihualing");
    this.setData({ allowed: ok, lockNote: entitlement.hint("feihualing") || "登录后才能玩" });
    this.loadLog();
    if (!ok) return;
    if (!this.ready) {
      this.ready = true;
      this.next();
      return;
    }
    if (this.data.started && !this.ended && !this.clock) this.startClock();
  },

  onHide() {
    this.stopClock();
  },

  guardLeave() {
    const live = this.data.started && !this.ended;
    if (live && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: "这一轮还在计时，现在离开不会记成绩" });
    if (!live && wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
  },

  bump() {
    this.judgeToken = (this.judgeToken || 0) + 1;
    this.revealToken = (this.revealToken || 0) + 1;
  },

  loadLog() {
    const sum = scoreLog.summary("feihua");
    this.setData({
      log: {
        count: sum.count,
        line: sum.count
          ? "共 " + sum.count + " 轮 · 最近 " + sum.last.timeText + " · " + sum.last.hitText
          : "暂无记录"
      }
    });
  },

  onLog() {
    sfx.play("tap");
    wx.navigateTo({ url: "/packages/game/log/log?mode=feihua" });
  },

  keepRound() {
    const hit = this.data.done.length;
    if (!hit || this.kept) return;
    this.kept = true;
    scoreLog.add("feihua", {
      hit: hit,
      scope: this.data.scope || "",
      scopeName: gameScopes.nameOf(this.data.scopes, this.data.scope),
      span: this.roundSec()
    });
    this.loadLog();
  },

  scopeOpt() {
    return { scope: this.data.scope };
  },

  refreshScopeName() {
    this.setData({ scopeName: gameScopes.nameOf(this.data.scopes, this.data.scope) });
  },

  closeOpenRound() {
    if (this.ended || !this.data.done.length) return;
    this.keepRound();
    this.report(this.data.done.length);
  },

  freshRound() {
    this.stopClock();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.bump();
    this.ended = false;
    this.kept = false;
    this.reported = false;
    this.roundAt = Date.now();
    this.setData(Object.assign({
      done: [], streak: 0, best: 0, message: "", msgHint: false, remark: "", cheerLine: "",
      ranked: false, lastScore: 0, over: false, judging: false
    }, clockPatch(ROUND_LIMIT, this.format(ROUND_LIMIT))));
    if (this.data.started) this.startClock();
    this.guardLeave();
  },

  onScope(e) {
    this.setData({ scope: e.detail.value || "" }, () => {
      this.closeOpenRound();
      this.freshRound();
      this.next();
    });
  },

  onLevel(e) {
    this.setData({ level: e.detail.value }, () => {
      this.closeOpenRound();
      this.freshRound();
      this.next();
    });
  },

  onStart() {
    if (this.data.started || !this.data.char) return;
    this.ended = false;
    this.roundAt = Date.now();
    this.setData({ started: true, locked: false });
    this.startClock();
    this.guardLeave();
  },

  next() {
    this.bump();
    this.refreshScopeName();
    const opt = this.scopeOpt();
    const exclude = this.data.char ? [this.data.char] : [];
    let p = feihua.pick({ level: this.data.level, scope: opt.scope, exclude: exclude });

    if (!p && exclude.length) {
      p = feihua.pick({ level: this.data.level, scope: opt.scope });
    }
    const char = p ? p.char : "";
    this.setData(
      {
        char: char,
        locked: !char || !this.data.started,
        ask: char ? "写一句带「" + char + "」的诗词" : "这一档的令字出完了，换一档难度再来",
        input: "",
        message: "",
        messageOk: false,
        msgHint: false,
        judging: false,
        cheerLine: "",
        remark: "",
        flash: "",
        mark: "",
        hinted: false,
        revealed: false,
        revealing: false,
        answers: []
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
        this.endRound("时间到", "时间到，一句也没接上");
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

  endRound(lead, bare) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopClock();
    if (this.ended) return;
    this.ended = true;
    this.bump();
    const said = this.data.done.length;
    if (said) {
      this.markRound();
      this.keepRound();
      this.report(said);
    }
    if (said) sfx.pass();
    else sfx.play("gong");
    this.guardLeave();
    this.setData({
      locked: true, over: true, judging: false, msgHint: false, messageOk: !!said,
      message: said ? lead + " · 这一轮 " + said + " 句" : bare || lead
    });
  },

  onLoad() {
    this.restartClock();
  },

  markRound() {
    const said = this.data.done.length;
    this.setData({ remark: cheer.ofLing(said, said) });
  },

  onRestart() {
    this.freshRound();
    this.next();
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  onSubmit() {
    if (this.data.locked || this.data.judging || !this.data.char || guard.gap("feihua:say")) return;
    guard.mark("feihua:say");
    const said = this.data.done.map((d) => d.seg);
    const opt = this.scopeOpt();
    const token = (this.judgeToken || 0) + 1;
    this.judgeToken = token;
    if (feihua.onSource()) {
      this.setData({ judging: true, msgHint: true, message: "正在核对课外库…", messageOk: false });
    }
    feihua.judgeAsync(this.data.char, this.data.input, said, opt).then((r) => {
      if (token !== this.judgeToken) return;
      this.settle(r);
    }, () => {
      if (token !== this.judgeToken) return;
      this.settle(feihua.judge(this.data.char, this.data.input, said, opt.scope));
    });
  },

  settle(r) {
    if (this.ended) return;
    if (r.degraded) wx.showToast({ title: "课外库没回应，已按课内判定", icon: "none" });
    this.setData({ judging: false, msgHint: false });
    const streak = r.ok ? this.data.streak + 1 : 0;
    const fb = feedback.mark(this, r.ok, streak);

    if (!r.ok) {
      this.setData({ mark: "✗", flash: fb.flash });
      this.endRound(cheer.ofSay(r.why, this.data.done.length));
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
      this.resume();
    }, ms);
  },

  resume() {
    this.bump();
    this.setData({
      locked: false,
      input: "",
      message: "",
      messageOk: false,
      msgHint: false,
      cheerLine: "",
      flash: "",
      mark: "",
      hinted: false,
      revealed: false,
      revealing: false,
      answers: []
    });
  },

  report(said) {
    if (said < REPORT_MIN || this.reported) return;
    this.reported = true;
    guard
      .once("feihua:report", () => rankingSubmit.submitPlay("fly", {
        scopeId: this.data.scope || "",
        score: said,
        total: said,
        durationSec: this.roundSec()
      }))
      .then((res) => {
        if (this.unloaded) return;
        const sent = !!(res && res.ok);
        this.setData({
          ranked: sent && !!res.on,
          lastScore: said,
          rankWhere: rankingSelf.labelOf()
        });
      });
  },

  roundSec() {
    if (!this.roundAt) return 0;
    return Math.max(0, Math.min(ROUND_LIMIT, Math.round((Date.now() - this.roundAt) / 1000)));
  },

  onUnload() {
    if (this.timer) clearTimeout(this.timer);
    this.stopClock();
    this.unloaded = true;
    this.ended = true;
    this.guardLeave();
    this.bump();
    feedback.close(this);
  },

  onReveal() {
    if (this.data.revealed) {
      this.revealToken = (this.revealToken || 0) + 1;
      this.setData({ revealed: false, revealing: false, answers: [] });
      return;
    }
    const opt = this.scopeOpt();
    const asked = this.data.done.map((d) => d.seg);
    const local = () => feihua.look(this.data.char, Object.assign({ limit: ANSWER_LIMIT }, opt, { exclude: asked }));
    if (!feihua.onSource()) {
      this.setData({ revealed: true, answers: local() });
      return;
    }
    const token = (this.revealToken || 0) + 1;
    this.revealToken = token;
    this.setData({ revealed: true, revealing: true, answers: [] });
    feihua.lookAtSource(this.data.char, { limit: ANSWER_LIMIT, exclude: asked }).then((answers) => {
      if (token !== this.revealToken) return;
      this.setData({ revealing: false, answers: answers });
    }, () => {
      if (token !== this.revealToken) return;
      this.setData({ revealing: false, answers: local() });
    });
  },

  onSkip() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopClock();
    if (!this.ended && this.data.done.length) {
      this.markRound();
      this.keepRound();
      this.report(this.data.done.length);
    }
    this.freshRound();
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
      wx.showToast({ title: "该字在范围内仅有这些诗句", icon: "none" });
      return;
    }
    feedback.buzz("light");
    this.setData({ hinted: true, msgHint: true, message: h.head + "…… 共 " + h.total + " 字", messageOk: false });
  },

  onOpen(e) {
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) + "&mode=browse" });
  },

  onShareAppMessage() {
    return { title: "飞花令", path: "/packages/game/feihua/feihua" };
  }
});
