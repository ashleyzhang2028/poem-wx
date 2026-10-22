"use strict";

var handler = require("../../_lib/handler");
var avatarStore = require("../../_lib/avatar-store");
var crypto = require("crypto");

var CACHE = "public, max-age=86400";

module.exports = handler.make("avatar-file", ["GET"], function (d) {
  var uid = avatarStore.safeUid(d.params && d.params.uid);
  if (!uid) {
    return { status: 400, body: { code: "E_BAD_UID", message: "头像地址不合法" } };
  }
  return Promise.resolve(avatarStore.getAvatarStore(d.cfg).get(uid)).then(function (row) {
    if (!row || !row.bytes || !row.bytes.length) {
      return { status: 404, body: { code: "E_NO_AVATAR", message: "这个账号还没有头像" } };
    }
    var etag = '"' + crypto.createHash("sha1").update(row.bytes).digest("hex").slice(0, 16) + '"';
    return {
      status: 200,
      headers: { ETag: etag, "Cache-Control": CACHE },
      raw: { mime: row.mime || "application/octet-stream", bytes: row.bytes, etag: etag }
    };
  });
}, { rawBody: true });
