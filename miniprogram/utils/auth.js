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

  /* ⚠️ 这里**不写头像**。头像只认本机存储里那一张（微信头像的临时路径），
     服务端的 `wx_accounts.avatar_url` 从来不回值 —— 写它等于每次登录
     都用一个空串把用户刚选的那张抹掉。 */
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

/* 「没接上服务器」这句话摆在哪，只摆一处。
   内存里那个标记够本次会话用（toast 与状态都能立刻读到），存储里那句是给
   下次冷启动用的（`entitlement.status()` 不在启动时发请求）。 */
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
          /* ⚠️ **这里不写 `logged: true`。**
             这是本仓库最长寿的一处谎话：没接上服务器时按「本机身份」放行，
             而 `logged` 是**服务端会话**的判据（别人都在读它）——

               · auth.login() 回一个 `{local: true}`，`mine.js` 收下之后就报「已登录」；
               · 从那一秒起，每个要登录的入口都不再提示，而它们要的服务端会话
                 一个都没有（`gate.guard()` 不再拦、`sync.ready()` 永远 false）。

             于是一个没连后台的包，长得跟正常的包一模一样 —— 用户点一下、
             眼前是「已登录」，而库里一个字节都没落（Issue #121）。
             「进门容易、用起来要求登录」是对的，但**本机不冒充登录**：
             code 只存进 `loginCode`，只为了下一次真的接上服务器时
             不用再点一下；真实身份仍以 `profile.logged` 与 `auth token` 为准。 */
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
            /* 这一 Catch 是「点一下、闪一下，然后什么都没有」那半边的出处：
               云托管没接上 / 两栏填错 / 服务端还没配密钥时，`request()` 一律拒绝，
               而 reject 之后界面只留一句 toast。把「卡在哪一步」记下来，
               界面与「我的」页才说得清下一步该动哪儿（Issue #121）。 */
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

/** 本机为什么没在服务端：`cloud` = 云调用两栏未填或不对；`off` = 压根没配；`""` = 正常 */
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
