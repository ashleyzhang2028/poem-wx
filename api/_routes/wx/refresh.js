"use strict";

var handler = require("../../_lib/handler");

/**
 * `POST /api/wx/refresh` —— 小程序端启动时调一次，之后 token 过期时由
 * `remote.request()` 自动再调一次（401 → 换一枚 → 原样重发）。
 *
 * 报文：`{ refreshToken, device }` —— **`device` 同样不能少**（理由同登录那条：
 * 签会话与限流都要它）。
 *
 * 刷新不回话（401）时，客户端会**自己清掉本机会话**：refreshToken 不认了意味着
 * 本机举着一份服务端不认的档位，留着比清掉更糟。清会话不影响本机进度与设置。
 */
module.exports = handler.make("wx.refresh", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.wxRefresh(d, {
    refreshToken: body.refreshToken,
    device: body.device || body.deviceId,
    ip: d.ip
  }).then(function (r) {
    return handler.settleSession(d, r);
  });
});
