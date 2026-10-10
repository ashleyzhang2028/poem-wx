#!/usr/bin/env node
/**
 * 端到端：假 wx（内存存储 + 真 http 打本地 poem 的 handler）跑一遍
 * 「本机设置/进度 → 登录同步 → 换台手机认回来」。
 *
 * 头像**刻意不在这一条链里**：它只有一个来源（微信那张 `chooseAvatar` 的临时路径），
 * 且只落本机、不上传 —— 所以「换台手机头像还在吗」的正确答案是**不在**，
 * 这里就照这个断言（Issue #111）。
 *
 * check.js 是静态 + 单元那一层，验得了报文形状、验不了两边合起来通不通 ——
 * 这一轮的坑（401、字段被裁、进度认不回来）全是合起来才显形的。
 *
 *   POEM_DIR=/tmp/poem node scripts/e2e-wx-sync.js
 *
 * 读不到 poem 时如实说一句然后退出 0，不假装跑过。不动网络、不落盘。
 */
"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");

const REPO = path.join(__dirname, "..");
const POEM = process.env.POEM_DIR || "/tmp/poem";

if (!fs.existsSync(path.join(POEM, "api", "handler.js"))) {
  console.log("· 读不到 poem（" + POEM + "）—— 端到端同步这一层跳过。");
  console.log("  跑它：POEM_DIR=/tmp/poem node scripts/e2e-wx-sync.js（那边 git clone 一份）");
  process.exit(0);
}

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "e2e-secret-".padEnd(40, "x");
process.env.WX_APPID = process.env.WX_APPID || "wx_e2e";
process.env.WX_SECRET = process.env.WX_SECRET || "sec_e2e";

const PoemHandler = require(path.join(POEM, "api", "handler.js"));
const config = require(path.join(POEM, "api", "_lib", "config.js"));
config.wxFetch = (url) => {
  const code = new URL(url).searchParams.get("js_code");
  return Promise.resolve({ json: () => Promise.resolve({ openid: "o-" + code, unionid: "u-" + code }) });
};

const server = http.createServer((req, res) => PoemHandler(req, res));

const results = [];
const ok = (n, c, d) => { results.push(!!c); console.log((c ? "✓ " : "✗ ") + n + (c ? "" : "  —— " + (d || ""))); };

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
          if (res.statusCode >= 200 && res.statusCode < 300) opt.success({ statusCode: res.statusCode, data: body });
          else opt.success({ statusCode: res.statusCode, data: body });
        });
      });
      req.on("error", () => opt.fail && opt.fail({ errMsg: "offline" }));
      if (data) req.write(data);
      req.end();
    },
    login: (opt) => opt.success({ code: "CODE-1" })
  };
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const mem = {};
  global.wx = makeWx(port, mem);

  const store = require(path.join(REPO, "miniprogram", "utils", "store.js"));
  const auth = require(path.join(REPO, "miniprogram", "utils", "auth.js"));
  const remote = require(path.join(REPO, "miniprogram", "utils", "remote.js"));

  auth.configure({ baseUrl: "http://127.0.0.1:" + port });

  // 用户先在本机选了一堆东西
  store.saveSettings({ grade: 3, dailyCount: 7, theme: "ink", sfx: false });
  store.saveProfile({ avatarLocal: "wxfile://avatar-from-wechat.jpg" });
  store.setRecord("poem_x", { level: 4, reviewCount: 9, updatedAt: Date.now() });

  await auth.login();
  ok("登录之后 logged=true", auth.logged() === true, JSON.stringify(auth.logged()));
  ok("档位从服务端来（free）", auth.serverTier() === "free", auth.serverTier());
  ok("拿到 token", !!auth.token(), String(auth.token()).slice(0, 20));

  const sync = await remote.sync();
  ok("同步没报错", !sync.error, JSON.stringify(sync));
  ok("推上去的条数 > 0", sync.pushed > 0, JSON.stringify(sync));

  // 直接查服务端那份「库」：设置与头像真的落进去了吗
  const svStore = require(path.join(POEM, "api", "_lib", "store.js")).getStore(config);
  const rows = await svStore.listProgress(store.profile().userId, "", 0);
  const byId = {};
  rows.forEach((r) => { byId[r.poem_id] = r.payload; });
  ok("服务端收到了 settings:v1", !!byId["settings:v1"], JSON.stringify(Object.keys(byId)));
  ok("服务端那份设置里有 grade=3 / dailyCount=7",
    byId["settings:v1"] && byId["settings:v1"].settings.grade === 3 && byId["settings:v1"].settings.dailyCount === 7,
    JSON.stringify(byId["settings:v1"]));
  ok("lastSyncAt 没被推上去", byId["settings:v1"] && !("lastSyncAt" in byId["settings:v1"].settings),
    JSON.stringify(byId["settings:v1"] && byId["settings:v1"].settings));
  ok("sfx 没被推上去（跟设备走）", byId["settings:v1"] && !("sfx" in byId["settings:v1"].settings),
    JSON.stringify(byId["settings:v1"] && byId["settings:v1"].settings));
  ok("服务端**没有**收到 profile:v1（头像只落本机，不上传）",
    !byId["profile:v1"],
    "推上去了：" + JSON.stringify(byId["profile:v1"]) +
      " —— 头像现在是微信那张的临时路径（wxfile://），上传它既没地方存也没意义");
  ok("服务端收到了那篇进度", byId["poem_x"] && byId["poem_x"].level === 4, JSON.stringify(byId["poem_x"]));

  // 换一台手机：清空本机，用同一个微信登进来，应该认回同一份
  Object.keys(mem).forEach((k) => delete mem[k]);
  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(path.join(REPO, "miniprogram", "utils")) === 0) delete require.cache[k];
  });
  const store2 = require(path.join(REPO, "miniprogram", "utils", "store.js"));
  const auth2 = require(path.join(REPO, "miniprogram", "utils", "auth.js"));
  const remote2 = require(path.join(REPO, "miniprogram", "utils", "remote.js"));
  auth2.configure({ baseUrl: "http://127.0.0.1:" + port });
  ok("新手机上设置就是默认值（前置）", store2.settings().grade === 1, String(store2.settings().grade));
  await auth2.login();
  const sync2 = await remote2.sync();
  ok("新手机同步成功", !sync2.error, JSON.stringify(sync2));
  ok("新手机上 grade 认回来了（3）", store2.settings().grade === 3, String(store2.settings().grade));
  ok("新手机上 dailyCount 认回来了（7）", store2.settings().dailyCount === 7, String(store2.settings().dailyCount));
  /* ⚠️ 这一条是**反着**断言的：头像不跨设备。
     它是这台手机上的东西（微信头像的临时路径），换台手机本来就该没有 ——
     真要跨设备，就得养一个对象存储，而 Issue #111 要的正是别养。 */
  ok("新手机上头像**不**认回来（头像只落本机，这是刻意的）",
    !store2.profile().avatarLocal, "居然认回来了：" + String(store2.profile().avatarLocal));
  ok("新手机上那篇进度认回来了（level 4）",
    (store2.getRecord("poem_x") || {}).level === 4, JSON.stringify(store2.getRecord("poem_x")));

  server.close();
  const bad = results.filter((r) => !r).length;
  console.log("\n" + results.length + " 项，失败 " + bad + " 项");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error("e2e 自身抛异常：", e); process.exit(1); });
