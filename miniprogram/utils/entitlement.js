/**
 * 层级与能力表。
 *
 * 与 poem 网页版的 `js/entitlement.js` **逐条对齐**：同样的 free / pro / max
 * 三档、同样的能力 id、同样的 `login` 门槛、同样的配额。两端口径不能漂 ——
 * 网页版给 Pro 的功能，小程序端不能变成 Max。
 *
 * 与网页版的一处差别在**档位从哪来**：
 *   网页版：服务端下发 plan，落 localStorage；本机改不了。
 *   小程序端：**默认 max**。
 *
 * 为什么默认最高档：这个 App 的本机数据只属于本机，不登录也能用全部功能
 * 是网页版立的规矩，也是用户明确要延续的边界。把本机档位卡在 free，
 * 等于用一层「其实没付费」的假门禁去挡自己。档位真正有意义的地方是
 * **云端**：跨设备同步、子用户、服务端题库这些要配额的东西才需要区分，
 * 而它们本来就依赖后端，后端会自己校验。
 *
 * 管理页可以改本机档位，用来验权限分支；登录后服务端下发的档位会覆盖它。
 */
const store = require("./store");

/** 三档，升序。index 越大权限越大 */
const TIERS = ["free", "pro", "max"];

const ROLES = ["owner", "admin", "user"];

/**
 * 能力表。字段含义与网页版一致：
 *   minTier  最低档位
 *   login    是否要求登录
 *   quota    定额（null = 不限）
 *   quotas   分档定额（覆盖 quota）
 *   name     中文名，界面直接用
 *   breaks   搜索用的别名（网页版为了「模糊匹配输入」留的，这里保留同样的功能）
 */
const CAPS = {
  "recite.basic": { minTier: "free", login: false, quota: null, name: "每日背诵" },
  "library.all": { minTier: "free", login: false, quota: null, name: "课外阅读" },
  "read.aloud": { minTier: "free", login: true, quota: null, name: "语音朗读" },
  "pinyin.helper": { minTier: "free", login: false, quota: null, name: "注音辅助" },
  "export.progress": { minTier: "free", login: true, quota: null, name: "进度导出" },

  "algo.ebbinghaus": {
    minTier: "free", login: false, quota: null, name: "艾宾浩斯遗忘曲线",
    breaks: ["遗忘曲线"]
  },
  "algo.leitner": { minTier: "free", login: true, quota: null, name: "莱特纳盒" },
  "algo.sm2": { minTier: "pro", login: true, quota: null, name: "SM-2 复习" },
  "algo.fsrs": { minTier: "max", login: true, quota: null, name: "FSRS 复习" },

  "collections.many": {
    minTier: "pro", login: true, quota: null, name: "自选清单",
    quotas: { free: 10, pro: 100, max: 5000 }
  },
  "sync.multiDevice": { minTier: "pro", login: true, quota: null, name: "设备同步" },
  "export.paper": { minTier: "pro", login: true, quota: null, name: "PDF / 打印" },

  "profile.family": {
    minTier: "pro", login: true, quota: null, name: "子用户",
    quotas: { free: 1, pro: 3, max: 180 }
  },

  "quiz.review": { minTier: "pro", login: true, quota: null, name: "题库" },

  "export.all": {
    minTier: "pro", login: true, quota: null, name: "课内诗词 导出",
    breaks: ["导出"],
    quotas: { free: 0, pro: 251, max: 251 }
  },

  "feihualing": { minTier: "max", login: true, quota: null, name: "飞花令" },
  "exam.gathering": {
    minTier: "max", login: true, quota: null, name: "古诗词 大会",
    breaks: ["大会"]
  },
  "exam.paper": { minTier: "max", login: true, quota: null, name: "模拟考试" },
  "exam.formal": { minTier: "max", login: true, quota: null, name: "考试" },
  "exam.changshi": { minTier: "pro", login: true, quota: null, name: "文学常识考试" }
};

const ALIAS = {};

const NS = "kb_plan_v1";

function tierIndex(t) {
  const i = TIERS.indexOf(t);
  return i < 0 ? 0 : i;
}

function isTier(t) {
  return TIERS.indexOf(t) >= 0;
}

function isRole(r) {
  return ROLES.indexOf(r) >= 0;
}

function isAdminRole(role) {
  const r = String(role == null ? "" : role).trim().toLowerCase();
  return r === "owner" || r === "admin";
}

/**
 * 本机档位。默认 max —— 见文件头的说明。
 * 服务端下发的档位（`source: "server"`）优先，且与当前 uid 绑定。
 */
function localPlan() {
  return store.read(NS, null) || null;
}

function saveLocalPlan(patch) {
  const cur = localPlan() || {};
  const next = Object.assign({}, cur, patch || {});
  store.write(NS, next);
  return next;
}

function serverPlan(uid) {
  const p = localPlan();
  if (!p || p.source !== "server") return null;
  if (uid !== undefined && String(p.uid || "") !== String(uid || "")) return null;
  const until = p.until == null ? null : Number(p.until);
  if (until !== null && isFinite(until) && until <= Date.now()) return null;
  return isTier(p.tier) ? p : null;
}

function currentTier() {
  const profile = store.profile() || {};
  const uid = profile.uid || "";
  const srv = serverPlan(uid);
  if (srv) return srv.tier;
  const p = localPlan();
  if (p && isTier(p.tier)) return p.tier;
  return "max";
}

function currentRole() {
  const profile = store.profile() || {};
  const uid = profile.uid || "";
  const srv = serverPlan(uid);
  if (srv && isRole(srv.role)) return String(srv.role).toLowerCase();
  const p = localPlan();
  if (p && isRole(p.role)) return String(p.role).toLowerCase();
  return "user";
}

function signedIn() {
  const profile = store.profile() || {};
  return !!profile.logged;
}

/** 当前身份快照。can() 的默认上下文就是它 */
function identity() {
  const tier = currentTier();
  return {
    tier,
    role: currentRole(),
    signedIn: signedIn(),
    label: tierLabel(tier),
    can: (name) => can(name, { tier, signedIn: signedIn() }),
    hint: (name) => denyReason(name, { tier, signedIn: signedIn() })
  };
}

function cap(name) {
  const key = Object.prototype.hasOwnProperty.call(ALIAS, name) ? ALIAS[name] : name;
  return CAPS[key] || null;
}

/**
 * 判一条能力能不能用。
 * @param {string} name
 * @param {Object} [ctx] tier / signedIn；不传就用当前身份
 * @returns {{ok:boolean, reason:string, minTier:string, quota:?number, name:string}}
 */
function can(name, ctx) {
  const c = cap(name);
  const k = ctx || identity();
  const tier = isTier(k.tier) ? k.tier : "free";
  const signed = !!k.signedIn;

  if (!c) {
    return { ok: false, reason: "unknown", minTier: "free", quota: null, name: "" };
  }
  if (c.login && !signed) {
    return { ok: false, reason: "login", minTier: c.minTier, quota: c.quota, name: c.name };
  }
  if (tierIndex(tier) < tierIndex(c.minTier)) {
    return { ok: false, reason: "tier", minTier: c.minTier, quota: c.quota, name: c.name };
  }
  return { ok: true, reason: "ok", minTier: c.minTier, quota: c.quota, name: c.name };
}

function denyReason(name, ctx) {
  const r = can(name, ctx);
  if (r.ok) return "";
  if (r.reason === "unknown") return "这个功能暂不可用";
  if (r.reason === "login") return "登录可用";
  return r.minTier === "max" ? "Max 起" : "Pro 起";
}

function tierLabel(tier) {
  const t = isTier(tier) ? tier : "free";
  return t === "max" ? "Max" : t === "pro" ? "Pro" : "Free";
}

function quotaFor(c, tier) {
  if (!c) return null;
  if (c.quotas && typeof c.quotas === "object") {
    if (!isTier(tier)) return null;
    const v = c.quotas[tier];
    return typeof v === "number" ? v : null;
  }
  return c.quota == null ? null : c.quota;
}

function quotaText(amount) {
  if (amount === Infinity) return "不限";
  if (amount === 0) return "不支持";
  return String(amount) + " 个";
}

/** 管理页 / 说明页用的完整矩阵 */
function matrix(ctx) {
  const k = ctx || identity();
  return Object.keys(CAPS).map((key) => {
    const c = CAPS[key];
    const r = can(key, k);
    return {
      cap: key,
      name: c.name,
      ok: r.ok,
      reason: r.reason,
      minTier: c.minTier,
      quota: c.quota,
      hint: r.ok ? "" : denyReason(key, k)
    };
  });
}

/** 分档对照表。网页版「版本对照」页的同一份数据 */
function compare() {
  const cols = [
    { id: "guest", tier: "free", guest: true, label: "游客" },
    { id: "free", tier: "free", guest: false, label: "Free" },
    { id: "pro", tier: "pro", guest: false, label: "Pro" },
    { id: "max", tier: "max", guest: false, label: "Max" }
  ];

  const rows = Object.keys(CAPS).map((key) => {
    const c = CAPS[key];
    const cells = cols.map((col) => {
      const ctx = { tier: col.tier, signedIn: !col.guest };
      const r = can(key, ctx);
      const amount = quotaFor(c, col.tier);
      return {
        ok: r.ok,
        quota: amount,
        hint: r.ok ? (amount == null ? "" : quotaText(amount)) : denyReason(key, ctx)
      };
    });
    return {
      cap: key,
      name: c.name,
      breaks: c.breaks || null,
      minTier: c.minTier,
      cells
    };
  });

  const byMin = { free: [], pro: [], max: [] };
  rows.forEach((r) => {
    (byMin[r.minTier] || byMin.free).push(r);
  });

  const groups = [];
  [
    { key: "free", title: "所有版本都有" },
    { key: "pro", title: "Pro 起" },
    { key: "max", title: "Max 起" }
  ].forEach((g) => {
    if (byMin[g.key].length) groups.push({ key: g.key, title: g.title, rows: byMin[g.key] });
  });

  return { cols, rows, groups };
}

/** 档位升级提示：从低档升上来的时候给一次祝贺，读过就不再给 */
const NOTICE = "kb_plan_notice_v1";

function noteUpgrade(from, to) {
  if (tierIndex(to) <= tierIndex(from)) return null;
  const n = { from, to, at: Date.now() };
  store.write(NOTICE, n);
  return n;
}

function readNotice() {
  return store.read(NOTICE, null) || null;
}

function clearNotice() {
  store.drop(NOTICE);
}

module.exports = {
  TIERS,
  ROLES,
  CAPS,
  ALIAS,
  NS,
  NOTICE,
  tierIndex,
  isTier,
  isRole,
  isAdminRole,
  tierLabel,
  cap,
  can,
  denyReason,
  quotaFor,
  quotaText,
  matrix,
  compare,
  identity,
  currentTier,
  currentRole,
  signedIn,
  localPlan,
  saveLocalPlan,
  serverPlan,
  noteUpgrade,
  readNotice,
  clearNotice
};
