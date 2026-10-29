const adminFb = require("../../../../utils/admin-feedback");
const fb = require("../../../../utils/feedback-api");
const admin = require("../../../../utils/admin");
const loginFlow = require("../../../../utils/login-flow");
const theme = require("../../../../utils/theme");
const tabbar = require("../../../../utils/tabbar");
const guard = require("../../../../utils/guard");

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    logged: false,
    canWrite: false,

    tid: "",
    thread: null,
    statuses: fb.STATUSES,
    resolutions: fb.RESOLUTIONS,
    status: "",
    resolution: "",
    replyText: "",
    sending: false,
    reason: ""
  },

  onLogin() {
    loginFlow.run(this);
  },

  onLoad(query) {
    this.setData({ tid: String((query && query.tid) || "") });
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this), logged: admin.loggedIn(), canWrite: admin.canWrite() });
    this.load();
  },

  load() {
    if (!this.data.logged || !this.data.tid) return;
    adminFb.thread(this.data.tid).then((res) => {
      if (!res.ok) {
        this.setData({ reason: res.reason });
        return;
      }
      this.setData({
        thread: res.thread,
        status: res.thread.status,
        resolution: res.thread.resolution,
        reason: ""
      });
    });
  },

  onStatus(e) {
    this.setData({ status: e.detail.value });
  },

  onResolution(e) {
    this.setData({ resolution: e.detail.value });
  },

  onReplyInput(e) {
    this.setData({ replyText: e.detail.value });
  },

  onDeleteThread() {
    this.confirm("删掉这一条？连同下面的沟通记录一起删。", () =>
      guard.once("admin:delete:" + this.data.tid, () => adminFb.remove(this.data.tid, ""))
    );
  },

  onDeleteComment(e) {
    const cid = e.currentTarget.dataset.cid;
    if (!cid) return;
    this.confirm("删掉这一段？", () => guard.once("admin:delete:" + cid, () => adminFb.remove("", cid)));
  },

  confirm(content, run) {
    wx.showModal({
      title: "确认",
      content: content,
      success: (r) => {
        if (!r.confirm) return;
        run().then((res) => {
          if (!res || !res.ok) {
            this.setData({ reason: (res && res.reason) || "没删成，稍后再试" });
            return;
          }
          this.load();
        });
      }
    });
  },

  onSend() {
    if (this.data.sending) return;
    this.setData({ sending: true, reason: "" });
    guard.once("admin:reply:" + this.data.tid, () =>
      adminFb.reply(this.data.tid, this.data.replyText, this.data.status, this.data.resolution)
    ).then((res) => {
      this.setData({ sending: false, reason: res.ok ? "" : res.reason });
      if (!res.ok) return;
      this.setData({ replyText: "" });
      this.load();
    });
  }
});
