const store = require("./store");
const wire = require("./wire");

const SHARD_PATH = "/api/shard/";

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

function session() {
  return store.read(store.KEYS.auth, {}) || {};
}

function credentialBody(extra) {
  return Object.assign({ device: store.deviceId() }, extra || {});
}

function configured() {
  const a = session();
  return !!(a.baseUrl || (a.cloud && a.cloud.env && a.cloud.service));
}

function cloudConfig() {
  const c = session().cloud || {};
  return { env: String(c.env || ""), service: String(c.service || "") };
}

function baseUrl() {
  return session().baseUrl || "";
}

function shardReady() {
  return configured();
}

function shard(name) {
  if (!shardReady()) return Promise.reject(new Error("分片服务没接上"));
  return send(SHARD_PATH + name, {}, "GET");
}

function useCloud() {
  return !session().baseUrl && !!session().cloud;
}

function send(path, data, method) {
  if (useCloud()) return sendCloud(path, data, method);
  return sendHttp(path, data, method);
}

function sendCloud(path, data, method) {
  const conf = cloudConfig();
  return new Promise((resolve, reject) => {
    wx.cloud.callContainer({
      config: { env: conf.env },
      path: path,
      method: method || "POST",
      header: {
        "content-type": "application/json",
        "X-WX-SERVICE": conf.service,
        authorization: session().accessToken ? "Bearer " + session().accessToken : ""
      },
      data: data,
      success: (res) => (res.statusCode >= 200 && res.statusCode < 300
        ? resolve(res.data)
        : reject(httpError(res.statusCode, res.data))),
      fail: (err) => reject(new Error((err && err.errMsg) || "云调用不通"))
    });
  });
}

function httpError(statusCode, data) {
  const body = data || {};
  const say = body.message || body.error_description || "";
  const err = new Error(say || "HTTP " + statusCode);
  err.statusCode = statusCode;
  err.code = body.code || body.error || "";
  return err;
}

function sendHttp(path, data, method) {
  return new Promise((resolve, reject) => {
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

        else reject(httpError(res.statusCode, res.data));
      },
      fail: (err) => reject(new Error((err && err.errMsg) || "网络不可用"))
    });
  });
}

const SESSION_GONE = ["E_NO_SESSION", "E_SESSION"];

let refreshing = null;

function refreshOnce() {
  if (!refreshing) {
    refreshing = Promise.resolve()
      .then(() => authMod().refresh())
      ["catch"](() => null)
      .then((r) => {
        refreshing = null;
        return r;
      });
  }
  return refreshing;
}

function request(path, data, method, retried) {
  if (!configured()) return Promise.reject(new Error("同步服务未开通"));
  const isCredential = path === PATHS.login || path === PATHS.refresh;

  return send(path, data, method)["catch"]((err) => {
    if (retried || isCredential) throw err;
    if (err.statusCode !== 401) throw err;
    if (SESSION_GONE.indexOf(err.code) < 0) throw err;
    if (!session().refreshToken) throw err;

    return refreshOnce().then((fresh) => {

      if (!fresh || fresh.local || !session().accessToken) throw err;
      return request(path, data, method, true);
    });
  });
}

const CHUNK = 100;

function pack() {
  return { device: store.deviceId(), recs: wire.packRecords() };
}

function chunked(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function push() {
  const mem = pack();
  const recs = mem.recs;
  if (!recs.length) return Promise.resolve({ pushed: 0, sim: !configured() });

  if (!configured()) {

    store.write(store.KEYS.sync, { recs: recs.slice(-500), at: Date.now() });
    return Promise.resolve({ pushed: 0, queued: recs.length, sim: true });
  }

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

function pull() {
  if (!configured()) return Promise.resolve({ applied: 0, sim: true });
  const device = store.deviceId();
  const since = Number(session().since || 0);
  return request(PATHS.pull, { deviceId: device, since: since }).then((data) => {
    const recs = (data && (data.recs || data.rows)) || [];
    const applied = wire.applyRecords(recs);
    const serverTime = Number((data && data.serverTime) || 0) || Date.now();

    const auth = store.read(store.KEYS.auth, {}) || {};
    if (serverTime > since) {
      auth.since = serverTime;
      store.write(store.KEYS.auth, auth);
    }
    store.saveSettings({ lastSyncAt: Date.now() });
    return { applied: applied, sim: false };
  });
}

function sync() {
  if (!configured()) return Promise.resolve({ sim: true, pulled: 0, pushed: 0 });
  return pull()
    .then((a) => push().then((b) => ({ sim: false, pulled: a.applied, pushed: b.pushed })))
    .catch((err) => ({ sim: false, error: err.message }));
}

function speechReady() {
  const a = session();
  return !!(configured() && a.speech === true);
}

function speech(text) {
  if (!speechReady()) return Promise.reject(new Error("朗读服务未开通"));
  return request(PATHS.speech, { text: text }).then((res) => {
    if (!res || !res.url) throw new Error("合成没返回音频");
    return res;
  });
}

function adminReady() {
  return !!(configured() && authMod().isAdmin());
}

function authMod() {
  return require("./auth");
}

function listUsers() {
  if (!adminReady()) return Promise.resolve({ users: [], sim: true });
  return request(PATHS.accounts, { deviceId: store.deviceId() }).then((res) => ({
    users: (res && res.accounts) || [],
    total: (res && res.total) || 0,
    note: (res && res.note) || "",
    sim: false
  }));
}

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

function revokeUserTier(uid) {
  if (!adminReady()) return Promise.resolve({ ok: false, sim: true });
  return request(PATHS.grant, { uid: uid, deviceId: store.deviceId() }, "DELETE").then((res) => ({
    ok: true,
    note: (res && res.note) || "",
    sim: false
  }));
}

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
  credentialBody,
  wire,
  configured,
  baseUrl,
  useCloud,
  shard,
  shardReady,
  cloudConfig,
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
