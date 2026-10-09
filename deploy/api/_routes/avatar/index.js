"use strict";

var handler = require("../../_lib/handler");
var H = require("../../_lib/http");
var avatarStore = require("../../_lib/avatar-store");

function byteLength(buf) { return buf && buf.length ? buf.length : 0; }

function readBytes(req, limit) {
  return new Promise(function (resolve) {
    if (req.body !== undefined && req.body !== null && typeof req.body !== "string") {

      if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(req.body)) {
        return resolve(req.body);
      }
      if (req.body instanceof Uint8Array) return resolve(Buffer.from(req.body));
    }
    var chunks = [];
    var total = 0;
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    }
    req.on("data", function (c) {
      chunks.push(c);
      total += c.length;
      if (total > limit) { done = true; resolve(null); }
    });
    req.on("end", finish);
    req.on("error", function () { done = true; resolve(null); });
  });
}

module.exports = handler.make("avatar", ["POST", "DELETE"], function (d, body, req) {
  var store = avatarStore.getAvatarStore(d.cfg);
  var method = String((req && req.method) || "POST").toUpperCase();

  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好。当前仍可完全离线使用本站。" } };
  }
  if (!d.account) {
    return { status: 401, body: { code: "E_NO_SESSION", message: "请先登录再换头像" } };
  }

  var uid = d.account.uid;
  var t = d.now();
  var key = "avatar:" + String(d.deviceId || "unknown");
  var g = d.limiter.check(d.cfg, "device", key, t);
  if (!g.ok) {
    return { status: 429, body: { code: "E_RATE_DEVICE", message: "换头像太频繁了，请稍后再试", retryAfter: g.retryAfter } };
  }

  if (method === "DELETE") {
    d.limiter.hit("device", key, t);
    return Promise.resolve(store.remove(uid)).then(function () {
      return { status: 200, body: { deleted: true, url: "" } };
    });
  }

  var maxBytes = Number(d.cfg.avatarMaxBytes) > 0 ? Number(d.cfg.avatarMaxBytes) : 1024 * 1024;
  return readBytes(req, maxBytes).then(function (buf) {
    if (buf === null || byteLength(buf) > maxBytes) {
      H.log("avatar.too_big", { uid: uid, limit: maxBytes });
      return { status: 400, body: { code: "E_TOO_BIG", message: "图片太大了（请选 1MB 以内的）" } };
    }
    if (!buf.length) {
      return { status: 400, body: { code: "E_NO_BODY", message: "没有收到图片数据" } };
    }

    var mime = avatarStore.sniffImage(buf);
    if (!mime) {
      H.log("avatar.bad_type", { uid: uid, declared: String((req.headers || {})["content-type"] || "") });
      return { status: 400, body: { code: "E_TYPE", message: "只支持 PNG / JPG 图片" } };
    }
    d.limiter.hit("device", key, t);
    return Promise.resolve(store.put(uid, mime, buf)).then(function (r) {
      if (!r || !r.ok) {

        var code = (r && r.code) || "E_UPSTREAM";
        H.log("avatar.put_failed", { uid: uid, code: code, status: r && r.status });
        var status = (code === "E_OFFLINE" || code === "E_NO_BUCKET") ? 503 : 502;
        var msg = code === "E_NO_BUCKET"
          ? "存储桶还没建好（在 Supabase 控制台建一个名为 " + d.cfg.avatarBucket + " 的 public bucket）"
          : "头像没能传上去，请稍后再试";
        return { status: status, body: { code: code, message: msg } };
      }
      var url = d.cfg.avatarPublicUrl(uid);
      H.log("avatar.put", { uid: uid });
      return {
        status: 200,
        body: {

          url: url + "?v=" + t,
          bytes: byteLength(buf),
          note: "头像已保存到服务器。本机那份副本仍保留，断网时照旧显示。"
        }
      };
    });
  });
}, { rawBody: true });
