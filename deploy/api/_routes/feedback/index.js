"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("feedback", ["GET", "POST"], function (d, body, req) {
  var method = String((req && req.method) || "GET").toUpperCase();
  if (method === "GET") {
    return handler.core.feedbackMine(d, { deviceId: body.deviceId || d.deviceId });
  }
  var op = String(body.op || "create");
  if (op === "comment") {
    return handler.core.feedbackComment(d, { tid: body.tid, content: body.content, deviceId: body.deviceId || d.deviceId });
  }
  if (op === "delete") {
    return handler.core.feedbackDelete(d, { tid: body.tid, cid: body.cid, deviceId: body.deviceId || d.deviceId });
  }
  return handler.core.feedbackCreate(d, {
    kind: body.kind, content: body.content, deviceId: body.deviceId || d.deviceId
  });
});
