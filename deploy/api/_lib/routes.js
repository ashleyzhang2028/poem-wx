"use strict";

var ROUTES = {
  "POST /send-code": "./../_routes/send-code.js",
  "POST /verify-code": "./../_routes/verify-code.js",
  "GET /me": "./../_routes/me.js",
  "PATCH /me": "./../_routes/me-patch.js",

  "GET /config": "./../_routes/config.js",
  "GET /diag": "./../_routes/diag.js",
  "POST /sync/pull": "./../_routes/sync/pull.js",
  "POST /sync/push": "./../_routes/sync/push.js",
  "DELETE /account": "./../_routes/account.js",
  "POST /avatar": "./../_routes/avatar/index.js",
  "DELETE /avatar": "./../_routes/avatar/index.js",
  "GET /family": "./../_routes/family/index.js",
  "POST /family": "./../_routes/family/index.js",
  "POST /game/answer": "./../_routes/game/answer.js",
  "GET /exam/records": "./../_routes/exam/records.js",
  "POST /exam/records": "./../_routes/exam/records.js",
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

  var any = Object.keys(ROUTES).filter(function (k) {
    return k.split(" ")[1] === rest;
  })[0];
  if (any) return { path: rest, handler: require(ROUTES[any]), methodAllowed: false };

  return null;
}

module.exports = {
  ROUTES: ROUTES,
  PATHS: PATHS,
  PREFIX: PREFIX,
  resolve: resolve
};
