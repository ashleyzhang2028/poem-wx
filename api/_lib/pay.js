"use strict";

var crypto = require("crypto");
var core = require("./core");
var H = require("./http");

var DAY = 86400000;
var PERIOD_DAYS = { d30: 30, d90: 90, d180: 180, d365: 365 };
var PERIODS = Object.keys(PERIOD_DAYS);
var PERIOD_MS = { month: 31 * DAY, year: 366 * DAY };
PERIODS.forEach(function (k) { PERIOD_MS[k] = PERIOD_DAYS[k] * DAY; });
var PLANS = ["pro", "max"];
var LIST_PRICE_CENTS = {
  pro: { d30: 1500, d90: 3500, d180: 5900, d365: 9800 },
  max: { d30: 2900, d90: 6900, d180: 11900, d365: 19800 }
};
var RANK = { free: 0, pro: 1, max: 2 };
var CATALOG_KEY = "pay.catalog";
var PAID_STATUS = [2, 3, 4];
var UNPAID = ["pending", "canceled", "deleted"];
var PENDING_WINDOW_MS = DAY;
var QUERY_GAP_MS = 2500;
var LAST_QUERY_MAX = 2000;
var PUSH_SKEW_MS = 10 * 60 * 1000;
var PRODUCT_ID = /^[A-Za-z0-9_]{1,64}$/;
var PRODUCT_MAX = 40;
var PRICE_MAX_CENTS = 1000000;
var WX_TIMEOUT_MS = 6000;
var NOTIFY_RAW_MAX = 4000;
var CONFIRM_BATCH = 3;

var DEFAULT_CATALOG = { products: [], active: {} };
PLANS.forEach(function (plan) {
  PERIODS.forEach(function (period) {
    var productId = plan + "_" + PERIOD_DAYS[period];
    DEFAULT_CATALOG.products.push({ productId: productId, plan: plan, period: period, priceCents: LIST_PRICE_CENTS[plan][period] });
    DEFAULT_CATALOG.active[plan + "." + period] = productId;
  });
});

var tokenCache = { value: "", expiresAt: 0 };
var lastQueryAt = {};

function ok(body) { return { status: 200, body: body }; }
function err(status, code, message, extra) {
  var body = { code: code, message: message };
  if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
  return { status: status, body: body };
}

function hmac(key, text) {
  return crypto.createHmac("sha256", String(key)).update(text, "utf8").digest("hex");
}

function sameText(a, b) {
  var x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function slot(plan, period) { return plan + "." + period; }

function normCatalog(input) {
  var src = input || {};
  var list = Array.isArray(src.products) ? src.products : null;
  if (!list || !list.length || list.length > PRODUCT_MAX) {
    return { bad: "E_CATALOG", message: "道具列表为空或超过 " + PRODUCT_MAX + " 个" };
  }
  var seen = {};
  var products = [];
  for (var i = 0; i < list.length; i++) {
    var p = list[i] || {};
    var productId = String(p.productId || "").trim();
    var price = Number(p.priceCents);
    if (!PRODUCT_ID.test(productId) || seen[productId]) {
      return { bad: "E_CATALOG", message: "道具 ID 只认字母数字下划线，且不能重复：" + productId };
    }
    if (PLANS.indexOf(p.plan) < 0 || PERIODS.indexOf(p.period) < 0) {
      return { bad: "E_CATALOG", message: "道具 " + productId + " 的档位或周期不对" };
    }
    if (!isFinite(price) || price < 1 || price > PRICE_MAX_CENTS || Math.floor(price) !== price) {
      return { bad: "E_CATALOG", message: "道具 " + productId + " 的价格要是 1 到 " + PRICE_MAX_CENTS + " 之间的整数（分）" };
    }
    seen[productId] = true;
    products.push({ productId: productId, plan: p.plan, period: p.period, priceCents: price });
  }
  var active = {};
  for (var a = 0; a < PLANS.length; a++) {
    for (var b = 0; b < PERIODS.length; b++) {
      var key = slot(PLANS[a], PERIODS[b]);
      var pid = String((src.active || {})[key] || "");
      var hit = products.filter(function (x) { return x.productId === pid; })[0];
      if (!hit || hit.plan !== PLANS[a] || hit.period !== PERIODS[b]) {
        return { bad: "E_CATALOG", message: key + " 没有指向一个同档位同周期的道具" };
      }
      active[key] = pid;
    }
  }
  return { catalog: { products: products, active: active } };
}

function loadCatalog(store) {
  return Promise.resolve(store.getSetting(CATALOG_KEY)).then(function (row) {
    if (!row || !row.value) return DEFAULT_CATALOG;
    var parsed = null;
    try { parsed = JSON.parse(row.value); } catch (e) { return DEFAULT_CATALOG; }
    var n = normCatalog(parsed);
    return n.catalog || DEFAULT_CATALOG;
  });
}

function productOf(catalog, plan, period) {
  var pid = catalog.active[slot(plan, period)];
  return catalog.products.filter(function (p) { return p.productId === pid; })[0] || null;
}

function listPriceOf(catalog, plan, period) {
  return catalog.products.filter(function (p) { return p.plan === plan && p.period === period; })[0] || null;
}

function publicCatalog(catalog) {
  var plans = {};
  PLANS.forEach(function (plan) {
    plans[plan] = {};
    PERIODS.forEach(function (period) {
      var active = productOf(catalog, plan, period);
      var list = listPriceOf(catalog, plan, period);
      plans[plan][period] = {
        productId: active.productId,
        priceCents: active.priceCents,
        originalCents: list && list.priceCents > active.priceCents ? list.priceCents : null
      };
    });
  });
  return plans;
}

function publicOrder(row) {
  return {
    outTradeNo: String(row.out_trade_no || ""),
    plan: String(row.plan || ""),
    period: String(row.period || ""),
    priceCents: Number(row.price_cents || 0),
    status: String(row.status || ""),
    createdAt: Number(row.created_at || 0),
    paidAt: row.paid_at == null ? null : Number(row.paid_at),
    planUntilAfter: row.plan_until_after == null ? null : Number(row.plan_until_after),
    wxOrderId: String(row.wx_order_id || "")
  };
}

function adminOrder(row) {
  return Object.assign(publicOrder(row), {
    uid: String(row.uid || ""),
    openid: String(row.openid || ""),
    productId: String(row.product_id || ""),
    source: String(row.source || ""),
    applied: Number(row.applied || 0) === 1,
    refundedAt: row.refunded_at == null ? null : Number(row.refunded_at),
    notifyRaw: String(row.notify_raw || "")
  });
}

function currentPlan(acc) {
  var tier = core.planTier(acc);
  var until = acc.plan_until == null ? null : Number(acc.plan_until);
  var lapsed = tier === "free" && RANK[acc.plan] > 0 && until != null && until <= Date.now();
  return { tier: tier, until: until, expired: lapsed ? { tier: acc.plan, until: until } : null };
}

function loginGate(deps) {
  if (!deps.cfg.hasSession()) {
    return err(503, "E_NOT_CONFIGURED", "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。");
  }
  if (!deps.account) return err(401, "E_NO_SESSION", "还没有登录");
  return null;
}

function payGate(deps) {
  if (!deps.cfg.hasPay()) {
    return err(503, "E_PAY_NOT_CONFIGURED", "支付还没开通（服务端缺 WX_PAY_APPKEY 等配置）。");
  }
  return null;
}

function wxFetchJson(deps, url, init) {
  var cfg = deps.cfg;
  var fetchFn = cfg.wxFetch || (typeof fetch === "function" ? fetch : null);
  if (!fetchFn) return Promise.reject(new Error("no fetch"));
  var timer = null;
  var timeout = new Promise(function (_, reject) {
    timer = setTimeout(function () { reject(new Error("wx timeout")); }, WX_TIMEOUT_MS);
  });
  return Promise.race([
    Promise.resolve().then(function () { return fetchFn(url, init); })
      .then(function (r) { return r && typeof r.json === "function" ? r.json() : r; }),
    timeout
  ]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
}

function wxBase(cfg) {
  return String(cfg.wxApiBase || "https://api.weixin.qq.com").replace(/[/]+$/, "");
}

function accessToken(deps) {
  var cfg = deps.cfg, t = deps.now();
  if (tokenCache.value && tokenCache.expiresAt > t) return Promise.resolve(tokenCache.value);
  var url = wxBase(cfg) + "/cgi-bin/token?grant_type=client_credential&appid="
    + encodeURIComponent(String(cfg.wxAppId)) + "&secret=" + encodeURIComponent(String(cfg.wxSecret));
  return wxFetchJson(deps, url, { method: "GET" }).then(function (data) {
    if (!data || !data.access_token) return "";
    tokenCache = { value: String(data.access_token), expiresAt: t + Math.max(60, Number(data.expires_in) || 7200) * 1000 - 120000 };
    return tokenCache.value;
  });
}

function wxQueryOrder(deps, order) {
  var cfg = deps.cfg;
  return accessToken(deps).then(function (token) {
    if (!token) return null;
    var body = JSON.stringify({ openid: order.openid, env: cfg.payEnv, order_id: order.out_trade_no });
    var paySig = hmac(cfg.payKeyOf(), "/xpay/query_order&" + body);
    var url = wxBase(cfg) + "/xpay/query_order?access_token=" + encodeURIComponent(token) + "&pay_sig=" + paySig;
    return wxFetchJson(deps, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body });
  });
}

function creditFrom(rowsNewestFirst, cur, t) {
  if (cur.tier !== "pro" || cur.until == null || cur.until <= t) return 0;
  var left = cur.until - t, value = 0;
  rowsNewestFirst.forEach(function (o) {
    if (left <= 0 || o.plan !== "pro" || Number(o.applied) !== 1) return;
    var span = PERIOD_MS[o.period];
    var take = Math.min(left, span);
    value += Number(o.price_cents) * take / span;
    left -= take;
  });
  return value;
}

function proCreditCents(store, uid, acc, t) {
  return Promise.resolve(store.listPayOrders({ uid: uid, status: "paid" }, 100)).then(function (rows) {
    return creditFrom(rows || [], currentPlan(acc), t);
  });
}

function bonusDaysOf(creditCents, priceCents, period) {
  if (!(creditCents > 0) || !(priceCents > 0)) return 0;
  return Math.floor(creditCents * (PERIOD_MS[period] / DAY) / priceCents);
}

function upgradeBonusMs(store, acc, order, t) {
  if (order.plan !== "max") return Promise.resolve(0);
  return proCreditCents(store, order.uid, acc, t).then(function (credit) {
    return bonusDaysOf(credit, Number(order.price_cents), order.period) * DAY;
  });
}

function upgradeOffer(store, uid, acc, plans, t) {
  return proCreditCents(store, uid, acc, t).then(function (credit) {
    if (!(credit > 0)) return null;
    var bonus = {};
    PERIODS.forEach(function (period) { bonus[period] = bonusDaysOf(credit, plans.max[period].priceCents, period); });
    return { proLeftDays: Math.ceil((currentPlan(acc).until - t) / DAY), bonus: bonus };
  });
}

function nextOf(cur, order, t, bonusMs) {
  if (RANK[cur.tier] > RANK[order.plan]) return { plan: cur.tier, until: cur.until };
  var span = PERIOD_MS[order.period];
  if (cur.tier === order.plan) {
    if (cur.until == null) return { plan: order.plan, until: null };
    return { plan: order.plan, until: Math.max(t, cur.until) + span };
  }
  return { plan: order.plan, until: t + span + (bonusMs || 0) };
}

function paidOrder(a, b) {
  return Number(a.paid_at) - Number(b.paid_at)
    || (a.plan_until_after == null ? 1 : b.plan_until_after == null ? -1 : Number(a.plan_until_after) - Number(b.plan_until_after));
}

function replayPlan(orders) {
  var state = { plan: "free", until: null }, done = [];
  orders.forEach(function (o) {
    var t = Number(o.paid_at);
    var live = state.plan !== "free" && (state.until == null || state.until > t);
    var cur = { tier: live ? state.plan : "free", until: live ? state.until : null };
    var bonusMs = o.plan === "max"
      ? bonusDaysOf(creditFrom(done.slice().reverse(), cur, t), Number(o.price_cents), o.period) * DAY
      : 0;
    var next = nextOf(cur, o, t, bonusMs);
    state = { plan: next.plan, until: next.until };
    done.push(o);
  });
  return state;
}

function sameUntil(a, b) {
  return (a == null && b == null) || (a != null && b != null && Number(a) === Number(b));
}

function deliver(deps, order, info) {
  var store = deps.store, t = deps.now();
  if (order.status === "paid" && Number(order.applied) === 1) return Promise.resolve(order);
  if (order.status !== "paid" && UNPAID.indexOf(order.status) < 0) return Promise.resolve(order);
  return Promise.resolve(store.getAccount(order.uid)).then(function (acc) {
    if (!acc || acc.status === "deleted") return order;
    var plan = order.plan_after;
    var until = order.plan_until_after == null ? null : Number(order.plan_until_after);
    var claim = Promise.resolve(true);
    if (order.status !== "paid") {
      claim = upgradeBonusMs(store, acc, order, t).then(function (bonusMs) {
        var next = nextOf(currentPlan(acc), order, t, bonusMs);
        plan = next.plan;
        until = next.until;
        return store.claimPayOrder(order.out_trade_no, order.status, {
          status: "paid",
          wx_order_id: String((info && info.wxOrderId) || "").slice(0, 64) || null,
          source: String((info && info.source) || "").slice(0, 16),
          plan_after: plan,
          plan_until_after: until,
          applied: 0,
          paid_at: t,
          notify_raw: info && info.raw ? String(info.raw).slice(0, NOTIFY_RAW_MAX) : null
        });
      });
    }
    return Promise.resolve(claim).then(function (won) {
      if (!won) return store.getPayOrder(order.out_trade_no);
      return Promise.resolve(store.patchAccount(order.uid, { plan: plan, plan_until: until }))
        .then(function () { return store.patchPayOrder(order.out_trade_no, { applied: 1 }); });
    });
  });
}

function revoke(deps, order) {
  var store = deps.store, t = deps.now();
  return Promise.resolve(store.claimPayOrder(order.out_trade_no, "paid", { status: "refunded", refunded_at: t }))
    .then(function (won) {
      if (!won || Number(order.applied) !== 1) return null;
      return Promise.all([store.getAccount(order.uid), store.listPayOrders({ uid: order.uid, status: "paid" }, 100)]).then(function (r) {
        var acc = r[0];
        if (!acc) return null;
        var rest = (r[1] || []).filter(function (o) { return Number(o.applied) === 1; }).sort(paidOrder);
        var last = rest.concat([order]).sort(paidOrder).pop();
        if (last.plan_after === acc.plan && sameUntil(last.plan_until_after, acc.plan_until)) {
          var s = replayPlan(rest);
          var live = s.plan !== "free" && (s.until == null || s.until > t);
          return store.patchAccount(order.uid, live ? { plan: s.plan, plan_until: s.until } : { plan: "free", plan_until: null });
        }
        if (acc.plan !== order.plan || acc.plan_until == null) return null;
        var left = Number(acc.plan_until) - PERIOD_MS[order.period];
        return store.patchAccount(order.uid, left > t ? { plan: acc.plan, plan_until: left } : { plan: "free", plan_until: null });
      });
    });
}

function payCatalog(deps) {
  var gate = loginGate(deps);
  if (gate) return Promise.resolve(gate);
  return Promise.all([loadCatalog(deps.store), deps.store.getAccount(deps.account.uid)]).then(function (r) {
    if (!r[1] || r[1].status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    var plans = publicCatalog(r[0]);
    return upgradeOffer(deps.store, deps.account.uid, r[1], plans, deps.now()).then(function (upgrade) {
      return ok({ plans: plans, plan: currentPlan(r[1]), upgrade: upgrade, payReady: deps.cfg.hasPay(), sandbox: deps.cfg.payEnv === 1 });
    });
  });
}

function payOrder(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var gate = loginGate(deps) || payGate(deps);
  if (gate) return Promise.resolve(gate);

  var plan = String((input && input.plan) || "");
  var period = String((input && input.period) || "");
  var code = String((input && input.code) || "").trim();
  if (PLANS.indexOf(plan) < 0 || PERIODS.indexOf(period) < 0) {
    return Promise.resolve(err(400, "E_PAY_PLAN", "档位或周期不对"));
  }
  if (!code) return Promise.resolve(err(400, "E_WX_CODE", "缺少 wx.login 拿到的 code。"));

  var uid = deps.account.uid;
  var byUid = deps.limiter.take(cfg, "uid", "payorder:" + uid, t);
  if (!byUid.ok) return Promise.resolve(err(429, "E_RATE_UID", "下单太频繁了，请稍后再试", { retryAfter: byUid.retryAfter }));
  var byDevice = deps.limiter.take(cfg, "device", "payorder:" + String(deps.deviceId || "unknown"), t);
  if (!byDevice.ok) return Promise.resolve(err(429, "E_RATE_DEVICE", "下单太频繁了，请稍后再试", { retryAfter: byDevice.retryAfter }));

  return Promise.all([store.getAccount(uid), loadCatalog(store)]).then(function (r) {
    var acc = r[0], product = productOf(r[1], plan, period);
    if (!acc || acc.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (RANK[core.planTier(acc)] > RANK[plan]) {
      return err(409, "E_PAY_DOWNGRADE", "当前档位已经高于所选档位，无需购买");
    }
    return core.wxCode2Session(deps, code).then(function (s) {
      if (s.status !== 200) return s;
      return Promise.resolve(store.getWxAccountByOpenid(s.body.openid)).then(function (wx) {
        if (!wx || String(wx.uid) !== String(uid)) {
          return err(403, "E_PAY_OPENID", "请用微信登录的账号购买");
        }
        var outTradeNo = "T" + t + crypto.randomBytes(4).toString("hex");
        var signData = JSON.stringify({
          offerId: cfg.payOfferId,
          buyQuantity: 1,
          env: cfg.payEnv,
          currencyType: "CNY",
          productId: product.productId,
          goodsPrice: product.priceCents,
          outTradeNo: outTradeNo,
          attach: slot(plan, period)
        });
        var row = {
          out_trade_no: outTradeNo, uid: uid, openid: String(s.body.openid),
          product_id: product.productId, plan: plan, period: period,
          price_cents: product.priceCents, status: "pending",
          wx_order_id: null, source: "", plan_after: "", plan_until_after: null,
          applied: 0, notify_raw: null, created_at: t, paid_at: null, refunded_at: null
        };
        return Promise.resolve(store.putPayOrder(row)).then(function () {
          return ok({
            outTradeNo: outTradeNo,
            priceCents: product.priceCents,
            payData: {
              mode: "short_series_goods",
              signData: signData,
              paySig: hmac(cfg.payKeyOf(), "requestVirtualPayment&" + signData),
              signature: hmac(s.body.sessionKey, signData)
            }
          });
        });
      });
    });
  });
}

function wxPaidOrder(deps, order) {
  return wxQueryOrder(deps, order).then(function (data) {
    var o = data && data.order;
    if (!o || Number(data.errcode || 0) !== 0 || PAID_STATUS.indexOf(Number(o.status)) < 0) return null;
    if (o.order_fee != null && Number(o.order_fee) !== Number(order.price_cents)) {
      H.log("pay.query_fee_mismatch", { out: order.out_trade_no });
      return null;
    }
    return o;
  }, function () { return null; });
}

function settleFromWx(deps, order) {
  var t = deps.now();
  if (lastQueryAt[order.out_trade_no] && t - lastQueryAt[order.out_trade_no] < QUERY_GAP_MS) {
    return Promise.resolve(order);
  }
  if (Object.keys(lastQueryAt).length > LAST_QUERY_MAX) lastQueryAt = {};
  lastQueryAt[order.out_trade_no] = t;
  return wxPaidOrder(deps, order).then(function (o) {
    if (!o) return order;
    return deliver(deps, order, { source: "query", wxOrderId: o.wx_order_id || o.order_id_wx || "", raw: JSON.stringify(o) });
  });
}

function payConfirm(deps, input) {
  var store = deps.store, t = deps.now();
  var gate = loginGate(deps) || payGate(deps);
  if (gate) return Promise.resolve(gate);
  var uid = deps.account.uid;
  var wanted = String((input && input.outTradeNo) || "").trim();

  var pick = wanted
    ? Promise.resolve(store.getPayOrder(wanted)).then(function (o) { return o && o.uid === uid ? [o] : null; })
    : Promise.resolve(store.listPayOrders({ uid: uid, status: "pending" }, CONFIRM_BATCH)).then(function (rows) {
      return (rows || []).filter(function (o) { return t - Number(o.created_at) < PENDING_WINDOW_MS; });
    });

  return pick.then(function (orders) {
    if (!orders) return err(404, "E_PAY_ORDER", "没有这笔订单");
    return Promise.all(orders.map(function (o) {
      if (o.status === "paid" && Number(o.applied) !== 1) return deliver(deps, o, null);
      return o.status === "pending" ? settleFromWx(deps, o) : o;
    })).then(function (settled) {
      return Promise.resolve(store.getAccount(uid)).then(function (acc) {
        return ok({ orders: settled.map(publicOrder), plan: currentPlan(acc) });
      });
    });
  });
}

var MANAGE_FROM = { cancel: ["pending"], delete: ["pending", "canceled"] };
var MANAGE_TO = { cancel: "canceled", delete: "deleted" };

function stateConflict(order, what) {
  return err(409, "E_PAY_ORDER_STATE", order.status === "paid" ? "这笔订单已经支付，不能" + what : "这笔订单当前不能" + what);
}

function manageDone(deps, order, op) {
  var what = op === "cancel" ? "取消" : "删除";
  if (order.status === MANAGE_TO[op]) return Promise.resolve(ok({ status: order.status }));
  if (MANAGE_FROM[op].indexOf(order.status) < 0) return Promise.resolve(stateConflict(order, what));
  return Promise.resolve(deps.store.claimPayOrder(order.out_trade_no, order.status, { status: MANAGE_TO[op] })).then(function (won) {
    return won ? ok({ status: MANAGE_TO[op] }) : err(409, "E_PAY_ORDER_STATE", "订单状态刚刚变了，请刷新后再试");
  });
}

function manageResume(deps, order, code) {
  if (order.status !== "pending" || deps.now() - Number(order.created_at) >= PENDING_WINDOW_MS) {
    return Promise.resolve(stateConflict(order, "继续支付"));
  }
  return payOrder(deps, { plan: order.plan, period: order.period, code: code }).then(function (res) {
    if (res.status !== 200) return res;
    return Promise.resolve(deps.store.claimPayOrder(order.out_trade_no, "pending", { status: "canceled" })).then(function (won) {
      if (won) return res;
      return Promise.resolve(deps.store.claimPayOrder(res.body.outTradeNo, "pending", { status: "canceled" }))
        .then(function () { return err(409, "E_PAY_ORDER_STATE", "这笔订单已经支付"); });
    });
  });
}

function payManage(deps, input) {
  var gate = loginGate(deps) || payGate(deps);
  if (gate) return Promise.resolve(gate);
  var op = String((input && input.op) || "");
  var out = String((input && input.outTradeNo) || "").trim();
  if (op !== "resume" && !MANAGE_TO[op]) return Promise.resolve(err(400, "E_PAY_OP", "操作不对"));
  return Promise.resolve(deps.store.getPayOrder(out)).then(function (order) {
    if (!order || order.uid !== deps.account.uid || order.status === "deleted") return err(404, "E_PAY_ORDER", "没有这笔订单");
    var fresh = order.status === "pending" ? settleFromWx(deps, order) : Promise.resolve(order);
    return fresh.then(function (cur) {
      return op === "resume" ? manageResume(deps, cur, String((input && input.code) || "").trim()) : manageDone(deps, cur, op);
    });
  });
}

function payOrdersMine(deps, input) {
  var gate = loginGate(deps);
  if (gate) return Promise.resolve(gate);
  var limit = Math.max(1, Math.min(100, Number(input && input.limit) || 50));
  return Promise.resolve(deps.store.listPayOrders({ uid: deps.account.uid }, limit)).then(function (rows) {
    return ok({ orders: (rows || []).filter(function (r) { return r.status !== "deleted"; }).map(publicOrder) });
  });
}

function pushSigned(cfg, query, t) {
  var token = String(cfg.payPushToken || "");
  if (!token) return false;
  var q = query || {};
  var sentAt = Number(q.timestamp) * 1000;
  if (!isFinite(sentAt) || Math.abs(t - sentAt) > PUSH_SKEW_MS) return false;
  var expect = crypto.createHash("sha1").update([token, String(q.timestamp || ""), String(q.nonce || "")].sort().join("")).digest("hex");
  return sameText(expect, String(q.signature || ""));
}

function pushAck(code, msg) {
  return { status: 200, body: { ErrCode: code, ErrMsg: msg } };
}

function payNotify(deps, input) {
  var cfg = deps.cfg, store = deps.store;
  var query = (input && input.query) || {};
  if (!pushSigned(cfg, query, deps.now())) return Promise.resolve({ status: 403, text: "" });
  if (String(input.method).toUpperCase() === "GET") {
    return Promise.resolve({ status: 200, text: String(query.echostr || "") });
  }
  var msg = (input && input.body) || {};
  var event = String(msg.Event || "");
  var out = String(msg.OutTradeNo || "");
  if (event !== "xpay_goods_deliver_notify" && event !== "xpay_refund_notify") return Promise.resolve(pushAck(0, "ignored"));
  if (!out) return Promise.resolve(pushAck(1, "no order"));

  return Promise.resolve(store.getPayOrder(out)).then(function (order) {
    if (!order) return pushAck(1, "unknown order");
    if (event === "xpay_refund_notify") {
      return revoke(deps, order).then(function () { return pushAck(0, "success"); });
    }
    var goods = msg.GoodsInfo || {};
    var wxPay = msg.WeChatPayInfo || {};
    var feeOk = goods.OrderFee == null || Number(goods.OrderFee) === Number(order.price_cents);
    if (String(msg.OpenId || "") !== order.openid || String(goods.ProductId || "") !== order.product_id || !feeOk) {
      H.log("pay.notify_mismatch", { out: out });
      return pushAck(1, "mismatch");
    }
    var settled = order.status === "paid" && Number(order.applied) === 1
      ? Promise.resolve(order)
      : wxPaidOrder(deps, order).then(function (paid) {
        if (!paid) return null;
        return deliver(deps, order, { source: "notify", wxOrderId: wxPay.MchOrderNo || "", raw: JSON.stringify(msg) });
      });
    return settled.then(function (o) { return o && o.status === "paid" ? pushAck(0, "success") : pushAck(1, "retry"); });
  });
}

var ADMIN_SCAN = 500;
var ADMIN_PAGE_SIZE = 20;
var ADMIN_COUNTED = ["paid", "pending", "refunded"];

function countOrders(list) {
  var out = { count: list.length };
  ADMIN_COUNTED.forEach(function (st) {
    var rows = list.filter(function (o) { return o.status === st; });
    out[st] = rows.length;
    out[st + "Cents"] = rows.reduce(function (s, o) { return s + o.priceCents; }, 0);
  });
  return out;
}

function orderMatches(o, q) {
  return [o.outTradeNo, o.wxOrderId, o.uid, o.openid, o.productId].some(function (v) {
    return v && String(v).toLowerCase().indexOf(q) >= 0;
  });
}

function adminOnly(deps) {
  var gate = loginGate(deps);
  if (gate) return Promise.resolve(gate);
  return Promise.resolve(deps.store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!core.isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");
    return null;
  });
}

function payAdmin(deps, input) {
  var store = deps.store;
  return adminOnly(deps).then(function (denied) {
    if (denied) return denied;
    var op = String((input && input.op) || "orders");
    if (op === "catalog") {
      return loadCatalog(store).then(function (c) { return ok({ catalog: c }); });
    }
    if (op === "saveCatalog") {
      var n = normCatalog(input && input.catalog);
      if (n.bad) return err(400, n.bad, n.message);
      return Promise.resolve(store.putSetting(CATALOG_KEY, JSON.stringify(n.catalog)))
        .then(function () {
          H.log("pay.catalog_saved", { by: deps.account.uid });
          return ok({ catalog: n.catalog });
        });
    }
    var filter = {};
    if (input && input.status) filter.status = String(input.status);
    if (input && input.uid) filter.uid = String(input.uid);
    return Promise.resolve(store.listPayOrders(filter, ADMIN_SCAN)).then(function (rows) {
      var all = (rows || []).map(adminOrder);
      var q = String((input && input.q) || "").trim().toLowerCase();
      var hit = q ? all.filter(function (o) { return orderMatches(o, q); }) : all;
      var size = Math.max(1, Math.min(100, Number((input && input.size)) || ADMIN_PAGE_SIZE));
      var pages = Math.max(1, Math.ceil(hit.length / size));
      var page = Math.max(1, Math.min(pages, Number((input && input.page)) || 1));
      return ok({
        orders: hit.slice((page - 1) * size, page * size),
        page: page,
        pages: pages,
        total: hit.length,
        summary: countOrders(all),
        matched: countOrders(filter.status ? hit.filter(function (o) { return o.status === filter.status; }) : hit)
      });
    });
  });
}

module.exports = {
  payCatalog: payCatalog,
  payOrder: payOrder,
  payConfirm: payConfirm,
  payManage: payManage,
  payOrdersMine: payOrdersMine,
  payNotify: payNotify,
  payAdmin: payAdmin,
  normCatalog: normCatalog,
  DEFAULT_CATALOG: DEFAULT_CATALOG,
  PERIOD_MS: PERIOD_MS,
  PERIODS: PERIODS
};
