const entitlement = require("../../../utils/entitlement");
const auth = require("../../../utils/auth");
const sync = require("../../../utils/sync");
const store = require("../../../utils/store");

/**
 * 管理层级。
 *
 * 分两层，界面上先说清是哪个：
 *
 *   1. **本机层级**（谁都能开）—— 改本机档案的档位，用来验权限分支。
 *      默认 max，因为本机数据只属于本机，不登录不该被卡功能。
 *
 *   2. **云端层级**（登录 + 管理员）—— 后端按 uid 下发档位与角色，
 *      与网页版管理后台同一套接口：
 *        /api/admin/accounts  名录
 *        /api/admin/grant     改档位
 *        /api/admin/role      改角色（owner only）
 *      后端没配时这块明确说不可用，不给假按钮。
 *
 * 与网页版 `admin/accounts.html` 的差别：那边是完整的后台（分页、搜索、
 * 批量操作、用户报告、注音勘误）。小程序端只做「给自己 / 家人调档位」——
 * 手机上做名录管理本来就不是合适的场景，真要管理还是去网页版。
 */
const TIERS = entitlement.TIERS.map((id) => ({
  id,
  label: entitlement.tierLabel(id),
  desc:
    id === "free"
      ? "每日背诵、课外阅读、注音、艾宾浩斯"
      : id === "pro"
        ? "再加 SM-2、题库、自选清单、跨设备同步"
        : "全部功能，含 FSRS、飞花令、模拟考试"
}));

Page({
  data: {
    tiers: TIERS,
    tier: "max",
    role: "user",
    signedIn: false,
    /** 哪些能力当前开 / 关，逐条列出来 */
    caps: [],
    /** 云端管理 */
    remoteReady: false,
    remoteHint: "",
    accounts: [],
    loadingAccounts: false,
    canManage: false,
    isOwner: false,
    syncState: ""
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const id = entitlement.identity();
    const local = entitlement.localPlan() || {};
    const g = sync.gate();
    const last = sync.lastResult();

    this.setData({
      tier: entitlement.currentTier(),
      role: id.role,
      signedIn: id.signedIn,
      isOwner: id.role === "owner",
      canManage: entitlement.isAdminRole(id.role),
      remoteReady: g.ok,
      remoteHint: g.ok ? "" : g.reason,
      syncState: last
        ? (last.ok
            ? "上次同步 " + this.fmt(last.at) + " · 拉 " + last.pulled + " 推 " + last.pushed
            : "同步未成功：" + last.reason)
        : (sync.pendingCount() ? "有 " + sync.pendingCount() + " 条待同步" : "还没同步过")
    });
    void local;

    this.buildCaps();
  },

  fmt(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? "0" + n : "" + n);
    return d.getMonth() + 1 + "-" + d.getDate() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  },

  buildCaps() {
    const m = entitlement.compare();
    const tier = entitlement.currentTier();
    const idx = entitlement.tierIndex(tier);

    // 逐条列出来，让用户看得见「这个档位到底开了什么」
    const caps = [];
    m.groups.forEach((g) => {
      const rows = g.rows.map((r) => {
        const on = entitlement.tierIndex(r.minTier) <= idx;
        const signedIn = entitlement.signedIn();
        const needLogin = !on && entitlement.CAPS[r.cap].login;
        return {
          name: r.name,
          on,
          note: on ? "" : needLogin && entitlement.tierIndex(r.minTier) <= idx ? "登录可用" : g.title
        };
      });
      caps.push({ title: g.title, rows });
    });
    this.setData({ caps });
  },

  /**
   * 改本机档位。
   *
   * 只是本地的一个标记：本机数据不区分档位，改它是为了验权限分支、
   * 或者提前看看 Pro / Max 的样子。真要生效得服务端下发。
   */
  onTier(e) {
    const tier = e.currentTarget.dataset.t;
    if (!entitlement.isTier(tier)) return;

    const before = entitlement.currentTier();
    entitlement.saveLocalPlan({ tier, source: "local" });
    if (entitlement.tierIndex(tier) > entitlement.tierIndex(before)) {
      entitlement.noteUpgrade(before, tier);
    }

    this.setData({ tier });
    this.buildCaps();
    wx.showToast({ title: "本机层级已设为 " + entitlement.tierLabel(tier), icon: "none" });
  },

  onResetTier() {
    entitlement.saveLocalPlan({ tier: "max", role: "user", source: "local" });
    this.refresh();
    wx.showToast({ title: "已恢复默认（Max）", icon: "none" });
  },

  /* ---------- 云端 ---------- */

  onLoadAccounts() {
    if (!this.data.remoteReady) {
      wx.showModal({
        title: "云端管理不可用",
        content: this.data.remoteHint + "。本机层级在上面改，改完立刻生效；云端层级要后端接口就绪。",
        showCancel: false,
        confirmText: "知道了"
      });
      return;
    }

    this.setData({ loadingAccounts: true });
    this.post("/api/admin/accounts", {})
      .then((data) => {
        const list = (data && data.accounts) || [];
        this.setData({
          accounts: list.map((a) => ({
            uid: a.uid,
            email: a.email || "",
            nickname: a.nickname || "",
            tier: a.tier || "free",
            tierLabel: entitlement.tierLabel(a.tier),
            role: a.role || "user",
            isOwner: a.role === "owner"
          })),
          loadingAccounts: false
        });
      })
      .catch((err) => {
        this.setData({ loadingAccounts: false });
        wx.showToast({ title: err.message || "读取名录失败", icon: "none", duration: 2500 });
      });
  },

  /** 改云端某个账号的档位。只有管理员能改，服务端会再校验一次 */
  onGrant(e) {
    const uid = e.currentTarget.dataset.uid;
    const current = e.currentTarget.dataset.tier;
    const items = TIERS.map((t) => t.label + "（" + t.id + "）");
    const at = TIERS.findIndex((t) => t.id === current);

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const tier = TIERS[res.tapIndex];
        if (!tier || tier.id === current) return;
        this.post("/api/admin/grant", { uid, tier: tier.id })
          .then(() => {
            wx.showToast({ title: "已改为 " + tier.label, icon: "none" });
            this.onLoadAccounts();
          })
          .catch((err) => wx.showToast({ title: err.message || "改档失败", icon: "none" }));
      },
      fail: () => void at
    });
  },

  /** 改角色。网页版这条只对 owner 开放，这里沿用 */
  onRole(e) {
    if (!this.data.isOwner) {
      wx.showToast({ title: "改角色只对 owner 开放", icon: "none" });
      return;
    }
    const uid = e.currentTarget.dataset.uid;
    const current = e.currentTarget.dataset.role;

    wx.showActionSheet({
      itemList: ["普通用户（user）", "管理员（admin）"],
      success: (res) => {
        const role = res.tapIndex === 1 ? "admin" : "user";
        if (role === current) return;
        this.post("/api/admin/role", { uid, role })
          .then(() => {
            wx.showToast({ title: "角色已改", icon: "none" });
            this.onLoadAccounts();
          })
          .catch((err) => wx.showToast({ title: err.message || "改角色失败", icon: "none" }));
      }
    });
  },

  onSyncNow() {
    if (!this.data.remoteReady) {
      wx.showModal({
        title: "同步不可用",
        content: this.data.remoteHint,
        showCancel: false,
        confirmText: "知道了"
      });
      return;
    }
    wx.showLoading({ title: "同步中" });
    sync.run().then((res) => {
      wx.hideLoading();
      wx.showToast({
        title: res.ok ? "已同步：拉 " + res.pulled + " 推 " + res.pushed : res.reason,
        icon: "none",
        duration: 2500
      });
      this.refresh();
    });
  },

  post(path, data) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: auth.baseUrl() + path,
        method: "POST",
        data,
        header: {
          "content-type": "application/json",
          authorization: auth.token() ? "Bearer " + auth.token() : ""
        },
        timeout: 20000,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
          else reject(new Error((res.data && res.data.message) || "HTTP " + res.statusCode));
        },
        fail: (err) => reject(new Error((err && err.errMsg) || "网络不可用"))
      });
    });
  },

  onClearNotice() {
    entitlement.clearNotice();
    wx.showToast({ title: "已清除", icon: "none" });
  },

  onResetSync() {
    sync.reset();
    this.refresh();
    wx.showToast({ title: "同步状态已重置", icon: "none" });
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
