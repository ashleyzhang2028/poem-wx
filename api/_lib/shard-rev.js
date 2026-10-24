"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var zlib = require("zlib");

var HEAD = "module.exports = ";

var META = "__meta";

var cache = null;

function near(dir, back) {
  var candidate = path.join(dir, back, "shards");
  if (readable(path.join(candidate, "manifest.js")) || readable(path.join(candidate, "manifest.js.gz"))) return candidate;
  return "";
}

function dirOf() {
  if (process.env.SHARD_DIR) return process.env.SHARD_DIR;
  var here = __dirname;
  if (path.basename(here) !== "_lib") return near(here, "", 1) || path.join(here, "shards");
  var inside = near(here, "..", 1);
  if (inside) return inside;
  return path.join(here, "..", "..", "shards");
}

function readable(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (e) {
    return false;
  }
}

function plainOf(file) {
  var raw = readable(file + ".gz") ? fs.readFileSync(file + ".gz") : null;
  if (raw) zlib.gunzipSync(raw);
  return fs.readFileSync(file);
}

function revOf(texts) {
  var ids = Object.keys(texts || {}).sort();
  var h = crypto.createHash("sha1");
  ids.forEach(function (id) {
    h.update(id + "\u0000" + JSON.stringify(texts[id]) + "\u0001");
  });
  return h.digest("hex").slice(0, 12);
}

function first(file) {
  if (!readable(file)) return null;
  var src = String(plainOf(file));
  if (src.indexOf(HEAD) !== 0) return null;
  try {
    return JSON.parse(src.slice(HEAD.length).replace(/;\s*$/, ""));
  } catch (e) {
    return null;
  }
}

function load() {
  if (cache !== null) return cache;
  cache = { ready: false, rev: "", buckets: [], names: [], error: "" };
  var dir = dirOf();
  var meta = path.join(dir, "manifest.js");
  if (!readable(meta) && !readable(meta + ".gz")) {
    cache.error = "E_NO_SHARDS";
    return cache;
  }
  var body = first(meta);
  if (!body || !Array.isArray(body.buckets)) {
    cache.error = "E_BAD_SHARDS";
    return cache;
  }
  cache.ready = true;
  cache.rev = String(body.rev || "");
  cache.names = body.buckets.map(function (b) { return String((b && b.n) || ""); });
  cache.buckets = body.buckets;
  return cache;
}

function of(name) {
  var s = load();
  if (!s.ready) return null;
  if (String(name) === META) return { rev: s.rev, buckets: s.buckets };
  for (var i = 0; i < s.buckets.length; i++) {
    if (String((s.buckets[i] || {}).n || "") === String(name || "")) return s.buckets[i];
  }
  return null;
}

function rev() {
  return load().rev;
}

function ready() {
  return load().ready;
}

function error() {
  return load().error;
}

function names() {
  return load().names.slice();
}

module.exports = { rev: rev, ready: ready, error: error, names: names, of: of, revOf: revOf, dirOf: dirOf };
