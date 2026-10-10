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

/**
 * 登录成功之后**立刻认回云端数据**。
 *
 * 用户 2026-10-04 的话：
 *   「同步功能只要用户登录就全部提供，确保用户数据不丢失，背诵进度换设备也能得到」
 *
 * 所以这件事不能等下一个触发点（启动 3 秒、背完一首、用户手动点）——
 * 新机器上登录完，用户第一眼看的是首页，而那一刻进度还在云上。
 * 惰性 require 是为了断开 auth ↔ sync 的环（sync 要读 auth.logged()）。
 */
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

/**
 * 转一道手发请求。
 * ⚠️ `method` **必须跟着传**：`/api/me` 是 GET（poem 那边就是 GET），
 * 少了这一位就会以 POST 打过去 —— 服务端回 405，而这里看见的只是
 * 「叫不通」，于是「网页版同号的人拿不到档位」这条又悄悄回来了。
 */
function request(path, data, method) {
  return remote.request(path, data, method);
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

  // 服务端下发的微信头像落进 avatarUrl（**不是** avatarLocal）：
  // 它是「微信那张」，优先级在本机那张之下。用户自己传过的图（avatarLocal）
  // 一点都不会被这里碰到 —— 登录刷新微信头像，不该盖掉用户的图。
  //
  // ⚠️ **昵称只在真的变了的时候才写**。不这么写会踩到一个很难找的坑：
  // 昵称是「跨设备那几个字段」之一（它进 profile:v1 那一行），
  // 于是登录时无条件写一次昵称 = 给档案盖一个新时间戳 = 本机成了
  // 「更新的那一份」= **云端那份头像被判成旧的，永远认不回来**。
  // 新机器上登一次顶掉一次，用户看到的是「换台手机头像没了」，
  // 而进度、设置全都在 —— 最难往这上面想。
  const patch = {
    logged: true,
    avatarUrl: data.avatarUrl || store.profile().avatarUrl || "",
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
          // 本机身份：登录过的标记要有，档位不要有（见上）。
          // 走 saveSession 而不是 saveProfile —— 会话字段不参与
          // 「哪一份更新」的比较（见 store.js 的 PROFILE_SYNCED）
          store.saveSession({ logged: true, tier: "", tierFromServer: false });
          const auth = store.read(store.KEYS.auth, {}) || {};
          auth.code = res.code;
          auth.at = Date.now();
          auth.local = true;
          store.write(store.KEYS.auth, auth);
          resolve({ local: true });
          return;
        }

        request(REMOTE.login, remote.credentialBody({ code: res.code }))
          // 先认回云端，再返回：调用方拿到 resolve 时，首页要的东西已经在本机了。
          // synced 如实回传 —— 界面靠它区分「认回来了」与「这条通道没开」
          .then(applySession)
          .then((data) =>
            pullAfterLogin().then((r) => Object.assign({}, data, { synced: !(r && r.skipped) }))
          )
          .then(resolve)
          .catch(reject);
      },
      fail: () => reject(new Error("微信登录失败"))
    });
  });
}

/**
 * `/api/me` 那一份身份 → 本机会话的形状。**这是 `/api/wx/refresh` 的兜底**。
 *
 * 为什么需要兜底：本项目允许**网页版与小程序同号**（同一个 uid，同一份进度）。
 * 用户在网页版登录过，这台手机上就有一枚有效的 Cookie，而小程序手里
 * **一枚 token 都没有** —— 于是 `/api/wx/refresh` 因为「没带 refreshToken」
 * 在客户端就被挡回来了（见 refresh() 第二行），档位永远是 free：
 * 网页版是 Pro，换到小程序就只剩免费档，而界面上没有任何一句话解释得清。
 *
 * `/api/me` 已经在线上了，且它认的就是「当前会话」—— 谁带会话就返回谁。
 * 所以这条路只做一件事：**把已经存在的会话认回本机**，不新建、不改档。
 *
 * 三条边界：
 *   1. 服务端不回会话（401 E_NO_SESSION）→ 安静地什么都不做，不是错误。
 *      没登录的人启动一次也会走到这里，报错只会平白吓人。
 *   2. 服务端的响应形状与 /wx/* 不同（`{ uid, plan:{tier,until}, role }`），
 *      所以不能直接喂给 applySession —— 那里读的是 accessToken/tier 这种扁平字段。
 *   3. **写进去的是服务端给的事实**：tier 与 role 只从响应里取。本机原本
 *      写着一个 pro，服务端说 free，这里就落 free —— 这一层不做「本机说了算」。
 */
function applyMe(me) {
  if (!me || !me.uid) return null;
  const plan = me.plan || {};
  const tier = isTier(plan.tier) ? String(plan.tier).toLowerCase() : "free";
  const role = isRole(me.role) ? String(me.role).toLowerCase() : "user";

  // ⚠️ 档位与角色写进 **auth 域**，因为读它们的那两个口子读的就是这里：
  //   serverTier()  → store.read(KEYS.auth).tier
  //   role()        → store.read(KEYS.auth).role
  // 写进 profile 会「看着都对、读出来全是空」：logged 变 true 了、
  // 界面写着登录成功，而档位还是 free、管理页还是进不去 —— 一路静默。
  const auth = store.read(store.KEYS.auth, {}) || {};
  auth.tier = tier;
  auth.role = role;
  auth.userId = me.uid;
  auth.tierUntil = plan.until == null ? null : Number(plan.until);
  // 凭据来源：这一枚**不是** token。本机手里没有 token，只是「服务端认过这个人」，
  // 用来把 refresh 那条通道关掉（没 refreshToken 就不发包，见 refresh()）
  auth.sessionFrom = "cookie";
  store.write(store.KEYS.auth, auth);

  // 会话字段走 saveSession（**不盖同步时间戳**）—— 与登录那条路同一口径：
  // 登录这件事在每台机器上都会发生，它不该参与「谁那一份更新」的比较。
  store.saveSession({ logged: true, tier: tier, tierFromServer: true, userId: me.uid });

  const nick = me.nickname || "";
  if (nick && nick !== store.profile().nickname) store.saveProfile({ nickname: nick });
  return me;
}

/** 档位 / 角色这两个白名单放在这里，别在页面里各写一遍 */
const TIERS = { free: 1, pro: 1, max: 1 };
const ROLES = { owner: 1, admin: 1, user: 1 };
function isTier(v) {
  return !!TIERS[String(v || "").toLowerCase()];
}
function isRole(v) {
  return !!ROLES[String(v || "").toLowerCase()];
}

/** 用 refreshToken 换一份新的身份与档位。启动时刷一次，档位变了界面就跟着变 */
function refresh() {
  if (!configured()) return Promise.resolve({ local: true });
  const auth = store.read(store.KEYS.auth, {}) || {};

  // 本机没有 refreshToken：**先问一句「服务端认不认得我这台」**。
  // 网页版同号登录过的人走的就是这一条 —— 他手里有 Cookie 没有 token，
  // 上一版到这里直接 return，档位于是永远 free（见 applyMe 顶上那段）。
  if (!auth.refreshToken) {
    return request(REMOTE.me, {}, "GET")
      .then((me) => applyMe(me) || { local: true })
      .catch(() => ({ local: true }));
  }

  // ⚠️ 报文里**必须有 device**：服务端按它签会话、也按它限流。
  // 登录时记得带、刷新时忘了带，是这条路上最容易漏的一处 ——
  // 漏了服务端拿到空字符串，同一台设备的刷新被拆成无数个限流桶。
  return request(REMOTE.refresh, remote.credentialBody({ refreshToken: auth.refreshToken }))
    .then(applySession)
    .catch((err) => {
      // refreshToken 也不认了（过期 / 被吊销 / 服务端换了密钥）：
      // 把本机那一份会话清掉，别让界面举着一份服务端不认的档位。
      // 进度与设置都在本机，清掉会话不影响一个字。
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
 * 配后端。落在 auth 域而不是 settings 域 —— settings 是要导出的（导出备份
 * 会把整份设置复制成 JSON 给人看），把服务地址混进去就等于在备份里泄运维信息。
 *
 * 这里**没有管理员密钥**：能不能改别人的档位由服务端的角色判（owner/admin），
 * 客户端带一份密钥反而多一个泄漏面。网页版后台需要密钥是因为它跑在浏览器里
 * 打的是一套运维接口；小程序端复用同一套会话即够。
 *
 * **两种配法，二选一**（判据见 `remote.useCloud()`）：
 *
 *   baseUrl          自有域 / 云托管默认域。要能填进 request 合法域名 ——
 *                    即「已备案」这个硬门槛（见 docs/wx-cloud-setup.md）
 *   cloud.env        云开发环境 ID
 *   cloud.service    云托管服务名
 *
 * 云调用那条**不需要域名、也不需要备案**，代价是只能小程序调
 * （网页版走不了），以及要先把云开发环境与云托管对起来。
 * 两个都填时**以 baseUrl 优先**：那是显式地址，比走环境去找更直白。
 */
function configure(opt) {
  const auth = store.read(store.KEYS.auth, {}) || {};
  const o = opt || {};
  if (o.baseUrl !== undefined) auth.baseUrl = String(o.baseUrl || "");
  if (o.cloud !== undefined) {
    const c = o.cloud || {};
    // 键一个都不留时把整块删掉，而不是留个 {} —— remote 那边按「有没有 env+service」
    // 判通道，留空对象会让「配过又清空」和「从没配过」长得不一样
    if (String(c.env || "").trim() || String(c.service || "").trim()) {
      auth.cloud = { env: String(c.env || "").trim(), service: String(c.service || "").trim() };
    } else {
      delete auth.cloud;
    }
  }
  store.write(store.KEYS.auth, auth);
  return { baseUrl: auth.baseUrl, cloud: auth.cloud || null, speech: !!auth.speech };
}

/** 走云调用那条吗。**与 remote.useCloud() 同源**，界面问的是同一件事 */
function useCloud() {
  return remote.useCloud();
}

/** 云调用那条要的三个东西（env / service） */
function cloudConfig() {
  return remote.cloudConfig();
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
