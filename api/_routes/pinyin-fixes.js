"use strict";

var handler = require("../_lib/handler");

module.exports = handler.make("pinyin.fixes", ["GET"], function (d) {
  return Promise.resolve(handler.core.pinyinFixesPublic(d)).then(function (out) {
    out.headers = Object.assign({ "Cache-Control": "public, max-age=300" }, out.headers || {});
    return out;
  });
});
