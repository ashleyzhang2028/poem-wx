const corpus = require("./corpus");

const KEYS = {
  progress: "kb_progress_v1",
  settings: "kb_settings_v1",

  deviceSettings: "kb_device_settings_v1",
  reads: "kb_reads_v1",
  collections: "kb_collections_v1",
  defer: "kb_recite_defer_v1",
  pinyinFix: "kb_pinyin_fix_v1",
  dailyExtra: "kb_daily_extra_v1",
  dayPlan: "kb_day_plan_v1",
  dayPlanAt: "kb_day_plan_at_v1",
  profile: "kb_profile_v1",
  auth: "kb_auth_v1",
  grant: "kb_grant_v1",
  signed: "kb_signed_grant_v1",
  device: "kb_device_v1",
  sync: "kb_sync_outbox_v1",
  clearMarks: "kb_clear_marks_v1",
  progressEdge: "kb_progress_edge_v1",
  readsEdge: "kb_reads_edge_v1",

  settingsAt: "kb_settings_at_v1",
  tierAt: "kb_tier_at_v1",

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
  font: "zhuque",
  pinyin: "off",
  banner: "",
  toneColor: "",

  selfOnly: false,

  seasonal: true,

  leagueBoard: true,

  lastSearch: "",

  lastSyncAt: 0,

};

const DEVICE_DEFAULTS = {

  sfx: true
};

const LOCAL_ONLY = {

  lastSearch: true,

  banner: true
};

const CLOUD_DEFAULTS = {};
Object.keys(DEFAULTS).forEach((k) => {
  if (k === "lastSyncAt" || LOCAL_ONLY[k]) return;
  CLOUD_DEFAULTS[k] = DEFAULTS[k];
});

const SCHEMA = 2;

const TIER_GAP_MS = 60 * 60 * 1000;

let hot = {};
let hotWx = null;
let progressCache = null;
let progressWx = null;
let readsCache = null;
let readsWx = null;

function isHot(key) {
  return key === KEYS.profile || key === KEYS.auth || key === KEYS.caps;
}

function read(key, fallback) {
  try {
    let v;
    if (isHot(key)) {
      if (hotWx !== wx) {
        hot = {};
        hotWx = wx;
      }
      if (!(key in hot)) {
        const raw = wx.getStorageSync(key);
        hot[key] = raw === "" || raw === null || raw === undefined ? null : JSON.stringify(raw);
      }
      v = hot[key] === null ? undefined : JSON.parse(hot[key]);
    } else {
      v = wx.getStorageSync(key);
    }
    return v === "" || v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    wx.setStorageSync(key, value);
    delete hot[key];
    return true;
  } catch (e) {
    forgetCache(key);
    return false;
  }
}

function drop(key) {
  forgetCache(key);
  try {
    wx.removeStorageSync(key);
  } catch (e) {

  }
  delete hot[key];
}

function forgetCache(key) {
  if (key === KEYS.progress) dropProgressCache();
  if (key === KEYS.reads) dropReadsCache();
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
  const replace = Object.keys(CLOUD_DEFAULTS).some((k) => k in src);
  Object.keys(src).forEach((k) => {
    if (isDeviceKey(k)) local[k] = src[k];
    else cloud[k] = src[k];
  });
  if (!replace) {
    if (Object.keys(cloud).length) write(KEYS.settings, Object.assign(rawSettings(), cloud));
    return settings();
  }
  const next = Object.assign({}, rawSettings());
  Object.keys(CLOUD_DEFAULTS).forEach((k) => {
    const v = cloud[k];
    next[k] = v === undefined || v === null || v === "" ? DEFAULTS[k] : v;
  });
  write(KEYS.settings, next);
  return settings();
}

function cloudSettings() {
  const raw = rawSettings();
  const out = {};
  Object.keys(DEFAULTS).forEach((k) => {

    if (k === "lastSyncAt" || LOCAL_ONLY[k]) return;
    out[k] = raw[k] === undefined || raw[k] === null || raw[k] === "" ? DEFAULTS[k] : raw[k];
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

function tierAt() {
  return Number(read(KEYS.tierAt, 0)) || 0;
}

function touchTier(at) {
  const t = Number(at) || Date.now();
  write(KEYS.tierAt, t);
  return t;
}

function tierDue(now) {
  const last = tierAt();
  if (!last) return true;
  return (Number(now) || Date.now()) - last >= TIER_GAP_MS;
}

let progressScratch = null;

function progress() {
  if (progressCache && progressWx === wx) return progressCache;
  let all;
  if (progressScratch) {
    all = progressScratch;
    progressScratch = null;
    fillStore(all, read(KEYS.progress, {}) || {});
  } else {
    all = read(KEYS.progress, {}) || {};
  }
  progressCache = all;
  progressWx = wx;
  return all;
}

function dropProgressCache() {
  if (!progressCache) return;
  if (progressCache !== progressScratch) {
    progressScratch = progressCache;
    fillStore(progressScratch, {});
  }
  progressCache = null;
}

function fillStore(dst, src) {
  Object.keys(dst).forEach((k) => delete dst[k]);
  Object.keys(src).forEach((k) => { dst[k] = src[k]; });
}

function getRecord(id) {
  return progress()[id] || null;
}

function setRecord(id, rec) {
  const all = progress();
  all[id] = rec;
  shrinkIfNeeded(all);
  write(KEYS.progress, all);
  progressCache = all;
  require("./wire").keepRecordEdge(id, rec);
  return rec;
}

function setRecords(list) {
  const all = progress();
  (list || []).forEach((it) => {
    all[it.id] = it.rec;
  });
  shrinkIfNeeded(all);
  write(KEYS.progress, all);
  progressCache = all;
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
  const at = Date.now();
  const rows = [];

  Object.keys(progress()).forEach((id) => {
    rows.push({ id: id, updatedAt: at });
  });

  const readBooks = Object.keys(reads()).filter((book) => Object.keys(reads(book)).length);
  const hadDailyExtra = dailyExtra().length > 0;

  drop(KEYS.progress);
  drop(KEYS.reads);
  drop(KEYS.dailyExtra);
  drop(KEYS.dayPlan);

  if (rows.length || readBooks.length || hadDailyExtra) {
    write(KEYS.clearMarks, { at: at, rows: rows, books: readBooks, dailyExtra: hadDailyExtra });
  } else {
    drop(KEYS.clearMarks);
  }
  return { cleared: rows.length, books: readBooks, dailyExtra: hadDailyExtra };
}

function clearMarks() {
  const box = read(KEYS.clearMarks, null) || {};
  return {
    at: Number(box.at) || 0,
    rows: Array.isArray(box.rows) ? box.rows : [],
    books: Array.isArray(box.books) ? box.books : [],
    dailyExtra: !!box.dailyExtra
  };
}

function saveClearMarks(box) {
  write(KEYS.clearMarks, box);
}

function dropClearMarks() {
  drop(KEYS.clearMarks);
}

let readsScratch = null;

function reads(book) {
  if (!readsCache || readsWx !== wx) {
    let all;
    if (readsScratch) {
      all = readsScratch;
      readsScratch = null;
      fillStore(all, read(KEYS.reads, {}) || {});
    } else {
      all = read(KEYS.reads, {}) || {};
    }
    readsCache = all;
    readsWx = wx;
  }
  return book ? readsCache[book] || {} : readsCache;
}

function dropReadsCache() {
  if (!readsCache) return;
  if (readsCache !== readsScratch) {
    readsScratch = readsCache;
    fillStore(readsScratch, {});
  }
  readsCache = null;
}

function markRead(book, id) {
  const all = reads();
  const m = all[book] || (all[book] = {});
  m[id] = Date.now();
  write(KEYS.reads, all);
  readsCache = all;
  keepReadsEdge(book, { [id]: m[id] });
}

function progressEdge() {
  const box = read(KEYS.progressEdge, {}) || {};
  return box && typeof box === "object" ? box : {};
}

function keepProgressEdge(book, id, at) {
  if (!book || !id || !(at > 0)) return;
  const all = progressEdge();
  const m = all[book] || (all[book] = {});
  if (m[id] && m[id].at >= at) return;
  m[id] = { at: Math.round(at), times: 1 };
  write(KEYS.progressEdge, all);
}

function dropProgressEdge(book, id) {
  const all = progressEdge();
  const m = all[book];
  if (!m || !m[id]) return;
  delete m[id];
  if (!Object.keys(m).length) delete all[book];
  write(KEYS.progressEdge, all);
}

function replaceProgressEdge(all) {
  write(KEYS.progressEdge, all && typeof all === "object" ? all : {});
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

  if (at < 0) {
    const denied = require("./entitlement").decide("extra");
    if (!denied.ok) return { ok: false, on: false, count: ids.length, code: "E_TIER" };
  }

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

function dayPlan(key) {
  const raw = read(KEYS.dayPlan, null);
  if (!raw || raw.key !== key || !Array.isArray(raw.ids) || !Array.isArray(raw.rows)) {
    return { ids: [], rows: {} };
  }
  const rows = {};
  raw.rows.forEach((r) => {
    if (r && r.id) rows[r.id] = { reason: r.reason, reviewRound: r.reviewRound };
  });
  return { ids: raw.ids.filter((id) => rows[id]), rows: rows };
}

function saveDayPlan(key, plan) {
  const rows = (plan || []).map((it) => ({
    id: it.poem.id,
    reason: it.reason,
    reviewRound: Math.max(0, Number(it.reviewRound) || 0)
  }));
  write(KEYS.dayPlan, {
    key: key,
    ids: rows.map((r) => r.id),
    rows: rows,
    at: Date.now()
  });
}

function dropDayPlan(key) {
  const raw = read(KEYS.dayPlan, null);
  if (!raw || (key && raw.key !== key)) return;
  drop(KEYS.dayPlan);
}

function dayPlanAt() {
  return Number(read(KEYS.dayPlanAt, 0)) || 0;
}

function touchDayPlan(at) {
  write(KEYS.dayPlanAt, Number(at) || Date.now());
}

function readsEdge() {
  return read(KEYS.readsEdge, {}) || {};
}

function keepReadsEdge(book, marks) {
  if (!book || !marks) return;
  const all = readsEdge();
  const box = all[book] || {};
  let top = 0;
  Object.keys(marks).forEach((id) => {
    const ts = Number(marks[id]) || 0;
    if (ts > (Number(box[id]) || 0)) box[id] = ts;
    if (ts > top) top = ts;
  });
  write(KEYS.readsEdge, all);
  if (top > dayPlanAt()) touchDayPlan(top);
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

function saveSession(patch) {
  const next = Object.assign(profile(), patch || {});
  write(KEYS.profile, next);
  return next;
}

function defaultNickname() {
  return "我的古诗词";
}

function defaultNick(name) {
  const nick = String(name == null ? "" : name).trim();
  return !nick || nick === defaultNickname();
}

function displayName() {
  const nick = profile().nickname || "";
  return defaultNick(nick) ? "诗" : nick;
}

function avatarSrc() {
  return profile().avatarLocal || "";
}

function avatarChar() {
  return displayName().slice(0, 1);
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

function deferList() {
  const raw = read(KEYS.defer, null);
  const list = raw && Array.isArray(raw.list) ? raw.list : [];
  return list.filter((it) => it && it.wid && it.day);
}

function deferAt() {
  const raw = read(KEYS.defer, null);
  return raw ? Number(raw.at || 0) : 0;
}

function setDefer(items, at) {
  const prev = deferAt();
  const next = Number(at) || 0;
  write(KEYS.defer, { list: items || [], at: Math.max(prev, next, Date.now()) });
}

function pinyinFixes() {
  const raw = read(KEYS.pinyinFix, null);
  const list = raw && Array.isArray(raw.list) ? raw.list : [];
  return list.filter((f) => f && f.wid && f.line && f.py);
}

function pinyinFixAt() {
  const raw = read(KEYS.pinyinFix, null);
  return raw ? Number(raw.at || 0) : 0;
}

function setPinyinFixes(fixes, at) {
  write(KEYS.pinyinFix, { list: fixes || [], at: Number(at) || Date.now() });
}

const DEVICE_SHAPE = /^d_[0-9a-f]{8}$/;

function newDeviceId() {
  const hex = "0123456789abcdef";
  let s = "";
  while (s.length < 8) s += hex.charAt(Math.floor(Math.random() * 16));
  return "d_" + s;
}

function deviceId() {
  const id = read(KEYS.device, "");
  if (DEVICE_SHAPE.test(id)) return id;
  const fresh = newDeviceId();
  write(KEYS.device, fresh);
  return fresh;
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
  LOCAL_ONLY,
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
  tierAt,
  touchTier,
  tierDue,
  progress,
  getRecord,
  setRecord,
  setRecords,
  clearProgress,
  clearMarks,
  saveClearMarks,
  dropClearMarks,
  reads,
  markRead,
  deferList,
  deferAt,
  setDefer,
  pinyinFixes,
  pinyinFixAt,
  setPinyinFixes,
  DAILY_EXTRA_MAX,
  dailyExtra,
  setDailyExtra,
  toggleDailyExtra,
  removeDailyExtra,
  clearDailyExtra,
  dailyExtraPoems,
  dailyExtraAt,
  dayPlan,
  saveDayPlan,
  dropDayPlan,
  dayPlanAt,
  touchDayPlan,
  readsEdge,
  keepReadsEdge,
  touchDaily,
  dayKey,
  profile,
  saveProfile,
  saveSession,
  defaultNickname,
  defaultNick,
  displayName,
  avatarSrc,
  avatarChar,
  collections,
  saveCollections,
  collectionsAt,
  progressEdge,
  keepProgressEdge,
  dropProgressEdge,
  replaceProgressEdge,
  stats
};
