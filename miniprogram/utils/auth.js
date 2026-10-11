const store = require("./store");
const remote = require("./remote");

function pullAfterLogin() {
  try {
    return require("./sync").now(true) || Promise.resolve({ skipped: "offline" });
  } catch (e) {
    return Promise.resolve({ skipped: "offline" });
  }
}

const REMOTE = {
  login: remote.PATHS.login,
  refresh: remote.PATHS.refresh,
  me: remote.PATHS.me
};

function configured() {
  return remote.configured();
}

function baseUrl() {
  return remote.baseUrl();
}

function request(path, data, method) {
  return remote.request(path, data, method);
}

function applySession(data) {
  const auth = store.read(store.KEYS.auth, {}) || {};

  offlineKind = "";
  delete auth.offline;
  delete auth.offlineAt;
  delete auth.loginCode;
  delete auth.codeAt;
  auth.accessToken = data.accessToken || auth.accessToken || "";
  auth.refreshToken = data.refreshToken || auth.refreshToken || "";
  auth.expiresAt = Date.now() + (data.expiresIn || 604800) * 1000;
  auth.local = false;
  auth.baseUrl = auth.baseUrl || baseUrl();
  if (data.tier) auth.tier = data.tier;
  if (data.role) auth.role = data.role;
  if (data.signedGrant) auth.signedGrant = data.signedGrant;
  store.write(store.KEYS.auth, auth);

  if (data.caps && typeof data.caps === "object") store.write(store.KEYS.caps, data.caps);

  const patch = {
    logged: true,
    tier: data.tier || "",
    tierFromServer: !!data.tier,
    userId: data.userId || store.profile().userId || ""
  };
  const nick = data.nickname || store.profile().nickname;
  if (nick && nick !== store.profile().nickname) patch.nickname = nick;
  if (!store.profile().nickname && !nick) patch.nickname = "我的古诗词";
  store.saveSession(patch);
  return data;
}

let offlineKind = "";

function markOffline(kind) {
  offlineKind = String(kind || "off");
  store.write(store.KEYS.auth, Object.assign(store.read(store.KEYS.auth, {}) || {}, {
    offline: offlineKind,
    offlineAt: Date.now()
  }));
  return offlineKind;
}

function login() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (!res.code) {
          reject(new Error("wx.login 未返回 code"));
          return;
        }

        if (!configured()) {

          markOffline("off");
          const auth = store.read(store.KEYS.auth, {}) || {};
          auth.loginCode = res.code;
          auth.codeAt = Date.now();
          delete auth.code;
          delete auth.local;
          store.write(store.KEYS.auth, auth);
          store.saveSession({ logged: false, tier: "", tierFromServer: false });
          resolve({ local: true, offline: "off" });
          return;
        }

        request(REMOTE.login, remote.credentialBody({ code: res.code }))

          .then(applySession)
          .then((data) =>
            pullAfterLogin().then((r) => Object.assign({}, data, { synced: !(r && r.skipped) }))
          )
          .then(resolve)
          .catch((err) => {

            markOffline("cloud");
            reject(err);
          });
      },
      fail: () => {
        markOffline("off");
        reject(new Error("微信登录失败"));
      }
    });
  });
}

function applyMe(me) {
  if (!me || !me.uid) return null;
  const plan = me.plan || {};
  const tier = isTier(plan.tier) ? String(plan.tier).toLowerCase() : "free";
  const role = isRole(me.role) ? String(me.role).toLowerCase() : "user";

  const auth = store.read(store.KEYS.auth, {}) || {};
  auth.tier = tier;
  auth.role = role;
  auth.userId = me.uid;
  auth.tierUntil = plan.until == null ? null : Number(plan.until);

  auth.sessionFrom = "cookie";
  store.write(store.KEYS.auth, auth);

  store.saveSession({ logged: true, tier: tier, tierFromServer: true, userId: me.uid });

  const nick = me.nickname || "";
  if (nick && nick !== store.profile().nickname) store.saveProfile({ nickname: nick });
  return me;
}

const TIERS = { free: 1, pro: 1, max: 1 };
const ROLES = { owner: 1, admin: 1, user: 1 };
function isTier(v) {
  return !!TIERS[String(v || "").toLowerCase()];
}
function isRole(v) {
  return !!ROLES[String(v || "").toLowerCase()];
}

function refresh() {
  if (!configured()) return Promise.resolve({ local: true });
  const auth = store.read(store.KEYS.auth, {}) || {};

  if (!auth.refreshToken) {
    return request(REMOTE.me, {}, "GET")
      .then((me) => applyMe(me) || { local: true })
      .catch(() => ({ local: true }));
  }

  return request(REMOTE.refresh, remote.credentialBody({ refreshToken: auth.refreshToken }))
    .then(applySession)
    .catch((err) => {

      if (err && err.statusCode === 401) {
        store.drop(store.KEYS.auth);
        store.saveSession({ logged: false, tier: "", tierFromServer: false });
      }
      throw err;
    });
}

function logout() {
  store.drop(store.KEYS.auth);
  store.drop(store.KEYS.caps);
  store.saveSession({ logged: false, tier: "", tierFromServer: false });
}

function token() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return auth.accessToken || "";
}

function logged() {
  return !!store.profile().logged;
}

function role() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return auth.role || "";
}

function isAdmin() {
  const r = role();
  return r === "owner" || r === "admin";
}

function configure(opt) {
  const auth = store.read(store.KEYS.auth, {}) || {};
  const o = opt || {};
  if (o.baseUrl !== undefined) auth.baseUrl = String(o.baseUrl || "");
  if (o.cloud !== undefined) {
    const c = o.cloud || {};

    if (String(c.env || "").trim() || String(c.service || "").trim()) {
      auth.cloud = { env: String(c.env || "").trim(), service: String(c.service || "").trim() };
    } else {
      delete auth.cloud;
    }
  }
  store.write(store.KEYS.auth, auth);
  return { baseUrl: auth.baseUrl, cloud: auth.cloud || null, speech: !!auth.speech };
}

function useCloud() {
  return remote.useCloud();
}

function cloudConfig() {
  return remote.cloudConfig();
}

function serverTier() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return auth.tier || "";
}

function localCode() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return String(auth.loginCode || "");
}

function offline() {
  if (offlineKind) return offlineKind;
  if (!configured()) return "off";
  const auth = store.read(store.KEYS.auth, {}) || {};
  if (!auth.accessToken && auth.offline) return auth.offline;
  return "";
}

module.exports = {
  configured,
  baseUrl,
  localCode,
  offline,
  configure,
  useCloud,
  cloudConfig,
  applyMe,
  login,
  refresh,
  logout,
  token,
  logged,
  role,
  isAdmin,
  serverTier,
  applySession,
  pullAfterLogin,
  REMOTE
};
