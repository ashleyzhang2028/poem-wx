const admin = require("./lib");
const tiers = require("../../../utils/tiers");
const remote = require("../../../utils/remote");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const guard = require("../../../utils/guard");

Page({
  data: {
    themeStyle: "",
    name: "",
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
    dueHolder: "",
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
    const keep = user.tier === tier ? user.untilText : "";
    const date = admin.dateInput(user.untilText);
    this.setData({
      dueOpen: true,
      dueUid: uid,
      dueTier: tier,
      dueTierLabel: tiers.nameOf(tier),
      dueNote: "",
      dueDate: date ? admin.dayText(date) : "",
      dueHolder: !date && keep ? keep : "",
      dueMin: admin.today()
    });
  },

  onDuePick() {
    const min = this.data.dueMin || admin.today();
    const picked = this.data.dueDate && this.data.dueDate >= min ? this.data.dueDate : min;
    wx.showModal({
      title: "选到期日",
      editable: true,
      placeholderText: "YYYY-MM-DD",
      content: picked,
      confirmText: "确定",
      success: (res) => {
        if (!res.confirm) return;
        const day = admin.dayInput(res.content);
        if (!day) {
          this.setData({ dueNote: "日期按 YYYY-MM-DD 填，例如 " + min });
          return;
        }
        this.setData({ dueDate: day, dueHolder: "", dueNote: admin.checkDay(day) });
      }
    });
  },

  onDueForever() {
    if (this.data.busy) return;
    const uid = this.data.dueUid;
    const tier = this.data.dueTier;
    this.closeDue();
    this.applyTier(uid, tier, null);
  },

  onDueStop() {},

  onDueCancel() {
    if (this.data.busy) return;
    this.closeDue();
  },

  onDueConfirm() {
    if (this.data.busy) return;
    const day = this.data.dueDate;
    const note = admin.checkDay(day);
    if (note) {
      this.setData({ dueNote: note });
      return;
    }
    const uid = this.data.dueUid;
    const tier = this.data.dueTier;
    this.closeDue();
    this.applyTier(uid, tier, admin.dayEnd(day));
  },

  closeDue() {
    this.setData({ dueOpen: false, dueNote: "", dueHolder: "" });
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
