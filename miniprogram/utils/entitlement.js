/**
 * 权限分层。与 poem 网页版 js/entitlement.js 同一张表，口径不漂。
 *
 * 三档：free / pro / max，外加一个「登录」门槛 —— 有的能力免费但要求登录。
 *
 * ⚠️ 平台现实（这条决定了下面很多设计）：
 *   微信小程序**没有**「个人主体的付费能力」——虚拟支付只对企业主体开放。
 *   所以付费档位不能走微信支付，只能由管理员发放（兑换码 / 后台改档）。
 *   tiers.js 里写的「管理页签发」，指的是这个，不是小程序内下单。
 *
 * ⚠️ 客户端档位**不是安全边界**：改本机存储就能提档。它管的是「界面给谁看」，
 *   真正扣配额必须在服务端做。所以云端就绪前，付费能力一律按未授权处理。
 */
const store = require("./store");
const tiers = require("./tiers");

/**
 * 能力表。**逐条对齐网页版 `js/entitlement.js` 的 CAPS**，档位一个都不许漂。
 *
 * 名字与网页版对不上（那边是 `algo.fsrs` 这种带命名空间的写法），这里简化成
 * 短 key；但 `tier` 必须一模一样 —— 同一份进度跨端同步，两端给出的档位
 * 不一致，用户会看到「网页版能用、小程序不能用」。
 *
 * 自检里那条「档位与网页版一致」就是守这个：FSRS 曾经在这里写成 pro，
 * 而网页版是 max，属于会真实惹事的那种漂移。
 *
 * 网页版有、小程序端**故意不做**的：`pinyin.helper`（注音勘误审核队列，
 * 依赖后端）、`export.paper`（PDF / 打印，小程序端做不了）、
 * `profile.family`（子用户，界面没做）、`sync.multiDevice`（并进 sync 语义）、
 * `exam.*` 里的正式考试与文学常识考试（依赖后端组卷判分）。
 * 这些不在表里，就不该在界面上留入口 —— 列一个点不动的入口比没有更糟。
 */
const CAPS = [
  { key: "daily", name: "每日背诵", desc: "按计划背今天这几首", tier: "free" },
  { key: "library", name: "课外阅读", desc: "十七部集子随选随读", tier: "free" },
  { key: "ebbinghaus", name: "艾宾浩斯", desc: "固定间隔复习", tier: "free" },
  { key: "progress", name: "进度总览", desc: "未来七天排期与阶段分布", tier: "free" },
  { key: "search", name: "全站搜索", desc: "搜篇名 / 作者 / 朝代 / 出处 / 正文", tier: "free" },
  { key: "export", name: "进度导出", desc: "整份数据复制成 JSON", tier: "login" },
  { key: "leitner", name: "莱特纳盒", desc: "分级盒子复习", tier: "login" },
  { key: "speak", name: "语音朗读", desc: "正文朗读；需管理员发授权", tier: "login" },
  { key: "sm2", name: "SM-2", desc: "间隔 × 简易度", tier: "pro" },
  { key: "collections", name: "自选清单", desc: "教材之外自己加篇目", tier: "pro" },
  { key: "quiz", name: "题库", desc: "六种题型的练习与判分", tier: "pro" },
  { key: "admin", name: "管理页", desc: "管理员改用户档位", tier: "pro" },
  // 与网页版对齐：FSRS 与飞花令、模拟考试同档（都是 max）
  { key: "fsrs", name: "FSRS", desc: "难度 / 稳定性排期", tier: "max" },
  { key: "feihualing", name: "飞花令", desc: "给一个字轮流接句", tier: "max" },
  { key: "exam", name: "模拟考试", desc: "限时 20 分钟，交卷后统一批", tier: "max" }
];

const CAP_KEYS = CAPS.map((c) => c.key);

const TIER_RANK = { free: 0, login: 1, pro: 2, max: 3 };

function rankOf(tier) {
  return TIER_RANK[tier] === undefined ? 0 : TIER_RANK[tier];
}

function tierOf(profile) {
  const t = profile && profile.tier;
  return tiers.isTier(t) ? t : tiers.DEFAULT_TIER;
}

/**
 * 宿主。本机没登录时所有能力都可用 —— 本机数据只属于本机。
 * 这是网页版「不注册也能用全部功能」那条边界在小程序端的落点，
 * 也是下面 speech() 用「宿主可用性」而不是「授权档位」决定界面显隐的原因。
 */
function host() {
  if (!tiers.hosted()) return null;
  return { tier: "max", source: "host", local: true };
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
 * @returns {{tier:string, source:string, label:string, blocked:string}}
 *   source: host（本机）| grant（提权码）| remote（服务端，未接）| none
 *   blocked: "local" 表示后台离线、付费档按未授权处理
 */
function status() {
  const h = host();
  if (h) return { tier: h.tier, source: "host", label: "本机宿主", blocked: "" };

  const profile = store.profile();
  const tier = tierOf(profile);

  // 提权码先看：它是最本机、也最明确的一条来源 —— 管理页改档、兑换码都落在它上面。
  const g = grant();
  if (g) return { tier: g.tier, source: "grant", label: tiers.nameOf(g.tier), blocked: "" };

  // 付费档：后台拿不到档位就别假装能用。免费与登录档照常。
  if (rankOf(tier) >= TIER_RANK.pro) {
    return { tier: "free", source: "none", label: tiers.nameOf("free"), blocked: "local" };
  }

  return { tier, source: profile.logged ? "profile" : "none", label: tiers.nameOf(tier), blocked: "" };
}

function loggedIn() {
  return !!(store.profile().logged || host());
}

/** 单条能力能不能用 */
function can(key) {
  const cap = CAPS.find((c) => c.key === key);
  if (!cap) return false;
  const s = status();
  // login 不是一档档位，是「免费 + 登录」：它比 free 高一点，但不用付费。
  // 所以先从门槛里把它摘出来单独判 —— 直接拿去跟 s.tier 比大小会把
  // 免费已登录的人挡掉（free 的 rank 是 0、login 是 1），而那正是自检里
  // 「登录后朗读可用」那条断言要守的东西。
  if (cap.tier === "login") {
    // tiers.DEFAULT_ON 是「一登录就默认打开」的白名单（朗读 / 导出 / 莱特纳盒）。
    // 服务端真就绪后，这份白名单应当由档位接口下发，而不是躺在本地。
    if (tiers.DEFAULT_ON.indexOf(key) >= 0) return loggedIn();
    return rankOf(s.tier) >= rankOf("login");
  }

  // 付费档：门槛高于当前档位就是不能用。
  // ⚠️ 这里原来把两个操作数写反了（`rankOf(cap) <= rankOf(s)`），结果是
  //    「档位越高能用得越少」：免费档反而把付费能力全判成可用，而 pro / max
  //    又被 free 门槛的能力挡掉。三档之间看不出差别 —— 只有在自检里关掉宿主、
  //    真的按 profile 走时才暴露。
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
  // login 门槛的能力：档位够了、只差登录，就说登录，不要说「需要免费档」
  if (cap.tier === "login") {
    if (!loggedIn()) return "登录后可用";
    return "「" + cap.name + "」要管理员发放授权后开放";
  }
  const s = status();
  if (s.blocked === "local") return "本机授权不能当付费授权用，需管理员发放";
  return "「" + cap.name + "」需要「" + tiers.nameOf(cap.tier) + "」档";
}

function snapshot() {
  const s = status();
  const out = { tier: s.tier, source: s.source, label: s.label, blocked: s.blocked, caps: {} };
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

/** 应用启动时刷一次档位。没配后端就什么都不做，界面继续按本机授权渲染。 */
function sync() {
  return Promise.resolve(status());
}

/**
 * 能力 ↔ 复习算法 / 设置项的映射，供设置页与自检共用。
 * 设置页如果直接数 R.list() 的四套算法而不看这里，
 * 就会出现「点了 FSRS 提示已保存、实际每次都被门禁挡回」的假存活。
 */
function algoAllowed(key) {
  if (key === "ebbinghaus") return true;
  if (key === "leitner") return can("leitner");
  return can(key);
}

module.exports = {
  CAPS,
  CAP_KEYS,
  TIER_RANK,
  rankOf,
  tierOf,
  outputTier: null,
  status,
  snapshot,
  can,
  hint,
  loggedIn,
  redeem,
  revoke,
  sync,
  algoAllowed,
  host
};
