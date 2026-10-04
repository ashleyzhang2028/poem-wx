/**
 * 本机存储与设置。
 *
 * 与网页版 js/progress-store.js 的分域口径一致：账号域/设备域分开，
 * 但小程序端只保留一个微信账号本机档，家庭子用户那套不移植。
 *
 * 小程序 storage 单 key 上限 1MB、总量 10MB（官方限制），
 * 这里把进度按「集子」拆 key，避免一边背一边涨到写不进去。
 */
const corpus = require("./corpus");

const KEYS = {
  progress: "kb_progress_v1",
  settings: "kb_settings_v1",
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
  /** 服务端下发的按人开关（管理页可以关掉某人的某项能力） */
  caps: "kb_caps_v1",
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
  // 主题色（Issue #26）。默认那一支墨 —— utils/theme.js 是这份清单的出处
  theme: "ink",
  pinyin: "rare",
  autoNext: false,
  // 朗读偏好（TTS 不可用时这些设置项整个不显示，见 utils/entitlement.js）
  speechRate: 1,
  speechAutoNext: true,
  // 答题音效（现场合成，零音频文件）。它不依赖任何外部通道，
  // 所以默认是**开**的 —— 与朗读那条不同，那边「没通道」等于没功能
  sfx: true
};

/**
 * 2：撤掉「本机宿主」那条后门，档位只认服务端下发。
 *    老档案里可能留着未登录状态下写的 profile.tier = max，
 *    迁移时清掉它 —— 留着会被 entitlement 当成「服务端以前确认过」。
 */
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
    /* 清不掉就算了，不值得打断用户 */
  }
}

/** 老版本没有分域 key，第一次启动把散装数据搬进新 key */
function migrate() {
  if (read(KEYS.version, 0) === SCHEMA) return;
  write(KEYS.version, SCHEMA);

  const legacy = read("poem_recite_progress_v1", null);
  if (legacy && !read(KEYS.progress, null)) write(KEYS.progress, legacy);

  // v2：清掉没有服务端签名、又高于免费档的本机档位。
  // 它是「本机宿主」时代留下的 —— 那时未登录也会把 tier 写成 max。
  const prof = read(KEYS.profile, {}) || {};
  if (prof.tier && !prof.tierFromServer) {
    delete prof.tier;
    write(KEYS.profile, prof);
  }
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

/* 今日加背一次能加几首。与网页版 `js/daily-extra.js` 的 MAX 同数 ——
   两端同步同一份数据，一边收 20 一边收 30，换端之后就会看到「多了几首
   我加不进去的」。 */
const DAILY_EXTRA_MAX = 20;

/** 今日加背：只属于当天，跨 0 点自动归零 */
function dailyExtra() {
  const raw = read(KEYS.dailyExtra, null);
  const today = dayKey();
  if (!raw || raw.day !== today) return [];
  return raw.ids || [];
}

/**
 * 写回今日加背。
 *
 * @returns {boolean} **写成功没有** —— 上一版没有返回值，界面把「写进去了」
 *   当成必然。而 storage 写失败（超限）是真会发生的：加背一次加一首，
 *   攒到 20 首也只是 20 个 id，本不该超，但同一次会话里别处写满了 quota
 *   一样会连累到这里。默默失败的表现是「点了没反应」，界面据此说一句人话。
 */
function setDailyExtra(ids, at) {
  return write(KEYS.dailyExtra, { day: dayKey(), ids: ids || [], at: Number(at) || Date.now() });
}

/**
 * 加一首 / 移一首。**领域判断收在这里，不散在界面**。
 *
 * 判据只有三条，但它们决定「加背」这件事成不成立：
 *   · 已在里面 → 移出（同一个动作两态，网页版也是这么做的）
 *   · 已满 20  → 拒绝，并把话说死（「先背完再加」）—— 加背的意思是
 *                今天多背几首，攒到 20 首还往里塞，明天一到全归零
 *   · 其余     → 追加
 *
 * 界面只负责把 code 翻成人话，不自己数数、不自己排顺序。
 *
 * @returns {{ok:boolean, on:boolean, count:number, code?:string}}
 */
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

/** 一次移出好几首（设置页的「移出选中的」）。返回真移掉了几首 */
function removeDailyExtra(list) {
  const gone = (list || []).filter(Boolean);
  if (!gone.length) return 0;
  const ids = dailyExtra();
  const left = ids.filter((id) => gone.indexOf(id) < 0);
  const n = ids.length - left.length;
  if (n) setDailyExtra(left);
  return n;
}

/** 把今天的加背清空。返回清掉了几首 —— 界面要拿这个数说「已清空 N 首」 */
function clearDailyExtra() {
  const n = dailyExtra().length;
  if (!n) return 0;
  drop(KEYS.dailyExtra);
  return n;
}

/**
 * 今日加背的**条目快照**：`[{ id, t, a, d, n }]`。
 *
 * 排期器要的是条目，而 dailyExtra() 给的只是一串 id —— 补一次「id → 条目」
 * 的翻译。它不返回正文：加背的正文在云端分片里，首页只是排出来，
 * 真正读到正文是弹层 / 详情页的事（那儿按 id 现取）。
 *
 * 认不出来的 id（语料更新后条目没了）**如实丢掉**，不编一条空标题出来 ——
 * 一个点开是白的行比少一行更糟。
 */
function dailyExtraPoems() {
  return dailyExtra()
    .map((id) => corpus.indexById(id))
    .filter(Boolean)
    .map((p) => ({ id: p.id, t: p.t, a: p.a, d: p.d, n: p.n }));
}

/**
 * 加背这一份最后一次动的时间。
 * 同步要拿它跟云端比新旧 —— 没有时间戳就只能「谁后写谁赢」，
 * 而两个设备之间没有先后可言，比的是各自看到的时间。
 */
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

function saveProfile(patch) {
  const next = Object.assign(profile(), patch || {});
  write(KEYS.profile, next);
  return next;
}

/**
 * 头像取哪一张。**规矩只有一句：自己传的那张最优先。**
 *
 *   avatarLocal  用户在本机传/裁过的图（chooseAvatar 或相册）—— 排第一
 *   avatarUrl    微信身份给的那张（登录时下发 / 用户从微信取）—— 兜底
 *   都没有       页面显首字印（不引默认头像图，一个字最省）
 *
 * 为什么分开存而不是共用一个字段：**它们是两个来源，来源不同、优先级不同**。
 * 挤进一个字段，就分不清「这张是微信的、用户只是没换」还是「这张是用户
 * 特意换的」—— 前者该在下次登录时被微信的新头像刷新，后者绝不能被动。
 * 网页版那边是一模一样的口径（js/avatar.js：本机那张优先于账号那张）。
 *
 * 用户说的「子用户上传头像再用子用户头像」就是这个意思：本机那份**盖过**
 * 微信那份。小程序端没有家庭子用户（见 docs/todo.md #8），
 * 所以「子用户」在这里落成「本机该用户自己传的那张」。
 */
function avatarSrc() {
  const p = profile();
  return p.avatarLocal || p.avatarUrl || "";
}

/** 有没有自己传过头像 —— 决定设置里「移除头像」那一项显不显示 */
function hasLocalAvatar() {
  return !!profile().avatarLocal;
}

/** 自选集合：教材之外的额外篇目，可建多个 */
function collections() {
  const raw = read(KEYS.collections, null);
  if (!raw) return [];
  // 上一版存的是裸数组，这一版加了时间戳（同步要比新旧）。两种都认。
  if (Array.isArray(raw)) return raw;
  return Array.isArray(raw.list) ? raw.list : [];
}

function saveCollections(list, at) {
  const box = { list: list || [], at: Number(at) || Date.now() };
  write(KEYS.collections, box);
  return list || [];
}

/** 自选清单最后一次动的时间，理由同 dailyExtraAt */
function collectionsAt() {
  const raw = read(KEYS.collections, null);
  if (!raw) return 0;
  // 兼容上一版的裸数组：那时没存时间，只能当 0，让云端的新数据赢
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
  if (data.settings) write(KEYS.settings, data.settings);
  if (data.progress) write(KEYS.progress, data.progress);
  if (data.reads) write(KEYS.reads, data.reads);
  if (data.collections) write(KEYS.collections, data.collections);
  if (data.profile) write(KEYS.profile, data.profile);
  return true;
}

/** 本机标识：云端同步用它认回这台设备的进度，不含任何身份信息 */
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
  avatarSrc,
  hasLocalAvatar,
  collections,
  saveCollections,
  collectionsAt,
  exportAll,
  importAll,
  stats
};
