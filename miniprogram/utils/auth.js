/**
 * 微信账号体系。
 *
 *   wx.login() 拿 code
 *     → 自家后端 code2Session 换 openid / unionid
 *     → 后端下发自定义登录态（access + refresh 双 token）+ 档位
 *     → 客户端只存 token，不落 openid 明文
 *
 * ⚠️ 后端接口目前还没有，所以这里把「怎么调」写清楚、把「没后端时怎么办」做对：
 * 未配置 remote 时**只落地一个本机身份**（能标记「登录过」、能跨设备迁移时认回来），
 * 但档位一律按 free —— 不假装拿到了服务端的授权。
 *
 * 与网页版的差别值得说一句：网页版未注册也能用全部功能，小程序端这条边界
 * 被 Issue 撤掉了（未登录只能看首页目录）。所以本文件不再有「降级成完整可用」
 * 这条路，只保留「降级成登录态但免费档」。
 */
const store = require("./store");
const remote = require("./remote");

const REMOTE = {
  login: remote.PATHS.login,
  refresh: remote.PATHS.refresh
};

function configured() {
  return remote.configured();
}

function baseUrl() {
  return remote.baseUrl();
}

function request(path, data) {
  return remote.request(path, data);
}

/**
 * 把服务端下发的一整份身份写进本机。
 * **档位只从这里来** —— entitlement.status() 读 auth.tier，
 * 页面上的档位卡片是改不动它的（那是本机标记，见 admin.js）。
 */
function applySession(data) {
  const auth = store.read(store.KEYS.auth, {}) || {};
  auth.accessToken = data.accessToken || auth.accessToken || "";
  auth.refreshToken = data.refreshToken || auth.refreshToken || "";
  auth.expiresAt = Date.now() + (data.expiresIn || 604800) * 1000;
  auth.local = false;
  auth.baseUrl = auth.baseUrl || baseUrl();
  if (data.tier) auth.tier = data.tier;
  if (data.role) auth.role = data.role;
  if (data.signedGrant) auth.signedGrant = data.signedGrant;
  store.write(store.KEYS.auth, auth);

  // 服务端下发的按人开关：管理页可以关掉某人的朗读而不必改档位
  if (data.caps && typeof data.caps === "object") store.write(store.KEYS.caps, data.caps);

  store.saveProfile({
    logged: true,
    nickname: data.nickname || store.profile().nickname || "我的古诗词",
    avatarUrl: data.avatarUrl || store.profile().avatarUrl || "",
    tier: data.tier || "",
    tierFromServer: !!data.tier,
    userId: data.userId || store.profile().userId || ""
  });
  return data;
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
          // 没接后端：只落地一个本机身份 —— 登录过的标记要有，
          // 档位不要有。没签名的高档位等于白送，那是上一版被撤掉的口子。
          store.saveProfile({
            logged: true,
            nickname: store.profile().nickname || "我的古诗词",
            tier: "",
            tierFromServer: false
          });
          const auth = store.read(store.KEYS.auth, {}) || {};
          auth.code = res.code;
          auth.at = Date.now();
          auth.local = true;
          store.write(store.KEYS.auth, auth);
          resolve({ local: true });
          return;
        }

        request(REMOTE.login, { code: res.code, device: store.deviceId() })
          .then(applySession)
          .then(resolve)
          .catch(reject);
      },
      fail: () => reject(new Error("微信登录失败"))
    });
  });
}

/** 用 refreshToken 换一份新的身份与档位。启动时刷一次，档位变了界面就跟着变 */
function refresh() {
  if (!configured()) return Promise.resolve({ local: true });
  const auth = store.read(store.KEYS.auth, {}) || {};
  if (!auth.refreshToken) return Promise.resolve({ local: true });
  return request(REMOTE.refresh, { refreshToken: auth.refreshToken }).then(applySession);
}

function logout() {
  store.drop(store.KEYS.auth);
  store.drop(store.KEYS.caps);
  store.saveProfile({ logged: false, tier: "", tierFromServer: false });
}

function token() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return auth.accessToken || "";
}

function logged() {
  return !!store.profile().logged;
}

/** 服务端下发的角色。owner / admin 能进管理页改别人 */
function role() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return auth.role || "";
}

function isAdmin() {
  const r = role();
  return r === "owner" || r === "admin";
}

/**
 * 配后端。baseUrl 落在 auth 域而不是 settings 域 —— settings 是要导出的（导出备份
 * 会把整份设置复制成 JSON 给人看），把服务地址混进去就等于在备份里泄运维信息。
 *
 * 这里**没有管理员密钥**：能不能改别人的档位由服务端的角色判（owner/admin），
 * 客户端带一份密钥反而多一个泄漏面。网页版后台需要密钥是因为它跑在浏览器里
 * 打的是一套运维接口；小程序端复用同一套会话即够。
 */
function configure(opt) {
  const auth = store.read(store.KEYS.auth, {}) || {};
  if (opt && opt.baseUrl !== undefined) auth.baseUrl = String(opt.baseUrl || "");
  store.write(store.KEYS.auth, auth);
  return { baseUrl: auth.baseUrl, speech: !!auth.speech };
}

/** 服务端下发的档位。客户端自己写的档位只影响界面，这一份才带签名。 */
function serverTier() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return auth.tier || "";
}

module.exports = {
  configured,
  baseUrl,
  configure,
  login,
  refresh,
  logout,
  token,
  logged,
  role,
  isAdmin,
  serverTier,
  applySession,
  REMOTE
};
