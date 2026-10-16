"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const NAME_RE = /^t\d{3}$/;

const MANIFEST = "manifest";

const INDEX = "idx";

const SPECIAL = [MANIFEST, INDEX];

const ROOT = path.join(__dirname, "shards");

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
    return fs.readFileSync(file + ".gz");
  } catch (e) { }
  return fs.readFileSync(file);
}

function decode(raw) {
  const head = "module.exports = ";
  const src = String(raw);
  if (src.indexOf(head) !== 0) throw new Error("E_BAD_SHARD");
  if (src.indexOf(head) === src.lastIndexOf(head)) {
    try {
      return JSON.parse(src.slice(head.length).replace(/;\s*$/, ""));
    } catch (e) {
      throw new Error("E_BAD_SHARD");
    }
  }
  const sandbox = { module: { exports: {} } };
  const vm = require("vm");
  vm.runInNewContext(src, sandbox, { timeout: 5000 });
  return sandbox.module.exports;
}

function bodyOf(file) {
  const raw = gzipped(file);
  const plain = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;
  return Buffer.from(JSON.stringify(decode(plain)), "utf8");
}

function handle(req, res, urlPath) {
  if (urlPath.indexOf("/api/shard/") !== 0) return false;

  const name = urlPath.slice("/api/shard/".length).replace(/\/+$/, "");
  if (!fileOf(name)) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" })
      .end(JSON.stringify({ error: "E_BAD_SHARD", message: "分片名不合法" }));
    return true;
  }

  if (!dirReady()) {

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" })
      .end(JSON.stringify({
        error: "E_NO_SHARDS",
        message: "这个镜像里没有分片（构建时没给 COPY_SHREDS=1）"
      }));
    return true;
  }

  const file = fileOf(name);
  try {
    const body = bodyOf(file);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": body.length,

      "Cache-Control": "public, max-age=86400",
      "ETag": '"' + require("crypto").createHash("sha1").update(body).digest("hex").slice(0, 16) + '"'
    }).end(body);
  } catch (e) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" })
      .end(JSON.stringify({
        error: e && e.message === "E_BAD_SHARD" ? "E_BAD_SHARD" : "E_NO_SHARD",
        message: e && e.message === "E_BAD_SHARD"
          ? "这一片的形状不对（分片是 module.exports = {...} 的 .js）"
          : "没有这一片：" + name
      }));
  }
  return true;
}

module.exports = { handle, NAME_RE, ROOT };
