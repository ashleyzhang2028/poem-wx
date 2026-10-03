const feihua = require("../../../utils/feihua/index");
const entitlement = require("../../../utils/entitlement");
const sfx = require("../../../utils/sfx");
const store = require("../../../utils/store");
const S = require("../../../utils/scheduler");

/**
 * 飞花令。
 *
 * 一屏只做一件事：**出一个字，你写一句带这个字的诗。**
 *   - 令字随机从当前背诵范围里出（不再摊一排字让用户挑）；
 *   - 一个字居中显示，底下是输入框 + 判对错；
 *   - 对错都自动翻下一题（答对、答错各留一句提示，一秒多之后走）；
 *   - 页面下方挂「看答案」：列出范围内该字的所有句子。
 *
 * 作答判定扫**全部课内语料**（utils/feihua 的 judge）—— 范围只管令字、
 * 不管作答。所以「范围选小学」时，令字是小学的诗、答案可以是别的学段的诗。
 */
const ANSWER_LIMIT = 80;

Page({
  data: {
    levels: feihua.LEVELS,
    level: "normal",

    /** 当前令字 */
    char: "",

    /** 这一轮已经答对的说过的句子 */
    done: [],
    /** 连对 / 最好 */
    streak: 0,
    best: 0,

    input: "",
    message: "",
    messageOk: false,
    /** 判过之后短暂锁住输入，等自动翻题 */
    locked: false,

    /** 看答案 */
    revealed: false,
    answers: [],

    /** 范围（取自背诵设置，只读展示） */
    scopeName: "",

    allowed: true,
    reason: ""
  },

  /**
   * ⚠️ can() 返回的是**布尔**，不是 { ok }。
   * 门禁放 onShow：从「去登录」回来时 onLoad 不会再跑。
   */
  onShow() {
    const ok = entitlement.can("feihualing");
    this.setData({
      allowed: ok,
      reason: ok ? "" : entitlement.hint("feihualing")
    });
    if (!ok || this.ready) return;
    this.ready = true;
    this.next();
  },

  /** 从背诵设置里读当前范围 —— 令字就在这个范围里随机出 */
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

  /**
   * 出新题：随机一个令字（范围 + 档位），清空输入与提示。
   * 说过的字不再出 —— prev 传进去 exclude。
   */
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
    // 一轮都说完了（或挑不出）：清掉 exclude 重来
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

  /**
   * 交一句：判对错 —— 对错都自动翻下一题。
   * 判据见 utils/feihua 的 judge（带令字 / 在语料里 / 没说过）。
   */
  onSubmit() {
    if (this.data.locked || !this.data.char) return;
    const r = feihua.judge(this.data.char, this.data.input, this.data.done.map((d) => d.seg));
    sfx.answer(r.ok);
    wx.vibrateShort({ type: r.ok ? "light" : "medium" });

    if (!r.ok) {
      // 答错：亮一句为什么，然后照样翻题（用户要的是「对错都自动下一题」）
      this.setData({ message: r.reason, messageOk: false, locked: true });
      this.advance(1400);
      return;
    }

    // 答对：把这一句收进连对，回显它在哪一篇
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

  /** 等一会儿自动翻下一题。计时器存起来，页面走了要清掉 */
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

  /** 看答案：列出当前范围里含这个字的所有句子 */
  onReveal() {
    if (this.data.revealed) {
      this.setData({ revealed: false, answers: [] });
      return;
    }
    const opt = this.scopeOpt();
    const answers = feihua.look(this.data.char, Object.assign({ limit: ANSWER_LIMIT }, opt));
    this.setData({ revealed: true, answers });
  },

  /** 换一个字（不记连对） */
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
