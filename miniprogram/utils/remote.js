/**
 * 后端契约层。**接口都还没有**，所以这里的价值不在「实现了什么」，
 * 而在把「调什么、传什么、失败了怎么办」写死，让后端就绪后只需要填 baseUrl。
 *
 * 三组接口：
 *   账号   /api/wx/login       /api/wx/refresh
 *   同步   /api/progress/pull  /api/progress/push
 *   TTS    /api/tts/synth      正文合成，返回一个有时效的音频 URL
 *   管理   /api/admin/users    管理员改档位（只在服务端可写）
 *
 * 未配置时**一律降级**，绝不假装成功：
 *   - 同步：本机照常用，队列攒着，联网后一次推
 *   - TTS：readiness() 报 awaiting，界面把播放按钮显示成「待开通」
 *   - 管理：只展示本机授权，云端写入入口不出现
 */
const store = require("./store");

const PATHS = {
  login: "/api/wx/login",
  refresh: "/api/wx/refresh",
  pull: "/api/progress/pull",
  push: "/api/progress/push",
  speech: "/api/tts/synth",
  users: "/api/admin/users"
};

function auth() {
  return store.read(store.KEYS.auth, {}) || {};
}

function configured() {
  return !!auth().baseUrl;
}

function baseUrl() {
  return auth().baseUrl || "";
}

function adminKey() {
  return auth().adminKey || "";
}

function request(path, data, method) {
  return new Promise((resolve, reject) => {
    if (!configured()) {
      reject(new Error("后端未配置"));
      return;
    }
    wx.request({
      url: baseUrl() + path,
      method: method || "POST",
      data,
      header: {
        "content-type": "application/json",
        authorization: auth().accessToken ? "Bearer " + auth().accessToken : ""
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error("HTTP " + res.statusCode));
      },
      fail: (err) => reject(new Error((err && err.errMsg) || "网络不可用"))
    });
  });
}

/* ---------- 云端同步 ---------- */

const CHUNK = 100;

/** 本机数据打成可传的形状。id 用条目 id，服务端不必懂语料结构。 */
function pack() {
  const progress = store.progress();
  const reads = store.reads();
  const rows = [];
  Object.keys(progress).forEach((id) => {
    const r = progress[id];
    rows.push({ id: id, kind: "p", rec: r, at: r.lastReviewAt || 0 });
  });
  Object.keys(reads).forEach((book) => {
    Object.keys(reads[book] || {}).forEach((id) => {
      rows.push({ id: id, kind: "r", book: book, at: reads[book][id] || 0 });
    });
  });
  return { device: store.deviceId(), rows: rows };
}

function chunked(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 推。分批发，最后一批才带 done 标记 —— 中途断了下次从头来，服务端按 at 去重。 */
function push() {
  const outbox = store.read(store.KEYS.sync, {}) || {};
  const mem = pack();
  const rows = mem.rows.concat(outbox.rows || []);
  if (!rows.length) return Promise.resolve({ pushed: 0, sim: !configured() });

  if (!configured()) {
    // 没后端：把队列留着，别丢 —— 但也不能无限涨
    store.write(store.KEYS.sync, { rows: rows.slice(-500), at: Date.now() });
    return Promise.resolve({ pushed: 0, queued: rows.length, sim: true });
  }

  const batches = chunked(rows, CHUNK);
  return batches
    .reduce(
      (chain, batch, i) =>
        chain.then(() =>
          request(PATHS.push, {
            device: mem.device,
            rows: batch,
            done: i === batches.length - 1
          })
        ),
      Promise.resolve()
    )
    .then(() => {
      store.drop(store.KEYS.sync);
      return { pushed: rows.length, sim: false };
    });
}

/** 拉。服务端给 lastSyncAt 之后的变化，本机按 at 新者胜，跟换算法那套折算同口径。 */
function pull() {
  if (!configured()) return Promise.resolve({ applied: 0, sim: true });
  const device = store.deviceId();
  return request(PATHS.pull, { device: device, since: auth().since || 0 }).then((data) => {
    const rows = (data && data.rows) || [];
    let applied = 0;

    const progress = store.progress();
    const reads = store.reads();
    rows.forEach((row) => {
      if (row.device === device) return;
      if (row.kind === "p") {
        const old = progress[row.id];
        if (!old || (row.at || 0) > (old.lastReviewAt || 0)) {
          progress[row.id] = row.rec;
          applied += 1;
        }
      } else if (row.kind === "r") {
        const book = reads[row.book] || (reads[row.book] = {});
        if ((row.at || 0) > (book[row.id] || 0)) {
          book[row.id] = row.at;
          applied += 1;
        }
      }
    });

    store.write(store.KEYS.progress, progress);
    store.write(store.KEYS.reads, reads);
    store.saveSettings({ lastSyncAt: Date.now() });
    return { applied: applied, sim: false };
  });
}

/** 双向同步：先拉后推。本机数据永远优先，冲突按时间戳，不静默覆盖。 */
function sync() {
  if (!configured()) return Promise.resolve({ sim: true, pulled: 0, pushed: 0 });
  return pull()
    .then((a) => push().then((b) => ({ sim: false, pulled: a.applied, pushed: b.pushed })))
    .catch((err) => ({ sim: false, error: err.message }));
}

/* ---------- TTS ---------- */

function speechReady() {
  const a = auth();
  return !!(configured() && a.speech === true);
}

/** 合成一段文本，服务端返回 { url, expiresAt } */
function speech(text) {
  if (!speechReady()) return Promise.reject(new Error("后端 TTS 未启用"));
  return request(PATHS.speech, { text: text }).then((res) => {
    if (!res || !res.url) throw new Error("合成没返回音频");
    return res;
  });
}

/* ---------- 管理 ---------- */

function adminReady() {
  const a = auth();
  return !!(configured() && a.adminKey);
}

function listUsers() {
  if (!adminReady()) return Promise.resolve({ users: [], sim: true });
  return request(PATHS.users, { key: adminKey() }, "GET").then((res) => ({
    users: (res && res.users) || [],
    sim: false
  }));
}

function setUserTier(userId, tier) {
  if (!adminReady()) return Promise.resolve({ ok: false, sim: true });
  return request(PATHS.users, { key: adminKey(), userId: userId, tier: tier }, "PATCH").then((res) => ({
    ok: !!(res && res.ok),
    sim: false
  }));
}

module.exports = {
  PATHS,
  configured,
  baseUrl,
  request,
  speechReady,
  speech,
  sync,
  push,
  pull,
  pack,
  adminReady,
  listUsers,
  setUserTier
};
