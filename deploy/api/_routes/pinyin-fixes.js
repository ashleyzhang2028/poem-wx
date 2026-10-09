"use strict";

var handler = require("../_lib/handler");

// Public and unauthenticated: guests need correct readings too. Only approved rows are ever exposed.
module.exports = handler.make("pinyin.fixes", ["GET"], function (d) {
  return Promise.resolve(handler.core.pinyinFixesPublic(d)).then(function (out) {
    out.headers = Object.assign({ "Cache-Control": "public, max-age=300" }, out.headers || {});
    return out;
  });
});
