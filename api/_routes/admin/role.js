"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("admin.role", ["POST"], function (d, body) {
  if (d.cfg && !d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.adminSetRole(d, {
    uid: body.uid,
    role: body.role,
    deviceId: body.deviceId || d.deviceId
  });
});
