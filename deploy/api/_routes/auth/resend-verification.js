"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("auth.resend-verification", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.resendVerification(d, {
    email: body.email,
    value: body.value,
    deviceId: body.deviceId || d.deviceId,

    turnstileToken: body.turnstileToken != null ? body.turnstileToken : body["cf-turnstile-response"],

    ip: d.ip
  });
});
