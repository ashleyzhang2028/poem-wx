/**
 * 权限分层。与 poem 网页版 js/entitlement.js 同一张表，口径不漂。
 *
 * 四道门槛，从低到高：
 *   （未登录）  只能看首页目录，点不动 —— 见 utils/gate.js
 *   free       微信登录即得
 *   pro        管理员发放
 *   max        管理员发放
 *
 * ⚠️ 平台现实（这条决定了下面很多设计）：
 *   微信小程序**没有**「个人主体的付费能力」——虚拟支付只对企业主体开放。
 *   所以档位不能走微信支付，只能由管理员发放（后台改档 / 兑换码）。
 *   但本期 Issue 已经把话说死：**free / pro / max 不需要用户支付**，
 *   三档都是管理员在管理页里按人分的。所以「付费」两个字在界面上一律不出现。
 *
 * ⚠️ 档位的名字就是 Free / Pro / Max，不译成「免费 / 专业 / 全能」
 *   （见 tiers.js 顶上那段：用户 2026-10-05 要求「不要翻译」）。
 *
 * ⚠️ 客户端档位**不是安全边界**：改本机存储就能提档。它管的是「界面给谁看」，
 *   真正扣配额必须在服务端做。
 *   这一条曾经被写成一个后门：未登录时把所有人当 max（叫「本机宿主」），
 *   理由是「本机数据只属于本机」。它让「管理页给登录用户分级」变成空话 ——
 *   未登录反而拿得比 pro 多。现在付裆位只认服务端下发的档位（auth.serverTier()），
 *   拿不到就是 free，宁可少给。
 *
 * 另有一道**更低的门**：登录。未登录连 CAPS 里的表都不看 ——
 * 只能浏览首页列出的本册诗词（见 GUEST_GRADE / guestScope），
 * 点任何一篇都落到 block("recite.basic")，弹「去登录」。
 * 判定入口是 can()，它是唯一入口：界面不许自己拼「能不能用」，
 * 措辞也归 hint() —— 否则「为什么不能用」会散在十几个地方，口径早晚不一致。
 */
const store = require("./store");
const tiers = require("./tiers");
const auth = require("./auth");

/**
 * 能力表。**逐条对齐网页版 `js/entitlement.js` 的 CAPS**，档位一个都不许漂。
 *
 * 名字与网页版对不上（那边是 `algo.fsrs` 这种带命名空间的写法），这里简化成
 * 短 key；但 `tier` 必须一模一样 —— 同一份进度跨端同步，两端给出的档位
 * 不一致，用户会看到「网页版能用、小程序不能用」。
 *
 * 与网页版**故意不同**的只有三处，都写在下面各自那行的注释里：
 * 网页版 read.aloud 是 free+touch 登录，小程序端放到 pro（见 speak 那行）。
 *
 * 与网页版 `sync.multiDevice`（pro）对齐的那一条，这里的 key 叫 `sync`。
 *
 * 网页版有、小程序端**故意不做**的：`pinyin.helper`（注音勘误审核队列，
 * 依赖后端）、`export.paper`（PDF / 打印，小程序端做不了）、
 * `profile.family`（子用户，界面没做）、
 * `exam.*` 里的正式考试与文学常识考试（依赖后端组卷判分）。
 * 这些不在表里，就不该在界面上留入口 —— 列一个点不动的入口比没有更糟。
 */
const CAPS = [
  // free：登录之后就该有的
  { key: "daily", name: "每日背诵", desc: "按计划背今天这几首", tier: "free" },
  { key: "library", name: "课外阅读", desc: "十七部集子随选随读", tier: "free" },
  { key: "pinyin", name: "注音辅助", desc: "生字标音、多音字消歧", tier: "free" },
  { key: "ebbinghaus", name: "艾宾浩斯", desc: "固定间隔复习", tier: "free" },
  { key: "progress", name: "进度总览", desc: "未来七天排期与阶段分布", tier: "free" },
  { key: "search", name: "全站搜索", desc: "搜篇名 / 作者 / 朝代 / 出处 / 正文", tier: "free" },
  { key: "extra", name: "今日加背", desc: "今天想多背几首，自己加", tier: "free" },

  // login：免费档登录即得，不必等管理员发放
  { key: "speak", name: "语音朗读", desc: "正文朗读；需要 TTS 通道就绪", tier: "login" },
  { key: "export", name: "进度导出", desc: "整份数据复制成 JSON", tier: "login" },
  { key: "leitner", name: "莱特纳盒", desc: "分级盒子复习", tier: "login" },

  // 云端同步也在这一档。上一版它是 pro（服务端 syncTierGate 对 free 直接 403）。
  // 用户 2026-10-04 裁决改了这条边界：「同步功能只要用户登录就全部提供，
  // 确保用户数据不丢失，背诵进度换设备也能得到」。服务端那道闸要一起放开
  // （见 docs/wx-login-server.md「同步不再分档」）—— 只改一边，界面就会
  // 列出一个点下去必然被拒的入口，或者把能用的功能藏起来。
  { key: "sync", name: "同步进度", desc: "登录即得；换手机进度一字不少", tier: "login" },
  { key: "sm2", name: "SM-2", desc: "间隔 × 简易度", tier: "pro" },
  { key: "quiz", name: "题库", desc: "六种题型的练习与判分", tier: "pro" },
  { key: "collections", name: "自选清单", desc: "教材之外自己加篇目", tier: "pro" },
  { key: "admin", name: "管理页", desc: "管理员改用户档位与角色", tier: "pro" },

  // max：管理员发放
  { key: "fsrs", name: "FSRS", desc: "难度 / 稳定性排期", tier: "max" },
  { key: "feihualing", name: "飞花令", desc: "给一个字轮流接句", tier: "max" },
  { key: "exam", name: "考试", desc: "限时 20 分钟，交卷后统一批", tier: "max" }
];

const CAP_KEYS = CAPS.map((c) => c.key);

/**
 * 四道门槛的排序。未登录不给 rank，用 0 —— 它不在这个表里，
 * 而是「连门都没进」。之所以还要给它一个数，是为了让
 * `rankOf("login") > rankOf("free")` 这类比较有个一致的口径。
 */
const TIER_RANK = { free: 1, login: 2, pro: 3, max: 4 };

function rankOf(tier) {
  return TIER_RANK[tier] === undefined ? 0 : TIER_RANK[tier];
}

/** 服务端下发的档位是本机唯一可信来源；拿不到就是 free */
function tierOf(profile) {
  const server = auth.serverTier();
  if (tiers.isTier(server)) return server;
  // 本机档案里的 tier 只在**服务端确认过**之后才写（见 auth.login），
  // 所以这里读它不算「凭本机写入提档」
  const local = profile && profile.tier;
  return tiers.isTier(local) ? local : tiers.DEFAULT_TIER;
}

/** 临时提权：管理员发的兑换码，存在本机；真正的授权在服务端 */
function grant() {
  const g = store.read(store.KEYS.grant, null);
  if (!g || !g.code || !g.tier) return null;
  if (!tiers.isTier(g.tier)) return null;
  return { tier: g.tier, code: g.code, at: g.at || 0, source: "grant" };
}

/**
 * 当前有效授权。
 * @returns {{tier:string, source:string, label:string, blocked:string, signed:boolean}}
 *   source: remote（服务端）| grant（提权码）| none
 *   blocked: "unsigned" 表示本机自己写的档位不可信，已按 free 处理
 *   signed: 这一份档位是不是服务端给的 —— 管理页据此决定能不能改别人
 */
function status() {
  const profile = store.profile();
  const server = auth.serverTier();

  if (tiers.isTier(server)) {
    return {
      tier: server,
      source: "remote",
      // label 只有档名一个词（Free / Pro / Max）。
      // 曾经它写成「全能（服务端）」—— 档名、来源、角色挤成一串，
      // 用户 2026-10-04 原话是「这是什么意思，完全看不懂」；
      // 2026-10-05 又追了一句：来源与角色干脆都不要了。
      // 于是这里只剩档名，来源由管理页的 grant-tier-k 那句人话说，
      // 角色名不再进界面（谁能改档位，点下去的服务端判据说了算）。
      label: tiers.nameOf(server),
      blocked: "",
      signed: true
    };
  }

  // 提权码次之：它比本机档案明确，但没有服务端签名
  const g = grant();
  if (g) {
    return { tier: g.tier, source: "grant", label: tiers.nameOf(g.tier), blocked: "", signed: false };
  }

  // 到这里只剩本机档案。它有 tier 也只说明「服务端以前确认过」，
  // 现在连不上后端 —— 付费档一律降级，免得断网就成了免费提档。
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

/** 服务端下发的按人开关。没下发就按档位走 */
function switchedOff(key) {
  const s = store.read(store.KEYS.caps, null);
  return !!(s && s[key] === false);
}

/** 单条能力能不能用 */
function can(key) {
  const cap = CAPS.find((c) => c.key === key);
  if (!cap) return false;

  // 第一道闸：没登录什么都没有。这是 Issue 里那条「未登录只能浏览首页」的落点。
  if (!loggedIn()) return false;

  // 管理员按人关掉的，谁都别想用（包括 max）
  if (switchedOff(key)) return false;

  // login 不是一档档位，是「免费 + 登录」：它比 free 高一点，但不用等管理员。
  //
  // 同步就在这一类里。上一版它是 pro —— 因为服务端 `syncTierGate` 对 free
  // 直接 403（E_TIER，cap: sync.multiDevice）。用户 2026-10-04 裁决改了这条边界：
  //   「我现在是微信小程序项目……同步功能只要用户登录就全部提供，
  //     确保用户数据不丢失，背诵进度换设备也能得到」
  // 所以服务端那道闸要一起放开（见 docs/wx-login-server.md「同步不再分档」），
  // 客户端这里跟着改。两处必须同时改：只改一边，界面就会列出
  // 一个点下去必然被服务端拒的入口，或者反过来把能用的功能藏起来。
  // 所以先从门槛里把它摘出来单独判 —— 直接拿去跟 s.tier 比大小会把
  // 免费已登录的人挡掉（free 的 rank 是 1、login 是 2），而那正是自检里
  // 「登录后朗读可用」那条断言要守的东西。
  if (cap.tier === "login") {
    const s = status();
    // tiers.DEFAULT_ON 是「一登录就默认打开」的白名单（朗读 / 导出 / 莱特纳盒）。
    // 服务端真就绪后，这份白名单应当由档位接口下发，而不是躺在本地。
    if (tiers.DEFAULT_ON.indexOf(key) >= 0) return true;
    return rankOf(s.tier) >= rankOf("login");
  }

  const s = status();
  // ⚠️ 这里原来把两个操作数写反了（`rankOf(cap) <= rankOf(s)`），结果是
  //    「档位越高能用得越少」。三档之间看不出差别 —— 只有在自检里关掉宿主、
  //    真的按 profile 走时才暴露。宿主已经拆了，现在每一档都真的走这里。
  if (rankOf(cap.tier) > rankOf(s.tier)) return false;
  return true;
}

/**
 * 能力不可用时给人看的一句话。
 * 与 can() 的判据同源 —— 界面只负责显示，不自己拼措辞，
 * 否则「为什么不能用」会散在十几处，口径早晚不一致。
 */
function hint(key, ctx) {
  const in2 = ctx && ctx.signedIn !== undefined ? !!ctx.signedIn : loggedIn();

  // 免登录的那一条永远放行，它不跟着登录状态走
  if (isGuestOk(key)) return "";

  // 未登录时，不管是哪一条，答案都一样：先登录
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

/** 自己提权，验证码只验形状，真伪在服务端 */
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

/**
 * 应用启动时刷一次档位。
 * 没配后端就什么都不做 —— 界面继续按本机已有的（多半是 free）渲染，
 * 不假装拿到了更高的档。
 */
function sync() {
  if (!auth.configured()) return Promise.resolve(status());
  return auth
    .refresh()
    .then(() => status())
    .catch(() => status());
}

/**
 * 能力 ↔ 复习算法 / 设置项的映射，供设置页与自检共用。
 * 设置页如果直接数 R.list() 的四套算法而不看这里，
 * 就会出现「点了 FSRS 提示已保存、实际每次都被门禁挡回」的假存活。
 */
function algoAllowed(key) {
  if (key === "ebbinghaus") return can("daily") || can("ebbinghaus");
  if (key === "leitner") return can("leitner");
  return can(key);
}

/* ============================================================
   登录这道门：未登录只能浏览首页。
   ============================================================

   上面那一整套（free / pro / max）说的是「登录之后能给到哪一档」。
   这一段说的是**更前面的一件事**：连门都没进的时候给什么。

   口径来自 Issue：**不登录用户只能浏览首页，首页默认列出一年级诗词，
   无法点击**。所以游客唯一能做的是「看首页列出的那些」，
   其余每一个入口都要落到 block() 上 —— 分享卡片与深链能绕过首页直达
   详情页，所以没有哪个入口能靠「用户不会那么点」守住。

   与网页版的差异：那边能力表带 `minTier`（游客 / Free / Pro / Max 四列），
   小程序端**下限不是档位，是登录**。`CAN_GUEST` 就是那张「免登录清单」，
   有且只有一项 —— 自检按它断言，谁想悄悄开个口子会当场红。
*/

/** 游客在首页唯一能看的范围：本册，即一年级 */
const GUEST_GRADE = 1;

/** 免登录的能力，一条不多 */
const CAN_GUEST = ["home.browse"];

/**
 * 权限说明页的展示顺序：免登录那一项在最前，其余按「背诵 → 读 → 记」排。
 * 每一项都对应 CAPS 里的一条 key —— 两处对不上，自检会红。
 */
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

/** 当前登录状态。页面里一律走这个，不各自 require auth */
function signedIn() {
  return auth.logged();
}

/** 这一条是不是免登录的 */
function isGuestOk(name) {
  return CAN_GUEST.indexOf(name) >= 0;
}

/**
 * 一条能力此刻能不能用。
 *
 * 入参可以是 CAPS 里的短 key（`daily`），也可以是 `home.browse` 这种
 * 带点的名字 —— 后者是「游客也能用的那一项」的写法，它不在档位表里。
 * 两种写法都从这里进，是因为调用方不该关心「这条能力在不在档位表里」：
 * 它要问的是「能不能用」，而这是一件事。
 *
 * @returns {{ok:boolean, reason:string, name:string, login:boolean}}
 *   reason: "ok" | "login" | "unknown" | "tier" | "switched-off" | "unsigned"
 */
function decide(name, ctx) {
  const in2 = ctx && ctx.signedIn !== undefined ? !!ctx.signedIn : signedIn();

  // 免登录的那一条：不管登没登录都给
  if (isGuestOk(name)) {
    return { ok: true, reason: "ok", name: "首页浏览", login: false };
  }

  // 第一道闸：没登录什么都没有
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

/** 能力名。找不到就给 key 本身，界面至少不会空着 */
function capName(key) {
  const cap = CAPS.find((c) => c.key === key);
  return cap ? cap.name : key;
}

/**
 * 一条能力的门槛。权限说明页据此写「登录可用 / 不需登录」那一列。
 *
 * 返回 `{ name, login, tier }`：`login` 说的是「这条要登录」，
 * 免登录的那一条（home.browse）它是 false —— 两个字面量都用得上，
 * 所以这里不返回布尔，返回整条记录，免得调用方各拼一次。
 */
function cap(key) {
  if (isGuestOk(key)) return { name: "首页浏览", login: false, tier: "guest" };
  const c = CAPS.find((x) => x.key === key);
  if (!c) return { name: key, login: true, tier: "free" };
  return { name: c.name, login: true, tier: c.tier };
}

/**
 * 门禁。放行返回 true；挡下返回 false 并提示。
 *
 *   if (!E.block("recite.basic", { page: this })) return;
 *
 * 页面实现 onLoginGate(name) 就能接上「去登录」；
 * 没实现时只给一句 toast，不弹空窗 —— 一个点了没反应的确认框比什么都没有更糟。
 */
function block(name, opt) {
  const o = opt || {};
  const r = decide(name, o);
  if (r.ok) return true;
  if (o.silent) return false;

  const text = hint(name, o);

  // 首页是游客唯一能落脚的地方，弹「去登录」反而挡住了唯一的路
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

/** 权限页：一条条列「这项此刻能不能用」 */
function matrix(ctx) {
  return ORDER.map((row) => {
    const r = decide(row.key, ctx);
    return { cap: row.cap, name: row.name, ok: r.ok, hint: hint(row.key, ctx) };
  });
}

/** 游客首页的范围：本册、只读。首页据此决定排什么、能不能点 */
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
  // 登录这道门
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
