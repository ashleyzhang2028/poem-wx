"use strict";

var handler = require("../../_lib/handler");
var pay = require("../../_lib/pay");

module.exports = handler.make("pay.order", ["POST"], function (d, body) {
  return pay.payOrder(d, { plan: body.plan, period: body.period, code: body.code });
});
