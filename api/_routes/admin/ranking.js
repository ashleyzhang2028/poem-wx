"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("admin.ranking", ["GET", "POST"], function (d, body, req) {
  var method = String((req && req.method) || "GET").toUpperCase();
  if (method === "GET") return handler.core.adminRankingGet(d, { game: body.game });
  return handler.core.adminRankingSet(d, { game: body.game, on: body.on });
});
