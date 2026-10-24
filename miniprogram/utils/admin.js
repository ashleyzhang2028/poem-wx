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

const RANGES = [
  { key: "7", days: 7, label: "近 7 天" },
  { key: "30", days: 30, label: "近 30 天" },
  { key: "90", days: 90, label: "近 90 天" },
  { key: "365", days: 365, label: "近一年" }
];

const DEFAULT_RANGE = "30";
const WEEK = 7;
const WEEK_SPAN = 52;
const CURVE_W = 100;
const CURVE_H = 32;

function _day(y, m, d) {
  return new Date(y, m, d).getTime();
}

function _startOf(ts) {
  const d = new Date(ts);
  return _day(d.getFullYear(), d.getMonth(), d.getDate());
}

function _createdAts(res) {
  if (res && res.createdAt && res.createdAt.length) return res.createdAt;
  return (res && res.users ? res.users : []).map((u) => u.createdAt);
}

function _counts(ats, now) {
  const days = new Array(WEEK_SPAN * WEEK).fill(0);
  ats.forEach((t) => {
    const i = Math.floor((now - t) / 86400000);
    if (i >= 0 && i < days.length) days[i] += 1;
  });
  return days;
}

function _bars(days) {
  const bars = [];
  let peak = 0;
  for (let w = WEEK_SPAN - 1; w >= 0; w--) {
    let v = 0;
    for (let d = 0; d < WEEK; d++) v += days[(WEEK_SPAN - 1 - w) * WEEK + d] || 0;
    if (v > peak) peak = v;
    bars.push({ i: w, v: v, h: 0 });
  }
  bars.forEach((b) => {
    b.h = peak ? Math.round((b.v / peak) * 100) : 0;
  });
  return bars;
}

function _curve(ats, now, days) {
  if (!ats.length || days < 2) return "";
  const buckets = Math.min(days, 36);
  const size = days / buckets;
  const sums = new Array(buckets).fill(0);
  ats.forEach((t) => {
    const ago = (now - t) / 86400000;
    if (ago < 0 || ago >= days) return;
    sums[buckets - 1 - Math.floor(ago / size)] += 1;
  });
  const peak = Math.max.apply(null, sums) || 1;
  const y = (v) => Math.round(Math.max(0, Math.min(CURVE_H, CURVE_H - (v / peak) * (CURVE_H - 2) - 1)) * 10) / 10;
  const pts = sums.map((v, i) => ({
    x: Math.round(((i * CURVE_W) / (buckets - 1)) * 10) / 10,
    v: v
  }));
  const flat = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 2] || pts[i - 1];
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const p3 = pts[i + 1] || p2;
    for (let k = 1; k <= 3; k++) {
      const t = k / 3;
      const smooth = (a, b, c, d) =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t
          + (3 * b - a - 3 * c + d) * t * t * t);
      flat.push({
        x: Math.round(smooth(p0.x, p1.x, p2.x, p3.x) * 10) / 10,
        v: Math.max(0, smooth(p0.v, p1.v, p2.v, p3.v))
      });
    }
  }
  return flat.map((q) => q.x + "," + y(q.v)).join(" ");
}

function summarize(at, total) {
  const now = Date.now();
  const today = new Date(_startOf(now));
  const ats = (at || []).map(Number).filter((t) => t > 0 && t <= now);
  const bars = _bars(_counts(ats, now));
  const ranges = RANGES.map((r) => {
    const from = _day(today.getFullYear(), today.getMonth(), today.getDate() - r.days + 1);
    const n = ats.filter((t) => t >= from).length;
    return {
      key: r.key,
      label: r.label,
      days: r.days,
      added: n,
      avg: Math.round((n / r.days) * 100) / 100,
      line: _curve(ats, now, r.days - 1)
    };
  });
  return { total: Number(total) || ats.length, loaded: ats.length, bars: bars, ranges: ranges };
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
      msg: "改不了：要么服务器没接上，要么您不是管理员"
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

function refreshSession() {
  return remote.sessionRefresh();
}

module.exports = {
  loggedIn,
  list,
  summarize,
  defaultRange: function () {
    return DEFAULT_RANGE;
  },
  setTier,
  revokeTier,
  canWrite,
  roster
};
