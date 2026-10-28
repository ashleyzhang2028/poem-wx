const adminFb = require("../../../utils/admin-feedback");
const admin = require("../../../utils/admin");
const loginFlow = require("../../../utils/login-flow");
const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const guard = require("../../../utils/guard");

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    logged: false,
    canWrite: false,

    groups: [],
    counts: {},
    reason: ""
  },

  onLogin() {
    loginFlow.run(this);
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
  },

  onShow() {
    this.applyFont();
    this.setData({ barBelow: tabbar.below(this), logged: admin.loggedIn(), canWrite: admin.canWrite() });
    this.load();
  },

  load() {
    if (!this.data.logged) return;
    this.setData({ reason: "" });
    adminFb.list().then((res) => {
      this.setData({
        groups: res.groups,
        counts: res.counts,
        reason: res.ok ? "" : res.reason
      });
    });
  },

  onOpen(e) {
    const tid = e.currentTarget.dataset.tid;
    if (!tid) return;
    wx.navigateTo({ url: "/packages/admin/feedback/detail/detail?tid=" + encodeURIComponent(tid) });
  },

  onDelete(e) {
    const tid = e.currentTarget.dataset.tid;
    if (!tid || !this.data.canWrite) return;
    wx.showModal({
      title: "确认",
      content: "删掉这一条？连同下面的沟通记录一起删。",
      success: (r) => {
        if (!r.confirm) return;
        guard.once("admin:delete:" + tid, () => adminFb.remove(tid, "")).then((res) => {
          if (!res || !res.ok) {
            this.setData({ reason: (res && res.reason) || "没删成，稍后再试" });
            return;
          }
          this.load();
        });
      }
    });
  }
});
