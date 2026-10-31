"use strict";

var H = require("./http");

var HOUR = 3600000;

var DAY = 86400000;

var FREE = { "pay.notify": 1, "diag": 1, "config": 1, "daily.poems": 1, "corpus": 1, "avatar-file": 1 };

var PURGE_ONE_IN = 200;

function plan(cfg, d) {
  var q = cfg.quota;
  var uid = d.account && d.account.uid;
  var list = [];
  if (uid) {
    list.push(["uid:" + uid, HOUR, q.uidHour]);
    list.push(["uid:" + uid, DAY, q.uidDay]);
    if (d.ip) list.push(["ip:" + d.ip, HOUR, q.ipHour]);
  } else if (d.ip) {
    list.push(["ip:" + d.ip, HOUR, q.anonHour]);
    list.push(["ip:" + d.ip, DAY, q.anonDay]);
  }
  return list;
}

function admit(d, name) {
  if (FREE[name] || !d.store || typeof d.store.bumpCounter !== "function") return Promise.resolve({ ok: true });
  var t = d.now();
  var list = plan(d.cfg, d);
  if (!list.length) return Promise.resolve({ ok: true });
  return Promise.all(list.map(function (x) {
    return Promise.resolve(d.store.bumpCounter(x[0], x[1], t));
  })).then(function (counts) {
    if (typeof d.store.purgeCounters === "function" && Math.random() * PURGE_ONE_IN < 1) {
      Promise.resolve(d.store.purgeCounters(t)).then(null, function () {});
    }
    for (var i = 0; i < list.length; i += 1) {
      if (counts[i] > list[i][2]) {
        var span = list[i][1];
        return { ok: false, scope: list[i][0].split(":")[0], retryAfter: Math.ceil((Math.floor(t / span) * span + span - t) / 1000) };
      }
    }
    return { ok: true };
  }, function (e) {
    H.log("api.quota_failed", { api: name, error: String((e && e.message) || e).slice(0, 200) });
    return { ok: true };
  });
}

module.exports = { admit: admit, FREE: FREE };
