const fb = require("../../../utils/feedback-api");
const gate = require("../../../utils/gate");
const loginFlow = require("../../../utils/login-flow");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");

Page({
  data: {
    themeStyle: "",
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
    sending: false
  },

  onLogin() {
    loginFlow.run(this);
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this), logged: gate.logged() });
    this.load();
  },

  load() {
    if (!this.data.logged) return;
    fb.mine().then((res) => {
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
    fb.submit({ kind: this.data.kind, title: checked.title, content: checked.content }).then((res) => {
      this.setData({ submitting: false });
      if (!res.ok) {
        wx.showToast({ title: res.reason, icon: "none" });
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
    fb.comment(tid, this.data.reply[tid]).then((res) => {
      this.setData({ sending: false });
      if (!res.ok) {
        wx.showToast({ title: res.reason, icon: "none" });
        return;
      }
      this.setData({ ["reply." + tid]: "" });
      this.load();
    });
  }
});
