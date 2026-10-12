"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("family", ["GET", "POST"], function (d, body, req) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  if (String((req && req.method) || "GET").toUpperCase() === "POST") {
    return handler.core.familyPut(d, { family: body.family, deviceId: body.deviceId || d.deviceId });
  }
  return handler.core.familyGet(d);
});
