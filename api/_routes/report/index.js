"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("report", ["GET", "POST"], function (d, body, req) {
  var method = String((req && req.method) || "GET").toUpperCase();
  if (method === "GET") {
    return handler.core.reportMine(d, { limit: body.limit });
  }
  return handler.core.reportCreate(d, {
    kind: body.kind,
    poemId: body.poemId,
    poemTitle: body.poemTitle,
    book: body.book,
    quote: body.quote,
    context: body.context,
    note: body.note,
    suggestion: body.suggestion,
    ua: body.ua,
    deviceId: body.deviceId || d.deviceId
  });
});
