"use strict";

var ACCOUNT_COLS = ["uid", "email", "email_hash", "nickname", "plan", "plan_until", "role",
  "created_at", "last_login_at", "login_count", "status",
  "email_verified_at", "password_hash", "password_salt", "locked_until"];

var PATCHABLE_ACCOUNT_COLS = ["plan", "plan_until", "role", "last_login_at", "login_count", "nickname",
  "status", "email", "email_verified_at", "password_hash", "password_salt", "locked_until"];

var IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function assertIdent(name) {
  if (!IDENT.test(String(name || ""))) {
    throw new Error("不是合法的列名（拒绝拼进 SQL）：" + JSON.stringify(name));
  }
  return String(name);
}

function pickCols(obj, allowed) {
  var out = {};
  allowed.forEach(function (k) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  });
  return out;
}

function nonProto(obj) {
  var out = {};
  Object.keys(obj || {}).forEach(function (k) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") return;
    if (!Object.prototype.hasOwnProperty.call(obj, k)) return;
    out[k] = obj[k];
  });
  return out;
}

function safeCols(obj) {
  return Object.keys(nonProto(obj)).map(assertIdent);
}

function assignValues(cols, extra) {
  var parts = cols.map(function (c) {
    assertIdent(c);
    return "`" + c + "` = VALUES(`" + c + "`)";
  });
  if (extra) parts.push(extra);
  return parts.join(", ");
}

function upsertSql(table, cols, keyCols, override) {
  assertIdent(table);
  var names = cols.map(function (c) { return "`" + assertIdent(c) + "`"; });
  var marks = cols.map(function () { return "?"; });
  var updatable = cols.filter(function (c) { return keyCols.indexOf(c) < 0 && c !== override; });
  return "INSERT INTO `" + table + "` (" + names.join(",") + ") VALUES (" + marks.join(",") + ")"
    + (updatable.length ? " ON DUPLICATE KEY UPDATE " + assignValues(updatable) : "");
}

function mysqlStore(cfg) {

  var pool = cfg.mysql || null;
  if (!pool || typeof pool.query !== "function") {
    throw new Error("mysqlStore 需要一个 mysql2/promise 连接池（cfg.mysql.query）");
  }

  function query(sql, params) {
    return Promise.resolve(pool.query(sql, params || [])).then(function (r) {

      return Array.isArray(r) && r.length === 2 ? r[0] : r;
    });
  }

  function num(v) {
    if (v === null || v === undefined) return v;
    return typeof v === "number" ? v : Number(v);
  }

  function boolish(v) {
    return v === null || v === undefined ? v : Number(v);
  }

  function accountRow(r) {
    if (!r) return null;
    var out = pickCols(r, ACCOUNT_COLS);
    ["created_at", "last_login_at", "email_verified_at", "plan_until", "locked_until"].forEach(function (k) {
      if (out[k] !== undefined) out[k] = num(out[k]);
    });
    if (out.login_count !== undefined) out.login_count = num(out.login_count);
    return out;
  }

  function progressRow(r) {
    if (!r) return null;
    return {
      poem_id: r.poem_id,
      payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
      updated_at: num(r.updated_at),
      deleted: boolish(r.deleted)
    };
  }

  var api = {
    kind: "mysql",
    ready: function () { return true; },
    degrade: function () { return []; },

    getAccountByHash: function (hash) {
      return query("SELECT * FROM accounts WHERE email_hash = ? LIMIT 1", [String(hash || "")])
        .then(function (rows) { return accountRow(rows && rows[0]); });
    },
    getAccount: function (uid) {
      return query("SELECT * FROM accounts WHERE uid = ? LIMIT 1", [String(uid || "")])
        .then(function (rows) { return accountRow(rows && rows[0]); });
    },
    getAccounts: function (uids) {
      var list = (uids || []).map(function (u) { return String(u || ""); }).filter(Boolean);
      if (!list.length) return Promise.resolve([]);
      var uniq = [];
      list.forEach(function (u) { if (uniq.indexOf(u) < 0) uniq.push(u); });
      var out = {};
      return query(
        "SELECT * FROM accounts WHERE uid IN (" + uniq.map(function () { return "?"; }).join(",") + ")",
        uniq
      ).then(function (rows) {
        (rows || []).forEach(function (r) {
          if (r && r.uid) out[String(r.uid)] = accountRow(r);
        });
        return list.map(function (u) { return out[u] || null; });
      });
    },
    putAccount: function (acc) {
      var row = pickCols(acc, ACCOUNT_COLS);
      var cols = safeCols(row);
      if (!cols.length) return Promise.resolve(acc);
      return query(upsertSql("accounts", cols, ["uid"]), cols.map(function (c) { return row[c]; }))
        .then(function () { return acc; });
    },
    patchAccount: function (uid, patch) {
      var row = pickCols(patch, PATCHABLE_ACCOUNT_COLS);
      var cols = safeCols(row);
      if (!cols.length) return Promise.resolve(true);
      var sets = cols.map(function (c) { return "`" + c + "` = ?"; }).join(", ");
      return query("UPDATE accounts SET " + sets + " WHERE uid = ?",
        cols.map(function (c) { return row[c]; }).concat([String(uid || "")]))
        .then(function () { return true; });
    },
    listAccounts: function () {
      return query("SELECT * FROM accounts ORDER BY created_at DESC LIMIT 500")
        .then(function (rows) { return (rows || []).map(accountRow); });
    },
    deleteAccount: function (uid) {
      return query("DELETE FROM accounts WHERE uid = ?", [String(uid || "")]).then(function () { return true; });
    },

    getWxAccountByOpenid: function (openid) {
      return query("SELECT * FROM wx_accounts WHERE openid = ? LIMIT 1", [String(openid || "")])
        .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    getWxAccountByUid: function (uid) {
      return query("SELECT * FROM wx_accounts WHERE uid = ? LIMIT 1", [String(uid || "")])
        .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    getWxAccountByUnionid: function (unionid) {
      if (!unionid) return null;
      return query("SELECT * FROM wx_accounts WHERE unionid = ? LIMIT 1", [String(unionid)])
        .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    putWxAccount: function (row) {
      var cols = Object.keys(row);
      if (!cols.length) return Promise.resolve(row);
      return query(upsertSql("wx_accounts", cols, ["uid"]), cols.map(function (c) { return row[c]; }))
        .then(function () { return row; });
    },
    patchWxAccount: function (uid, patch) {
      var cols = safeCols(patch);
      if (!cols.length) return Promise.resolve(true);
      var sets = cols.map(function (c) { return "`" + c + "` = ?"; }).join(", ");
      return query("UPDATE wx_accounts SET " + sets + " WHERE uid = ?",
        cols.map(function (c) { return patch[c]; }).concat([String(uid || "")]))
        .then(function () { return true; });
    },

    putCode: function (rec) {
      return insertRow("codes", rec, ["code_id"]);
    },
    getCode: function (codeId) {
      return query("SELECT * FROM codes WHERE code_id = ? LIMIT 1", [String(codeId || "")])
        .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    bumpCodeAttempt: function (codeId) {
      return query("UPDATE codes SET attempts = attempts + 1 WHERE code_id = ?", [String(codeId || "")])
        .then(function () { return query("SELECT attempts FROM codes WHERE code_id = ? LIMIT 1", [String(codeId || "")]); })
        .then(function (rows) { return rows && rows[0] ? Number(rows[0].attempts) : 0; });
    },
    patchCode: function (codeId, patch) {
      return patchRow("codes", "code_id", codeId, patch);
    },
    voidCodes: function (uid, purpose, at) {
      return query("UPDATE codes SET consumed_at = ? WHERE uid = ? AND purpose = ? AND consumed_at IS NULL",
        [at, String(uid || ""), String(purpose || "")]).then(function () { return true; });
    },

    putVerification: function (rec) {
      return insertRow("verifications", rec, ["vid"]);
    },
    getVerification: function (vid) {
      return query("SELECT * FROM verifications WHERE vid = ? LIMIT 1", [String(vid || "")])
        .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    patchVerification: function (vid, patch) {
      return patchRow("verifications", "vid", vid, patch);
    },
    voidVerifications: function (uid, at) {
      return query("UPDATE verifications SET consumed_at = ? WHERE uid = ? AND consumed_at IS NULL",
        [at, String(uid || "")]).then(function () { return true; });
    },

    putReset: function (rec) {
      return insertRow("resets", rec, ["rid"]);
    },
    getReset: function (rid) {
      return query("SELECT * FROM resets WHERE rid = ? LIMIT 1", [String(rid || "")])
        .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    patchReset: function (rid, patch) {
      return patchRow("resets", "rid", rid, patch);
    },
    voidResets: function (uid, at) {
      return query("UPDATE resets SET consumed_at = ? WHERE uid = ? AND consumed_at IS NULL",
        [at, String(uid || "")]).then(function () { return true; });
    },

    bumpCounter: function (subject, spanMs, nowMs) {
      var win = Math.floor(nowMs / spanMs);
      return query(
        "INSERT INTO `rate_counters` (`subject`, `span_ms`, `win`, `n`, `expires_at`) VALUES (?, ?, ?, 1, ?)"
          + " ON DUPLICATE KEY UPDATE `n` = LAST_INSERT_ID(`n` + 1)",
        [String(subject), spanMs, win, (win + 1) * spanMs]
      ).then(function (r) { return Number(r && r.insertId) || 1; });
    },
    purgeCounters: function (nowMs) {
      return query("DELETE FROM `rate_counters` WHERE `expires_at` < ?", [nowMs]).then(function () { return true; });
    },
    putSession: function (s) {
      return insertRow("sessions", s, ["sid"]);
    },
    getSession: function (sid) {
      return query("SELECT * FROM sessions WHERE sid = ? LIMIT 1", [String(sid || "")])
        .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    revokeSession: function (sid) {
      return query("UPDATE sessions SET revoked = 1 WHERE sid = ?", [String(sid || "")])
        .then(function () { return true; });
    },
    revokeSessions: function (uid) {
      return query("UPDATE sessions SET revoked = 1 WHERE uid = ?", [String(uid || "")])
        .then(function () { return true; });
    },

    listProgress: function (uid, child, since) {
      var cid = child == null ? "" : String(child);
      var sql = "SELECT poem_id, payload, updated_at, deleted FROM progress WHERE uid = ? AND child_id = ?";
      var params = [String(uid || ""), cid];
      if (since) {
        sql += " AND synced_at > ?";
        params.push(Number(since));
      }
      return query(sql, params).then(function (rows) { return (rows || []).map(progressRow); });
    },

    putProgress: function (uid, child, recs, syncedAt) {
      var cid = child == null ? "" : String(child);
      var rows = (recs || []).map(function (r) {
        return [String(uid || ""), cid, String(r.poem_id), JSON.stringify(r.payload === undefined ? {} : r.payload),
          Number(r.updated_at) || 0, r.deleted ? 1 : 0, Number(syncedAt) || Number(r.updated_at) || 0];
      });
      if (!rows.length) return Promise.resolve(true);

      var SQL = ""
        + "INSERT INTO `progress` (`uid`,`child_id`,`poem_id`,`payload`,`updated_at`,`deleted`,`synced_at`) VALUES "
        + rows.map(function () { return "(?,?,?,?,?,?,?)"; }).join(",")
        + " ON DUPLICATE KEY UPDATE "
        + "`payload`    = IF(VALUES(`updated_at`) >= `updated_at`, VALUES(`payload`), `payload`), "
        + "`synced_at`  = IF(VALUES(`updated_at`) >= `updated_at`, VALUES(`synced_at`), `synced_at`), "
        + "`updated_at` = GREATEST(`updated_at`, VALUES(`updated_at`)), "
        + "`deleted`    = IF(VALUES(`updated_at`) >= `updated_at`, VALUES(`deleted`), `deleted`)";

      var params = [];
      rows.forEach(function (r) { params = params.concat(r); });
      return query(SQL, params).then(function () { return true; });
    },

    deleteProgress: function (uid) {
      return query("DELETE FROM progress WHERE uid = ?", [String(uid || "")]).then(function () { return true; });
    },

    putReport: function (row) { return insertRow("reports", row, ["rid"]).then(function () { return { rid: row.rid }; }); },
    getReport: function (rid) { return getRow("reports", "rid", rid); },
    listReports: function (filter, limit) {
      var f = filter || {};
      var where = [], params = [];
      if (f.uid) { where.push("uid = ?"); params.push(String(f.uid)); }
      if (f.status) { where.push("status = ?"); params.push(String(f.status)); }
      if (f.poemId) { where.push("poem_id = ?"); params.push(String(f.poemId)); }
      var sql = "SELECT * FROM reports" + (where.length ? " WHERE " + where.join(" AND ") : "")
        + " ORDER BY created_at DESC LIMIT " + Number(limit || 200);
      return query(sql, params).then(function (rows) { return rows || []; });
    },
    patchReport: function (rid, patch) { return patchRow("reports", "rid", rid, patch, true); },
    countReports: function (filter) {
      var f = filter || {};
      var where = [], params = [];
      if (f.uid) { where.push("uid = ?"); params.push(String(f.uid)); }
      if (f.poemId) { where.push("poem_id = ?"); params.push(String(f.poemId)); }
      return countByStatus("reports", where, params, "new");
    },
    countReportsByUid: function (uid, since) {
      var day = Number(since) - 86400000;
      return query("SELECT rid FROM reports WHERE uid = ? AND created_at > ? LIMIT 1000",
        [String(uid || ""), day]).then(function (rows) { return (rows || []).length; });
    },

    countDailyPoems: function () {
      return query("SELECT COUNT(*) AS n FROM daily_poems").then(function (rows) { return rows && rows[0] ? num(rows[0].n) : 0; });
    },
    getDailyPoem: function (pos) {
      return query("SELECT * FROM daily_poems WHERE pos = ? LIMIT 1", [Number(pos)])
        .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },

    listCorpusBooks: function () {
      return query("SELECT book_id, name, unit, page, prefix, kind, total FROM corpus_books ORDER BY pos")
        .then(function (rows) { return rows || []; });
    },
    listCorpusPoems: function (bookId) {
      return query("SELECT id, title, author, author_alt, dynasty, source, aliases, selection, grade_group, grade, term"
        + " FROM corpus_poems WHERE book_id = ? ORDER BY pos", [String(bookId || "")])
        .then(function (rows) { return rows || []; });
    },
    listCorpusCatalog: function () {
      return query("SELECT book_id, title, author, note, in_course FROM corpus_catalog ORDER BY book_id, pos")
        .then(function (rows) { return rows || []; });
    },
    listCorpusAuthors: function () {
      return query("SELECT name, era, era_at FROM corpus_authors").then(function (rows) { return rows || []; });
    },

    putPinyinProposal: function (row) { return insertRow("pinyin_proposals", row, ["fid"]).then(function () { return { fid: row.fid }; }); },
    getPinyinProposal: function (fid) { return getRow("pinyin_proposals", "fid", fid); },
    listPinyinProposals: function (filter, limit) {
      var f = filter || {};
      var where = [], params = [];
      if (f.status) { where.push("status = ?"); params.push(String(f.status)); }
      if (f.wid != null) { where.push("wid = ?"); params.push(String(f.wid)); }
      if (f.line != null) { where.push("line = ?"); params.push(String(f.line)); }
      if (f.at != null) { where.push("at = ?"); params.push(Number(f.at)); }
      var sql = "SELECT * FROM pinyin_proposals" + (where.length ? " WHERE " + where.join(" AND ") : "")
        + " ORDER BY updated_at DESC LIMIT " + Number(limit || 300);
      return query(sql, params).then(function (rows) { return rows || []; });
    },
    patchPinyinProposal: function (fid, patch) { return patchRow("pinyin_proposals", "fid", fid, patch, true); },
    countPinyinProposals: function () {
      return countByStatus("pinyin_proposals", [], [], "pending");
    },

    putFeedbackThread: function (row) {
      return insertRow("feedback_threads", row, ["tid"], "dedupe_hash").then(function () { return { tid: row.tid }; });
    },
    getFeedbackThread: function (tid) { return getRow("feedback_threads", "tid", tid); },
    listFeedbackThreads: function (filter, limit) {
      var f = filter || {};
      var where = [], params = [];
      if (f.uid) { where.push("uid = ?"); params.push(String(f.uid)); }
      if (f.deviceId) { where.push("device_id = ?"); params.push(String(f.deviceId)); }
      if (f.status) { where.push("status = ?"); params.push(String(f.status)); }
      var sql = "SELECT * FROM feedback_threads" + (where.length ? " WHERE " + where.join(" AND ") : "")
        + " ORDER BY updated_at DESC LIMIT " + Number(limit || 200);
      return query(sql, params).then(function (rows) { return rows || []; });
    },
    patchFeedbackThread: function (tid, patch) { return patchRow("feedback_threads", "tid", tid, patch, true); },
    deleteFeedbackThread: function (tid) {

      return query("DELETE FROM feedback_threads WHERE tid = ?", [String(tid || "")]).then(function () { return true; });
    },
    countFeedbackThreads: function (filter) {
      var f = filter || {};
      var where = [], params = [];
      if (f.uid) { where.push("uid = ?"); params.push(String(f.uid)); }
      if (f.deviceId) { where.push("device_id = ?"); params.push(String(f.deviceId)); }
      return countByStatus("feedback_threads", where, params, "open");
    },

    putFeedbackComment: function (row) { return insertRow("feedback_comments", row, ["cid"]).then(function () { return { cid: row.cid }; }); },
    getFeedbackComment: function (cid) { return getRow("feedback_comments", "cid", cid); },
    listFeedbackComments: function (filter, limit) {
      var f = filter || {};
      var where = [], params = [];
      if (f.tid) { where.push("tid = ?"); params.push(String(f.tid)); }
      else if (f.tids && f.tids.length) {
        where.push("tid IN (" + f.tids.map(function () { return "?"; }).join(",") + ")");
        f.tids.forEach(function (t) { params.push(String(t)); });
      }
      var sql = "SELECT * FROM feedback_comments" + (where.length ? " WHERE " + where.join(" AND ") : "")
        + " ORDER BY created_at ASC LIMIT " + Number(limit || 2000);
      return query(sql, params).then(function (rows) { return rows || []; });
    },
    deleteFeedbackComment: function (cid) {
      return query("DELETE FROM feedback_comments WHERE cid = ?", [String(cid || "")]).then(function () { return true; });
    },

    putExamRecord: function (row) {
      var stored = Object.assign({}, row, { items: JSON.stringify(row.items === undefined ? [] : row.items) });
      return insertRow("exam_records", stored, ["eid"]).then(function () { return { eid: row.eid }; });
    },
    getExamRecord: function (eid) { return getRow("exam_records", "eid", eid); },
    listExamRecords: function (filter, limit) {
      var f = filter || {};
      var sql = "SELECT * FROM exam_records" + (f.uid ? " WHERE uid = ?" : "")
        + " ORDER BY created_at DESC LIMIT " + Number(limit || 50);
      return query(sql, f.uid ? [String(f.uid)] : []).then(function (rows) { return rows || []; });
    },
    deleteExamRecord: function (eid) {
      return query("DELETE FROM exam_records WHERE eid = ?", [String(eid || "")]).then(function () { return true; });
    },

    putPayOrder: function (row) { return insertRow("pay_orders", row, ["out_trade_no"]); },
    getPayOrder: function (outTradeNo) { return getRow("pay_orders", "out_trade_no", outTradeNo); },
    patchPayOrder: function (outTradeNo, patch) { return patchRow("pay_orders", "out_trade_no", outTradeNo, patch, true); },
    claimPayOrder: function (outTradeNo, fromStatus, patch) {
      var cols = safeCols(nonProto(patch));
      var sets = cols.map(function (c) { return "`" + c + "` = ?"; }).join(", ");
      var values = cols.map(function (c) { return patch[c]; }).concat([String(outTradeNo || ""), String(fromStatus)]);
      return query("UPDATE pay_orders SET " + sets + " WHERE out_trade_no = ? AND status = ?", values)
        .then(function (r) { return Number(r && r.affectedRows) === 1; });
    },
    listPayOrders: function (filter, limit) {
      var f = filter || {};
      var where = [], params = [];
      if (f.uid) { where.push("uid = ?"); params.push(String(f.uid)); }
      if (f.status) { where.push("status = ?"); params.push(String(f.status)); }
      var sql = "SELECT * FROM pay_orders" + (where.length ? " WHERE " + where.join(" AND ") : "")
        + " ORDER BY created_at DESC LIMIT " + Number(limit || 50);
      return query(sql, params).then(function (rows) { return rows || []; });
    },

    putScoreRecord: function (row) {
      return insertRow("score_records", row, ["srid"]).then(function () { return { srid: row.srid }; });
    },
    deleteScoreRecord: function (srid) {
      return query("DELETE FROM score_records WHERE srid = ?", [String(srid || "")]).then(function () { return true; });
    },
    listScoreRecords: function (filter, limit) {
      var f = filter || {};
      var where = [], params = [];
      if (f.uid) { where.push("uid = ?"); params.push(String(f.uid)); }
      if (f.game) { where.push("game = ?"); params.push(String(f.game)); }
      if (f.stage && f.stage !== "all") { where.push("stage = ?"); params.push(String(f.stage)); }
      if (f.grade) { where.push("grade = ?"); params.push(Number(f.grade)); }
      if (f.grade && f.term) { where.push("term = ?"); params.push(Number(f.term)); }
      if (f.from) { where.push("created_at >= ?"); params.push(Number(f.from)); }
      var sql = "SELECT * FROM score_records" + (where.length ? " WHERE " + where.join(" AND ") : "")
        + " ORDER BY created_at DESC LIMIT " + Number(limit || 3000);
      return query(sql, params).then(function (rows) {
        return (rows || []).map(function (r) {
          return {
            srid: String(r.srid || ""),
            uid: String(r.uid || ""),
            game: String(r.game || ""),
            scope_id: String(r.scope_id || ""),
            stage: String(r.stage || ""),
            grade: num(r.grade) || 0,
            term: num(r.term) || 0,
            score: num(r.score) || 0,
            total: num(r.total) || 0,
            duration_sec: num(r.duration_sec) || 0,
            created_at: num(r.created_at) || 0
          };
        });
      });
    },

    putAvatar: function (uid, mime, bytes) {
      return query("INSERT INTO avatars (uid, mime, bytes, updated_at) VALUES (?,?,?,?) "
        + "ON DUPLICATE KEY UPDATE mime = VALUES(mime), bytes = VALUES(bytes), updated_at = VALUES(updated_at)",
        [String(uid || ""), String(mime || ""), bytes, Date.now()])
        .then(function () { return true; });
    },
    getAvatar: function (uid) {
      return query("SELECT mime, bytes FROM avatars WHERE uid = ? LIMIT 1", [String(uid || "")])
        .then(function (rows) {
          var r = rows && rows[0];
          if (!r) return null;
          return { mime: String(r.mime || ""), bytes: Buffer.isBuffer(r.bytes) ? r.bytes : Buffer.from(r.bytes || []) };
        });
    },
    deleteAvatar: function (uid) {
      return query("DELETE FROM avatars WHERE uid = ?", [String(uid || "")])
        .then(function () { return true; });
    },

    getSetting: function (key) {
      return query("SELECT skey, svalue FROM app_settings WHERE skey = ? LIMIT 1", [String(key || "")])
        .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    putSetting: function (key, value) {
      return query("INSERT INTO app_settings (skey, svalue, updated_at) VALUES (?,?,?) "
        + "ON DUPLICATE KEY UPDATE svalue = VALUES(svalue), updated_at = VALUES(updated_at)",
        [String(key || ""), value == null ? null : String(value), Date.now()])
        .then(function () { return { key: key, value: value }; });
    }
  };

  function insertRow(table, row, keyCols, override) {
    var cols = safeCols(row);
    if (!cols.length) return Promise.resolve(row);
    return query(upsertSql(table, cols, keyCols, override), cols.map(function (c) { return row[c]; }))
      .then(function () { return row; });
  }

  function getRow(table, key, val) {
    assertIdent(table); assertIdent(key);
    return query("SELECT * FROM " + table + " WHERE " + key + " = ? LIMIT 1", [String(val || "")])
      .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
  }

  function patchRow(table, key, val, patch, returning) {
    assertIdent(table); assertIdent(key);
    var cols = safeCols(nonProto(patch));
    if (!cols.length) return Promise.resolve(returning ? null : true);
    var values = cols.map(function (c) { return patch[c]; }).concat([String(val || "")]);
    var sets = cols.map(function (c) { return "`" + c + "` = ?"; }).join(", ");
    return query("UPDATE " + table + " SET " + sets + " WHERE " + key + " = ?", values)
      .then(function () { return returning ? getRow(table, key, val) : true; });
  }

  function countByStatus(table, where, params, fallback) {
    var sql = "SELECT status FROM " + table + (where.length ? " WHERE " + where.join(" AND ") : "")
      + " LIMIT 5000";
    return query(sql, params).then(function (rows) {
      var out = { all: 0 };
      (rows || []).forEach(function (r) {
        out.all += 1;
        var st = String((r && r.status) || fallback);
        out[st] = (out[st] || 0) + 1;
      });
      return out;
    });
  }

  return api;
}

module.exports = { mysqlStore: mysqlStore };
