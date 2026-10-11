/**
 * 静态分片路由 —— 把 `data/texts/*.json` 从云托管容器里发出去（Issue #121 方案 A）。
 *
 * 为什么要有这一份：正文分片有 25MB，主包只有 2MB 塞不下，而走 CDN 又要备案
 * （downloadFile 合法域名只收已备案的域，微信那份名单没有例外）。云调用走微信
 * 内网、不过那张名单，所以「分片跟主包一起走云托管容器下发」是唯一一条
 * 既不用备案、又不用 CDN 的路。
 *
 * 落点：本模块由 `serve-api.js` 挂到 `/api/shard/*`，**不占用** poem 自己的
 * `/api/` 命名空间 —— 它只加一条前缀，poem 那边一行都不用动。
 *
 * 两件事它自己扛：
 *   1. `name` 只许 `t\d{3}`，逐字校验之后再拼路径 —— 不接受任何带 `..`／`/` 的输入；
 *   2. 命中就 `Content-Encoding: gzip` 发预压缩字节（压缩后是原文的 22.5%），
 *      镜像里没预压缩的就现场压一次并落盘，下次直接发。
 *
 * ⚠️ **分片默认不进镜像**：构建时给了 `COPY_SHREDS=1` 才有（见
 *    `deploy/Dockerfile` 与 `docs/shard-delivery.md` § 成本）。没有时回 404
 *    `E_NO_SHARDS` + 一句人话，**不静默回空 body** —— 让小程序端能把
 *    「分片服务没开」与「这一片取不到」分开，不在用户手机上缓存一份空语料。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/** 只认分片名这一种形状：t + 三位数字。别的一律当路径攻击挡掉。 */
const NAME_RE = /^t\d{3}$/;
/** 清单：`bucketOf(id)` 全靠它，与分片同等重要（缺了分片就是取不到的） */
const MANIFEST = "manifest";
/** 全文倒排索引：搜索走它，2MB 但压缩后 512KB */
const INDEX = "idx";
/** 只这三种名字合法 —— 别的一律当路径攻击挡掉（`NAME_RE` 之外单列两个常量名） */
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

/** 预压缩那份在旁边（.gz）；没有就现场压一次并落盘 —— 同一片只压一次。 */
function gzipped(file) {
  const gz = file + ".gz";
  try {
    return fs.readFileSync(gz);
  } catch (e) { /* 还没压过 */ }
  const plain = fs.readFileSync(file);
  const out = zlib.gzipSync(plain, { level: 9 });
  try {
    fs.writeFileSync(gz, out);
  } catch (e) {
    /* 容器 rootfs 只读或空间不足都无所谓：压过的那份留在内存里发出去就行 */
  }
  return out;
}

/**
 * @returns {boolean} 这条请求归不归它管（true = 已经应答完了）
 */
function handle(req, res, urlPath) {
  if (urlPath.indexOf("/api/shard/") !== 0) return false;

  const name = urlPath.slice("/api/shard/".length).replace(/\/+$/, "");
  if (!fileOf(name)) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" })
      .end(JSON.stringify({ error: "E_BAD_SHARD", message: "分片名不合法" }));
    return true;
  }

  if (!dirReady()) {
    /* 镜像里没拷分片 —— **出声**，别静默回空。
       小程序端把这个 404 翻译成「分片服务没开」，与「取不到这一片」分开。 */
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
      /* 分片内容不变（同一条永远落同一个桶），但要允许缓存被换掉：
         重新构建一次语料，同一片的内容就可能变，所以给一个短 max-age + etag。 */
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
