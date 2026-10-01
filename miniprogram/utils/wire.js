/**
 * 线上报文层：本机形状 ↔ poem 服务端形状。
 *
 * 为什么单独一层：**本机怎么存**和**服务端怎么收**是两件事。
 * 本机按集子分 key（`{ poems: { id: ts } }`）存已经读过的篇目，
 * 服务端那边是「一行一个集子」的 `reads:<行 id>`；本机按条目 id 存复习进度，
 * 服务端收 `{ id, payload, updatedAt }`。上一版把本机形状直接当报文发出去，
 * 字段名全不对 —— 而 `__tests__`（这里的自检）只验了本机侧的打包，
 * 服务端那边没人对，于是这一层错得很安静。
 *
 * 判据不是「读文档猜」，是**读 poem 的源码**：
 *   - 路由与形状   api/_lib/routes.js、api/_lib/core.js
 *   - 行 id        js/read-sync.js（PREFIX = "reads:"）、js/sync-coverage.js
 *   - 同步载荷     js/progress-store.js、js/daily-extra.js、js/collections.js
 *
 * 三处**曾经对不上**、现在钉在这里的地方，各自都标了出处：
 *   1. 进度行的字段：服务端要 `{ id, payload, updatedAt }`，
 *      而 core.js 的 sanitizePayload 只留 `level / nextReviewAt / learned / reps / history`
 *      这几个白名单字段 —— 本机那份记录比它宽，得先裁。
 *   2. 已读：服务端要 `{ id: "reads:<行 id>", payload: { v:1, updatedAt, marks: {...} } }`，
 *      一个集子一行；本机是 `{ [集子]: { [篇目]: ts } }`。
 *   3. 加背与自选清单上一版**根本没打包** —— 服务端的 `daily_extra:v1` /
 *      `collections:v1` 两行永远收不到，用户换台机器这两样就没了。
 */
const store = require("./store");

/** 本机集子 id → 网页版的已读存储行 id。**两边命名对不上，所以必须有一张表** */
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

/** 反过来用：从服务端的行 id 认出是本机哪个集子 */
const ROW_BOOK = {};
Object.keys(READ_ROW).forEach((k) => {
  ROW_BOOK[READ_ROW[k]] = k;
});

const DAILY_EXTRA_ROW = "daily_extra:v1";
const COLLECTIONS_ROW = "collections:v1";

/** 网页版 sync-coverage.js 里 `row: "每篇一行"` 的那一批 */
const RECORD_ROW = "progress";

const READ_PREFIX = "reads:";

/** 服务端 sanitizePayload 只认这几个字段，多传的会被丢掉 —— 但先裁掉更省流量 */
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

/** 本机进度记的时间戳。服务端要 `updatedAt`，本机那份叫 lastReviewAt */
function recordStamp(rec) {
  return Number((rec && (rec.lastReviewAt || rec.updatedAt)) || 0);
}

/**
 * 打包成服务端认的 recs。
 * @returns {Array<{id, payload, updatedAt, deleted}>}
 */
function packRecords() {
  const rows = [];

  // 每篇一行 —— 与网页版 `row: "每篇一行（poem_id = 篇 id）"` 对齐
  const progress = store.progress();
  Object.keys(progress).forEach((id) => {
    const rec = progress[id];
    const at = recordStamp(rec);
    if (!at) return;
    rows.push({ id: id, payload: slimRecord(rec), updatedAt: at, deleted: false });
  });

  // 已读：一个集子一行，行 id 是网页版那边的存储 key
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

  // 今日加背：上一版漏了，换台机器就没了
  const extra = store.dailyExtra();
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

  // 自选清单：同上
  const cols = store.collections();
  if (cols.length) {
    const at = store.collectionsAt() || Date.now();
    rows.push({
      id: COLLECTIONS_ROW,
      payload: { v: 1, collections: cols, updatedAt: at },
      updatedAt: at,
      deleted: false
    });
  }

  return rows;
}

/**
 * 把服务端下发的 recs 应用到本机。**按时间戳，新者胜** ——
 * 与网页版 `js/sync-store.js` 的 mergePolicy 同口径：
 * 云端更新的才覆盖本机，本机更新的留着，等下一次推。
 * @returns {number} 实际落地的条数
 */
function applyRecords(recs) {
  let applied = 0;
  const progress = store.progress();
  const reads = store.reads();
  const now = Date.now();

  (recs || []).forEach((row) => {
    if (!row || !row.id) return;
    const at = Number(row.updatedAt) || 0;
    const id = String(row.id);

    // 已读：行 id 反过来找集子
    if (id.indexOf(READ_PREFIX) === 0) {
      const book = ROW_BOOK[id.slice(READ_PREFIX.length)];
      if (!book) return;
      const marks = (row.payload && row.payload.marks) || {};
      const box = reads[book] || (reads[book] = {});
      Object.keys(marks).forEach((pid) => {
        const ts = Number((marks[pid] && marks[pid].at) || 0) || at;
        if (!ts) return;
        // 已读是**并集**：读过就是读过，哪一端都不该被抹掉
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
      // 跨天的不搬：今天的「加背」是今天的，昨天的搬过来是错的
      if (at > localAt && payload.date === store.dayKey()) {
        store.setDailyExtra((payload.items || []).map((it) => it.id).filter(Boolean), at);
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

    // 其余按「每篇一行」处理
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
  RECORD_ROW,
  slimRecord,
  recordStamp,
  packRecords,
  applyRecords
};
