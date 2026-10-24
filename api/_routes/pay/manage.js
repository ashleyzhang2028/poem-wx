"use strict";

var handler = require("../../_lib/handler");
var pay = require("../../_lib/pay");

module.exports = handler.make("pay.manage", ["POST"], function (d, body) {
  return pay.payManage(d, { op: body.op, outTradeNo: body.outTradeNo, code: body.code });
});
