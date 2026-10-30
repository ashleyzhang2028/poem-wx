"use strict";

var crypto = require("crypto");
var session = require("./session");
var pay = require("./pay");
var H = require("./http");

var DAY = 86400000;

var TICKET_TTL_MS = 3 * 3600000;

var SEC_PER_POINT = { exam: 2, fly: 3 };

var RISK_TTL_MS = 3600000;

var riskCache = {};

function b64url(text) {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(text) {
  var t = String(text || "").replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Buffer.from(t, "base64").toString("utf8");
}

function mac(cfg, payload) {
  return crypto.createHmac("sha256", session.keyOf(cfg)).update("board:" + payload).digest("hex");
}

function issue(cfg, uid, game, t) {
  var payload = b64url(JSON.stringify({ u: uid, g: game, t: t, n: crypto.randomBytes(9).toString("hex") }));
  return payload + "." + mac(cfg, payload);
}

function read(cfg, ticket, uid, game, t) {
  var raw = String(ticket || "");
  var dot = raw.lastIndexOf(".");
  if (dot <= 0) return { ok: false };
  var payload = raw.slice(0, dot);
  var a = Buffer.from(raw.slice(dot + 1), "utf8");
  var b = Buffer.from(mac(cfg, payload), "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };
  var body;
  try { body = JSON.parse(unb64url(payload)); } catch (e) { return { ok: false }; }
  if (!body || body.u !== uid || body.g !== game || typeof body.t !== "number" || typeof body.n !== "string") return { ok: false };
  if (body.t > t || t - body.t > TICKET_TTL_MS) return { ok: false };
  return { ok: true, startedAt: body.t, nonce: body.n };
}

function plausible(game, score, seconds) {
  var per = SEC_PER_POINT[game] || 2;
  return seconds >= Math.ceil(score * per);
}

function riskRank(deps, openid) {
  var cfg = deps.cfg;
  if (!cfg.risk || !cfg.risk.enabled || !openid) return Promise.resolve(null);
  var t = deps.now();
  var hit = riskCache[openid];
  if (hit && hit.expiresAt > t) return Promise.resolve(hit.rank);
  return pay.accessToken(deps).then(function (token) {
    if (!token) return null;
    var url = pay.wxBase(cfg) + "/wxa/getuserriskrank?access_token=" + encodeURIComponent(token);
    return pay.wxFetchJson(deps, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appid: cfg.wxAppId, openid: openid, scene: 1, client_ip: String(deps.ip || "") })
    }).then(function (data) {
      if (!data || Number(data.errcode) !== 0 || typeof data.risk_rank !== "number") return null;
      riskCache[openid] = { rank: data.risk_rank, expiresAt: t + RISK_TTL_MS };
      return data.risk_rank;
    });
  }).then(null, function (e) {
    H.log("api.risk_rank_failed", { error: String((e && e.message) || e).slice(0, 160) });
    return null;
  });
}

function openidOf(store, uid) {
  if (typeof store.getWxAccountByUid !== "function") return Promise.resolve("");
  return Promise.resolve(store.getWxAccountByUid(uid)).then(function (row) {
    return row && row.openid ? String(row.openid) : "";
  }, function () { return ""; });
}

function admit(deps, me, game, input, score) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var board = cfg.board || {};
  var ticket = read(cfg, input && input.ticket, me.uid, game, t);
  var seconds = Math.max(0, Math.min(24 * 3600, Number(input && input.durationSec) || 0));

  function bad(code, message) {
    return { ok: false, code: code, message: message };
  }

  if (ticket.ok) {
    seconds = Math.round((t - ticket.startedAt) / 1000);
  } else if (board.ticketRequired) {
    return Promise.resolve(bad("E_TICKET", "成绩凭证无效，请重新开局后再提交"));
  }
  if (!seconds || !plausible(game, score, seconds)) {
    return Promise.resolve(bad("E_SCORE", "成绩与用时不符，未予记录"));
  }

  var replay = ticket.ok && typeof store.bumpCounter === "function"
    ? Promise.resolve(store.bumpCounter("ticket:" + ticket.nonce, DAY, t))
    : Promise.resolve(1);
  return replay.then(function (n) {
    if (n > 1) return bad("E_TICKET", "成绩凭证已使用，请重新开局");
    return openidOf(store, me.uid).then(function (openid) {
      return riskRank(deps, openid);
    }).then(function (rank) {
      var block = cfg.risk && cfg.risk.blockRank;
      if (rank !== null && block && rank >= block) return bad("E_RISK", "当前账号暂不能参与排行榜");
      return { ok: true, durationSec: seconds };
    });
  });
}

module.exports = { issue: issue, read: read, plausible: plausible, riskRank: riskRank, admit: admit };
