const store = require("./store");
const tiers = require("./tiers");
const entitlement = require("./entitlement");
const remote = require("./remote");

let rosterCache = null;

function roster() {
  if (rosterCache) return rosterCache;
  try {
    rosterCache = require("../data/roster.js");
  } catch (e) {
    rosterCache = { users: [], note: "名册未生成" };
  }
  return rosterCache;
}

function _rosterUsers() {
  return (roster().users || []).map((u) => {
    const t = tiers.isTier(u.tier) ? u.tier : tiers.DEFAULT_TIER;
    return {
      id: u.id,
      label: u.label || u.id.slice(0, 6),
      tier: t,

      tierLabel: tiers.nameOf(t),
      source: "roster",
      local: false,
      remote: false,
      writable: false
    };
  });
}

function _localUsers() {
  const profile = store.profile();
  const s = entitlement.status();
  return [
    {
      id: profile.userId || store.deviceId(),
      label: profile.nickname || "这台手机",
      tier: s.signed ? s.tier : "",
      tierLabel: s.signed ? tiers.nameOf(s.tier) : "未分级",
      source: "local",
      local: true,
      remote: false,
      writable: false
    }
  ];
}

function loggedIn() {
  return entitlement.loggedIn();
}

function canWrite() {
  return remote.adminReady();
}

function list() {
  if (!loggedIn()) {
    return Promise.resolve({ users: [], sim: true, note: "登录后才能看名录" });
  }

  if (!remote.adminReady()) {

    return Promise.resolve({
      users: _merge(_rosterUsers(), _localUsers(), []),
      sim: true,
      note: roster().note || "服务器未接上，名录只读"
    });
  }

  return remote
    .listUsers()
    .then((res) => ({
      users: _merge(_rosterUsers(), _localUsers(), _normalizeRemote(res.users)),
      sim: false,
      note: res.note || "",
      total: res.total
    }))
    .catch((err) => ({
      users: _merge(_rosterUsers(), _localUsers(), []),
      sim: true,
      error: err.message,
      note: "读取名录失败：" + err.message
    }));
}

function _normalizeRemote(rows) {
  return (rows || []).map((u) => {
    const t = tiers.isTier(u.tier) ? u.tier : tiers.DEFAULT_TIER;
    return {
      id: u.uid || u.id,
      label: u.nickname || u.email || String(u.uid || "").slice(0, 8),
      tier: t,
      tierLabel: tiers.nameOf(t),
      until: u.until || null,
      status: u.status || "active",
      createdAt: Number(u.createdAt) || 0,
      source: "remote",
      local: false,
      remote: true,
      writable: true
    };
  });
}

function _merge(a, b, c) {
  const byId = {};
  [a, b, c].forEach((rows) => {
    (rows || []).forEach((u) => {
      const prev = byId[u.id] || {};
      byId[u.id] = Object.assign({}, prev, u);
    });
  });
  const users = Object.keys(byId).map((k) => byId[k]);
  users.sort((x, y) => {
    if (x.remote !== y.remote) return x.remote ? -1 : 1;
    if (x.createdAt !== y.createdAt) return (y.createdAt || 0) - (x.createdAt || 0);
    if (x.local !== y.local) return x.local ? -1 : 1;
    return entitlement.rankOf(y.tier) - entitlement.rankOf(x.tier);
  });
  return users;
}

function setTier(userId, tier) {
  if (!tiers.isTier(tier)) return Promise.resolve({ ok: false, msg: "档位不合法" });

  if (!loggedIn()) {
    return Promise.resolve({ ok: false, msg: "先登录才能改档位" });
  }
  if (!canWrite()) {
    return Promise.resolve({
      ok: false,
      msg: "改不了：要么服务器没接上，要么你不是管理员"
    });
  }
  return remote.setUserTier(userId, tier).then((res) => ({
    ok: res.ok,
    remote: true,
    msg: res.ok
      ? res.changed === false
        ? "本来就是 " + tiers.nameOf(tier) + "，没改动"
        : "已把「" + userId.slice(0, 8) + "」改成 " + tiers.nameOf(tier) + "，对方下次打开生效"
      : "服务器拒绝，权限不足"
  }));
}

function revokeTier(userId) {
  if (!canWrite()) return Promise.resolve({ ok: false, msg: "改不了：服务器未接上或权限不足" });
  return remote.revokeUserTier(userId).then((res) => ({
    ok: true,
    msg: (res && res.note) || "已收回，重置为 Free"
  }));
}

module.exports = {
  loggedIn,
  list,
  setTier,
  revokeTier,
  canWrite,
  roster
};
