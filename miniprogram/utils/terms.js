const C = [
  3.87, 18.73, 4.15, 19.04, 5.63, 20.65,
  5.10, 20.89, 5.68, 21.86, 6.32, 22.20,
  7.45, 22.60, 7.72, 23.13, 8.41, 23.44,
  8.25, 23.99, 8.05, 23.42, 7.90, 22.60
];

const NAMES = [
  "立春", "雨水", "惊蛰", "春分", "清明", "谷雨",
  "立夏", "小满", "芒种", "夏至", "小暑", "大暑",
  "立秋", "处暑", "白露", "秋分", "寒露", "霜降",
  "立冬", "小雪", "大雪", "冬至", "小寒", "大寒"
];

const MONTHS = [
  2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7,
  8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 1, 1
];

const ANCHOR = Date.UTC(1900, 0, 6);

const DAY = 86400000;

function century(of) {
  return Math.floor(of / 100) + 1;
}

function yOf(year) {
  return year % 100;
}

function at(index, year) {
  const d = yOf(year);
  const c = century(year);
  return Math.floor(d * 0.2422 + C[index] - Math.floor((d - 1) / 4)) - (c === 20 || c === 21 ? 1 : 0);
}

function dayOf(index, year) {
  return Date.UTC(year, MONTHS[index] - 1, at(index, year));
}

function around(date) {
  const now = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const list = [];
  [date.getFullYear() - 1, date.getFullYear(), date.getFullYear() + 1].forEach((year) => {
    NAMES.forEach((name, i) => {
      const d = dayOf(i, year);
      list.push({
        key: name,
        index: i,
        year: year,
        at: d,
        elapsed: Math.round((now - d) / DAY)
      });
    });
  });
  return list.sort((a, b) => a.at - b.at);
}

function current(date) {
  const list = around(date);
  const now = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  let hit = null;
  list.forEach((t) => {
    if (t.at <= now) hit = t;
  });
  const next = list.filter((t) => t.at > now)[0] || null;
  return hit ? { key: hit.key, index: hit.index, at: hit.at, elapsed: hit.elapsed, from: hit.at, to: next ? next.at : hit.at } : null;
}

function dayOfTerm(key, year) {
  const i = NAMES.indexOf(key);
  if (i < 0) return 0;
  return dayOf(i, year);
}

function dateOf(ms) {
  const d = new Date(ms);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

module.exports = {
  NAMES,
  at,
  dayOf,
  dayOfTerm,
  around,
  current,
  dateOf,
  ANCHOR
};
