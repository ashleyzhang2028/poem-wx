const admin = require("../../../utils/admin");
const tiers = require("../../../utils/tiers");
const entitlement = require("../../../utils/entitlement");
const remote = require("../../../utils/remote");
const auth = require("../../../utils/auth");

/**
 * 管理页：给微信登录用户分层设置（free / pro / max，与 poem 口径一致）。
 *
 * ⚠️ 这里必须说清楚一件事：**微信小程序不支持个人主体的虚拟支付**，
 *   付费档不能在小程序内下单。所以 pro / max 只能由管理员发放 ——
 *   兑换码，或后端名录里改档。这个页面做的就是这个。
 *
 * 页面分三块：
 *   本机授权  —— 一定能读能改（改的是自己）
 *   用户名录  —— 服务端就绪时能改；没就绪就说只读，不做假按钮
 *   能力矩阵  —— 当前档位下每条能力开没开
 */
Page({
  data: {
    status: {},
    tiers: tiers.TIERS,
    caps: [],
    stats: {},
    users: [],
    rosterNote: "",
    generatedAt: "",
    remoteReady: false,
    adminReady: false,
    code: "",
    busy: false,
    msg: ""
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const snap = entitlement.snapshot();
    const caps = entitlement.CAP_KEYS.map((k) => Object.assign({ key: k }, snap.caps[k]));

    this.setData({
      status: snap,
      caps,
      stats: admin.stats(),
      remoteReady: remote.configured(),
      adminReady: remote.adminReady(),
      code: auth.configured() ? "" : this.data.code
    });

    admin.list().then((res) => {
      this.setData({
        users: this.decorate(res.users),
        rosterNote: res.rosterNote,
        generatedAt: res.generatedAt
      });
    });
  },

  /**
   * 每一行带上来源与「能不能改」。
   *
   * 这一页原来给每行摆三个档位小标签，点哪个就是改哪个 —— 看着直观，
   * 但后端没就绪时那三个标签也在，点下去只会弹一句「只读」。
   * 现在：能改的给一个原生按钮，不能改的写清是只读。
   */
  decorate(users) {
    const canWrite = remote.adminReady();
    return (users || []).map((u) => {
      let scopeText = "名册";
      if (u.local) scopeText = "本机";
      else if (u.remote) scopeText = "云端";
      return Object.assign({}, u, { scopeText, editable: canWrite || !!u.local });
    });
  },

  onCode(e) {
    this.setData({ code: e.detail.value });
  },

  onRedeem() {
    const res = entitlement.redeem(this.data.code);
    if (!res.ok) {
      this.setData({ msg: res.msg });
      return;
    }
    this.setData({ msg: "已升到「" + tiers.nameOf(res.tier) + "」本机授权", code: "" });
    this.refresh();
  },

  onRevoke() {
    wx.showModal({
      title: "退回免费档",
      content: "本机授权会清掉。背诵进度不受影响 —— 档位只管能力，不管数据。",
      success: (r) => {
        if (!r.confirm) return;
        entitlement.revoke();
        this.refresh();
      }
    });
  },

  onEditTier(e) {
    const userId = e.currentTarget.dataset.u;
    const row = (this.data.users || []).find((u) => u.id === userId);
    if (!row || !row.editable) return;

    wx.showActionSheet({
      itemList: tiers.TIERS.map((t) => t.name + "（" + t.key + "）"),
      success: (res) => {
        const t = tiers.TIERS[res.tapIndex];
        if (!t || t.key === row.tier) return;

        this.setData({ busy: true, msg: "" });
        admin.setTier(userId, t.key, !!row.local).then((r) => {
          this.setData({ busy: false, msg: r.msg });
          this.refresh();
        });
      }
    });
  },

  onSync() {
    const sync = require("../../../utils/sync");
    sync.now(true).then((res) => {
      let msg = "本机数据只在本机，功能不受影响";
      if (res.error) msg = "同步失败：" + res.error;
      else if (!res.skipped) msg = "同步完成，拉回 " + (res.pulled || 0) + " 条，推出 " + (res.pushed || 0) + " 条";
      else if (res.skipped === "offline") msg = "后端或登录未就绪，队列已攒下 " + (res.pending || 0) + " 条";
      this.setData({ msg });
    });
  },

  onCopyFeedback() {
    wx.setClipboardData({
      data: "belem@cnb.cool",
      success: () => wx.showToast({ title: "邮箱已复制，可以申请授权", icon: "none" })
    });
  }
});
