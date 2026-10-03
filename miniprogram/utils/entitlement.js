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
 * ⚠️ 客户端档位**不是安全边界**：改本机存储就能提档。它管的是「界面给谁看」，
 *   真正扣配额必须在服务端做。
 *   这一条曾经被写成一个后门：未登录时把所有人当 max（叫「本机宿主」），
 *   理由是「本机数据只属于本机」。它让「管理页给登录用户分级」变成空话 ——
 *   未登录反而拿得比 pro 多。现在付裆位只认服务端下发的档位（auth.serverTier()），
 *   拿不到就是 free，宁可少给。
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

  // login：免费档登录即得，不必等管理员发放
  { key: "speak", name: "语音朗读", desc: "正文朗读；需要 TTS 通道就绪", tier: "login" },
  { key: "export", name: "进度导出", desc: "整份数据复制成 JSON", tier: "login" },
  { key: "leitner", name: "莱特纳盒", desc: "分级盒子复习", tier: "login" },

  // pro：管理员发放
  // 云同步是 pro —— **这条是服务端定的**，不是这边客气。
  // poem 的 syncTierGate 对 free 直接 403（E_TIER，cap: sync.multiDevice）。
  // 所以界面必须在 free 档就把「云端同步」这件事说清楚：现在写的是本机进度，
  // 攒着不上传。列一个点下去必然被服务端拒的入口，比不列更糟。
  { key: "sync", name: "云端同步", desc: "换手机不丢进度；要 Pro 起", tier: "pro" },
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
      label: tiers.nameOf(server) + "（服务端）",
      blocked: "",
      signed: true
    };
  }

  // 提权码次之：它比本机档案明确，但没有服务端签名
  const g = grant();
  if (g) {
    return { tier: g.tier, source: "grant", label: tiers.nameOf(g.tier) + "（授权码）", blocked: "", signed: false };
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
function hint(key) {
  const cap = CAPS.find((c) => c.key === key);
  if (!cap) return "这个功能不存在";
  if (can(key)) return "";
  if (!loggedIn()) return "登录后可用";
  if (switchedOff(key)) return "管理员把「" + cap.name + "」关掉了";
  if (cap.tier === "login") return "「" + cap.name + "」要管理员发放授权后开放";
  const s = status();
  if (s.blocked === "unsigned") return "连不上服务器，档位暂按免费算，稍后再试";
  return "「" + cap.name + "」需要「" + tiers.nameOf(cap.tier) + "」档";
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
  algoAllowed
};
