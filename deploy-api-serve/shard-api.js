"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");

const NAME_RE = /^t\d{3}$/;

const MANIFEST = "manifest";

const SPECIAL = [MANIFEST];

const ROOT = path.join(__dirname, "shards");

const HEAD = "module.exports = ";

const index = {};

function dirReady() {
  try {
    return fs.statSync(ROOT).isDirectory();
  } catch (e) {
    return false;
  }
}

function fileOf(name) {
  if (!NAME_RE.test(name) && SPECIAL.indexOf(name) < 0) return null;
  return path.join(ROOT, name + ".js");
}

function gzipped(file) {
  try {
    const gz = path.join(ROOT, path.basename(file, ".js") + ".js.gz");
    return fs.readFileSync(gz);
  } catch (e) { }
  return fs.readFileSync(file);
}

function decode(raw) {
  const src = String(raw);
  if (src.indexOf(HEAD) !== 0) throw new Error("E_BAD_SHARD");
  if (src.indexOf(HEAD) === src.lastIndexOf(HEAD)) {
    try {
      return JSON.parse(src.slice(HEAD.length).replace(/;\s*$/, ""));
    } catch (e) {
      throw new Error("E_BAD_SHARD");
    }
  }
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(src, sandbox, { timeout: 5000 });
  return sandbox.module.exports;
}

function entryOf(name) {
  if (index[name]) return index[name];
  const raw = gzipped(fileOf(name));
  const gz = raw[0] === 0x1f && raw[1] === 0x8b;
  const plain = gz ? zlib.gunzipSync(raw) : raw;
  const item = {
    gz: gz ? raw : null,
    body: Buffer.from(JSON.stringify(decode(plain)), "utf8"),
    etag: '"' + crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16) + '"'
  };
  index[name] = item;
  return item;
}

function payloadOf(item) {
  if (!item.gz) item.gz = zlib.gzipSync(item.body, { level: 9 });
  return item.gz;
}

function notModified(req, etag) {
  const raw = String((req && req.headers && req.headers["if-none-match"]) || "");
  if (!raw) return false;
  return raw.split(",").some((t) => t.trim() === etag || t.trim() === "*");
}

function send(res, status, headers, body) {
  res.writeHead(status, headers).end(body);
}

function handle(req, res, urlPath) {
  if (urlPath.indexOf("/api/shard/") !== 0) return false;

  const name = urlPath.slice("/api/shard/".length).replace(/\/+$/, "");
  if (!fileOf(name)) {
    send(res, 400, { "Content-Type": "application/json; charset=utf-8" },
      JSON.stringify({ error: "E_BAD_SHARD", message: "分片名不合法" }));
    return true;
  }

  if (!dirReady()) {
    send(res, 404, { "Content-Type": "application/json; charset=utf-8" },
      JSON.stringify({
        error: "E_NO_SHARDS",
        message: "这个镜像里没有分片（构建时没给 COPY_SHREDS=1）"
      }));
    return true;
  }

  try {
    const item = entryOf(name);
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
      "ETag": item.etag,
      "Vary": "Accept-Encoding"
    };
    if (notModified(req, item.etag)) {
      send(res, 304, headers, "");
      return true;
    }
    const payload = payloadOf(item);
    headers["Content-Encoding"] = "gzip";
    headers["Content-Length"] = payload.length;
    send(res, 200, headers, payload);
  } catch (e) {
    const bad = e && e.message === "E_BAD_SHARD";
    send(res, bad ? 500 : 404, { "Content-Type": "application/json; charset=utf-8" },
      JSON.stringify({
        error: bad ? "E_BAD_SHARD" : "E_NO_SHARD",
        message: bad
          ? "这一片的形状不对（分片是 module.exports = {...} 的 .js）"
          : "没有这一片：" + name
      }));
  }
  return true;
}

function warm() {
  if (!dirReady()) return 0;
  const names = [];
  for (const f of fs.readdirSync(ROOT)) {
    const name = f.replace(/\.js(\.gz)?$/, "");
    if (fileOf(name) && names.indexOf(name) < 0) names.push(name);
  }
  setImmediate(() => {
    for (const name of names) {
      if (index[name]) continue;
      try { entryOf(name); } catch (e) { }
    }
  });
  return names.length;
}

module.exports = { handle, warm, NAME_RE, ROOT };
