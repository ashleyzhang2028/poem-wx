"use strict";

var handler = require("../_lib/handler");
var H = require("../_lib/http");
var identity = require("../_lib/identity");

var TABLES = ["accounts", "codes", "sessions", "progress", "verifications", "resets"];

var ACCOUNT_COLS = [
  "uid", "email", "email_hash", "nickname", "plan", "plan_until", "role",
  "created_at", "last_login_at", "status", "email_verified_at", "password_hash", "password_salt"
];

var PROGRESS_COLS = ["uid", "child_id", "poem_id", "payload", "updated_at", "deleted"];

function originOf(d, req) {
  var proto = String((req.headers || {})["x-forwarded-proto"] || "https").split(",")[0].trim();
  var host = String((req.headers || {})["x-forwarded-host"] || (req.headers || {}).host || "localhost").split(",")[0].trim();
  if (!/^[a-z]+$/.test(proto)) proto = "https";
  if (!/^[A-Za-z0-9.:_-]+$/.test(host)) host = "localhost";
  var cfgSite = String(d.cfg.siteUrl || "").replace(/\/+$/, "");
  return { siteUrl: cfgSite, current: proto + "://" + host };
}

function originMatch(a, b) {
  function norm(u) {
    return String(u || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  }
  return !!a && !!b && norm(a) === norm(b);
}

function dbSummary(d) {
  var store = d.store || {};
  var kind = String(store.kind || "unknown");
  return Promise.resolve({
    kind: kind,
    usable: kind !== "memory",
    degraded: (function () {
      try { return typeof store.degrade === "function" ? (store.degrade() || []) : []; } catch (e) { return []; }
    })()
  });
}

var TURNSTILE_PROBE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function turnstileProbe(cfg) {
  var secret = String((cfg && cfg.turnstileSecretKey) || "");
  if (!secret) return Promise.resolve(null);
  var body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", "__diag__");
  var t0 = Date.now();
  return fetch(TURNSTILE_PROBE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  }).then(function (r) {
    return r.text().then(function (t) {
      var data = null;
      try { data = JSON.parse(t); } catch (e) { data = null; }

      var codes = (data && (data.error_codes || data["error-codes"])) || [];

      var bad = codes.indexOf("invalid-input-secret") >= 0;
      var ok = codes.indexOf("invalid-input-response") >= 0;
      return {
        httpStatus: r.status,
        ms: Date.now() - t0,
        reachable: true,
        secretValid: ok ? true : (bad ? false : null),
        codes: codes
      };
    });
  })["catch"](function (e) {
    var cause = e && e.cause ? String(e.cause.code || e.cause.message || e.cause) : "";
    return {
      httpStatus: 0,
      ms: Date.now() - t0,
      reachable: false,
      secretValid: null,
      upstream: (String((e && e.message) || e) + (cause ? " (" + cause + ")" : "")).slice(0, 300)
    };
  });
}

var VERDICT_TEXT = {
  no_secret: "缺 SESSION_SECRET：会话签不出来，所有 /api/* 会回 503",
  db_not_configured: "没接上 MySQL：账号只活在当前实例的内存里，重启即丢。看服务启动日志里那行 [store]",
  db_no_column: "存储层报形状不对：照服务启动日志里的提示跑 deploy/sql/mysql-schema.sql",
  api_not_mounted: "本站的 /api/* 没挂到函数上 —— 你访问的这个域名上和 SITE_URL（本应用写进邮件里的地址）对不上，注册请求压根没到本站的服务端。多半是这次部署 `/api/*` 没接上，重新部署一次再看",
  ok: "一路都通：注册出问题就不在配置这一层了，请把本页的「服务端自报」整段贴给 CodeBuddy"
};

function verdictOf(r) {
  if (!r.session.ok) return "no_secret";
  if (r.database.mode === "memory") return "db_not_configured";
  if (r.database.degraded && r.database.degraded.length) return "db_no_column";
  return "ok";
}

function turnstileWidgetState(cfg) {
  if (cfg.turnstileBypass === true) return "bypassed";
  if (cfg.turnstileEnabled !== true) return "disabled";
  if (!String(cfg.turnstileSiteKey || "")) return "no_site_key";
  if (!String(cfg.turnstileSecretKey || "")) return "no_secret_key";
  return "renders";
}

function turnstileNote(cfg, probe) {
  var w = turnstileWidgetState(cfg);
  if (w === "bypassed") {
    return "⚠️ TURNSTILE_BYPASS=1：人机校验被整个绕开了（这条只在本地/CI 用，生产绝不许开）";
  }
  if (w === "disabled") return null;
  if (w === "no_site_key") {
    return "TURNSTILE_ENABLED=1 但没填 TURNSTILE_SITE_KEY：**前端不会渲染方框**，而服务端照旧在拦 —— 于是每一次登录/注册都会被拒（400 E_TURNSTILE）。两个 key 是一对，缺一个都跑不起来";
  }
  if (probe && probe.secretValid === false) {
    return "TURNSTILE_SECRET_KEY 无效：Cloudflare 回 invalid-input-secret —— 多半是**把 Site Key 与 Secret Key 弄混了**（两个长得像），或 key 已被删除/重置。页面上的症状就是「方框一直不出现」";
  }
  if (probe && probe.reachable === false) {
    return "打不通 challenges.cloudflare.com/siteverify（HTTP 0）：服务端验不了 token，**所有登录/注册都会回 400 E_TURNSTILE** —— 查这台部署的网络出口 / 代理";
  }
  return "开关与两个 key 都在。方框仍需**浏览器**里真渲染一次才算数 —— 页面上不出现方框时，看浏览器控制台（多半是 Site Key 填错，或本站域名没加进那个 widget 的允许列表）";
}

function sessionReport(d) {
  var key = d.cfg.sessionKeyOf.call(d.cfg);
  return { ok: key.length >= 16, keyLength: key.length, cookieName: d.cfg.cookieName };
}

function mailReport(d) {
  return { transport: d.cfg.mail(), real: d.cfg.mail() !== "console" };
}

module.exports = handler.make("diag", ["GET"], function (d, body, req) {

  var t0 = d.now();
  var gates = [["ip", "diag:" + d.ip], ["global", "diag"]];
  for (var gi = 0; gi < gates.length; gi++) {
    var g = d.limiter.take(d.cfg, gates[gi][0], gates[gi][1], t0);
    if (!g.ok) {
      var rc = handler.core.rateCode(gates[gi][0]);
      return { status: 429, body: { code: rc, message: handler.core.RATE_MSG[rc], retryAfter: g.retryAfter } };
    }
  }
  var o = originOf(d, req);
  var r = {
    generatedAt: new Date().toISOString(),
    site: {
      siteUrl: o.siteUrl,
      currentOrigin: o.current,
      match: originMatch(o.siteUrl, o.current),
      apiBase: "/api"
    },
    session: sessionReport(d),
    database: { mode: (d.store && d.store.kind) || "unknown", probe: {} },
    mail: mailReport(d),
    limits: { passwordMin: d.cfg.passwordMin, passwordMax: d.cfg.passwordMax },
    turnstile: {
      server: !!handler.core.turnstileReady(d.cfg),
      bypass: d.cfg.turnstileBypass === true,
      enabledFlag: d.cfg.turnstileEnabled === true,
      hasSiteKey: !!d.cfg.turnstileSiteKey,
      hasSecretKey: !!d.cfg.turnstileSecretKey,

      widget: null,
      note: null,
      secretProbe: null
    }
  };

  var jobs = [dbSummary(d).then(function (s2) { r.database.probe = s2; })];

  return Promise.all(jobs).then(function () {
    var code = verdictOf(r);
    var out = { verdict: code, verdictText: VERDICT_TEXT[code] };

    out.site = r.site;
    out.session = r.session;
    out.mail = r.mail;
    out.limits = r.limits;
    out.turnstile = r.turnstile;
    out.serviceKeyShape = r.serviceKeyShape || null;
    out.database = {
      mode: r.database.mode,
      degraded: (r.database.probe && r.database.probe.degraded) || [],
      usable: !!(r.database.probe && r.database.probe.usable)
    };
    out.checks = [
      { name: "会话密钥 ≥ 16 字符", ok: out.session.ok },
      { name: "存储层不是内存档（内存档重启即丢）", ok: out.database.usable,
        hint: out.database.usable ? null : "看服务启动日志里那行 [store] —— 多半是 MYSQL_* 没配" },
      {
        name: "人机校验的方框在浏览器里该出现（Site Key + Secret Key + 开关三者都要）",
        ok: out.turnstile.widget === "renders" ? true
          : (out.turnstile.widget === "bypassed" ? null
            : (out.turnstile.widget === "disabled" ? null : false)),
        hint: out.turnstile.note
      }
    ];
    out.nextSteps = [
      { n: 1, name: "探活", cmd: "curl -sS https://<你的域名>/healthz" },
      { n: 2, name: "会话可签", cmd: "curl -sS https://<你的域名>/api/me" },
      { n: 3, name: "库通不通", cmd: "curl -sS https://<你的域名>/api/diag" }
    ];

    out.turnstile.expected = (function () {
      var site = String(o.current || "").replace(/\/+$/, "");
      return {
        config: site + "/api/config",
        expectWhenRenders: '{"turnstile":{"enabled":true,"siteKey":"0x..."}}',
        expectWhenPartial: '{"turnstile":{"enabled":false}}'
      };
    })();

    out.neverSend = ["SESSION_SECRET 的值", "MYSQL_PASSWORD 的值", "用户密码", "任何完整邮箱", "TURNSTILE_SECRET_KEY 的值"];

    return { status: 200, body: { code: "E_DIAG", message: "诊断报告见 body", report: out }, headers: { "Cache-Control": "no-store" } };
  });
});
