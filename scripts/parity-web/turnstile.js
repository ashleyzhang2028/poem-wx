"use strict";

var https = require("https");

var VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function turnstileReady(cfg) {
  var c = (cfg && (cfg.turnstileEnabled !== undefined || cfg.turnstileSecretKey !== undefined)) ? cfg : null;
  if (!c) return false;

  if (c.turnstileBypass === true) return false;
  if (c.turnstileEnabled !== true) return false;
  // Without a site key /api/config hides the widget, so enforcing would reject every request.
  if (!String(c.turnstileSiteKey || "").trim()) return false;
  return String(c.turnstileSecretKey || "").length > 0;
}

function verify(cfg, input) {
  input = input || {};
  if (!turnstileReady(cfg)) {

    var bypassed = !!(cfg && cfg.turnstileBypass === true);
    return Promise.resolve({ ok: true, skipped: true, reason: bypassed ? "bypass" : "not_configured" });
  }
  var token = String(input.token == null ? "" : input.token).trim();

  if (!token) return Promise.resolve({ ok: false, reason: "missing_token", codes: ["missing-input-response"] });
  if (token.length > 2048) return Promise.resolve({ ok: false, reason: "rejected", codes: ["invalid-input-response"] });

  var doFetch = input.fetch || (typeof fetch === "function" ? fetch : null);
  var body = new URLSearchParams();
  body.set("secret", String(cfg.turnstileSecretKey));
  body.set("response", token);
  if (input.ip && input.ip !== "unknown") body.set("remoteip", String(input.ip));

  if (!doFetch) {

    return Promise.resolve({ ok: false, reason: "no_fetch" });
  }

  var ctrl = typeof AbortController === "function" ? new AbortController() : null;

  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 5000) : null;
  var init = {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  };
  if (ctrl) init.signal = ctrl.signal;

  return doFetch(VERIFY_URL, init).then(function (res) {
    if (timer) clearTimeout(timer);
    return res.text().then(function (text) {
      var data = null;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      if (!data || data.success !== true) {

        return { ok: false, reason: "rejected", codes: (data && (data["error-codes"] || data.error_codes)) || [] };
      }

      // Accept subdomains (www.) of SITE_URL; Cloudflare's own widget allowlist is the real gate.
      var want = hostOf(cfg.siteUrl);
      var got = String(data.hostname || "").toLowerCase();
      if (want && got && want !== got && !endsWithHost(got, want) && !endsWithHost(want, got)) {
        return { ok: false, reason: "hostname_mismatch", codes: [] };
      }
      return { ok: true, reason: "ok" };
    });
  }).catch(function (e) {
    if (timer) clearTimeout(timer);

    return { ok: false, reason: (e && e.name === "AbortError") ? "timeout" : "network" };
  });
}

function endsWithHost(host, base) {
  return host.length > base.length && host.slice(-(base.length + 1)) === "." + base;
}

function hostOf(url) {
  try { return String(new URL(String(url || "")).hostname || "").toLowerCase(); } catch (e) { return ""; }
}

// Map the verify result to something the user can act on; raw Cloudflare codes stay in server logs.
function verdictOf(r) {
  var codes = r.codes || [];
  if (r.reason === "missing_token") {
    return { kind: "missing", message: "请先完成人机校验（按钮上方那个方框）" };
  }
  if (r.reason === "timeout" || r.reason === "network" || r.reason === "no_fetch") {
    return { kind: "unavailable", message: "人机校验服务暂时连不上，请稍后再试" };
  }
  if (codes.some(function (c) { return /secret/.test(String(c)); })) {
    return { kind: "config", message: "本站人机校验配置有误，请联系站点管理员" };
  }
  if (codes.indexOf("timeout-or-duplicate") >= 0) {
    return { kind: "expired", message: "人机校验已过期，请等方框重新通过后再点一次" };
  }
  return { kind: "failed", message: "人机校验没通过，请等方框重新通过后再试一次" };
}

function guard(cfg, input) {
  return verify(cfg, input).then(function (r) {
    if (r.ok) return null;
    var v = verdictOf(r);
    return {
      status: 400,
      body: {
        code: "E_TURNSTILE",
        message: v.message,

        turnstile: v.kind
      },

      _codes: (r.codes || []).concat(r.reason && r.reason !== "rejected" ? [r.reason] : [])
    };
  });
}

module.exports = {
  VERIFY_URL: VERIFY_URL,
  turnstileReady: turnstileReady,
  verify: verify,
  guard: guard,
  hostOf: hostOf
};
