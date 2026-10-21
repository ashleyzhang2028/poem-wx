"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("admin.ranking", ["GET", "POST"], function (d, body, req) {
  var method = String((req && req.method) || "GET").toUpperCase();
  var query = String((req && req.url) || "").split("?")[1] || "";
  var asked = new URLSearchParams(query).get("game");
  if (method === "GET") return handler.core.adminRankingGet(d, { game: body.game || asked });
  return handler.core.adminRankingSet(d, { game: body.game, on: body.on });
});
