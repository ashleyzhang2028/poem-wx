"use strict";

var CONFIG = require("./config");
var storeMod = require("./store");
var session = require("./session");
var core = require("./core");
var game = require("./game");
var H = require("./http");
var upstream = require("./upstream");

var limiter = core.makeRateLimiter();

function deps(req, body) {
  return {
    cfg: CONFIG,
    store: storeMod.getStore(CONFIG),
    limiter: limiter,
    now: function () { return Date.now(); },
    account: null,
    ip: H.clientIp(req),
    deviceId: H.deviceId(req, body)
  };
}

/**
 * 这一条请求手里的令牌从哪儿来。**两处都认，Cookie 优先。**
 *
 * 网页版带 Cookie，小程序不带 —— 小程序把 token 放在
 * `Authorization: Bearer <accessToken>`（见 `miniprogram/utils/remote.js` 的
 * `send()`）：`wx.request` 不共享浏览器的 Cookie 罐，而 `session.setCookieHeader()`
 * 里那个 `SameSite=Lax` + `Secure` 本来也不是给小程序准备的。
 *
 * 少了这一条，现象是「登录一路绿灯、跟着每一条 `/api/sync/*` 都 401」——
 * 两端都没有一句话是错的，所以谁也定位不到。
 *
 * 三条边界，各有一个踩过的坑：
 *   1. **别在这儿 `decodeURIComponent`**。`fromCookieHeader()` 里面替 Cookie
 *      解过一次（Cookie 里 `=`、`;` 是保留字）；Bearer 那一枚是 base64url + 一个点，
 *      原样用就是对的 —— 多解一次，令牌里恰好出现 `%` 时会被改掉，签名对不上。
 *   2. **认出来之后走的是同一套校验**，不给 Bearer 开小门：`session.read()` 验签与
 *      过期、再查 `sessions` 那一行（`revoked` / `uid` 对得上），一步都不能省。
 *      只有签名是不够的 —— 账号注销之后那一行就没了，而令牌还能验过去。
 *   3. **头名两个大小写都读**：Node 会归一成小写 `authorization`，但自己写的
 *      `http` 包装与某些代理给的是原样的 `Authorization`。
 */
function tokenOf(req) {
  var h = (req && req.headers) || {};

  var fromCookie = session.fromCookieHeader(h.cookie, CONFIG.cookieName);
  if (fromCookie) return fromCookie;

  var raw = String(h.authorization || h.Authorization || "").trim();
  var m = /^Bearer\s+(\S+)$/i.exec(raw);
  return m ? m[1] : null;
}

function withSession(req, d) {
  if (!CONFIG.hasSession()) return Promise.resolve(d);
  return Promise.resolve()
    .then(function () {
      var s = session.read(CONFIG, tokenOf(req), Date.now());
      if (!s) return d;
      return Promise.resolve(d.store.getSession(s.sid)).then(function (row) {

        // A signed token alone is not enough: the row vanishes when the account is deleted.
        if (!row || Number(row.revoked) === 1 || String(row.uid) !== s.uid) return d;
        d.account = { uid: s.uid, sid: s.sid };
        return d;
      });
    })
    ["catch"](function (e) {

      H.log("api.session_read_failed", { error: String(e && e.message || e).slice(0, 200) });
      return d;
    });
}

function settleSession(d, r) {
  if (!r || r.status !== 200 || !r._session) return Promise.resolve(r);
  return Promise.resolve({ status: r.status, body: r.body, cookies: r.cookies });
}

var BODY_TIMEOUT = { __kb_body_timeout__: true };
var BODY_TIMEOUT_MS = 8000;

function readBodyGuarded(req) {
  return Promise.race([
    H.readBody(req),
    new Promise(function (resolve) { setTimeout(function () { resolve(BODY_TIMEOUT); }, BODY_TIMEOUT_MS); })
  ]);
}

function make(name, methods, run, opts) {
  opts = opts || {};
  return function (req, res) {
    var m = String(req.method || "GET").toUpperCase();
    if (methods.indexOf(m) < 0) return H.methodNotAllowed(res, methods);

    var rawBody = !!opts.rawBody;

    var wantBody = m !== "GET" && !rawBody;
    Promise.resolve(wantBody ? readBodyGuarded(req) : {})
      .then(function (body) {
        if (body === null) {
          H.log("api.bad_body", { api: name });
          return H.json(res, 400, {
            code: "E_BAD_BODY",
            message: "这次请求没能完整送达服务器（多半是页面还是旧的一版）。刷新一下页面再提交一次就好——刚才填的邮箱已经帮你留着了，密码需要重填。"
          });
        }
        if (body === BODY_TIMEOUT) {

          H.log("api.body_timeout", { api: name });
          return H.json(res, 400, {
            code: "E_BAD_BODY",
            message: "这次请求拖得太久，服务器没等完（网络可能不太稳）。稍等几秒再提交一次就好，刚才填的邮箱已经帮你留着了。"
          });
        }
        var d = deps(req, body);
        return withSession(req, d).then(function (d2) {
          return run(d2, body || {}, req);
        }).then(function (out) {

          var headers = out.headers || null;
          if (out.cookies && out.cookies.length) {

            res.setHeader("Set-Cookie", out.cookies);
          }

          if (out.body && out.body.code === "E_TURNSTILE") {
            H.log("api.turnstile_blocked", {
              api: name,
              reason: out.body.turnstile,
              codes: out._codes || []
            });
          }
          H.log("api.ok", { api: name, status: out.status });
          H.json(res, out.status, out.body, headers);
        });
      })
      .catch(function (e) {

        var kind = e && e.kind ? e.kind : upstream.classify(e);
        var v = upstream.verdict(kind, CONFIG);
        if (v) {
          H.log("api.upstream_failed", {
            api: name,
            kind: kind,
            status: (e && e.status) || 0,
            error: String(e && e.message || e).slice(0, 220)
          });
          return H.json(res, v.status, v.body);
        }

        H.log("api.error", { api: name, error: String(e && e.message || e).slice(0, 300) });
        H.json(res, 500, { code: "E_INTERNAL", message: "服务端出了点问题，稍后再试；期间本站仍可完全离线使用。" });
      });
  };
}

module.exports = {
  make: make,
  deps: deps,
  tokenOf: tokenOf,
  settleSession: settleSession,
  withSession: withSession,
  CONFIG: CONFIG,
  store: storeMod,
  core: core,
  game: game,
  http: H
};
