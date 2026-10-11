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
  return path.join(ROOT, name + ".json");
}

function gzipped(file) {
  const gz = file + ".gz";
  try {
    return fs.readFileSync(gz);
  } catch (e) { }
  const plain = fs.readFileSync(file);
  const out = zlib.gzipSync(plain, { level: 9 });
  try {
    fs.writeFileSync(gz, out);
  } catch (e) {

  }
  return out;
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
    const body = gzipped(file);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "gzip",
      "Content-Length": body.length,

      "Cache-Control": "public, max-age=86400",
      "ETag": '"' + require("crypto").createHash("sha1").update(body).digest("hex").slice(0, 16) + '"'
    }).end(body);
  } catch (e) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" })
      .end(JSON.stringify({ error: "E_NO_SHARD", message: "没有这一片：" + name }));
  }
  return true;
}

module.exports = { handle, NAME_RE, ROOT };
