"use strict";

var handler = require("../../_lib/handler");
var pay = require("../../_lib/pay");

module.exports = handler.make("pay.orders", ["GET"], function (d, body, req) {
  var limit = new URL(String((req && req.url) || "/"), "http://localhost").searchParams.get("limit");
  return pay.payOrdersMine(d, { limit: limit });
});
