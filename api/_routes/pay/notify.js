"use strict";

var handler = require("../../_lib/handler");
var pay = require("../../_lib/pay");

module.exports = handler.make("pay.notify", ["GET", "POST"], function (d, body, req) {
  var query = {};
  new URL(String((req && req.url) || "/"), "http://localhost").searchParams.forEach(function (v, k) { query[k] = v; });
  return pay.payNotify(d, { method: req.method, query: query, body: body });
});
