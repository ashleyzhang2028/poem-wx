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

function objectAvatar() {
  return {
    kind: "none",
    ready: function () { return false; },
    put: function () { return Promise.resolve({ ok: false, code: "E_NO_AVATAR_STORE" }); },
    get: function () { return Promise.resolve(null); },
    remove: function () { return Promise.resolve(true); }
  };
}

var singleton = null;

function getAvatarStore(cfg) {
  var c = cfg || require("./config");
  if (singleton && singleton._cfg === c) return singleton.impl;
  void c;
  var impl = memoryAvatar();
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
  objectAvatar: objectAvatar,
  getAvatarStore: getAvatarStore,
  resetAvatarStore: resetAvatarStore,
  sniffImage: sniffImage
};
