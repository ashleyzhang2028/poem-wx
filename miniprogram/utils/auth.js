/**
 * 微信账号体系。
 *
 * 网页版是「邮箱 + 密码 / 随机码」两条路签同一枚会话；
 * 小程序端整块换成 wx.login 的那一套：
 *
 *   wx.login() 拿 code
 *     → 自家后端 code2Session 换 openid / unionid
 *     → 后端下发自定义登录态（access + refresh 双 token）
 *     → 客户端只存 token，不落 openid 明文
 *
 * ⚠️ 后端接口目前还没有，所以这里把「怎么调」写清楚、把「没后端时怎么办」做对：
 * 未配置 remote 时降级为本机档案，功能一个不少，只是不同步。
 * 这是网页版那条边界（不注册也能用全部功能）在小程序端的延续。
 */
const store = require("./store");

const REMOTE = {
  login: "/api/wx/login",
  refresh: "/api/wx/refresh"
};

/** access token 提前 5 分钟换，避免「刚好在用的时候过期」 */
const EARLY_MS = 5 * 60 * 1000;

function configured() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return !!auth.baseUrl;
}

function baseUrl() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return auth.baseUrl || "";
}

function request(path, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: baseUrl() + path,
      method: "POST",
      data,
      header: { "content-type": "application/json" },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error("HTTP " + res.statusCode));
      },
      fail: (err) => reject(new Error(err.errMsg || "网络不可用"))
    });
  });
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
          // 没接后端：先落地一个本机身份，功能照常，只是没有云端同步
          store.saveProfile({ logged: true, nickname: store.profile().nickname || "我的古诗词" });
          wx.setStorageSync(store.KEYS.auth, { code: res.code, at: Date.now(), local: true });
          resolve({ local: true });
          return;
        }

        request(REMOTE.login, { code: res.code })
          .then((data) => {
            wx.setStorageSync(store.KEYS.auth, {
              accessToken: data.accessToken,
              refreshToken: data.refreshToken,
              expiresAt: Date.now() + (data.expiresIn || 604800) * 1000
            });
            store.saveProfile({ logged: true, nickname: store.profile().nickname || "我的古诗词" });
            resolve(data);
          })
          .catch(reject);
      },
      fail: () => reject(new Error("微信登录失败"))
    });
  });
}

function logout() {
  store.drop(store.KEYS.auth);
  store.saveProfile({ logged: false });
}

function token() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return auth.accessToken || "";
}

function authState() {
  return store.read(store.KEYS.auth, {}) || {};
}

/**
 * 会话要过期 / 已过期时，用 refresh token 换一枚新的。
 *
 * 没有后端、没有 refresh token、或者还早 —— 都直接返回，不发请求。
 * 这是启动流程里的一个空操作，不该因为「没配后端」而抛错。
 */
function refreshIfNeeded() {
  const a = authState();
  if (!configured() || !a.refreshToken) return Promise.resolve(null);

  const expiresAt = Number(a.expiresAt) || 0;
  if (expiresAt && expiresAt - Date.now() > EARLY_MS) return Promise.resolve(null);

  return request(REMOTE.refresh, { refreshToken: a.refreshToken })
    .then((data) => {
      wx.setStorageSync(store.KEYS.auth, {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || a.refreshToken,
        expiresAt: Date.now() + (data.expiresIn || 604800) * 1000
      });
      return data;
    })
    .catch(() => {
      // 换不回来就把登录态摘掉，界面会回到「未登录」，功能一个不少
      store.saveProfile({ logged: false });
      return null;
    });
}

function logged() {
  return !!store.profile().logged;
}

module.exports = {
  REMOTE,
  configured,
  baseUrl,
  login,
  logout,
  token,
  logged,
  authState,
  refreshIfNeeded
};
