"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const REPO = path.join(__dirname, "..");
const POEM = path.join(REPO, "api");

if (!fs.existsSync(path.join(POEM, "handler.js"))) {
  console.log("· 读不到 " + POEM + " —— MySQL 那条端到端跳过（后端契约应该在仓库根上）。");
  process.exit(0);
}

const CTX = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-mysql-"));

{
  const apiSrc = POEM;
  const apiDst = path.join(CTX, "api");
  fs.mkdirSync(apiDst, { recursive: true });

  const routesSrc = fs.readFileSync(path.join(apiSrc, "_lib", "routes.js"), "utf8");
  const wanted = new Set(["handler.js", "_lib/routes.js", "_lib/http.js"]);

  for (const ref of routesSrc.matchAll(/"(\.[^"]+\.js)"/g)) {
    wanted.add(path.posix.normalize(path.posix.join("_lib", ref[1])));
  }

  const walk = (dir, rel) => {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      const r = rel ? rel + "/" + f : f;
      if (fs.statSync(full).isDirectory()) walk(full, r);
      else if (f.endsWith(".js")) wanted.add(r);
    }
  };
  walk(path.join(apiSrc, "_lib"), "_lib");
  walk(path.join(apiSrc, "_routes"), "_routes");

  for (const rel of wanted) {
    const from = path.join(apiSrc, rel);
    if (!fs.existsSync(from)) continue;
    const to = path.join(apiDst, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}
fs.copyFileSync(path.join(REPO, "deploy-api-serve", "serve-api.js"), path.join(CTX, "serve-api.js"));
fs.copyFileSync(path.join(REPO, "deploy", "store-mysql.js"), path.join(CTX, "store-mysql.js"));

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
  ok("孩子的头像**没有**混进同步记录（只落本机，Issue #111）",
    !byId["profile:v1"], "库里出现了 profile:v1");

  {
    const storeMod = require(path.join(CTX, "api", "_lib", "store.js"));
    const cfgMod = require(path.join(CTX, "api", "_lib", "config.js"));
    const s = storeMod.getStore(cfgMod);
    const UID = "probe-uid";

    await s.putProgress(UID, "", [{ poem_id: "probe-p", payload: { level: 5 }, updated_at: 1000, deleted: 0 }]);

    await s.putProgress(UID, "", [{ poem_id: "probe-p", payload: { level: 2 }, updated_at: 500, deleted: 0 }]);
    let r = (await s.listProgress(UID, "", 0)).filter((x) => x.poem_id === "probe-p")[0];
    ok("旧的补发不覆盖（payload 与 updated_at 都不许被顶）",
      r && r.payload.level === 5 && r.updated_at === 1000,
      JSON.stringify(r) + " —— 旧值盖掉了新值，正是「断网重连后一批旧数据补发」那个症状");

    await s.putProgress(UID, "", [{ poem_id: "probe-p", payload: { level: 9 }, updated_at: 2000, deleted: 0 }]);
    r = (await s.listProgress(UID, "", 0)).filter((x) => x.poem_id === "probe-p")[0];
    ok("更新的一份赢", r && r.payload.level === 9 && r.updated_at === 2000, JSON.stringify(r));

    await s.putProgress(UID, "", [{ poem_id: "probe-p", payload: { level: 7 }, updated_at: 2000, deleted: 0 }]);
    r = (await s.listProgress(UID, "", 0)).filter((x) => x.poem_id === "probe-p")[0];
    ok("同一毫秒按 `>=` 接受", r && r.payload.level === 7, JSON.stringify(r));

    await s.putProgress(UID, "", [{ poem_id: "probe-old", payload: { level: 1 }, updated_at: 100, deleted: 0 }]);
    const inc = (await s.listProgress(UID, "", 1500)).filter((x) => x.poem_id.indexOf("probe-") === 0);
    ok("增量拉取只回 updated_at 更新的那些",
      inc.length === 1 && inc[0].poem_id === "probe-p",
      JSON.stringify(inc.map((x) => x.poem_id)));

    await s.putProgress(UID, "", [{ poem_id: "probe-p", payload: {}, updated_at: 900, deleted: 1 }]);
    r = (await s.listProgress(UID, "", 0)).filter((x) => x.poem_id === "probe-p")[0];
    ok("旧的删除标记不许把新的进度标成已删", r && r.deleted === 0, JSON.stringify(r));
  }

  {
    const storeMod = require(path.join(CTX, "api", "_lib", "store.js"));
    const cfgMod = require(path.join(CTX, "api", "_lib", "config.js"));
    const s = storeMod.getStore(cfgMod);
    const UID = "probe-uid";
    const record = {
      srid: "sc_probe_1", uid: UID, game: "exam", scope_id: "", stage: "primary",
      grade: 3, term: 1, score: 8, total: 10, duration_sec: 600, created_at: 5000
    };
    await s.putScoreRecord(record);
    await s.putScoreRecord(Object.assign({}, record, {
      srid: "sc_probe_2", uid: UID, grade: 7, stage: "middle", score: 10, created_at: 6000
    }));

    const mine = await s.listScoreRecords({ game: "exam", stage: "primary", grade: 3, from: 4000 }, 100);
    ok("成绩按学段 / 年级 / 时间段筛得准（别的档不收进来）",
      mine.length === 1 && mine[0].srid === "sc_probe_1" && mine[0].created_at === 5000,
      JSON.stringify(mine.map((x) => x.srid)));

    const early = await s.listScoreRecords({ game: "exam", from: 5500 }, 100);
    ok("按窗口起点筛（今日 / 本周 / 本月 / 今年都是这一条）",
      early.length === 1 && early[0].srid === "sc_probe_2",
      JSON.stringify(early.map((x) => x.srid)));

    const other = await s.listScoreRecords({ game: "fly" }, 100);
    ok("两种榜各看各的", other.length === 0, JSON.stringify(other.map((x) => x.srid)));

    ok("成绩底账里没有昵称（改名不用回灌）",
      !Object.prototype.hasOwnProperty.call(mine[0], "nickname"), JSON.stringify(Object.keys(mine[0] || {})));

    const none = await s.getSetting("ranking:exam");
    ok("榜单开关没有那一行（读出来是空的，默认由 core 判成开）", none === null, JSON.stringify(none));

    await s.putSetting("ranking:exam", "0");
    const off = await s.getSetting("ranking:exam");
    ok("显式关掉是写进同一行（读回来是 0）", !!off && String(off.svalue) === "0", JSON.stringify(off));

    await s.putAccount({ uid: "board-a", nickname: "甲", status: "active", created_at: 1 });
    await s.putAccount({ uid: "board-b", nickname: "乙", status: "active", created_at: 1 });
    const batch = await s.getAccounts(["board-a", "board-b", "board-没有"]);
    ok("榜单一次取一批账号（顺序跟着要的那份走，缺的留空）",
      batch.length === 3 && batch[0] && batch[0].nickname === "甲"
        && batch[1] && batch[1].nickname === "乙" && batch[2] === null,
      JSON.stringify(batch.map((x) => (x ? x.nickname : null))));

    const png = Buffer.from([1, 2, 3, 4]);
    ok("头像写进库里、读回来的字节一样（容器重启不丢）",
      (await s.putAvatar("probe-uid", "image/png", png))
        && (await s.getAvatar("probe-uid")).bytes.equals(png)
        && (await s.getAvatar("probe-uid")).mime === "image/png",
      JSON.stringify((await s.getAvatar("probe-uid")) || null));
    await s.deleteAvatar("probe-uid");
    ok("删掉之后读回 null", (await s.getAvatar("probe-uid")) === null);
  }

  {
    const storeMod = require(path.join(CTX, "api", "_lib", "store.js"));
    const cfgMod = require(path.join(CTX, "api", "_lib", "config.js"));
    const s = storeMod.getStore(cfgMod);
    const UID = "probe-uid";
    const now = Date.now();
    const row = (tid, extra) => Object.assign({
      tid: tid, uid: UID, device_id: "", email: "", nickname: "探针",
      kind: "bug", title: "标题", content: "正文", status: "open", resolution: "pending",
      dedupe_hash: "", created_at: now, updated_at: now
    }, extra || {});

    await s.putFeedbackThread(row("fb_probe_1", { title: "第一条" }));
    const got = await s.getFeedbackThread("fb_probe_1");
    ok("反馈标题与处理方式真的落进列里（不是只在报文里）",
      !!got && got.title === "第一条" && got.resolution === "pending", JSON.stringify(got));
    ok("去重哈希不进库（线上那一列不一定有，写了会整条写不进去；去重靠应用层）",
      !!got && got.dedupe_hash === "", JSON.stringify(got));

    await s.patchFeedbackThread("fb_probe_1", { status: "closed", resolution: "adopted", updated_at: now + 10 });
    const patched = await s.getFeedbackThread("fb_probe_1");
    ok("处理结果与处理方式改得回来",
      !!patched && patched.status === "closed" && patched.resolution === "adopted",
      JSON.stringify(patched));

    await s.patchFeedbackThread("fb_probe_1", JSON.parse('{"__proto__":{"status":"open"},"title":"改过的"}'));
    const clean = await s.getFeedbackThread("fb_probe_1");
    ok("请求里夹带的原型字段被剔掉、正常的列照旧写进去",
      !!clean && clean.status === "closed" && clean.title === "改过的",
      JSON.stringify(clean && { status: clean.status, title: clean.title }));

    const listed = await s.listFeedbackThreads({ uid: UID }, 50);
    ok("按人筛得准，按最后处理时间倒序", listed.length === 1 && listed[0].tid === "fb_probe_1",
      JSON.stringify(listed.map((r) => r.tid)));

    await s.putFeedbackComment({
      cid: "fc_probe_1", tid: "fb_probe_1", uid: UID, device_id: "",
      author_role: "admin", nickname: "管理员", content: "已修", created_at: now + 20
    });
    const talks = await s.listFeedbackComments({ tid: "fb_probe_1" }, 10);
    ok("单条反馈的沟通记录取得回来", talks.length === 1 && talks[0].content === "已修",
      JSON.stringify(talks));

    const counts = await s.countFeedbackThreads({});
    ok("计数按状态给（后台那几个分组标题用它）", counts.closed === 1 && counts.all >= 1, JSON.stringify(counts));
  }

  {
    const core = require(path.join(CTX, "api", "_lib", "core.js"));
    const targetUid = [...facade._db.accounts.keys()].filter((k) => k !== "probe-admin")[0];
    const until = Date.UTC(2030, 0, 1);
    await facade._db.accounts.set("probe-admin", {
      uid: "probe-admin", email: "probe-admin@e2e.local", nickname: "探针管理员",
      plan: "free", plan_until: null, role: "admin", status: "active", created_at: Date.now()
    });

    const deps = {
      cfg: Object.assign({}, require(path.join(CTX, "api", "_lib", "config.js")), { hasSession: () => true }),
      store: require(path.join(CTX, "api", "_lib", "store.js"))
        .getStore(require(path.join(CTX, "api", "_lib", "config.js"))),
      now: () => Date.now(),
      account: { uid: "probe-admin" },
      limiter: { check: () => ({ ok: true }), hit: () => {} }
    };

    await core.adminGrant(deps, { uid: targetUid, tier: "pro", until: until, deviceId: "e2e-due" });
    const row = facade._db.accounts.get(targetUid);
    ok("后台改档把到期时刻一并写进 accounts.plan_until（不是只写了 plan）",
      !!row && row.plan === "pro" && Number(row.plan_until) === until,
      JSON.stringify(row && { plan: row.plan, plan_until: row.plan_until }));

    const mine = (await core.adminAccounts(Object.assign({}, deps, {
      account: { uid: "probe-admin" }
    }))).body.accounts.filter((a) => a.uid === targetUid)[0];
    ok("名录读回来的到期时刻与写进去的一致（后台那一列日期打这儿来）",
      !!mine && Number(mine.until) === until && mine.tier === "pro", JSON.stringify(mine));

    const forever = await core.adminGrant(deps, { uid: targetUid, tier: "max", until: null, deviceId: "e2e-due" });
    const cleared = facade._db.accounts.get(targetUid);
    ok("留空到期就写成长期（plan_until 回 null）",
      !!cleared && cleared.plan === "max" && cleared.plan_until === null,
      JSON.stringify(cleared && { plan: cleared.plan, plan_until: cleared.plan_until }));
    ok("这一轮确实改了（changed 不是恒为真）", forever.body && forever.body.changed === true,
      JSON.stringify(forever.body && forever.body.changed));

    await core.adminGrant(deps, { uid: targetUid, tier: "max", until: null, deviceId: "e2e-due" });
    const same = await core.adminGrant(deps, { uid: targetUid, tier: "max", until: null, deviceId: "e2e-due" });
    ok("档位与到期都没变时如实说没改", same.body && same.body.changed === false,
      JSON.stringify(same.body && same.body.changed));
  }

  {
    const call = (q) => remote.request(remote.PATHS.dailyPoems + "?" + new URLSearchParams(q).toString(), {}, "GET").then(
      (body) => ({ ok: true, body: body }),
      (e) => ({ ok: false, status: e.statusCode, code: e.code })
    );
    const empty = await call({ day: "2026-10-31" });
    ok("每日一诗表还是空的：404 E_DAILY_EMPTY（客户端据此报失败，不是空白）",
      !empty.ok && empty.status === 404 && empty.code === "E_DAILY_EMPTY", JSON.stringify(empty));

    const DAILY_ROWS = [["春晓","孟浩然","唐"],["登鹳雀楼","王之涣","唐"],["静夜思","李白","唐"]];
    DAILY_ROWS.forEach((r, i) => facade._db.daily_poems.set(String(i), { pos: i, title: r[0], author: r[1], dynasty: r[2] }));
    const a = await call({ day: "2026-10-31" });
    const b = await call({ day: "2026-10-31" });
    ok("按自然日取：同一天两次是同一首，带 pos 与 size",
      a.ok && b.ok && a.body.pos === b.body.pos && a.body.size === 3 && !!a.body.title && !!a.body.author,
      JSON.stringify([a, b]));

    const byPos = await call({ pos: 1 });
    ok("按 pos 取：位置 1 就是第二首", byPos.ok && byPos.body.pos === 1 && byPos.body.title === "登鹳雀楼", JSON.stringify(byPos));

    const far = await call({ pos: 9 });
    ok("pos 越界：404 E_DAILY_RANGE", !far.ok && far.status === 404 && far.code === "E_DAILY_RANGE", JSON.stringify(far));

    const noArgs = await call({});
    const badPos = await call({ pos: -1 });
    const badDay = await call({ day: "昨天" });
    ok("缺参数或参数不合法：400 E_BAD_REQUEST",
      [noArgs, badPos, badDay].every((r) => !r.ok && r.status === 400 && r.code === "E_BAD_REQUEST"),
      JSON.stringify([noArgs, badPos, badDay]));
  }

  {
    const seed = require(path.join(REPO, "scripts", "corpus-seed"));
    const rows = seed.seedRows(seed.loadCorpus());
    const facadeQuery = (sql, params) => facade.createPool().query(sql, params);
    for (const st of seed.seedStatements(rows)) await facadeQuery(st.sql, st.params);

    const get = (q) => remote.request(remote.PATHS.corpus + "/" + q, {}, "GET").then(
      (body) => ({ ok: true, body: body }),
      (e) => ({ ok: false, status: e.statusCode, code: e.code })
    );

    const texts = await get("texts?book=tangshi300");
    ok("正文与译文经 /api/corpus/texts 下发（按集子取，形状是 rows + dict）",
      texts.ok && texts.body.rows && texts.body.rows.tangshi300 && texts.body.dict,
      JSON.stringify(texts).slice(0, 200));

    const sample = texts.ok && texts.body.rows.tangshi300 ? texts.body.rows.tangshi300[0] : null;
    ok("每一行带 pos / 标题 / 源 id / 正文 / 译文 / 出处",
      !!sample && sample.length === 6 && Number(sample[0]) > 0 && String(sample[3]).length > 0
        && String(sample[4]).length > 0 && typeof sample[5] === "number",
      JSON.stringify(sample).slice(0, 200));

    const only = await get("texts?book=gwgz");
    ok("只回问的那一部（别的集子一条不带）",
      only.ok && Object.keys(only.body.rows).length === 1 && only.body.rows.gwgz,
      JSON.stringify(Object.keys((only.body && only.body.rows) || {})));

    const noBook = await get("texts");
    ok("不带 book：400 E_CORPUS_BOOK（不是把全部集子一次吐出来）",
      !noBook.ok && noBook.status === 400 && noBook.code === "E_CORPUS_BOOK", JSON.stringify(noBook));

    const emptyGloss = await get("gloss?book=shanhaijing");
    ok("注释还没入库的集子：404 E_CORPUS_EMPTY", !emptyGloss.ok && emptyGloss.status === 404,
      JSON.stringify(emptyGloss));

    facade._db.corpus_gloss.set("tangshi300\u00001", {
      book_id: "tangshi300", pos: 1, title: "感遇·其一", gloss: JSON.stringify([["兰", "兰草"], ["葳蕤", "枝叶繁茂的样子"]])
    });
    const gloss = await get("gloss?book=tangshi300");
    const row = gloss.ok && gloss.body.rows.tangshi300
      ? gloss.body.rows.tangshi300.filter((r) => r[0] === 1)[0]
      : null;
    ok("注释存的是 JSON，读出来逐条是「词、释义」两栏",
      !!row && Array.isArray(row[2]) && row[2].length === 2 && row[2][1][0] === "葳蕤",
      JSON.stringify(row));
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
