"use strict";

var http = require("http");
var https = require("https");

function postJson(url, headers, body) {
  return new Promise(function (resolve, reject) {
    var u = new URL(url);
    var payload = Buffer.from(JSON.stringify(body), "utf8");
    var req = https.request({
      method: "POST",
      hostname: u.hostname,
      path: u.pathname + (u.search || ""),
      headers: Object.assign({
        "Content-Type": "application/json",
        "Content-Length": payload.length
      }, headers)
    }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        var text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ status: res.statusCode, text: text });
        var err = new Error("mail " + res.statusCode + ": " + text.slice(0, 300));
        err.status = res.statusCode;
        reject(err);
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function buildMessage(cfg, opts) {
  var minutes = Math.round(cfg.codeTtlMs / 60000);
  var subject = "【跬步】登录验证码 " + opts.code;
  var text = [
    "你的验证码是：" + opts.code,
    "",
    minutes + " 分钟内有效，用过一次即失效。",
    "如果不是你本人操作，忽略这封邮件即可 —— 你的账号不会有任何变化。",
    "",
    "跬步 · 积跬步，至千里",
    cfg.siteUrl
  ].join("\n");

  var html = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.7;color:#2b2b2b">',
    '<p>你的验证码是：</p>',
    '<p style="font-size:28px;letter-spacing:6px;font-weight:700;color:#2f6055">' + opts.code + '</p>',
    '<p style="color:#666;font-size:13px">' + minutes + ' 分钟内有效，用过一次即失效。<br>',
    '如果不是你本人操作，忽略这封邮件即可 —— 你的账号不会有任何变化。</p>',
    '<p style="color:#666;font-size:13px">跬步 · 积跬步，至千里<br>',
    '<a href="' + cfg.siteUrl + '" style="color:#2f6055">' + cfg.siteUrl + "</a></p>",
    "</div>"
  ].join("");
  return { subject: subject, text: text, html: html };
}

function buildConfirm(cfg, opts) {
  var hours = Math.round((opts.ttlMs || 86400000) / 3600000);
  var url = link(cfg, "verify", opts);
  var subject = "【跬步】确认你的邮箱";
  var text = [
    "点下面这条链接确认你的邮箱：",
    "",
    url,
    "",
    hours + " 小时内有效，用过一次即失效。",
    "确认之后，你才能在忘记密码时用它重设密码。",
    "如果不是你本人操作，忽略这封邮件即可 —— 你的账号不会有任何变化。",
    "",
    "跬步 · 积跬步，至千里",
    cfg.siteUrl
  ].join("\n");
  return { subject: subject, text: text, html: shell(
    "<p>点下面这颗按钮确认你的邮箱：</p>" + button(url, "确认邮箱") +
    "<p style=\"color:#666;font-size:13px\">" + hours + " 小时内有效，用过一次即失效。<br>" +
    "确认之后，你才能在忘记密码时用它重设密码。<br>" +
    "如果不是你本人操作，忽略这封邮件即可 —— 你的账号不会有任何变化。</p>", cfg) };
}

function buildReset(cfg, opts) {
  var minutes = Math.round((opts.ttlMs || 3600000) / 60000);
  var url = link(cfg, "reset", opts);
  var subject = "【跬步】重设密码";
  var text = [
    "点下面这条链接重设密码：",
    "",
    url,
    "",
    minutes + " 分钟内有效，用过一次即失效。",
    "重设之后，你在其它设备上的登录会全部退出。",
    "如果不是你本人操作，别点这条链接，也请考虑换一个更结实的密码。",
    "",
    "跬步 · 积跬步，至千里",
    cfg.siteUrl
  ].join("\n");
  return { subject: subject, text: text, html: shell(
    "<p>点下面这颗按钮重设密码：</p>" + button(url, "重设密码") +
    "<p style=\"color:#666;font-size:13px\">" + minutes + " 分钟内有效，用过一次即失效。<br>" +
    "重设之后，你在其它设备上的登录会全部退出。<br>" +
    "如果不是你本人操作，别点这条链接，也请考虑换一个更结实的密码。</p>", cfg) };
}

function link(cfg, kind, opts) {
  var base = String(cfg.siteUrl || "").replace(/\/+$/, "");
  if (kind === "verify") {
    return base + "/verify/?vid=" + encodeURIComponent(opts.vid || "") +
      "&token=" + encodeURIComponent(opts.token || "");
  }
  return base + "/reset/?rid=" + encodeURIComponent(opts.rid || "") +
    "&token=" + encodeURIComponent(opts.token || "");
}

function shell(inner, cfg) {
  return [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.7;color:#2b2b2b">',
    inner,
    '<p style="color:#666;font-size:13px">跬步 · 积跬步，至千里<br>',
    '<a href="' + cfg.siteUrl + '" style="color:#2f6055">' + cfg.siteUrl + "</a></p>",
    "</div>"
  ].join("");
}

function button(href, label) {
  return '<p><a href="' + href + '" style="display:inline-block;padding:10px 18px;' +
    'background:#2f6055;color:#fff;border-radius:8px;text-decoration:none">' + label + "</a></p>" +
    '<p style="color:#666;font-size:12px;word-break:break-all">' + href + "</p>";
}

var transports = {};

transports.sendgrid = function (cfg) {
  return {
    name: "sendgrid",
    configured: function () { return !!cfg.sendgridKey; },
    send: function (msg) {
      return postJson("https://api.sendgrid.com/v3/mail/send", {
        Authorization: "Bearer " + cfg.sendgridKey
      }, {
        personalizations: [{ to: [{ email: msg.to }] }],
        from: { email: cfg.mailFrom, name: cfg.mailFromName },
        subject: msg.subject,
        content: [
          { type: "text/plain", value: msg.text },
          { type: "text/html", value: msg.html }
        ]
      }).then(function (r) { return { ok: true, transport: "sendgrid", status: r.status, id: r.text || null }; });
    }
  };
};

transports.resend = function (cfg) {
  return {
    name: "resend",
    configured: function () { return !!cfg.resendKey; },
    send: function (msg) {
      return postJson("https://api.resend.com/emails", {
        Authorization: "Bearer " + cfg.resendKey
      }, {
        from: cfg.mailFromName + " <" + cfg.mailFrom + ">",
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html
      }).then(function (r) {
        var id = null;
        try { id = JSON.parse(r.text).id; } catch (e) { id = null; }
        return { ok: true, transport: "resend", status: r.status, id: id };
      });
    }
  };
};

transports.console = function (cfg) {
  return {
    name: "console",
    configured: function () { return true; },
    devOnly: true,
    send: function (msg) {
      console.log("[mail:console] 未配置发信商，验证码未向外发送 → 收件人 " + (msg.to || "***") +
        "（明文码不回给调用方，也**不打印**；要看码请开 ALLOW_CODE_ECHO=1）");
      return Promise.resolve({ ok: true, transport: "console", delivered: false });
    }
  };
};

function retriable(e) {
  if (!e) return false;
  var st = Number(e.status || 0);

  if (st) return st === 429 || st >= 500;

  return true;
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function withRetry(cfg, attempt) {
  var max = Number(cfg.mailRetryMax);
  if (!isFinite(max) || max < 0) max = 2;
  var budget = Number(cfg.mailRetryBudgetMs);
  if (!isFinite(budget) || budget <= 0) budget = 6000;
  var started = Date.now();
  var attempts = 0;

  function once() {
    attempts++;
    return attempt().then(function (r) {

      return { out: r, attempts: attempts };
    }).catch(function (e) {
      var left = budget - (Date.now() - started);
      var canRetry = retriable(e) && attempts <= max && left > 300;
      if (!canRetry) {
        return { failed: e, attempts: attempts, gaveUp: true };
      }

      var base = Number(cfg.mailRetryBaseMs);
      if (!isFinite(base) || base <= 0) base = 400;
      var wait = Math.round(base * Math.pow(3, attempts - 1) * (0.7 + Math.random() * 0.6));
      if (wait > left) wait = Math.max(0, left - 50);
      return sleep(wait).then(once);
    });
  }

  return once().then(function (res) {
    if (res.failed) {

      var e = res.failed;
      e.attempts = res.attempts;
      e.reason = Number(e && e.status) ? ("http_" + e.status) : "network";
      throw e;
    }
    var out = res.out || {};
    return {
      ok: true,
      delivered: !!out.delivered,
      attempts: res.attempts,
      transport: out.transport || "unknown",
      status: out.status || null,
      id: out.id || null
    };
  });
}

transports.sms = function (cfg) {
  return {
    name: "sms",
    configured: function () { return false; },
    notImplemented: true,
    send: function () {
      return Promise.reject(new Error("SMS channel not implemented: 尚未接入短信商（需签名 + 模板报备）"));
    }
  };
};

function pick(cfg) {
  var want = cfg.mail ? cfg.mail() : "console";

  if (want === "sms") {
    var svc = cfg.smsTransport;
    if (svc && transports[svc]) return transports[svc](cfg);
    return transports.sms(cfg);
  }
  var t = transports[want] ? transports[want](cfg) : transports.console(cfg);
  return t;
}

function send(cfg, opts) {
  return sendKind(cfg, "code", opts);
}

function sendKind(cfg, kind, opts) {
  var t = pick(cfg);
  var msg = kind === "verify" ? buildConfirm(cfg, opts)
    : kind === "reset" ? buildReset(cfg, opts)
      : buildMessage(cfg, opts);
  msg.to = opts.to;
  msg.code = opts.code;
  if (opts.vid) msg.vid = opts.vid;
  if (opts.rid) msg.rid = opts.rid;

  return withRetry(cfg, function () {
    return t.send(msg).then(function (r) {
      return {
        ok: true,
        transport: r.transport,

        delivered: r.transport !== "console" && r.delivered !== false,
        status: r.status || null,
        id: r.id || null
      };
    });
  });
}

function confirm(cfg, opts) {
  var o = Object.assign({}, opts);
  if (!o.vid) o.vid = "";
  return sendKind(cfg, "verify", o);
}

function reset(cfg, opts) {
  var o = Object.assign({}, opts);
  if (!o.rid) o.rid = "";
  return sendKind(cfg, "reset", o);
}

module.exports = {
  send: send,
  withRetry: withRetry,
  retriable: retriable,
  confirm: confirm,
  reset: reset,
  sendKind: sendKind,
  pick: pick,
  buildMessage: buildMessage,
  buildConfirm: buildConfirm,
  buildReset: buildReset,
  link: link,
  transports: transports
};
