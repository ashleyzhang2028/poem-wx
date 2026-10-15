const admin = require("./lib");
const tiers = require("../../../utils/tiers");
const entitlement = require("../../../utils/entitlement");
const remote = require("../../../utils/remote");
const theme = require("../../../utils/theme");
const tabPage = require("../../../utils/tab-page");

Page({
  data: {
    themeStyle: "",
    logged: false,
    status: {},
    heads: [],
    compareGroups: [],
    compareSummary: [],
    stats: { caps: 0, enabled: 0 },

    users: [],
    rosterNote: "",
    generatedAt: "",
    remoteReady: false,
    adminReady: false,
    canWrite: false,
    canSetRole: false,
    busy: false,
    msg: ""
  },

  onShow() {
    theme.apply(this);
    this.refresh();
  },

  refresh() {
    const snap = entitlement.snapshot();

    const canWrite = admin.canWrite();
    const canSetRole = admin.canSetRole();
    this.setData({
      logged: snap.logged,
      status: snap,
      heads: entitlement.compareCols(snap),
      compareGroups: entitlement.compareGroups(snap),
      compareSummary: entitlement.compareSummary(snap),
      stats: admin.stats(),
      remoteReady: remote.configured(),
      adminReady: remote.adminReady(),
      canWrite: canWrite,
      canSetRole: canSetRole
    });

    if (!snap.logged) return;
    admin.list().then((res) => {
      this.setData({
        users: this.decorate(res.users, canWrite, canSetRole),
        rosterNote: res.note || "",
        generatedAt: admin.roster().generatedAt || ""
      });
    });
  },

  decorate(users, canWrite, canSetRole) {
    return (users || []).map((u) =>
      Object.assign({}, u, {

        editable: canWrite || canSetRole ? !!u.remote || !!u.local : false
      })
    );
  },

  onLogin() {
    tabPage.mine();
  },

  onSetTier(e) {
    const userId = e.currentTarget.dataset.u;
    const current = e.currentTarget.dataset.t;

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

    const items = tiers.TIERS.map((t) => ({
      key: t.key,
      text: t.name
    }));
    items.unshift({ key: "", text: "收回（重置为 Free）" });

    wx.showActionSheet({
      itemList: items.map((i) => i.text),
      success: (res) => {
        const pick = items[res.tapIndex];
        if (!pick || pick.key === current) return;

        this.setData({ busy: true, msg: "" });
        const job = pick.key ? admin.setTier(userId, pick.key) : admin.revokeTier(userId);
        job.then((r) => {
          this.setData({ busy: false, msg: r.msg });
          this.refresh();
        });
      }
    });
  },

  onSetRole(e) {
    const userId = e.currentTarget.dataset.u;
    const current = e.currentTarget.dataset.r;

    if (!this.data.canSetRole) {
      wx.showToast({ title: "没有改角色的权限", icon: "none" });
      return;
    }

    const items = [
      { text: "user", key: "user" },
      { text: "admin", key: "admin" }
    ];
    wx.showActionSheet({
      itemList: items.map((i) => i.text),
      success: (res) => {
        const pick = items[res.tapIndex];
        if (!pick || pick.key === current) return;
        this.setData({ busy: true, msg: "" });
        admin.setRole(userId, pick.key).then((r) => {
          this.setData({ busy: false, msg: r.msg });
          this.refresh();
        });
      }
    });
  },
});
