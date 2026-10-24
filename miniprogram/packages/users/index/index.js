const admin = require("./lib");
const tiers = require("../../../utils/tiers");
const remote = require("../../../utils/remote");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const guard = require("../../../utils/guard");

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
    msg: "",

    dueOpen: false,
    dueUid: "",
    dueTier: "",
    dueTierLabel: "",
    dueNote: "",
    dueDate: "",
    dueMin: ""
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
    guard.once("users:list", () => admin.list()).then((res) => {
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


  onSetTier(e) {
    const userId = e.currentTarget.dataset.u;
    if (this.data.busy) return;

    if (!this.data.canWrite) {
      wx.showModal({
        title: "无权修改",
        content: this.data.remoteReady
          ? "您的账号无修改档位的权限。"
          : "同步服务未连接，名录仅可查看。",
        showCancel: false,
        confirmText: "知悉"
      });
      return;
    }

    const items = tiers.TIERS.map((t) => ({ key: t.key, text: t.name }));
    items.unshift({ key: "", text: "重置为 Free" });

    wx.showActionSheet({
      itemList: items.map((i) => i.text),
      success: (res) => {
        const pick = items[res.tapIndex];
        if (!pick) return;
        if (!pick.key) {
          this.applyTier(userId, "", null);
          return;
        }
        const user = this.data.users.filter((u) => u.id === userId)[0] || {};
        this.openDue(userId, pick.key, user);
      }
    });
  },

  openDue(uid, tier, user) {
    const today = admin.today();
    this.setData({
      dueOpen: true,
      dueUid: uid,
      dueTier: tier,
      dueTierLabel: tiers.nameOf(tier),
      dueNote: "",
      dueDate: user.tier === tier ? user.untilText || "" : "",
      dueMin: today
    });
  },

  onDueChange(e) {
    this.setData({ dueDate: String((e.detail && e.detail.value) || "") });
  },

  onDueForever() {
    this.closeDue();
    this.applyTier(this.data.dueUid, this.data.dueTier, null);
  },

  onDueStop() {},

  onDueCancel() {
    this.closeDue();
  },

  onDueConfirm() {
    if (this.data.busy) return;
    const until = admin.dayEnd(this.data.dueDate);
    if (!until) {
      this.setData({ dueNote: "先选到期日，或选「不设到期」" });
      return;
    }
    const uid = this.data.dueUid;
    const tier = this.data.dueTier;
    this.closeDue();
    this.applyTier(uid, tier, until);
  },

  closeDue() {
    this.setData({ dueOpen: false, dueNote: "" });
  },

  applyTier(userId, tier, until) {
    this.setData({ busy: true, msg: "" });
    const job = tier ? admin.setTier(userId, tier, until) : admin.revokeTier(userId);
    guard.once("users:tier:" + userId, () => job).then((r) => {
      this.setData({ busy: false, msg: r.msg });
      this.refresh();
    });
  }
});
