const E = require("../../../utils/entitlement");
const theme = require("../../../utils/theme");

Page({
  data: {
    signedIn: false,
    rows: [],
    lockedCount: 0,
    total: 0
  },

  onShow() {
    theme.apply(this);
    this.refresh();
  },

  refresh() {
    const signedIn = E.signedIn();
    const rows = E.matrix({ signedIn }).map((r) => {
      const c = E.cap(r.cap);
      return {
        cap: r.cap,
        name: r.name,

        need: c.login ? "登录可用" : "不需登录",

        state: r.hint || "可用"
      };
    });
    this.setData({
      signedIn,
      rows,
      lockedCount: rows.filter((r) => r.state !== "可用").length,
      total: rows.length
    });
  },

  onLogin() {
    if (this.data.signedIn) return;
    wx.switchTab({ url: "/pages/mine/mine" });
  },

  onShareAppMessage() {
    return { title: "跬步 · 权限说明", path: "/packages/settings/plans/plans" };
  }
});
