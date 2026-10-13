"use strict";

var routes = require("../_lib/routes");

module.exports = function (req, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end("ok " + routes.list().join(" ") + "\n");
};
