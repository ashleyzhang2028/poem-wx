"use strict";

var handler = require("../../_lib/handler");

/**
 * `POST /api/wx/login` —— 小程序端 `auth.login()` 打的就是这一条。
 *
 * 报文：`{ code, device }`
 *
 * ⚠️ **字段名是 `device`，不是 `deviceId`。** `/api/sync/*` 那两条用的是
 * `deviceId`，而这一条（与 `/api/wx/refresh`）用 `device` —— 两套在本仓库里并存，
 * 照抄别的接口会在此处静默对不上：服务端读不到设备号不报错，但会话签不出
 * `sessions.device`、限流拆成一堆空桶。契约见 docs/wx-login-server.md。
 *
 * `handler.settleSession()` 那一句别省 —— 它是「把 Cookie 剥掉、只留 body」那一步。
 * 小程序端不接 Cookie，少写这一句也不报错，只是白带一个没用的头。
 */
module.exports = handler.make("wx.login", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.wxLogin(d, {
    code: body.code,
    device: body.device || body.deviceId,
    ip: d.ip
  }).then(function (r) {
    return handler.settleSession(d, r);
  });
});
