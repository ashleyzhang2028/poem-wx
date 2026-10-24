"use strict";

var handler = require("./../_lib/handler");
var shardRev = require("./../_lib/shard-rev");

module.exports = handler.make("config", ["GET"], function (d) {
  var cfg = d.cfg;

  var enabled = handler.core.turnstileReady(cfg);
  var turnstile = { enabled: enabled };
  if (enabled) turnstile.siteKey = String(cfg.turnstileSiteKey || "");

  var out = {
    turnstile: turnstile,

    mail: { delivered: String(cfg.mail ? cfg.mail() : "console") !== "console" },

    corpus: { rev: shardRev.rev(), shards: shardRev.names().length }
  };

  return {
    status: 200,
    body: out,

    headers: { "Cache-Control": "public, max-age=30" }
  };
});
