const admin = require("../../../utils/admin");
const tiers = require("../../../utils/tiers");
const entitlement = require("../../../utils/entitlement");
const remote = require("../../../utils/remote");
const auth = require("../../../utils/auth");
const store = require("../../../utils/store");
const sync = require("../../../utils/sync");

/**
 * 管理层级。
 *
 * 分两层，界面上先说清是哪个：
 *
 *   1. **本机层级**（谁都能开）—— 看当前档位、逐条能力开没开、改档位验权限分支。
 *      默认 Max：本机数据只属于本机，不登录不该被卡功能。
 *
 *   2. **云端层级**（登录 + 后端就绪）—— 名录里的档位由服务端按 uid 下发。
 *      后端没配时这块**明确说不可用**，不给点了没反应的假按钮。
 *
 * 与网页版 `admin/accounts.html` 的差别：那边是完整后台（分页、搜索、批量、
 * 用户报告、注音勘误）。小程序端只做「给自己 / 家人调档位」——
 * 在手机上做名录管理本来就不是合适场景，真要管理还是去网页版。
 *
 * ⚠️ 客户端档位不是安全边界。这里能改的是「界面给谁看」，
 *   改本机存储就能提档，真正扣配额必须在服务端做。
 */
Page({
  data: {
    tier: "max",
    tiers: tiers.TIERS,
    source: "",
    logged: false,
    blocked: "",

    /** 当前档位下，每条能力开 / 关。分组展示，与网页版同一张表 */
    caps: [],
    stats: { caps: 0, enabled: 0 },

    /** 云端 */
    remoteReady: false,
    adminReady: false,
    users: [],
    rosterNote: "",
    generatedAt: "",
    busy: false,

    syncText: "",
    syncPending: 0
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const snap = entitlement.snapshot();
    const sy = sync.state();
    const profile = store.profile();

    this.setData({
      tier: snap.tier,
      source: snap.label,
      blocked: snap.blocked,
      logged: entitlement.loggedIn(),
      caps: this.groupCaps(snap),
      stats: admin.stats(),
      remoteReady: remote.configured(),
      adminReady: remote.adminReady(),
      syncText: sy.lastText,
      syncPending: sy.pending
    });

    void profile;

    admin.list().then((res) => {
      this.setData({
        users: res.users,
        rosterNote: res.rosterNote,
        generatedAt: res.generatedAt
      });
    });
  },

  /**
   * 能力分组。与 entitlements.CAPS 同表 —— 分组只是排版，
   * 判据一律走 snapshot().caps[key].ok，界面不自己算。
   */
  groupCaps(snap) {
    const GROUPS = [
      { title: "免费可用", keys: ["daily", "library", "ebbinghaus", "progress", "search"] },
      { title: "登录后可用", keys: ["export", "leitner", "speak"] },
      { title: "Pro 起", keys: ["sm2", "collections", "quiz", "admin"] },
      { title: "Max 起", keys: ["fsrs", "feihualing", "exam"] }
    ];
    return GROUPS.map((g) => ({
      title: g.title,
      rows: g.keys
        .map((k) => {
          const c = snap.caps[k];
          return c ? { name: c.name, desc: c.desc, on: c.ok, note: c.ok ? "" : entitlement.hint(k) } : null;
        })
        .filter(Boolean)
    }));
  },

  /**
   * 改本机档位。
   *
   * 只是本机的一个标记：本机数据不分档位，改它是为了验权限分支、
   * 或者提前看看 Pro / Max 长什么样。真授权要服务端下发。
   */
  onTier(e) {
    const tier = e.currentTarget.dataset.t;
    if (!tiers.isTier(tier)) return;

    // 本机档位就落在提权记录里，与兑换码同一处 —— 这样 status() 只认一个来源
    store.write(store.KEYS.grant, { code: "LOCAL-" + tier.toUpperCase(), tier: tier, at: Date.now() });
    wx.showToast({ title: "本机层级已设为 " + tiers.nameOf(tier), icon: "none" });
    this.refresh();
  },

  onResetTier() {
    store.drop(store.KEYS.grant);
    wx.showToast({ title: "已恢复默认（" + tiers.nameOf(tiers.DEFAULT_TIER) + "）", icon: "none" });
    this.refresh();
  },

  onRedeemCode() {
    wx.showModal({
      title: "本机档位直接改",
      content:
        "点上面的档位卡片就能改，不需要兑换码 —— 本机数据只属于这台手机。\n" +
        "兑换码是给「云端授权」用的：后端就绪后由管理员签发，服务端按 uid 校验，那才是能跨设备的档位。",
      showCancel: false,
      confirmText: "知道了"
    });
  },

  /* ---------- 云端 ---------- */

  onLoadAccounts() {
    if (!this.data.adminReady) {
      wx.showModal({
        title: "云端管理不可用",
        content:
          (this.data.remoteReady ? "后端已配置，但没填管理员密钥。" : "后端接口还没部署。") +
          "本机层级在上面改，改完立刻生效；改别人的档位要等名录落地。",
        showCancel: false,
        confirmText: "知道了"
      });
      return;
    }

    this.setData({ busy: true });
    admin
      .list()
      .then((res) => {
        this.setData({ busy: false, users: res.users, rosterNote: res.rosterNote });
        if (res.sim) wx.showToast({ title: "后端未就绪，名录只读", icon: "none", duration: 2500 });
      })
      .catch((err) => {
        this.setData({ busy: false });
        wx.showToast({ title: err.message || "读取名录失败", icon: "none" });
      });
  },

  /** 改某个人的档位。服务端可写就写服务端，否则只对本机生效 */
  onSetTier(e) {
    const userId = e.currentTarget.dataset.u;
    const current = e.currentTarget.dataset.t;
    const local = e.currentTarget.dataset.local === "true";

    wx.showActionSheet({
      itemList: tiers.TIERS.map((t) => t.name + "（" + t.key + "）"),
      success: (res) => {
        const t = tiers.TIERS[res.tapIndex];
        if (!t || t.key === current) return;

        this.setData({ busy: true });
        admin.setTier(userId, t.key, local).then((r) => {
          this.setData({ busy: false });
          wx.showToast({ title: r.msg, icon: "none", duration: 2500 });
          this.refresh();
        });
      }
    });
  },

  onSyncNow() {
    const hasBackend = this.data.remoteReady;
    wx.showLoading({ title: "同步中" });
    sync.now(true).then((res) => {
      wx.hideLoading();
      let msg;
      if (res.error) msg = "同步失败：" + res.error;
      else if (!res.skipped) msg = "已同步：拉 " + (res.pulled || 0) + " 推 " + (res.pushed || 0);
      else if (res.skipped === "offline")
        msg = (hasBackend ? "没登录，队列攒着" : "后端未配置，队列攒着") + "（" + (res.pending || 0) + " 条）";
      else msg = "刚同步过，稍等一下再试";
      wx.showToast({ title: msg, icon: "none", duration: 2500 });
      this.refresh();
    });
  },

  onCopyFeedback() {
    wx.setClipboardData({
      data: "belem@cnb.cool",
      success: () => wx.showToast({ title: "邮箱已复制，可以申请授权", icon: "none" })
    });
  },

  onWebAdmin() {
    wx.showModal({
      title: "完整管理后台",
      content: "名录分页、用户报告、注音勘误这些在网页版做更合适，手机上实在不好用。地址在 poem 站的 /admin/。",
      showCancel: false,
      confirmText: "知道了"
    });
  }
});
