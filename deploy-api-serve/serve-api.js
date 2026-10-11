"use strict";

const http = require("http");

function wireMysqlStore() {
  const cfg = require("./api/_lib/config.js");

  const host = String(process.env.MYSQL_HOST || "").trim();
  if (!host) {
    console.log("[store] 没配 MYSQL_HOST —— 退回 poem 默认的存储层（内存档，重启即丢）");
    return false;
  }

  let mysql = null;
  try {
    mysql = require("mysql2/promise");
  } catch (e) {

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

  real._reset();

  const useMemory = () => origGetStore.call(real, cfg).kind === "memory";
  if (useMemory()) return false;

  console.log("[store] 存储层 = 腾讯云 MySQL " + host + ":" +
    Number(process.env.MYSQL_PORT || 3306) + "/" + (process.env.MYSQL_DATABASE || "poem"));
  return true;
}

wireMysqlStore();

const shardApi = require("./shard-api.js");

const apiHandler = require("./api/handler.js");

const PORT = Number(process.env.PORT) || 8080;

function createServer() {
  return http.createServer(function (req, res) {
    const urlPath = String(req.url || "/").split("?")[0].split("#")[0];

    if (urlPath === "/healthz" || urlPath.startsWith("/api/")) {

      if (urlPath === "/healthz") {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("ok\n");
        return;
      }

      if (shardApi.handle(req, res, urlPath)) return;

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
