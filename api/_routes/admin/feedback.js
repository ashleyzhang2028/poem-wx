"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("admin.feedback", ["POST"], function (d, body) {
  if (d.cfg && !d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  var op = String(body.op || "list");
  if (op === "reply") {
    return handler.core.adminFeedbackReply(d, { tid: body.tid, content: body.content, status: body.status });
  }
  if (op === "status") {
    return handler.core.adminFeedbackStatus(d, { tid: body.tid, status: body.status });
  }
  if (op === "deleteThread") {
    return handler.core.adminFeedbackDeleteThread(d, { tid: body.tid });
  }
  if (op === "deleteComment") {
    return handler.core.adminFeedbackDeleteComment(d, { cid: body.cid });
  }
  return handler.core.adminFeedbackList(d, { status: body.status, limit: body.limit });
});
