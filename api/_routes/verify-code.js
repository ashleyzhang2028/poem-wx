"use strict";

var handler = require("../_lib/handler");
var session = require("../_lib/session");

module.exports = handler.make("verify-code", ["POST"], function (d, body, req) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.verifyCode(d, {
    codeId: body.codeId,
    code: body.code,
    deviceId: body.deviceId || d.deviceId,

    ip: d.ip
  }).then(function (r) {

    if (r.status !== 200 || !r._session) return r;
    var token = session.fromCookieHeader((req.headers || {}).cookie, d.cfg.cookieName);
    var old = session.read(d.cfg, token, Date.now());
    var renew = !old || session.shouldRenew(d.cfg, old, Date.now());
    var out = { status: r.status, body: r.body };
    if (renew) out.cookies = r.cookies;
    else out.body = Object.assign({}, r.body, { sessionKept: true });
    return out;
  });
});
