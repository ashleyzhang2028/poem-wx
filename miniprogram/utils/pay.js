const remote = require("./remote");
const entitlement = require("./entitlement");
const tiers = require("./tiers");

const P = remote.PATHS;

const PERIODS = [
  { key: "d30", name: "30 天", days: 30 },
  { key: "d90", name: "90 天", days: 90 },
  { key: "d180", name: "180 天", days: 180 },
  { key: "d365", name: "365 天", days: 365 }
];

const LEGACY_PERIOD_NAMES = { month: "包月", year: "包年" };

const PAID_TIERS = ["pro", "max"];

const IOS_MIN_WECHAT = [8, 0, 68];
const CONFIRM_TRIES = 6;
const CONFIRM_GAP_MS = 1500;

const STATUS_NAMES = {
  pending: "待支付",
  paid: "已支付",
  refunded: "已退款",
  canceled: "已取消"
};

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

function yuan(cents) {
  const n = Number(cents) || 0;
  return n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2);
}

function dateText(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts));
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function timeText(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts));
  return dateText(ts) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function periodOf(period) {
  return PERIODS.filter((p) => p.key === period)[0] || null;
}

function periodName(period) {
  const p = periodOf(period);
  return p ? p.name : LEGACY_PERIOD_NAMES[period] || String(period);
}

function perDayText(cents, period) {
  const p = periodOf(period);
  return p ? "折合每天 ¥" + (Math.round(cents / p.days) / 100).toFixed(2) : "";
}

const STATUS_TONES = {
  pending: "amber",
  paid: "green",
  refunded: "red",
  canceled: "ghost"
};

function statusTone(key) {
  return STATUS_TONES[key] || "amber";
}

function statusName(key) {
  return STATUS_NAMES[key] || key;
}

function catalog() {
  return remote.request(P.payCatalog, {}, "GET");
}

function orders() {
  return remote.request(P.payOrders, {}, "GET").then((res) => (res && res.orders) || []);
}

function confirm(outTradeNo) {
  return remote.request(P.payConfirm, outTradeNo ? { outTradeNo: outTradeNo } : {});
}

function loginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (r) => (r && r.code ? resolve(r.code) : reject(new Error("未能获取微信登录凭证"))),
      fail: () => reject(new Error("未能获取微信登录凭证"))
    });
  });
}

function wechatTooOld() {
  const info = wx.getDeviceInfo ? wx.getDeviceInfo() : {};
  if (String(info.platform || "").toLowerCase() !== "ios") return false;
  const base = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {};
  const have = String(base.version || "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < IOS_MIN_WECHAT.length; i += 1) {
    if ((have[i] || 0) !== IOS_MIN_WECHAT[i]) return (have[i] || 0) < IOS_MIN_WECHAT[i];
  }
  return false;
}

function requestPayment(payData) {
  return new Promise((resolve, reject) => {
    if (typeof wx.requestVirtualPayment !== "function") {
      reject(new Error("当前微信版本不支持支付，请更新微信"));
      return;
    }
    wx.requestVirtualPayment(Object.assign({}, payData, { success: resolve, fail: reject }));
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function settle(outTradeNo, tries) {
  return confirm(outTradeNo).then((res) => {
    const order = ((res && res.orders) || [])[0];
    if (order && order.status === "paid") return order;
    if (tries <= 1) return order || null;
    return wait(CONFIRM_GAP_MS).then(() => settle(outTradeNo, tries - 1));
  });
}

function failure(reason, extra) {
  return Object.assign({ ok: false, reason: reason }, extra || {});
}

function checkout(start) {
  if (wechatTooOld()) return Promise.resolve(failure("请将微信更新至 8.0.68 及以上版本后支付"));
  return loginCode()
    .then(start)
    .then((res) => {
      const outTradeNo = res.outTradeNo;
      return requestPayment(res.payData)
        .then(() => settle(outTradeNo, CONFIRM_TRIES), () => settle(outTradeNo, 1))
        .then((order) => {
          if (order && order.status === "paid") {
            expiryCache = { at: 0, plan: null };
            return entitlement.sync().then(() => ({ ok: true, order: order }));
          }
          return failure("支付未完成",{ outTradeNo: outTradeNo });
        });
    })
    .catch((err) => failure((err && err.message) || "下单失败，请稍后重试"));
}

function buy(plan, period) {
  return checkout((code) => remote.request(P.payOrder, { plan: plan, period: period, code: code }));
}

function resume(outTradeNo) {
  return checkout((code) => remote.request(P.payManage, { op: "resume", outTradeNo: outTradeNo, code: code }));
}

function manage(op, outTradeNo) {
  return remote.request(P.payManage, { op: op, outTradeNo: outTradeNo }).then(
    () => ({ ok: true }),
    (err) => failure((err && err.message) || "操作失败，请稍后重试")
  );
}

const EXPIRY_WARN_DAYS = 7;
const EXPIRED_SHOW_DAYS = 30;
const EXPIRY_CACHE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;

let expiryCache = { at: 0, plan: null };

function expiryOf(plan) {
  if (!plan) return null;
  if (plan.expired && Date.now() - Number(plan.expired.until) < EXPIRED_SHOW_DAYS * DAY_MS) {
    return { kind: "expired", tier: plan.expired.tier, days: 0 };
  }
  if (plan.tier === "free" || !plan.until) return null;
  const days = Math.ceil((Number(plan.until) - Date.now()) / DAY_MS);
  if (days < 1 || days > EXPIRY_WARN_DAYS) return null;
  return { kind: "soon", tier: plan.tier, days: days };
}

function expiryText(e) {
  if (!e) return null;
  const name = tierName(e.tier);
  if (e.kind === "expired") return { title: name + " 已到期", sub: "重新开通后恢复使用" };
  return { title: name + " 还有 " + e.days + " 天到期", sub: "续订后在原到期日基础上顺延" };
}

function planInfo() {
  if (Date.now() - expiryCache.at < EXPIRY_CACHE_MS) return Promise.resolve(expiryCache.plan);
  return catalog().then(
    (res) => {
      expiryCache = { at: Date.now(), plan: (res && res.plan) || null };
      return expiryCache.plan;
    },
    () => null
  );
}

function expiry() {
  return planInfo().then(expiryOf);
}

function reconcile() {
  return confirm("")
    .then((res) => ((res && res.orders) || []).some((o) => o.status === "paid"), () => false)
    .then((changed) => (changed ? entitlement.sync() : null));
}

function newFeatures(tier) {
  return entitlement.CAPS.filter((c) => c.tier === tier).map((c) => c.name);
}

function tierName(key) {
  return tiers.nameOf(key);
}

function adminCall(body) {
  if (!remote.adminReady()) return Promise.resolve({ ok: false, reason: "无管理权限" });
  return remote.request(P.adminPay, body).then(
    (res) => Object.assign({ ok: true }, res),
    (err) => ({ ok: false, reason: (err && err.message) || "操作失败，请稍后重试" })
  );
}

function adminOrders(filter) {
  return adminCall(Object.assign({ op: "orders" }, filter || {}));
}

function adminCount(summary) {
  const s = summary || {};
  return {
    count: Number(s.count) || 0,
    paid: Number(s.paid) || 0,
    pending: Number(s.pending) || 0,
    refunded: Number(s.refunded) || 0,
    paidText: yuan(s.paidCents),
    pendingText: yuan(s.pendingCents),
    refundedText: yuan(s.refundedCents)
  };
}

function adminCatalog() {
  return adminCall({ op: "catalog" });
}

function adminSaveCatalog(next) {
  return adminCall({ op: "saveCatalog", catalog: next });
}

module.exports = {
  PERIODS,
  PAID_TIERS,
  yuan,
  dateText,
  timeText,
  periodName,
  perDayText,
  statusName,
  statusTone,
  catalog,
  orders,
  buy,
  resume,
  manage,
  reconcile,
  planInfo,
  expiry,
  expiryText,
  newFeatures,
  tierName,
  adminOrders,
  adminCount,
  adminCatalog,
  adminSaveCatalog
};
