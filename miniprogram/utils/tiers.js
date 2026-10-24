const TIERS = [
  { key: "free", name: "Free", rank: 1 },
  { key: "pro", name: "Pro", rank: 2 },
  { key: "max", name: "Max", rank: 3 }
];

const DEFAULT_TIER = "free";

const COLLECTION_LIMITS = { free: 0, pro: 1, max: 200 };

const COLLECTION_ITEMS_MAX = 100;

const RECORD_LIMITS = { free: 0, pro: 200, max: 500 };

function recordQuota() {
  return "Pro " + RECORD_LIMITS.pro + " 条 / Max " + RECORD_LIMITS.max + " 条";
}

function collectionQuota() {
  return "Pro 用户支持 " + COLLECTION_LIMITS.pro + " 个自定义集合，每个集合 " + COLLECTION_ITEMS_MAX
    + " 首古诗词；升级到 Max 可以创建 " + COLLECTION_LIMITS.max + " 个集合";
}

const TIER_KEYS = TIERS.map((t) => t.key);

function isTier(key) {
  return TIER_KEYS.indexOf(key) >= 0;
}

function nameOf(key) {
  if (!isTier(key)) return "Free";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function tierOf(key) {
  return TIERS.find((x) => x.key === key) || TIERS[0];
}

function rank(tier) {
  const t = TIERS.find((x) => x.key === tier);
  return t ? t.rank : 0;
}

function strong(tier) {
  return rank(tier) >= rank("pro");
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
  COLLECTION_LIMITS,
  COLLECTION_ITEMS_MAX,
  collectionQuota,
  RECORD_LIMITS,
  recordQuota,
  isTier,
  nameOf,
  tierOf,
  strong,
  rank,
  days
};
