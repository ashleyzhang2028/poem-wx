"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");

const REPO = path.join(__dirname, "..");
const POEM = path.join(REPO, "api");

if (!fs.existsSync(path.join(POEM, "handler.js"))) {
  console.log("· 读不到 " + POEM + " —— 端到端同步这一层跳过（后端契约应该在仓库根上）。");
  process.exit(0);
}

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "e2e-secret-".padEnd(40, "x");
process.env.WX_APPID = process.env.WX_APPID || "wx_e2e";
process.env.WX_SECRET = process.env.WX_SECRET || "sec_e2e";

const PoemHandler = require(path.join(POEM, "handler.js"));
const config = require(path.join(POEM, "_lib", "config.js"));
config.wxFetch = (url) => {
  const code = new URL(url).searchParams.get("js_code");
  return Promise.resolve({ json: () => Promise.resolve({ openid: "o-" + code, unionid: "u-" + code }) });
};

const server = http.createServer((req, res) => PoemHandler(req, res));

const R = require(path.join(REPO, "miniprogram", "utils", "review-models.js"));

const results = [];
const ok = (n, c, d) => { results.push(!!c); console.log((c ? "✓ " : "✗ ") + n + (c ? "" : "  —— " + (d || ""))); };

const hits = [];

function makeWx(port, mem) {
  return {
    getStorageSync: (k) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : ""),
    setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
    removeStorageSync: (k) => { delete mem[k]; },
    request: (opt) => {
      hits.push(opt.url);
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

  const wire = require(path.join(REPO, "miniprogram", "utils", "wire.js"));
  const syncModule = require(path.join(REPO, "miniprogram", "utils", "sync.js"));
  const wireRows = () => wire.packRecords();

  auth.configure({ baseUrl: "http://127.0.0.1:" + port });

  store.saveSettings({ grade: 3, dailyCount: 7, theme: "ink", sfx: false });
  store.saveProfile({ avatarLocal: "wxfile://avatar-from-wechat.jpg" });
  store.setRecord("poem_x", { level: 4, reviewCount: 9, updatedAt: Date.now() });
  store.saveCollections([
    { id: "c-e2e", name: "自选集", createdAt: 1, dailyCount: 10, items: [{ id: "poems-xx1-01" }, { id: "poems-xx1-02" }] }
  ]);

  const sm2Day = { t: 0 };
  {
    const collections = require(path.join(REPO, "miniprogram", "utils", "collections.js"));
    collections.setCount("c-e2e", 20);
    const t0 = Math.floor(Date.now() / 1000) * 1000 - 2 * 86400000;
    sm2Day.t = t0;
    store.setRecord("mingshu-ms-225", { level: 3, nextReviewAt: t0, lastReviewAt: t0 - 86400000, learned: true });
    const sm2 = R.adopt({ learned: true, level: 4, lapses: 3 }, "sm2");
    store.setRecord("poems-xx1-01", Object.assign(sm2, {
      level: 5, interval: 21, ef: 1.7, reviewCount: 6, lapses: 3,
      nextReviewAt: t0, lastReviewAt: t0 - 86400000, reviewedOn: R.dayStamp(t0 - 86400000),
      history: [{ at: t0 - 86400000, result: "good", level: 5 }]
    }));
    store.setRecord("poems-xx1-03", { level: 2, nextReviewAt: Date.now() + 86400000, lastReviewAt: Date.now(), learned: true });
    store.saveSettings({ algo: "sm2" });
  }

  await auth.login();
  ok("登录之后 logged=true", auth.logged() === true, JSON.stringify(auth.logged()));
  ok("档位从服务端来（free）", auth.serverTier() === "free", auth.serverTier());
  ok("拿到 token", !!auth.token(), String(auth.token()).slice(0, 20));

  const sync = await remote.sync();
  ok("同步没报错", !sync.error, JSON.stringify(sync));
  ok("同步成功之后没有留下失败痕迹", !syncModule.state().failed, JSON.stringify(syncModule.state()));
  ok("推上去的条数 > 0", sync.pushed > 0, JSON.stringify(sync));

  const svStore = require(path.join(POEM, "_lib", "store.js")).getStore(config);
  const rows = await svStore.listProgress(store.profile().userId, "", 0);
  const byId = {};
  rows.forEach((r) => { byId[r.poem_id] = r.payload; });
  ok("服务端收到了 settings:v1", !!byId["settings:v1"], JSON.stringify(Object.keys(byId)));
  ok("服务端那份设置把云端字段写全了（新手机不带本机默认值上去时也有底）",
    byId["settings:v1"] && byId["settings:v1"].settings.algo === "sm2" && byId["settings:v1"].settings.theme === "ink",
    JSON.stringify(byId["settings:v1"] && byId["settings:v1"].settings));
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
  ok("服务端收到了 SM-2 的中间状态（interval / ef / lapses / reviewCount / 评分结果）",
    !!byId["poems-xx1-01"]
      && byId["poems-xx1-01"].interval === 21
      && byId["poems-xx1-01"].ef === 1.7
      && byId["poems-xx1-01"].lapses === 3
      && byId["poems-xx1-01"].reviewCount === 6
      && (byId["poems-xx1-01"].history[0] || {}).result === "good",
    JSON.stringify(byId["poems-xx1-01"]));
  ok("只背过没点读过的那篇也进了已读行",
    !!byId["reads:poem_poems_read_v1"] && !!byId["reads:poem_poems_read_v1"].marks["poems-xx1-03"],
    JSON.stringify(byId["reads:poem_poems_read_v1"]));
  ok("服务端收到了自选集子（名字、篇目与每日首数都在）",
    !!byId["collections:v1"]
      && byId["collections:v1"].collections[0].name === "自选集"
      && byId["collections:v1"].collections[0].items.length === 2
      && byId["collections:v1"].collections[0].dailyCount === 20,
    JSON.stringify(byId["collections:v1"]));

  const advanceDue = new Date(2026, 0, 5, 10).getTime();
  store.setRecord("poems-xx1-28", {
    level: 2, learned: true, algo: "sm2", reviewCount: 3,
    nextReviewAt: advanceDue, lastReviewAt: advanceDue, reviewedOn: "2000-1-1",
    history: [{ at: advanceDue, result: "good", level: 2 }]
  });
  const advancedRow = wireRows().filter((r) => r.id === "poems-xx1-28")[0] || {};
  ok("到期未复习的那篇上行时按当前算法推进一档",
    (advancedRow.payload || {}).level === 3, JSON.stringify(advancedRow.payload));
  ok("推进后的那条，时间戳与 payload 的复习时间落在同一刻、复习日是当天",
    advancedRow.updatedAt === advancedRow.payload.lastReviewAt
      && advancedRow.payload.reviewedOn === R.dayStamp(Date.now()),
    JSON.stringify([advancedRow.updatedAt, advancedRow.payload.lastReviewAt, advancedRow.payload.reviewedOn]));

  const syncAdvance = await remote.sync();
  ok("推进过的那篇推得上去", !syncAdvance.error, JSON.stringify(syncAdvance));

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

  ok("新手机上头像**不**认回来（头像只落本机，这是刻意的）",
    !store2.profile().avatarLocal, "居然认回来了：" + String(store2.profile().avatarLocal));
  ok("新手机上那篇进度认回来了（level 4）",
    (store2.getRecord("poem_x") || {}).level === 4, JSON.stringify(store2.getRecord("poem_x")));
  ok("新手机上 algo 认回来了（sm2）", store2.settings().algo === "sm2", String(store2.settings().algo));
  ok("新手机上 SM-2 的 ef / interval / lapses / reviewCount / history 都认回来了",
    (() => {
      const rec = store2.getRecord("poems-xx1-01") || {};
      return rec.ef === 1.7 && rec.interval === 21 && rec.lapses === 3 && rec.reviewCount === 6
        && (rec.history[0] || {}).result === "good";
    })(),
    JSON.stringify(store2.getRecord("poems-xx1-01")));
  ok("新手机上那篇的档位与旧手机一致",
    (store2.getRecord("poems-xx1-01") || {}).level === (store.getRecord("poems-xx1-01") || {}).level,
    JSON.stringify([store.getRecord("poems-xx1-01"), store2.getRecord("poems-xx1-01")]));
  ok("新手机上只背没读过的那篇也在已读里",
    !!store2.reads("poems")["poems-xx1-03"], JSON.stringify(store2.reads("poems")));
  ok("新手机上推进过的那篇档位与旧手机上看到的一致",
    (store2.getRecord("poems-xx1-28") || {}).level === 3,
    JSON.stringify(store2.getRecord("poems-xx1-28")));

  {
    const cols2 = require(path.join(REPO, "miniprogram", "utils", "collections.js"));
    const got = cols2.list();
    ok("新手机上自选集子认回来了（名字、篇目与每日首数）",
      got.length === 1 && got[0].name === "自选集" && cols2.idsOf(got[0]).length === 2
        && cols2.countOf(got[0]) === 20,
      JSON.stringify(got));
  }

  store.markRead("poems", "zhaoming-zm-1");
  await remote.sync();
  await remote2.sync();
  ok("这台手机读过、那台手机没读过的那篇，拉过来之后两边都算读过（读到取并集）",
    !!store.reads("poems")["zhaoming-zm-1"] && !!store2.reads("poems")["zhaoming-zm-1"],
    JSON.stringify([store.reads("poems"), store2.reads("poems")]));

  store.clearProgress();
  const svStoreBefore = await svStore.listProgress(store.profile().userId, "", 0);
  const back = wire.applyRecords(
    svStoreBefore
      .filter((r) => r.poem_id === "poem_x")
      .map((r) => ({ id: r.poem_id, payload: r.payload, updatedAt: Number(r.updated_at), deleted: !!r.deleted }))
  );
  ok("清空未推完时，拉回来的旧记录不会复活（清空是更新的一次删除）",
    !store.getRecord("poem_x") && back === 0, JSON.stringify(store.getRecord("poem_x")));

  const sync3 = await remote.sync();
  ok("清空之后推得上去", !sync3.error, JSON.stringify(sync3));

  const after = await svStore.listProgress(store.profile().userId, "", 0);
  const gone = {};
  after.forEach((r) => { gone[r.poem_id] = r; });
  ok("服务端那条进度被标成已删（不是只在本地没了）",
    gone["poem_x"] && Number(gone["poem_x"].deleted) === 1,
    JSON.stringify(gone["poem_x"]));
  ok("清空之后再推，清除标记不再重复发",
    wireRows().filter((r) => r.id === "poem_x" && r.deleted).length === 0);

  const sync4 = await remote2.sync();
  ok("另一台手机同步成功", !sync4.error, JSON.stringify(sync4));
  ok("另一台手机上的那条进度被删掉（清空跨设备生效）",
    !store2.getRecord("poem_x"), JSON.stringify(store2.getRecord("poem_x")));

  {
    const limit = config.rate.device[0];
    const saved = config.rate.device;
    config.rate.device = [[limit[0], 1]];
    await remote.pull().catch(() => {});

    const called = [];
    const realNow = syncModule.now;
    const realFlush = syncModule.flush;
    syncModule.now = (force) => { called.push(force ? "now:force" : "now"); return realNow(force); };
    syncModule.flush = () => { called.push("flush"); return realFlush(); };

    store.setRecord("poem_y", { level: 2, reviewCount: 1, updatedAt: Date.now() });
    const fail = await syncModule.now(true);
    ok("被限流的那次同步把原因带回来了", fail && fail.error && fail.statusCode === 429, JSON.stringify(fail));
    const calledBefore = called.length;

    store.setRecord("poem_z", { level: 2, reviewCount: 1, updatedAt: Date.now() });
    const markBefore = hits.filter((u) => String(u).indexOf("/api/sync/pull") >= 0).length;
    syncModule.markDirty();
    await new Promise((r) => setTimeout(r, 900));
    const marked = hits.filter((u) => String(u).indexOf("/api/sync/pull") >= 0).length;
    const st = syncModule.state();
    ok("被限流之后记了改动也不再自动重启一轮重试",
      marked === markBefore && called.slice(calledBefore).length === 0,
      JSON.stringify(called.slice(calledBefore)) + " 打了 " + (marked - markBefore) + " 次");
    ok("被限流之后界面不再显示已同步", st.pendingStatus !== "已同步" && st.failed, JSON.stringify(st));
    ok("被限流之后给出重试倒计时（按服务端给的窗口等，再叠自身的退避）",
      st.later >= limit[0] / 1000 && st.pendingText.indexOf("后重试") > 0, JSON.stringify(st));

    const beforeRetry = hits.filter((u) => String(u).indexOf("/api/sync/pull") >= 0).length;
    syncModule.resetThrottle();
    const autoRetry = await syncModule.now();
    await new Promise((r) => setTimeout(r, 60));
    const afterRetry = hits.filter((u) => String(u).indexOf("/api/sync/pull") >= 0).length;
    ok("冷却期内的自动同步也不打服务端",
      afterRetry === beforeRetry && autoRetry.skipped === "waiting" && autoRetry.retryAfter > 0,
      "打了 " + (afterRetry - beforeRetry) + " 次，" + JSON.stringify(autoRetry));
    ok("冷却期内待同步的改动仍算在账上", syncModule.unsent() || syncModule.pendingCount() > 0);

    syncModule.now = realNow;
    syncModule.flush = realFlush;
    config.rate.device = saved;
    hits.length = 0;
  }

  {
    const holder = require(path.join(POEM, "_lib", "store.js"));
    const origGet = holder.getStore;
    const shared = holder.getStore(config);
    holder.getStore = function () { return shared; };
    svStore.putSetting("ranking:exam", "0");

    ok("那一行开关写进去之后，服务端读得回来（读的是库里的列，不是另一个字段名）",
      !!(await shared.getSetting("ranking:exam")), "开关写进去了却读不到 —— 后台拨一次、重启一次就变回关闭");

    const submitter = require(path.join(REPO, "miniprogram", "utils", "ranking-submit.js"));
    const relay = submitter.submitPlay("exam", { score: 7, total: 10, durationSec: 120 });
    await new Promise((r) => setTimeout(r, 120));
    const got = await relay;
    holder.getStore = origGet;

    const self = require(path.join(REPO, "miniprogram", "utils", "ranking.js")).selfGrade(store.settings());
    const saved = (await shared.listScoreRecords({ game: "exam" }, 20)).filter((r) => r.uid === store.profile().userId);
    ok("关着榜时交上来的成绩照样落库（开着才展示，不是开着才收）",
      !!got && got.ok === true && got.on === false && saved.length === 1,
      JSON.stringify(got) + " 落库 " + saved.length + " 行");
    ok("成绩记的是这个人的学段 / 年级 / 学期（不是一律 all，否则哪儿都查不到这一行）",
      saved.length === 1 && saved[0].stage === self.stage && saved[0].grade === self.grade
        && saved[0].term === self.term,
      JSON.stringify(saved[0]) + " 本机 " + JSON.stringify(self));
  }

  {
    const rankMod = require(path.join(REPO, "miniprogram", "utils", "ranking.js"));
    const rankingMask = (name) => rankMod.maskNick(name);
    const api = (body, method) => {
      const data = body || {};
      return new Promise((resolve) => {
        const req = http.request({
          port, method: method || "POST", path: "/api/ranking",
          headers: { "content-type": "application/json", authorization: "Bearer " + auth.token() }
        }, (res) => {
          let buf = "";
          res.on("data", (d) => (buf += d));
          res.on("end", () => {
            let out = null;
            try { out = JSON.parse(buf); } catch (e) { out = buf; }
            resolve({ status: res.statusCode, body: out });
          });
        });
        req.write(JSON.stringify(data));
        req.end();
      });
    };

    const offVisible = await api({ op: "visible", game: "exam" });
    ok("榜单一上线是关的（默认关，谁都没打开过）",
      offVisible.status === 200 && offVisible.body.on === false, JSON.stringify(offVisible.body));

    const offList = await api({ op: "list", game: "exam" });
    ok("关着的时候读不到榜单（不是空榜，是明说没开）",
      offList.status === 403 && offList.body.code === "E_RANKING_OFF", JSON.stringify(offList.body));

    const offSubmit = await api({ op: "submit", game: "exam", score: 9, total: 10, stage: "primary", grade: 3, term: 1 });
    ok("关着的时候交上来的成绩照收，回一句 on:false（开关管展示，不管收不收）",
      offSubmit.status === 200 && !!offSubmit.body.recorded && offSubmit.body.on === false,
      JSON.stringify(offSubmit.body));

    await svStore.putSetting("ranking:exam", "1");
    await svStore.patchAccount(store.profile().userId, { nickname: "测试某某" });

    const onSubmit = await api({
      op: "submit", game: "exam", score: 9, total: 10, stage: "primary", grade: 3, term: 1, durationSec: 300
    });
    ok("开了之后成绩收得下", onSubmit.status === 200 && !!onSubmit.body.recorded, JSON.stringify(onSubmit.body));

    const board = await api({
      op: "list", game: "exam", stage: "primary", grade: 3, term: 1, period: "day", size: 10
    });
    const mineRow = (board.body.board || []).filter((r) => r.me)[0];
    ok("自己那一行在榜上，名次从 1 起", !!mineRow && mineRow.rank === 1, JSON.stringify(board.body.board));
    ok("榜上的名字是打码过的（首末字 + 星号）",
      !!mineRow && mineRow.nick === rankingMask("测试某某"), JSON.stringify(mineRow && mineRow.nick));
    ok("榜单按学段 / 年级 / 学期分档（别的档里没有这一行）",
      board.body.label === "小学 · 三年级上册", String(board.body.label));

    const other = await api({ op: "list", game: "exam", stage: "middle", grade: 7, period: "day" });
    ok("只考过小学那一档时，初中榜是空的", (other.body.board || []).length === 0,
      JSON.stringify(other.body.board));

    const others = [];
    for (let i = 0; i < 25; i += 1) {
      const uid = "u_probe_" + i;
      await svStore.putAccount({ uid: uid, status: "active", nickname: "诗友" + i, created_at: 1 });
      await svStore.putScoreRecord({
        srid: "sc_probe_" + i, uid: uid, game: "exam", scope_id: "", stage: "primary",
        grade: 3, term: 1, score: 10, total: 10, duration_sec: 100 + i, created_at: Date.now() - 1000 + i
      });
      others.push(uid);
    }

    const cut = await api({ op: "list", game: "exam", stage: "primary", grade: 3, term: 1, period: "day", size: 10 });
    ok("榜只列前 N 名（剩下的人不跟着拉下来）",
      (cut.body.board || []).length === 10 && cut.body.total === 26,
      (cut.body.board || []).length + " / " + cut.body.total);
    ok("自己排在 N 名之外时，单给自己一行名次（不把整张榜拉下来）",
      !!cut.body.me && cut.body.me.rank === 2 && cut.body.me.me === true,
      JSON.stringify(cut.body.me) + " total=" + cut.body.total);
    ok("同分同名次（下一名跳号）",
      (cut.body.board || []).every((r) => r.rank === 1) && cut.body.me.rank === 2,
      JSON.stringify((cut.body.board || []).map((r) => r.rank).concat([cut.body.me && cut.body.me.rank])));
    ok("圈外那一行的名字也是打码的（不因为是自己就露全名）",
      !!cut.body.me && cut.body.me.nick === rankingMask("测试某某"),
      JSON.stringify(cut.body.me && cut.body.me.nick));

    const flyList = await api({ op: "list", game: "fly", stage: "all", period: "day" });
    ok("飞花令榜与考试榜各算各的", flyList.status === 403, JSON.stringify(flyList.body));

    const notAdmin = await new Promise((resolve) => {
      const req = http.request({
        port, method: "POST", path: "/api/admin/ranking",
        headers: { "content-type": "application/json", authorization: "Bearer " + auth.token() }
      }, (res) => {
        let buf = "";
        res.on("data", (d) => (buf += d));
        res.on("end", () => resolve({ status: res.statusCode, body: buf }));
      });
      req.write(JSON.stringify({ game: "exam", on: true }));
      req.end();
    });
    ok("开关不是谁都能拧（普通用户拨不动）", notAdmin.status === 403, String(notAdmin.body));

    const mePatch = (body) => new Promise((resolve) => {
      const req = http.request({
        port, method: "PATCH", path: "/api/me",
        headers: { "content-type": "application/json", authorization: "Bearer " + auth.token() }
      }, (res) => {
        let buf = "";
        res.on("data", (d) => (buf += d));
        res.on("end", () => {
          let out = null;
          try { out = JSON.parse(buf); } catch (e) { out = buf; }
          resolve({ status: res.statusCode, body: out });
        });
      });
      req.write(JSON.stringify(body));
      req.end();
    });

    const badNick = await mePatch({ nickname: "加微信领红包" });
    ok("昵称里有敏感词时不收（明说换一个，不是静默截断）",
      badNick.status === 400 && badNick.body.code === "E_NICK_BLOCKED", JSON.stringify(badNick.body));
    const goodNick = await mePatch({ nickname: "测试某某" });
    ok("干净昵称照旧收得下", goodNick.status === 200 && goodNick.body.nickname === "测试某某",
      JSON.stringify(goodNick.body));

    await svStore.patchAccount(store.profile().userId, { nickname: "傻逼一号" });
    const dirty = await api({ op: "list", game: "exam", stage: "primary", grade: 3, term: 1, period: "day", size: 10 });
    const dirtyRow = (dirty.body.board || []).filter((r) => r.me)[0] || dirty.body.me;
    ok("库里存着敏感昵称时榜单不摆它，退回「诗友 + 尾号」",
      !!dirtyRow && dirtyRow.nick === rankingMask("诗友" + String(store.profile().userId).slice(-4)),
      JSON.stringify(dirtyRow && dirtyRow.nick));
    await svStore.patchAccount(store.profile().userId, { nickname: "测试某某" });
  }

  server.close();
  const bad = results.filter((r) => !r).length;
  console.log("\n" + results.length + " 项，失败 " + bad + " 项");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error("e2e 自身抛异常：", e); process.exit(1); });
