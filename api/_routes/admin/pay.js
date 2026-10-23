"use strict";

var handler = require("../../_lib/handler");
var pay = require("../../_lib/pay");

module.exports = handler.make("admin.pay", ["POST"], function (d, body) {
  return pay.payAdmin(d, { op: body.op, catalog: body.catalog, status: body.status, uid: body.uid, limit: body.limit });
});
