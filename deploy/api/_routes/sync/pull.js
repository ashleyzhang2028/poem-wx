"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("sync.pull", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.syncPull(d, {
    since: body.since,
    deviceId: body.deviceId || d.deviceId,

    child: body.child
  });
});
