"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("admin.pinyin", ["POST"], function (d, body) {
  if (d.cfg && !d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  var op = String(body.op || "list");
  if (op === "submit") {
    return handler.core.pinyinProposalSubmit(d, {
      wid: body.wid, line: body.line, at: body.at, ch: body.ch, py: body.py,
      poemTitle: body.poemTitle, book: body.book
    });
  }
  if (op === "review") {
    return handler.core.pinyinProposalReview(d, { fid: body.fid, decision: body.decision, note: body.note });
  }
  return handler.core.pinyinProposalList(d, { status: body.status, limit: body.limit });
});
