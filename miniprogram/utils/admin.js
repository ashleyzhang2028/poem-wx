/**
 * 管理页的数据层：给微信登录用户分层设置。
 *
 * 三层来源，按可信度排：
 *   1. 服务端名录（/api/admin/accounts）—— 唯一真实来源。要登录 + owner/admin 角色。
 *      没就绪时不假装能读。
 *   2. 本机档案 —— 当前这台设备上的自己（谁都能看，只能看自己）
 *   3. 构建时导入的名册 —— 语料里本来就有的一批 id（来源仓库：npu-gpu-cpu/poem-secrets）
 *
 * 第 3 条是**种子**：管理页总得有人可管，但名册不进代码库（那是别人的账号标识）。
 * 构建时把它抽出来、跟着语料一起生成，后端就绪后直接当导入种子。
 * 没有生成物时页面就说清楚，不编人。
 *
 * ⚠️ 与上一版的差别：本机**不再能改自己的档位**。上一版留了个「改本机层级」的
 *   卡片，理由是「验权限分支」—— 但那东西点两下就能把自己升到 max，
 *   等于把管理页变成了自助提权。现在本机只有一张只读的能力矩阵，
 *   要档位就找管理员。
 */
const store = require("./store");
const tiers = require("./tiers");
const entitlement = require("./entitlement");
const remote = require("./remote");
const auth = require("./auth");

/** 名册是构建产物（miniprogram/data/roster.json），不进代码库；没有就返回空 */
let rosterCache = null;

function roster() {
  if (rosterCache) return rosterCache;
  try {
    rosterCache = require("../data/roster.json");
  } catch (e) {
    rosterCache = { users: [], note: "名册未生成" };
  }
  return rosterCache;
}

function rosterUsers() {
  return (roster().users || []).map((u) => ({
    id: u.id,
    label: u.label || u.id.slice(0, 6),
    tier: tiers.isTier(u.tier) ? u.tier : tiers.DEFAULT_TIER,
    role: "user",
    source: "roster",
    local: false,
    remote: false,
    writable: false
  }));
}

/** 当前这台设备上的自己 */
function localUsers() {
  const profile = store.profile();
  const s = entitlement.status();
  return [
    {
      id: profile.userId || store.deviceId(),
      label: profile.nickname || "本机",
      tier: s.signed ? s.tier : "",
      tierLabel: s.label,
      role: auth.role() || "user",
      source: "local",
      local: true,
      remote: false,
      writable: false
    }
  ];
}

/** 能不能改别人的档位 */
function canWrite() {
  return remote.adminReady();
}

/** 能不能改角色（只有 owner） */
function canSetRole() {
  return remote.adminReady() && auth.role() === "owner";
}

/**
 * 名录。合并顺序即优先级：名册 → 本机 → 服务端。
 * 同 id 时后面的覆盖前面的，所以服务端那一份永远赢。
 */
function list() {
  if (!entitlement.loggedIn()) {
    return Promise.resolve({ users: [], sim: true, note: "登录后才能看名录" });
  }

  if (!remote.adminReady()) {
    // 没服务端：本机 + 名册。说清这是只读的
    return Promise.resolve({
      users: merge(rosterUsers(), localUsers(), []),
      sim: true,
      note: roster().note || "服务端未就绪，名录只读"
    });
  }

  return remote
    .listUsers()
    .then((res) => ({
      users: merge(rosterUsers(), localUsers(), normalizeRemote(res.users)),
      sim: false,
      note: res.note || "",
      total: res.total
    }))
    .catch((err) => ({
      users: merge(rosterUsers(), localUsers(), []),
      sim: true,
      error: err.message,
      note: "读取名录失败：" + err.message
    }));
}

function normalizeRemote(rows) {
  return (rows || []).map((u) => ({
    id: u.uid || u.id,
    label: u.nickname || u.email || String(u.uid || "").slice(0, 8),
    tier: tiers.isTier(u.tier) ? u.tier : tiers.DEFAULT_TIER,
    until: u.until || null,
    role: u.role || "user",
    status: u.status || "active",
    source: "remote",
    local: false,
    remote: true,
    writable: true
  }));
}

function merge(a, b, c) {
  const byId = {};
  [a, b, c].forEach((rows) => {
    (rows || []).forEach((u) => {
      const prev = byId[u.id] || {};
      byId[u.id] = Object.assign({}, prev, u);
    });
  });
  const users = Object.keys(byId).map((k) => byId[k]);
  users.sort((x, y) => {
    if (x.local !== y.local) return x.local ? -1 : 1;
    if (x.remote !== y.remote) return x.remote ? -1 : 1;
    return entitlement.rankOf(y.tier) - entitlement.rankOf(x.tier);
  });
  return users;
}

/**
 * 改档位。**只走服务端** —— 本机改不了档位，这是这一版的核心改动。
 * 服务端没就绪时如实说，不给「已改本机档位」这种假成功。
 */
function setTier(userId, tier) {
  if (!tiers.isTier(tier)) return Promise.resolve({ ok: false, msg: "档位不合法" });

  if (!entitlement.loggedIn()) {
    return Promise.resolve({ ok: false, msg: "先登录才能改档位" });
  }
  if (!canWrite()) {
    return Promise.resolve({
      ok: false,
      msg: "改不了：要么后端没就绪，要么你这一档不是管理员"
    });
  }
  return remote.setUserTier(userId, tier).then((res) => ({
    ok: res.ok,
    remote: true,
    msg: res.ok
      ? res.changed === false
        ? "本来就是「" + tiers.nameOf(tier) + "」，没改动"
        : "已把「" + userId.slice(0, 8) + "」改成「" + tiers.nameOf(tier) + "」，对方下次打开生效"
      : "服务端拒绝，权限不足"
  }));
}

/** 收回档位（降回 free） */
function revokeTier(userId) {
  if (!canWrite()) return Promise.resolve({ ok: false, msg: "改不了：后端未就绪或权限不足" });
  return remote.revokeUserTier(userId).then((res) => ({
    ok: true,
    msg: (res && res.note) || "已收回，重置为免费档"
  }));
}

/** 改角色。只有 owner 能改，服务端也会再挡一层 */
function setRole(userId, role) {
  if (role !== "user" && role !== "admin") {
    return Promise.resolve({ ok: false, msg: "角色只认 user / admin" });
  }
  if (!canSetRole()) {
    return Promise.resolve({ ok: false, msg: "改角色只对 owner 开放" });
  }
  return remote.setUserRole(userId, role).then((res) => ({
    ok: true,
    msg: (res && res.note) || "已改角色"
  }));
}

/** 能力统计：这一档下开了几条 */
function stats() {
  const s = entitlement.snapshot();
  let ok = 0;
  Object.keys(s.caps).forEach((k) => {
    if (s.caps[k].ok) ok += 1;
  });
  return { caps: Object.keys(s.caps).length, enabled: ok };
}

module.exports = {
  list,
  setTier,
  revokeTier,
  setRole,
  stats,
  canWrite,
  canSetRole,
  roster,
  localUsers,
  rosterUsers
};
