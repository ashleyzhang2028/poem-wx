const store = require("./store");
const tiers = require("./tiers");
const auth = require("./auth");

const CAPS = [

  { key: "daily", name: "每日背诵", desc: "按计划背今天这几首", tier: "free" },
  { key: "library", name: "课外阅读", desc: "十七部集子随选随读", tier: "free" },
  { key: "pinyin", name: "注音辅助", desc: "生字标音、多音字消歧", tier: "free" },
  { key: "ebbinghaus", name: "艾宾浩斯", desc: "固定间隔复习", tier: "free" },
  { key: "progress", name: "进度总览", desc: "未来七天排期与阶段分布", tier: "free" },
  { key: "search", name: "全站搜索", desc: "搜篇名 / 作者 / 朝代 / 出处 / 正文", tier: "free" },
  { key: "extra", name: "今日加背", desc: "今天想多背几首，自己加", tier: "free" },

  { key: "speak", name: "语音朗读", desc: "正文朗读；需要 TTS 通道就绪", tier: "login" },
  { key: "export", name: "进度导出", desc: "整份数据复制成 JSON", tier: "login" },
  { key: "leitner", name: "莱特纳盒", desc: "分级盒子复习", tier: "login" },

  { key: "sync", name: "同步进度", desc: "登录即得；换手机进度一字不少", tier: "login" },
  { key: "sm2", name: "SM-2", desc: "间隔 × 简易度", tier: "pro" },
  { key: "quiz", name: "题库", desc: "六种题型的练习与判分", tier: "pro" },
  { key: "collections", name: "自选清单", desc: "教材之外自己加篇目", tier: "pro" },
  { key: "admin", name: "管理页", desc: "管理员改用户档位与角色", tier: "pro" },

  { key: "fsrs", name: "FSRS", desc: "难度 / 稳定性排期", tier: "max" },
  { key: "feihualing", name: "飞花令", desc: "给一个字轮流接句", tier: "max" },
  { key: "exam", name: "考试", desc: "限时 20 分钟，交卷后统一批", tier: "max" }
];

const CAP_KEYS = CAPS.map((c) => c.key);

const TIER_RANK = { free: 1, login: 2, pro: 3, max: 4 };

function rankOf(tier) {
  return TIER_RANK[tier] === undefined ? 0 : TIER_RANK[tier];
}

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

  return { tier: "free", source: "none", label: tiers.nameOf("free"), blocked: "", signed: false };
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

  if (cap.tier === "login") {
    const s = status();

    if (tiers.DEFAULT_ON.indexOf(key) >= 0) return true;
    return rankOf(s.tier) >= rankOf("login");
  }

  const s = status();

  if (rankOf(cap.tier) > rankOf(s.tier)) return false;
  return true;
}

function hint(key, ctx) {
  const in2 = ctx && ctx.signedIn !== undefined ? !!ctx.signedIn : loggedIn();

  if (isGuestOk(key)) return "";

  if (!in2) return "登录后可用";

  const cap = CAPS.find((c) => c.key === key);
  if (!cap) return "这个功能不存在";
  if (can(key)) return "";
  if (switchedOff(key)) return "管理员把「" + cap.name + "」关掉了";
  if (cap.tier === "login") return "「" + cap.name + "」要登录后才有";
  const s = status();
  if (s.blocked === "unsigned") return "连不上服务器，档位暂按 Free 算，稍后再试";
  return "「" + cap.name + "」需要 " + tiers.nameOf(cap.tier) + " 档";
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
    out.caps[c.key] = { ok: can(c.key), need: c.tier, name: c.name, desc: c.desc };
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

const ORDER = [
  { key: "home.browse", cap: "home.browse", name: "首页浏览" },
  { key: "daily", cap: "daily", name: "每日背诵" },
  { key: "library", cap: "library", name: "课外阅读" },
  { key: "pinyin", cap: "pinyin", name: "注音辅助" },
  { key: "ebbinghaus", cap: "ebbinghaus", name: "艾宾浩斯" },
  { key: "leitner", cap: "leitner", name: "莱特纳盒" },
  { key: "speak", cap: "speak", name: "语音朗读" },
  { key: "export", cap: "export", name: "进度导出" }
];

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

function block(name, opt) {
  const o = opt || {};
  const r = decide(name, o);
  if (r.ok) return true;
  if (o.silent) return false;

  const text = hint(name, o);

  if (o.loginPrompt === false || !o.page || typeof o.page.onLoginGate !== "function") {
    wx.showToast({ title: text, icon: "none" });
    return false;
  }

  wx.showModal({
    title: r.name + " · " + text,
    content: o.content || "登录只是开个门。进度仍然只存在这台手机上。",
    confirmText: "去登录",
    cancelText: "再看看",
    success: (res) => {
      if (res.confirm) o.page.onLoginGate(name);
    }
  });
  return false;
}

function matrix(ctx) {
  return ORDER.map((row) => {
    const r = decide(row.key, ctx);
    return { cap: row.cap, name: row.name, ok: r.ok, hint: hint(row.key, ctx) };
  });
}

function guestScope() {
  return { grade: GUEST_GRADE, term: 1, scope: "term", readOnly: true, title: "一年级诗词" };
}

module.exports = {
  CAPS,
  CAP_KEYS,
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
  ORDER,
  signedIn,
  decide,
  capName,
  cap,
  block,
  matrix,
  guestScope
};
