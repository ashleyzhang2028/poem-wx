const E = require("../../../utils/entitlement");
const theme = require("../../../utils/theme");

/**
 * 权限说明页。
 *
 * 这一页回答「我到底少了什么」：逐条列能力，未登录时都标「登录后可用」，
 * 登录后整列变「可用」。表只有一个来源 —— entries 里的 ORDER 与
 * entitlement 的 CAPS 是同一份，页面不另抄一张。
 *
 * 收费档位（Free / Pro / Max）不在这张表里出现：网页版那一套是给
 * 「按账号卖额度」用的，小程序端的进度只存在本机，没有可以收钱的对手方。
 * 有分层的档位由「我的 → 用户与权限」那一页管，不是这一页。
 */
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
        // 门槛列：免登录的那条明说「不需登录」，其余统一「登录可用」
        need: c.login ? "登录可用" : "不需登录",
        // hint 为空 = 当前能用；界面上要写出来，所以给它两个字
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
