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

const WORKS = [];

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
