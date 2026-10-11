"use strict";

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
      try { row[c] = JSON.parse(row[c]); } catch (e) { }
    }
  });
  return row;
}

function applyOnDuplicateKey(table, sql, cur, vals) {
  const m = /ON DUPLICATE KEY UPDATE\s+([\s\S]+)$/i.exec(sql);
  if (!m) return cur;

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

    const ifM = /^IF\(\s*VALUES\(`?updated_at`?\)\s*(>=|>)\s*`?updated_at`?\s*,\s*VALUES\(`?([a-z_]+)`?\)\s*,\s*`?([a-z_]+)`?\s*\)$/i.exec(expr);
    if (ifM) {
      const op = ifM[1];
      const take = op === ">=" ? vals.updated_at >= cur.updated_at : vals.updated_at > cur.updated_at;
      cur[col] = take ? vals[ifM[2]] : cur[ifM[3]];
      return;
    }

    const gM = /^GREATEST\(\s*`?updated_at`?\s*,\s*VALUES\(`?updated_at`?\)\s*\)$/i.exec(expr);
    if (gM) {
      cur[col] = Math.max(cur.updated_at, vals.updated_at);
      return;
    }

    const vM = /^VALUES\(`?([a-z_]+)`?\)$/i.exec(expr);
    if (vM) {
      cur[col] = vals[vM[1]];
      return;
    }

  });
  return cur;
}

function whereOf(sql) {
  const m = /\bWHERE\s+([\s\S]*?)(?:\s+ORDER\s+BY|\s+LIMIT|$)/i.exec(sql);
  return m ? m[1].trim() : "";
}

function whereTerms(sql) {
  const w = whereOf(sql);
  if (!w) return [];

  return w.split(/\s+AND\s+/i).map((t) => t.trim()).filter(Boolean);
}

function testTerm(row, term, params) {

  let m = /^`?([a-z_0-9]+)`?\s*=\s*\?$/i.exec(term);
  if (m) return String(row[m[1]]) === String(params.shift());

  m = /^`?([a-z_0-9]+)`?\s*>\s*\?$/i.exec(term);
  if (m) {
    const v = params.shift();
    const a = Number(row[m[1]]);
    const b = Number(v);
    if (!isFinite(a) || !isFinite(b)) return false;
    return a > b;
  }

  m = /^`?([a-z_0-9]+)`?\s+IS\s+(NOT\s+)?NULL$/i.exec(term);
  if (m) return m[2] ? row[m[1]] != null : row[m[1]] == null;

  m = /^`?([a-z_0-9]+)`?\s+IN\s*\((\?[,\s?]*)\)$/i.exec(term);
  if (m) {
    const n = (m[2].match(/\?/g) || []).length;
    const vals = params.splice(0, n).map(String);
    return vals.indexOf(String(row[m[1]])) >= 0;
  }
  return false;
}

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
