/**
 * 档位表。
 *
 * 单独成一个文件，是因为 entitlement.js 要能在 Node 自检里直接跑 ——
 * 构建时（scripts/）也需要这份档位表去生成名录。
 * 这个文件不许碰 wx，也不许 require 别的模块。
 *
 * ⚠️ 这里曾经有一个 `hosted()` 开关：未登录时把所有人当 max，
 *   理由写的是「本机数据只属于本机」。那条口子撤了 ——
 *   它让「管理页给登录用户分级」变成一句空话：未登录的人拿到的
 *   比 pro 还多。现在的边界只有一条：**能进门，不能白用**。
 */

const TIERS = [
  { key: "free", name: "免费", sub: "微信登录即得", rank: 1 },
  { key: "pro", name: "专业", sub: "管理员发放", rank: 2 },
  { key: "max", name: "全能", sub: "管理员发放", rank: 3 }
];

const DEFAULT_TIER = "free";

const TIER_KEYS = TIERS.map((t) => t.key);

/**
 * 一登录就默认打开的能力。
 *
 * 这三样是「免费档也要有」的那部分（Issue 里点名的：语音朗读 / 莱特纳盒 / 进度导出），
 * 所以它们不是 pro，而是「登录门槛」—— 登录之后不必等管理员点头就能用。
 * 管理页可以按人关掉（见 entitlement.can()），关掉时走的是服务端下发的
 * 能力表，而不是本地这份默认值。
 */
const DEFAULT_ON = ["speak", "export", "leitner"];

function isTier(key) {
  return TIER_KEYS.indexOf(key) >= 0;
}

function nameOf(key) {
  const t = TIERS.find((x) => x.key === key);
  return t ? t.name : "免费";
}

function tierOf(key) {
  return TIERS.find((x) => x.key === key) || TIERS[0];
}

function days(tier) {
  if (tier === "max") return 3650;
  if (tier === "pro") return 365;
  return 30;
}

module.exports = {
  TIERS,
  TIER_KEYS,
  DEFAULT_TIER,
  DEFAULT_ON,
  isTier,
  nameOf,
  tierOf,
  days
};
