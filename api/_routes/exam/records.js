"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("exam.records", ["GET", "POST"], function (d, body, req) {
  var method = String((req && req.method) || "GET").toUpperCase();
  if (method === "GET") {
    return handler.core.examRecordsMine(d, { limit: body.limit });
  }
  var op = String(body.op || "create");
  if (op === "delete") {
    return handler.core.examRecordDelete(d, { eid: body.eid });
  }
  return handler.core.examRecordCreate(d, {
    scopeId: body.scopeId, scopeLabel: body.scopeLabel,
    size: body.size, score: body.score, total: body.total,
    durationSec: body.durationSec, items: body.items
  });
});
