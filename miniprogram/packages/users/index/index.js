const admin = require("./lib");
const tiers = require("../../../utils/tiers");
const remote = require("../../../utils/remote");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const tabPage = require("../../../utils/tab-page");

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    logged: false,

    users: [],
    remoteReady: false,
    adminReady: false,
    canWrite: false,
    busy: false,
    msg: ""
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
    this.refresh();
  },

  refresh() {
    const logged = admin.loggedIn();
    const canWrite = admin.canWrite();
    this.setData({
      logged: logged,
      remoteReady: remote.configured(),
      adminReady: remote.adminReady(),
      canWrite: canWrite
    });

    if (!logged) return;
    admin.list().then((res) => {
      this.setData({ users: this.decorate(res.users, canWrite) });
    });
  },

  decorate(users, canWrite) {
    return (users || []).map((u, i) =>
      Object.assign({}, u, {
        seq: i + 1,
        editable: canWrite ? !!u.remote || !!u.local : false
      })
    );
  },

  onLogin() {
    tabPage.mine();
  },

  onSetTier(e) {
    const userId = e.currentTarget.dataset.u;

    if (!this.data.canWrite) {
      wx.showModal({
        title: "改不了别人的档位",
        content: this.data.remoteReady
          ? "你的账号没有改档位的权限。"
          : "同步服务器还没接上，名录只读。",
        showCancel: false,
        confirmText: "知道了"
      });
      return;
    }

    const items = tiers.TIERS.map((t) => ({ key: t.key, text: t.name }));
    items.unshift({ key: "", text: "收回（重置为 Free）" });

    wx.showActionSheet({
      itemList: items.map((i) => i.text),
      success: (res) => {
        const pick = items[res.tapIndex];
        if (!pick) return;
        this.setData({ busy: true, msg: "" });
        const job = pick.key ? admin.setTier(userId, pick.key) : admin.revokeTier(userId);
        job.then((r) => {
          this.setData({ busy: false, msg: r.msg });
          this.refresh();
        });
      }
    });
  }
});
