const store = require("./store");
const R = require("./review-models");

const READ_ROW = {
  poems: "poem_poems_read_v1",
  classic: "poem_classic_read_v1",
  yuefu: "poem_yuefu_read_v1",
  tangshi: "poem_tangshi_read_v1",
  gushi: "poem_gushi_read_v1",
  songci: "poem_songci_read_v1",
  guwen: "poem_guwen_read_v1",
  zhaoming: "poem_zhaoming_read_v1",
  yuanqu: "poem_yuanqu_read_v1",
  jinxiandai: "poem_jinxiandai_read_v1",
  chengyu: "poem_chengyu_read_v1",
  changshi: "poem_changshi_read_v1",
  mingshu: "poem_mingshu_read_v1",
  mingren: "poem_mingren_cn_read_v1",
  "mingren-waiguo": "poem_mingren_foreign_read_v1",
  dwang: "poem_dwang_cn_read_v1",
  "dwang-waiguo": "poem_dwang_foreign_read_v1"
};

const ROW_BOOK = {};
Object.keys(READ_ROW).forEach((k) => {
  ROW_BOOK[READ_ROW[k]] = k;
});

const DAILY_EXTRA_ROW = "daily_extra:v1";
const DEFER_ROW = "defer:v1";
const PINYIN_FIX_ROW = "pinyin_fix:v1";
const COLLECTIONS_ROW = "collections:v1";

const SETTINGS_ROW = "settings:v1";

const RECORD_ROW = "progress";

const READ_PREFIX = "reads:";

function clone(v) {
  try {
    return JSON.parse(JSON.stringify(v === undefined ? null : v));
  } catch (e) {
    return null;
  }
}

const NUM_FIELDS = {
  level: [0, 99],
  box: [0, 99],
  interval: [0, 100000],
  reps: [0, 100000],
  reviewCount: [0, 100000],
  lapses: [0, 100000]
};

const REAL_FIELDS = {
  ef: [1, 10],
  stability: [0, 100000],
  difficulty: [0, 100]
};

const TIME_FIELDS = ["nextReviewAt", "lastReviewAt"];

function slimRecord(rec) {
  const out = {};
  if (!rec || typeof rec !== "object") return out;
  Object.keys(NUM_FIELDS).forEach((k) => {
    if (typeof rec[k] !== "number" || !isFinite(rec[k])) return;
    const lo = NUM_FIELDS[k][0];
    const hi = NUM_FIELDS[k][1];
    out[k] = Math.max(lo, Math.min(hi, Math.round(rec[k])));
  });
  Object.keys(REAL_FIELDS).forEach((k) => {
    if (typeof rec[k] !== "number" || !isFinite(rec[k])) return;
    const lo = REAL_FIELDS[k][0];
    const hi = REAL_FIELDS[k][1];
    out[k] = Math.max(lo, Math.min(hi, Math.round(rec[k] * 100) / 100));
  });
  TIME_FIELDS.forEach((k) => {
    if (typeof rec[k] !== "number" || !isFinite(rec[k])) return;
    out[k] = Math.max(0, Math.round(rec[k]));
  });
  if (typeof rec.learned === "boolean") out.learned = rec.learned;
  if (typeof rec.attempted === "boolean") out.attempted = rec.attempted;
  if (typeof rec.algo === "string" && /^[a-z0-9]{1,16}$/.test(rec.algo)) out.algo = rec.algo;
  if (typeof rec.reviewedOn === "string" && /^\d{4}-\d{1,2}-\d{1,2}$/.test(rec.reviewedOn)) {
    out.reviewedOn = rec.reviewedOn;
  }
  if (Array.isArray(rec.history)) {
    out.history = rec.history
      .slice(-200)
      .map((h) => {
        if (!h || typeof h !== "object") return null;
        const r = {};
        if (typeof h.at === "number") r.at = Math.round(h.at);
        if (typeof h.level === "number") r.level = Math.round(h.level);
        if (h.result === "good" || h.result === "fuzzy" || h.result === "bad") r.result = h.result;
        return r;
      })
      .filter(Boolean);
  }
  return out;
}

const BOOK_IDS = Object.keys(READ_ROW).sort((a, b) => b.length - a.length);

function bookOf(id) {
  const s = String(id == null ? "" : id);
  return BOOK_IDS.filter((k) => s.indexOf(k + "-") === 0)[0] || "";
}

function recordStamp(rec) {
  return Number((rec && (rec.lastReviewAt || rec.updatedAt)) || 0);
}

function latestAt(marks) {
  let at = 0;
  Object.keys(marks || {}).forEach((id) => {
    if (Number((marks[id] || {}).at) > at) at = Number(marks[id].at);
  });
  return at;
}

function advanceRecord(rec, due, key, now) {
  if (!key || rec.algo !== key || !Number(rec.nextReviewAt) || rec.nextReviewAt > due) return null;
  const next = R.review(Object.assign({}, rec, { nextReviewAt: 0 }), "good", key, due);
  next.lastReviewAt = now;
  next.reviewedOn = R.dayStamp(now);
  next.nextReviewAt = R.dayAt(now, R.daysFor(key, next));
  return next;
}

function keepRecordEdge(id, rec) {
  const book = bookOf(id);
  if (!book) return;
  const at = Math.max(recordStamp(rec), Number((store.reads(book) || {})[id]) || 0);
  store.keepProgressEdge(book, id, at);
}

function mergeMark(slim, edge) {
  const out = {};
  Object.keys(slim).forEach((id) => { out[id] = { at: slim[id].at, times: slim[id].times }; });
  Object.keys(edge || {}).forEach((id) => {
    const a = Number(edge[id] && edge[id].at) || 0;
    const t = Number(edge[id] && edge[id].times) || 0;
    if (!out[id] || a > out[id].at) out[id] = { at: a, times: t };
  });
  return out;
}

function packRecords() {
  const rows = [];
  const advanced = [];

  const progress = store.progress();
  const reads = store.reads();
  const readEdges = {};
  const list = Object.keys(progress).map((id) => ({ id: id, rec: progress[id] })).filter((it) => recordStamp(it.rec));

  list.forEach((it) => {
    const book = bookOf(it.id);
    if (!book) return;
    readEdges[book] = readEdges[book] || {};
    readEdges[book][it.id] = Math.max(Number((reads[book] || {})[it.id]) || 0, recordStamp(it.rec));
  });

  list.forEach((it) => {
    const book = bookOf(it.id);
    const mark = Number((reads[book] || {})[it.id]) || 0;
    const at = Math.max(recordStamp(it.rec), mark);
    const now = Date.now();
    const next = advanceRecord(it.rec, at, store.settings().algo, now);
    if (!next) {
      rows.push({ id: it.id, payload: slimRecord(it.rec), updatedAt: recordStamp(it.rec), deleted: false });
      return;
    }
    if (book) readEdges[book][it.id] = Math.max(readEdges[book][it.id] || 0, next.lastReviewAt);
    const payload = slimRecord(next);
    rows.push({ id: it.id, payload, updatedAt: next.lastReviewAt, deleted: false });
    advanced.push({ id: it.id, rec: Object.assign({}, payload, { updatedAt: next.lastReviewAt }) });
  });

  const edgeFrom = store.progressEdge();
  const readEdgeFrom = store.readsEdge();
  Object.keys(READ_ROW).forEach((book) => {
    const rowId = READ_ROW[book];
    const local = reads[book] || {};
    const marks = {};
    Object.keys(local).forEach((id) => {
      const ts = Number(local[id]) || 0;
      if (!ts) return;
      marks[id] = { at: ts, times: 1 };
    });
    Object.keys(readEdges[book] || {}).forEach((id) => {
      const ts = Number(readEdges[book][id]) || 0;
      if (!ts) return;
      marks[id] = { at: Math.max(ts, Number((marks[id] || {}).at) || 0), times: 1 };
    });
    Object.keys(readEdgeFrom[book] || {}).forEach((id) => {
      const ts = Number(readEdgeFrom[book][id]) || 0;
      if (!ts || ts <= (Number((marks[id] || {}).at) || 0)) return;
      marks[id] = { at: ts, times: 1 };
    });
    Object.keys(edgeFrom[book] || {}).forEach((id) => {
      if (marks[id]) return;
      marks[id] = edgeFrom[book][id];
    });
    const at = latestAt(marks);
    if (!at) return;
    rows.push({
      id: READ_PREFIX + rowId,
      payload: { v: 1, updatedAt: at, marks: marks },
      updatedAt: at,
      deleted: false
    });
  });

  const extra = store.dailyExtra().slice();
  if (extra.length) {
    const at = store.dailyExtraAt() || Date.now();
    rows.push({
      id: DAILY_EXTRA_ROW,
      payload: {
        v: 1,
        date: store.dayKey(),
        items: extra.map((id) => ({ id: id, wid: id, entryId: id, at: at })),
        updatedAt: at
      },
      updatedAt: at,
      deleted: false
    });
  }

  const cols = clone(store.collections());
  const colsAt = store.collectionsAt();
  if (colsAt) {
    rows.push({
      id: COLLECTIONS_ROW,
      payload: { v: 1, collections: cols, updatedAt: colsAt },
      updatedAt: colsAt,
      deleted: false
    });
  }

  const sAt = store.settingsAt();
  if (sAt) {
    rows.push({
      id: SETTINGS_ROW,
      payload: { v: 1, settings: clone(store.cloudSettings()), updatedAt: sAt },
      updatedAt: sAt,
      deleted: false
    });
  }

  const cleared = store.clearMarks();
  const goneAt = cleared.at || Date.now();
  cleared.rows.forEach((r) => {
    if (!r || !r.id) return;
    rows.push({ id: String(r.id), payload: {}, updatedAt: Number(r.updatedAt) || goneAt, deleted: true });
  });
  cleared.books.forEach((book) => {
    const rowId = READ_ROW[book];
    if (rowId) rows.push({ id: READ_PREFIX + rowId, payload: {}, updatedAt: goneAt, deleted: true });
  });
  const deferAt = store.deferAt();
  if (deferAt) {
    rows.push({
      id: DEFER_ROW,
      payload: { v: 1, updatedAt: deferAt, items: clone(store.deferList()) },
      updatedAt: deferAt,
      deleted: false
    });
  }

  const pinyinAt = store.pinyinFixAt();
  if (pinyinAt) {
    rows.push({
      id: PINYIN_FIX_ROW,
      payload: { v: 1, updatedAt: pinyinAt, fixes: clone(store.pinyinFixes()) },
      updatedAt: pinyinAt,
      deleted: false
    });
  }

  if (cleared.dailyExtra) {
    rows.push({ id: DAILY_EXTRA_ROW, payload: {}, updatedAt: goneAt, deleted: true });
  }

  if (advanced.length) store.setRecords(advanced);
  touchPushed(rows);
  return rows;
}

function touchPushed(rows) {
  const at = Date.now();
  (rows || []).forEach((r) => {
    if (r && !r.deleted && /^[^:]+:[^:]+:/.test(String(r.id || ""))) store.touchDayPlan(at);
  });
}

function clearRecords(rows) {
  const sent = new Set();
  (rows || []).forEach((r) => {
    if (r && r.deleted && r.id) sent.add(String(r.id));
  });
  if (!sent.size) return;

  const box = store.clearMarks();
  const rowsLeft = box.rows.filter((r) => !sent.has(String(r.id)));
  const booksLeft = box.books.filter((book) => !sent.has(READ_PREFIX + READ_ROW[book]));
  const extraLeft = box.dailyExtra && !sent.has(DAILY_EXTRA_ROW);

  if (!rowsLeft.length && !booksLeft.length && !extraLeft) store.dropClearMarks();
  else store.saveClearMarks({ at: box.at, rows: rowsLeft, books: booksLeft, dailyExtra: extraLeft });
}

function clearedIds() {
  const box = store.clearMarks();
  const set = new Set();
  box.rows.forEach((r) => { if (r && r.id) set.add(String(r.id)); });
  box.books.forEach((book) => {
    if (READ_ROW[book]) set.add(READ_PREFIX + READ_ROW[book]);
  });
  if (box.dailyExtra) set.add(DAILY_EXTRA_ROW);
  return set;
}

function applyRecords(recs) {
  let applied = 0;
  const progress = store.progress();
  const reads = store.reads();
  const now = Date.now();
  const mine = clearedIds();
  const clearAt = store.clearMarks().at || 0;
  const readEdges = store.progressEdge();

  (recs || []).forEach((row) => {
    if (!row || !row.id) return;
    const at = Number(row.updatedAt) || 0;
    const id = String(row.id);

    if (mine.has(id) && at < clearAt) return;

    if (id.indexOf(READ_PREFIX) === 0) {
      const book = ROW_BOOK[id.slice(READ_PREFIX.length)];
      if (!book) return;
      if (row.deleted) {
        if (reads[book]) {
          delete reads[book];
          applied += 1;
        }
        return;
      }
      const marks = (row.payload && row.payload.marks) || {};
      const box = reads[book] || (reads[book] = {});
      Object.keys(marks).forEach((pid) => {
        const ts = Number((marks[pid] && marks[pid].at) || 0) || at;
        if (!ts) return;

        if (!box[pid] || ts > box[pid]) {
          box[pid] = ts;
          applied += 1;
        }
      });
      readEdges[book] = mergeMark(marks, readEdges[book]);
      return;
    }

    if (id === DAILY_EXTRA_ROW) {
      const payload = row.payload || {};
      const localAt = store.dailyExtraAt() || 0;

      if (row.deleted) {
        if (at > localAt) {
          store.clearDailyExtra();
          applied += 1;
        }
        return;
      }

      if (at > localAt && payload.date === store.dayKey()) {
        store.setDailyExtra((payload.items || []).map((it) => it.id).filter(Boolean), at);
        applied += 1;
      }
      return;
    }

    if (id === SETTINGS_ROW) {
      const payload = row.payload || {};
      const localAt = store.settingsAt() || 0;

      if (at > localAt && payload.settings && typeof payload.settings === "object") {
        store.replaceSettings(payload.settings);
        store.touchSettings(at);
        applied += 1;
      }

      if (Number(payload.settings && payload.settings.dailyCount) !== Number(store.settings().dailyCount)) {
        store.dropDayPlan();
      }
      return;
    }

    if (id === DEFER_ROW) {
      if (at <= store.deferAt()) return;
      store.setDefer((row.payload && row.payload.items) || [], at);
      applied += 1;
      return;
    }

    if (id === PINYIN_FIX_ROW) {
      if (at <= store.pinyinFixAt()) return;
      store.setPinyinFixes((row.payload && row.payload.fixes) || [], at);
      applied += 1;
      return;
    }

    if (id === COLLECTIONS_ROW) {
      const payload = row.payload || {};
      const localAt = store.collectionsAt() || 0;
      if (at > localAt && Array.isArray(payload.collections)) {
        store.saveCollections(payload.collections, at);
        applied += 1;
        return;
      }
      if (at !== localAt || !Array.isArray(payload.collections)) return;
      const merged = mergeCollections(store.collections(), payload.collections);
      if (merged.changed) {
        store.saveCollections(merged.list, at);
        applied += 1;
      }
      return;
    }

    const payload = row.payload;
    if (!payload || typeof payload !== "object") return;
    const old = progress[id];
    const oldAt = recordStamp(old);
    if (row.deleted) {
      if (old && at >= oldAt) {
        delete progress[id];
        store.dropProgressEdge(bookOf(id), id);
        applied += 1;
      }
      return;
    }
    if (old && at <= oldAt) return;

    if (at > oldAt) {
      progress[id] = Object.assign({}, payload, { lastReviewAt: at, updatedAt: at, syncedAt: now });
      applied += 1;
    }
  });

  Object.keys(progress).forEach((id) => {
    const rec = progress[id];
    const book = bookOf(id);
    if (!book || !rec || !rec.learned) return;
    const at = recordStamp(rec);
    if (!at) return;
    const box = reads[book] || (reads[book] = {});
    if (!box[id] || box[id] < at) {
      box[id] = at;
      applied += 1;
    }
    readEdges[book] = mergeMark({ [id]: { at: at, times: 1 } }, readEdges[book]);
  });

  store.write(store.KEYS.progress, progress);
  store.write(store.KEYS.reads, reads);
  store.replaceProgressEdge(readEdges);
  return applied;
}

function mergeCollections(local, remote) {
  const mine = Array.isArray(local) ? local : [];
  const theirs = Array.isArray(remote) ? remote : [];
  const byId = {};
  const order = [];
  mine.forEach((c) => {
    if (!c || !c.id) return;
    byId[c.id] = c;
    order.push(c.id);
  });
  let changed = false;
  theirs.forEach((c) => {
    if (!c || !c.id) return;
    if (!byId[c.id]) {
      byId[c.id] = c;
      order.push(c.id);
      changed = true;
      return;
    }
    const merged = Object.assign({}, byId[c.id]);
    if ((Number(c.createdAt) || 0) > 0 && !merged.createdAt) merged.createdAt = c.createdAt;
    const have = {};
    const items = [];
    ((merged.items || []).concat(c.items || [])).forEach((it) => {
      const pid = it && typeof it === "object" ? it.id : it;
      if (!pid || have[pid]) return;
      have[pid] = true;
      items.push({ id: pid });
    });
    const before = (merged.items || []).length;
    merged.items = items;
    if (items.length !== before) changed = true;
    byId[c.id] = merged;
  });
  return { list: order.map((id) => byId[id]), changed: changed };
}

module.exports = {
  clearRecords,
  clearedIds,
  READ_ROW,
  ROW_BOOK,
  READ_PREFIX,
  DAILY_EXTRA_ROW,
  DEFER_ROW,
  PINYIN_FIX_ROW,
  COLLECTIONS_ROW,
  SETTINGS_ROW,
  RECORD_ROW,
  slimRecord,
  bookOf,
  keepRecordEdge,
  recordStamp,
  latestAt,
  mergeMark,
  packRecords,
  applyRecords
};
