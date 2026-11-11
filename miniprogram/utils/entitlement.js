const store = require("./store");
const tiers = require("./tiers");
const auth = require("./auth");
const gate = require("./gate");

const TIER_RANK = { free: 1, pro: 2, max: 3 };

function rankOf(tier) {
  return TIER_RANK[tier] === undefined ? 0 : TIER_RANK[tier];
}

function collectionCell(tier) {
  const n = tiers.COLLECTION_LIMITS[tier];
  if (!n) return { text: "", on: false };
  return { text: n + " 个集合", on: true };
}

function recordCell(tier, cap) {
  const n = tiers.RECORD_LIMITS[tier];
  if (!n) return { text: "", on: false };
  return { text: n + " 条", on: rankOf(cap.tier) <= rankOf(tier) };
}

function bookmarkCell(tier, cap) {
  const n = tiers.BOOKMARK_LIMITS[tier];
  if (!n) return { text: "", on: false };
  return { text: n + " 个", on: rankOf(cap.tier) <= rankOf(tier) };
}

function courseFreeCell(tier) {
  const on = rankOf(tier) >= rankOf("pro");
  return { text: "", on: on };
}

const CAPS = [
  { key: "daily", name: "每日温习", desc: "按计划温习今天这几首", tier: "free" },
  { key: "library", name: "漫读·课内与诗词", desc: "课内篇目按册翻读，课外集子随点随读", tier: "free" },
  { key: "pinyin", name: "注音辅助", desc: "生字标音、多音字消歧", tier: "free" },
  { key: "ebbinghaus", name: "艾宾浩斯 Ebbinghaus", desc: "固定间隔复习", tier: "free" },
  { key: "progress", name: "进度总览", desc: "未来七天排期与阶段分布", tier: "free" },
  { key: "novels", name: "名著小说", desc: "章回、话本与笔记的目录与正文", tier: "pro" },
  { key: "search", name: "全站搜索", desc: "按篇名、作者、朝代、出处检索", tier: "free" },
  { key: "extra", name: "新增温习", desc: "当日自行追加温习篇目", tier: "pro" },
  { key: "leitner", name: "莱特纳盒 Leitner Box", desc: "分级盒子复习", tier: "pro" },

  { key: "sync", name: "同步进度", desc: "进度与设置随微信账号同步", tier: "free" },
  { key: "sm2", name: "SM-2 SuperMemo 2", desc: "间隔 × 简易度", tier: "pro" },
  { key: "quiz", name: "题库", desc: "六种题型的练习与判分", tier: "pro" },
  { key: "audio", name: "诗词音频", desc: "课内诗词的音频 · 单篇播放", tier: "pro" },
  { key: "audioloop", name: "音频连播", desc: "顺序 / 列表循环 / 单首循环 / 随机 · 底栏工具栏", tier: "max" },
  { key: "collections", name: "自选温习", desc: "自定义集合 · " + tiers.collectionQuota(), cell: collectionCell, tier: "pro" },
  { key: "bookmarks", name: "书签", desc: "于详情页收藏，在设置中统一管理 · " + tiers.bookmarkQuota() + "，超出时移除最早一条", cell: bookmarkCell, tier: "pro" },
  { key: "coursefree", name: "只温习自选", desc: "课内暂停，只排自选集合与新增温习", cell: courseFreeCell, tier: "pro" },
  { key: "dailypoem", name: "隐藏每日一诗", desc: "可在首页隐藏每日一诗卡片", tier: "pro" },
  { key: "sights", name: "大好河山主题", desc: "四张山水题名卡 · 每张带城景 banner", tier: "pro" },
  { key: "ownbanner", name: "自选主题 banner", desc: "使用自己的图片 · 仅存于本机", tier: "max" },
  { key: "themetone", name: "自选主题色", desc: "自选色相与明度 · 标题与按钮同步变化", tier: "max" },
  { key: "font", name: "字体", desc: "汇文明朝 · 寒蝉正楷，正文与题名同步更换", tier: "pro" },
  { key: "fsrs", name: "FSRS 自由间隔重复调度", desc: "难度 / 稳定性排期", tier: "max" },
  { key: "feihualing", name: "飞花令", desc: "以指定字轮流接句", tier: "max" },
  { key: "exam", name: "考试", desc: "限时 20 分钟，交卷后统一评分", tier: "max" },
  { key: "league", name: "排行榜", desc: "考试与飞花令成绩上榜，按学段排名", tier: "max" },
  { key: "records", name: "成绩记录", desc: "历次成绩上云 · " + tiers.recordQuota() + "，超出时移除最早一条", cell: recordCell, tier: "pro" }
];

function cellFor(cap, tier) {
  if (cap.cell) return cap.cell(tier, cap);
  return { text: "", on: rankOf(cap.tier) <= rankOf(tier) };
}

const CAP_KEYS = CAPS.map((c) => c.key);

function grant() {
  const g = store.read(store.KEYS.grant, null);
  if (!g || !g.code || !g.tier) return null;
  if (!tiers.isTier(g.tier)) return null;
  return { tier: g.tier, code: g.code, at: g.at || 0, source: "grant" };
}

function status() {
  const profile = store.profile();
  const server = auth.serverTier();

  if (tiers.isTier(server)) {
    return {
      tier: server,
      source: "remote",

      label: tiers.nameOf(server),
      blocked: "",
      signed: true
    };
  }

  const g = grant();
  if (g) {
    return { tier: g.tier, source: "grant", label: tiers.nameOf(g.tier), blocked: "", signed: false };
  }

  const local = profile && profile.tier;
  if (tiers.isTier(local) && rankOf(local) > rankOf("free")) {
    return {
      tier: "free",
      source: "none",
      label: tiers.nameOf("free"),
      blocked: "unsigned",
      signed: false
    };
  }

  const why = auth.offline();
  return {
    tier: "free",
    source: "none",
    label: tiers.nameOf("free"),
    blocked: why === "cloud" ? "cloud" : why === "off" ? "unsigned" : "",
    signed: false
  };
}

function loggedIn() {
  return auth.logged();
}

function switchedOff(key) {
  const s = store.read(store.KEYS.caps, null);
  return !!(s && s[key] === false);
}

function reachable(tier, now) {
  return rankOf(tier) > rankOf(now);
}

function can(key) {
  const cap = CAPS.find((c) => c.key === key);
  if (!cap) return false;

  if (!loggedIn()) return false;

  if (switchedOff(key)) return false;

  return rankOf(cap.tier) <= rankOf(status().tier);
}

function hint(key, ctx) {
  const in2 = ctx && ctx.signedIn !== undefined ? !!ctx.signedIn : loggedIn();

  if (isGuestOk(key)) return "";

  if (!in2) return "登录可用";

  const cap = CAPS.find((c) => c.key === key);
  if (!cap) return "功能不存在";
  if (can(key)) return "";
  if (switchedOff(key)) return "「" + cap.name + "」已关闭";
  const s = status();
  if (s.blocked === "cloud") return "同步服务未连接（云调用配置缺失或有误），进度仅存于本机";
  if (s.blocked === "unsigned") return "无法连接服务器，档位暂按 Free 计，请稍后重试";
  return tiers.nameOf(cap.tier) + " 起可用";
}

function compareCols(snap) {
  const now = tierNow(snap);
  return tiers.TIERS.map((t) => ({ tier: t.key, label: t.name, now: t.key === now }));
}

const VIEW_NAME = {
  daily: "首页·课内阅读",
  extra: "首页·新增温习",
  audio: "诗词音频",
  audioloop: "诗词音频·连播",
  collections: "首页·自选温习",
  progress: "首页·温习进度",
  dailypoem: "首页·每日一诗隐藏",
  ebbinghaus: "复习算法·艾宾浩斯",
  leitner: "复习算法·莱特纳盒",
  sm2: "复习算法·SM-2",
  fsrs: "复习算法·FSRS",
  library: "漫读·课内与诗词",
  novels: "漫读·名著小说",
  novelsettings: "漫读·正文排版",
  search: "全站搜索",
  quiz: "大会·题库",
  feihualing: "大会·飞花令",
  exam: "大会·考试",
  league: "大会·排行榜",
  records: "大会·成绩记录",
  sights: "主题·大好河山",
  ownbanner: "主题·自选 banner",
  themetone: "主题·自选主题色",
  font: "主题·字体选择",
  bookmarks: "漫读·书签",
  coursefree: "我的·只温习自选",
  sync: "我的·同步进度"
};

const COMPARE_ORDER = [
  "daily", "extra", "audio", "audioloop", "collections", "progress", "dailypoem",
  "library", "novels", "novelsettings", "bookmarks", "search",
  "ebbinghaus", "leitner", "sm2", "fsrs",
  "quiz", "feihualing", "exam", "records", "league",
  "sights", "ownbanner", "themetone", "font", "coursefree", "sync"
];

const SHARED_ROWS = { novelsettings: "pinyin" };

function capRow(key, cap, now) {
  return {
    cap: key,
    name: VIEW_NAME[key] || cap.name,
    cells: tiers.TIERS.map((t) => {
      const cell = cellFor(cap, t.key);
      return {
        tier: t.key,
        text: cell.text,
        now: t.key === now,
        on: !!cell.on
      };
    })
  };
}

function rowCap(key) {
  return CAPS.find((c) => c.key === (SHARED_ROWS[key] || key));
}

function claimed(key) {
  return COMPARE_ORDER.indexOf(key) >= 0 || Object.keys(SHARED_ROWS).some((k) => SHARED_ROWS[k] === key);
}

function compareRows(snap) {
  const s = snap || snapshot();
  const now = tierNow(s);
  const rows = [];
  COMPARE_ORDER.forEach((key) => {
    const cap = rowCap(key);
    if (!cap) return;
    rows.push(capRow(key, cap, now));
  });
  CAPS.forEach((c) => {
    if (!claimed(c.key)) rows.push(capRow(c.key, c, now));
  });
  return rows;
}

function compareSummary() {
  return tiers.TIERS.map((t) => ({
    tier: t.key,
    total: CAPS.length,
    on: CAPS.filter((c) => cellFor(c, t.key).on).length
  }));
}

function tierNow(snap) {
  const s = snap || snapshot();
  return s.logged ? s.tier : "";
}

function snapshot() {
  const s = status();
  const out = {
    tier: s.tier,
    source: s.source,
    label: s.label,
    blocked: s.blocked,
    signed: s.signed,
    logged: loggedIn(),
    caps: {}
  };
  CAPS.forEach((c) => {
    out.caps[c.key] = { ok: can(c.key), need: c.tier, name: c.name };
  });
  return out;
}

function sync() {
  if (!auth.configured()) return Promise.resolve(status());
  return auth
    .refresh()
    .then(() => status())
    .catch(() => status());
}

function algoAllowed(key) {
  if (key === "ebbinghaus") return can("daily") || can("ebbinghaus");
  if (key === "leitner") return can("leitner");
  return can(key);
}

const GUEST_GRADE = 1;

const CAN_GUEST = ["home.browse"];

function signedIn() {
  return auth.logged();
}

function isGuestOk(name) {
  return CAN_GUEST.indexOf(name) >= 0;
}

function decide(name, ctx) {
  const in2 = ctx && ctx.signedIn !== undefined ? !!ctx.signedIn : signedIn();

  if (isGuestOk(name)) {
    return { ok: true, reason: "ok", name: "首页浏览", login: false };
  }

  if (!in2) {
    const cap = CAPS.find((c) => c.key === name);
    return { ok: false, reason: "login", name: cap ? cap.name : name, login: true };
  }

  if (!CAPS.some((c) => c.key === name)) {
    return { ok: false, reason: "unknown", name: name, login: false };
  }

  return can(name) ? { ok: true, reason: "ok", name: capName(name), login: false }
                   : { ok: false, reason: "tier", name: capName(name), login: false };
}

function capName(key) {
  const cap = CAPS.find((c) => c.key === key);
  return cap ? cap.name : key;
}

function cap(key) {
  if (isGuestOk(key)) return { name: "首页浏览", login: false, tier: "guest" };
  const c = CAPS.find((x) => x.key === key);
  if (!c) return { name: key, login: true, tier: "free" };
  return { name: c.name, login: true, tier: c.tier };
}

function showLogin(name, ctx) {
  gate.open(() => onLoginGate(name, ctx), ctx);
}

function onLoginGate(name, ctx) {
  if (typeof ctx.onLoginGate === "function") ctx.onLoginGate(name);
  else if (typeof ctx.onLogin === "function") ctx.onLogin(name);
}

function openPricing(tier) {
  const url = "/packages/mine/pricing/pricing";
  if (!tiers.isTier(tier) || tier === "free") {
    wx.navigateTo({ url: url });
    return;
  }
  wx.navigateTo({ url: url + "?tier=" + tier });
}

function upgradeNote(need) {
  if (need === "max") return "已是 Pro？升级到 Max 即可解锁，Pro 剩余天数按实付价折算赠送。";
  return "";
}

function canReach(need) {
  return rankOf(need) > rankOf(status().tier);
}

function askTier(name, ctx) {
  const need = tierKey(name);

  if (!loggedIn()) return showLogin(name, ctx);

  if (!canReach(need)) return showTier(name, ctx);

  wx.showModal({
    title: "「" + capName(name) + "」需 " + tiers.nameOf(need) + " 档位",
    content: "开通 " + tiers.nameOf(need) + " 后可用。" + upgradeNote(need),
    confirmText: "开通 " + tiers.nameOf(need),
    cancelText: "取消",
    success: (res) => {
      if (res.confirm) openPricing(need);
    }
  });
}

function showTier(name, ctx) {
  if (can(name)) {
    wx.showModal({
      title: "请重新进入",
      content: "「" + capName(name) + "」已开通，重新进入该功能即可使用。",
      showCancel: false,
      confirmText: "知悉"
    });
    return;
  }
  const why = hint(name);
  const content = (why && why !== "登录可用" ? why + "。" : tierOf(name) + " 起可用。");

  wx.showModal({
    title: "权限不足",
    content: content,
    confirmText: "升级",
    cancelText: "取消",
    success: (res) => {
      if (!res.confirm) return;
      if (ctx && typeof ctx.onTierGate === "function") ctx.onTierGate(name);
      else openPricing();
    }
  });
}

function showTierToast(name) {
  wx.showToast({ title: tierOf(name) + " 起可用", icon: "none" });
}

function tierOf(name) {
  const cap = CAPS.find((c) => c.key === name);
  return tiers.nameOf(cap ? cap.tier : "pro");
}

function tierKey(name) {
  const cap = CAPS.find((c) => c.key === name);
  return cap ? cap.tier : "pro";
}

function block(name, opt) {
  const o = opt || {};
  const r = decide(name, o);
  if (r.ok) return true;
  if (o.silent) return false;

  const page = o.page;
  if (r.login) {
    if (o.loginPrompt === false || !page) {
      wx.showToast({ title: "「" + r.name + "」需登录后使用", icon: "none" });
      return false;
    }
    showLogin(name, page);
    return false;
  }

  if (o.loginPrompt === true && page) {
    showTier(name, page);
    return false;
  }
  showTierToast(name);
  return false;
}

function gateTier(name, opt) {
  const o = opt || {};
  if (decide(name, o).ok) return true;
  if (o.silent) return false;
  if (o.page && typeof o.page.onTierGate === "function") showTier(name, o.page);
  else showTierToast(name);
  return false;
}

function guestScope() {
  return { grade: GUEST_GRADE, term: 1, scope: "term", readOnly: true, title: "一年级诗词" };
}

module.exports = {
  CAPS,
  CAP_KEYS,
  compareCols,
  compareRows,
  compareSummary,
  SHARED_ROWS,
  TIER_RANK,
  rankOf,
  tierOf,
  tierKey,
  status,
  snapshot,
  reachable,
  can,
  hint,
  loggedIn,
  switchedOff,
  sync,
  algoAllowed,

  GUEST_GRADE,
  CAN_GUEST,
  signedIn,
  decide,
  capName,
  cap,
  block,
  gateTier,
  askTier,
  openPricing,
  guestScope
};
