"use strict";

var OK_MIME = ["image/jpeg", "image/png"];

function safeUid(uid) {
  return String(uid || "").replace(/[^A-Za-z0-9_-]/g, "");
}

var MEMORY_BUDGET_BYTES = 64 * 1024 * 1024;

function memoryAvatar() {
  var objects = {};
  var total = 0;
  function evict() {
    var keys = Object.keys(objects);
    while (total > MEMORY_BUDGET_BYTES && keys.length) {
      var k = keys.shift();
      var o = objects[k];
      if (!o) continue;
      total -= o.bytes.length;
      delete objects[k];
    }
  }
  return {
    kind: "memory",
    ready: function () { return true; },
    _objects: objects,
    put: function (uid, mime, bytes) {
      var u = safeUid(uid);
      if (!u) return Promise.resolve({ ok: false, code: "E_NO_UID" });
      var old = objects[u];
      if (old) total -= old.bytes.length;
      total += bytes.length;
      objects[u] = { mime: mime, bytes: bytes, at: Date.now() };
      evict();
      return Promise.resolve({ ok: true, bytes: bytes.length });
    },
    get: function (uid) {
      var o = objects[safeUid(uid)];
      return Promise.resolve(o || null);
    },
    remove: function (uid) {
      var k = safeUid(uid);
      var old = objects[k];
      if (old) total -= old.bytes.length;
      delete objects[k];
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

function storedAvatar(store) {
  return {
    kind: "db",
    ready: function () { return true; },
    put: function (uid, mime, bytes) {
      var u = safeUid(uid);
      if (!u) return Promise.resolve({ ok: false, code: "E_NO_UID" });
      return Promise.resolve(store.putAvatar(u, mime, bytes))
        .then(function () { return { ok: true, bytes: bytes.length }; });
    },
    get: function (uid) {
      return Promise.resolve(store.getAvatar(safeUid(uid)))
        .then(function (row) {
          return row && row.bytes && row.bytes.length ? row : null;
        });
    },
    remove: function (uid) {
      return Promise.resolve(store.deleteAvatar(safeUid(uid)))
        .then(function () { return true; });
    }
  };
}

var singleton = null;

function getAvatarStore(cfg) {
  var c = cfg || require("./config");
  var store = require("./store").getStore(c);
  var kind = store && typeof store.putAvatar === "function" ? "db" : "memory";
  if (singleton && singleton._store === store && singleton._kind === kind) return singleton.impl;
  var impl = kind === "db" ? storedAvatar(store) : memoryAvatar();
  singleton = { _store: store, _kind: kind, impl: impl };
  return impl;
}

function resetAvatarStore() { singleton = null; }

function jpegEnds(buf) {
  return buf.length >= 4 && buf[buf.length - 2] === 0xFF && buf[buf.length - 1] === 0xD9;
}

function pngEnds(buf) {
  var at = buf.lastIndexOf(Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]));
  return at >= 8 && at <= buf.length - 8;
}

function sniffImage(buf) {
  if (!buf || !buf.length || buf.length < 4) return "";
  var b = buf;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return jpegEnds(b) ? "image/jpeg" : "";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
      b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return pngEnds(b) ? "image/png" : "";
  return "";
}

module.exports = {
  OK_MIME: OK_MIME,
  safeUid: safeUid,
  memoryAvatar: memoryAvatar,
  storedAvatar: storedAvatar,
  objectAvatar: objectAvatar,
  getAvatarStore: getAvatarStore,
  resetAvatarStore: resetAvatarStore,
  sniffImage: sniffImage
};
