const feihua = require("../../../utils/feihua/index");
const entitlement = require("../../../utils/entitlement");
const store = require("../../../utils/store");

Page({
  data: {
    kind: "look",
    kinds: [{ key: "look", label: "查一查" }, { key: "level", label: "闯关" }],

    levels: feihua.LEVELS,
    level: "normal",
    chars: [],
    char: "",

    /** 查一查：命中句列表 */
    lines: [],
    hitCount: 0,

    /** 闯关 */
    said: [],
    input: "",
    round: 0,
    message: "",
    messageOk: false,
    finished: false,

    /** 权限 */
    allowed: true,
    reason: ""
  },

  onLoad(query) {
    const g = entitlement.can("feihualing");
    this.setData({
      allowed: g.ok,
      reason: g.ok ? "" : entitlement.hint("feihualing")
    });
    if (!g.ok) return;

    const kind = query.kind === "level" ? "level" : "look";
    this.setData({ kind }, () => this.refreshChars());
  },

  onKind(e) {
    const kind = e.detail.value;
    this.setData({ kind }, () => this.refreshChars());
  },

  onLevel(e) {
    const level = e.detail.value;
    this.setData({ level }, () => this.refreshChars());
  },

  refreshChars() {
    const list = feihua.chars(this.data.level, 24);
    this.setData({
      chars: list,
      char: "",
      lines: [],
      hitCount: 0,
      said: [],
      round: 0,
      finished: false,
      message: "",
      input: ""
    });
  },

  onChar(e) {
    const char = e.detail.value;
    this.setData({ char, round: this.data.round + 1, said: [], finished: false, message: "" });
    if (this.data.kind === "look") {
      const lines = feihua.look(char, { limit: 80 });
      this.setData({ lines, hitCount: lines.length });
    }
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  /**
   * 闯关判定：写一句带令字的诗。
   * 三条件缺一不可 —— 有令字、在语料里、没说过。判据见 utils/feihua.js。
   */
  onSubmit() {
    const r = feihua.judge(this.data.char, this.data.input, this.data.said);
    if (!r.ok) {
      this.setData({ message: r.reason, messageOk: false });
      return;
    }
    const said = this.data.said.concat([r.seg]);
    this.setData({
      said,
      input: "",
      message: "对上了：" + r.hit.title + " · " + r.hit.author,
      messageOk: true
    });
    wx.vibrateShort({ type: "light" });
  },

  onGiveUp() {
    this.setData({ finished: true, message: "这一关过了 " + this.data.said.length + " 句" });
  },

  onNextChar() {
    const rest = this.data.chars.filter((c) => c.char !== this.data.char);
    if (!rest.length) {
      this.refreshChars();
      return;
    }
    const next = rest[Math.floor(Math.random() * rest.length)];
    // 直接调 onChar 的取值路径：它现在只认 e.detail.value，所以这里也照那个形状给
    this.onChar({ detail: { value: next.char } });
  },

  onOpen(e) {
    wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
  },

  onShareAppMessage() {
    return { title: "跬步 · 飞花令", path: "/packages/game/feihua/feihua" };
  }
});
