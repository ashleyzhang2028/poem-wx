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
  if (!n) return { text: "", note: "", on: false };
  return { text: "", note: n + " 个集合", on: true };
}

function courseFreeCell(tier) {
  const on = rankOf(tier) >= rankOf("pro");
  return { text: "", note: "", on: on };
}

const CAPS = [
  { key: "daily", name: "每日背诵", desc: "按计划背今天这几首", tier: "free" },
  { key: "library", name: "课外阅读", desc: "十七部集合随选随读", tier: "free" },
  { key: "pinyin", name: "注音辅助", desc: "生字标音、多音字消歧", tier: "free" },
  { key: "ebbinghaus", name: "艾宾浩斯 Ebbinghaus", desc: "固定间隔复习", tier: "free" },
  { key: "progress", name: "进度总览", desc: "未来七天排期与阶段分布", tier: "free" },
  { key: "search", name: "全站搜索", desc: "搜篇名 / 作者 / 朝代 / 出处 / 正文", tier: "free" },
  { key: "extra", name: "今日加背", desc: "今天想多背几首，自己加", tier: "pro" },
  { key: "leitner", name: "莱特纳盒 Leitner Box", desc: "分级盒子复习", tier: "pro" },

  { key: "sync", name: "同步进度", desc: "进度与设置跟着微信账号走", tier: "free" },
  { key: "sm2", name: "SM-2 SuperMemo 2", desc: "间隔 × 简易度", tier: "pro" },
  { key: "quiz", name: "题库", desc: "六种题型的练习与判分", tier: "pro" },
  { key: "collections", name: "自选背诵", desc: "自定义集合 · " + tiers.collectionQuota(), cell: collectionCell, tier: "pro" },
  { key: "coursefree", name: "只背自选", desc: "课内暂停，只排自选集合与今日加背", cell: courseFreeCell, tier: "pro" },
  { key: "seasonal", name: "隐藏季节限定", desc: "首页那张季节限定卡可以自己收起来", tier: "pro" },
  { key: "sights", name: "大好河山主题", desc: "四张山水题名卡 · 每张带城景 banner", tier: "pro" },
  { key: "font", name: "字体", desc: "汇文明朝 · 寒蝉正楷，正文题名一起换", tier: "pro" },
  { key: "fsrs", name: "FSRS 自由间隔重复调度", desc: "难度 / 稳定性排期", tier: "max" },
  { key: "feihualing", name: "飞花令", desc: "给一个字轮流接句", tier: "max" },
  { key: "exam", name: "考试", desc: "限时 20 分钟，交卷后统一批", tier: "max" }
];

function cellFor(cap, tier) {
  if (cap.cell) return cap.cell(tier);
  const on = rankOf(cap.tier) <= rankOf(tier);
  return { text: "", note: "", on: on };
}

const CAP_KEYS = CAPS.map((c) => c.key);

function tierOf(profile) {
  const server = auth.serverTier();
  if (tiers.isTier(server)) return server;

  const local = profile && profile.tier;
  return tiers.isTier(local) ? local : tiers.DEFAULT_TIER;
}

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
  if (!cap) return "这个功能不存在";
  if (can(key)) return "";
  if (switchedOff(key)) return "管理员把「" + cap.name + "」关掉了";
  const s = status();
  if (s.blocked === "cloud") return "还没接上同步服务器（云调用两栏没填或填错了）—— 进度只在这台手机";
  if (s.blocked === "unsigned") return "连不上服务器，档位暂按 Free 算，稍后再试";
  return cap.name + "需要 " + tiers.nameOf(cap.tier) + " 权限";
}

function compareCols(snap) {
  const now = tierNow(snap);
  return tiers.TIERS.map((t) => ({ tier: t.key, label: t.name, now: t.key === now }));
}

const COMPARE_NAME = {
  ebbinghaus: "复习算法·艾宾浩斯",
  leitner: "复习算法·莱特纳盒",
  sm2: "复习算法·SM-2",
  fsrs: "复习算法·FSRS"
};

const VIEW_NAME = {
  quiz: "古诗文大会·题库",
  feihualing: "古诗文大会·飞花令",
  exam: "古诗文大会·考试"
};

function viewNameOf(cap) {
  return VIEW_NAME[cap.key] || cap.name;
}

function compareNameOf(cap) {
  return COMPARE_NAME[cap.key] || viewNameOf(cap);
}

function splitName(name) {
  const cut = name.indexOf(" ");
  if (cut < 0) return { name: name, en: "" };
  return { name: name.slice(0, cut), en: name.slice(cut + 1) };
}

function compareRows(snap) {
  const s = snap || snapshot();
  return CAPS.map((c) => Object.assign({ cap: c.key }, splitName(compareNameOf(c)), {
    cells: tiers.TIERS.map((t) => {
      const cell = cellFor(c, t.key);
      return {
        tier: t.key,
        text: cell.text,
        note: cell.note || "",
        now: t.key === tierNow(s),
        on: !!cell.on
      };
    })
  }));
}

function compareSummary() {
  return tiers.TIERS.map((t) => ({
    tier: t.key,
    total: CAPS.length,
    on: CAPS.filter((c) => rankOf(c.tier) <= rankOf(t.key)).length
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

function redeem(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^(PRO|MAX)-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c)) {
    return { ok: false, msg: "提权码格式不对，形如 PRO-XXXX-XXXX" };
  }
  store.write(store.KEYS.grant, { code: c, tier: c.slice(0, 3).toLowerCase(), at: Date.now() });
  return { ok: true, tier: c.slice(0, 3).toLowerCase() };
}

function revoke() {
  store.drop(store.KEYS.grant);
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
  else ctx.onLogin();
}

function showTier(name, ctx) {
  const why = hint(name);
  const content = can(name)
    ? "「" + capName(name) + "」现在是开着的，重新进一次这个功能就行。"
    : (why && why !== "登录可用" ? why + "。" : "「" + capName(name) + "」需要 " + tierNeed(name) + " 权限。")
      + "\n\n可用的档位与逐项对照在用户权限页。";

  wx.showModal({
    title: capName(name),
    content: content,
    confirmText: "升级",
    cancelText: "取消",
    success: (res) => {
      if (res.confirm && ctx && typeof ctx.onTierGate === "function") ctx.onTierGate(name);
    }
  });
}

function showTierToast(name) {
  wx.showToast({ title: "「" + capName(name) + "」需要 " + tierNeed(name) + " 权限", icon: "none" });
}

function tierNeed(name) {
  const cap = CAPS.find((c) => c.key === name);
  return tiers.nameOf(cap ? cap.tier : "pro");
}

function block(name, opt) {
  const o = opt || {};
  const r = decide(name, o);
  if (r.ok) return true;
  if (o.silent) return false;

  const page = o.page;
  if (r.login) {
    if (o.loginPrompt === false || !page) {
      wx.showToast({ title: "登录" + hint(name, o) + "后可用", icon: "none" });
      return false;
    }
    showLogin(name, page);
    return false;
  }

  if (o.loginPrompt === false || !page || typeof page.onTierGate !== "function") {
    showTierToast(name);
    return false;
  }
  showTier(name, page);
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

function openTierPage() {
  wx.navigateTo({ url: "/packages/mine/tier/tier" });
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
  TIER_RANK,
  rankOf,
  tierOf,
  status,
  snapshot,
  can,
  hint,
  loggedIn,
  switchedOff,
  redeem,
  revoke,
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
  openTierPage,
  guestScope
};
