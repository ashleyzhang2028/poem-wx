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

// 接口路径只在 utils/remote.js 里写一份，这里引过来，免得后端改路径要改两处
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
          const auth = store.read(store.KEYS.auth, {}) || {};
          auth.code = res.code;
          auth.at = Date.now();
          auth.local = true;
          store.write(store.KEYS.auth, auth);
          resolve({ local: true });
          return;
        }

        request(REMOTE.login, { code: res.code })
          .then((data) => {
            const auth = store.read(store.KEYS.auth, {}) || {};
            auth.accessToken = data.accessToken;
            auth.refreshToken = data.refreshToken;
            auth.expiresAt = Date.now() + (data.expiresIn || 604800) * 1000;
            auth.local = false;
            // 服务端下发的档位与 TTS 开关：这是唯一可信的授权来源
            if (data.tier) auth.tier = data.tier;
            if (data.speech === true) auth.speech = true;
            auth.baseUrl = auth.baseUrl || baseUrl();
            store.write(store.KEYS.auth, auth);
            store.saveProfile({
              logged: true,
              nickname: store.profile().nickname || "我的古诗词",
              tier: data.tier || store.profile().tier,
              userId: data.userId || store.profile().userId
            });
            if (data.signedGrant) store.write(store.KEYS.signed, data.signedGrant);
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
  store.saveProfile({ logged: false, tier: "free" });
}

function token() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return auth.accessToken || "";
}

function logged() {
  return !!store.profile().logged;
}

/**
 * 配后端。baseUrl 落在 auth 域而不是 settings 域 —— settings 是要导出的（导出备份
 * 会把整份设置复制成 JSON 给人看），把服务地址和 adminKey 混进去就等于在备份里泄密钥。
 */
function configure(opt) {
  const auth = store.read(store.KEYS.auth, {}) || {};
  if (opt && opt.baseUrl !== undefined) auth.baseUrl = String(opt.baseUrl || "");
  if (opt && opt.adminKey !== undefined) auth.adminKey = String(opt.adminKey || "");
  if (opt && opt.speech !== undefined) auth.speech = !!opt.speech;
  store.write(store.KEYS.auth, auth);
  return { baseUrl: auth.baseUrl, speech: !!auth.speech, admin: !!auth.adminKey };
}

/** 服务端下发的档位。客户端自己写的档位只影响界面，这一份才带签名。 */
function serverTier() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return auth.tier || "";
}

module.exports = { configured, baseUrl, configure, login, logout, token, logged, serverTier, REMOTE };
