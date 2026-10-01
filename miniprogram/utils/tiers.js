/**
 * 档位表与「哪些能力默认得向管理员申请」。
 *
 * 单独成一个文件，是因为 entitlement.js 要能在 Node 自检里直接跑 ——
 * 构建时（scripts/）也需要这份档位表去生成名单。
 * 这个文件不许碰 wx，也不许 require 别的模块。
 */

/**
 * 本机宿主：没登录时所有能力可用。本机数据只属于本机，这条边界不松。
 *
 * 这里必须是**函数**而不是常量 —— 自检要把宿主这条路关掉，
 * 才能在真·后端分层下验「付费档不凭本机写入就生效」。
 * 写成常量的话，那条断言只是在自己跟自己说话。
 */
function hosted() {
  return true;
}

const TIERS = [
  { key: "free", name: "免费", sub: "不登录也能背", rank: 0 },
  { key: "pro", name: "专业", sub: "兑换码或后台发放", rank: 2 },
  { key: "max", name: "全能", sub: "管理员、机主", rank: 3 }
];

const DEFAULT_TIER = "free";

const TIER_KEYS = TIERS.map((t) => t.key);

/**
 * 一登录就默认打开的能力 —— 但这些是「默认开」，不是「不用授权」。
 * 语音朗读要接 TTS 服务，管理员可以（也应该）按人关掉，见 entitlement.can("speak")。
 *
 * ⚠️ 表里有就得有人用。这张表原来只是躺着，于是「登录后朗读可用」那条
 *    在真·后端分层下永远为假 —— 自检里那条断言一直在失败。
 *    entitlement.can() 现在会读它。
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
  hosted,
  TIERS,
  TIER_KEYS,
  DEFAULT_TIER,
  DEFAULT_ON,
  isTier,
  nameOf,
  tierOf,
  days
};
