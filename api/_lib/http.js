"use strict";

var SECRET_KEYS = /(^|_)(code|codes|token|tokens|secret|salt|hash|password|passwd|pass|pwd|sid|pepper|authorization|cookie|apikey|session|sessionkey|session_key|devcode|devtoken)(_|$)/i;
var EMAIL_KEYS = /(^|_)(email|mail|to)(_|$)/i;
var OK_KEYS = /^(api|at|event|status|status_code|statuscode|kind|reason|codes|uid|limit|bytes|declared|code|error|errcode|error_code|retry_after|retryafter|ms|name|elapsed)$/i;

function redact(value, depth) {
  depth = depth || 0;
  if (depth > 6) return "[deep]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(function (v) { return redact(v, depth + 1); });
  if (typeof value === "object") {
    var out = {};
    Object.keys(value).forEach(function (k) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") return;
      var hit = maskKey(k);
      out[k] = hit ? hit : redact(value[k], depth + 1);
    });
    return out;
  }
  return "[unknown]";
}

function snakeOf(k) {
  return String(k).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function maskKey(k) {
  if (OK_KEYS.test(snakeOf(k))) return "";
  if (SECRET_KEYS.test(snakeOf(k))) return "[redacted]";
  if (EMAIL_KEYS.test(snakeOf(k))) return "[email]";
  return "";
}

function log(event, detail) {

  try {
    console.log(JSON.stringify({ at: new Date().toISOString(), event: event, detail: redact(detail || {}) }));
  } catch (e) {
    console.log(JSON.stringify({ at: new Date().toISOString(), event: event, detail: "[unserializable]" }));
  }
}

function json(res, status, body, headers) {
  var h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (headers) Object.keys(headers).forEach(function (k) { h[k] = headers[k]; });
  res.statusCode = status;
  Object.keys(h).forEach(function (k) { res.setHeader(k, h[k]); });
  res.end(JSON.stringify(body));
}

function methodNotAllowed(res, allow) {
  json(res, 405, { code: "E_METHOD", message: "不支持的请求方式" }, { Allow: allow.join(", ") });
}

function drain(req) {
  try {
    if (req && typeof req.resume === "function") req.resume();
  } catch (e) {}
}

function readBody(req) {
  return new Promise(function (resolve) {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === "string") {
        try { return resolve(JSON.parse(req.body)); } catch (e) { return resolve(null); }
      }

      if (Buffer.isBuffer(req.body) || req.body instanceof Uint8Array) {
        var text0 = Buffer.from(req.body).toString("utf8");
        if (!text0) return resolve({});
        try { return resolve(JSON.parse(text0)); } catch (e) { return resolve(null); }
      }
      return resolve(req.body);
    }

    var chunks = [];
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      var text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch (e) { resolve(null); }
    }

    if (req.readableEnded === true || req.complete === true) {

      if (typeof req.read === "function") {
        try {
          var buf = req.read();
          if (buf) chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
          if (chunks.length) return finish();
        } catch (e) {}
      }
      return resolve({});
    }

    req.on("data", function (c) {
      if (done) return;
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      if (Buffer.concat(chunks).length > 64 * 1024) { done = true; drain(req); resolve(null); }
    });
    req.on("end", finish);
    req.on("error", function () { done = true; resolve(null); });
  });
}

function clientIp(req) {
  var h = req.headers || {};
  var xff = h["x-forwarded-for"] || h["x-real-ip"] || "";
  var first = String(xff).split(",")[0].trim();
  return first || "unknown";
}

function deviceId(req, body) {
  var v = (body && body.deviceId) || (req.headers && req.headers["x-kb-device"]) || "";
  v = String(v).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return v || "unknown";
}

function notConfigured(res, what) {
  log("api.not_configured", { what: what });
  json(res, 503, {
    code: "E_NOT_CONFIGURED",
    message: "服务端还没配置好（缺 " + what + "）。当前仍可完全离线使用本站。"
  });
}

function binary(res, status, body, headers) {
  var h = { "Cache-Control": "no-store" };
  if (headers) Object.keys(headers).forEach(function (k) { h[k] = headers[k]; });
  res.statusCode = status;
  Object.keys(h).forEach(function (k) { res.setHeader(k, h[k]); });
  res.end(body || Buffer.alloc(0));
}

module.exports = {
  json: json,
  binary: binary,
  log: log,
  drain: drain,
  redact: redact,
  readBody: readBody,
  clientIp: clientIp,
  deviceId: deviceId,
  methodNotAllowed: methodNotAllowed,
  notConfigured: notConfigured
};
