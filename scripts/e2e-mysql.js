#!/usr/bin/env node
/**
 * 端到端：**存储层换到腾讯云 MySQL 之后，整条链还通不通**（Issue #111）。
 *
 * 这一条与 `e2e-wx-sync.js` 的分工：
 *
 *   e2e-wx-sync.js   跑的是 poem 原本的存储层（内存档）——
 *                    验的是「小程序端 utils ↔ poem 服务端」那条链的**报文**。
 *   这一条           跑的是**接上 MySQL 之后**那条链 ——
 *                    验的是「接线接对了没有」，以及那条**不能等价改写**的条件
 *                    upsert 换库之后语义还在不在。
 *
 * 怎么在没有真 MySQL 的机器上验：装一个**只认这几条语句形状**的内存替身
 * （`scripts/mysql-facade.js`），把它当 `mysql2/promise` 喂进 `serve-api.js`。
 * 替身不验 SQL 语法，验的是三件事：
 *
 *   ① 接线真的生效了（`getStore()` 回的是 `kind: "mysql"`，不是内存档）
 *   ② 登录 → 同步整条链**走在 mysqlStore 上**（假 MySQL 里真的落了行）
 *   ③ **「新的赢」这条不变式换库之后还在** —— 旧的补发不覆盖、新的赢、
 *      增量按 since 过滤、删除标记跟着 updated_at 走
 *
 * ③ 是这个脚本存在的全部理由：它是唯一一条**行为层**的判据。
 * `check.js` 的 V49 验的是那句 SQL 的**形状**（`IF(VALUES(updated_at) …`），
 * 而形状对、语义错是可能的（把 `>=` 写成 `>`、把 GREATEST 写成 VALUES）。
 *
 * 读不到 poem 时如实说一句然后退出 0，不假装跑过。不动网络、不落盘。
 *
 *   POEM_DIR=/tmp/poem node scripts/e2e-mysql.js
 */
"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const REPO = path.join(__dirname, "..");
const POEM = process.env.POEM_DIR || "/tmp/poem";

if (!fs.existsSync(path.join(POEM, "api", "handler.js"))) {
  console.log("· 读不到 poem（" + POEM + "）—— MySQL 那条端到端跳过。");
  console.log("  跑它：POEM_DIR=/tmp/poem node scripts/e2e-mysql.js（那边 git clone 一份）");
  process.exit(0);
}

/* ---------------------------------------------------------------------------
 * 摊一个「构建上下文」出来：poem 的 api/ + 本仓库那两样。
 * 与 `.cnb.yml` 的 stage context 是同一件事 —— 这样这一条验的才是
 * **线上那份容器**的启动路径（serve-api.js 接线 → require handler），
 * 而不是「把 store-mysql.js require 进来直接调」。
 * ------------------------------------------------------------------------- */
const CTX = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-mysql-"));
fs.cpSync(path.join(POEM, "api"), path.join(CTX, "api"), { recursive: true });
fs.copyFileSync(path.join(REPO, "deploy-api-serve", "serve-api.js"), path.join(CTX, "serve-api.js"));
fs.copyFileSync(path.join(REPO, "deploy", "store-mysql.js"), path.join(CTX, "store-mysql.js"));
/* ⚠️ 分片路由那份也要摆进来（Issue #121 方案 A）：`serve-api.js` 现在 require
   它，漏了这一行，这一条 e2e 会以 `Cannot find module './shard-api.js'` 当场
   炸掉 —— 而炸的位置是服务壳的 require 链，看着像 e2e 坏了、不像「上下文少摊了一样」。
   与 `.cnb.yml` 的 stage context 那两步逐行对应：那边也拷了这两个文件。 */
fs.copyFileSync(path.join(REPO, "deploy-api-serve", "shard-api.js"), path.join(CTX, "shard-api.js"));

// 把那个内存替身摆成 `mysql2/promise` —— `serve-api.js` 就是 require 这个名字的
fs.mkdirSync(path.join(CTX, "node_modules", "mysql2"), { recursive: true });
fs.copyFileSync(path.join(__dirname, "mysql-facade.js"), path.join(CTX, "node_modules", "mysql2", "promise.js"));
fs.writeFileSync(path.join(CTX, "node_modules", "mysql2", "package.json"),
  JSON.stringify({ name: "mysql2", version: "0.0.0-probe", main: "promise.js" }));

process.env.MYSQL_HOST = "10.0.0.5";
process.env.MYSQL_PORT = "3306";
process.env.MYSQL_USER = "poem";
process.env.MYSQL_DATABASE = "poem";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "e2e-mysql-".padEnd(40, "x");
process.env.WX_APPID = process.env.WX_APPID || "wx_e2e_mysql";
process.env.WX_SECRET = process.env.WX_SECRET || "sec_e2e_mysql";

const results = [];
const ok = (n, c, d) => { results.push(!!c); console.log((c ? "✓ " : "✗ ") + n + (c ? "" : "  —— " + (d || ""))); };

const { createServer } = require(path.join(CTX, "serve-api.js"));
const PoemHandlerConfig = require(path.join(CTX, "api", "_lib", "config.js"));
PoemHandlerConfig.wxFetch = (url) => Promise.resolve({
  json: () => Promise.resolve({
    openid: "o-" + new URL(url).searchParams.get("js_code"),
    unionid: ""
  })
});

const server = createServer();
const facade = require(path.join(CTX, "node_modules", "mysql2", "promise.js"));

function makeWx(port, mem) {
  return {
    getStorageSync: (k) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : ""),
    setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
    removeStorageSync: (k) => { delete mem[k]; },
    request: (opt) => {
      const u = new URL(opt.url);
      const data = opt.data === undefined ? null : JSON.stringify(opt.data);
      const req = http.request({
        port, method: opt.method || "POST", path: u.pathname + u.search,
        headers: Object.assign({ "content-type": "application/json" }, opt.header || {})
      }, (res) => {
        let buf = "";
        res.on("data", (d) => (buf += d));
        res.on("end", () => {
          let body = null;
          try { body = JSON.parse(buf); } catch (e) { body = buf; }
          opt.success({ statusCode: res.statusCode, data: body });
        });
      });
      req.on("error", () => opt.fail && opt.fail({ errMsg: "offline" }));
      if (data) req.write(data);
      req.end();
    },
    login: (opt) => opt.success({ code: "CODE-MYSQL" })
  };
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const mem = {};
  global.wx = makeWx(port, mem);

  /* ---------- ① 接线生效了没有 ---------- */
  {
    const storeMod = require(path.join(CTX, "api", "_lib", "store.js"));
    const cfgMod = require(path.join(CTX, "api", "_lib", "config.js"));
    const s = storeMod.getStore(cfgMod);
    ok("接线生效：getStore() 回的是 MySQL 那份实现（不是内存档）",
      s && s.kind === "mysql", "拿到的是 kind=" + (s && s.kind));
    ok("那个 mysqlStore 是**本仓库**那份（方法齐全，不是别的什么东西）",
      typeof s.putProgress === "function" && typeof s.listProgress === "function" &&
      typeof s.getWxAccountByOpenid === "function" && typeof s.putAccount === "function");
  }

  /* ---------- ② 登录 → 同步整条链走在 mysqlStore 上 ---------- */
  const store = require(path.join(REPO, "miniprogram", "utils", "store.js"));
  const auth = require(path.join(REPO, "miniprogram", "utils", "auth.js"));
  const remote = require(path.join(REPO, "miniprogram", "utils", "remote.js"));

  auth.configure({ baseUrl: "http://127.0.0.1:" + port });
  store.saveSettings({ grade: 3, dailyCount: 7, theme: "ink", sfx: false });
  store.setRecord("poem_x", { level: 4, reviewCount: 9, updatedAt: Date.now() });

  await auth.login();
  ok("登录成功（走的是接上 MySQL 的那个服务端）", auth.logged() === true);
  const sy = await remote.sync();
  ok("同步没报错", !sy.error, JSON.stringify(sy));

  ok("假 MySQL 里真的落了 accounts 行（接线没生效的话一行都不会有）",
    facade._db.accounts.size === 1, "accounts 行数 " + facade._db.accounts.size);
  ok("假 MySQL 里真的落了 wx_accounts 行",
    facade._db.wx_accounts.size === 1, "wx_accounts 行数 " + facade._db.wx_accounts.size);

  const rows = [...facade._db.progress.values()];
  const byId = {};
  rows.forEach((r) => { byId[r.poem_id] = r; });
  ok("假 MySQL 里落了 settings:v1，且内容是推上去的那份",
    !!byId["settings:v1"] && byId["settings:v1"].payload.settings.grade === 3,
    JSON.stringify(byId["settings:v1"] && byId["settings:v1"].payload));
  ok("假 MySQL 里落了那篇进度",
    !!byId["poem_x"] && byId["poem_x"].payload.level === 4,
    JSON.stringify(byId["poem_x"] && byId["poem_x"].payload));
  ok("头像**没有**进库（只落本机，Issue #111）",
    !byId["profile:v1"], "库里出现了 profile:v1");

  /* ---------- ③ 「新的赢」换库之后还在不在（这一条是脚本的全部理由） ---------- */
  {
    const storeMod = require(path.join(CTX, "api", "_lib", "store.js"));
    const cfgMod = require(path.join(CTX, "api", "_lib", "config.js"));
    const s = storeMod.getStore(cfgMod);
    const UID = "probe-uid";

    await s.putProgress(UID, "", [{ poem_id: "probe-p", payload: { level: 5 }, updated_at: 1000, deleted: 0 }]);

    // ① 更旧的一批补发（断网重连）→ 不许覆盖
    await s.putProgress(UID, "", [{ poem_id: "probe-p", payload: { level: 2 }, updated_at: 500, deleted: 0 }]);
    let r = (await s.listProgress(UID, "", 0)).filter((x) => x.poem_id === "probe-p")[0];
    ok("旧的补发不覆盖（payload 与 updated_at 都不许被顶）",
      r && r.payload.level === 5 && r.updated_at === 1000,
      JSON.stringify(r) + " —— 旧值盖掉了新值，正是「断网重连后一批旧数据补发」那个症状");

    // ② 更新的 → 赢
    await s.putProgress(UID, "", [{ poem_id: "probe-p", payload: { level: 9 }, updated_at: 2000, deleted: 0 }]);
    r = (await s.listProgress(UID, "", 0)).filter((x) => x.poem_id === "probe-p")[0];
    ok("更新的一份赢", r && r.payload.level === 9 && r.updated_at === 2000, JSON.stringify(r));

    // ③ 同一毫秒按 `>=` 接受（与原来那句 Postgres 口径一致）
    await s.putProgress(UID, "", [{ poem_id: "probe-p", payload: { level: 7 }, updated_at: 2000, deleted: 0 }]);
    r = (await s.listProgress(UID, "", 0)).filter((x) => x.poem_id === "probe-p")[0];
    ok("同一毫秒按 `>=` 接受", r && r.payload.level === 7, JSON.stringify(r));

    // ④ 增量按 since 过滤（同步那条路每台设备都会走）
    await s.putProgress(UID, "", [{ poem_id: "probe-old", payload: { level: 1 }, updated_at: 100, deleted: 0 }]);
    const inc = (await s.listProgress(UID, "", 1500)).filter((x) => x.poem_id.indexOf("probe-") === 0);
    ok("增量拉取只回 updated_at 更新的那些",
      inc.length === 1 && inc[0].poem_id === "probe-p",
      JSON.stringify(inc.map((x) => x.poem_id)));

    // ⑤ 删除标记跟着 updated_at 走（旧的删除不许盖掉新的进度）
    await s.putProgress(UID, "", [{ poem_id: "probe-p", payload: {}, updated_at: 900, deleted: 1 }]);
    r = (await s.listProgress(UID, "", 0)).filter((x) => x.poem_id === "probe-p")[0];
    ok("旧的删除标记不许把新的进度标成已删", r && r.deleted === 0, JSON.stringify(r));
  }

  server.close();
  fs.rmSync(CTX, { recursive: true, force: true });
  const bad = results.filter((r) => !r).length;
  console.log("\n" + results.length + " 项，失败 " + bad + " 项");
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error("e2e(mysql) 自身抛异常：", e);
  try { fs.rmSync(CTX, { recursive: true, force: true }); } catch (e2) { void e2 };
  process.exit(1);
});
