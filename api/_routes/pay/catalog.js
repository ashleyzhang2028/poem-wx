"use strict";

var handler = require("../../_lib/handler");
var pay = require("../../_lib/pay");

module.exports = handler.make("pay.catalog", ["GET"], function (d) {
  return pay.payCatalog(d);
});
