"use strict";

var OK_MIME = ["image/jpeg", "image/png"];

function safeUid(uid) {
  return String(uid || "").replace(/[^A-Za-z0-9_-]/g, "");
}

function memoryAvatar() {
  var objects = {};
  return {
    kind: "memory",
    ready: function () { return true; },
    _objects: objects,
    put: function (uid, mime, bytes) {
      var u = safeUid(uid);
      if (!u) return Promise.resolve({ ok: false, code: "E_NO_UID" });
      objects[u] = { mime: mime, bytes: bytes, at: Date.now() };
      return Promise.resolve({ ok: true, bytes: bytes.length });
    },
    get: function (uid) {
      var o = objects[safeUid(uid)];
      return Promise.resolve(o || null);
    },
    remove: function (uid) {
      delete objects[safeUid(uid)];
      return Promise.resolve(true);
    }
  };
}

function supabaseAvatar(cfg) {
  var base = String(cfg.supabaseUrl || "").replace(/\/+$/, "") + "/storage/v1/object";
  var KEY = cfg.supabaseServiceKey;
  var BUCKET = String(cfg.avatarBucket || "avatars");

  function put(uid, mime, bytes) {
    var path = cfg.avatarPath(uid);
    if (!path) return Promise.resolve({ ok: false, code: "E_NO_UID" });
    var buf = bytes;
    return fetch(base + "/" + BUCKET + "/" + path, {
      method: "POST",
      headers: {
        apikey: KEY,
        Authorization: "Bearer " + KEY,
        "Content-Type": mime,
        "x-upsert": "true",
        "Cache-Control": "max-age=31536000"
      },
      body: buf
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var code = r.status === 404 ? "E_NO_BUCKET" : "E_UPSTREAM";
          return { ok: false, code: code, status: r.status, detail: String(t).slice(0, 200) };
        });
      }
      return { ok: true, bytes: buf && buf.length ? buf.length : 0 };
    }).catch(function (e) {
      return { ok: false, code: "E_OFFLINE", detail: String(e && e.message || e).slice(0, 120) };
    });
  }

  return {
    kind: "supabase",
    ready: function () { return !!base && !!KEY && !!BUCKET; },
    put: put,
    get: function () { return Promise.resolve(null); },
    remove: function (uid) {
      var path = cfg.avatarPath(uid);
      if (!path) return Promise.resolve(false);
      return fetch(base + "/" + BUCKET + "/" + path, {
        method: "DELETE",
        headers: { apikey: KEY, Authorization: "Bearer " + KEY }
      }).then(function () { return true; }).catch(function () { return false; });
    }
  };
}

var singleton = null;

function getAvatarStore(cfg) {
  var c = cfg || require("./config");
  if (singleton && singleton._cfg === c) return singleton.impl;
  var impl = (c.hasAvatarStore && c.hasAvatarStore()) ? supabaseAvatar(c) : memoryAvatar();
  singleton = { _cfg: c, impl: impl };
  return impl;
}

function resetAvatarStore() { singleton = null; }

function sniffImage(buf) {
  if (!buf || !buf.length || buf.length < 8) return "";
  var b = buf;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
      b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return "image/png";
  return "";
}

module.exports = {
  OK_MIME: OK_MIME,
  safeUid: safeUid,
  memoryAvatar: memoryAvatar,
  supabaseAvatar: supabaseAvatar,
  getAvatarStore: getAvatarStore,
  resetAvatarStore: resetAvatarStore,
  sniffImage: sniffImage
};
