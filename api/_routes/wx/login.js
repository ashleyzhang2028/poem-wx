"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("wx.login", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.wxLogin(d, {
    code: body.code,
    device: body.device || body.deviceId,
    ip: d.ip
  }).then(function (r) {
    return handler.settleSession(d, r);
  });
});
