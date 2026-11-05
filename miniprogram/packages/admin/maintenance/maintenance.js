const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const admin = require("../utils/admin");
const guard = require("../../../utils/guard");
const loginFlow = require("../../../utils/login-flow");
const remote = require("../../../utils/remote");

const REFUSE_TOAST_MAX = 20;

function sizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

const SCOPE_ROWS = [
  { key: "codes", name: "过期验证码" },
  { key: "verifications", name: "过期邮箱确认" },
  { key: "resets", name: "过期密码重设" },
  { key: "sessions", name: "过期会话" },
  { key: "rate_counters", name: "过期配额计数" },
  { key: "revoked_sessions", name: "已吊销会话" }
];

function scopeViews(scopes) {
  return SCOPE_ROWS.map((row) => {
    const hit = (scopes || []).filter((s) => s.key === row.key)[0];
    return { key: row.key, name: row.name, why: hit ? hit.why : "", result: "" };
  });
}

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    logged: false,
    canWrite: false,
    reason: "",
    totalRows: 0,
    totalBytes: 0,
    tables: [],
    scopes: [],
    busy: ""
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
  },

  onShow() {
    this.applyFont();
    const logged = admin.loggedIn();
    this.setData({ barBelow: tabbar.below(this), logged: logged, canWrite: admin.canWrite() });
    if (logged) this.load();
  },

  load() {
    guard.once("admin:maintenance", () => remote.adminMaintenanceOverview()).then((res) => {
      if (!res || !res.ok) {
        this.setData({ reason: (res && res.reason) || "取不到库况" });
        return;
      }
      this.setData({
        reason: "",
        totalRows: res.totalRows,
        totalBytes: sizeText(res.totalBytes),
        tables: res.tables.map((t) => Object.assign({}, t, { sizeText: sizeText(t.bytes) })),
        scopes: scopeViews(res.scopes)
      });
    });
  },

  onLogin() {
    loginFlow.run(this);
  },

  onPurge(e) {
    if (!this.data.canWrite) return;
    const key = e.currentTarget.dataset.key;
    const row = this.data.scopes.filter((s) => s.key === key)[0];
    if (!row) return;
    wx.showModal({
      title: "清理" + row.name,
      content: row.why || "只删已过期、业务上等同于不存在的行。",
      confirmText: "清理",
      success: (r) => {
        if (r.confirm) this.purge(key);
      }
    });
  },

  refuse(reason) {
    const text = String(reason || "").trim() || "清理未成功";
    if (text.length <= REFUSE_TOAST_MAX) wx.showToast({ title: text, icon: "none" });
    else wx.showModal({ title: "清理未成功", content: text, showCancel: false, confirmText: "知悉" });
  },

  purge(key) {
    if (this.data.busy) return;
    this.setData({ busy: key });
    remote.adminMaintenancePurge(key).then((res) => {
      this.setData({ busy: "" });
      if (!res.ok) {
        this.refuse(res.reason);
        return;
      }
      this.markResult(key, (res.deleted && res.deleted[key]) || 0);
      wx.showToast({ title: "已清 " + ((res.deleted && res.deleted[key]) || 0) + " 行", icon: "none" });
      this.load();
    });
  },

  markResult(key, n) {
    this.setData({
      scopes: this.data.scopes.map((s) => (s.key === key ? Object.assign({}, s, { result: "清掉 " + n + " 行" }) : s))
    });
  }
});
