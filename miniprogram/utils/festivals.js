const TRADITIONAL = [
  { key: "除夕", lunar: [12, 30] },
  { key: "春节", lunar: [1, 1] },
  { key: "元宵节", lunar: [1, 15] },
  { key: "春社日", term: "春分" },
  { key: "寒食节", before: { term: "清明", days: 2 } },
  { key: "清明节", term: "清明" },
  { key: "端午节", lunar: [5, 5] },
  { key: "七夕节", lunar: [7, 7] },
  { key: "中秋节", lunar: [8, 15] },
  { key: "重阳节", lunar: [9, 9] },
  { key: "腊八节", lunar: [12, 8] }
];
const LEAD = 2;

const SHOW_DAYS = LEAD + 1;

const UNVERIFIED = "unverified";

const UNVERIFIED_TEXT = "非正规译注：下面几首的译文是机器整理的释义，未逐字校对，请自行校验对错";

const WORKS = [
  ["gushi-gs-67", "春节"],
  ["tangshi-ts-265", "寒食节"],
  ["tangshi-ts-335", "端午节"],
  ["tangshi-ts-254", "重阳节"],
  ["tangshi-ts-414", "重阳节"],
  ["tangshi-ts-132", "重阳节"],
  ["gushi-gs-15", "立夏"]
];

module.exports = {
  TRADITIONAL,
  LEAD,
  SHOW_DAYS,
  UNVERIFIED,
  UNVERIFIED_TEXT,
  WORKS
};
