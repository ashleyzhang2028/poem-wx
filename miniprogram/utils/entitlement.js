/**
 * 能力与门槛。
 *
 * 口径：**不登录只能浏览首页**——首页默认列出一（本册）诗词，
 * 看得见、点不动。其余能力一律登录可用，登录即全开。
 *
 * 为什么不带 tier：网页版那套 free/pro/max 是给「按账号卖额度」用的。
 * 小程序端的进度只存在本机，档位没有可以收钱的对手方，
 * 摆在那里只会让人以为「登录了还分三六九等」。所以这里只留一道门：登录。
 *
 * 表的结构仍与网页版 js/entitlement.js 的 CAPS 对齐（能力 key 同名），
 * 以后真要分层，加一个 minTier 字段即可，不必重写调用方。
 */
const auth = require("./auth");

const CAPS = {
  "home.browse": { name: "首页浏览", login: false },
  "recite.basic": { name: "每日背诵", login: true },
  "library.all": { name: "课外阅读", login: true },
  "pinyin.helper": { name: "注音辅助", login: true },
  "algo.ebbinghaus": { name: "艾宾浩斯遗忘曲线", login: true },
  "read.aloud": { name: "语音朗读", login: true },
  "algo.leitner": { name: "莱特纳盒", login: true },
  "export.progress": { name: "进度导出", login: true }
};

/** 权限页的展示顺序：唯一免登录的那项在最前 */
const ORDER = [
  "home.browse",
  "recite.basic",
  "library.all",
  "pinyin.helper",
  "algo.ebbinghaus",
  "read.aloud",
  "algo.leitner",
  "export.progress"
];

/** 游客在首页只看到本册，即一年级 */
const GUEST_GRADE = 1;

function cap(name) {
  return CAPS[name] || null;
}

function signedIn() {
  return auth.logged();
}

/**
 * 判定一个能力。
 * ctx 可传 { signedIn } 覆盖，便于自检与权限页在不碰 wx 的情况下渲染。
 */
function can(name, ctx) {
  const c = cap(name);
  if (!c) return { ok: false, reason: "unknown", name: "", login: false };
  const in2 = ctx && ctx.signedIn !== undefined ? !!ctx.signedIn : signedIn();
  if (c.login && !in2) return { ok: false, reason: "login", name: c.name, login: true };
  return { ok: true, reason: "ok", name: c.name, login: !!c.login };
}

/** 「登录后可用」/「可用」，权限页与提示语共用一句 */
function hint(name, ctx) {
  const r = can(name, ctx);
  if (r.ok) return "可用";
  if (r.reason === "unknown") return "暂不可用";
  return "登录后可用";
}

/**
 * 门禁。放行返回 true；挡下返回 false 并提示。
 *
 *   if (!E.block("read.aloud", { page: this })) return;
 *
 * 页面实现 onLoginGate(name) 就能接上「去登录」按钮，
 * 没实现时只给一句 toast，不弹空窗。
 */
function block(name, opt) {
  const o = opt || {};
  const r = can(name, o);
  if (r.ok) return true;
  if (o.silent) return false;

  const text = hint(name, o);

  // 首页是游客唯一能落脚的地方，弹「去登录」反而挡住了唯一的路
  if (o.loginPrompt === false || !o.page || typeof o.page.onLoginGate !== "function") {
    wx.showToast({ title: text, icon: "none" });
    return false;
  }

  wx.showModal({
    title: (cap(name) ? cap(name).name : "该功能") + " · " + text,
    content: o.content || "登录只是开个门。进度仍然只存在这台手机上。",
    confirmText: "去登录",
    cancelText: "再看看",
    success: (res) => {
      if (res.confirm) o.page.onLoginGate(name);
    }
  });
  return false;
}

/** 权限页：能力 + 当前是否可用 */
function matrix(ctx) {
  return ORDER.map((key) => {
    const c = CAPS[key];
    const r = can(key, ctx);
    return { cap: key, name: c.name, ok: r.ok, hint: hint(key, ctx) };
  });
}

/** 游客首页的范围：本册、只读。首页据此决定排什么、能不能点 */
function guestScope() {
  return { grade: GUEST_GRADE, term: 1, scope: "term", readOnly: true, title: "一年级诗词" };
}

module.exports = {
  CAPS,
  ORDER,
  GUEST_GRADE,
  cap,
  can,
  block,
  hint,
  matrix,
  signedIn,
  guestScope
};
