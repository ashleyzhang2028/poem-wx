"use strict";

var ROUTES = {
  "GET /count": "./../_routes/count.js",
  "POST /send-code": "./../_routes/send-code.js",
  "POST /verify-code": "./../_routes/verify-code.js",
  "GET /me": "./../_routes/me.js",
  "PATCH /me": "./../_routes/me-patch.js",

  "GET /config": "./../_routes/config.js",
  "GET /diag": "./../_routes/diag.js",

  "POST /wx/login": "./../_routes/wx/login.js",
  "POST /wx/refresh": "./../_routes/wx/refresh.js",

  "POST /sync/pull": "./../_routes/sync/pull.js",
  "POST /sync/push": "./../_routes/sync/push.js",
  "DELETE /account": "./../_routes/account.js",
  "POST /avatar": "./../_routes/avatar/index.js",
  "DELETE /avatar": "./../_routes/avatar/index.js",
  "GET /avatar/:uid": "./../_routes/avatar/file.js",
  "GET /family": "./../_routes/family/index.js",
  "POST /family": "./../_routes/family/index.js",
  "POST /game/answer": "./../_routes/game/answer.js",
  "POST /ranking": "./../_routes/ranking/index.js",
  "GET /exam/records": "./../_routes/exam/records.js",
  "POST /exam/records": "./../_routes/exam/records.js",
  "GET /pay/catalog": "./../_routes/pay/catalog.js",
  "POST /pay/order": "./../_routes/pay/order.js",
  "POST /pay/confirm": "./../_routes/pay/confirm.js",
  "POST /pay/manage": "./../_routes/pay/manage.js",
  "GET /pay/orders": "./../_routes/pay/orders.js",
  "GET /pay/notify": "./../_routes/pay/notify.js",
  "POST /pay/notify": "./../_routes/pay/notify.js",
  "POST /admin/pay": "./../_routes/admin/pay.js",
  "POST /admin/grant": "./../_routes/admin/grant.js",
  "DELETE /admin/grant": "./../_routes/admin/grant.js",
  "POST /admin/grants": "./../_routes/admin/grants.js",
  "POST /admin/accounts": "./../_routes/admin/accounts.js",
  "POST /admin/role": "./../_routes/admin/role.js",
  "POST /admin/reports": "./../_routes/admin/reports.js",
  "POST /admin/pinyin": "./../_routes/admin/pinyin.js",
  "GET /pinyin-fixes": "./../_routes/pinyin-fixes.js",
  "POST /admin/feedback": "./../_routes/admin/feedback.js",

  "GET /feedback": "./../_routes/feedback/index.js",
  "POST /feedback": "./../_routes/feedback/index.js",

  "GET /report": "./../_routes/report/index.js",
  "POST /report": "./../_routes/report/index.js",

  "POST /register": "./../_routes/auth/register.js",
  "POST /login": "./../_routes/auth/login.js",
  "POST /logout": "./../_routes/auth/logout.js",
  "POST /verify-email": "./../_routes/auth/verify-email.js",
  "POST /resend-verification": "./../_routes/auth/resend-verification.js",
  "POST /resend-verification-by-email": "./../_routes/auth/resend-verification-by-email.js",
  "POST /reset-request": "./../_routes/auth/reset-request.js",
  "POST /reset-confirm": "./../_routes/auth/reset-confirm.js"
};

var PREFIX = "/api/handler";

var PATHS = Object.keys(ROUTES).map(function (k) {
  return k.split(" ")[1];
}).filter(function (p, i, arr) {
  return arr.indexOf(p) === i;
});

function resolve(method, url) {
  var m = String(method || "GET").toUpperCase();
  var p = String(url || "").split("?")[0].split("#")[0];

  var rest = p.replace(/\/+/g, "/");
  if (rest.charAt(0) !== "/") rest = "/" + rest;

  if (rest === PREFIX) rest = "/";
  else if (rest.indexOf(PREFIX + "/") === 0) rest = rest.slice(PREFIX.length);
  else if (rest === "/api") rest = "/";
  else if (rest.indexOf("/api/") === 0) rest = rest.slice("/api".length);

  if (rest.length > 1) rest = rest.replace(/\/+$/, "");
  if (rest === "") rest = "/";

  var hit = ROUTES[m + " " + rest];
  if (hit) return { path: rest, handler: require(hit), methodAllowed: true };

  var wild = matchParam(m, rest);
  if (wild) return wild;

  var any = Object.keys(ROUTES).filter(function (k) {
    return k.split(" ")[1] === rest;
  })[0];
  if (any) return { path: rest, handler: require(ROUTES[any]), methodAllowed: false };

  return null;
}

function matchParam(method, rest) {
  var segs = rest.split("/");
  var keys = Object.keys(ROUTES).filter(function (k) {
    if (k.split(" ")[0] !== method) return false;
    var p = k.split(" ")[1].split("/");
    if (p.length !== segs.length) return false;
    return p.every(function (seg, i) { return seg.charAt(0) === ":" || seg === segs[i]; });
  })[0];
  if (!keys) return null;
  var names = keys.split(" ")[1].split("/");
  return {
    path: rest,
    handler: require(ROUTES[keys]),
    methodAllowed: true,
    params: function () {
      var out = {};
      names.forEach(function (seg, i) {
        if (seg.charAt(0) === ":") out[seg.slice(1)] = decodeURIComponent(segs[i]);
      });
      return out;
    }
  };
}

function list() {
  return Object.keys(ROUTES).map(function (k) {
    return k.split(" ")[1];
  });
}

module.exports = {
  ROUTES: ROUTES,
  PATHS: PATHS,
  PREFIX: PREFIX,
  list: list,
  resolve: resolve
};
