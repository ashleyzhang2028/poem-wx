"use strict";

var handler = require("../_lib/handler");

module.exports = handler.make("daily.poems", ["GET"], function (d, body, req) {
  var query = {};
  new URL(String((req && req.url) || "/"), "http://localhost").searchParams.forEach(function (v, k) { query[k] = v; });
  return Promise.resolve(handler.core.dailyPoemPublic(d, query)).then(function (out) {
    if (out.status === 200) out.headers = { "Cache-Control": "public, max-age=300" };
    return out;
  });
});
