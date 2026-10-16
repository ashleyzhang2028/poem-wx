const TIERS = [
  { key: "free", name: "Free", rank: 1 },
  { key: "pro", name: "Pro", rank: 2 },
  { key: "max", name: "Max", rank: 3 }
];

const DEFAULT_TIER = "free";

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

function days(tier) {
  if (tier === "max") return 3650;
  if (tier === "pro") return 365;
  return 30;
}

module.exports = {
  TIERS,
  TIER_KEYS,
  DEFAULT_TIER,
  isTier,
  nameOf,
  tierOf,
  days
};
