const E = require("../../../utils/entitlement");

/**
 * 权限说明页。
 *
 * 网页版这里是一张游客 / Free / Pro / Max 四列的对照表，
 * 小程序端没有付费分层，所以收成一列：**登录可用**。
 * 未登录时逐条标出「登录后可用」，登录后整列变「可用」——
 * 用户不必猜「我到底少了什么」。
 */
Page({
  data: {
    signedIn: false,
    rows: [],
    lockedCount: 0,
    total: 0
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const signedIn = E.signedIn();
    const rows = E.matrix({ signedIn }).map((r) => ({
      // 门槛列：免登录的那条明说「不需登录」，其余统一「登录可用」
      cap: r.cap,
      name: r.name,
      need: E.cap(r.cap).login ? "登录可用" : "不需登录",
      state: r.hint
    }));
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
