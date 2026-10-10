const store = require("./store");

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
const COLLECTIONS_ROW = "collections:v1";

const SETTINGS_ROW = "settings:v1";
const PROFILE_ROW = "profile:v1";

const RECORD_ROW = "progress";

const READ_PREFIX = "reads:";

function clone(v) {
  try {
    return JSON.parse(JSON.stringify(v === undefined ? null : v));
  } catch (e) {
    return null;
  }
}

function slimRecord(rec) {
  const out = {};
  if (!rec || typeof rec !== "object") return out;
  if (typeof rec.level === "number") out.level = Math.max(0, Math.min(99, Math.round(rec.level)));
  if (typeof rec.nextReviewAt === "number") out.nextReviewAt = Math.max(0, Math.round(rec.nextReviewAt));
  if (typeof rec.learned === "boolean") out.learned = rec.learned;
  if (typeof rec.reps === "number") out.reps = Math.max(0, Math.min(100000, Math.round(rec.reps)));
  if (Array.isArray(rec.history)) {
    out.history = rec.history
      .slice(-200)
      .map((h) => {
        if (!h || typeof h !== "object") return null;
        const r = {};
        if (typeof h.at === "number") r.at = Math.round(h.at);
        if (typeof h.level === "number") r.level = Math.round(h.level);
        return r;
      })
      .filter(Boolean);
  }
  return out;
}

function recordStamp(rec) {
  return Number((rec && (rec.lastReviewAt || rec.updatedAt)) || 0);
}

function packRecords() {
  const rows = [];

  const progress = store.progress();
  Object.keys(progress).forEach((id) => {
    const rec = progress[id];
    const at = recordStamp(rec);
    if (!at) return;
    rows.push({ id: id, payload: slimRecord(rec), updatedAt: at, deleted: false });
  });

  const reads = store.reads();
  Object.keys(reads).forEach((book) => {
    const rowId = READ_ROW[book];
    if (!rowId) return;
    const marks = {};
    let n = 0;
    Object.keys(reads[book] || {}).forEach((id) => {
      const ts = Number(reads[book][id]) || 0;
      if (!ts) return;
      marks[id] = { at: ts, times: 1 };
      n += 1;
    });
    if (!n) return;
    let at = 0;
    Object.keys(marks).forEach((k) => {
      if (marks[k].at > at) at = marks[k].at;
    });
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
  if (cols.length) {
    const at = store.collectionsAt() || Date.now();
    rows.push({
      id: COLLECTIONS_ROW,
      payload: { v: 1, collections: cols, updatedAt: at },
      updatedAt: at,
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

  const pAt = store.profileAt();
  const local = store.profile().avatarLocal;
  if (local && pAt) {
    rows.push({
      id: PROFILE_ROW,
      payload: { v: 1, avatar: local, updatedAt: pAt },
      updatedAt: pAt,
      deleted: false
    });
  }

  return rows;
}

function applyRecords(recs) {
  let applied = 0;
  const progress = store.progress();
  const reads = store.reads();
  const now = Date.now();

  (recs || []).forEach((row) => {
    if (!row || !row.id) return;
    const at = Number(row.updatedAt) || 0;
    const id = String(row.id);

    if (id.indexOf(READ_PREFIX) === 0) {
      const book = ROW_BOOK[id.slice(READ_PREFIX.length)];
      if (!book) return;
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
      return;
    }

    if (id === DAILY_EXTRA_ROW) {
      const payload = row.payload || {};
      const localAt = store.dailyExtraAt() || 0;

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
      return;
    }

    if (id === PROFILE_ROW) {
      const payload = row.payload || {};
      const localAt = store.profileAt() || 0;
      if (at > localAt && payload.avatar) {

        store.saveProfile({ avatarLocal: payload.avatar }, at);
        applied += 1;
      }
      return;
    }

    if (id === COLLECTIONS_ROW) {
      const payload = row.payload || {};
      const localAt = store.collectionsAt() || 0;
      if (at > localAt && Array.isArray(payload.collections)) {
        store.saveCollections(payload.collections, at);
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
        applied += 1;
      }
      return;
    }
    if (at > oldAt) {
      progress[id] = Object.assign({}, payload, { lastReviewAt: at, updatedAt: at, syncedAt: now });
      applied += 1;
    }
  });

  store.write(store.KEYS.progress, progress);
  store.write(store.KEYS.reads, reads);
  return applied;
}

module.exports = {
  READ_ROW,
  ROW_BOOK,
  READ_PREFIX,
  DAILY_EXTRA_ROW,
  COLLECTIONS_ROW,
  SETTINGS_ROW,
  PROFILE_ROW,
  RECORD_ROW,
  slimRecord,
  recordStamp,
  packRecords,
  applyRecords
};
