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

const SPAN_KEYS = ["year", "month", "week", "day"];
const WINDOWS = [
  { key: "d1", span: "day", back: 0 },
  { key: "d7", span: "day", back: 6 },
  { key: "d30", span: "month", back: 0 },
  { key: "y1", span: "year", back: 0 }
];

const ROWS = [
  { tag: "新增", cells: ["d1", "d7", "d30", "y1"] },
  { tag: "自然", cells: ["day", "week", "month", "year"] }
];

function _createdAts(res) {
  if (res && res.createdAt && res.createdAt.length) return res.createdAt;
  return (res && res.users ? res.users : []).map((u) => u.createdAt);
}

function _startOf(ts, span) {
  const d = new Date(ts);
  if (span === "year") return new Date(d.getFullYear(), 0, 1).getTime();
  if (span === "month") return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return midnight - ((d.getDay() + 6) % 7) * 86400000;
}

function summarize(at, total) {
  const now = Date.now();
  const ats = (at || []).map(Number).filter((t) => t > 0);
  const cut = {};
  SPAN_KEYS.forEach((k) => { cut[k] = _startOf(now, k); });
  WINDOWS.forEach((w) => {
    const d = new Date(now);
    if (w.span === "year") d.setFullYear(d.getFullYear() - 1);
    else if (w.span === "month") d.setMonth(d.getMonth() - 1);
    else d.setTime(d.getTime() - 86400000);
    d.setDate(d.getDate() - (w.back || 0));
    cut[w.key] = d.getTime();
  });

  const counts = { total: Number(total) || ats.length };
  Object.keys(cut).forEach((k) => {
    counts[k] = ats.filter((t) => t >= cut[k]).length;
  });

  const list = (keys) => keys.map((k) => ({ v: counts[k] || 0 }));
  return { total: counts.total, loaded: ats.length, rows: ROWS.map((r) => ({ tag: r.tag, cells: list(r.cells) })) };
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
      total: res.total,
      stats: summarize(_createdAts(res), res.total)
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
      label: u.nickname || u.email || "微信用户 " + String(u.uid || "").slice(-4),
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
  summarize,
  setTier,
  revokeTier,
  canWrite,
  roster
};
