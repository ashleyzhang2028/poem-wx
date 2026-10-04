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
const wire = require("./wire");

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
        else {
          // 429：同设备同步太频繁。界面要为此说一句人话
          // （「刚同步过，过会儿再来」），所以把状态码挂在 error 上 ——
          // 只留一句 "HTTP 429" 的话，调用方只能靠字符串匹配去猜。
          const err = new Error("HTTP " + res.statusCode);
          err.statusCode = res.statusCode;
          err.code = (res.data && res.data.error) || "";
          reject(err);
        }
      },
      fail: (err) => reject(new Error((err && err.errMsg) || "网络不可用"))
    });
  });
}

/* ---------- 云端同步 ---------- */

const CHUNK = 100;

/**
 * 本机数据打成服务端认的形状。**形状由 utils/wire.js 定**，
 * 这里只负责「分批、发出去、失败怎么办」。
 *
 * 上一版把本机形状直接当报文发：进度行发的是 `{ id, kind, rec, at }`，
 * 而服务端 `api/_lib/core.js` 的 syncPushInner 读的是 `{ id, payload, updatedAt }` ——
 * 缺 payload 的行被当成空记录，缺 updatedAt 的行被判 E_BAD_REC 整批退回来。
 * 也就是说：**接上后端的那一刻，同步是坏的，而且报错指向服务端。**
 * 所以这一版把报文形状收进 wire.js，并在自检里按服务端的读法反过来验一遍。
 */
function pack() {
  return { device: store.deviceId(), recs: wire.packRecords() };
}

function chunked(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 推。分批发。服务端一次最多 2000 条，这里 100 一条，留足余量给重试。 */
function push() {
  const mem = pack();
  const recs = mem.recs;
  if (!recs.length) return Promise.resolve({ pushed: 0, sim: !configured() });

  if (!configured()) {
    // 没后端：把没推上去的留着，别丢 —— 但也不能无限涨。
    // 留的是**服务端形状**的 recs，下一批直接拼上就行，不必再转一次。
    store.write(store.KEYS.sync, { recs: recs.slice(-500), at: Date.now() });
    return Promise.resolve({ pushed: 0, queued: recs.length, sim: true });
  }

  // 上次没推上去的先拼上。同一 id 以新的为准 —— 服务端按 updatedAt 条件 upsert，
  // 但同一批里出现两条同 id 是浪费，也容易让日志看着像出了错。
  const outbox = store.read(store.KEYS.sync, {}) || {};
  const byId = {};
  (outbox.recs || []).concat(recs).forEach((r) => {
    if (!r || !r.id) return;
    const prev = byId[r.id];
    if (!prev || (r.updatedAt || 0) >= (prev.updatedAt || 0)) byId[r.id] = r;
  });
  const all = Object.keys(byId).map((k) => byId[k]);

  const batches = chunked(all, CHUNK);
  return batches
    .reduce(
      (chain, batch) =>
        chain.then(() =>
          request(PATHS.push, {
            deviceId: mem.device,
            recs: batch
          })
        ),
      Promise.resolve()
    )
    .then(() => {
      store.drop(store.KEYS.sync);
      return { pushed: all.length, sim: false };
    });
}

/**
 * 拉。服务端从 `since` 之后的变化，回的是 `{ recs: [{ id, payload, updatedAt, deleted }] }`。
 *
 * 上一版读的是 `data.rows`（服务端没有这个字段），于是**拉永远拉回 0 条**：
 * 不报错、不提示，就是「同步成功但什么也没发生」。这类 bug 最难被发现，
 * 因为界面上写着「已同步」。
 */
function pull() {
  if (!configured()) return Promise.resolve({ applied: 0, sim: true });
  const device = store.deviceId();
  const since = Number(session().since || 0);
  return request(PATHS.pull, { deviceId: device, since: since }).then((data) => {
    const recs = (data && (data.recs || data.rows)) || [];
    const applied = wire.applyRecords(recs);
    const serverTime = Number((data && data.serverTime) || 0) || Date.now();

    // since 只往前推：往后拨会让下一次拉漏掉中间的变化
    const auth = store.read(store.KEYS.auth, {}) || {};
    if (serverTime > since) {
      auth.since = serverTime;
      store.write(store.KEYS.auth, auth);
    }
    store.saveSettings({ lastSyncAt: Date.now() });
    return { applied: applied, sim: false };
  });
}

/** 双向同步：先拉后推。顺序反了，本机的旧记录会盖掉服务端更新的一份。 */
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
  wire,
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
