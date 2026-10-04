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
 *   4. **设置与头像也没打包**（用户 2026-10-04：「同步功能只要用户登录就全部提供，
 *      确保用户数据不丢失」）。上一版换台手机之后主题回到「墨」、每日计划回到 5 首、
 *      算法回到艾宾浩斯、头像没了 —— 而它们全是**用户自己选过的东西**。
 *      现在两样各占一行（`settings:v1` / `profile:v1`），整份快照进出。
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

/**
 * 设置与头像各占一行。
 *
 * 为什么用**快照行**而不是「一个设置项一行」：
 * 设置是「一台机器上的全部选择」，用户要的是「换台手机还是我那一套」，
 * 不是「把 12 个键分别对齐」。一行意味着整份进、整份出，按时间戳比新旧 ——
 * 而逐键合并会出现「年级是我的、算法是他的」这种**谁都没选过的中间态**。
 *
 * 行 id 带 `v1`：将来设置结构真变了，靠前缀就能议出迁移，
 * 不至于让一台老版本机器把新结构读写坏。
 */
const SETTINGS_ROW = "settings:v1";
const PROFILE_ROW = "profile:v1";

/** 网页版 sync-coverage.js 里 `row: "每篇一行"` 的那一批 */
const RECORD_ROW = "progress";

const READ_PREFIX = "reads:";

/**
 * 深拷一份。JSON 能表达的这里都够用（设置全是数字 / 字符串 / 布尔）。
 * 为什么需要它：本机存储里那些对象是**活引用**（`wx.getStorageSync` 在
 * 开发者工具里也返回同一份），直接放进报文就等于把报文钉在本机存储上。
 */
function clone(v) {
  try {
    return JSON.parse(JSON.stringify(v === undefined ? null : v));
  } catch (e) {
    return null;
  }
}

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

  // 自选清单：同上
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

  // 设置：整份快照一行。云端更新的那份整份覆盖本机（见 applyRecords）
  //
  // ⚠️ **必须深拷一份**，不能把 store 里那个对象直接放进报文。
  // 这一条是量出来的：本机接着改了设置（同名 key 被覆盖），
  // 排队那一行里的 settings 会跟着一起变 —— 于是「发出去的内容」与
  // 「这一行的 updatedAt」对不上：时间戳还是老的，内容是新的。
  // 在离线队列里躺一会儿再推，推上去的就是一份**时间戳说不清来历**的数据。
  // 这类错不会报错，只会让某一台设备的选择静默地盖掉另一台。
  const sAt = store.settingsAt();
  if (sAt) {
    rows.push({
      id: SETTINGS_ROW,
      payload: { v: 1, settings: clone(store.cloudSettings()), updatedAt: sAt },
      updatedAt: sAt,
      deleted: false
    });
  }

  // 头像：一行。**只带用户自己传的那张**（avatarLocal）——
  // 微信给的那张（avatarUrl）登录时服务端就会重新下发，同步它是多余的；
  // 而本机那张是用户自己裁的，丢了就真没了。
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

    if (id === SETTINGS_ROW) {
      const payload = row.payload || {};
      const localAt = store.settingsAt() || 0;
      // 整份覆盖，不逐键合并 —— 逐键会造出「谁都没选过」的中间态。
      // 本机更新的那份留着，等下一次推上去（新者胜）。
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
        // 落到 avatarLocal：本机那份（用户自己传的）优先级最高，
        // 与 store.avatarSrc() 同一口径 —— 认回来的就是他挑的那张
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
  SETTINGS_ROW,
  PROFILE_ROW,
  RECORD_ROW,
  slimRecord,
  recordStamp,
  packRecords,
  applyRecords
};
