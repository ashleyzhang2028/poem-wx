"use strict";

var handler = require("../../_lib/handler");
var pay = require("../../_lib/pay");

module.exports = handler.make("pay.confirm", ["POST"], function (d, body) {
  return pay.payConfirm(d, { outTradeNo: body.outTradeNo });
});
