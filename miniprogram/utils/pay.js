const remote = require("./remote");
const entitlement = require("./entitlement");
const tiers = require("./tiers");

const P = remote.PATHS;

const PERIODS = [
  { key: "month", name: "包月", unit: "/月" },
  { key: "year", name: "包年", unit: "/年" }
];

const PAID_TIERS = ["pro", "max"];

const IOS_MIN_WECHAT = [8, 0, 68];
const CONFIRM_TRIES = 6;
const CONFIRM_GAP_MS = 1500;

const STATUS_NAMES = {
  pending: "待支付",
  paid: "已支付",
  refunded: "已退款"
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
  return PERIODS.filter((p) => p.key === period)[0] || PERIODS[0];
}

function periodUnit(period) {
  return periodOf(period).unit;
}

function periodName(period) {
  return periodOf(period).name;
}

const STATUS_TONES = {
  pending: "amber",
  paid: "green",
  refunded: "red"
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
      success: (r) => (r && r.code ? resolve(r.code) : reject(new Error("拿不到微信登录凭证"))),
      fail: () => reject(new Error("拿不到微信登录凭证"))
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
      reject(new Error("当前微信版本不支持支付，请先更新微信"));
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

function buy(plan, period) {
  if (wechatTooOld()) return Promise.resolve(failure("请先把微信更新到 8.0.68 及以上再支付"));
  return loginCode()
    .then((code) => remote.request(P.payOrder, { plan: plan, period: period, code: code }))
    .then((res) => {
      const outTradeNo = res.outTradeNo;
      return requestPayment(res.payData)
        .then(() => settle(outTradeNo, CONFIRM_TRIES), () => settle(outTradeNo, 1))
        .then((order) => {
          if (order && order.status === "paid") {
            return entitlement.sync().then(() => ({ ok: true, order: order }));
          }
          return failure("没有完成支付", { outTradeNo: outTradeNo });
        });
    })
    .catch((err) => failure((err && err.message) || "下单失败"));
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
  if (!remote.adminReady()) return Promise.resolve({ ok: false, reason: "没有管理权限" });
  return remote.request(P.adminPay, body).then(
    (res) => Object.assign({ ok: true }, res),
    (err) => ({ ok: false, reason: (err && err.message) || "没成功" })
  );
}

function adminOrders(filter) {
  return adminCall(Object.assign({ op: "orders" }, filter || {}));
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
  periodUnit,
  statusName,
  statusTone,
  catalog,
  orders,
  buy,
  reconcile,
  newFeatures,
  tierName,
  adminOrders,
  adminCatalog,
  adminSaveCatalog
};
