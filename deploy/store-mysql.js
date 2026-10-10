"use strict";

/**
 * 服务端存储层的一个实现：腾讯云 MySQL。
 *
 * 与 `store.js` 里那组 `getX / putX / listX` **同一个形状** —— 方法名逐字相同、
 * 入参与返回也相同。`getStore()` 按环境变量分派到这上面来，路由层一个字都不用改。
 *
 * 为什么单独一个文件、而不是塞进 store.js：
 *
 *   1. 后端代码在 `poem` 仓库，而「用哪台数据库」是**部署选择**（Issue #111）。
 *      放在本仓库的 `deploy/` 下，谁换数据库谁就在这儿改，poem 那边不必认识 MySQL。
 *   2. 它只依赖 mysql2 的**连接池**，不依赖任何 ORM —— 这一层总共就二十来条
 *      语句，引一个 ORM 是给自己加一层要跟着升级的东西。
 *
 * 换库时最容易被写坏的三处，都在下面各自的注释里（照抄 schema 里那条不变式）：
 *
 *   ① **「新的赢」是下沉在数据库层的原子约束**。Postgres 的
 *      `on conflict ... do update ... where excluded.updated_at >= t.updated_at`
 *      在 MySQL 里**没有等价写法** —— 条件是写在 `UPDATE` 的赋值表达式里的
 *      （`IF(VALUES(updated_at) >= updated_at, …)`）。行锁在，所以这一句仍然是
 *      原子的。**不要**改成「先读、比一下、再写」：那有竞态，正是当初把它放进
 *      数据库的原因。
 *   ② `jsonb` → `json`。这里 `payload` 一直整取整存，没有行内 JSON 查询，
 *      所以没影响 —— 但**别顺手加**「按 payload 里某个键筛选」的查询。
 *   ③ `bigint` 的时间戳。`Date.now()` 毫秒，实例化时要显式传
 *      `supportBigNumbers` / `bigNumberStrings: false`，否则某一天会拿到字符串。
 *
 * 见 docs/data-backend.md § 三、`deploy/sql/mysql-schema.sql`。
 */

/** 建表语句见 deploy/sql/mysql-schema.sql；这里只管读写 */

/** 与 PostgREST 版同一套列名，读出来的行也给同一套键名（路由层不认列名，只认这些） */
var ACCOUNT_COLS = ["uid", "email", "email_hash", "nickname", "plan", "plan_until", "role",
  "created_at", "last_login_at", "login_count", "status",
  "email_verified_at", "password_hash", "password_salt", "locked_until"];

var PATCHABLE_ACCOUNT_COLS = ["plan", "plan_until", "role", "last_login_at", "login_count", "nickname",
  "status", "email", "email_verified_at", "password_hash", "password_salt", "locked_until"];

/**
 * 列名：**只让拼进 SQL 的那些名字过这道闸**。
 *
 * 表名与列名拼不进占位符（MySQL 的 `?` 只管值），所以它们只能拼进字符串 ——
 * 那就必须有这道闸。当前每一个调用点传的都是源码里的字面量，但**别靠这个**：
 * 哪天有人把 `Object.keys(body)` 直接递进来（那是很自然的写法），
 * 这里就是一道 SQL 注入。
 *
 * 判据收紧到「合法的 MySQL 标识符」：字母 / 数字 / 下划线，且不长过 64。
 * 认不出的一律**当场抛**，不静默跳过 —— 静默跳过会让「有个字段没写进去」
 * 表现在别处（比如昵称改了但没生效），那要查很久。
 */
var IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function assertIdent(name) {
  if (!IDENT.test(String(name || ""))) {
    throw new Error("不是合法的列名（拒绝拼进 SQL）：" + JSON.stringify(name));
  }
  return String(name);
}

/** 允许的列名白名单 —— 表名与列名要拼进 SQL 字符串，这里绝不收调用方给的名字 */
function pickCols(obj, allowed) {
  var out = {};
  allowed.forEach(function (k) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  });
  return out;
}

/** 取「要写进 SQL 的那批列名」，逐个过标识符闸 */
function safeCols(obj) {
  return Object.keys(obj || {}).map(assertIdent);
}

/** MySQL 的 `ON DUPLICATE KEY UPDATE` 赋值串：`a = VALUES(a), b = VALUES(b)` */
function assignValues(cols, extra) {
  var parts = cols.map(function (c) {
    assertIdent(c);
    return "`" + c + "` = VALUES(`" + c + "`)";
  });
  if (extra) parts.push(extra);
  return parts.join(", ");
}

/**
 * 一条 `INSERT ... ON DUPLICATE KEY UPDATE` 的 upsert，**整表通用**。
 *
 * 没有条件就不带 `IF(...)`：那一列只在 progress 上才有「新的赢」这条约束。
 */
function upsertSql(table, cols, keyCols) {
  assertIdent(table);
  var names = cols.map(function (c) { return "`" + assertIdent(c) + "`"; });
  var marks = cols.map(function () { return "?"; });
  var updatable = cols.filter(function (c) { return keyCols.indexOf(c) < 0; });
  return "INSERT INTO `" + table + "` (" + names.join(",") + ") VALUES (" + marks.join(",") + ")"
    + (updatable.length ? " ON DUPLICATE KEY UPDATE " + assignValues(updatable) : "");
}

function mysqlStore(cfg) {
  /* `cfg.mysql` 就是 `mysql2/promise` 那个连接池（由 `serve-api.js` 建好塞进来的）。
     ⚠️ 别再往下钻一层找 `pool` / `connection`：`mysql2/promise` 的池对象上
     直接有 `query`，多写一层「它到底是池还是库」的判断，只是给自己加一处
     会猜错的地方（这一处第一版就猜错了 —— 判据写的是 `getConnection`，
     而池上那个方法叫 `getConnection` 但直接用 `query` 才对）。 */
  var pool = cfg.mysql || null;
  if (!pool || typeof pool.query !== "function") {
    throw new Error("mysqlStore 需要一个 mysql2/promise 连接池（cfg.mysql.query）");
  }

  function query(sql, params) {
    return Promise.resolve(pool.query(sql, params || [])).then(function (r) {
      // mysql2/promise 回 [rows, fields]；有些实现（与旧版驱动）回单值
      return Array.isArray(r) && r.length === 2 ? r[0] : r;
    });
  }

  /* ⚠️ 驱动默认把超过 2^53 的整数转成字符串（`bigint`），而这里的时间戳是
     `Date.now()` 毫秒。现在远没到那个量级，但**每一处读出来的数都过一遍
     `num()`**，否则某一天会得到「时间戳是字符串」这种要查半天的错。 */
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

    /* ---------------- 账号（accounts） ---------------- */

    getAccountByHash: function (hash) {
      return query("SELECT * FROM accounts WHERE email_hash = ? LIMIT 1", [String(hash || "")])
        .then(function (rows) { return accountRow(rows && rows[0]); });
    },
    getAccount: function (uid) {
      return query("SELECT * FROM accounts WHERE uid = ? LIMIT 1", [String(uid || "")])
        .then(function (rows) { return accountRow(rows && rows[0]); });
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

    /* ---------------- 微信账号（wx_accounts） ----------------
       缺表时驱动抛 `ER_NO_SUCH_TABLE`，由 core 的 isWxAccountsMissing 转成
       503 E_WX_TABLE —— 与换库前同一句话、同一个码。 */

    getWxAccountByOpenid: function (openid) {
      return query("SELECT * FROM wx_accounts WHERE openid = ? LIMIT 1", [String(openid || "")])
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

    /* ---------------- 验证码 / 确认 / 重设（codes / verifications / resets） ---------------- */

    putCode: function (rec) {
      return insertRow("codes", rec, ["code_id"]);
    },
    getCode: function (codeId) {
      return query("SELECT * FROM codes WHERE code_id = ? LIMIT 1", [String(codeId || "")])
        .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
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

    /* ---------------- 会话（sessions） ----------------
       refresh_token 那一列不在建表语句的「标准形状」里（poem 的 schema 也没有），
       它是微信登录刷新那条路要的。加一列、且 `PUT` 时不带它就退回不带 ——
       与换库前 `wxIssueSession` 里那段 catch 是同一件事。 */

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

    /* ---------------- 进度（progress）：条件 upsert 在这儿 ---------------- */

    listProgress: function (uid, child, since) {
      var cid = child == null ? "" : String(child);
      var sql = "SELECT poem_id, payload, updated_at, deleted FROM progress WHERE uid = ? AND child_id = ?";
      var params = [String(uid || ""), cid];
      if (since) {
        sql += " AND updated_at > ?";
        params.push(Number(since));
      }
      return query(sql, params).then(function (rows) { return (rows || []).map(progressRow); });
    },

    /**
     * ⚠️ **这一段是整个存储层唯一不能「等价改写」的地方。**
     *
     * Postgres 的条件 upsert：
     *   on conflict (uid, child_id, poem_id) do update
     *      set payload = excluded.payload, …
     *    where excluded.updated_at >= progress.updated_at
     *
     * MySQL 的 `ON DUPLICATE KEY UPDATE` **没有 `WHERE`** —— 条件只能写进赋值
     * 表达式里，而且必须**逐列都写**：只给 payload 加 `IF(...)`、把 updated_at
     * 无条件盖上去，就会出现「payload 是旧的、updated_at 是新的」这种一半新一半旧
     * 的行，下一次同步时它还会把真正的新值顶掉。
     *
     *   payload    = IF(VALUES(updated_at) >= updated_at, VALUES(payload), payload)
     *   updated_at = GREATEST(updated_at, VALUES(updated_at))     ← 只增不减
     *   deleted    = IF(VALUES(updated_at) >= updated_at, VALUES(deleted), deleted)
     *
     * 行锁在，所以这一句仍然是原子的 —— 与原来那条约束等价。
     *
     * ⚠️ `VALUES(col)` 在 MySQL 8.0.20 起被标记为过时（8.4 仍能用，只是警告）；
     * 替换写法是 `AS new` + `new.col`。这里保留 `VALUES()`：它从 5.7 起就可用，
     * 而云托管那台 MySQL 的版本不一定在 8.0.20 以上。哪天整个迁到 8.4+，
     * 再把这一句换成 `AS new ON DUPLICATE KEY UPDATE payload = IF(new.updated_at >= updated_at, new.payload, payload) …`
     */
    putProgress: function (uid, child, recs) {
      var cid = child == null ? "" : String(child);
      var rows = (recs || []).map(function (r) {
        return [String(uid || ""), cid, String(r.poem_id), JSON.stringify(r.payload === undefined ? {} : r.payload),
          Number(r.updated_at) || 0, r.deleted ? 1 : 0];
      });
      if (!rows.length) return Promise.resolve(true);

      var SQL = ""
        + "INSERT INTO `progress` (`uid`,`child_id`,`poem_id`,`payload`,`updated_at`,`deleted`) VALUES "
        + rows.map(function () { return "(?,?,?,?,?,?)"; }).join(",")
        + " ON DUPLICATE KEY UPDATE "
        + "`payload`    = IF(VALUES(`updated_at`) >= `updated_at`, VALUES(`payload`), `payload`), "
        + "`updated_at` = GREATEST(`updated_at`, VALUES(`updated_at`)), "
        + "`deleted`    = IF(VALUES(`updated_at`) >= `updated_at`, VALUES(`deleted`), `deleted`)";

      var params = [];
      rows.forEach(function (r) { params = params.concat(r); });
      return query(SQL, params).then(function () { return true; });
    },

    deleteProgress: function (uid) {
      return query("DELETE FROM progress WHERE uid = ?", [String(uid || "")]).then(function () { return true; });
    },

    /* ---------------- 报告 / 勘误 / 反馈 / 考试（网页版的事，形状照旧） ---------------- */

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

    putFeedbackThread: function (row) { return insertRow("feedback_threads", row, ["tid"]).then(function () { return { tid: row.tid }; }); },
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
      // feedback_comments 的外键是 ON DELETE CASCADE，删主题即连带删跟帖
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

    putExamRecord: function (row) { return insertRow("exam_records", row, ["eid"]).then(function () { return { eid: row.eid }; }); },
    getExamRecord: function (eid) { return getRow("exam_records", "eid", eid); },
    listExamRecords: function (filter, limit) {
      var f = filter || {};
      var sql = "SELECT * FROM exam_records" + (f.uid ? " WHERE uid = ?" : "")
        + " ORDER BY created_at DESC LIMIT " + Number(limit || 50);
      return query(sql, f.uid ? [String(f.uid)] : []).then(function (rows) { return rows || []; });
    },
    deleteExamRecord: function (eid) {
      return query("DELETE FROM exam_records WHERE eid = ?", [String(eid || "")]).then(function () { return true; });
    }
  };

  /* 下面三个小工具只为消掉重复：每一张表的 insert / get / patch 长得一模一样 */

  function insertRow(table, row, keyCols) {
    var cols = safeCols(row);
    if (!cols.length) return Promise.resolve(row);
    return query(upsertSql(table, cols, keyCols), cols.map(function (c) { return row[c]; }))
      .then(function () { return row; });
  }

  function getRow(table, key, val) {
    assertIdent(table); assertIdent(key);
    return query("SELECT * FROM " + table + " WHERE " + key + " = ? LIMIT 1", [String(val || "")])
      .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
  }

  function patchRow(table, key, val, patch, returning) {
    assertIdent(table); assertIdent(key);
    var cols = safeCols(patch);
    if (!cols.length) return Promise.resolve(returning ? null : true);
    var sets = cols.map(function (c) { return "`" + c + "` = ?"; }).join(", ");
    if (!returning) {
      return query("UPDATE " + table + " SET " + sets + " WHERE " + key + " = ?",
        cols.map(function (c) { return patch[c]; }).concat([String(val || "")])).then(function () { return true; });
    }
    // patch 完再读一条出来 —— 与 PostgREST 的 return=representation 同一件事
    return query("UPDATE " + table + " SET " + sets + " WHERE " + key + " = ?",
      cols.map(function (c) { return patch[c]; }).concat([String(val || "")]))
      .then(function () { return getRow(table, key, val); });
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
