(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Entitlement = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var NS = "poem_plan_v1";

    var SEEN = "poem_plan_seen_v1";

  var NOTICE = "poem_plan_notice_v1";

  var TIERS = ["free", "pro", "max"];

  var ROLES = ["owner", "admin", "user"];

  var CAPS = {

    "recite.basic":      { minTier: "free", login: false, quota: null, name: "每日背诵" },

    "library.all":       { minTier: "free", login: false, quota: null, name: "课外阅读" },

    "read.aloud":        { minTier: "free", login: true,  quota: null, name: "语音朗读" },
    "pinyin.helper":     { minTier: "free", login: false, quota: null, name: "阅读辅助" },
        "export.progress":   { minTier: "free", login: true,  quota: null, name: "进度导出" },

        "algo.ebbinghaus":   { minTier: "free", login: false, quota: null, name: "艾宾浩斯遗忘曲线",
                           breaks: ["遗忘曲线"] },
    "algo.leitner":      { minTier: "free", login: true,  quota: null, name: "莱特纳盒" },
    "algo.sm2":          { minTier: "pro",  login: true,  quota: null, name: "SM-2 复习" },
    "algo.fsrs":         { minTier: "max",  login: true,  quota: null, name: "FSRS 复习" },

    "collections.many":  { minTier: "pro",  login: true,  quota: null, name: "自选清单",
                           quotas: { free: 10, pro: 100, max: 5000 } },
    "sync.multiDevice":  { minTier: "pro",  login: true,  quota: null, name: "设备同步" },
    "export.paper":      { minTier: "pro",  login: true,  quota: null, name: "PDF / 打印" },

    "profile.family":    { minTier: "pro",  login: true,  quota: null, name: "子用户",
                           quotas: { free: 1, pro: 3, max: 180 } },

    "quiz.review":       { minTier: "pro",  login: true,  quota: null, name: "题库" },

        "export.all":        { minTier: "pro",  login: true,  quota: null, name: "课内诗词 导出",
                           breaks: ["导出"],
                           quotas: { free: 0, pro: 251, max: 251 } },

    "feihualing":        { minTier: "max",  login: true,  quota: null, name: "飞花令" },
        "exam.gathering":    { minTier: "max",  login: true,  quota: null, name: "古诗词 大会",
                           breaks: ["大会"] },
        "exam.paper":        { minTier: "max",  login: true,  quota: null, name: "模拟考试" },
        "exam.formal":       { minTier: "max",  login: true,  quota: null, name: "考试" },
        "exam.changshi":     { minTier: "pro",  login: true,  quota: null, name: "文学常识考试" }

  };

  var ALIAS = {};

  function tierIndex(t) {
    var i = TIERS.indexOf(t);
    return i < 0 ? 0 : i;
  }

  function isTier(t) { return TIERS.indexOf(t) >= 0; }
  function isRole(r) { return ROLES.indexOf(r) >= 0; }

    function isOwner(backing, opt) {
    var opt2 = opt || {};
    var b = backing || defaultBacking();
    var plan = readPlan(b);

        var uid = opt2.uid !== undefined ? opt2.uid : sessionUid(b, opt2.authStore);

        if (!plan || plan.source !== "server" || !ownsPlan(plan, uid)) return false;
    return isAdminRole(plan.role);
  }

    function sessionUid(backing, authStore) {
    var store = authStore || null;
    if (!store) {
      var b = backing || defaultBacking();
      if (!b) return "";
            try { store = authStoreFactory(b); } catch (e) { store = null; }
    }
    if (!store) return "";
    var s = null;
    try { s = authSession(store); } catch (e) { s = null; }
    return (s && s.account && s.account.uid) || "";
  }

  function isAdminRole(role) {
    var r = String(role == null ? "" : role).trim().toLowerCase();
    return r === "owner" || r === "admin";
  }

  function readPlan(backing) {
    if (!backing) return null;
    var text = null;
    try { text = backing.getItem(NS); } catch (e) { return null; }
    if (!text) return null;
    var o = null;
    try { o = JSON.parse(text); } catch (e) { return null; }
    return o && typeof o === "object" ? o : null;
  }

  function readTier(backing) {
    var o = readPlan(backing);
    if (!o) return "free";
    var until = o.until == null ? null : Number(o.until);
    if (until !== null && isFinite(until) && until <= Date.now()) return "free";
    return isTier(o.tier) ? o.tier : "free";
  }

  function readServerTier(backing, uid) {
    var o = readPlan(backing);
    if (!o || o.source !== "server") return null;
    if (uid !== undefined && !ownsPlan(o, uid)) return null;
    var until = o.until == null ? null : Number(o.until);
    if (until !== null && isFinite(until) && until <= Date.now()) return "free";
    return isTier(o.tier) ? o.tier : null;
  }

    function ownsPlan(plan, uid) {
    if (!plan || plan.source !== "server") return false;
    var mine = String(uid == null ? "" : uid);
    if (!mine) return false;
    return String(plan.uid == null ? "" : plan.uid) === mine;
  }

  function readServerRole(backing, uid) {
    var o = readPlan(backing);
    if (!o || o.source !== "server") return null;
    if (uid !== undefined && !ownsPlan(o, uid)) return null;
    return isRole(o.role) ? o.role : null;
  }

  function tierSource(backing, uid) {
    var o = readPlan(backing);
    if (!o || o.source !== "server") return "local";
    if (uid !== undefined && !ownsPlan(o, uid)) return "local";
    return "server";
  }

    function writeTier(backing, tier, until, opt) {
    if (!backing) return { ok: false, code: "E_STORAGE", message: "浏览器不允许保存数据" };
    if (!isTier(tier)) return { ok: false, code: "E_TIER", message: "不认识的层级" };
    var o = opt || {};
    var payload = { v: 1, tier: tier, until: until == null ? null : Number(until) };
    if (o.source) payload.source = String(o.source);
    if (o.role && isRole(o.role)) payload.role = o.role;
        if (o.email) payload.email = String(o.email);
    if (o.uid) payload.uid = String(o.uid);
    // Plans only change through the admin page, so a server-confirmed rise for the same user is an upgrade.
    var before = payload.source === "server" && payload.uid ? readServerTier(backing, payload.uid) : null;
    try {
      backing.setItem(NS, JSON.stringify(payload));
            if (payload.source === "server") backing.setItem(SEEN, stampOf(payload));
      else backing.removeItem(SEEN);
    } catch (e) {
      return { ok: false, code: "E_STORAGE", message: "浏览器不允许保存数据" };
    }
    if (payload.source === "server" && payload.uid) noteUpgrade(backing, payload, before);
    announce();
    return { ok: true };
  }

  function noteUpgrade(backing, payload, before) {
    var pending = readNotice(backing, payload.uid);
    try {
      if (before && tierIndex(payload.tier) > tierIndex(before)) {
        backing.setItem(NOTICE, JSON.stringify({
          v: 1, uid: payload.uid, from: before, to: payload.tier, until: payload.until, at: Date.now()
        }));
      } else if (pending && tierIndex(payload.tier) < tierIndex(pending.to)) {
        backing.removeItem(NOTICE);
      }
    } catch (e) {  }
  }

  function readNotice(backing, uid) {
    var b = backing || defaultBacking();
    if (!b) return null;
    var o = null;
    try { o = JSON.parse(b.getItem(NOTICE) || "null"); } catch (e) { o = null; }
    if (!o || typeof o !== "object" || !isTier(o.to) || !o.uid) return null;
    if (uid !== undefined && String(o.uid) !== String(uid || "")) return null;
    return o;
  }

  function clearNotice(backing) {
    var b = backing || defaultBacking();
    if (!b) return false;
    try { b.removeItem(NOTICE); } catch (e) { return false; }
    return true;
  }

  function clearTier(backing) {
    if (!backing) return { ok: false };
    try { backing.removeItem(NS); } catch (e) {  }
        try { backing.removeItem(SEEN); } catch (e) {  }
    announce();
    return { ok: true };
  }

    function announce() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    if (!g || typeof g.dispatchEvent !== "function" || typeof g.Event !== "function") return;
    try { g.dispatchEvent(new g.Event("entitlementchange")); } catch (e) {  }
  }

  function cap(name) {
    var key = Object.prototype.hasOwnProperty.call(ALIAS, name) ? ALIAS[name] : name;
    return CAPS[key] || null;
  }

  function capNames() {
    var out = Object.keys(CAPS);
    Object.keys(ALIAS).forEach(function (a) { if (out.indexOf(a) < 0) out.push(a); });
    return out.sort();
  }

  function can(name, ctx) {
    var c = cap(name);
    var k = ctx || {};
    var tier = isTier(k.tier) ? k.tier : "free";
    var signedIn = !!k.signedIn;

    if (!c) {
      return { ok: false, reason: "unknown", minTier: "free", quota: null, name: "" };
    }
    if (c.login && !signedIn) {
      return { ok: false, reason: "login", minTier: c.minTier, quota: c.quota, name: c.name };
    }
    if (tierIndex(tier) < tierIndex(c.minTier)) {
      return { ok: false, reason: "tier", minTier: c.minTier, quota: c.quota, name: c.name };
    }
    return { ok: true, reason: "ok", minTier: c.minTier, quota: c.quota, name: c.name };
  }

  function denyReason(name, ctx) {
    var r = can(name, ctx);
    if (r.ok) return "";
    if (r.reason === "unknown") return "这个功能暂不可用";
    if (r.reason === "login") return "登录可用";
    return r.minTier === "max" ? "Max 起" : "Pro 起";
  }

  function tierLabel(tier) {
    var t = isTier(tier) ? tier : "free";
    return t === "max" ? "Max" : t === "pro" ? "Pro" : "Free";
  }

  function matrix(ctx) {
    return Object.keys(CAPS).map(function (k) {
      var c = CAPS[k];
      var r = can(k, ctx);
      return {
        cap: k, name: c.name, ok: r.ok, reason: r.reason,
        minTier: c.minTier, quota: c.quota,
        hint: r.ok ? (c.quota ? "每月 " + c.quota + " 次" : "") : denyReason(k, ctx)
      };
    });
  }

  var COLUMNS = [
    { id: "guest", tier: "free", guest: true  },
    { id: "free",  tier: "free", guest: false },
    { id: "pro",   tier: "pro",  guest: false },
    { id: "max",   tier: "max",  guest: false }
  ];

  function columnLabel(col) {
    if (!col) return "";
    if (col.guest) return "游客";
    return tierLabel(col.tier);
  }

  function quotaFor(c, tier) {
    if (!c) return null;
    if (c.quotas && typeof c.quotas === "object") {
      if (!isTier(tier)) return null;
      var v = c.quotas[tier];
      return typeof v === "number" ? v : null;
    }
    return c.quota == null ? null : c.quota;
  }

  function quotaText(amount) {
    if (amount === Infinity) return "不限";
    if (amount === 0) return "不支持";
    return String(amount) + " 个";
  }

  function compare(o) {
    var opt = o || {};
    var now = typeof opt.now === "number" ? opt.now : undefined;

    var cols = COLUMNS.map(function (c) {
      return { id: c.id, guest: !!c.guest, tier: c.tier, label: columnLabel(c) };
    });

    var rows = Object.keys(CAPS).map(function (k) {
      var c = CAPS[k];
      var cells = COLUMNS.map(function (col) {

        var ctx = { tier: col.tier, signedIn: !col.guest };
        if (now !== undefined) ctx.now = now;
        var r = can(k, ctx);

        var amount = quotaFor(c, col.tier);
        return {
          ok: r.ok,
          reason: r.ok ? "ok" : r.reason,
          quota: amount,

          hint: r.ok
            ? (amount == null ? (c.quota ? "每月 " + c.quota + " 次" : "") : quotaText(amount))
            : denyReason(k, ctx)
        };
      });
            return { cap: k, name: c.name, breaks: c.breaks || null,
               quota: c.quota, quotas: c.quotas || null,
               unit: c.unit || "", minTier: c.minTier, cells: cells };
    });

    var groups = [];
    var byMin = { free: [], pro: [], max: [] };
    rows.forEach(function (r) {
      (byMin[r.minTier] || byMin.free).push(r);
    });
    [

      { key: "free", title: "所有版本都有" },
      { key: "pro", title: "Pro 起" },
      { key: "max", title: "Max 起" }
    ].forEach(function (g) {
      if (byMin[g.key].length) groups.push({ key: g.key, title: g.title, note: g.note, rows: byMin[g.key] });
    });

    var summary = cols.map(function (col, i) {
      var on = 0;
      rows.forEach(function (r) { if (r.cells[i] && r.cells[i].ok) on += 1; });
      return { id: col.id, label: col.label, ok: on, total: rows.length };
    });

    return { cols: cols, rows: rows, groups: groups, summary: summary };
  }

  function identity(o) {
    var opt = o || {};
    var backing = opt.backing || defaultBacking();
    var t = typeof opt.now === "number" ? opt.now : Date.now();

    var authStore = opt.authStore || (function () {
      var g = typeof globalThis !== "undefined" ? globalThis : null;
      var A = (g && g.AuthCore) || null;
      try { return A && A.makeStore ? A.makeStore(backing) : null; } catch (e) { return null; }
    })();

    var uid = "", email = "", signedIn = false;

        if (authStore) {
      var s = null;
      try { s = authSession(authStore); } catch (e) { s = null; }
      if (s && s.account) {
        signedIn = true;
        uid = s.account.uid || "";
                var ids = s.account.identities || [];
        for (var i = 0; i < ids.length; i++) {
          if (ids[i] && ids[i].value) { email = ids[i].value; break; }
        }
      }
    }

        var localSignedIn = signedIn;
    var cookie = cookieSession({ backing: backing, now: t });

    if (!localSignedIn && cookie) {
      signedIn = true;
      uid = cookie.uid || "";
      email = cookie.email || "";
    }

        var serverTier = readServerTier(backing, uid);
    var serverRole = readServerRole(backing, uid);

        var role = isAdminRole(serverRole) ? String(serverRole).toLowerCase() : "user";

    if (localSignedIn) {
      var acc = null;
      try { acc = authSession(authStore).account; } catch (e) { acc = null; }
      var accTier = acc && acc.plan && acc.plan.tier;
      if (isTier(accTier) && accTier !== "free") {
        return finish(accTier, signedIn, uid, email, role, "local");
      }
      if (serverTier && serverTier !== "free") {
        return finish(serverTier, signedIn, uid, email, role, "server");
      }
    }

        var tier = readTier(backing);

    if (serverTier && tierIndex(serverTier) > tierIndex(tier)) tier = serverTier;
    void t;
    return finish(tier, signedIn, uid, email, role,
      serverTier && tierIndex(serverTier) >= tierIndex(tier) ? "server" : "local");
  }

    function cookieSession(o) {
    var opt = o || {};
    var backing = opt.backing || defaultBacking();
    if (!backing) return null;
    var plan = readPlan(backing);
    if (!plan || plan.source !== "server") return null;
    var uid = String(plan.uid == null ? "" : plan.uid);
    if (!uid) return null;

    if (!ownsPlan(plan, uid)) return null;

    var seen = "";
    try { seen = String(backing.getItem(SEEN) || ""); } catch (e) { seen = ""; }
    if (seen !== stampOf(plan)) return null;

    return { uid: uid, email: String(plan.email == null ? "" : plan.email) };
  }

    function stampOf(plan) {
    if (!plan) return "";
    return JSON.stringify({
      uid: String(plan.uid == null ? "" : plan.uid),
      until: plan.until == null ? null : Number(plan.until)
    });
  }

  function defaultBacking() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    if (!g) return null;
    try {
      return g.localStorage && typeof g.localStorage.getItem === "function" ? g.localStorage : null;
    } catch (e) {
      return null;
    }
  }

    var authCoreRef = function () {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    return (g && g.AuthCore) || null;
  };

  var authSession = function (authStore) {
    var A = authCoreRef();
    if (A && A.session) return A.session(authStore);
    return null;
  };

  var authStoreFactory = function (backing) {
    var A = authCoreRef();
    try { return A && A.makeStore ? A.makeStore(backing) : null; } catch (e) { return null; }
  };

  function setAuthCore(A) {
    authCoreRef = function () { return A || null; };
        authSession = function (authStore) { return A && A.session ? A.session(authStore) : null; };
    authStoreFactory = function (backing) {
      try { return A && A.makeStore ? A.makeStore(backing) : null; } catch (e) { return null; }
    };
  }

  function finish(tier, signedIn, uid, email, role, tierSource) {
    var ctx = { tier: tier, signedIn: signedIn };
    return {
      uid: uid, email: email, signedIn: signedIn, tier: tier, role: role,
      tierSource: tierSource || "local",
      label: tierLabel(tier),
      ctx: ctx,
      can: function (name) { return can(name, ctx); },
      hint: function (name) { return denyReason(name, ctx); }
    };
  }

  function guestIdentity() { return finish("free", false, "", "", "user", "local"); }

  return {
    NS: NS,
    TIERS: TIERS, ROLES: ROLES, CAPS: CAPS, ALIAS: ALIAS,
    capNames: capNames, cap: cap, can: can, denyReason: denyReason,
    tierLabel: tierLabel, matrix: matrix, compare: compare, COLUMNS: COLUMNS,
    quotaFor: quotaFor, quotaText: quotaText, columnLabel: columnLabel,
    isTier: isTier, isRole: isRole,
    tierIndex: tierIndex,
    readTier: readTier, writeTier: writeTier, clearTier: clearTier,
    readPlan: readPlan, readServerTier: readServerTier,
    readServerRole: readServerRole, tierSource: tierSource,
    isOwner: isOwner, isAdminRole: isAdminRole, ownsPlan: ownsPlan, sessionUid: sessionUid,
    identity: identity, guestIdentity: guestIdentity,
    cookieSession: cookieSession, SEEN: SEEN, setAuthCore: setAuthCore,
    NOTICE: NOTICE, readNotice: readNotice, clearNotice: clearNotice,
    defaultBacking: defaultBacking
  };
});
