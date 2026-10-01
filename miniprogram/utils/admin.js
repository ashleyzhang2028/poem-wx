/**
 * 管理页的数据层：给微信登录用户分层设置。
 *
 * 三层来源，按可信度排：
 *   1. 服务端名录 —— 唯一真实来源，但没有后端（remote.configured() 为假）时不假装能读
 *   2. 本机授权 —— 本机宿主 / 提权码，一定能读
 *   3. 目录名册 —— 语料里本来就有的一批 id（来源仓库：npu-gpu-cpu/poem-secrets）
 *
 * 第 3 条是这轮加进来的：管理页总得有人可管，但**名册不进代码库**
 * （那是别人的账号标识）。所以构建时把它抽出来、跟着语料一起生成，
 * 后端就绪后这份名册直接当导入种子。没有生成物时页面就说清楚，不编人。
 */
const store = require("./store");
const tiers = require("./tiers");
const entitlement = require("./entitlement");
const remote = require("./remote");

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
    local: false
  }));
}

/** 本机入册：当前设备自己 */
function localUsers() {
  const profile = store.profile();
  const s = entitlement.status();
  return [
    {
      id: store.deviceId(),
      label: profile.nickname || "本机",
      tier: s.tier,
      local: true,
      source: s.label,
      blocked: s.blocked
    }
  ];
}

/** 合并：本机档案 + 名册 + 服务端。同 id 时服务端赢，其次本机。 */
function list() {
  return remote.listUsers().then((res) => {
    const byId = {};
    rosterUsers().forEach((u) => {
      byId[u.id] = u;
    });
    localUsers().forEach((u) => {
      byId[u.id] = Object.assign({}, byId[u.id] || {}, u);
    });
    (res.users || []).forEach((u) => {
      byId[u.id] = Object.assign({}, byId[u.id] || {}, u, { remote: true });
    });
    const users = Object.keys(byId).map((k) => byId[k]);
    users.sort((a, b) => {
      if (a.local !== b.local) return a.local ? -1 : 1;
      return entitlement.rankOf(b.tier) - entitlement.rankOf(a.tier);
    });
    return {
      users: users,
      sim: res.sim,
      rosterNote: roster().note || "",
      generatedAt: roster().generatedAt || ""
    };
  });
}

/** 改档位。服务端可写就写服务端，否则退回本机（本机只对自己生效）。 */
function setTier(userId, tier, local) {
  if (!tiers.isTier(tier)) return Promise.resolve({ ok: false, msg: "档位不合法" });

  if (remote.adminReady()) {
    return remote.setUserTier(userId, tier).then((res) => ({
      ok: res.ok,
      remote: true,
      msg: res.ok ? "已写入服务端" : "服务端拒绝，权限不足"
    }));
  }

  if (!local) {
    return Promise.resolve({
      ok: false,
      remote: false,
      msg: "只读：后端没就绪，改别人的档位要等名录落地"
    });
  }

  // 本机这一档：写提权记录，与兑换码同一处
  store.write(store.KEYS.grant, { code: "LOCAL-" + userId.slice(0, 4), tier: tier, at: Date.now() });
  return Promise.resolve({ ok: true, remote: false, msg: "已改本机档位" });
}

function stats() {
  const s = entitlement.snapshot();
  let ok = 0;
  Object.keys(s.caps).forEach((k) => {
    if (s.caps[k].ok) ok += 1;
  });
  return { caps: Object.keys(s.caps).length, enabled: ok };
}

module.exports = { list, setTier, stats, roster, localUsers, rosterUsers };
