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
  /* 「只有这台设备说了算」的设置（网速 / 音效这类跟设备走的东西）。
     与 settings 分开存：那一份是跨设备同步的，这一份进来就是脏数据 */
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
  /** 设置这一份最后一次动的时间（同步比新旧用） */
  settingsAt: "kb_settings_at_v1",
  /** 服务端下发的按人开关（管理页可以关掉某人的某项能力） */
  caps: "kb_caps_v1",
  version: "kb_schema_version"
};

/**
 * 设置默认值。**这份清单就是「换台手机之后会被认回来的东西」**——
 * 用户 2026-10-04 的话：「同步功能只要用户登录就全部提供，确保用户数据不丢失」。
 *
 * 所以分两层：
 *   DEFAULTS        跨设备同步（年级、范围、算法、主题色、注音、字号、对齐…）
 *   DEVICE_DEFAULTS 只有这台设备说了算（网速、音效）
 * 判据不是「这个设置重不重要」，而是**「它在另一台手机上还成不成立」**：
 * 音效取决于这台机器的扬声器，网速取决于当时的网络，搬过去只会互相打脸。
 */
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
  // ⚠️ 这里**没有** autoNext —— 它 2026-10-04 随那枚开关一起删了。
  // 删一个「跨设备」的键要动两处：DEFAULTS 这一行，以及**云端那份报文**里的
  // 同名键。旧客户端推上来的报文里可能还带着它，wire.js 的 replaceSettings
  // 是整份落盘（不裁剪），所以老数据那边还留着 —— 那是历史，不是活设置：
  // store.settings() 只投影 DEFAULTS 里有的键，读不到它，也就没人会再信它。
  // 朗读偏好（TTS 不可用时这些设置项整个不显示，见 utils/entitlement.js）
  speechRate: 1,
  speechAutoNext: true,
  // 音效**不在**这里 —— 它跟设备走，见 DEVICE_DEFAULTS
};

/** 只有这台设备说了算的设置。不进报文，换机回默认 */
const DEVICE_DEFAULTS = {
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

/**
 * 投影两份原始存储：跨设备的那份（KEYS.settings）与只属本机的那份。
 * 认不出来的键一律保留在**原始**存储里（见 rawSettings），只是不投影出来。
 */
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

/** 只属本机的那份原始存储 */
function rawDeviceSettings() {
  return read(KEYS.deviceSettings, {}) || {};
}

/** 这个键是不是「跟设备走」的 */
function isDeviceKey(key) {
  return Object.prototype.hasOwnProperty.call(DEVICE_DEFAULTS, key);
}

/**
 * 写回时在原始数据上合并：settings() 只投影已知键，拿它当底会抹掉别的键。
 *
 * 键落哪一份由 DEVICE_DEFAULTS 决定 —— 页面照旧只写一个 key，
 * 「这个键跟不跟人走」的判断收在这里一处，不散到十几个调用点上。
 */
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
    // 写跨设备那一份就顺手盖章 —— **时间戳不许由调用方负责**。
    // 这一条是被一次端到端试出来的：设置页每个入口都挂了 markDirty，
    // 看着毫无破绽；可只要有**一处**漏挂（或者将来新加一个入口忘了挂），
    // 数据就永远进不了报文 —— 因为 packRecords 只收「有时间戳的」。
    // 那种漏不会报错，只会「改了设置、换台手机还是默认」。
    // 所以盖章收在这里：写下去的那一刻就是它的时间。
    touchSettings();
  }
  if (Object.keys(local).length) write(KEYS.deviceSettings, Object.assign(rawDeviceSettings(), local));
  return settings();
}

/**
 * 整份设置写回，**给同步用**。
 *
 * 与 saveSettings 的区别：它是「按时间戳整份覆盖」，走的是云端的设置行。
 * 键还得分流 —— 云端那份可能带着别的设备写的 sfx，落进本机时不能让它
 * 盖掉这台机器的；反过来也不该把本机的 sfx 带到云上去。
 */
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

/** 设置里**跨设备**的那一份原始数据（同步打包用） */
function cloudSettings() {
  return rawSettings();
}

/** 设置最后一次动的时间 —— 同步拿它比新旧 */
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

/**
 * 档案里**跨设备**的那几个字段。
 *
 * `at` 只跟这几个走，**不跟会话走** —— 这条边界是被一次端到端试出来的：
 * 新机器上登录会写一次 `{ logged: true, nickname }`，如果那一下也算
 * 「档案动了」，本机就成了「更新的那一份」，而云端那份头像被判成旧的 ——
 * 于是头像永远认不回来（本机每登一次就把云端那份顶掉一次）。
 * 表现是「换台手机头像没了」，而进度、设置都好好的，最难往这上面想。
 *
 * 所以把「会话字段」与「跟着人走的字段」拆成两个入口：
 *   saveSession()  登录态 / 档位 —— 只在本机用，不参与同步的时间比大小
 *   saveProfile()  头像 / 昵称   —— 跨设备，写它就等于「这份档案是我的新版本」
 */
const PROFILE_SYNCED = ["avatarLocal", "nickname"];

/**
 * 写档案。**只给跨设备的那几个字段用**（头像 / 昵称）。
 *
 * @param {object} patch
 * @param {number} [at] **跨设备同步用**：按云端下发的行覆盖时，把云端那个
 *   时间戳一并落下。不传就取本机当下 —— 也就是「这份档案是我刚改的」。
 *   两件事必须分开：认回云端那份时若写成本机时间，下一次同步本机就成了
 *   「更新的那一份」，把云端自己的数据再推回去，两台机器永远在互相覆盖。
 */
function saveProfile(patch, at) {
  const next = Object.assign(profile(), patch || {});
  const keys = Object.keys(patch || {});
  if (at !== undefined) {
    next.at = Number(at) || 0;
  } else if (keys.some((k) => PROFILE_SYNCED.indexOf(k) >= 0)) {
    // 只有「跨设备的那几个字段」被写到时才盖章，别的键（logged / tier…）
    // 从不经这条路 —— 真从这儿过了，说明有调用点用错了函数，也不该改语义
    next.at = Date.now();
  }
  write(KEYS.profile, next);
  return next;
}

/**
 * 写会话字段（登录态 / 档位 / 微信头像地址）。
 *
 * 与 saveProfile 分家的唯一理由，就是**不盖同步时间戳**：
 * 登录这件事在两台机器上都会发生，它不该参与「谁的那一份更新」。
 * 合在一起写的代价是一个静默的、只有换机器才看得见的 bug（见上）。
 */
function saveSession(patch) {
  const next = Object.assign(profile(), patch || {});
  write(KEYS.profile, next);
  return next;
}

/**
 * 上面那两条「盖时间戳」为什么不能交给调用方：
 *
 * 时间戳是**同步的入场券** —— `packRecords()` 只打包「有时间戳的那一份」。
 * 靠每个调用点自己记得盖，就等于让「同步能不能生效」取决于
 * 「有没有人在新加的入口上记得调一下」。漏一处，那一处的改动就永远上不了云，
 * 而界面一切正常 —— 这类错只有换台手机才看得见。
 *
 * 所以收口：`saveSettings()` 写跨设备那份时顺手 `touchSettings()`，
 * `saveProfile()` 带 patch 时顺手盖 `at`。`markDirty()` 退化成
 * 「队列里记一笔」的提示（它还有别的活儿：让 sync.state() 知道该动一动了）。
 */

/** 档案最后一次动的时间（同步比新旧用）。老档案没有这个字段，当 0 */
function profileAt() {
  return Number(profile().at) || 0;
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

/** 有没有自己传过头像 —— 决定「用微信头像」（退回微信那张）这一枚出不出现 */
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
  // 分流：导入的 settings 里那些「跟设备走」的键落本机那一份，
  // 别把别人机器的音效开关搬到这台机器上
  if (data.settings) replaceSettings(data.settings);
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
  profileAt,
  avatarSrc,
  hasLocalAvatar,
  collections,
  saveCollections,
  collectionsAt,
  exportAll,
  importAll,
  stats
};
