"use strict";

var routes = require("./_lib/routes.js");
var H = require("./_lib/http.js");

function routeUrl(rawUrl) {
  var parsed;
  try {
    parsed = new URL(String(rawUrl || "/"), "http://localhost");
  } catch (e) {
    return String(rawUrl || "/");
  }

  var path = parsed.searchParams.get("__path");
  if (path === null) return parsed.pathname + parsed.search;

  parsed.searchParams.delete("__path");
  var query = parsed.searchParams.toString();
  return "/api/" + String(path).replace(/^\/+/, "") + (query ? "?" + query : "");
}

module.exports = function (req, res) {
  var hit = routes.resolve(req.method, routeUrl(req.url));
  if (!hit) {
    return H.json(res, 404, { code: "E_404", message: "没有这个接口。" });
  }
  return hit.handler(req, res);
};

module.exports.routeUrl = routeUrl;
