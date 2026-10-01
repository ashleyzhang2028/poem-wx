/**
 * 后端契约层。**接口都还没有**，所以这里的价值不在「实现了什么」，
 * 而在把「调什么、传什么、失败了怎么办」写死，让后端就绪后只需要填 baseUrl。
 *
 * 四组接口：
 *   账号   /api/wx/login       /api/wx/refresh
 *   同步   /api/sync/pull      /api/sync/push
 *   TTS    /api/tts/synth      正文合成，返回一个有时效的音频 URL
 *   管理   /api/admin/accounts|grant|role   改档位与角色（只在服务端可写）
 *
 * 未配置时**一律降级**，绝不假装成功：
 *   - 同步：本机照常用，队列攒着，联网后一次推
 *   - TTS：readiness() 报 awaiting，界面把播放按钮显示成「待开通」
 *   - 管理：名录只读，档位卡片点下去说明「本机标记」，不写服务端
 */
const store = require("./store");

/**
 * 接口路径。**两套并存，不是笔误**：
 *
 *   微信登录   /api/wx/*      —— 新写的，后端要加（code2Session 换 openid）
 *   同步与管理 /api/*         —— 复用 poem 已上线的那几个：
 *                               /api/sync/pull|push、/api/admin/accounts|grant|role
 *
 * 同步与管理**刻意复用 poem 的路径与报文形状**，因为那边已经跑在
 * Supabase 上了。小程序端另起一套，等于同一份进度要走两条入库逻辑，
 * 迟早有一边先写出「旧数据覆盖新数据」。要接后端时，先接微信登录那一层。
 */
const PATHS = {
  login: "/api/wx/login",
  refresh: "/api/wx/refresh",
  pull: "/api/sync/pull",
  push: "/api/sync/push",
  speech: "/api/tts/synth",
  accounts: "/api/admin/accounts",
  grant: "/api/admin/grant",
  role: "/api/admin/role",
  me: "/api/me"
};

/** 读 auth 存储域（与模块 utils/auth.js 不是一回事，这里只取会话本身） */
function session() {
  return store.read(store.KEYS.auth, {}) || {};
}

function configured() {
  return !!session().baseUrl;
}

function baseUrl() {
  return session().baseUrl || "";
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
        authorization: session().accessToken ? "Bearer " + session().accessToken : ""
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
  return request(PATHS.pull, { device: device, since: session().since || 0 }).then((data) => {
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
  const a = session();
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

/**
 * 管理接口就绪判据。**不看本地密钥，看会话里的角色** ——
 * 密钥是网页版后台那套（服务端 service key 由运维持有），小程序端
 * 不该有一份。能不能改别人，由服务端按 uid + 角色判，客户端只负责显示。
 *
 * 这一条与网页版 `api/_lib/core.js` 的 adminGate 同源：
 *   没登录 → 401；角色不是 owner/admin → 403。
 *
 * ⚠️ 判据是 auth.isAdmin()（会话里的角色），不是 baseUrl 里有没有密钥。
 *   别写成 auth.isAdmin（少一对括号）—— 函数对象恒为真，
 *   「配了后端就等于管理员」，这一句会一路绿灯到线上。
 */
function adminReady() {
  return !!(configured() && authMod().isAdmin());
}

/**
 * 会话里的角色。**惰性 require**：auth.js 顶层要读本模块的 PATHS，
 * 在顶部直接 require 会绕成环（先加载谁，另一个就是空对象）。
 * 用的时候才取一次，环就断了。
 */
function authMod() {
  return require("./auth");
}

/** 名录。**走 POST**：与 poem 的 /api/admin/accounts 一致，避免 GET 带 token 被缓存 */
function listUsers() {
  if (!adminReady()) return Promise.resolve({ users: [], sim: true });
  return request(PATHS.accounts, { deviceId: store.deviceId() }).then((res) => ({
    users: (res && res.accounts) || [],
    total: (res && res.total) || 0,
    note: (res && res.note) || "",
    sim: false
  }));
}

/**
 * 改档位。报文形状照抄 poem 的 /api/admin/grant：
 *   { uid, tier, until, deviceId }  until 为毫秒时间戳，留空即永久
 */
function setUserTier(uid, tier, until) {
  if (!adminReady()) return Promise.resolve({ ok: false, sim: true });
  return request(PATHS.grant, { uid: uid, tier: tier, until: until || null, deviceId: store.deviceId() }).then(
    (res) => ({
      ok: !!(res && (res.changed === undefined || res.changed)),
      matched: (res && res.matched) || 0,
      changed: !!(res && res.changed),
      before: (res && res.before) || "",
      note: (res && res.note) || "",
      sim: false
    })
  );
}

/** 回收：降回 free。poem 那边是 DELETE /api/admin/grant */
function revokeUserTier(uid) {
  if (!adminReady()) return Promise.resolve({ ok: false, sim: true });
  return request(PATHS.grant, { uid: uid, deviceId: store.deviceId() }, "DELETE").then((res) => ({
    ok: true,
    note: (res && res.note) || "",
    sim: false
  }));
}

/** 改角色。只有 owner 能改 —— 服务端会挡，客户端只做按钮显隐 */
function setUserRole(uid, role) {
  if (!adminReady()) return Promise.resolve({ ok: false, sim: true });
  return request(PATHS.role, { uid: uid, role: role, deviceId: store.deviceId() }).then((res) => ({
    ok: true,
    changed: !!(res && res.changed),
    note: (res && res.note) || "",
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
  setUserTier,
  revokeUserTier,
  setUserRole
};
