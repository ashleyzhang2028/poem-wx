"use strict";

var handler = require("../../_lib/handler");
var session = require("../../_lib/session");

module.exports = handler.make("auth.logout", ["POST"], function (d) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }

  var clear = { status: 200, body: { ok: true, signedOut: true }, cookies: [session.clearCookieHeader(d.cfg)] };
  if (!d.account) return clear;

  return Promise.resolve(d.store.revokeSession
    ? d.store.revokeSession(d.account.sid)
    : d.store.revokeSessions(d.account.uid)).then(function () {
    return {
      status: 200,
      body: { ok: true, signedOut: true, note: "本机进度不受影响。" },
      cookies: [session.clearCookieHeader(d.cfg)]
    };
  })["catch"](function () {
        return clear;
  });
});
