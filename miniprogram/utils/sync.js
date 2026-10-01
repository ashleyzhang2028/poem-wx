/**
 * 云端同步。
 *
 * 契约直接对齐 poem 的 `api/_routes/sync/*`，两边跑同一套后端：
 *
 *   POST /api/sync/pull { since, deviceId, child } → { recs: [{id, payload, updatedAt, deleted}], serverTime }
 *   POST /api/sync/push { recs: [{id, payload, updatedAt, deleted}], deviceId, child }
 *
 * 同一份进度用两种 id 上传：
 *   - 单篇进度：`<poemId>`，payload 是 review-models 出来的那份记录
 *   - 分域大件：`dailyExtra:v1` / `collections:v1` / `reads:<book>` —— 与网页版的
 *     `READ_ROW_PREFIX` 口径一致，这样同一账号在网页版与小程序之间能互相同步
 *
 * 三条边界：
 *   1. **不登录也能用** —— 所有写入先落本机，同步是「有空才做」的后台动作，
 *      失败不回滚、不报错弹窗，只记一个待同步水位
 *   2. **Pro 起**（`sync.multiDevice`）—— 与网页版同一张权限表；不够档位时
 *      把本地队列留着，升档后自然补上，不丢数据
 *   3. **本机优先** —— 拉回来的记录按 updatedAt 比较，本机更新的不被旧数据覆盖
 *
 * 「本机优先」这条是刻意的：跨设备时两边都可能离线改过同一首，服务端不做
 * 合并（它只存最后写入的那一份）。这里按时间戳判，用户能预期。
 */
const store = require("./store");
const auth = require("./auth");
const entitlement = require("./entitlement");
const R = require("./review-models");

const KEYS = {
  /** 上次拉取水位（serverTime） */
  since: "kb_sync_since_v1",
  /** 待推送的记录：{ [id]: { payload, updatedAt, deleted } } */
  outbox: "kb_sync_outbox_v1",
  /** 上次同步结果，给「我的」页显示 */
  last: "kb_sync_last_v1",
  device: "kb_sync_device_v1"
};

/** 与网页版 api/_lib/core.js 的常量一致 */
const DAILY_EXTRA_ROW = "dailyExtra:v1";
const COLLECTIONS_ROW = "collections:v1";
const READ_PREFIX = "reads:";

/** 一次推的条数上限，与后端 E_TOO_MANY 的阈值一致 */
const PUSH_MAX = 2000;

function deviceId() {
  let id = store.read(KEYS.device, "");
  if (!id) {
    // 本机标识，不上传任何设备指纹，只是个随机串，用来做服务端限流分桶
    id = "mp-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    store.write(KEYS.device, id);
  }
  return id;
}

function configured() {
  return auth.configured();
}

function lastResult() {
  return store.read(KEYS.last, null) || null;
}

function pendingCount() {
  const out = store.read(KEYS.outbox, {}) || {};
  return Object.keys(out).length;
}

/** 能不能同步：要配了后端、要登录、要够档位 */
function gate() {
  if (!configured()) return { ok: false, reason: "没有配云端地址" };
  if (!auth.logged()) return { ok: false, reason: "登录可用" };
  const r = entitlement.can("sync.multiDevice");
  if (!r.ok) return { ok: false, reason: entitlement.hint("sync.multiDevice") };
  return { ok: true, reason: "" };
}

/* ---------- 出箱 ---------- */

/**
 * 记一条待推。同一 id 后来居上 —— 进度是「最后写入者赢」，不需要保留历史。
 * 时间戳就用本机的，服务端只按它排序。
 */
function enqueue(id, payload, opt) {
  const out = store.read(KEYS.outbox, {}) || {};
  out[id] = {
    id,
    payload: payload || {},
    updatedAt: Date.now(),
    deleted: !!(opt && opt.deleted)
  };
  store.write(KEYS.outbox, out);
  return out[id];
}

function markDeleted(id) {
  return enqueue(id, {}, { deleted: true });
}

/* ---------- 打包 ---------- */

/**
 * 把本机数据摊成服务端认的那些行。
 * 网页版的 `sanitizePayload` 只认这几个字段，多传会被丢掉，所以这里只挑需要的。
 */
function localRows() {
  const rows = [];

  const prog = store.progress();
  Object.keys(prog).forEach((id) => {
    const r = prog[id] || {};
    rows.push({
      id,
      payload: {
        level: r.level,
        nextReviewAt: r.nextReviewAt,
        learned: !!r.learned,
        reps: r.reps,
        history: (r.history || []).slice(-200)
      },
      updatedAt: r.lastReviewAt || r.updatedAt || 0
    });
  });

  const extra = store.dailyExtra();
  if (extra.length) {
    rows.push({
      id: DAILY_EXTRA_ROW,
      payload: { day: store.dayKey(), ids: extra },
      updatedAt: Date.now()
    });
  }

  const cols = store.collections();
  if (cols.length) {
    rows.push({ id: COLLECTIONS_ROW, payload: { items: cols }, updatedAt: Date.now() });
  }

  const reads = store.reads();
  Object.keys(reads).forEach((book) => {
    rows.push({
      id: READ_PREFIX + book,
      payload: { map: reads[book] },
      updatedAt: reads[book] && Object.keys(reads[book]).length
        ? Math.max.apply(null, Object.keys(reads[book]).map(Number))
        : 0
    });
  });

  return rows.filter((r) => r.updatedAt > 0);
}

/** 出箱 + 本机现状，一起推。同 id 取 updatedAt 大的那个 */
function outgoing() {
  const out = store.read(KEYS.outbox, {}) || {};
  const merged = {};
  localRows().forEach((r) => {
    merged[r.id] = r;
  });
  Object.keys(out).forEach((id) => {
    const o = out[id];
    const cur = merged[id];
    if (!cur || o.updatedAt >= cur.updatedAt) {
      merged[id] = { id, payload: o.payload, updatedAt: o.updatedAt, deleted: o.deleted };
    }
  });
  return Object.keys(merged).map((id) => merged[id]).slice(0, PUSH_MAX);
}

/* ---------- 应用回来的数据 ---------- */

/**
 * 应用一条服务端记录。
 *
 * ⚠️ 本机更新的不被旧数据覆盖 —— 服务端只存最后写入的那一份，没有合并，
 * 所以时间戳是唯一的判据。本机没有这条时直接收。
 */
function applyRow(rec) {
  const id = String(rec.id || "");
  if (!id) return false;

  if (id === DAILY_EXTRA_ROW) {
    const p = rec.payload || {};
    // 跨天的加背没有意义，收了也只是当天有效
    if (p.day === store.dayKey() && Array.isArray(p.ids)) store.setDailyExtra(p.ids);
    return true;
  }

  if (id === COLLECTIONS_ROW) {
    const p = rec.payload || {};
    if (Array.isArray(p.items) && p.items.length) store.saveCollections(p.items);
    return true;
  }

  if (id.indexOf(READ_PREFIX) === 0) {
    const book = id.slice(READ_PREFIX.length);
    const p = rec.payload || {};
    const mine = store.reads(book);
    const patch = {};
    Object.keys(p.map || {}).forEach((pid) => {
      const theirs = Number(p.map[pid]) || 0;
      const ours = Number(mine[pid]) || 0;
      if (theirs > ours) patch[pid] = theirs;
    });
    if (Object.keys(patch).length) {
      const all = store.read(store.KEYS.reads, {}) || {};
      all[book] = Object.assign({}, all[book] || {}, patch);
      store.write(store.KEYS.reads, all);
    }
    return true;
  }

  // 单篇进度
  const mine = store.getRecord(id);
  const theirs = { id, rec: rec.payload || {} };
  const mineAt = mine && (mine.lastReviewAt || mine.updatedAt || 0);
  const theirsAt = Number(rec.updatedAt) || 0;

  if (rec.deleted) {
    if (mine && theirsAt >= (mineAt || 0)) {
      const all = store.progress();
      delete all[id];
      store.write(store.KEYS.progress, all);
    }
    return true;
  }

  if (!mine || theirsAt > (mineAt || 0)) {
    const rec2 = Object.assign({}, theirs.rec, {
      lastReviewAt: theirsAt || mineAt || Date.now(),
      updatedAt: theirsAt
    });
    // 用 review-models 的 adopt 归一一次：服务端回来的字段可能与本机版本不同，
    // 直接塞进去会让 stageName / mastery 这些读不出来
    store.setRecord(id, R.adopt(rec2, store.settings().algo));
    return true;
  }
  return false;
}

/* ---------- 主流程 ---------- */

function request(path, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: auth.baseUrl() + path,
      method: "POST",
      data,
      timeout: 20000,
      header: {
        "content-type": "application/json",
        authorization: auth.token() ? "Bearer " + auth.token() : ""
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error((res.data && res.data.message) || "HTTP " + res.statusCode));
      },
      fail: (err) => reject(new Error((err && err.errMsg) || "网络不可用"))
    });
  });
}

/**
 * 跑一轮同步：先拉后推。
 *
 * 顺序不能反 —— 先推的话，本机的旧记录会覆盖服务端上更新的那一份。
 * 拉的时候带上 `since`，只取上次之后变化过的行。
 */
function run() {
  const g = gate();
  if (!g.ok) return Promise.resolve({ ok: false, reason: g.reason });

  const dev = deviceId();
  const since = store.read(KEYS.since, 0) || 0;

  return request("/api/sync/pull", { since, deviceId: dev })
    .then((data) => {
      const recs = (data && data.recs) || [];
      recs.forEach(applyRow);
      store.write(KEYS.since, (data && data.serverTime) || Date.now());

      const rows = outgoing();
      if (!rows.length) {
        return finish(recs.length, 0, "");
      }

      return request("/api/sync/push", { recs: rows, deviceId: dev }).then((res2) => {
        // 推成功就清出箱。这中间如果有新写入，出箱里会再出现，下一轮补上
        if (res2 && res2.applied >= 0) store.write(KEYS.outbox, {});
        return finish(recs.length, (res2 && res2.applied) || 0, "");
      });
    })
    .then((res3) => res3)
    .catch((err) => {
      const out = { ok: false, reason: err.message || "同步失败", at: Date.now() };
      store.write(KEYS.last, out);
      return out;
    });
}

function finish(pulled, pushed, extra) {
  const out = {
    ok: true,
    pulled,
    pushed,
    at: Date.now(),
    reason: extra || ""
  };
  store.write(KEYS.last, out);
  return out;
}

/**
 * 静默同步：界面在展示时调一次，失败什么都不说。
 *
 * 只在有后端、已登录、够档位且**真的有东西要同步**时才发请求 ——
 * 每次进「我的」都发一趟空请求，对后端不礼貌，也费电。
 */
function auto() {
  const g = gate();
  if (!g.ok) return Promise.resolve({ ok: false, reason: g.reason });
  if (!pendingCount() && !store.read(KEYS.since, 0)) {
    // 第一次同步，没有本地待推也要拉一次
  }
  return run();
}

function reset() {
  store.drop(KEYS.since);
  store.drop(KEYS.outbox);
  store.drop(KEYS.last);
}

module.exports = {
  KEYS,
  DAILY_EXTRA_ROW,
  COLLECTIONS_ROW,
  READ_PREFIX,
  deviceId,
  configured,
  gate,
  pendingCount,
  lastResult,
  enqueue,
  markDeleted,
  localRows,
  outgoing,
  applyRow,
  run,
  auto,
  reset
};
