"use strict";

var handler = require("../_lib/handler");
var corpus = require("../_lib/corpus");

module.exports = handler.make("corpus", ["GET"], function (d, body, req) {
  var query = {};
  new URL(String((req && req.url) || "/"), "http://localhost").searchParams.forEach(function (v, k) { query[k] = v; });
  return corpus.corpusPublic(d, String((d.params && d.params.part) || ""), query).then(function (out) {
    if (out.status === 200) out.headers = { "Cache-Control": "public, max-age=300" };
    return out;
  });
});
