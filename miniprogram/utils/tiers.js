/**
 * 档位表。
 *
 * 单独成一个文件，是因为 entitlement.js 要能在 Node 自检里直接跑 ——
 * 构建时（scripts/）也需要这份档位表去生成名录。
 * 这个文件不许碰 wx，也不许 require 别的模块。
 *
 * ⚠️ 档位名就是 `Free` / `Pro` / `Max` 本身，**不翻译**。
 *   用户 2026-10-05 原话：「你这是把 Max 翻译成全能了吗？能不能不要翻译
 *   Free, Pro 和 Max，翻译完了谁能看懂什么意思……只保留 Free, Pro 或者 Max」。
 *   他说得对：这三个词是**产品给这一档起的名字**，不是三个形容词。
 *   译成「免费 / 专业 / 全能」，读的人得先在心里做一次映射才认得出来 ——
 *   而这份档位表是要跟服务端、跟网页版、跟管理员口中那三个词对齐的。
 *   译名一旦掺进来，同一档就有两个名字，对不上的时候没人知道说的是哪个。
 *   所以 name 与 key 一律同形，界面上出现的就是 Free / Pro / Max。
 *
 * ⚠️ 这里曾经有一个 `hosted()` 开关：未登录时把所有人当 max，
 *   理由写的是「本机数据只属于本机」。那条口子撤了 ——
 *   它让「管理页给登录用户分级」变成一句空话：未登录的人拿到的
 *   比 pro 还多。现在的边界只有一条：**能进门，不能白用**。
 */

const TIERS = [
  { key: "free", name: "Free", sub: "微信登录即得", rank: 1 },
  { key: "pro", name: "Pro", sub: "管理员发放", rank: 2 },
  { key: "max", name: "Max", sub: "管理员发放", rank: 3 }
];

const DEFAULT_TIER = "free";

const TIER_KEYS = TIERS.map((t) => t.key);

/**
 * 一登录就默认打开的能力。
 *
 * 这几样是「免费档也要有」的那部分（Issue 里点名的：语音朗读 / 莱特纳盒 /
 * 进度导出），所以它们不是 pro，而是「登录门槛」—— 登录之后不必等管理员点头
 * 就能用。**云端同步**在 2026-10-04 也进了这一组（用户裁决：「只要用户登录
 * 就全部提供，确保用户数据不丢失」），此前它是 pro。
 *
 * 管理页可以按人关掉（见 entitlement.can()），关掉时走的是服务端下发的
 * 能力表，而不是本地这份默认值。
 */
const DEFAULT_ON = ["speak", "export", "leitner", "sync"];

function isTier(key) {
  return TIER_KEYS.indexOf(key) >= 0;
}

/**
 * 档位的显示名。
 *
 * 就是 key 的写法：`free` → `Free`。这里不查表、也不留任何译名表 ——
 * 留一张表，迟早会有人往里加「免费」这种看着更亲切的词，
 * 于是界面上又出现两个名字。要改这三个词，改 key 本身。
 * 不认识的档位一律按 Free 显示（拿不到的档位不如实说 Free 更安全）。
 */
function nameOf(key) {
  if (!isTier(key)) return "Free";
  return key.charAt(0).toUpperCase() + key.slice(1);
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
