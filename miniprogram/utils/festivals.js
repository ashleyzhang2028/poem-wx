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

const WORKS = [
  ["season-ss-d342f0-28", "春节"],
  ["season-ss-398c2c-26", "春节"],
  ["season-ss-fbbf59-69", "春节"],
  ["season-ss-c8fc7b-51", "春节"],
  ["season-ss-679215-35", "春节"],
  ["season-ss-614ae2-46", "元宵节"],
  ["season-ss-e1ab8e-65", "元宵节"],
  ["season-ss-f20424-29", "元宵节"],
  ["season-ss-645896-30", "元宵节"],
  ["season-ss-8847d4-27", "元宵节"],
  ["season-ss-7d8127-55", "寒食节"],
  ["season-ss-06ded3-49", "寒食节"],
  ["season-ss-acd76b-79", "清明节"],
  ["season-ss-2c37b5-41", "清明节"],
  ["season-ss-e8e261-78", "清明节"],
  ["season-ss-85900e-54", "清明节"],
  ["season-ss-5d0506-31", "端午节"],
  ["season-ss-415d3a-38", "端午节"],
  ["season-ss-5d91b8-80", "七夕节"],
  ["season-ss-007245-32", "七夕节"],
  ["season-ss-a9b52f-45", "七夕节"],
  ["season-ss-cbb5b3-34", "七夕节"],
  ["season-ss-bb240f-39", "中秋节"],
  ["season-ss-d60923-24", "中秋节"],
  ["season-ss-45663b-67", "中秋节"],
  ["season-ss-b04eb9-44", "中秋节"],
  ["season-ss-cb1505-57", "中秋节"],
  ["season-ss-611e0c-25", "重阳节"],
  ["season-ss-d5ebb1-33", "重阳节"],
  ["season-ss-703cd4-63", "重阳节"],
  ["season-ss-6efdd9-58", "春社日"],
  ["season-ss-689e50-68", "立春"],
  ["season-ss-48cb8a-62", "立春"],
  ["season-ss-33d719-22", "雨水"],
  ["season-ss-beabab-13", "惊蛰"],
  ["season-ss-390469-50", "惊蛰"],
  ["season-ss-7452c5-47", "惊蛰"],
  ["season-ss-37e1cf-02", "春分"],
  ["season-ss-10df2b-64", "春分"],
  ["season-ss-6f2b53-56", "春分"],
  ["season-ss-2aea8e-82", "春分"],
  ["season-ss-33d982-14", "清明"],
  ["season-ss-acd76b-79", "清明"],
  ["season-ss-0c1d4e-21", "谷雨"],
  ["season-ss-cf35fb-18", "立夏"],
  ["season-ss-b867ac-77", "立夏"],
  ["season-ss-8df12d-70", "立夏"],
  ["season-ss-a4eebe-11", "小满"],
  ["season-ss-fa337a-20", "芒种"],
  ["season-ss-3d985b-75", "芒种"],
  ["season-ss-97ffa9-01", "夏至"],
  ["season-ss-ed6253-48", "夏至"],
  ["season-ss-142ebd-71", "夏至"],
  ["season-ss-c0f869-10", "小暑"],
  ["season-ss-3ea433-06", "大暑"],
  ["season-ss-3f5e21-60", "大暑"],
  ["season-ss-03d327-43", "大暑"],
  ["season-ss-7bc21c-19", "立秋"],
  ["season-ss-05cc38-53", "立秋"],
  ["season-ss-37e594-72", "立秋"],
  ["season-ss-e474a0-04", "处暑"],
  ["season-ss-c7fe48-83", "处暑"],
  ["season-ss-1e27d9-15", "白露"],
  ["season-ss-12c382-16", "秋分"],
  ["season-ss-1ed9a0-76", "秋分"],
  ["season-ss-bf49e7-08", "寒露"],
  ["season-ss-66ed08-66", "寒露"],
  ["season-ss-6bc8ac-23", "霜降"],
  ["season-ss-cd1cd3-40", "霜降"],
  ["season-ss-2adfe5-17", "立冬"],
  ["season-ss-1ed724-52", "立冬"],
  ["season-ss-5b31b2-12", "小雪"],
  ["season-ss-43ac9a-74", "小雪"],
  ["season-ss-e97f79-07", "大雪"],
  ["season-ss-d750b1-59", "大雪"],
  ["season-ss-0bff50-03", "冬至"],
  ["season-ss-d2e006-36", "冬至"],
  ["season-ss-4c288b-42", "冬至"],
  ["season-ss-4d1adc-37", "冬至"],
  ["season-ss-217dee-61", "冬至"],
  ["season-ss-bfd6dc-09", "小寒"],
  ["season-ss-5bbad4-05", "大寒"],
  ["season-ss-2603c3-73", "大寒"],
  ["gushi-gs-67", "春节"],
  ["gushi-gs-73", "春节"],
  ["songci-sc-120", "元宵节"],
  ["tangshi-ts-357", "元宵节"],
  ["tangshi-ts-265", "寒食节"],
  ["poems-xx3-15", "清明节"],
  ["songci-sc-154", "清明节"],
  ["tangshi-ts-458", "春社日"],
  ["tangshi-ts-99", "立春"],
  ["songci-sc-180", "立春"],
  ["yuanqu-yq-21", "立春"],
  ["poems-xx6-17", "立夏"],
  ["tangshi-ts-335", "端午节"],
  ["songci-sc-305", "端午节"],
  ["poems-xx6-09", "七夕节"],
  ["poems-xx5-02", "七夕节"],
  ["poems-gz10-15", "七夕节"],
  ["tangshi-ts-285", "七夕节"],
  ["tangshi-ts-96", "中秋节"],
  ["tangshi-ts-110", "中秋节"],
  ["songci-sc-97", "中秋节"],
  ["yuefu-yf-40", "中秋节"],
  ["tangshi-ts-254", "重阳节"],
  ["tangshi-ts-414", "重阳节"],
  ["tangshi-ts-176", "重阳节"],
  ["songci-sc-233", "重阳节"],
  ["tangshi-ts-190", "重阳节"],
  ["tangshi-ts-190", "秋季"],
];

const SEASON_OF = {
  立春: "春季", 雨水: "春季", 惊蛰: "春季", 春分: "春季", 清明: "春季", 谷雨: "春季",
  立夏: "夏季", 小满: "夏季", 芒种: "夏季", 夏至: "夏季", 小暑: "夏季", 大暑: "夏季",
  立秋: "秋季", 处暑: "秋季", 白露: "秋季", 秋分: "秋季", 寒露: "秋季", 霜降: "秋季",
  立冬: "冬季", 小雪: "冬季", 大雪: "冬季", 冬至: "冬季", 小寒: "冬季", 大寒: "冬季"
};

const SEASON_TERMS = {
  春季: ["立春", "雨水", "惊蛰", "春分", "清明", "谷雨"],
  夏季: ["立夏", "小满", "芒种", "夏至", "小暑", "大暑"],
  秋季: ["立秋", "处暑", "白露", "秋分", "寒露", "霜降"],
  冬季: ["立冬", "小雪", "大雪", "冬至", "小寒", "大寒"]
};

const LUNAR_SEASON = { 12: "冬季", 1: "冬季", 2: "春季", 3: "春季", 4: "春季", 5: "夏季", 6: "夏季", 7: "夏季", 8: "秋季", 9: "秋季", 10: "秋季", 11: "冬季" };

const SEASONS = ["春季", "夏季", "秋季", "冬季"];

function seasonOf(name) {
  if (SEASONS.indexOf(name) >= 0) return name;
  if (SEASON_OF[name]) return SEASON_OF[name];
  const entry = TRADITIONAL.filter((x) => x.key === name)[0];
  if (!entry) return "";
  if (entry.term) return SEASON_OF[entry.term];
  if (entry.before) return SEASON_OF[entry.before.term];
  return LUNAR_SEASON[entry.lunar[0]] || "";
}

module.exports = {
  TRADITIONAL,
  LEAD,
  SHOW_DAYS,
  WORKS,
  SEASONS,
  SEASON_OF,
  SEASON_TERMS,
  seasonOf
};
