"use strict";

var handler = require("../../_lib/handler");

var ADMIN_OPS = ["list", "thread", "reply", "status"];

module.exports = handler.make("admin.feedback", ["POST"], function (d, body) {
  if (d.cfg && !d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  var op = String(body.op || "list");
  if (ADMIN_OPS.indexOf(op) < 0) {
    return { status: 400, body: { code: "E_BAD_OP", message: "op 只认 " + ADMIN_OPS.join(" / ") } };
  }
  if (op === "thread") {
    return handler.core.adminFeedbackGet(d, { tid: body.tid });
  }
  if (op === "reply") {
    return handler.core.adminFeedbackReply(d, {
      tid: body.tid, content: body.content, status: body.status, resolution: body.resolution
    });
  }
  if (op === "status") {
    return handler.core.adminFeedbackStatus(d, { tid: body.tid, status: body.status, resolution: body.resolution });
  }
  return handler.core.adminFeedbackList(d, { status: body.status, limit: body.limit });
});
