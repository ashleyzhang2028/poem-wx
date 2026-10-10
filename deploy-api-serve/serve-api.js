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

/* ---------------------------------------------------------------------------
 * 换存储层：把 MySQL 那个实现接到 poem 的 `getStore()` 上（Issue #111）。
 *
 * 为什么接在这儿，而不是改 poem 的 store.js：
 *
 *   · `poem` 是**网页版 + 小程序共用**的后端，它跑在 Vercel 上、用那份
 *     Postgres。小程序这份镜像只是同一套 `api/` 的另一个部署 —— 两边的
 *     数据库选择本来就该分开。
 *   · 所以「小程序的库是腾讯云 MySQL」这件事，落在**这个部署件**里：
 *     `serve-api.js` 是这份镜像的入口，它比 poem 的 handler 先跑。
 *     在这里把 `store.getStore()` 换掉，poem 那边一行都不用动。
 *
 * 接法（一句话）：poem 的 `store.js` 导出了 `getStore`，而它是模块级单例。
 * 这里在 require handler **之前**把它替换成「认 MYSQL_* 就用 MySQL，
 * 否则退回原样」。所以下面 requrie 的顺序不能动。
 *
 * ⚠️ 没配 `MYSQL_HOST` 时**不接**：保持 poem 原样（内存档）——
 *    「配一半」最难查，宁可如实退回一个自检也在跑的实现。
 * ------------------------------------------------------------------------- */
function wireMysqlStore() {
  const cfg = require("./api/_lib/config.js");

  // `hasDb()` 是 poem 里「有没有可用存储」那个判据。这里给它加一条 MySQL 分支，
  // 不覆盖它的原义（那份 Postgres 的判据网页版还要用）。
  const host = String(process.env.MYSQL_HOST || "").trim();
  if (!host) {
    console.log("[store] 没配 MYSQL_HOST —— 退回 poem 默认的存储层（内存档，重启即丢）");
    return false;
  }

  let mysql = null;
  try {
    mysql = require("mysql2/promise");
  } catch (e) {
    // 镜像里没装 mysql2 时**出声**，不静默退回内存档 ——
    // 静默退回的样子是「能登录、能同步，但一重启全没了」，最难查的那一类。
    console.error("[store] 配了 MYSQL_HOST 但镜像里没有 mysql2 —— 数据不会被保存！" +
      "（构建时 npm i mysql2，见 deploy/Dockerfile）", e && e.message);
    return false;
  }

  const pool = mysql.createPool({
    host: host,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "poem",
    waitForConnections: true,
    connectionLimit: 8,
    // ⚠️ 这两个是**必须**的：驱动默认把超过 2^53 的整数转成字符串，
    //    而这里的时间戳是 Date.now() 毫秒。见 deploy/store-mysql.js 头上第三条。
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: true
  });
  cfg.mysql = pool;

  const { mysqlStore } = require("./store-mysql.js");
  const real = require("./api/_lib/store.js");

  const origGetStore = real.getStore;
  real.getStore = function (c) {
    if (c) c.mysql = pool;
    return mysqlStore(c || cfg);
  };
  // 换完之后要把 poem 已经建好的单例清掉 —— 它可能在 require handler 时
  // 就被建成了内存档，而那个单例是模块级的，不清就一直用旧的。
  real._reset();

  const useMemory = () => origGetStore.call(real, cfg).kind === "memory";
  if (useMemory()) return false;

  console.log("[store] 存储层 = 腾讯云 MySQL " + host + ":" +
    Number(process.env.MYSQL_PORT || 3306) + "/" + (process.env.MYSQL_DATABASE || "poem"));
  return true;
}

wireMysqlStore();

// 只做一件事：把 /api/* 交给 poem 那套 Vercel 风格 handler。
// 其余路径由下面如实回 404 —— 这份进程没有静态站可伺服。
// ⚠️ 这一行必须在上面的 wireMysqlStore() **之后** —— 它在 require 时就取单例。
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
