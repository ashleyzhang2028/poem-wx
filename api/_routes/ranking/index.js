"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("ranking", ["POST"], function (d, body) {
  var op = String(body.op || "list");
  if (op === "visible") return handler.core.boardVisible(d, { game: body.game });
  if (op === "delete") return handler.core.boardDelete(d, { game: body.game, srid: body.srid });
  if (op === "start") return handler.core.boardStart(d, { game: body.game });
  if (op === "submit") {
    return handler.core.boardSubmit(d, {
      game: body.game,
      scopeId: body.scopeId,
      stage: body.stage,
      grade: body.grade,
      term: body.term,
      score: body.score,
      total: body.total,
      durationSec: body.durationSec,
      ticket: body.ticket
    });
  }
  return handler.core.boardList(d, {
    game: body.game,
    stage: body.stage,
    grade: body.grade,
    term: body.term,
    period: body.period,
    size: body.size
  });
});
