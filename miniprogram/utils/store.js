const corpus = require("./corpus");

const KEYS = {
  progress: "kb_progress_v1",
  settings: "kb_settings_v1",

  deviceSettings: "kb_device_settings_v1",
  reads: "kb_reads_v1",
  collections: "kb_collections_v1",
  dailyExtra: "kb_daily_extra_v1",
  profile: "kb_profile_v1",
  auth: "kb_auth_v1",
  grant: "kb_grant_v1",
  signed: "kb_signed_grant_v1",
  device: "kb_device_v1",
  speech: "kb_speech_v1",
  sync: "kb_sync_outbox_v1",

  settingsAt: "kb_settings_at_v1",

  caps: "kb_caps_v1",
  version: "kb_schema_version"
};

const DEFAULTS = {
  grade: 1,
  term: 1,
  dailyCount: 5,
  scope: "upto",
  algo: "ebbinghaus",

  align: "center",
  fontSize: 0,

  theme: "ink",
  pinyin: "rare",

  speechRate: 1,
  speechAutoNext: true,

  lastSyncAt: 0,

};

const DEVICE_DEFAULTS = {

  sfx: true
};

const SCHEMA = 2;

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

  }
}

function migrate() {
  if (read(KEYS.version, 0) === SCHEMA) return;
  write(KEYS.version, SCHEMA);

  const legacy = read("poem_recite_progress_v1", null);
  if (legacy && !read(KEYS.progress, null)) write(KEYS.progress, legacy);

  const prof = read(KEYS.profile, {}) || {};
  if (prof.tier && !prof.tierFromServer) {
    delete prof.tier;
    write(KEYS.profile, prof);
  }
}

function settings() {
  const out = {};
  const raw = rawSettings();
  const dev = read(KEYS.deviceSettings, {}) || {};
  Object.keys(DEFAULTS).forEach((k) => {
    const v = raw[k];
    out[k] = v === undefined || v === null || v === "" ? DEFAULTS[k] : v;
  });
  Object.keys(DEVICE_DEFAULTS).forEach((k) => {
    const v = dev[k];
    out[k] = v === undefined || v === null || v === "" ? DEVICE_DEFAULTS[k] : v;
  });
  return out;
}

function rawSettings() {
  return read(KEYS.settings, {}) || {};
}

function rawDeviceSettings() {
  return read(KEYS.deviceSettings, {}) || {};
}

function isDeviceKey(key) {
  return Object.prototype.hasOwnProperty.call(DEVICE_DEFAULTS, key);
}

function saveSettings(patch) {
  const p = patch || {};
  const cloud = {};
  const local = {};
  Object.keys(p).forEach((k) => {
    if (isDeviceKey(k)) local[k] = p[k];
    else cloud[k] = p[k];
  });
  if (Object.keys(cloud).length) {
    write(KEYS.settings, Object.assign(rawSettings(), cloud));

    touchSettings();
  }
  if (Object.keys(local).length) write(KEYS.deviceSettings, Object.assign(rawDeviceSettings(), local));
  return settings();
}

function replaceSettings(all) {
  const src = all || {};
  const cloud = {};
  const local = {};
  Object.keys(src).forEach((k) => {
    if (isDeviceKey(k)) local[k] = src[k];
    else cloud[k] = src[k];
  });
  if (Object.keys(cloud).length) write(KEYS.settings, Object.assign(rawSettings(), cloud));
  return settings();
}

function cloudSettings() {
  const raw = rawSettings();
  const out = {};
  Object.keys(DEFAULTS).forEach((k) => {

    if (k === "lastSyncAt") return;
    const v = raw[k];
    if (v === undefined || v === null || v === "") return;
    out[k] = v;
  });
  return out;
}

function settingsAt() {
  return Number(read(KEYS.settingsAt, 0)) || 0;
}

function touchSettings(at) {
  const t = Number(at) || Date.now();
  write(KEYS.settingsAt, t);
  return t;
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

const DAILY_EXTRA_MAX = 20;

function dailyExtra() {
  const raw = read(KEYS.dailyExtra, null);
  const today = dayKey();
  if (!raw || raw.day !== today) return [];
  return raw.ids || [];
}

function setDailyExtra(ids, at) {
  return write(KEYS.dailyExtra, { day: dayKey(), ids: ids || [], at: Number(at) || Date.now() });
}

function toggleDailyExtra(id) {
  if (!id) return { ok: false, on: false, count: dailyExtra().length, code: "E_NO_ID" };
  const ids = dailyExtra();
  const at = ids.indexOf(id);

  if (at >= 0) {
    const next = ids.slice();
    next.splice(at, 1);
    if (!setDailyExtra(next)) {
      return { ok: false, on: true, count: ids.length, code: "E_STORAGE" };
    }
    return { ok: true, on: false, count: next.length };
  }

  if (ids.length >= DAILY_EXTRA_MAX) {
    return { ok: false, on: false, count: ids.length, code: "E_LIMIT" };
  }
  const next = ids.concat([id]);
  if (!setDailyExtra(next)) {
    return { ok: false, on: false, count: ids.length, code: "E_STORAGE" };
  }
  return { ok: true, on: true, count: next.length };
}

function removeDailyExtra(list) {
  const gone = (list || []).filter(Boolean);
  if (!gone.length) return 0;
  const ids = dailyExtra();
  const left = ids.filter((id) => gone.indexOf(id) < 0);
  const n = ids.length - left.length;
  if (n) setDailyExtra(left);
  return n;
}

function clearDailyExtra() {
  const n = dailyExtra().length;
  if (!n) return 0;
  drop(KEYS.dailyExtra);
  return n;
}

function dailyExtraPoems() {
  return dailyExtra()
    .map((id) => corpus.indexById(id))
    .filter(Boolean)
    .map((p) => ({ id: p.id, t: p.t, a: p.a, d: p.d, n: p.n }));
}

function dailyExtraAt() {
  const raw = read(KEYS.dailyExtra, null);
  return Number((raw && raw.at) || 0);
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

/* 档案（昵称 + 头像）是**本机**那一份：头像只有微信一个来源且不上传，
   昵称在服务端另有一处（登录时随会话下发）。所以这里不再盖 `at` ——
   没有跨设备比较，时间戳也就没有意义了（V22 原来守的那条随之退场）。 */
function saveProfile(patch) {
  const next = Object.assign(profile(), patch || {});
  write(KEYS.profile, next);
  return next;
}

function saveSession(patch) {
  const next = Object.assign(profile(), patch || {});
  write(KEYS.profile, next);
  return next;
}

/* 头像只有一张：本机存储里那一枚（微信头像的一份临时路径）。
   服务端从来不回头像（`wx_accounts.avatar_url` 一直是空的），
   所以这里不再有「先本机、后微信」的回落 —— 没有第二处可回落。 */
function avatarSrc() {
  return profile().avatarLocal || "";
}

function collections() {
  const raw = read(KEYS.collections, null);
  if (!raw) return [];

  if (Array.isArray(raw)) return raw;
  return Array.isArray(raw.list) ? raw.list : [];
}

function saveCollections(list, at) {
  const box = { list: list || [], at: Number(at) || Date.now() };
  write(KEYS.collections, box);
  return list || [];
}

function collectionsAt() {
  const raw = read(KEYS.collections, null);
  if (!raw) return 0;

  if (Array.isArray(raw)) return 0;
  return Number(raw.at || 0);
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

  if (data.settings) replaceSettings(data.settings);
  if (data.progress) write(KEYS.progress, data.progress);
  if (data.reads) write(KEYS.reads, data.reads);
  if (data.collections) write(KEYS.collections, data.collections);
  if (data.profile) write(KEYS.profile, data.profile);
  return true;
}

function deviceId() {
  let id = read(KEYS.device, "");
  if (id) return id;
  id = "d" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  write(KEYS.device, id);
  return id;
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
  deviceId,
  DEFAULTS,
  DEVICE_DEFAULTS,
  read,
  write,
  drop,
  migrate,
  settings,
  saveSettings,
  replaceSettings,
  cloudSettings,
  settingsAt,
  touchSettings,
  progress,
  getRecord,
  setRecord,
  setRecords,
  clearProgress,
  reads,
  markRead,
  unreadCount,
  DAILY_EXTRA_MAX,
  dailyExtra,
  setDailyExtra,
  toggleDailyExtra,
  removeDailyExtra,
  clearDailyExtra,
  dailyExtraPoems,
  dailyExtraAt,
  touchDaily,
  dayKey,
  profile,
  saveProfile,
  saveSession,
  avatarSrc,
  collections,
  saveCollections,
  collectionsAt,
  exportAll,
  importAll,
  stats
};
