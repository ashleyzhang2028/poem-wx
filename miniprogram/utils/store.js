/**
 * 本机存储与设置。
 *
 * 与网页版 js/progress-store.js 的分域口径一致：账号域/设备域分开，
 * 但小程序端只保留一个微信账号本机档，家庭子用户那套不移植。
 *
 * 小程序 storage 单 key 上限 1MB、总量 10MB（官方限制），
 * 这里把进度按「集子」拆 key，避免一边背一边涨到写不进去。
 */
const KEYS = {
  progress: "kb_progress_v1",
  settings: "kb_settings_v1",
  reads: "kb_reads_v1",
  collections: "kb_collections_v1",
  dailyExtra: "kb_daily_extra_v1",
  profile: "kb_profile_v1",
  auth: "kb_auth_v1",
  version: "kb_schema_version"
};

const DEFAULTS = {
  grade: 1,
  term: 1,
  dailyCount: 5,
  scope: "upto",
  algo: "ebbinghaus",
  // 阅读器偏好
  align: "center",
  fontSize: 0,
  pinyin: "rare",
  autoNext: false
};

const SCHEMA = 1;

function read(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return v === "" || v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

function drop(key) {
  try {
    wx.removeStorageSync(key);
  } catch (e) {
    /* 清不掉就算了，不值得打断用户 */
  }
}

/** 老版本没有分域 key，第一次启动把散装数据搬进新 key */
function migrate() {
  if (read(KEYS.version, 0) === SCHEMA) return;
  write(KEYS.version, SCHEMA);

  const legacy = read("poem_recite_progress_v1", null);
  if (legacy && !read(KEYS.progress, null)) write(KEYS.progress, legacy);
}

function settings() {
  const out = {};
  Object.keys(DEFAULTS).forEach((k) => {
    const v = rawSettings()[k];
    out[k] = v === undefined || v === null || v === "" ? DEFAULTS[k] : v;
  });
  return out;
}

function rawSettings() {
  return read(KEYS.settings, {}) || {};
}

/** 写回时在原始数据上合并：settings() 只投影已知键，拿它当底会抹掉别的键 */
function saveSettings(patch) {
  const next = Object.assign(rawSettings(), patch || {});
  write(KEYS.settings, next);
  return settings();
}

function progress() {
  return read(KEYS.progress, {}) || {};
}

function getRecord(id) {
  return progress()[id] || null;
}

function setRecord(id, rec) {
  const all = progress();
  all[id] = rec;
  shrinkIfNeeded(all);
  write(KEYS.progress, all);
  return rec;
}

function setRecords(list) {
  const all = progress();
  (list || []).forEach((it) => {
    all[it.id] = it.rec;
  });
  shrinkIfNeeded(all);
  write(KEYS.progress, all);
}

/** 进度只留最近有动作的若干条，超出的按下次复习时间倒序裁掉 */
function shrinkIfNeeded(all) {
  const ids = Object.keys(all);
  if (ids.length <= 3000) return;
  ids
    .sort((a, b) => (all[b].lastReviewAt || 0) - (all[a].lastReviewAt || 0))
    .slice(3000)
    .forEach((id) => delete all[id]);
}

function clearProgress() {
  drop(KEYS.progress);
  drop(KEYS.reads);
  drop(KEYS.dailyExtra);
}

/** 已读标记：按集子分 key，{ [bookId]: { [entryId]: ts } } */
function reads(book) {
  const all = read(KEYS.reads, {}) || {};
  return book ? all[book] || {} : all;
}

function markRead(book, id) {
  const all = read(KEYS.reads, {}) || {};
  const m = all[book] || (all[book] = {});
  m[id] = Date.now();
  write(KEYS.reads, all);
}

function unreadCount(book, ids) {
  const m = reads(book);
  return (ids || []).filter((id) => !m[id]).length;
}

/** 今日加背：只属于当天，跨 0 点自动归零 */
function dailyExtra() {
  const raw = read(KEYS.dailyExtra, null);
  const today = dayKey();
  if (!raw || raw.day !== today) return [];
  return raw.ids || [];
}

function setDailyExtra(ids) {
  write(KEYS.dailyExtra, { day: dayKey(), ids: ids || [] });
}

function touchDaily() {
  const raw = read(KEYS.dailyExtra, null);
  if (raw && raw.day !== dayKey()) drop(KEYS.dailyExtra);
}

function dayKey(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

function profile() {
  return read(KEYS.profile, {}) || {};
}

function saveProfile(patch) {
  const next = Object.assign(profile(), patch || {});
  write(KEYS.profile, next);
  return next;
}

/** 自选集合：教材之外的额外篇目，可建多个 */
function collections() {
  return read(KEYS.collections, []) || [];
}

function saveCollections(list) {
  write(KEYS.collections, list || []);
  return list || [];
}

function exportAll() {
  return {
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    settings: settings(),
    progress: progress(),
    reads: read(KEYS.reads, {}),
    collections: collections(),
    profile: profile()
  };
}

function importAll(data) {
  if (!data || typeof data !== "object") throw new Error("备份文件格式不正确");
  if (data.settings) write(KEYS.settings, data.settings);
  if (data.progress) write(KEYS.progress, data.progress);
  if (data.reads) write(KEYS.reads, data.reads);
  if (data.collections) write(KEYS.collections, data.collections);
  if (data.profile) write(KEYS.profile, data.profile);
  return true;
}

function stats() {
  const p = progress();
  let learned = 0;
  let mastered = 0;
  Object.keys(p).forEach((id) => {
    const r = p[id];
    if (!r || !r.learned) return;
    learned += 1;
    if (r.level >= 7) mastered += 1;
  });
  const readsAll = read(KEYS.reads, {}) || {};
  const readCount = Object.keys(readsAll).reduce((n, b) => n + Object.keys(readsAll[b]).length, 0);
  return { learned, mastered, readCount, total: Object.keys(p).length };
}

module.exports = {
  KEYS,
  DEFAULTS,
  read,
  write,
  drop,
  migrate,
  settings,
  saveSettings,
  progress,
  getRecord,
  setRecord,
  setRecords,
  clearProgress,
  reads,
  markRead,
  unreadCount,
  dailyExtra,
  setDailyExtra,
  touchDaily,
  dayKey,
  profile,
  saveProfile,
  collections,
  saveCollections,
  exportAll,
  importAll,
  stats
};
