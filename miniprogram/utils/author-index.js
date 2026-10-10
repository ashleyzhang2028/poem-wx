"use strict";

const ERAS = [
  { at: 1, name: "先秦", keys: ["先秦", "先秦·宋", "东周", "春秋", "战国", "战国·楚", "战国·燕", "战国·秦", "战国·赵", "战国·韩", "战国·魏", "西周", "商", "夏", "上古传说", "传说时代"] },
  { at: 2, name: "秦", keys: ["秦", "秦末"] },
  { at: 3, name: "汉", keys: ["汉", "西汉", "东汉", "东汉末", "汉末"] },
  { at: 4, name: "三国", keys: ["三国", "三国·魏", "三国魏", "三国·蜀", "三国蜀汉", "三国·吴", "三国吴", "东汉末三国", "东汉末三国吴"] },
  { at: 5, name: "晋", keys: ["晋", "西晋", "东晋", "两晋", "东晋十六国", "东晋南朝宋", "十六国"] },
  { at: 6, name: "南北朝", keys: ["南北朝", "南朝", "南朝·宋", "南朝宋", "南朝·齐", "南朝齐", "南朝·梁", "南朝梁", "南朝·陈", "南朝陈", "南朝宋齐", "南朝齐梁", "北朝", "北朝·北魏", "北朝·东魏", "北朝·西魏", "北朝·北齐", "北朝·北周", "北魏", "东魏", "西魏", "北齐", "北周", "两晋南北朝", "两晋十六国南北朝"] },
  { at: 7, name: "隋", keys: ["隋"] },
  { at: 8, name: "唐", keys: ["唐", "唐（武周）", "初唐", "盛唐", "中唐", "晚唐", "五代·唐"] },
  { at: 9, name: "五代十国", keys: ["五代", "五代十国", "五代十国（南唐）", "十国", "十国·前蜀", "十国·北汉", "十国·南唐", "十国·南汉", "十国·吴越", "十国·楚", "十国·闽", "五代·后梁", "五代·后唐", "五代·后晋", "五代·后汉", "五代·后周"] },
  { at: 10, name: "宋", keys: ["宋", "北宋", "南宋", "两宋之交"] },
  { at: 11, name: "辽", keys: ["辽"] },
  { at: 12, name: "西夏", keys: ["西夏"] },
  { at: 13, name: "金", keys: ["金"] },
  { at: 14, name: "元", keys: ["元", "元（蒙古）", "元末明初"] },
  { at: 15, name: "明", keys: ["明", "明清"] },
  { at: 16, name: "清", keys: ["清", "清（晚清）", "清末", "明末清初", "后金 / 清"] },
  { at: 17, name: "近现代", keys: ["近现代", "现代", "当代", "现当代", "民国"] }
];

const ERA_AT = (() => {
  const m = {};
  ERAS.forEach((e) => e.keys.forEach((k) => { m[k] = e.at; }));
  return m;
})();

const ERA_NAME = (() => {
  const m = {};
  ERAS.forEach((e) => { m[e.at] = e.name; });
  return m;
})();

const TAIL = 18;

function eraOf(raw) {
  const k = String(raw == null ? "" : raw).trim();
  if (!k) return 0;
  const at = ERA_AT[k];
  return at == null ? TAIL : at;
}

function eraName(raw) {
  return ERA_NAME[eraOf(raw)] || "其他";
}

const ALIAS = {
  "班孟坚": "班固",
  "屈平": "屈原",
  "谢玄晖": "谢朓",
  "诸葛孔明": "诸葛亮",
  "韦弘嗣": "韦昭",
  "左太冲": "左思",
  "王文考": "王延寿",
  "何平叔": "何晏",
  "木玄虚": "木华",
  "郭景纯": "郭璞",
  "孙兴公": "孙绰",
  "谢希逸": "谢庄",
  "范蔚宗": "范晔",
  "虞子阳": "虞羲",
  "何敬祖": "何劭",
  "欧阳坚石": "欧阳建",
  "张孟阳": "张载",
  "司马绍统": "司马彪",
  "潘正叔": "潘尼",
  "傅长虞": "傅咸",
  "刘越石": "刘琨",
  "陆韩卿": "陆厥",
  "缪熙伯": "缪袭",
  "曹颜远": "曹摅",
  "傅休奕": "傅玄",
  "石季伦": "石崇",
  "应吉甫": "应贞",
  "谢宣远": "谢瞻",
  "张士然": "张悛",
  "庾元规": "庾亮",
  "桓元子": "桓温",
  "繁休伯": "繁钦",
  "东方曼倩": "东方朔",
  "皇甫士安": "皇甫谧",
  "夏侯孝若": "夏侯湛",
  "袁彦伯": "袁宏",
  "干令升": "干宝",
  "崔子玉": "崔瑗",
  "陆佐公": "陆倕",
  "任彦升": "任昉",
  "贾长沙": "贾谊",
  "祢正平": "祢衡",
  "荆卿": "荆轲",
  "魏武帝": "曹操",
  "曹子建": "曹植",

  "孔子及其弟子": "孔子及弟子",

  "吕不韦等": "吕不韦",
  "刘安等": "刘安",

  "《礼记》": "礼记",
  "《论语》": "论语"
};

const COLLECTIVE = { 礼记: 1, 论语: 1, 国语: 1, 战国策: 1 };

function aliasOf(name) {
  const n = String(name == null ? "" : name).trim();
  if (!n) return "";
  return ALIAS[n] || n;
}

function isCollective(name) {
  return !!COLLECTIVE[aliasOf(name)];
}

const LIT_BOOKS = [
  "poems", "classic", "guwen", "yuefu", "tangshi",
  "gushi", "songci", "yuanqu", "jinxiandai", "zhaoming"
];

const ATTRIB = {
  "classic-gw-10": { person: "朱熹", dynasty: "宋" }
};

function build(entries, opt) {
  const readIds = (opt && opt.readIds) || {};
  const byBook = {};
  (LIT_BOOKS || []).forEach(function (b) { byBook[b] = true; });

  const byPerson = {};
  const order = [];

  const courseWid = {};

  const personOf = function (p) {
    const fix = ATTRIB[p.id];
    if (fix) return fix.person;
    return aliasOf(p.a);
  };

  (entries || []).forEach(function (p) {
    if (!p || byBook[p.b] !== true) return;
    const name = personOf(p);

    if (!name || isCollective(name)) return;

    if (p.b === "poems" && p.t) courseWid[dedupKey(p.t, name)] = p;
  });

  (entries || []).forEach(function (p) {
    if (!p || byBook[p.b] !== true) return;
    const name = personOf(p);
    if (!name || isCollective(name)) return;
    if (p.b !== "poems" && courseWid[dedupKey(p.t, name)]) return;

    if (!byPerson[name]) {
      byPerson[name] = { name: name, at: 0, items: [], dynasties: {} };
      order.push(name);
    }
    const w = byPerson[name];

    const fix = ATTRIB[p.id];
    const at = eraOf((fix && fix.dynasty) || p.d);
    if (at > 0 && at < TAIL && (w.at === 0 || at < w.at)) w.at = at;
    w.items.push(p);
    const d = String((fix && fix.dynasty) || p.d || "").trim();
    if (d) w.dynasties[d] = true;
  });

  const people = {};
  order.forEach(function (n) {
    const w = byPerson[n];
    w.items = orderItems(w.items);
    w.count = w.items.length;
    w.unread = w.items.filter(function (p) { return !readIds[p.id]; }).length;
    w.dynasty = firstDynasty(w);
    people[n] = w;
  });

  const rows = ERAS.map(function (e) {
    return { at: e.at, name: e.name, count: 0, works: 0 };
  });
  const tail = { at: TAIL, name: "其他", count: 0, works: 0 };
  order.forEach(function (n) {
    const w = people[n];

    let row = tail;
    for (let i = 0; i < rows.length; i++) if (rows[i].at === w.at) row = rows[i];
    row.count += 1;
    row.works += w.count;
  });
  const eras = rows.filter(function (r) { return r.count > 0; });
  if (tail.count) eras.push(tail);

  const byEra = {};
  eras.forEach(function (r) { byEra[r.at] = []; });
  order.forEach(function (n) {
    const w = people[n];
    const at = w.at || TAIL;
    if (!byEra[at]) byEra[at] = [];
    byEra[at].push(w);
  });
  Object.keys(byEra).forEach(function (at) {
    byEra[at].sort(function (a, b) { return byPinyin(a.name, b.name); });
  });

  const all = [];
  eras.forEach(function (r) {
    all.push({ at: r.at, name: r.name, count: r.count, works: r.works, people: byEra[r.at] || [] });
  });

  return {
    eras: all,
    people: people,
    byEra: byEra,
    total: order.length,
    unread: order.reduce(function (n, k) { return n + (people[k].unread ? 1 : 0); }, 0)
  };
}

function orderItems(items) {
  return (items || []).slice().sort(function (a, b) {
    const ka = String(a.b) + "|" + String(a.g || "") + "|" + String(a.id);
    const kb = String(b.b) + "|" + String(b.g || "") + "|" + String(b.id);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function worksOf(roster, author) {
  const w = roster && roster.people && roster.people[author];
  if (!w) return [];
  return w.items.map(function (p) { return p.id; });
}

function dedupKey(title, author) {
  return String(title || "").replace(/[\s，。！？；：、,.!?;:"'“”‘’「」『』《》〈〉（）()\[\]【】—－\-…·~～]/g, "") +
    "|" + String(author || "");
}

function firstDynasty(w) {
  let best = "";
  let bestAt = TAIL + 1;
  Object.keys(w.dynasties || {}).forEach(function (d) {
    const at = eraOf(d);
    const v = at === 0 ? TAIL : at;
    if (v < bestAt) { bestAt = v; best = d; }
  });
  return best;
}

function byPinyin(a, b) {
  try {
    return String(a).localeCompare(String(b), "zh-Hans-CN", { sensitivity: "base" });
  } catch (e) {
    return String(a) < String(b) ? -1 : 1;
  }
}

module.exports = {
  ERAS: ERAS,
  TAIL: TAIL,
  LIT_BOOKS: LIT_BOOKS,
  eraOf: eraOf,
  eraName: eraName,
  aliasOf: aliasOf,
  isCollective: isCollective,
  build: build,
  orderItems: orderItems,
  worksOf: worksOf
};
