"use strict";

/**
 * 一个「够用的假 MySQL」—— 只在内存里维护几张表，认 `store-mysql.js` 发出的
 * 那几条语句形状。给 `scripts/e2e-mysql.js` 当 `mysql2/promise` 用。
 *
 * ⚠️ **它不验 SQL 语法，也验不了。** 它验的是三件事：
 *
 *   ① 语句的形状对不对（表名 / 列名 / 占位符个数）—— 形状错就查不出行
 *   ② `ON DUPLICATE KEY UPDATE` 那段**赋值语义**：它把 `IF(VALUES(updated_at) >= updated_at, …)`
 *      与 `GREATEST(updated_at, VALUES(updated_at))` 逐字实现了 —— 这不是复刻 MySQL，
 *      是复刻**那一条语句**，正是「新的赢」这条不变式所在
 *   ③ 主键是 (uid, child_id, poem_id) 这件事（键拼错一位，条件 upsert 就变成
 *      「每来一条插一行新的」，而数据看着还在）
 *
 * 真的 MySQL 要等部署到云托管才跑得到（那一步是运维动作）；
 * 这一层守的是「代码与语句都没写歪」，而不是「云托管那台库配好了」。
 */

const db = {
  accounts: new Map(),
  wx_accounts: new Map(),
  sessions: new Map(),
  codes: new Map(),
  verifications: new Map(),
  resets: new Map(),
  reports: new Map(),
  pinyin_proposals: new Map(),
  feedback_threads: new Map(),
  feedback_comments: new Map(),
  exam_records: new Map(),
  progress: new Map()
};

/** 每张表的主键列 —— 键拼错一位，条件 upsert 就退化成「每来一条插一行」 */
const PK = {
  accounts: ["uid"],
  wx_accounts: ["uid"],
  sessions: ["sid"],
  codes: ["code_id"],
  verifications: ["vid"],
  resets: ["rid"],
  reports: ["rid"],
  pinyin_proposals: ["fid"],
  feedback_threads: ["tid"],
  feedback_comments: ["cid"],
  exam_records: ["eid"],
  progress: ["uid", "child_id", "poem_id"]
};

/** 这几列是 JSON，进出都要过一遍 —— 与真 MySQL 的 json 列同口径 */
const JSON_COLS = { progress: ["payload"], exam_records: ["items"] };

function tableName(sql) {
  const m = /^\s*(?:SELECT[\s\S]*?\bFROM|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?([a-z_]+)`?/i.exec(sql);
  return m ? m[1] : "";
}

function columnsOf(sql) {
  const m = /\(([^)]+)\)\s*VALUES/i.exec(sql);
  return m ? m[1].split(",").map((c) => c.replace(/[`\s]/g, "")) : [];
}

function keyOf(table, row) {
  return (PK[table] || ["__none"]).map((c) => String(row[c] === undefined ? "" : row[c])).join("\u0000");
}

/** 有主键就用主键当 Map 的键，没有就按插入顺序编号 */
function put(table, row) {
  const pk = PK[table];
  if (pk) {
    db[table].set(keyOf(table, row), row);
    return 1;
  }
  db[table].set("__row" + db[table].size, row);
  return 1;
}

function normalize(table, row) {
  const jc = JSON_COLS[table] || [];
  jc.forEach((c) => {
    if (typeof row[c] === "string") {
      try { row[c] = JSON.parse(row[c]); } catch (e) { /* 保持原样 */ }
    }
  });
  return row;
}

/**
 * ⚠️ 这一段是这份替身存在的全部理由。
 *
 * `store-mysql.js` 的 `putProgress` 拼出来的那句形如：
 *
 *   ON DUPLICATE KEY UPDATE
 *     `payload`    = IF(VALUES(`updated_at`) >= `updated_at`, VALUES(`payload`), `payload`),
 *     `updated_at` = GREATEST(`updated_at`, VALUES(`updated_at`)),
 *     `deleted`    = IF(VALUES(`updated_at`) >= `updated_at`, VALUES(`deleted`), `deleted`)
 *
 * 这里把**这三个赋值**按字面解出来执行 —— 不是「大概照着做」：
 * 赋值串里的条件与取哪个值都是从 SQL 里读的。所以：
 *   · 把 `>=` 改成 `>`  → 同一毫秒那一条会红
 *   · 把 GREATEST 改成 VALUES → 「旧的不顶时间戳」那一条会红
 *   · 少写一列的条件   → 「旧的删除标记不许盖新的进度」那一条会红
 */
function applyOnDuplicateKey(table, sql, cur, vals) {
  const m = /ON DUPLICATE KEY UPDATE\s+([\s\S]+)$/i.exec(sql);
  if (!m) return cur;
  /* ⚠️ 拆赋值**不能**用 `split(/,\s*(?=`)/)`：那条正则会在 `IF(a, b, c)` 里
     那个逗号上也切一刀（第一版就是这么写的，于是 `payload` 那条只执行了半句 ——
     症状恰好是「updated_at 前进了、payload 没动」，也就是这条替身本该抓住的那类
     坏行）。正确做法是按**括号深度**切：深度为 0 的逗号才是赋值之间的那个。 */
  const body = m[1];
  const assigns = [];
  {
    let depth = 0;
    let cur = "";
    for (let i = 0; i < body.length; i += 1) {
      const ch = body[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) { assigns.push(cur); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) assigns.push(cur);
  }

  assigns.forEach((seg) => {
    const colM = /^\s*`?([a-z_]+)`?\s*=\s*([\s\S]+)$/i.exec(seg.trim().replace(/,\s*$/, ""));
    if (!colM) return;
    const col = colM[1];
    const expr = colM[2].trim();

    // IF(VALUES(updated_at) >= updated_at, VALUES(x), x)
    const ifM = /^IF\(\s*VALUES\(`?updated_at`?\)\s*(>=|>)\s*`?updated_at`?\s*,\s*VALUES\(`?([a-z_]+)`?\)\s*,\s*`?([a-z_]+)`?\s*\)$/i.exec(expr);
    if (ifM) {
      const op = ifM[1];
      const take = op === ">=" ? vals.updated_at >= cur.updated_at : vals.updated_at > cur.updated_at;
      cur[col] = take ? vals[ifM[2]] : cur[ifM[3]];
      return;
    }
    // GREATEST(updated_at, VALUES(updated_at))
    const gM = /^GREATEST\(\s*`?updated_at`?\s*,\s*VALUES\(`?updated_at`?\)\s*\)$/i.exec(expr);
    if (gM) {
      cur[col] = Math.max(cur.updated_at, vals.updated_at);
      return;
    }
    // 裸 VALUES(x)：无条件盖上去 —— 正是「一半新一半旧」那条坏行
    const vM = /^VALUES\(`?([a-z_]+)`?\)$/i.exec(expr);
    if (vM) {
      cur[col] = vals[vM[1]];
      return;
    }
    // 认不出的写法：不猜，留着不动，并由 e2e 那条用例暴露出来
  });
  return cur;
}

/**
 * WHERE 求值：只认 `store-mysql.js` 真会写的那几种（`= ?`、`> ?`、`IS NULL`、
 * `IN (?,?,…)`），**条件与参数一一对应**地求值 —— 不做「猜哪个参数配哪一列」
 * 那套（第一版就是那样，于是 `updated_at > ?` 被当成「有一列等于 1500」，
 * 增量拉取永远回空，而那条断言恰好是它该抓住的）。
 *
 * ⚠️ 认不出的条件**判为不命中**，不静默放行 —— 放行会让「少过滤」这件事
 * 看不见（多回了几行），而少过滤与「过滤写歪了」在数据上长得一样。
 */
function whereOf(sql) {
  const m = /\bWHERE\s+([\s\S]*?)(?:\s+ORDER\s+BY|\s+LIMIT|$)/i.exec(sql);
  return m ? m[1].trim() : "";
}

function whereTerms(sql) {
  const w = whereOf(sql);
  if (!w) return [];
  // 只按 AND 切（store-mysql 的 WHERE 全是 AND 连起来的）
  return w.split(/\s+AND\s+/i).map((t) => t.trim()).filter(Boolean);
}

function testTerm(row, term, params) {
  // `col = ?`
  let m = /^`?([a-z_0-9]+)`?\s*=\s*\?$/i.exec(term);
  if (m) return String(row[m[1]]) === String(params.shift());
  // `col > ?`
  m = /^`?([a-z_0-9]+)`?\s*>\s*\?$/i.exec(term);
  if (m) {
    const v = params.shift();
    const a = Number(row[m[1]]);
    const b = Number(v);
    if (!isFinite(a) || !isFinite(b)) return false;
    return a > b;
  }
  // `col IS NULL` / `col IS NOT NULL`
  m = /^`?([a-z_0-9]+)`?\s+IS\s+(NOT\s+)?NULL$/i.exec(term);
  if (m) return m[2] ? row[m[1]] != null : row[m[1]] == null;
  // `col IN (?, ?, …)`
  m = /^`?([a-z_0-9]+)`?\s+IN\s*\((\?[,\s?]*)\)$/i.exec(term);
  if (m) {
    const n = (m[2].match(/\?/g) || []).length;
    const vals = params.splice(0, n).map(String);
    return vals.indexOf(String(row[m[1]])) >= 0;
  }
  return false; // 认不出的条件：不命中（不静默放行）
}

/** 一行是否命中这条语句的 WHERE —— params 会被按条件顺序消费掉 */
function hits(row, sql, params) {
  const terms = whereTerms(sql);
  if (!terms.length) return true;
  const p = params.slice();
  return terms.every((t) => testTerm(row, t, p));
}

const facade = {
  _db: db,
  _log: [],

  createPool() {
    return {
      query(sql, params) {
        params = params || [];
        facade._log.push({ sql: sql.replace(/\s+/g, " ").trim(), params: params.slice() });
        const t = tableName(sql);

        if (/^\s*SELECT/i.test(sql)) {
          const all = t ? [...db[t].values()] : [];
          const hit = all.filter((r) => hits(r, sql, params));
          // LIMIT 1 这类：回一条
          return Promise.resolve([hit.length ? [hit[0]] : [], []]);
        }

        if (/^\s*INSERT\s+INTO/i.test(sql)) {
          const cols = columnsOf(sql);
          const perRow = cols.length;
          const n = perRow ? Math.floor(params.length / perRow) : 0;
          for (let i = 0; i < n; i += 1) {
            const vals = {};
            cols.forEach((c, k) => { vals[c] = params[i * perRow + k]; });
            normalize(t, vals);
            const key = keyOf(t, vals);
            const cur = db[t] ? db[t].get(key) : null;
            if (cur) db[t].set(key, applyOnDuplicateKey(t, sql, cur, vals));
            else put(t, vals);
          }
          return Promise.resolve([{ affectedRows: n }, []]);
        }

        if (/^\s*UPDATE/i.test(sql)) {
          const all = t ? [...db[t].values()] : [];
          all.forEach((r) => { if (hits(r, sql, params)) Object.assign(r, {}); });
          return Promise.resolve([{ affectedRows: all.length }, []]);
        }

        if (/^\s*DELETE/i.test(sql)) {
          const all = t ? [...db[t].entries()] : [];
          let n = 0;
          all.forEach(([k, r]) => { if (hits(r, sql, params)) { db[t].delete(k); n += 1; } });
          return Promise.resolve([{ affectedRows: n }, []]);
        }

        return Promise.resolve([[], []]);
      },
      getConnection() { return this; },
      release() {}
    };
  }
};

module.exports = facade;
