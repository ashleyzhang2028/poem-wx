const fb = require("../../../utils/feedback-api");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");
const dots = require("../../../utils/dots");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const guard = require("../../../utils/guard");

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    logged: false,

    kinds: fb.KINDS,
    kind: "bug",
    title: "",
    content: "",
    titleMax: fb.TITLE_MAX,
    contentMax: fb.CONTENT_MAX,

    threads: [],
    offline: false,
    submitting: false,
    reply: {},
    sending: false,
    replyMax: fb.COMMENT_MAX
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
  },

  onShow() {
    this.applyFont();
    if (!this.enter()) return;
    this.setData({ barBelow: tabbar.below(this), logged: true });
    this.load();
  },

  enter() {
    if (gate.logged()) return true;
    gate.open(null, this);
    return false;
  },

  load() {
    fb.mine().then((res) => {
      dots.see("reply", fb.latestReply(res.threads));
      this.setData({ threads: res.threads, offline: res.offline });
    });
  },

  onKind(e) {
    this.setData({ kind: e.detail.value });
  },

  onTitle(e) {
    this.setData({ title: e.detail.value });
  },

  onContent(e) {
    this.setData({ content: e.detail.value });
  },

  onSubmit() {
    if (this.data.submitting) return;
    const checked = fb.validate({ title: this.data.title, content: this.data.content });
    if (!checked.ok) {
      wx.showToast({ title: checked.reason, icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    guard
      .once("feedback:submit", () => fb.submit({ kind: this.data.kind, title: checked.title, content: checked.content }))
      .then((res) => {
        this.setData({ submitting: false });
        if (!res || !res.ok) {
          wx.showToast({ title: (res && res.reason) || "没发出去，稍后再试", icon: "none" });
          return;
        }
        this.setData({ title: "", content: "" });
        wx.showToast({ title: res.duplicate ? "刚刚已经发过" : "已提交", icon: "none" });
        this.load();
      });
  },

  onReplyInput(e) {
    this.setData({ ["reply." + e.currentTarget.dataset.tid]: e.detail.value });
  },

  onReplySend(e) {
    if (this.data.sending) return;
    const tid = e.currentTarget.dataset.tid;
    if (!tid) return;
    this.setData({ sending: true });
    guard.once("feedback:comment:" + tid, () => fb.comment(tid, this.data.reply[tid])).then((res) => {
      this.setData({ sending: false });
      if (!res || !res.ok) {
        wx.showToast({ title: (res && res.reason) || "没发出去，稍后再试", icon: "none" });
        return;
      }
      this.setData({ ["reply." + tid]: "" });
      this.load();
    });
  }
});
