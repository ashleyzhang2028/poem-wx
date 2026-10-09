#!/usr/bin/env node
/**
 * 只跑 `/api/*` 的服务壳 —— 与 poem 的 `scripts/serve.js` 只差一件事：
 * **不伺服静态站**。
 *
 * 为什么要有这一份：云托管上要跑的是小程序的后端，不是整个网页版。
 * `poem` 的 `serve.js` 把 `index.html` / `js/` / `css/` / 各个页面目录一起伺服，
 * 那些是给浏览器的，云托管容器里一份都不需要（网页版照旧跑在 Vercel 上）。
 * 于是这里只留一条 `/api/` 分支 —— 其余一律 404，**不静默 fallback 到静态文件**：
 * 一个「看着有内容」的空壳比一个 404 更难查。
 *
 * ⚠️ 它**不放在 `poem` 仓库里**，因为 `poem` 那边要跑的是「一个进程跑全」
 * （`scripts/serve.js`，静态站 + API），而这一份是给云托管瘦身用的部署件。
 * 构建时由 `deploy/build.sh` 拷进上下文 —— 见 `deploy/README.md`。
 */
"use strict";

const http = require("http");

// 只做一件事：把 /api/* 交给 poem 那套 Vercel 风格 handler。
// 其余路径由下面如实回 404 —— 这份进程没有静态站可伺服。
const apiHandler = require("./api/handler.js");

const PORT = Number(process.env.PORT) || 8080;

function createServer() {
  return http.createServer(function (req, res) {
    const urlPath = String(req.url || "/").split("?")[0].split("#")[0];

    if (urlPath === "/healthz" || urlPath.startsWith("/api/")) {
      // /healthz 与 /api/diag 是同一个判据的两种写法：**不拿状态码判健康**。
      // 本站设计成「密钥没配也能离线用」——缺 SESSION_SECRET 时 /api/* 回 503，
      // 但进程是好的。健康检查只判「进程还在不在应答」。
      if (urlPath === "/healthz") {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("ok\n");
        return;
      }
      apiHandler(req, res);
      return;
    }

    res
      .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      .end("404 Not Found —— 这个容器只跑 /api/*，网页版在别处。\n");
  });
}

if (require.main === module) {
  createServer().listen(PORT, function () {
    console.log("poem-api（只有 /api/*）已启动：http://localhost:" + PORT);
  });
}

module.exports = { createServer };
