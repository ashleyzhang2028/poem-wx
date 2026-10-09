"use strict";

var id = require("./identity");
var mail = require("./mail");
var session = require("./session");
var turnstile = require("./turnstile");

var DAY = 86400000;

var WRONG = { uid: "wrong:", ip: "wrongip:" };

function ok(body) { return { status: 200, body: body }; }
function err(status, code, message, extra) {
  var body = { code: code, message: message };
  if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
  return { status: status, body: body };
}

function dayKey(ts) { return new Date(ts).toISOString().slice(0, 10); }

function uniqueId(taken, base) {
  if (!taken || !taken[base]) return base;
  for (var i = 1; i <= 32; i++) if (!taken[base + "-" + i]) return base + "-" + i;
  return base + "-" + Date.now();
}

function rateWindow(cfg, bucket) {
  if (bucket === "phone") return (cfg.rateSms && cfg.rateSms.phone) || [];

  if (bucket === "verify") return cfg.rateVerify || [];
  if (bucket === "reset") return cfg.rateReset || [];
  if (bucket === "login") return cfg.rateLogin || [];
  return cfg.rate[bucket] || [];
}

function rateCode(bucket) {
  if (bucket === "email" || bucket === "phone") return "E_RATE_EMAIL";
  if (bucket === "device") return "E_RATE_DEVICE";
  if (bucket === "ip") return "E_RATE_IP";
  return "E_RATE_GLOBAL";
}

var RATE_MSG = {
  E_RATE_EMAIL: "发得太快了，请稍后再试",
  E_RATE_DEVICE: "这台设备今天发送次数有点多，稍后再试",
  E_RATE_IP: "网络有点异常，稍后再试",
  E_RATE_GLOBAL: "服务忙，请稍后再试"
};

var FAIL_WIN = 3600000;

function makeRateLimiter() {
  var hits = {};
  var fails = {};

  function inspect(bucket, key, t) {
    var arr = (hits[bucket + "|" + key] || []).filter(function (x) { return x > t - DAY; });
    hits[bucket + "|" + key] = arr;
    return arr;
  }
  function verdict(cfg, bucket, arr, t) {
    var windows = rateWindow(cfg, bucket);
    for (var i = 0; i < windows.length; i++) {
      var span = windows[i][0], cap = windows[i][1];
      var inWin = arr.filter(function (x) { return x > t - span; });
      if (inWin.length >= cap) {
        return { ok: false, retryAfter: Math.ceil((Math.min.apply(null, inWin) + span - t) / 1000) };
      }
    }
    return { ok: true, retryAfter: 0 };
  }
  function record(bucket, key, t) {
    hits[bucket + "|" + key] = (hits[bucket + "|" + key] || []).concat([t]);
  }
  return {
    check: function (cfg, bucket, key, t) {
      return verdict(cfg, bucket, inspect(bucket, key, t), t);
    },
    hit: function (bucket, key, t) {
      record(bucket, key, t);
    },

    take: function (cfg, bucket, key, t) {
      var v = verdict(cfg, bucket, inspect(bucket, key, t), t);
      if (!v.ok) return v;
      record(bucket, key, t);
      return { ok: true, retryAfter: 0 };
    },

    cooldown: function (bucket, key, winMs, t) {
      var arr = hits[bucket + "|" + key] || [];
      if (!arr.length) return { ok: true, retryAfter: 0 };
      var last = arr[arr.length - 1];

      var win = (winMs && typeof winMs === "object") ? Number(winMs[bucket]) || 0 : Number(winMs) || 0;
      if (!win) return { ok: true, retryAfter: 0 };
      if (last > t - win) return { ok: false, retryAfter: Math.ceil((last + win - t) / 1000) };
      return { ok: true, retryAfter: 0 };
    },

    fail: function (bucket, key, t) {
      var k = bucket + "|" + key;
      fails[k] = (fails[k] || []).concat([t]);
      return fails[k].length;
    },
    fails: function (bucket, key, t) {
      var k = bucket + "|" + key;
      fails[k] = (fails[k] || []).filter(function (x) { return x > t - FAIL_WIN; });
      return fails[k].length;
    },
    clearFails: function (bucket, key) {
      delete fails[bucket + "|" + key];
      return true;
    },
    _fails: fails,
    _hits: hits
  };
}

function accountRow(identityValue, hash, now) {
  var plain = id.normalizeEmailForStore(identityValue);
  return {
    uid: id.newUid(),

    email: plain,
    email_hash: hash,

    email_verified_at: null,

    password_hash: "",

    password_salt: "",
    nickname: "",
    plan: "free",
    plan_until: null,
    role: "user",
    created_at: now,
    last_login_at: now,

        login_count: 0,

    status: "pending"
  };
}

function publicAccount(cfg, acc) {
  var role = String(acc.role || "user").toLowerCase();
  if (["owner", "admin", "user"].indexOf(role) < 0) role = "user";
  return {
    uid: acc.uid,
    nickname: acc.nickname || "",
    plan: { tier: planTier(acc), until: acc.plan_until || null },
    role: role,
    features: featuresFor(cfg, planTier(acc)),

        email: String(acc.email || ""),

    emailVerifiedAt: acc.email_verified_at == null ? null : Number(acc.email_verified_at),
    emailVerified: acc.email_verified_at != null,

    avatar: avatarUrlOf(cfg, acc.uid),

        createdAt: Number(acc.created_at) || 0,
    lastLoginAt: Number(acc.last_login_at) || 0,

    channel: channelFacts(cfg)
  };
}

function avatarUrlOf(cfg, uid) {
  try {
    if (typeof cfg.avatarPublicUrl !== "function") return "";
    var u = String(uid || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (u.length < 2) return "";
    return String(cfg.avatarPublicUrl(u) || "");
  } catch (e) {
    return "";
  }
}

function channelFacts(cfg) {
  var mail = typeof cfg.mail === "function" ? cfg.mail() : "console";
  var hasDb = typeof cfg.hasDb === "function" ? !!cfg.hasDb() : false;
  return {
    mail: mail,
    delivered: mail !== "console",
    db: hasDb ? "db" : "memory",
    sms: !!(cfg.smsEnabled && cfg.smsTransport),

    emailGate: !!requireVerified(cfg),

    requireVerified: !!requireVerified(cfg),
    emailDeliverable: mail !== "console",

    turnstile: turnstileReady(cfg),

    rate: "instance"
  };
}

function turnstileReady(cfg) {
  return turnstile.turnstileReady(cfg);
}

function planTier(acc) {
  var p = String(acc.plan || "free").toLowerCase();
  if (["free", "pro", "max"].indexOf(p) < 0) return "free";
  if (acc.plan_until && Number(acc.plan_until) <= Date.now()) return "free";
  return p;
}

function featuresFor(cfg, tier) {

  var base = ["recite.basic", "library.all", "read.aloud", "pinyin.helper", "export.progress",

              "algo.ebbinghaus", "algo.leitner"];

  var pro = ["collections.many", "sync.multiDevice", "export.paper",
             "profile.family", "quiz.review", "export.all",

             "exam.changshi",

             "algo.sm2"];

    var max = ["feihualing", "exam.gathering", "exam.paper", "exam.formal",

             "algo.fsrs"];

  var out = base.slice();
  if (tier === "pro" || tier === "max") out = out.concat(pro);
  if (tier === "max") out = out.concat(max);
  return out;
}

function normalizeGrants(_untrusted) {
  return "free";
}

function pepperOf(cfg) {
  if (typeof cfg.sessionKeyOf === "function") return cfg.sessionKeyOf.call(cfg);
  return String(cfg.sessionSecret || cfg.sessionKey || "");
}

// Locks live in `locked_until`; `status` keeps meaning pending/active so an
// expired lock can never promote an unverified account to active.
function isLocked(acc, t) {
  return (Number(acc && acc.locked_until) || 0) > t;
}

function lockRetryAfter(acc, t) {
  return Math.max(1, Math.ceil(((Number(acc.locked_until) || 0) - t) / 1000));
}

// Rows written by the old code carry status "locked" with no expiry.
function repairLegacyLock(acc) {
  if (acc && acc.status === "locked") acc.status = acc.email_verified_at != null ? "active" : "pending";
  return acc;
}

function lockAccount(store, acc, until) {
  acc.locked_until = until;
  repairLegacyLock(acc);
  return Promise.resolve(store.patchAccount(acc.uid, { locked_until: until, status: acc.status }));
}

function ownerEmailsOf(cfg) {
  var raw = String((cfg && cfg.ownerEmails) || "");
  if (!raw) return [];
  return raw.split(/[,\s;]+/).map(function (x) {
    return id.normalizeEmail(x);
  }).filter(function (x) { return !!x; });
}

function isOwnerEmail(cfg, email) {
  var e = id.normalizeEmail(email);
  if (!e) return false;
  return ownerEmailsOf(cfg).indexOf(e) >= 0;
}

function claimOwnerRole(store, cfg, acc) {
  if (!acc || acc.status === "deleted") return Promise.resolve(false);
  if (!isOwnerEmail(cfg, acc.email)) return Promise.resolve(false);
  if (String(acc.role || "user").toLowerCase() === "owner") return Promise.resolve(false);
  return Promise.resolve(store.patchAccount(acc.uid, { role: "owner" })).then(function () {

    acc.role = "owner";
    return true;
  });
}

function findOrCreateAccount(store, cfg, identity, t) {
  var ch = identity.channel;
  var hash = ch === "sms"
    ? id.phoneHash(identity.value, pepperOf(cfg))
    : id.emailHash(identity.value, pepperOf(cfg));
  return Promise.resolve(store.getAccountByHash(hash)).then(function (acc) {
    if (acc && acc.status !== "deleted") return { acc: acc, created: false };

    var row = accountRow(identity.raw != null ? identity.raw : identity.value, hash, t);
    return Promise.resolve(store.putAccount(row)).then(function (saved) {
      return { acc: saved || row, created: true };
    });
  });
}

function normIdentity(input) {
  var ch = input && input.channel;
  if (ch === undefined || ch === null || ch === "") ch = "email";
  ch = String(ch).toLowerCase();
  if (ch !== "email" && ch !== "sms") {
    return { bad: "E_CHANNEL", message: "暂时不支持这种登录方式" };
  }
  var raw = input.value != null ? input.value : input.email != null ? input.email : input.phone;
  if (ch === "email") {
    var email = id.normalizeEmail(raw);
    if (!id.isEmailShape(email)) return { bad: "E_EMAIL_FORMAT", message: "这个邮箱看起来不太对，再检查一下" };

    return { channel: ch, value: email, raw: id.normalizeEmailForStore(raw), bucket: "email", key: email };
  }
  var phone = id.normalizePhone(raw);
  if (!id.isPhoneShape(phone)) return { bad: "E_PHONE_FORMAT", message: "这个手机号看起来不太对，再检查一下" };
    return { channel: ch, value: phone, raw: phone, mask: id.maskPhone(phone), bucket: "phone", key: phone };
}

function smsReady(cfg) {
  return !!(cfg.smsEnabled && cfg.smsTransport);
}

function humanGuard(deps, input) {
  var cfg = deps && deps.cfg ? deps.cfg : deps;
  input = input || {};

  var token = input.turnstileToken != null ? input.turnstileToken : input["cf-turnstile-response"];
  return turnstile.guard(cfg, {
    token: token,
    ip: deps && deps.ip,
    fetch: cfg && cfg.turnstileFetch,
    now: deps && deps.now
  });
}

function sendCode(deps, input) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();

  var who = normIdentity(input);
  if (who.bad) return Promise.resolve(err(400, who.bad, who.message));

  var isSms = who.channel === "sms";
  var purpose = input.purpose === "reset" ? "reset" : "login";
  var device = String(input.deviceId || "unknown").slice(0, 40);
  var ip = String(input.ip || "unknown");

  return humanGuard(deps, input).then(function (blocked) {
    if (blocked) return blocked;
    return sendCodeAfterGuard(deps, input, who, isSms, purpose, device, ip);
  });
}

function sendCodeAfterGuard(deps, input, who, isSms, purpose, device, ip) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();

  if (isSms && !smsReady(cfg)) {
    return Promise.resolve(err(503, "E_SMS_NOT_OPEN",
      "短信登录还没开通（需要先签短信商并完成模板报备）。当前可用邮箱随机码登录。"));
  }

  var buckets, coolMs, coolBucket, coolKey;
  if (isSms) {
    buckets = [["phone", who.key], ["device", device], ["ip", ip], ["global", "all"]];
    coolBucket = "phone"; coolKey = who.key;
    coolMs = cfg.smsResendCooldownMs || 60000;
  } else {
    buckets = [["email", who.key], ["device", device], ["ip", ip], ["global", "all"]];
    coolBucket = "email"; coolKey = who.key;
    coolMs = cfg.resendCooldownMs;
  }

  var cool = limiter.cooldown(coolBucket, coolKey, coolMs, t);
  if (!cool.ok) {
    return Promise.resolve(err(429, "E_RATE_EMAIL", "发得太快了，请稍后再试", { retryAfter: cool.retryAfter }));
  }

  for (var i = 0; i < buckets.length; i++) {

    var g = limiter.take(cfg, buckets[i][0], buckets[i][1], t);
    if (!g.ok) {
      var code = rateCode(buckets[i][0]);

      return Promise.resolve(err(429, code, RATE_MSG[code] || "发得太快了，请稍后再试", { retryAfter: g.retryAfter }));
    }
  }

  var rawCode = input.code || id.newCode(cfg.codeLength);
  var salt = id.newSalt();
  var echoAllowed = false;

  return findOrCreateAccount(store, cfg, who, t).then(function (r) {
    var acc = r.acc;

    if (isLocked(acc, t)) {
      return err(423, "E_LOCKED", "为了安全，这个账号暂时不能收验证码",
        { retryAfter: lockRetryAfter(acc, t) });
    }
    if (acc.locked_until || acc.status === "locked") {
      limiter._hits[WRONG.uid + "|" + acc.uid] = [];
      acc.locked_until = null;
      repairLegacyLock(acc);
      store.patchAccount(acc.uid, { locked_until: null, status: acc.status });
    }

    var codeId = id.newCodeId();
    var rec = {
      code_id: codeId,
      uid: acc.uid,
      purpose: purpose,
      channel: who.channel,
            sent_to: who.channel === "sms" ? who.mask : who.value,
      code_hash: id.codeHash(acc.uid, purpose, rawCode, salt, pepperOf(cfg)),
      salt: salt,
      issued_at: t,
      expires_at: t + cfg.codeTtlMs,
      attempts: 0,
      consumed_at: null
    };

    return Promise.resolve(store.voidCodes(acc.uid, purpose, t))
      .then(function () { return store.putCode(rec); })
      .then(function () {

        return sendVia(cfg, who, rawCode);
      })
      .then(function (sent) {
        echoAllowed = true;

        var body = {
          codeId: codeId,
          expiresAt: rec.expires_at,
          cooldown: Math.round(coolMs / 1000),

          transport: sent.transport,
          delivered: !!sent.delivered,
          channel: who.channel,
          store: store.kind
        };

        if (cfg.allowCodeEcho && echoAllowed) body.devCode = rawCode;
        return ok(body);
      })
      .catch(function (e) {

        var isSmsFail = isSms;

        return err(502, isSmsFail ? "E_SMS_FAIL" : "E_MAIL_FAIL",
          isSmsFail ? "短信没发出去，请稍后再试" : "验证码邮件没发出去，请稍后再试",
          { detail: String(e.message || e).slice(0, 120) });
      });
  });
}

function sendVia(cfg, who, code) {
    if (who.channel !== "sms") {
    return mail.send(cfg, { to: who.value, code: code });
  }

  var smsCfg = Object.assign({}, cfg, { mailTransport: "sms" });
  return mail.send(smsCfg, { to: who.value, mask: who.mask, code: code });
}

function bumpWrongRound(deps, uid, t) {
  var cfg = deps.cfg;
  limiterHit(deps, WRONG.uid, uid, t);
  var limit = Number(cfg.wrongRoundsLimit) || 3;
  if (wrongRounds(deps, uid) >= limit) {

    return Promise.resolve(deps.store.getAccount(uid)).then(function (acc) {
      if (!acc) return null;
      return lockAccount(deps.store, acc, t + (Number(cfg.lockMs) || 86400000));
    });
  }
  return null;
}

function limiterHit(deps, ns, key, t) {
  deps.limiter.hit(ns, String(key), t);
}

function limiterCount(deps, ns, key) {
  return (deps.limiter._hits[ns + "|" + String(key)] || []).length;
}

function wrongRounds(deps, uid) {
  return limiterCount(deps, WRONG.uid, uid);
}

function wrongByIp(deps, ip) {
  return limiterCount(deps, WRONG.ip, ip);
}

function lockVerdict(deps, uid, t) {
  var cfg = deps.cfg;
  var limit = Number(cfg.wrongRoundsLimit) || 3;
  return wrongRounds(deps, uid) >= limit;
}

function verifyCode_(deps, input) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();
  var codeId = String(input.codeId || "");
  var given = String(input.code == null ? "" : input.code).replace(/\D/g, "");
  var devKey = String(input.deviceId || "unknown");
  var ipKey = String(input.ip || "unknown");
  if (!codeId) return Promise.resolve(err(400, "E_NO_CODE", "请先获取验证码"));

  var deviceGate = limiter.take(cfg, "device", "verify:" + devKey, t);
  if (!deviceGate.ok) return Promise.resolve(err(429, "E_RATE_DEVICE", RATE_MSG.E_RATE_DEVICE, { retryAfter: deviceGate.retryAfter }));
  var ipGate = limiter.take(cfg, "ip", "verify:" + ipKey, t);
  if (!ipGate.ok) return Promise.resolve(err(429, "E_RATE_IP", RATE_MSG.E_RATE_IP, { retryAfter: ipGate.retryAfter }));

  if (wrongByIp(deps, ipKey) >= (Number(cfg.wrongRoundsLimit) || 3) * (Number(cfg.codeMaxAttempts) || 5)) {
    return Promise.resolve(err(429, "E_RATE_IP", "这个网络下猜验证码的次数太多了，稍后再试", { retryAfter: 3600 }));
  }

  if (given.length !== cfg.codeLength) return Promise.resolve(err(400, "E_CODE_WRONG", "验证码不对，再检查一下"));

  return Promise.resolve(store.getCode(codeId)).then(function (rec) {
    if (!rec) return err(400, "E_CODE_VOID", "请用最新收到的验证码");

    if (Number(rec.attempts) >= cfg.codeMaxAttempts) return err(400, "E_CODE_VOID", "请用最新收到的验证码");
    if (rec.consumed_at) return err(400, "E_CODE_USED", "这个验证码已经用过了，请重新发送");

    if (t < Number(rec.issued_at) - 120000) return err(400, "E_CODE_VOID", "请用最新收到的验证码");

    if (Number(rec.expires_at) <= t) return err(400, "E_CODE_EXPIRED", "验证码已过期，点「重新发送」");

    var expect = id.codeHash(rec.uid, rec.purpose, given, rec.salt, pepperOf(cfg));
    var same = id.timingSafeEqual(expect, rec.code_hash);

    if (!same) {

      limiterHit(deps, WRONG.ip, ipKey, t);
      var next = Number(rec.attempts) + 1;
      var patch = { attempts: next };

      if (next >= cfg.codeMaxAttempts) patch.consumed_at = t;
      var voided = next >= cfg.codeMaxAttempts;
      return Promise.resolve(store.patchCode ? store.patchCode(codeId, patch) : null)
        .then(function () {

          if (!voided) {
            return err(400, "E_CODE_WRONG", "验证码不对，再检查一下", {
              remaining: Math.max(0, cfg.codeMaxAttempts - next)
            });
          }
          return Promise.resolve(bumpWrongRound(deps, rec.uid, t)).then(function () {
            if (lockVerdict(deps, rec.uid, t)) {
              return err(423, "E_LOCKED", "为了安全，请 24 小时后再试（也可以换一个网络或用别的邮箱）",
                { retryAfter: Math.round((Number(cfg.lockMs) || 86400000) / 1000) });
            }
            return err(400, "E_CODE_VOID", "这一枚验证码已作废，请重新发送", {
              round: wrongRounds(deps, rec.uid),
              limit: Number(cfg.wrongRoundsLimit) || 3
            });
          });
        });
    }

    return Promise.resolve(store.patchCode ? store.patchCode(codeId, { consumed_at: t }) : null)
      .then(function () { return store.getAccount(rec.uid); })
      .then(function (acc) {
        if (!acc || acc.status === "deleted") return err(400, "E_CODE_VOID", "请用最新收到的验证码");
        if (isLocked(acc, t)) {
          return err(423, "E_LOCKED", "为了安全，请稍后再试", { retryAfter: lockRetryAfter(acc, t) });
        }
        repairLegacyLock(acc);

        // A code delivered to the mailbox proves ownership just like the confirm link.
        var passwordCleared = false;
        if (rec.channel !== "sms" && acc.email_verified_at == null) {
          acc.email_verified_at = t;
          if (acc.status === "pending") acc.status = "active";
          // A password set before anyone proved ownership may belong to someone else.
          if (acc.password_hash) {
            acc.password_hash = "";
            acc.password_salt = "";
            passwordCleared = true;
          }
        }

        var gate = emailGate(deps, acc);
        if (gate) return Promise.resolve(gate);
                var first = !markLogin(acc, t);
        return Promise.resolve(store.putAccount(acc)).then(function (saved) {
          // Sessions opened with the voided password belong to whoever typed it.
          if (!passwordCleared) return saved;
          return Promise.resolve(store.revokeSessions(acc.uid)).then(function () { return saved; });
        }).then(function (saved) {

          return claimOwnerRole(store, cfg, saved || acc).then(function () { return saved || acc; });
        }).then(function (saved) {

          return issueSessionFor(deps, saved || acc, first).then(function (sess) {
            if (passwordCleared && sess && sess.body) {
              sess.body.passwordCleared = true;
              sess.body.note = "邮箱已确认。注册时设的密码在确认之前填写，为了安全已作废；需要密码登录请用「忘记密码」重新设置。";
            }
            return sess;
          });
        });
      });
  });
}

function checkPassword(cfg, pw) {
  var p = String(pw == null ? "" : pw);
  if (!p) return { code: "E_PW_EMPTY", message: "请先填密码" };

  var n = Array.from ? Array.from(p).length : p.length;
  if (n < (cfg.passwordMin || 8)) {
    return { code: "E_PW_SHORT", message: "密码至少 " + (cfg.passwordMin || 8) + " 位" };
  }

  if (p.length > (cfg.passwordMax || 72)) {
    return { code: "E_PW_LONG", message: "密码太长了（最多 " + (cfg.passwordMax || 72) + " 个字符）" };
  }
  return null;
}

function requireVerified(cfg) {
  if (!cfg) return true;
  return cfg.requireEmailVerified !== false;
}

function isReturningAccount(acc) {
  if (!acc) return false;
  var n = Number(acc.login_count);
  if (acc.login_count != null && !isNaN(n)) return n > 0;

  var created = Number(acc.created_at) || 0;
  var last = Number(acc.last_login_at) || 0;
  if (!last) return false;
  if (!created) return true;
  return last !== created;
}

function markLogin(acc, t) {
  var wasReturning = isReturningAccount(acc);
  acc.last_login_at = t;
  acc.login_count = (Number(acc.login_count) || 0) + 1;
  return wasReturning;
}

function issueSessionFor(deps, acc, firstLogin) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var s = session.issue(cfg, acc.uid, t);
  return Promise.resolve(store.putSession({ sid: s.sid, uid: s.uid, iat: s.iat, exp: s.exp, revoked: 0 }))
    .then(function () {
      var pub = publicAccount(cfg, acc);
      if (firstLogin === true || firstLogin === false) pub.firstLogin = firstLogin;
      return {
        status: 200,
        body: { account: pub },
        cookies: [session.setCookieHeader(cfg, s.token, Math.round((s.exp - t) / 1000))],
        _session: s
      };
    });
}

function emailGate(deps, acc) {
  var cfg = deps && deps.cfg ? deps.cfg : deps;
  if (!requireVerified(cfg)) return null;
  if (acc && acc.email_verified_at != null) return null;

  if (!(acc && (acc.status === "pending" || acc.status === "locked"))) return null;
  return err(403, "E_EMAIL_UNVERIFIED",
    "邮箱还没确认：请点开注册时那封确认邮件里的链接。没收到就点「重新发一封」。",
    {

      email: String((acc && acc.email) || ""),

      verifySent: false,
      verifyTransport: null
    });
}

function isTokenShape(t) {
  return /^[0-9a-f]{64}$/.test(String(t || ""));
}

function findAccountByEmail(store, email) {
  var want = id.normalizeEmailForStore(email);
  return Promise.resolve(store.listAccounts()).then(function (rows) {
    var hit = null;
    (rows || []).forEach(function (a) {
      if (hit || !a || a.status === "deleted") return;
      if (String(a.email || "") === want) hit = a;
    });
    return hit;
  });
}

function storeDegrade(store) {
  try {
    return typeof store.degrade === "function" ? (store.degrade() || []) : [];
  } catch (e) {
    return [];
  }
}

function withDegrade(store, body) {
  var miss = storeDegrade(store);
  if (!miss.length) return body;
  body.storeDegraded = miss;
  body.note = (body.note ? body.note + " " : "") +
    "⚠️ 这台服务器上的表还停在旧形状，这 " + miss.length +
    " 列（" + miss.join(" / ") + "）没能写进去 —— 请把 api/_lib/schema.sql 整段重跑一次（幂等），然后重新部署。";
  return body;
}

function register(deps, input) {
  var cfg = deps.cfg;

  return humanGuard(deps, input).then(function (blocked) {
    if (blocked) return blocked;
    return registerAfterGuard(deps, input);
  });
}

function registerAfterGuard(deps, input) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();
  var email = id.normalizeEmailForStore(input.email != null ? input.email : input.value);
  if (!id.isEmailShape(email)) {
    return Promise.resolve(err(400, "E_EMAIL_FORMAT", "这个邮箱看起来不太对，再检查一下"));
  }
  var bad = checkPassword(cfg, input.password);
  if (bad) return Promise.resolve(err(400, bad.code, bad.message));

  var device = String(input.deviceId || "unknown");
  var ip = String(input.ip || "unknown");

  var rBuckets = [[cfg.rate.device ? "device" : "global", "reg:" + device], ["ip", "reg:" + ip]];
  for (var ri = 0; ri < rBuckets.length; ri++) {
    var rg = limiter.take(cfg, rBuckets[ri][0], rBuckets[ri][1], t);
    if (!rg.ok) {
      var rcode = rateCode(rBuckets[ri][0]);
      return Promise.resolve(err(429, rcode, RATE_MSG[rcode] || "稍后再试", { retryAfter: rg.retryAfter }));
    }
  }

  return findOrCreateAccount(store, cfg, { channel: "email", value: email }, t).then(function (r) {
    var acc = r.acc;
    if (isLocked(acc, t)) return err(423, "E_LOCKED", "为了安全，请稍后再试", { retryAfter: lockRetryAfter(acc, t) });
    repairLegacyLock(acc);

    // An account whose owner is already proven must never get a password from an
    // unauthenticated request: that would let anyone take it over.
    var proven = acc.email_verified_at != null || acc.status === "active";
    if (!r.created && (acc.password_hash || proven)) {
      var body = {
        uid: acc.uid,
        registerRequested: true,
        created: false,
        existing: true,
        store: store.kind,
        email: String(acc.email || email),
        emailVerified: acc.email_verified_at != null,
        requiresVerification: !proven && requireVerified(cfg),
        note: acc.password_hash
          ? "这个邮箱已经注册过，请直接用「密码登录」；忘了密码就用「忘记密码」重设。"
          : "这个邮箱已经用随机码登录过，还没有设密码。请用「快捷登录」进入，或用「忘记密码」给它设一个密码。"
      };
      return ok(withDegrade(store, body));
    }

    var salt = id.newPasswordSalt();
    acc.email = email;
    acc.password_hash = id.hashPassword(String(input.password), salt);
    acc.password_salt = salt;
    if (acc.status === "pending" || acc.status === "active") {

    } else {
      acc.status = "pending";
    }
    return Promise.resolve(store.putAccount(acc)).then(function (saved) {
      var cur = saved || acc;

      return claimOwnerRole(store, cfg, cur).then(function () { return cur; });
    }).then(function (cur) {
      return issueVerification(deps, cur).then(function (v) {
        return ok(withDegrade(store, {
          uid: cur.uid,
          registerRequested: true,
          created: r.created,
          store: store.kind,

          verifySent: v.sent,
          verifyTransport: v.transport,

          verifyAttempts: v.attempts || 1,
          verifyReason: v.reason || null,

          emailVerified: false,
          email: String(cur.email || email),

          requiresVerification: !!requireVerified(cfg),

          devVerifyToken: cfg.allowCodeEcho ? v.token : undefined,
          note: cfg.requireEmailVerified
            ? "邮箱只在你自己主动填时收集；已在库中记下。**邮箱确认之后才能登录**，请去收件箱点那条链接。"
            : "邮箱只在你自己主动填时收集；已在库中记下，供你确认与找回密码。"
        }));
      }).then(function (out) {

        return out;
      });
    });
  });
}

function issueVerification(deps, acc) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var token = id.newToken();
  var salt = id.newSalt();
  var vid = id.newVerifyId();
  var rec = {
    vid: vid,
    uid: acc.uid,
    email_hash: id.emailHash(acc.email, pepperOf(cfg)),
    token_hash: id.tokenHash(acc.uid, "verify", token, pepperOf(cfg)),
    salt: salt,
    issued_at: t,
    expires_at: t + (cfg.verifyTtlMs || 86400000),
    consumed_at: null,
    attempts: 0
  };

  return Promise.resolve(store.voidVerifications(acc.uid, t))
    .then(function () { return store.putVerification(rec); })
    .then(function () {

      return mail.confirm(cfg, { to: acc.email, vid: vid, token: token, ttlMs: cfg.verifyTtlMs });
    })
    .then(function (sent) {

      return {
        vid: vid, token: token,
        sent: !!sent.delivered,
        transport: sent.transport,
        attempts: Number(sent.attempts) || 1,
        reason: sent.reason || null
      };
    })
    .catch(function (e) {

      return {
        vid: vid, token: token, sent: false, transport: "failed",
        attempts: Number(e && e.attempts) || 1,
        reason: (e && e.reason) || "unknown"
      };
    });
}

function verifyEmail(deps, input) {
  var store = deps.store, cfg = deps.cfg, t = deps.now();
  var vhash = String(input.token || "");
  var vid = String(input.vid || "");
  if (!vid && !vhash) return Promise.resolve(err(400, "E_NO_TOKEN", "确认链接不完整，请重新发一封确认邮件"));

  function act(rec) {
    if (!rec) return err(400, "E_TOKEN_INVALID", "这个确认链接不对，请重新发一封确认邮件");
    if (rec.consumed_at) return err(400, "E_TOKEN_USED", "这个确认链接已经用过了");
    if (t < Number(rec.issued_at) - 120000) return err(400, "E_TOKEN_INVALID", "这个确认链接不对，请重新发一封确认邮件");
    if (Number(rec.expires_at) <= t) return err(400, "E_TOKEN_EXPIRED", "确认链接已过期，请重新发一封确认邮件");
    if (!input.token) {

      return err(400, "E_TOKEN_INVALID", "这个确认链接不对，请重新发一封确认邮件");
    }
    var expect = id.tokenHash(rec.uid, "verify", String(input.token), pepperOf(cfg));
    if (!id.timingSafeEqual(expect, rec.token_hash)) {
      var next = Number(rec.attempts || 0) + 1;
      return Promise.resolve(store.patchVerification ? store.patchVerification(rec.vid, { attempts: next }) : null)
        .then(function () { return err(400, "E_TOKEN_INVALID", "这个确认链接不对，请重新发一封确认邮件"); });
    }
    return Promise.resolve(store.patchVerification ? store.patchVerification(rec.vid, { consumed_at: t }) : null)
      .then(function () { return store.getAccount(rec.uid); })
      .then(function (acc) {
        if (!acc || acc.status === "deleted") return err(400, "E_TOKEN_INVALID", "这个确认链接不对，请重新发一封确认邮件");
        if (isLocked(acc, t)) {
          return err(423, "E_LOCKED", "为了安全，请稍后再试", { retryAfter: lockRetryAfter(acc, t) });
        }
        acc.email_verified_at = t;
        repairLegacyLock(acc);
        if (acc.status === "pending") acc.status = "active";
                var firstVerify = !markLogin(acc, t);
        return Promise.resolve(store.putAccount(acc)).then(function (saved) {
          return claimOwnerRole(store, cfg, saved || acc).then(function () { return saved || acc; });
        }).then(function (saved) {
          var cur = saved || acc;

          var out = {
            verified: true,
            email: String(cur.email || ""),
            note: "邮箱已确认，已经帮你登录了。"
          };
          return issueSessionFor(deps, cur, firstVerify).then(function (sess) {
            if (!sess || !sess.cookies) {
              out.note = "邮箱已确认。现在可以用它登录或找回密码了。";
              return ok(out);
            }
            sess.body.verified = true;
            sess.body.email = out.email;
            sess.body.signedIn = true;
            sess.body.note = out.note;
            return sess;
          });
        });
      });
  }

  if (vid) return Promise.resolve(store.getVerification(vid)).then(act);

  return Promise.resolve(err(400, "E_NO_TOKEN", "确认链接不完整，请重新发一封确认邮件"));
}

function loginWithPassword(deps, input) {
  var cfg = deps.cfg;

  return humanGuard(deps, input).then(function (blocked) {
    if (blocked) return blocked;
    return loginWithPasswordAfterGuard(deps, input);
  });
}

function loginWithPasswordAfterGuard(deps, input) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();
  var email = id.normalizeEmailForStore(input.email != null ? input.email : input.value);
  var pw = String(input.password == null ? "" : input.password);
  var device = String(input.deviceId || "unknown");
  var GREY = { code: "E_LOGIN_FAIL", message: "邮箱或密码不对" };

  if (!id.isEmailShape(email) || !pw) return Promise.resolve(err(400, "E_LOGIN_FAIL", GREY.message));

  var loginIp = String(input.ip || "unknown");
  var lgBuckets = [["device", "login:" + device], ["ip", "login:" + loginIp]];
  for (var li = 0; li < lgBuckets.length; li++) {
    var lgate = limiter.take(cfg, lgBuckets[li][0], lgBuckets[li][1], t);
    if (!lgate.ok) {
      var lcode = rateCode(lgBuckets[li][0]);
      return Promise.resolve(err(429, lcode, RATE_MSG[lcode] || "稍后再试", { retryAfter: lgate.retryAfter }));
    }
  }

  return Promise.resolve(store.getAccountByHash(id.emailHash(email, pepperOf(cfg))))
    .then(function (acc) {
      if (!acc) {

        id.verifyPassword(pw, id.hashPassword("not-a-real-password", "0000000000000000", { N: 16384, r: 8, p: 1, len: 32 })
          .replace(/\$[0-9a-f]{32}\$/, "$00000000000000000000000000000000$"));
        return err(401, GREY.code, GREY.message);
      }
      if (acc.status === "deleted") return err(401, GREY.code, GREY.message);
      if (isLocked(acc, t)) return err(423, "E_LOCKED", "为了安全，请稍后再试", { retryAfter: lockRetryAfter(acc, t) });
      repairLegacyLock(acc);

      var okPw = !!acc.password_hash && id.verifyPassword(pw, acc.password_hash);
      if (!okPw) {

        var fails = (limiter.fails ? limiter.fails("login", "uid:" + acc.uid, t) : 0) + 1;
        if (limiter.fail) limiter.fail("login", "uid:" + acc.uid, t);
        if (fails >= 10) {
          if (limiter.clearFails) limiter.clearFails("login", "uid:" + acc.uid);
          return lockAccount(store, acc, t + 3600000).then(function () {
            return err(423, "E_LOCKED", "密码连续输错太多次，1 小时后再试（也可以用「忘记密码」重设）", { retryAfter: 3600 });
          });
        }
        if (!acc.password_hash) {
          return err(401, GREY.code, "这个账号还没有设密码（之前用随机码登录）。请用「快捷登录」，或用「忘记密码」设一个。");
        }
        return err(401, GREY.code, GREY.message, { remaining: Math.max(0, 10 - fails) });
      }

      var gatePw = emailGate(deps, acc);
      if (gatePw) return Promise.resolve(gatePw);

      if (limiter.clearFails) limiter.clearFails("login", "uid:" + acc.uid);
            var firstPw = !markLogin(acc, t);
      return Promise.resolve(store.putAccount(acc)).then(function (saved) {

        return claimOwnerRole(store, cfg, saved || acc).then(function () { return saved || acc; });
      }).then(function (saved) {

        return issueSessionFor(deps, saved || acc, firstPw);
      });
    });
}

function resetRequest(deps, input) {
  var cfg = deps.cfg;

  return humanGuard(deps, input).then(function (blocked) {
    if (blocked) return blocked;
    return resetRequestAfterGuard(deps, input);
  });
}

function resetRequestAfterGuard(deps, input) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();
  var email = id.normalizeEmailForStore(input.email != null ? input.email : input.value);
  var device = String(input.deviceId || "unknown");

  var SAME = {
    requested: true,
    store: store.kind,
    ttlSeconds: Math.round((cfg.resetTtlMs || 3600000) / 1000),
    note: "如果这个邮箱在本站注册过，我们已经把重设链接发了出去。",

    mailConfigured: cfg.mail() !== "console"
  };
  if (!id.isEmailShape(email)) return Promise.resolve(err(400, "E_EMAIL_FORMAT", "这个邮箱看起来不太对，再检查一下"));

  var ip = String(input.ip || "unknown");
  var rBuckets = [
    ["device", "reset:" + device],
    ["ip", "reset:" + ip],
    ["email", "reset:" + id.emailHash(email, pepperOf(cfg))]
  ];
  for (var bi = 0; bi < rBuckets.length; bi++) {
    var bg = limiter.take(cfg, rBuckets[bi][0], rBuckets[bi][1], t);
    if (!bg.ok) {
      var bcode = rateCode(rBuckets[bi][0]);
      return Promise.resolve(err(429, bcode, RATE_MSG[bcode] || "发得太快了，请稍后再试", { retryAfter: bg.retryAfter }));
    }
  }

  return Promise.resolve(store.getAccountByHash(id.emailHash(email, pepperOf(cfg))))
    .then(function (acc) {
      if (!acc || acc.status === "deleted") return null;
      return issueReset(deps, acc, email).then(function (r) {
        if (cfg.allowCodeEcho) SAME.devResetToken = r.token;
        return r;
      });
    })
    .then(function () { return ok(SAME); });
}

function issueReset(deps, acc, email) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var token = id.newToken();
  var rid = id.newResetId();
  var rec = {
    rid: rid,
    uid: acc.uid,

    email: id.normalizeEmailForStore(email),
    token_hash: id.tokenHash(acc.uid, "reset", token, pepperOf(cfg)),
    salt: id.newSalt(),
    issued_at: t,
    expires_at: t + (cfg.resetTtlMs || 3600000),
    consumed_at: null,
    attempts: 0
  };
  return Promise.resolve(store.voidResets(acc.uid, t))
    .then(function () { return store.putReset(rec); })
    .then(function () {

      return mail.reset(cfg, { to: acc.email, rid: rid, token: token, ttlMs: cfg.resetTtlMs });
    })
    .then(function (sent) {
      return {
        rid: rid, token: token,
        sent: !!sent.delivered,
        transport: sent.transport,
        attempts: Number(sent.attempts) || 1,
        reason: sent.reason || null
      };
    })
    .catch(function (e) {
      return {
        rid: rid, token: token, sent: false, transport: "failed",
        attempts: Number(e && e.attempts) || 1,
        reason: (e && e.reason) || "unknown"
      };
    });
}

function resetConfirm(deps, input) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();
  var rid = String(input.rid || "");
  var bad = checkPassword(cfg, input.password);
  if (bad) return Promise.resolve(err(400, bad.code, bad.message));
  if (!rid) return Promise.resolve(err(400, "E_NO_TOKEN", "重设链接不完整，请重新发一封邮件"));

  var device = String(input.deviceId || "unknown");
  var resetIp = String(input.ip || "unknown");

  var rcBuckets = [["device", "resetc:" + device], ["ip", "resetc:" + resetIp]];
  var rcBlocked = null;
  for (var ci = 0; ci < rcBuckets.length; ci++) {
    var cg = limiter.take(cfg, rcBuckets[ci][0], rcBuckets[ci][1], t);
    if (!cg.ok) {
      var ccode = rateCode(rcBuckets[ci][0]);
      rcBlocked = err(429, ccode, RATE_MSG[ccode] || "稍后再试", { retryAfter: cg.retryAfter });
      break;
    }
  }
  if (rcBlocked) return Promise.resolve(rcBlocked);

  return Promise.resolve(store.getReset(rid)).then(function (rec) {
    if (!rec) return err(400, "E_TOKEN_INVALID", "这个重设链接不对，请重新发一封邮件");
    if (rec.consumed_at) return err(400, "E_TOKEN_USED", "这个重设链接已经用过了，请重新发一封邮件");
    if (t < Number(rec.issued_at) - 120000) return err(400, "E_TOKEN_INVALID", "这个重设链接不对，请重新发一封邮件");
    if (Number(rec.expires_at) <= t) return err(400, "E_TOKEN_EXPIRED", "重设链接已过期，请重新发一封邮件");
    if (!input.token) return err(400, "E_TOKEN_INVALID", "这个重设链接不对，请重新发一封邮件");
    var expect = id.tokenHash(rec.uid, "reset", String(input.token), pepperOf(cfg));
    if (!id.timingSafeEqual(expect, rec.token_hash)) {
      var next = Number(rec.attempts || 0) + 1;
      return Promise.resolve(store.patchReset ? store.patchReset(rid, { attempts: next }) : null)
        .then(function () { return err(400, "E_TOKEN_INVALID", "这个重设链接不对，请重新发一封邮件"); });
    }

    return Promise.resolve(store.patchReset(rid, { consumed_at: t }))
      .then(function () { return store.getAccount(rec.uid); })
      .then(function (acc) {
        if (!acc || acc.status === "deleted") return err(400, "E_TOKEN_INVALID", "这个重设链接不对，请重新发一封邮件");
        var salt = id.newPasswordSalt();
        acc.password_hash = id.hashPassword(String(input.password), salt);
        acc.password_salt = salt;

        // The reset link reached the mailbox, which proves ownership and ends any lock.
        if (acc.email_verified_at == null) acc.email_verified_at = t;
        acc.locked_until = null;
        acc.status = "active";
        if (limiter.clearFails) limiter.clearFails("login", "uid:" + acc.uid);
        limiter._hits[WRONG.uid + "|" + acc.uid] = [];

        return Promise.resolve(store.putAccount(acc))
          .then(function () { return store.revokeSessions(acc.uid); })
          .then(function () {
            return ok({
              reset: true,
                            email: String(acc.email || ""),
              sessionsRevoked: true,

              emailVerified: true,
              note: "密码已重设。为了安全，其它设备上的登录已全部退出，请用新密码重新登录。"
            });
          });
      });
  });
}

function resendVerification(deps, input) {
  var cfg = deps.cfg;

  return humanGuard(deps, input).then(function (blocked) {
    if (blocked) return blocked;
    return resendVerificationAfterGuard(deps, input);
  });
}

function resendVerificationAfterGuard(deps, input) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();
  var device = String(input.deviceId || "unknown");
  var ip = String(input.ip || "unknown");

  var email = id.normalizeEmailForStore(input.email != null ? input.email : input.value);
  var anon = !deps.account;
  if (anon && !id.isEmailShape(email)) {

    return Promise.resolve(err(400, "E_EMAIL_FORMAT", "这个邮箱看起来不太对，再检查一下"));
  }

  var SAME = {
    requested: true,
    alreadyVerified: false,
    verifySent: false,
    store: store.kind,
    note: "如果这个邮箱在本站注册过而且还没确认，我们已经把确认邮件发了出去。"
  };

  var buckets = [["email", "resend:" + id.emailHash(email, pepperOf(cfg))],
    ["device", "resend:" + device], ["ip", "resend:" + ip], ["global", "resend-all"]];
  var cool = limiter.cooldown("email", "resend:" + id.emailHash(email, pepperOf(cfg)), cfg.resendCooldownMs || 60000, t);
  if (!cool.ok) {
    return Promise.resolve(err(429, "E_RATE_EMAIL", RATE_MSG.E_RATE_EMAIL, { retryAfter: cool.retryAfter }));
  }
  for (var i = 0; i < buckets.length; i++) {
    var g = limiter.take(cfg, buckets[i][0], buckets[i][1], t);
    if (!g.ok) {
      var code = rateCode(buckets[i][0]);
      return Promise.resolve(err(429, code, RATE_MSG[code] || "发得太快了，请稍后再试", { retryAfter: g.retryAfter }));
    }
  }

  function act(acc) {

    if (!acc || acc.status === "deleted" || acc.email_verified_at != null) {

      if (anon) return ok(Object.assign({}, SAME));
      return ok({
        requested: true,
        alreadyVerified: !!(acc && acc.email_verified_at != null),
        email: String((acc && acc.email) || ""),
        verifySent: false,
        store: store.kind,
        note: SAME.note
      });
    }
    return issueVerification(deps, acc).then(function (v) {
      var body;
      if (anon) {

        body = Object.assign({}, SAME);
      } else {

        body = {
          requested: true,
          alreadyVerified: false,
          email: String(acc.email || ""),
          verifySent: v.sent,
          verifyTransport: v.transport,
          verifyAttempts: v.attempts || 1,
          verifyReason: v.reason || null,
          note: SAME.note
        };
      }

      if (cfg.allowCodeEcho && !anon) body.devVerifyToken = v.token;
      return ok(body);
    });
  }

  if (!anon) {
    return Promise.resolve(store.getAccount(deps.account.uid)).then(function (acc) {
      if (!acc || acc.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
      return act(acc);
    });
  }
  return Promise.resolve(store.getAccountByHash(id.emailHash(email, pepperOf(cfg)))).then(act);
}

function resendVerificationByEmail(deps, input) {
  var anonDeps = Object.assign({}, deps);
  delete anonDeps.account;
  return resendVerification(anonDeps, input || {});
}

function me(deps) {
  var cfg = deps.cfg, store = deps.store, acc0 = deps.account;
  if (!acc0) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));
  return Promise.resolve(store.getAccount(acc0.uid)).then(function (acc) {
    if (!acc || acc.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    return ok(publicAccount(cfg, acc));
  });
}

function nicknameNorm(raw) {
  return String(raw == null ? "" : raw)
    .replace(/[\u0000-\u001f<>]/g, "")
    .trim()
    .slice(0, 12);
}

function nicknameSet(deps, input) {
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "登录之后才能改昵称"));
  var name = nicknameNorm(input && input.nickname);
  return Promise.resolve(deps.store.patchAccount(deps.account.uid, { nickname: name }))
    .then(function () { return deps.store.getAccount(deps.account.uid); })
    .then(function (acc) {
      if (!acc || acc.status === "deleted") return err(401, "E_NO_SESSION", "登录之后才能改昵称");
      acc.nickname = name;
      return ok({ nickname: name, account: publicAccount(deps.cfg, acc) });
    });
}

function familyGet(deps) {
  var store = deps.store;
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));
  return Promise.resolve(store.listProgress(deps.account.uid, "", 0)).then(function (rows) {
    var row = null;
    (rows || []).forEach(function (r) { if (r.poem_id === FAMILY_ROW_ID) row = r; });
    return ok({

      family: row && row.payload ? row.payload : { v: 1, at: "", profiles: [] },
      updatedAt: row ? Number(row.updated_at) : 0,
      serverTime: deps.now()
    });
  });
}

function familyPut(deps, input) {
  var store = deps.store, cfg = deps.cfg, t = deps.now(), input2 = input || {};
  var gate = syncTierGate(deps, input2);
  function inner() {
    var g = deps.limiter.check(cfg, "device", "family:" + String(input2.deviceId || "unknown"), t);
    if (!g.ok) return Promise.resolve(err(429, "E_RATE_DEVICE", "同步太频繁了，请稍后再试", { retryAfter: g.retryAfter }));
    deps.limiter.hit("device", "family:" + String(input2.deviceId || "unknown"), t);
    var clean = sanitizeFamily(input2.family);
    return Promise.resolve(store.putProgress(deps.account.uid, "", [{
      poem_id: FAMILY_ROW_ID,
      payload: clean,
      updated_at: t,
      deleted: 0
    }])).then(function () { return ok({ family: clean, serverTime: t }); });
  }
  if (gate) return Promise.resolve(gate).then(function (bad) { return bad || inner(); });
  return inner();
}

function childId(raw) {
  var c = String(raw == null ? "" : raw).trim();
  if (!c) return "";
  if (c.length > 64) return "";
  if (!/^[A-Za-z0-9_-]+$/.test(c)) return "";
  return c;
}

var FAMILY_ROW_ID = "family:v1";

var DAILY_EXTRA_ROW_ID = "daily_extra:v1";

function refText(v, max) {
  var s = String(v == null ? "" : v);
  return s.length > max ? s.slice(0, max) : s;
}

function sanitizeDailyExtra(p) {
  var out = { v: 1, date: refText(p && p.date, 32), updatedAt: Number((p && p.updatedAt) || 0) };
  out.updatedAt = isFinite(out.updatedAt) && out.updatedAt > 0 ? Math.round(out.updatedAt) : 0;
  out.deleted = (p && p.deleted) ? 1 : 0;

  var list = (p && Array.isArray(p.items)) ? p.items.slice(0, DAILY_EXTRA_MAX) : [];
  out.items = [];
  list.forEach(function (it) {
    if (!it || typeof it !== "object") return;
    var pid = refText(it.id, 80).trim();
    if (!pid) return;
    var snap = (it.snap && typeof it.snap === "object") ? it.snap : {};
    out.items.push({
      id: pid,
      wid: refText(it.wid || pid, 80).trim() || pid,
      entryId: refText(it.entryId || pid, 80).trim() || pid,
      at: Number(it.at) > 0 ? Math.round(Number(it.at)) : 0,
      snap: {
        title: refText(snap.title, 120),
        author: refText(snap.author, 60),
        authorName: refText(snap.authorName, 60),
        dynasty: refText(snap.dynasty, 30),
        source: refText(snap.source, 120),
        selection: refText(snap.selection, 120),
        book: refText(snap.book, 60),
        bookName: refText(snap.bookName, 120),
        page: refText(snap.page, 60),
        gradeGroup: refText(snap.gradeGroup, 60),
        text: refText(snap.text, 20000),
        translation: refText(snap.translation, 20000),
        translationSource: refText(snap.translationSource, 200)
      }
    });
    var last = out.items[out.items.length - 1];
    if (typeof snap.grade === "number" && isFinite(snap.grade)) last.snap.grade = Math.round(snap.grade);
    if (typeof snap.term === "number" && isFinite(snap.term)) last.snap.term = Math.round(snap.term);
  });
  return out;
}

var DAILY_EXTRA_MAX = 20;

var COLLECTIONS_ROW_ID = "collections:v1";

var COLLECTIONS_MAX = 5000;

var COLLECTIONS_ITEMS_MAX = 500;

function sanitizeCollections(p) {
  var out = { v: 1, updatedAt: Number((p && p.updatedAt) || 0) };
  out.updatedAt = isFinite(out.updatedAt) && out.updatedAt > 0 ? Math.round(out.updatedAt) : 0;
  out.deleted = (p && p.deleted) ? 1 : 0;

  var list = (p && Array.isArray(p.collections)) ? p.collections.slice(0, COLLECTIONS_MAX) : [];
  out.collections = [];
  list.forEach(function (c) {
    if (!c || typeof c !== "object") return;
    var id = refText(c.id, 80).trim();
    if (!id) return;
    var items = Array.isArray(c.items) ? c.items : [];
    if (items.length > COLLECTIONS_ITEMS_MAX) return;
    var seen = {};
    var kept = [];
    items.forEach(function (it) {
      var pid = refText((it && typeof it === "object" ? it.id : it), 80).trim();
      if (!pid || seen[pid]) return;
      seen[pid] = true;
      var row = { id: pid };
      var snap = (it && typeof it === "object" && it.snap && typeof it.snap === "object") ? it.snap : null;
      if (snap) {
        row.snap = {
          title: refText(snap.title, 120),
          author: refText(snap.author, 60),
          authorName: refText(snap.authorName, 60),
          dynasty: refText(snap.dynasty, 30),
          source: refText(snap.source, 120),
          selection: refText(snap.selection, 120),
          book: refText(snap.book, 60),
          bookName: refText(snap.bookName, 120),
          page: refText(snap.page, 60),
          text: refText(snap.text, 20000),
          translation: refText(snap.translation, 20000),
          translationSource: refText(snap.translationSource, 200)
        };
      }
      kept.push(row);
    });
    out.collections.push({
      id: id,
      name: refText(c.name, 40),
      createdAt: Number(c.createdAt) > 0 ? Math.round(Number(c.createdAt)) : 0,
      items: kept
    });
  });
  return out;
}

var DEFER_ROW_ID = "defer:v1";

var DEFER_MAX = 400;

// 「以后再背」（Issue #481）：一条只有「作品号 + 点它的那一天」—— 没有正文、
// 没有进度，服务端只做裁剪，不做别的判断。
//
// 两档（「明日再背」`span: 1` 与「月后再背」`span: 30`）都另带 `until`
// （搁到哪一天）与 `span`（搁多少天）—— 两个都是**短字符串 / 小整数**，仍然
// 不含正文、不含进度。老客户端推上来的条目没有这两格，照旧存得下
// （不在这儿补默认值 —— 补了服务端就多知道一件客户端的事，读回来由客户端按
// 明日档补，见 js/recite-defer.js 的 `normalize()`）。
function sanitizeDefer(p) {
  var out = { v: 1, updatedAt: Number((p && p.updatedAt) || 0) };
  out.updatedAt = isFinite(out.updatedAt) && out.updatedAt > 0 ? Math.round(out.updatedAt) : 0;
  out.deleted = (p && p.deleted) ? 1 : 0;

  var list = (p && Array.isArray(p.items)) ? p.items.slice(0, DEFER_MAX) : [];
  out.items = [];
  var seen = {};
  list.forEach(function (it) {
    if (!it || typeof it !== "object") return;
    var wid = refText(it.wid, 80).trim();
    var day = refText(it.day, 32).trim();
    if (!wid || !day) return;
    var key = wid + "\u0000" + day;
    if (seen[key]) return;
    seen[key] = 1;
    var at = Number(it.at);
    var row = { wid: wid, day: day, at: isFinite(at) && at > 0 ? Math.round(at) : 0 };
    var until = refText(it.until, 32).trim();
    if (until) row.until = until;
    var span = Number(it.span);
    if (isFinite(span) && span > 0) row.span = Math.max(1, Math.min(3650, Math.round(span)));
    out.items.push(row);
  });
  return out;
}

var PINYIN_FIX_ROW_ID = "pinyin_fix:v1";

var PINYIN_FIX_MAX = 500;

function sanitizePinyinFix(p) {
  var out = { v: 1, updatedAt: Number((p && p.updatedAt) || 0) };
  out.updatedAt = isFinite(out.updatedAt) && out.updatedAt > 0 ? Math.round(out.updatedAt) : 0;
  out.deleted = (p && p.deleted) ? 1 : 0;

  var list = (p && Array.isArray(p.fixes)) ? p.fixes.slice(0, PINYIN_FIX_MAX) : [];
  out.fixes = [];
  var seen = {};
  list.forEach(function (f) {
    if (!f || typeof f !== "object") return;
    var wid = refText(f.wid, 80).trim();
    var line = refText(f.line, 120).trim();
    var py = refText(f.py, 12).trim();
    if (!wid || !line || !py) return;
    var at = Number(f.at);
    at = isFinite(at) && at >= 0 ? Math.round(at) : 0;
    var key = wid + "\u0000" + line + "\u0000" + at;
    if (seen[key]) return;
    seen[key] = 1;
    out.fixes.push({ wid: wid, line: line, at: at, ch: refText(f.ch, 1).trim(), py: py });
  });
  return out;
}

var READ_ROW_PREFIX = "reads:";

var READ_ROW_MAX = 2000;

function readRowKeyOf(poemId) {
  var s = String(poemId == null ? "" : poemId);
  return s.indexOf(READ_ROW_PREFIX) === 0 && s.slice(READ_ROW_PREFIX.length).length > 0;
}

function sanitizeReads(p) {
  var out = { v: 1, updatedAt: Number((p && p.updatedAt) || 0) };
  out.updatedAt = isFinite(out.updatedAt) && out.updatedAt > 0 ? Math.round(out.updatedAt) : 0;
  out.deleted = (p && p.deleted) ? 1 : 0;

  var src = (p && p.marks && typeof p.marks === "object" && !Array.isArray(p.marks)) ? p.marks : {};
  var keys = Object.keys(src).slice(0, READ_ROW_MAX);
  out.marks = {};
  keys.forEach(function (id) {
    var pid = refText(id, 80).trim();
    if (!pid) return;
    var v = src[id];
    var o = (v && typeof v === "object") ? v : {};
    out.marks[pid] = {
      at: Number(o.at) > 0 ? Math.round(Number(o.at)) : 0,
      times: Number(o.times) > 0 ? Math.min(100000, Math.round(Number(o.times))) : 0
    };
  });
  return out;
}

function exportAllProgress(deps, uid) {
  var store = deps.store;
  function one(child) {
    return Promise.resolve(store.listProgress(uid, child, 0)).then(function (rows) {
      return (rows || []).map(function (r) {
        return { poem_id: r.poem_id, child_id: child, payload: r.payload, updated_at: r.updated_at, deleted: r.deleted };
      });
    });
  }
  if (!store || !store.listProgress) return Promise.resolve([]);

  return one("").then(function (rows) {
    var reg = null;
    (rows || []).forEach(function (r) {
      if (r.poem_id === FAMILY_ROW_ID && r.payload && Array.isArray(r.payload.profiles)) reg = r.payload;
    });
    var ids = reg ? reg.profiles.map(function (p) { return childId(p && p.id); }).filter(Boolean) : [];

    var seen = {};
    ids = ids.filter(function (id) { if (seen[id]) return false; seen[id] = true; return true; });
    return Promise.resolve(ids.reduce(function (chain, id) {
      return chain.then(function (all) {
        return one(id).then(function (more) { return all.concat(more); });
      });
    }, Promise.resolve(rows || [])));
  });
}

function syncTierGate(deps, input) {
  var store = deps.store, cfg = deps.cfg;
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));
  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    var tier = planTier(me);
    if (!gameAllowed(cfg, tier, "sync.multiDevice")) {
      return err(403, "E_TIER", "跨设备云同步要 Pro 起才能用（当前：" + tier + "）。进度在本机一字不少，背诵不受影响。",
        { cap: "sync.multiDevice", tier: tier, minTier: "pro" });
    }
    return null;
  });
}

function syncPull(deps, input) {
  var store = deps.store, cfg = deps.cfg, t = deps.now();
  var gate = syncTierGate(deps, input);
  if (gate) return Promise.resolve(gate).then(function (bad) { return bad || syncPullInner(deps, input); });
  return syncPullInner(deps, input);
}

function syncPullInner(deps, input) {
  var store = deps.store, cfg = deps.cfg, t = deps.now();
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));
  var since = Number(input.since) || 0;
  var child = childId(input.child);
  var g = deps.limiter.check(cfg, "device", "pull:" + String(input.deviceId || "unknown"), t);
  if (!g.ok) return Promise.resolve(err(429, "E_RATE_DEVICE", "同步太频繁了，请稍后再试", { retryAfter: g.retryAfter }));
  deps.limiter.hit("device", "pull:" + String(input.deviceId || "unknown"), t);

  return Promise.resolve(store.listProgress(deps.account.uid, child, since)).then(function (rows) {
    return ok({

      child: child,
      recs: (rows || []).map(function (r) {
        return { id: r.poem_id, payload: r.payload, updatedAt: Number(r.updated_at), deleted: !!r.deleted };
      }),
      serverTime: t
    });
  });
}

function syncPush(deps, input) {
  var gate = syncTierGate(deps, input);
  if (gate) return Promise.resolve(gate).then(function (bad) { return bad || syncPushInner(deps, input); });
  return syncPushInner(deps, input);
}

function syncPushInner(deps, input) {
  var store = deps.store, cfg = deps.cfg, t = deps.now();
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));

  var g = deps.limiter.check(cfg, "device", "push:" + String(input.deviceId || "unknown"), t);
  if (!g.ok) return Promise.resolve(err(429, "E_RATE_DEVICE", "同步太频繁了，请稍后再试", { retryAfter: g.retryAfter }));

  var child = childId(input.child);
  var recs = Array.isArray(input.recs) ? input.recs : [];
  if (recs.length > 2000) return Promise.resolve(err(413, "E_TOO_MANY", "一次推的条数太多了"));

  var clean = [];
  var dropped = 0;
  recs.forEach(function (r) {
    var pid = String((r && r.id) || "").slice(0, 80);
    var ts = Number((r && r.updatedAt) || 0);
    if (!pid || !isFinite(ts) || ts <= 0) { dropped++; return; }
    clean.push({
      poem_id: pid,
      payload: sanitizePayload(r.payload, pid),
      updated_at: Math.round(ts),
      deleted: r.deleted ? 1 : 0
    });
  });
  if (dropped) return Promise.resolve(err(400, "E_BAD_REC", "有 " + dropped + " 条记录缺 id 或时间戳"));

  deps.limiter.hit("device", "push:" + String(input.deviceId || "unknown"), t);

  return Promise.resolve(store.putProgress(deps.account.uid, child, clean)).then(function () {
    return ok({ applied: clean.length, child: child, conflicts: [], serverTime: t });
  });
}

function sanitizePayload(p, poemId) {
  var out = {};
  if (!p || typeof p !== "object") return out;

  if (poemId === "family:v1") return sanitizeFamily(p);
  if (poemId === DAILY_EXTRA_ROW_ID) return sanitizeDailyExtra(p);
  if (poemId === COLLECTIONS_ROW_ID) return sanitizeCollections(p);
  if (poemId === DEFER_ROW_ID) return sanitizeDefer(p);
  if (poemId === PINYIN_FIX_ROW_ID) return sanitizePinyinFix(p);
  if (readRowKeyOf(poemId)) return sanitizeReads(p);

  if (typeof p.level === "number") out.level = Math.max(0, Math.min(99, Math.round(p.level)));
  if (typeof p.nextReviewAt === "number") out.nextReviewAt = Math.max(0, Math.round(p.nextReviewAt));
  if (typeof p.lastReviewAt === "number") out.lastReviewAt = Math.max(0, Math.round(p.lastReviewAt));
  if (typeof p.learned === "boolean") out.learned = p.learned;
  if (typeof p.attempted === "boolean") out.attempted = p.attempted;

  // 「已复习 N 次」「忘过 N 次」是界面上直接给用户看的数（Issue #481）。
  // 原先只认一个 `reps` —— 那是改名前的旧字段，客户端早就写 `reviewCount`
  // 了，于是这两个数（还有算法与各算法的参量）一到云端就被悄悄抹掉，
  // 换台设备就成了空白。这里按客户端**实际会写**的字段收。
  if (typeof p.reviewCount === "number") out.reviewCount = Math.max(0, Math.min(100000, Math.round(p.reviewCount)));
  if (typeof p.lapses === "number") out.lapses = Math.max(0, Math.min(100000, Math.round(p.lapses)));

  if (typeof p.algo === "string" && /^[a-z0-9]{1,16}$/.test(p.algo)) out.algo = p.algo;

  if (typeof p.box === "number") out.box = Math.max(0, Math.min(99, Math.round(p.box)));
  if (typeof p.interval === "number") out.interval = Math.max(0, Math.min(100000, Math.round(p.interval)));
  if (typeof p.ef === "number") out.ef = Math.max(1, Math.min(10, Math.round(p.ef * 100) / 100));
  if (typeof p.stability === "number") out.stability = Math.max(0, Math.min(100000, Math.round(p.stability * 100) / 100));
  if (typeof p.difficulty === "number") out.difficulty = Math.max(0, Math.min(100, Math.round(p.difficulty * 100) / 100));

  // 当天点过哪一天（同日改判靠它判「今天已经算过一次」）。快照 dayBaseRec
  // 是本机的事，不上云 —— 计数跟日期走，不跟快照走。
  if (typeof p.dayBase === "string" && /^\d{4}-\d{1,2}-\d{1,2}$/.test(p.dayBase)) out.dayBase = p.dayBase;

  if (Array.isArray(p.history)) {
    out.history = p.history.slice(-200).map(function (h) {
      if (!h || typeof h !== "object") return null;
      var r = {};
      if (typeof h.at === "number") r.at = Math.round(h.at);
      if (typeof h.level === "number") r.level = Math.round(h.level);
      if (h.result === "good" || h.result === "fuzzy" || h.result === "bad") r.result = h.result;
      return r;
    }).filter(Boolean);
  }
  return out;
}

function sanitizeImgUrl(u) {
  var s = String(u == null ? "" : u).trim();
  if (!s || s.length > 512) return "";
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (s.indexOf("/api/avatar/") === 0 && !/[\s"'<>]/.test(s)) return s;
  return "";
}

function sanitizeFamily(p) {
  var out = { v: 1, at: childId(p && p.at), profiles: [] };
  var list = (p && Array.isArray(p.profiles)) ? p.profiles.slice(0, 200) : [];
  list.forEach(function (q) {
    if (!q || typeof q !== "object") return;
    var id = childId(q.id);
    if (!id) return;
    var name = String(q.nickname == null ? "" : q.nickname).trim().slice(0, 12);
    var av = (q.avatar && typeof q.avatar === "object") ? q.avatar : {};
    out.profiles.push({
      id: id,
      nickname: name,

      avatar: { img: sanitizeImgUrl(av.img) },
      createdAt: Number(q.createdAt) > 0 ? Math.round(Number(q.createdAt)) : 0
    });
  });

  var has = out.profiles.some(function (q) { return q.id === out.at; });
  if (!has) out.at = out.profiles.length ? out.profiles[0].id : "";
  return out;
}

function isAdminRole(role) {
  var r = String(role || "user").toLowerCase();
  return r === "owner" || r === "admin";
}

function adminGate(deps, cfg) {
  if (!cfg.hasSession()) {
    return err(503, "E_NOT_CONFIGURED", "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。");
  }
  if (!deps.account) return err(401, "E_NO_SESSION", "还没有登录");
  return null;
}

function normGrantInput(input) {
  var tier = String((input && input.tier) || "").toLowerCase();
  if (["free", "pro", "max"].indexOf(tier) < 0) {
    return { bad: "E_TIER", message: "层级只认 free / pro / max 三个值" };
  }
  var until = input && input.until != null && input.until !== "" ? Number(input.until) : null;
  if (until !== null && (!isFinite(until) || until <= 0)) {
    return { bad: "E_UNTIL", message: "到期时刻看不懂（要毫秒时间戳，留空即永久）" };
  }

    var uid = String((input && input.uid) || "").trim();
  if (!uid) {
    return { bad: "E_UID", message: "要说清改谁的：填 uid（后台名录那一列，或 /api/admin/accounts 里拿）" };
  }
  return { tier: tier, uid: uid, until: until };
}

function adminTarget(store, who) {
  return Promise.resolve(store.getAccount(who.uid)).then(function (a) {
    if (!a || a.status === "deleted") return { hits: [] };
    return { hits: [a] };
  });
}

function adminGrant(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();

  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);

  var who = normGrantInput(input);
  if (who.bad) return Promise.resolve(err(400, who.bad, who.message));

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    var role = String(me.role || "user").toLowerCase();
    if (!isAdminRole(role)) {
      return err(403, "E_FORBIDDEN", "这一条只对管理员开放（当前角色：" + (role === "user" ? "普通用户" : role) + "）");
    }

    var device = String(input.deviceId || "unknown");
    var g = deps.limiter.check(cfg, "device", "grant:" + device, t);
    if (!g.ok) return err(429, "E_RATE_DEVICE", "操作太频繁了，请稍后再试", { retryAfter: g.retryAfter });
    deps.limiter.hit("device", "grant:" + device, t);

    return adminTarget(store, who).then(function (r) {
      var hits = r.hits;
      var target = hits[0] || null;
      if (!target) {
        return ok({
          matched: 0, changed: false,
          uid: who.uid, tier: who.tier, until: who.until,
          note: "没有 uid 是 " + who.uid + " 的账号（可能已经注销）。后台名录里每一行都带着 uid。"
        });
      }

            var before = planTier(target);
      var same = before === who.tier &&
        (target.plan_until == null ? null : Number(target.plan_until)) === who.until;
      var done = function () {
        return ok({
          matched: hits.length, changed: !same,
          ambiguous: hits.length > 1,
          uid: target.uid,
          email: String(target.email || ""),

          tier: who.tier, until: who.until,
          before: before,
          plan: { tier: who.tier, until: who.until },
          by: me.uid,
          at: t,
          note: "已写进服务端的权威名单：对方下次打开页面（或刷新个人中心）时由服务器判定生效。"
        });
      };
      if (same) return done();
      return Promise.resolve(store.patchAccount(target.uid, { plan: who.tier, plan_until: who.until }))
        .then(done);
    });
  });
}

function adminGrants(deps) {
  var cfg = deps.cfg, store = deps.store;
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);
  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");
    return Promise.resolve(store.listAccounts()).then(function (rows) {
      var grants = (rows || []).filter(function (a) {
        return a && a.status !== "deleted" && planTier(a) !== "free";
      }).map(function (a) {
        return { uid: String(a.uid || ""), email: String(a.email || ""), tier: planTier(a), until: a.plan_until == null ? null : Number(a.plan_until) };
      });
      return ok({ grants: grants, store: store.kind });
    });
  });
}

function adminAccounts(deps) {
  var cfg = deps.cfg, store = deps.store;
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);
  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");
    return Promise.resolve(store.listAccounts()).then(function (rows) {
      var list = (rows || []).filter(function (a) { return a && a.status !== "deleted"; }).map(function (a) {
        return {

          uid: String(a.uid || ""),
          email: String(a.email || ""),
          nickname: a.nickname || "",
          tier: planTier(a),

          until: a.plan_until == null ? null : Number(a.plan_until),
          role: isAdminRole(a.role) ? String(a.role).toLowerCase() : "user",

          status: String(a.status || "active"),
          emailVerified: a.email_verified_at != null,
          hasPassword: !!a.password_hash,
          createdAt: Number(a.created_at) || 0,
          lastLoginAt: Number(a.last_login_at) || 0
        };
      });
      list.sort(function (x, y) { return y.createdAt - x.createdAt; });
      return ok({
        accounts: list,
        total: list.length,
        store: store.kind,
                note: "这里列的是**注册过的账号**（含邮箱明文），每行带 uid 与到期，界面据此改角色与层级。"
      });
    });
  });
}

var ROLE_TARGETS = ["user", "admin"];

function adminSetRole(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);

  var uid = String((input && input.uid) || "").trim();
  var role = String((input && input.role) || "").trim().toLowerCase();
  if (!uid) return Promise.resolve(err(400, "E_UID", "要说清改谁的（uid）"));
  if (ROLE_TARGETS.indexOf(role) < 0) {
    return Promise.resolve(err(400, "E_ROLE", "角色只认 user / admin 两个值（owner 走 OWNER_EMAILS，不在这个口发）"));
  }

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    var myRole = String(me.role || "user").toLowerCase();
    if (myRole !== "owner") {
      return err(403, "E_FORBIDDEN", myRole === "admin"
        ? "改角色这一条只对 owner 开放（admin 能发层级、看名录、处理报告，但不能授权）"
        : "这一条只对管理员开放");
    }
    if (uid === me.uid) {
      return err(400, "E_SELF", "改不了自己的角色 —— 要换主人，把 OWNER_EMAILS 改成那个邮箱再用它登录一次");
    }

    var device = String(input.deviceId || "unknown");
    var g = deps.limiter.check(cfg, "device", "role:" + device, t);
    if (!g.ok) return err(429, "E_RATE_DEVICE", "操作太频繁了，请稍后再试", { retryAfter: g.retryAfter });
    deps.limiter.hit("device", "role:" + device, t);

    return Promise.resolve(store.getAccount(uid)).then(function (target) {
      if (!target || target.status === "deleted") return err(404, "E_NO_ACCOUNT", "没有这个账号（可能是刚刚被注销了）");
      if (String(target.role || "user").toLowerCase() === "owner") {
        return err(400, "E_OWNER_LOCKED", "这一位是 owner（名单里的人），身份不由这个口改");
      }
      var before = String(target.role || "user").toLowerCase();
      var changed = before !== role;
      return Promise.resolve(changed ? store.patchAccount(uid, { role: role }) : null).then(function () {
        return ok({
          uid: uid,
          email: String(target.email || ""),
          role: role,
          before: before,
          changed: changed,
          by: me.uid,
          at: t,
          note: changed
            ? "已写进数据库：对方刷新页面（或重新打开「我的」页）即由服务器判定生效。"
            : "本来就是「" + role + "」，这一轮一个字都没改。"
        });
      });
    });
  });
}

function adminRevoke(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);
    var uid = String((input && input.uid) || "").trim();
  if (!uid) return Promise.resolve(err(400, "E_UID", "要说清收回谁的：填 uid（后台名录里那一列）"));
  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");
    var device = String(input.deviceId || "unknown");
    var g = deps.limiter.check(cfg, "device", "grant:" + device, t);
    if (!g.ok) return err(429, "E_RATE_DEVICE", "操作太频繁了，请稍后再试", { retryAfter: g.retryAfter });
    deps.limiter.hit("device", "grant:" + device, t);
    return Promise.resolve(store.getAccount(uid)).then(function (target) {
      if (!target || target.status === "deleted") {
        return ok({ matched: 0, changed: false, uid: uid, note: "没有 uid 是 " + uid + " 的账号（可能已经注销）。" });
      }
      return Promise.resolve(store.patchAccount(uid, { plan: "free", plan_until: null }))
        .then(function () {
          return ok({ matched: 1, changed: true, uid: uid, email: String(target.email || ""), tier: "free", by: me.uid, at: t });
        });
    });
  });
}

var REPORT_KINDS = ["text", "translation", "pinyin", "audio", "ui", "other"];

var REPORT_STATUSES = ["new", "read", "accepted", "fixed", "rejected"];

var REPORT_LIMITS = {
  quote: 200,
  context: 2000,
  note: 2000,
  suggestion: 2000,
  poemId: 80,
  poemTitle: 120,
  book: 60,
  ua: 240
};

function clip(v, max) {
  var s = String(v == null ? "" : v);
  return s.length > max ? s.slice(0, max) : s;
}

function isReportKind(k) {
  return REPORT_KINDS.indexOf(String(k || "")) >= 0;
}

var REPORT_STATUS_ALIAS = { open: "new", done: "fixed", closed: "rejected" };

function normReportStatus(s) {
  var v = String(s == null ? "" : s).trim().toLowerCase();
  if (REPORT_STATUS_ALIAS[v]) return REPORT_STATUS_ALIAS[v];
  return REPORT_STATUSES.indexOf(v) >= 0 ? v : "";
}

function reportPublic(row) {
  if (!row) return null;
  var r = row;
  return {
    rid: String(r.rid || ""),
    kind: isReportKind(r.kind) ? String(r.kind) : "other",
    status: normReportStatus(r.status) || "new",
    poemId: String(r.poem_id || r.poemId || ""),
    poemTitle: String(r.poem_title || r.poemTitle || ""),
    book: String(r.book || ""),
    quote: String(r.quote || ""),
    context: String(r.context || ""),
    note: String(r.note || ""),
    suggestion: String(r.suggestion || ""),
    createdAt: Number(r.created_at || r.createdAt || 0),
    updatedAt: Number(r.updated_at || r.updatedAt || 0),
    handledAt: Number(r.handled_at || r.handledAt || 0),
    reply: String(r.reply || "")
  };
}

function reportAdmin(row) {
  var pub = reportPublic(row) || {};
  pub.email = String(row.email || "");
  pub.nickname = String(row.nickname || "");
  pub.uid = String(row.uid || "");
  pub.handledBy = String(row.handled_by || "");
  pub.ua = String(row.ua || "");
  return pub;
}

var REPORT_DAILY_MAX = 20;

function normReportInput(deps, input) {
  var kind = String((input && input.kind) || "").toLowerCase();
  if (!isReportKind(kind)) kind = "other";

  var note = clip(input && input.note, REPORT_LIMITS.note).trim();
  var quote = clip(input && input.quote, REPORT_LIMITS.quote).trim();
  var context = clip(input && input.context, REPORT_LIMITS.context).trim();
  var suggestion = clip(input && input.suggestion, REPORT_LIMITS.suggestion).trim();

  if (!note && !quote && !suggestion) {
    return { bad: "E_EMPTY", message: "请写一句「哪里不对」（哪怕两个字：如「长 注音」）" };
  }

  return {
    kind: kind,
    poemId: clip(input && input.poemId, REPORT_LIMITS.poemId).trim(),
    poemTitle: clip(input && input.poemTitle, REPORT_LIMITS.poemTitle).trim(),
    book: clip(input && input.book, REPORT_LIMITS.book).trim(),
    quote: quote,
    context: context,
    note: note || (quote ? "「" + quote + "」这一处不对" : ""),
    suggestion: suggestion,
    device: String((input && input.deviceId) || deps.deviceId || "").slice(0, 64),
    ua: clip(input && input.ua, REPORT_LIMITS.ua).trim()
  };
}

function reportCreate(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();

  if (!cfg.hasSession()) {
    return Promise.resolve(err(503, "E_NOT_CONFIGURED", "服务端还没配置好（缺 SESSION_SECRET）。想提意见可以直接开一个 Issue，那条路不依赖服务端。"));
  }
  if (!deps.account) {
    return Promise.resolve(err(401, "E_NO_SESSION", "报告要登录后才能发（这样才认得出是谁报的、修好之后能回你一句）。没登录也能直接开 Issue。"));
  }

  var who = normReportInput(deps, input);
  if (who.bad) return Promise.resolve(err(400, who.bad, who.message));

  var device = String(input && input.deviceId || deps.deviceId || "unknown");
  var g = deps.limiter.check(cfg, "device", "report:" + device, t);
  if (!g.ok) {
    return Promise.resolve(err(429, "E_RATE_DEVICE", "报得太快了，隔一会儿再发（今天已经报的那些都在）", { retryAfter: g.retryAfter }));
  }

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");

    return Promise.resolve(store.countReportsByUid(deps.account.uid, t)).then(function (n) {
      if (n >= REPORT_DAILY_MAX) {
        return err(429, "E_RATE_REPORT", "今天报得有点多（上限 " + REPORT_DAILY_MAX + " 条）。剩下的明天再报，或者直接开一个 Issue。", { limit: REPORT_DAILY_MAX });
      }

      deps.limiter.hit("device", "report:" + device, t);

      var rid = id.newReportId();
      var row = {
        rid: rid,
        uid: deps.account.uid,

                email: String(me.email || ""),
        nickname: String(me.nickname || ""),
        kind: who.kind,
        status: "new",
        poem_id: who.poemId,
        poem_title: who.poemTitle,
        book: who.book,
        quote: who.quote,
        context: who.context,
        note: who.note,
        suggestion: who.suggestion,
        device: who.device,
        ua: who.ua,
        created_at: t,
        updated_at: t
      };

      return Promise.resolve(store.putReport(row)).then(function () {
        return ok({
          rid: rid,
          status: "new",
          createdAt: t,
          remaining: Math.max(0, REPORT_DAILY_MAX - (n + 1)),
          note: "收到了。这一条进的是管理员那一张台账，修好之后会在「我的报告」里变成「已修复」。"
        });
      });
    });
  });
}

function reportMine(deps, input) {
  var cfg = deps.cfg, store = deps.store;
  if (!cfg.hasSession()) {
    return Promise.resolve(err(503, "E_NOT_CONFIGURED", "服务端还没配置好（缺 SESSION_SECRET）。"));
  }
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));

  var limit = Math.max(1, Math.min(200, Number(input && input.limit) || 50));
  return Promise.resolve(store.listReports({ uid: deps.account.uid }, limit)).then(function (rows) {
    return ok({
      reports: (rows || []).map(reportPublic),
      note: "这里只列你自己报过的。管理端看到的是全站那一张台账。"
    });
  });
}

function adminReports(deps, input) {
  var cfg = deps.cfg, store = deps.store;
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);

  var status = String((input && input.status) || "").trim();
  var wantStatus = status && status !== "all" ? normReportStatus(status) : "";
  if (status && status !== "all" && !wantStatus) {
    return Promise.resolve(err(400, "E_STATUS", "状态只认 " + REPORT_STATUSES.join(" / ") + "（或 all）"));
  }

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");

    var limit = Math.max(1, Math.min(500, Number(input && input.limit) || 200));
    var filter = {};
    if (wantStatus) filter.status = wantStatus;
    if (input && input.poemId) filter.poemId = clip(input.poemId, REPORT_LIMITS.poemId).trim();

    return Promise.resolve(store.listReports(filter, limit)).then(function (rows) {
      return Promise.resolve(store.countReports({})).then(function (counts) {
        return ok({
          reports: (rows || []).map(reportAdmin),
          counts: counts || {},
          total: (rows || []).length,
          kinds: REPORT_KINDS.slice(),
          statuses: REPORT_STATUSES.slice(),
          store: store.kind
        });
      });
    });
  });
}

function adminReportPatch(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);

  var rid = clip(input && input.rid, 64).trim();
  if (!rid) return Promise.resolve(err(400, "E_RID", "缺 rid"));

  var status = normReportStatus(input && input.status);
  if (!status) return Promise.resolve(err(400, "E_STATUS", "状态只认 " + REPORT_STATUSES.join(" / ")));

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");

    var patch = { status: status, updated_at: t };
    // Omitted reply keeps the existing one; a status click must not erase it.
    if (input && typeof input.reply === "string") {
      patch.reply = clip(input.reply, REPORT_LIMITS.suggestion).trim();
    }

    if (status === "accepted" || status === "fixed" || status === "rejected") {
      patch.handled_at = t;
      patch.handled_by = String(me.uid || "");
    } else {
      patch.handled_at = null;
      patch.handled_by = "";
    }

    return Promise.resolve(store.patchReport(rid, patch)).then(function (row) {
      if (!row) return err(404, "E_NO_REPORT", "没有 rid 是 " + rid + " 的那一条（可能是另一台服务器发的？）");
      return ok({
        report: reportAdmin(row),
        note: "这一条只改了服务端那一份。界面上的正文要**真的改源码**才算修好 —— 报告台账不是数据源。"
      });
    });
  });
}

// ---------------------------------------------------------------------------
// 注音勘误 · 全站生效（Issue #348）：提交 → 审核 → 生效，见 schema.sql 第 10 节。
// ---------------------------------------------------------------------------

var PINYIN_PROPOSAL_STATUSES = ["pending", "approved", "rejected", "superseded"];

var PINYIN_PROPOSAL_LIMITS = { wid: 80, line: 120, ch: 1, py: 12, poemTitle: 120, book: 60, note: 500 };

function pinyinProposalPublic(row) {
  if (!row) return null;
  return {
    fid: String(row.fid || ""),
    wid: String(row.wid || ""),
    line: String(row.line || ""),
    at: Number(row.at) || 0,
    ch: String(row.ch || ""),
    py: String(row.py || ""),
    prevPy: String(row.prev_py || ""),
    poemTitle: String(row.poem_title || ""),
    book: String(row.book || ""),
    status: String(row.status || "pending"),
    proposedBy: String(row.proposed_by || ""),
    proposedByName: String(row.proposed_by_name || ""),
    note: String(row.note || ""),
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    reviewedBy: String(row.reviewed_by || ""),
    reviewedAt: Number(row.reviewed_at) || 0
  };
}

function normPinyinProposalInput(input) {
  var wid = clip(input && input.wid, PINYIN_PROPOSAL_LIMITS.wid).trim();
  var line = clip(input && input.line, PINYIN_PROPOSAL_LIMITS.line).trim();
  var py = clip(input && input.py, PINYIN_PROPOSAL_LIMITS.py).trim();
  if (!wid || !line || !py) {
    return { bad: "E_BAD_FIX", message: "篇目 / 原句 / 读音三样缺一样都不收" };
  }
  var at = Number(input && input.at);
  at = isFinite(at) && at >= 1 ? Math.round(at) : 1;
  return {
    wid: wid,
    line: line,
    at: at,
    ch: clip(input && input.ch, PINYIN_PROPOSAL_LIMITS.ch).trim(),
    py: py,
    poemTitle: clip(input && input.poemTitle, PINYIN_PROPOSAL_LIMITS.poemTitle).trim(),
    book: clip(input && input.book, PINYIN_PROPOSAL_LIMITS.book).trim()
  };
}

function pinyinProposalSubmit(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);

  var who = normPinyinProposalInput(input);
  if (who.bad) return Promise.resolve(err(400, who.bad, who.message));

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");

    return Promise.resolve(store.listPinyinProposals({ wid: who.wid, line: who.line, at: who.at }, 10))
      .then(function (rows) {
        var pending = null, approved = null;
        (rows || []).forEach(function (r) {
          if (r.status === "pending") pending = r;
          else if (r.status === "approved") approved = r;
        });
        var prevPy = approved ? String(approved.py || "") : "";
        var name = String(me.nickname || me.email || "");

        if (pending) {
          var patch = {
            ch: who.ch, py: who.py, prev_py: prevPy,
            poem_title: who.poemTitle, book: who.book,
            proposed_by: me.uid, proposed_by_name: name, updated_at: t
          };
          return Promise.resolve(store.patchPinyinProposal(pending.fid, patch)).then(function (row) {
            return ok({ proposal: pinyinProposalPublic(row || Object.assign({}, pending, patch)), replaced: true,
              note: "已更新这一条待审核的提议。" });
          });
        }

        var row = {
          fid: id.newPinyinProposalId(),
          wid: who.wid, line: who.line, at: who.at, ch: who.ch, py: who.py, prev_py: prevPy,
          poem_title: who.poemTitle, book: who.book,
          status: "pending",
          proposed_by: me.uid, proposed_by_name: name, note: "",
          created_at: t, updated_at: t, reviewed_by: "", reviewed_at: null
        };
        return Promise.resolve(store.putPinyinProposal(row)).then(function () {
          return ok({
            proposal: pinyinProposalPublic(row), replaced: false,
            note: "已提交，等待管理员审核批准；批准前全站读者仍看到" +
              (prevPy ? "当前生效的读音（" + prevPy + "）" : "自动注音") + "。"
          });
        });
      });
  });
}

function pinyinProposalList(deps, input) {
  var cfg = deps.cfg, store = deps.store;
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);

  var status = String((input && input.status) || "pending").trim();
  var wantStatus = status && status !== "all" ? status : "";
  if (wantStatus && PINYIN_PROPOSAL_STATUSES.indexOf(wantStatus) < 0) {
    return Promise.resolve(err(400, "E_STATUS", "状态只认 " + PINYIN_PROPOSAL_STATUSES.join(" / ") + "（或 all）"));
  }

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");

    var limit = Math.max(1, Math.min(500, Number(input && input.limit) || 200));
    var filter = wantStatus ? { status: wantStatus } : {};
    return Promise.resolve(store.listPinyinProposals(filter, limit)).then(function (rows) {
      return Promise.resolve(store.countPinyinProposals()).then(function (counts) {
        return ok({ proposals: (rows || []).map(pinyinProposalPublic), counts: counts || {}, store: store.kind });
      });
    });
  });
}

function pinyinProposalReview(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);

  var fid = clip(input && input.fid, 64).trim();
  if (!fid) return Promise.resolve(err(400, "E_FID", "缺 fid"));
  var decision = String((input && input.decision) || "").trim();
  if (["approve", "reject"].indexOf(decision) < 0) {
    return Promise.resolve(err(400, "E_DECISION", "decision 只认 approve / reject"));
  }

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");

    return Promise.resolve(store.getPinyinProposal(fid)).then(function (row) {
      if (!row) return err(404, "E_NO_FIX", "没有 fid 是 " + fid + " 的那一条");

      if (decision === "reject") {
        if (["pending", "approved"].indexOf(row.status) < 0) {
          return err(409, "E_STATE", "这一条现在是「" + row.status + "」，驳回不了");
        }
        var wasLive = row.status === "approved";
        return Promise.resolve(store.patchPinyinProposal(fid, {
          status: "rejected", reviewed_by: me.uid, reviewed_at: t, updated_at: t,
          note: clip(input && input.note, PINYIN_PROPOSAL_LIMITS.note).trim()
        })).then(function (updated) {
          return ok({
            proposal: pinyinProposalPublic(updated || row),
            note: wasLive ? "已下线：这一处恢复为自动注音。" : "已驳回，这一条不会生效。"
          });
        });
      }

      if (row.status !== "pending") {
        return err(409, "E_STATE", "这一条现在是「" + row.status + "」，只有待审核的才能批准");
      }

      return Promise.resolve(store.listPinyinProposals({ wid: row.wid, line: row.line, at: row.at, status: "approved" }, 5))
        .then(function (siblings) {
          var chain = Promise.resolve();
          (siblings || []).forEach(function (s) {
            if (s.fid === fid) return;
            chain = chain.then(function () {
              return store.patchPinyinProposal(s.fid, { status: "superseded", updated_at: t });
            });
          });
          return chain.then(function () {
            return Promise.resolve(store.patchPinyinProposal(fid, {
              status: "approved", reviewed_by: me.uid, reviewed_at: t, updated_at: t
            })).then(function (updated) {
              return ok({
                proposal: pinyinProposalPublic(updated || row),
                note: "已批准，全站读者下次打开此篇即可看到（缓存数小时后自动刷新）。"
              });
            });
          });
        });
    });
  });
}

function pinyinFixesPublic(deps) {
  var store = deps.store;
  return Promise.resolve(store.listPinyinProposals({ status: "approved" }, 5000)).then(function (rows) {
    var list = rows || [];
    var version = 0;
    var fixes = list.map(function (r) {
      version = Math.max(version, Number(r.updated_at) || 0);
      return { wid: String(r.wid || ""), line: String(r.line || ""), at: Number(r.at) || 0, ch: String(r.ch || ""), py: String(r.py || "") };
    });
    return ok({ fixes: fixes, version: version, count: fixes.length });
  });
}

// ---------------------------------------------------------------------------
// 意见反馈（Issue #372）：不针对任何一篇的产品建议，且是一段可以
// 来回跟帖的对话（用户追问、管理员回复），登录与未登录都能发。
// ---------------------------------------------------------------------------

var FEEDBACK_KINDS = ["feature", "problem", "other"];
var FEEDBACK_STATUSES = ["open", "replied", "closed"];
var FEEDBACK_LIMITS = { content: 2000, comment: 2000 };
var DEVICE_ID_SHAPE = /^d_[0-9a-f]{8}$/;

function isFeedbackKind(k) { return FEEDBACK_KINDS.indexOf(String(k || "")) >= 0; }

// 与限流用的是同一份设备号（js/auth-core.js 的 `d_` + 8 位十六进制）。
// 不认这个形状就当作「没有可用身份」——不能让所有存不住数据的访客共用
// http.js 里那个「unknown」占位值，那样彼此就看得到对方发的内容了。
function feedbackIdentity(deps, input) {
  if (deps.account && deps.account.uid) return { uid: deps.account.uid, deviceId: "" };
  var raw = String((input && input.deviceId) || deps.deviceId || "");
  if (!DEVICE_ID_SHAPE.test(raw)) return null;
  return { uid: "", deviceId: raw };
}

function feedbackThreadFilterOf(identity) {
  return identity.uid ? { uid: identity.uid } : { deviceId: identity.deviceId };
}

function ownsFeedbackThread(identity, row) {
  if (!row) return false;
  if (identity.uid) return String(row.uid || "") === identity.uid;
  return !!identity.deviceId && !row.uid && String(row.device_id || "") === identity.deviceId;
}

function ownsFeedbackComment(identity, row) {
  if (!row || row.author_role !== "user") return false;
  if (identity.uid) return String(row.uid || "") === identity.uid;
  return !!identity.deviceId && !row.uid && String(row.device_id || "") === identity.deviceId;
}

function feedbackThreadPublic(row, comments) {
  if (!row) return null;
  return {
    tid: String(row.tid || ""),
    kind: isFeedbackKind(row.kind) ? String(row.kind) : "other",
    status: FEEDBACK_STATUSES.indexOf(row.status) >= 0 ? row.status : "open",
    content: String(row.content || ""),
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    mine: true,
    comments: (comments || []).map(feedbackCommentPublic)
  };
}

function feedbackCommentPublic(row) {
  if (!row) return null;
  return {
    cid: String(row.cid || ""),
    tid: String(row.tid || ""),
    role: row.author_role === "admin" ? "admin" : "user",
    content: String(row.content || ""),
    createdAt: Number(row.created_at) || 0
  };
}

function feedbackThreadAdmin(row, comments) {
  var pub = feedbackThreadPublic(row, comments) || {};
  delete pub.mine;
  pub.email = String(row.email || "");
  pub.nickname = String(row.nickname || "");
  pub.uid = String(row.uid || "");
  pub.deviceId = String(row.device_id || "");
  pub.comments = (comments || []).map(feedbackCommentAdmin);
  return pub;
}

function feedbackCommentAdmin(row) {
  var pub = feedbackCommentPublic(row) || {};
  pub.nickname = String(row.nickname || "");
  pub.uid = String(row.uid || "");
  return pub;
}

function feedbackRateGate(deps, key) {
  var cfg = deps.cfg, t = deps.now();
  var g = deps.limiter.check(cfg, "device", key, t);
  if (!g.ok) return err(429, "E_RATE_DEVICE", "发得有点快，稍后再试", { retryAfter: g.retryAfter });
  deps.limiter.hit("device", key, t);
  return null;
}

function feedbackCreate(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  if (!cfg.hasSession()) {
    return Promise.resolve(err(503, "E_NOT_CONFIGURED", "服务端还没配置好（缺 SESSION_SECRET）。想提意见可以直接开一个 Issue，那条路不依赖服务端。"));
  }

  var identity = feedbackIdentity(deps, input);
  if (!identity) {
    return Promise.resolve(err(400, "E_NO_IDENTITY",
      "浏览器没能存下一个设备标识（可能是隐私模式，或清了本机数据），这一条发出去也找不回来了。登录后再发，或者直接开一个 Issue。"));
  }

  var kind = isFeedbackKind(input && input.kind) ? input.kind : "other";
  var content = clip(input && input.content, FEEDBACK_LIMITS.content).trim();
  if (!content) return Promise.resolve(err(400, "E_EMPTY", "写一句想法再发（哪怕一句话）"));

  var rateKey = "feedback:" + (identity.uid || identity.deviceId);
  var gate = feedbackRateGate(deps, rateKey);
  if (gate) return Promise.resolve(gate);

  return Promise.resolve(identity.uid ? store.getAccount(identity.uid) : null).then(function (me) {
    if (identity.uid && (!me || me.status === "deleted")) return err(401, "E_NO_SESSION", "还没有登录");

    var row = {
      tid: id.newFeedbackId(),
      uid: identity.uid || null,
      device_id: identity.deviceId || "",
      email: String((me && me.email) || ""),
      nickname: String((me && me.nickname) || ""),
      kind: kind,
      content: content,
      status: "open",
      created_at: t,
      updated_at: t
    };
    return Promise.resolve(store.putFeedbackThread(row)).then(function () {
      return ok({
        thread: feedbackThreadPublic(row, []),
        note: "已发送，管理员看到会在这里回复。"
      });
    });
  });
}

function feedbackMine(deps, input) {
  var cfg = deps.cfg, store = deps.store;
  if (!cfg.hasSession()) {
    return Promise.resolve(err(503, "E_NOT_CONFIGURED", "服务端还没配置好（缺 SESSION_SECRET）。"));
  }
  var identity = feedbackIdentity(deps, input);
  if (!identity) return Promise.resolve(ok({ threads: [], noIdentity: true }));

  var limit = Math.max(1, Math.min(200, Number(input && input.limit) || 100));
  return Promise.resolve(store.listFeedbackThreads(feedbackThreadFilterOf(identity), limit)).then(function (rows) {
    var list = rows || [];
    var tids = list.map(function (r) { return r.tid; });
    if (!tids.length) return ok({ threads: [] });
    return Promise.resolve(store.listFeedbackComments({ tids: tids }, 5000)).then(function (comments) {
      var byTid = {};
      (comments || []).forEach(function (c) { (byTid[c.tid] || (byTid[c.tid] = [])).push(c); });
      return ok({ threads: list.map(function (r) { return feedbackThreadPublic(r, byTid[r.tid]); }) });
    });
  });
}

function feedbackComment(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  if (!cfg.hasSession()) {
    return Promise.resolve(err(503, "E_NOT_CONFIGURED", "服务端还没配置好（缺 SESSION_SECRET）。"));
  }
  var identity = feedbackIdentity(deps, input);
  if (!identity) return Promise.resolve(err(400, "E_NO_IDENTITY", "浏览器没能存下设备标识，这一条发不出去。登录后再试。"));

  var tid = clip(input && input.tid, 64).trim();
  if (!tid) return Promise.resolve(err(400, "E_TID", "缺 tid"));
  var content = clip(input && input.content, FEEDBACK_LIMITS.comment).trim();
  if (!content) return Promise.resolve(err(400, "E_EMPTY", "写一句再发"));

  var rateKey = "feedback-comment:" + (identity.uid || identity.deviceId);
  var gate = feedbackRateGate(deps, rateKey);
  if (gate) return Promise.resolve(gate);

  return Promise.resolve(store.getFeedbackThread(tid)).then(function (thread) {
    if (!ownsFeedbackThread(identity, thread)) return err(404, "E_NO_THREAD", "没有这一条（可能已经删了）");

    var row = {
      cid: id.newFeedbackCommentId(),
      tid: tid,
      uid: identity.uid || null,
      device_id: identity.deviceId || "",
      author_role: "user",
      nickname: String(thread.nickname || ""),
      content: content,
      created_at: t
    };
    var patch = { updated_at: t };
    // A user following up after a reply means "please look again" — reopen it.
    if (thread.status !== "open") patch.status = "open";

    return Promise.resolve(store.putFeedbackComment(row)).then(function () {
      return Promise.resolve(store.patchFeedbackThread(tid, patch)).then(function () {
        return ok({ comment: feedbackCommentPublic(row) });
      });
    });
  });
}

function feedbackDelete(deps, input) {
  var store = deps.store, cfg = deps.cfg;
  if (!cfg.hasSession()) {
    return Promise.resolve(err(503, "E_NOT_CONFIGURED", "服务端还没配置好（缺 SESSION_SECRET）。"));
  }
  var identity = feedbackIdentity(deps, input);
  if (!identity) return Promise.resolve(err(400, "E_NO_IDENTITY", "浏览器没能存下设备标识，认不出这是你发的。"));

  var tid = clip(input && input.tid, 64).trim();
  var cid = clip(input && input.cid, 64).trim();

  if (tid) {
    return Promise.resolve(store.getFeedbackThread(tid)).then(function (thread) {
      if (!ownsFeedbackThread(identity, thread)) return err(404, "E_NO_THREAD", "没有这一条（可能已经删了）");
      return Promise.resolve(store.deleteFeedbackThread(tid)).then(function () {
        return ok({ deleted: "thread", tid: tid });
      });
    });
  }
  if (cid) {
    return Promise.resolve(store.getFeedbackComment(cid)).then(function (comment) {
      if (!ownsFeedbackComment(identity, comment)) return err(404, "E_NO_COMMENT", "没有这一条（可能已经删了，或者是管理员回的，删不掉）");
      return Promise.resolve(store.deleteFeedbackComment(cid)).then(function () {
        return ok({ deleted: "comment", cid: cid });
      });
    });
  }
  return Promise.resolve(err(400, "E_BAD_TARGET", "要删哪一条没说清楚"));
}

function adminFeedbackList(deps, input) {
  var cfg = deps.cfg, store = deps.store;
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);

  var status = String((input && input.status) || "").trim();
  if (status && status !== "all" && FEEDBACK_STATUSES.indexOf(status) < 0) {
    return Promise.resolve(err(400, "E_STATUS", "状态只认 " + FEEDBACK_STATUSES.join(" / ") + "（或 all）"));
  }

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");

    var limit = Math.max(1, Math.min(300, Number(input && input.limit) || 200));
    var filter = status && status !== "all" ? { status: status } : {};
    return Promise.resolve(store.listFeedbackThreads(filter, limit)).then(function (rows) {
      var list = rows || [];
      var tids = list.map(function (r) { return r.tid; });
      return Promise.resolve(tids.length ? store.listFeedbackComments({ tids: tids }, 10000) : []).then(function (comments) {
        return Promise.resolve(store.countFeedbackThreads({})).then(function (counts) {
          var byTid = {};
          (comments || []).forEach(function (c) { (byTid[c.tid] || (byTid[c.tid] = [])).push(c); });
          return ok({
            threads: list.map(function (r) { return feedbackThreadAdmin(r, byTid[r.tid]); }),
            counts: counts || {},
            store: store.kind
          });
        });
      });
    });
  });
}

function adminFeedbackReply(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);

  var tid = clip(input && input.tid, 64).trim();
  if (!tid) return Promise.resolve(err(400, "E_TID", "缺 tid"));
  var content = clip(input && input.content, FEEDBACK_LIMITS.comment).trim();
  if (!content) return Promise.resolve(err(400, "E_EMPTY", "写点什么再回复"));

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");

    return Promise.resolve(store.getFeedbackThread(tid)).then(function (thread) {
      if (!thread) return err(404, "E_NO_THREAD", "没有 tid 是 " + tid + " 的那一条");

      var row = {
        cid: id.newFeedbackCommentId(),
        tid: tid, uid: me.uid, device_id: "", author_role: "admin",
        nickname: String(me.nickname || me.email || ""),
        content: content, created_at: t
      };
      var status = FEEDBACK_STATUSES.indexOf(input && input.status) >= 0 ? input.status : "replied";
      return Promise.resolve(store.putFeedbackComment(row)).then(function () {
        return Promise.resolve(store.patchFeedbackThread(tid, { status: status, updated_at: t })).then(function () {
          return ok({ comment: feedbackCommentAdmin(row), status: status });
        });
      });
    });
  });
}

function adminFeedbackStatus(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);

  var tid = clip(input && input.tid, 64).trim();
  if (!tid) return Promise.resolve(err(400, "E_TID", "缺 tid"));
  var status = String(input && input.status || "");
  if (FEEDBACK_STATUSES.indexOf(status) < 0) {
    return Promise.resolve(err(400, "E_STATUS", "状态只认 " + FEEDBACK_STATUSES.join(" / ")));
  }

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");
    return Promise.resolve(store.patchFeedbackThread(tid, { status: status, updated_at: t })).then(function (row) {
      if (!row) return err(404, "E_NO_THREAD", "没有 tid 是 " + tid + " 的那一条");
      return ok({ tid: tid, status: status });
    });
  });
}

function adminFeedbackDeleteThread(deps, input) {
  var cfg = deps.cfg, store = deps.store;
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);
  var tid = clip(input && input.tid, 64).trim();
  if (!tid) return Promise.resolve(err(400, "E_TID", "缺 tid"));

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");
    return Promise.resolve(store.deleteFeedbackThread(tid)).then(function (done) {
      if (!done) return err(404, "E_NO_THREAD", "没有 tid 是 " + tid + " 的那一条");
      return ok({ deleted: "thread", tid: tid });
    });
  });
}

function adminFeedbackDeleteComment(deps, input) {
  var cfg = deps.cfg, store = deps.store;
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);
  var cid = clip(input && input.cid, 64).trim();
  if (!cid) return Promise.resolve(err(400, "E_CID", "缺 cid"));

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");
    return Promise.resolve(store.deleteFeedbackComment(cid)).then(function (done) {
      if (!done) return err(404, "E_NO_COMMENT", "没有 cid 是 " + cid + " 的那一条");
      return ok({ deleted: "comment", cid: cid });
    });
  });
}

var GAME_CAP = { fly: "feihualing", paper: "exam.paper", review: "quiz.review" };

function gameAllowed(cfg, tier, cap) {
  return featuresFor(cfg, tier).indexOf(cap) >= 0;
}

var EXAM_RECORD_LIMITS = { scopeId: 64, scopeLabel: 40, stem: 120, answer: 60, items: 60 };

function examRecordItemClip(it) {
  return {
    stem: clip(it && it.stem, EXAM_RECORD_LIMITS.stem),
    picked: clip(it && it.picked, EXAM_RECORD_LIMITS.answer),
    answer: clip(it && it.answer, EXAM_RECORD_LIMITS.answer),
    correct: !!(it && it.correct)
  };
}

function examRecordPublic(row) {
  if (!row) return null;
  return {
    eid: row.eid,
    scopeId: String(row.scope_id || ""),
    scopeLabel: String(row.scope_label || ""),
    size: Number(row.size || 0),
    score: Number(row.score || 0),
    total: Number(row.total || 0),
    durationSec: Number(row.duration_sec || 0),
    items: Array.isArray(row.items) ? row.items : [],
    createdAt: Number(row.created_at || 0)
  };
}

// 只记「考试」（exam.formal）这一种形态，模拟考试 / 题库不上云（§4.66）。
function examRecordCreate(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  if (!cfg.hasSession()) {
    return Promise.resolve(err(503, "E_NOT_CONFIGURED", "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。"));
  }
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "这一项要登录后才能用"));

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    var tier = planTier(me);
    if (!gameAllowed(cfg, tier, "exam.formal")) {
      return err(403, "E_TIER", "考试历史要 Max 才能用（当前：" + tier + "）", { cap: "exam.formal", tier: tier });
    }

    var total = Math.max(0, Math.min(999, Number(input && input.total) || 0));
    if (!total) return err(400, "E_EMPTY", "这一卷没有题目，不存");
    var score = Math.max(0, Math.min(total, Number(input && input.score) || 0));
    var size = Math.max(0, Math.min(999, Number(input && input.size) || total));
    var durationSec = Math.max(0, Math.min(24 * 3600, Number(input && input.durationSec) || 0));
    var items = (Array.isArray(input && input.items) ? input.items : [])
      .slice(0, EXAM_RECORD_LIMITS.items).map(examRecordItemClip);

    var row = {
      eid: id.newExamRecordId(),
      uid: deps.account.uid,
      scope_id: clip(input && input.scopeId, EXAM_RECORD_LIMITS.scopeId),
      scope_label: clip(input && input.scopeLabel, EXAM_RECORD_LIMITS.scopeLabel),
      size: size, score: score, total: total,
      duration_sec: durationSec,
      items: items,
      created_at: t
    };
    return Promise.resolve(store.putExamRecord(row)).then(function () {
      return ok({ record: examRecordPublic(row) });
    });
  });
}

function examRecordsMine(deps, input) {
  var cfg = deps.cfg, store = deps.store;
  if (!cfg.hasSession()) {
    return Promise.resolve(err(503, "E_NOT_CONFIGURED", "服务端还没配置好（缺 SESSION_SECRET）。"));
  }
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "这一项要登录后才能用"));

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    var limit = Math.max(1, Math.min(200, Number(input && input.limit) || 50));
    return Promise.resolve(store.listExamRecords({ uid: deps.account.uid }, limit)).then(function (rows) {
      return ok({ records: (rows || []).map(examRecordPublic) });
    });
  });
}

function examRecordDelete(deps, input) {
  var cfg = deps.cfg, store = deps.store;
  if (!cfg.hasSession()) {
    return Promise.resolve(err(503, "E_NOT_CONFIGURED", "服务端还没配置好（缺 SESSION_SECRET）。"));
  }
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "这一项要登录后才能用"));

  var eid = clip(input && input.eid, 64).trim();
  if (!eid) return Promise.resolve(err(400, "E_BAD_TARGET", "没说清楚删哪一条"));

  return Promise.resolve(store.getExamRecord(eid)).then(function (row) {
    if (!row || row.uid !== deps.account.uid) return err(404, "E_NOT_FOUND", "没有这一条（可能已经删了）");
    return Promise.resolve(store.deleteExamRecord(eid)).then(function () {
      return ok({ deleted: eid });
    });
  });
}

function gameAnswer(deps, input, extra) {
  var cfg = deps.cfg, t = deps.now();
  var game = (extra && extra.game) || require("./game");

  var kind = String((input && input.kind) || "review").toLowerCase();
  var cap = GAME_CAP[kind];
  if (!cap) return Promise.resolve(err(400, "E_KIND", "不认识的题型（只认 fly / paper / review）"));
  if (!deps.account) {
    return Promise.resolve(err(401, "E_NO_SESSION", "这一项要登录后才能用"));
  }

  return Promise.resolve(deps.store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    var tier = planTier(me);
    if (!gameAllowed(cfg, tier, cap)) {
      return err(403, "E_TIER", "这一项要 " + (cap === "quiz.review" ? "Pro" : "Max") + " 才能用（当前：" + tier + "）", { cap: cap, tier: tier });
    }

    var device = String(deps.deviceId || input.deviceId || "unknown");
    var g = deps.limiter.check(cfg, "device", "game:" + device, t);
    if (!g.ok) return err(429, "E_RATE_DEVICE", "答题太频繁了，请稍后再试", { retryAfter: g.retryAfter });
    deps.limiter.hit("device", "game:" + device, t);

    if (kind === "fly") {
      var fly = game.checkFly(input);
      if (fly.bad) return err(400, fly.bad, fly.message);
      return ok({

        kind: "fly", ok: fly.found, found: fly.found,
        why: fly.found ? "ok" : "notfound",
        chars: fly.chars, said: fly.said, poemId: fly.poemId, title: fly.title,
        inScope: fly.inScope, scopeId: fly.scopeId, scopeExact: fly.scopeExact,
        total: fly.total, tier: tier,
        counted: false,
        note: "这一句" + (fly.found ? "在合集里对上了" : "没在合集里找到") +
          "；对上的共 " + fly.total + " 句。" +
          "范围只管令字，作答按全站合集判。" +
          "判分是逐字比对，不涉及 AI。"
      });
    }

    var q = game.rebuild(input);
    if (!q) return err(400, "E_STALE", "题库里没有这一条（前端缓存可能旧了一版，刷新之后重来）");

    var r = game.quiz().grade(q, input.chosen);

    var charge = input.charge === true;

    function reply(counted) {
      return ok({
        kind: kind, ok: r.ok, why: r.why,
        bankId: q.id, poemId: q.poemId, answer: q.answer,
        tier: tier, cap: cap,
        counted: !!counted,
        note: charge
          ? (counted ? "这一次已计入额度。" : "这次没记上（存储不可用），如实告诉您。")
          : "这一项**免费、不限次**，不计额度（本站不收款，也没有计费）。"
      });
    }

    if (!charge) return reply(false);
    return Promise.resolve(gameCharge(deps, me.uid, cap, t)).then(reply);
  });
}

function gameCharge(deps, uid, cap, t) {
  var store = deps.store;
  if (!store || !store.listProgress || !store.putProgress) return false;
  var month = new Date(t).toISOString().slice(0, 7);
  var rowId = "game-quota:" + cap;
  var used = 0;

  return Promise.resolve(store.listProgress(uid, "", 0)).then(function (rows) {
    (rows || []).forEach(function (r) {
      if (r && r.poem_id === rowId && r.payload && r.payload.month === month) {
        used = Number(r.payload.used) || 0;
      }
    });
    store.putProgress(uid, "", [{
      poem_id: rowId,
      payload: { v: 1, cap: cap, month: month, used: used + 1 },
      updated_at: t,
      deleted: false
    }]);
    return true;
  })["catch"](function () { return false; });
}

function accountDelete(deps, input) {
  var store = deps.store, cfg = deps.cfg, t = deps.now();
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));
  if (input.confirm !== true) {
    return Promise.resolve(err(400, "E_CONFIRM", "请先确认要注销这个账号"));
  }
  var uid = deps.account.uid;
  var g = deps.limiter.check(cfg, "device", "del:" + String(input.deviceId || "unknown"), t);
  if (!g.ok) return Promise.resolve(err(429, "E_RATE_DEVICE", "操作太频繁了，请稍后再试", { retryAfter: g.retryAfter }));
  deps.limiter.hit("device", "del:" + String(input.deviceId || "unknown"), t);

  return Promise.resolve(store.getAccount(uid)).then(function (acc) {
    if (!acc || acc.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    var want = id.normalizeEmail(acc.email);
    if (want && id.normalizeEmail(input.email) !== want) {
      return err(400, "E_CONFIRM_EMAIL", "请输入这个账号注册时用的完整邮箱以确认注销");
    }
    return deleteAccountData(deps, uid, t);
  });
}

function deleteAccountData(deps, uid, t) {
  var store = deps.store, cfg = deps.cfg;
  return Promise.resolve(exportAllProgress(deps, uid)).then(function (rows) {

    var dump = {
      v: 1,
      exportedAt: t,
      uid: uid,
      recs: (rows || []).map(function (r) {
        return { id: r.poem_id, child: r.child_id || "", payload: r.payload, updatedAt: Number(r.updated_at), deleted: !!r.deleted };
      })
    };
    return Promise.resolve(store.deleteProgress(uid))
      .then(function () { return store.revokeSessions(uid); })
      .then(function () {
        // The avatar sits in a public bucket; leaving it would outlive the account.
        try {
          var av = require("./avatar-store").getAvatarStore(cfg);
          return Promise.resolve(av && av.remove ? av.remove(uid) : null)["catch"](function () { return null; });
        } catch (e) { return null; }
      })
      .then(function () { return store.deleteAccount(uid); })
      .then(function () {
        return {
          status: 200,
          body: {
            deleted: true,

            export: dump,
            note: "账号与云端进度已删除；本机进度不受影响（本站的本机副本始终是完整的一份）。"
          },
          cookies: [session.clearCookieHeader(cfg)]
        };
      });
  });
}

module.exports = {
  ok: ok,

  issueSessionFor: issueSessionFor,

  __mail: mail,
  err: err,
  sendCode: sendCode,
  verifyCode: verifyCode_,
  me: me,
  syncPull: syncPull,
  syncPush: syncPush,
  familyGet: familyGet,
  familyPut: familyPut,
  childId: childId,
  sanitizeFamily: sanitizeFamily,
  sanitizeImgUrl: sanitizeImgUrl,
  FAMILY_ROW_ID: FAMILY_ROW_ID,
  DAILY_EXTRA_ROW_ID: DAILY_EXTRA_ROW_ID,
  DAILY_EXTRA_MAX: DAILY_EXTRA_MAX,
  sanitizeDailyExtra: sanitizeDailyExtra,
  COLLECTIONS_ROW_ID: COLLECTIONS_ROW_ID,
  COLLECTIONS_MAX: COLLECTIONS_MAX,
  COLLECTIONS_ITEMS_MAX: COLLECTIONS_ITEMS_MAX,
  sanitizeCollections: sanitizeCollections,
  DEFER_ROW_ID: DEFER_ROW_ID,
  DEFER_MAX: DEFER_MAX,
  sanitizeDefer: sanitizeDefer,
  READ_ROW_PREFIX: READ_ROW_PREFIX,
  READ_ROW_MAX: READ_ROW_MAX,
  readRowKeyOf: readRowKeyOf,
  sanitizeReads: sanitizeReads,
  avatarUrlOf: avatarUrlOf,
  accountDelete: accountDelete,

  register: register,
  loginWithPassword: loginWithPassword,
  verifyEmail: verifyEmail,
  resendVerificationByEmail: resendVerificationByEmail,
  resendVerification: resendVerification,
  resetRequest: resetRequest,
  resetConfirm: resetConfirm,
  nicknameSet: nicknameSet,
  nicknameNorm: nicknameNorm,
  checkPassword: checkPassword,
  isTokenShape: isTokenShape,
  issueVerification: issueVerification,
  issueReset: issueReset,
  findAccountByEmail: findAccountByEmail,
  gameAnswer: gameAnswer,
  gameAllowed: gameAllowed,
  GAME_CAP: GAME_CAP,
  adminGrant: adminGrant,
  adminGrants: adminGrants,
  adminAccounts: adminAccounts,
  adminSetRole: adminSetRole,
  adminRevoke: adminRevoke,
  isAdminRole: isAdminRole,

  reportCreate: reportCreate,
  reportMine: reportMine,
  adminReports: adminReports,
  adminReportPatch: adminReportPatch,
  REPORT_KINDS: REPORT_KINDS,
  REPORT_STATUSES: REPORT_STATUSES,
  REPORT_LIMITS: REPORT_LIMITS,
  REPORT_DAILY_MAX: REPORT_DAILY_MAX,
  normReportStatus: normReportStatus,
  normReportInput: normReportInput,
  reportPublic: reportPublic,
  reportAdmin: reportAdmin,

  pinyinProposalSubmit: pinyinProposalSubmit,
  pinyinProposalList: pinyinProposalList,
  pinyinProposalReview: pinyinProposalReview,
  pinyinFixesPublic: pinyinFixesPublic,
  pinyinProposalPublic: pinyinProposalPublic,
  PINYIN_PROPOSAL_STATUSES: PINYIN_PROPOSAL_STATUSES,
  PINYIN_PROPOSAL_LIMITS: PINYIN_PROPOSAL_LIMITS,

  feedbackCreate: feedbackCreate,
  feedbackMine: feedbackMine,
  feedbackComment: feedbackComment,
  feedbackDelete: feedbackDelete,
  adminFeedbackList: adminFeedbackList,
  adminFeedbackReply: adminFeedbackReply,
  adminFeedbackStatus: adminFeedbackStatus,
  adminFeedbackDeleteThread: adminFeedbackDeleteThread,
  adminFeedbackDeleteComment: adminFeedbackDeleteComment,
  FEEDBACK_KINDS: FEEDBACK_KINDS,
  FEEDBACK_STATUSES: FEEDBACK_STATUSES,
  FEEDBACK_LIMITS: FEEDBACK_LIMITS,

  examRecordCreate: examRecordCreate,
  examRecordsMine: examRecordsMine,
  examRecordDelete: examRecordDelete,
  EXAM_RECORD_LIMITS: EXAM_RECORD_LIMITS,

  normGrantInput: normGrantInput,
  publicAccount: publicAccount,
  channelFacts: channelFacts,
  featuresFor: featuresFor,
  planTier: planTier,
  normalizeGrants: normalizeGrants,
  sanitizePayload: sanitizePayload,
  makeRateLimiter: makeRateLimiter,

  humanGuard: humanGuard,
  turnstileReady: turnstileReady,
  rateCode: rateCode,
  RATE_MSG: RATE_MSG,
  uniqueId: uniqueId,
  dayKey: dayKey
};
