const store = require("./store");
const wire = require("./wire");

function packedCloud() {
  try {
    return require("./server").cloud() || null;
  } catch (e) {
    return null;
  }
}

const SOURCE_PATH = "/api/v1";

const SOURCE_AGENT = "poem-source";

const SOURCE_TIMEOUT_MS = 10000;

const SESSION_FRESH_MS = 60 * 1000;

const PATHS = {
  login: "/api/wx/login",
  refresh: "/api/wx/refresh",
  pull: "/api/sync/pull",
  push: "/api/sync/push",
  accounts: "/api/admin/accounts",
  grant: "/api/admin/grant",
  role: "/api/admin/role",
  ranking: "/api/ranking",
  feedback: "/api/feedback",
  adminFeedback: "/api/admin/feedback",
  me: "/api/me",
  payCatalog: "/api/pay/catalog",
  payOrder: "/api/pay/order",
  payConfirm: "/api/pay/confirm",
  payManage: "/api/pay/manage",
  payOrders: "/api/pay/orders",
  adminPay: "/api/admin/pay"
};

function session() {
  return store.read(store.KEYS.auth, {}) || {};
}

function credentialBody(extra) {
  return Object.assign({ device: store.deviceId() }, extra || {});
}

function cloudOf() {
  return session().cloud || packedCloud();
}

function configured() {
  const a = session();
  return !!(a.baseUrl || cloudOf());
}

function cloudConfig() {
  const c = cloudOf() || {};
  return { env: String(c.env || ""), service: String(c.service || "") };
}

function baseUrl() {
  return session().baseUrl || "";
}

function sourceReady() {
  return configured();
}

function sourceQuery(params) {
  const parts = [];
  Object.keys(params || {}).forEach((k) => {
    const v = params[k];
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) {
      v.forEach((x) => parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(x))));
      return;
    }
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
  });
  return parts.length ? "?" + parts.join("&") : "";
}

function source(path, params, opt) {
  const trail = sourceQuery(params);
  if (!sourceReady()) return Promise.reject(sourceOffError());

  const timeout = Number((opt && opt.timeout) || SOURCE_TIMEOUT_MS);

  return sendTraced(
    SOURCE_PATH + path + trail,
    {},
    "GET",
    { agent: SOURCE_AGENT, timeout: timeout }
  );
}

function useCloud() {
  return !session().baseUrl && !!cloudOf();
}

function send(path, data, method, opt) {
  const o = opt || {};
  if (useCloud()) return sendCloud(path, data, method, o);
  return sendHttp(path, data, method, o);
}

function traceTarget(path, agent) {
  if (useCloud()) {
    const c = cloudConfig();
    return "cloud env=" + c.env + " service=" + (agent || c.service) + " path=" + path;
  }
  return "http " + baseUrl() + path;
}

function traceBody(data) {
  try {
    return JSON.stringify(data, (k, v) => (/token|code$/i.test(k) && typeof v === "string" ? v.slice(0, 6) + "…(" + v.length + ")" : v));
  } catch (e) {
    return String(data);
  }
}

function sendTraced(path, data, method, opt) {
  const verb = method || "POST";
  const o = opt || {};
  const started = Date.now();
  const head = "[remote] " + verb + " " + traceTarget(path, o.agent);
  console.log(head, "body=" + traceBody(data), "auth=" + (session().accessToken ? "Bearer" : "none"));
  let status = 0;
  const pending = send(path, data, method, Object.assign({}, o, { onStatus: (code) => { status = code; } }));
  return pending.then(
    (res) => {
      console.log(head, "HTTP " + status, "OK", Date.now() - started + "ms", "res=" + traceBody(res));
      return res;
    },
    (err) => {
      console.error(head, "HTTP " + ((err && err.statusCode) || 0), "FAIL", Date.now() - started + "ms", {
        statusCode: err && err.statusCode,
        code: err && err.code,
        errMsg: err && err.errMsg,
        message: err && err.message
      });
      throw err;
    }
  );
}

let cloudReadyEnv = "";

function cloudError(message, code) {
  const err = new Error(message);
  err.code = code || "E_CLOUD";
  err.expected = true;
  return err;
}

function cloudOffError() {
  return cloudError(
    "这个运行环境没有云开发功能（wx.cloud 不在）—— " +
    "开发者工具里要在 project.config.json 的 cloudfunctionRoot 或" +
    "「云开发」面板上开通，真机则要小程序已开通云开发。",
    "E_CLOUD_OFF"
  );
}

function cloudInitError(env, e) {
  return cloudError(
    "wx.cloud.init 没成功（env=" + env + "）：" +
    ((e && (e.errMsg || e.message)) || "无回话") +
    "\n  多为这一格不是云开发环境 ID，或这个小程序还没开通云开发。",
    "E_CLOUD_INIT"
  );
}

function cloudReady(env) {
  if (!wx.cloud || typeof wx.cloud.init !== "function") return Promise.reject(cloudOffError());
  if (!env || cloudReadyEnv === env) return null;

  let refusal = null;
  try {
    wx.cloud.init({
      env: env,
      traceUser: false,
      fail: (e) => { refusal = cloudInitError(env, e); }
    });
  } catch (e) {
    return Promise.reject(cloudInitError(env, e));
  }
  if (refusal) return Promise.reject(refusal);
  cloudReadyEnv = env;
  return null;
}

function sendCloud(path, data, method, opt) {
  const conf = cloudConfig();
  const gate = cloudReady(conf.env);
  if (gate) return gate;
  const o = opt || {};
  return cloudCall(conf, path, data, method, o);
}

const CLOUD_TIMEOUT_MS = 15000;

function cloudCall(conf, path, data, method, opt) {
  const o = opt || {};
  const service = o.agent || conf.service;
  return new Promise((resolve, reject) => {
    wx.cloud.callContainer({
      config: { env: conf.env },
      path: path,
      method: method || "POST",
      header: {
        "content-type": "application/json",
        "X-WX-SERVICE": service,
        authorization: session().accessToken ? "Bearer " + session().accessToken : ""
      },
      data: data,
      timeout: Number(o.timeout) || CLOUD_TIMEOUT_MS,
      success: (res) => {
        if (o.onStatus) o.onStatus(res.statusCode);
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(httpError(res.statusCode, res.data));
      },
      fail: (err) => reject(cloudFailError(err, conf, service))
    });
  });
}

function sourceOffError() {
  const e = new Error("还没接上课外阅读（取诗的那个服务）—— 这个包没配同步服务器");
  e.code = "E_POEM_SOURCE_OFF";
  e.expected = true;
  return e;
}

function cloudFailError(err, conf, agent) {
  const say = (err && err.errMsg) || "云调用不通";
  const err2 = new Error(
    say + "\n  调用目标：环境 " + (conf.env || "(空)") + " / 服务 " + (agent || conf.service || "(空)") +
    " —— " + cloudFailHint(say)
  );
  err2.errMsg = say;
  err2.env = conf.env || "";
  err2.service = agent || conf.service || "";
  err2.cloudFail = true;
  return err2;
}

function cloudFailHint(say) {
  if (/invalid host/i.test(say)) {
    return "平台按上面那个服务名找不到可路由的服务 —— 您这个小程序的云托管里没有这个名字" +
      "（没建，或建在别的环境里）。服务名逐字取自云托管「服务管理」，不是云开发环境 ID。";
  }
  if (/102002/.test(say)) {
    return "多为请求超时：云托管实例缩容到 0 后冷启动超过了等待时间，稍后重试；" +
      "要根治就把服务的最小实例数设为 1。若重试仍是 102002，再核对环境 ID 是不是这个小程序名下的";
  }
  return "环境 ID 对不上这个小程序的云开发环境时，平台会回 env not exists 这类话";
}

function hostError(err, baseUrl) {
  const e = new Error((err && err.errMsg) || "网络不可用");
  e.errMsg = e.message;
  e.baseUrl = baseUrl || "";
  try {
    e.host = String(baseUrl || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  } catch (x) {
    e.host = "";
  }
  return e;
}

function httpError(statusCode, data) {
  const body = data && typeof data === "object" ? data : {};
  const say = body.message || body.error_description || "";
  const err = new Error(say || plainStatusError(statusCode));
  err.statusCode = statusCode;
  err.code = body.code || body.error || "";
  err.retryAfter = Number(body.retryAfter) || 0;
  return err;
}

function plainStatusError(statusCode) {
  if (statusCode === 400) {
    return "这次请求没被收下（HTTP 400）—— 云调用两栏多半没配对（环境 / 服务名）。";
  }
  if (statusCode === 404) return "这个接口没找到（HTTP 404）—— 装上来的这一版和那头不是同一版。";
  return "HTTP " + statusCode;
}

function sendHttp(path, data, method, opt) {
  const verb = String(method || "POST").toUpperCase();
  const body = verb === "GET" ? undefined : data;
  const o = opt || {};
  return new Promise((resolve, reject) => {
    wx.request({
      url: baseUrl() + path,
      method: verb,
      data: body,
      timeout: Number(o.timeout) || 0,
      header: {
        "content-type": "application/json",
        authorization: session().accessToken ? "Bearer " + session().accessToken : ""
      },
      success: (res) => {
        if (o.onStatus) o.onStatus(res.statusCode);
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(httpError(res.statusCode, res.data));
      },
      fail: (err) => reject(hostError(err, baseUrl()))
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

  return sendTraced(path, data, method)["catch"]((err) => {
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
      wire.clearRecords(all);
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

function failure(err) {
  const e = err || {};
  return {
    sim: false,
    error: e.message || "同步失败",
    statusCode: Number(e.statusCode) || 0,
    code: e.code || "",
    retryAfter: Number(e.retryAfter) || 0
  };
}

function sync() {
  if (!configured()) return Promise.resolve({ sim: true, pulled: 0, pushed: 0 });
  return pull()
    .then((a) => push().then((b) => ({ sim: false, pulled: a.applied, pushed: b.pushed })))
    ["catch"]((err) => failure(err));
}

function adminReady() {
  return !!(configured() && authMod().isAdmin());
}

function authMod() {
  return require("./auth");
}

let sessionAt = 0;
let sessionPending = null;

function sessionRefresh() {
  if (!configured()) return Promise.resolve(false);
  if (sessionPending) return sessionPending;
  if (sessionAt && Date.now() - sessionAt < SESSION_FRESH_MS) return Promise.resolve(false);
  sessionPending = authMod()
    .refresh()
    .then((r) => {
      sessionAt = Date.now();
      sessionPending = null;
      return !!(r && !r.local);
    })
    ["catch"](() => {
      sessionAt = Date.now();
      sessionPending = null;
      return false;
    });
  return sessionPending;
}

function listUsers() {
  if (!adminReady()) return Promise.resolve({ users: [], sim: true });
  return request(PATHS.accounts, { deviceId: store.deviceId() }).then((res) => ({
    users: (res && res.accounts) || [],
    total: (res && res.total) || 0,
    createdAt: (res && res.createdAt) || [],
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

function rankingVisible(game) {
  if (!configured()) return Promise.resolve({ on: false, offline: true });
  return request(PATHS.ranking, { op: "visible", game: game }).then((res) => ({
    on: !!(res && res.on),
    offline: false
  }));
}

function rankingList(query) {
  if (!configured()) return Promise.resolve({ ok: false, offline: true, board: [] });
  return request(PATHS.ranking, Object.assign({ op: "list" }, query || {})).then(
    (res) => ({
      ok: true,
      offline: false,
      board: (res && res.board) || [],
      me: (res && res.me) || null,
      total: (res && res.total) || 0,
      size: (res && res.size) || 0,
      label: (res && res.label) || "",
      filter: (res && res.filter) || null
    }),
    (err) => ({
      ok: false,
      offline: !!(err && err.statusCode && err.statusCode === 503),
      off: !!(err && err.code === "E_RANKING_OFF"),
      board: [],
      reason: (err && err.message) || "榜单没读上来"
    })
  );
}

function rankingSubmit(entry) {
  if (!configured()) return Promise.resolve({ ok: false, offline: true, off: false });
  return request(PATHS.ranking, Object.assign({ op: "submit" }, entry || {})).then(
    (res) => ({
      ok: !!(res && res.recorded),
      on: !!(res && res.on),
      off: false,
      offline: false
    }),
    (err) => ({
      ok: false,
      on: false,
      off: !!(err && err.code === "E_RANKING_OFF"),
      offline: !!(err && err.statusCode === 503)
    })
  );
}

function rankingDelete(game, srid) {
  if (!configured()) return Promise.resolve({ ok: false, offline: true });
  return request(PATHS.ranking, { op: "delete", game: game, srid: srid }).then(
    (res) => ({ ok: !!(res && res.deleted), offline: false }),
    (err) => ({ ok: false, offline: !!(err && err.statusCode === 503) })
  );
}

function feedbackMine() {
  if (!configured()) return Promise.resolve({ threads: [], offline: true });
  return request(PATHS.feedback, { deviceId: store.deviceId() }, "GET").then(
    (res) => ({ threads: (res && res.threads) || [], offline: false }),
    (err) => ({ threads: [], offline: true, reason: (err && err.message) || "" })
  );
}

function feedbackCreate(entry) {
  if (!configured()) return Promise.resolve({ ok: false, offline: true });
  return request(PATHS.feedback, Object.assign({ deviceId: store.deviceId() }, entry || {})).then(
    (res) => ({ ok: true, thread: res && res.thread, duplicate: !!(res && res.duplicate) }),
    (err) => ({ ok: false, reason: (err && err.message) || "没发出先去", code: (err && err.code) || "" })
  );
}

function feedbackComment(tid, content) {
  if (!configured()) return Promise.resolve({ ok: false, offline: true });
  return request(PATHS.feedback, {
    op: "comment", tid: tid, content: content, deviceId: store.deviceId()
  }).then(
    (res) => ({ ok: true, comment: res && res.comment }),
    (err) => ({ ok: false, reason: (err && err.message) || "没发出去" })
  );
}

function adminFeedbackList(status) {
  if (!adminReady()) return Promise.resolve({ ok: false, threads: [], counts: {} });
  return request(PATHS.adminFeedback, { op: "list", status: status || "all" }).then(
    (res) => ({
      ok: true,
      threads: (res && res.threads) || [],
      counts: (res && res.counts) || {}
    }),
    (err) => ({ ok: false, threads: [], counts: {}, reason: (err && err.message) || "" })
  );
}

function adminFeedbackThread(tid) {
  if (!adminReady()) return Promise.resolve({ ok: false });
  return request(PATHS.adminFeedback, { op: "thread", tid: tid }).then(
    (res) => ({ ok: true, thread: res && res.thread }),
    (err) => ({ ok: false, reason: (err && err.message) || "" })
  );
}

function adminFeedbackDelete(tid, cid) {
  if (!adminReady()) return Promise.resolve({ ok: false });
  const body = { op: "delete" };
  if (tid) body.tid = tid;
  if (cid) body.cid = cid;
  return request(PATHS.adminFeedback, body).then(
    (res) => ({ ok: true, deleted: res && res.deleted }),
    (err) => ({ ok: false, reason: (err && err.message) || "没删成" })
  );
}

function adminFeedbackReply(entry) {
  if (!adminReady()) return Promise.resolve({ ok: false });
  return request(PATHS.adminFeedback, Object.assign({ op: "reply" }, entry || {})).then(
    (res) => ({ ok: true, status: res && res.status, resolution: res && res.resolution }),
    (err) => ({ ok: false, reason: (err && err.message) || "" })
  );
}

module.exports = {
  PATHS,
  SOURCE_AGENT,
  credentialBody,
  wire,
  configured,
  baseUrl,
  useCloud,
  source,
  sourceReady,
  cloudConfig,
  request,
  sync,
  push,
  pull,
  pack,
  adminReady,
  sessionRefresh,
  listUsers,
  setUserTier,
  revokeUserTier,
  setUserRole,
  rankingVisible,
  rankingList,
  rankingSubmit,
  rankingDelete,
  feedbackMine,
  feedbackCreate,
  feedbackComment,
  adminFeedbackList,
  adminFeedbackThread,
  adminFeedbackReply,
  adminFeedbackDelete
};
