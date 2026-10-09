/**
 * 作者索引：朝代归一 + 作者异名归一 + 名册构建。
 *
 * 这一页（`packages/authors/index`，Issue #480 / #61）做三件事：
 * 按朝代铺开作者、点作者看他的全部作品、详情页的上一篇 / 下一篇**只在这位作者里走**。
 * 它靠两张表撑着：
 *
 * 网页版有一条「作者索引」（`/authors/`，Issue #480）—— 按朝代先后把作者铺在
 * 一页，点一位作者读他的全部作品。它靠两张表撑着：
 *
 *   1. `ERAS` —— 把二百多种朝代写法（`宋 / 北宋 / 南宋`、`三国 / 三国·魏 / 三国魏`、
 *      `南朝·宋 / 南朝宋`、`先秦 / 东周 / 春秋 / 战国`……）归到一条时间轴上，
 *      否则同一朝会散成七八段，先后也无从谈起
 *   2. `ALIAS` —— 同一个人在不同选本里的写法（`班孟坚` / `班固`、`曹子建` / `曹植`、
 *      `谢玄晖` / `谢朓`）并到通行名上，否则一个人的作品会拆到两处
 *
 * 这两张表同时是**内容口径**，不只是「这一页怎么摆」：
 *
 *   · 《昭明文选》那 145 条的朝代在网页版是按作者一人一行补的（Issue #480），
 *     补的口径就是 `ERAS` 里认得的那些写法。这边同步到位之后，
 *     `scripts/check.js` 的 V40 要能回答「补得对不对」，靠的就是这张表
 *   · 两端对同一段朝代说不同的话（这边写「南北朝 · 宋」那边写「南朝·宋」），
 *     是那种**各自看都对、放一起才发现**的漂移。V40 直接拿这份表和网页版的
 *     `data/author-index.js` 逐段比，漂了当场红
 *
 * ⚠️ 这份表与网页版 `data/author-index.js` 的 `ERAS` / `ALIAS` **必须一致**，
 * 改一边记得改另一边（V40 只比 ERAS —— ALIAS 是一串人名字符串，
 * 抠它的正则比它要守的东西还脆）。
 *
 * ## 收哪些集子
 *
 * 只收「作品」那十部（`LIT_BOOKS`），与网页版同一条判据。其余七部里
 * 「作者」是**词条本身**（李白既是《唐诗》的作者、也是《名家「中国」》的一条词条），
 * 收进来就变成「自己给自己当作品」，几千条词条灌进名册，成一锅粥。
 *
 * ## 判重
 *
 * 同一篇跨集重复只算第一次出场的那一条。网页版靠 `WorksIndex.widOf()`
 * 现算「作品 id」，小程序端没有那份表，也不该为它多背一张 ——
 * 做法是**只认课内**：一篇在课内背过，它在《唐诗》里的那条壳就不进名册。
 * 这正好也是网页版 `repOf()` 的裁定（课内优先，同一篇只留一份正文）。
 * 代价是课外两部选集之间的重复（《乌夜啼》在《词》与别处各一条）现不出来 ——
 * 那种重复在语料里本来就少，而多背一张跨集对照表要 8KB，不划算。
 *
 * 这个差别**精确到一位作者**：网页版 487 位，这边 488 位。
 * 差的这位是**崔护** —— 他名下的《题都城南庄》同时收在《乐府集》
 * (`yuefu-yf-96`)、《唐诗》(`tangshi-ts-313`) 与《成语故事》
 * (`chengyu-cy-440`，题为《人面桃花》) 三处，正文一字不差。网页版按作品 id
 * 把三条并成一组，而它的裁定是「课内优先，其余按集子排位」——
 * 《成语故事》那一版胜出，可成语故事**不在收作品的十部里**，于是崔护
 * 名下一条不剩，整个人从名册上掉了。
 * 这边只判「课内重复」，三条壳各归各的集子，崔护留下一首。
 *
 * 两种都对，但**这一边是想要的那个**：一位有作品可读的作者不该因为
 * 判重的连带效应从名册上消失。这个差值是**钉住的** ——
 * `scripts/check.js` V41 拿它当判据，哪天变成两位就该回来对一次。
 */
"use strict";

/* ── 1. 朝代时间轴 ────────────────────────────────────────────────────
   `at` 是这条时间轴上的位置（越小越早）。同一条 `at` 的写法都算同一朝 ——
   例如「宋 / 北宋 / 南宋 / 两宋之交」`at` 都是 10，落下去就合成一段「宋」。

   ⚠️ 段名取 `name`，**不是**原写法。所以《古诗「非唐代」》里写「宋」的那些与
   《词》里写「北宋」「南宋」的那些，会落到同一段「宋」下面 ——
   读者找的是「宋代的作者」，不是「北宋」。

   「五代十国」与「十国」同归五代一段（十国是五代十国的一部分）。
   「先秦 / 东周 / 春秋 / 战国」同归「先秦」一段。 */
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

/* 原写法 → `at`。表里的每一格都是上面 `keys` 摊平的，不手写第二份。 */
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

/** 表里没有的写法落到最末一段（18 = 其他），**不静默丢掉** */
const TAIL = 18;

/**
 * 一个朝代写法在这条时间轴上的位置。
 * @param {string} raw 语料里的原写法（可能带空格、可能空）
 * @returns {number} 1–17，或 0（空）/ 18（认不得）
 */
function eraOf(raw) {
  const k = String(raw == null ? "" : raw).trim();
  if (!k) return 0;
  const at = ERA_AT[k];
  return at == null ? TAIL : at;
}

/** 位置 → 段名。用于界面上那一段的标题 */
function eraName(raw) {
  return ERA_NAME[eraOf(raw)] || "其他";
}

/* ── 2. 异名归一 ──────────────────────────────────────────────────────
   左：选本里的写法；右：通行名。只收**确凿同人**的 —— 拿不准的不并
   （并错了比不并难查：查半天发现是两个人）。

   ⚠️ 只认「全名」。`韩非` 不并 `韩非子`、`李斯` 不并 `李斯等` ——
   那是同一本书的不同署名，不是同一件事。 */
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

  /* ── 孔子门下那一批（与网页版 Issue #480 第三轮同一条） ────────────
     《论语》在各处署名不一致：
       `孔子及弟子`（课内 `poems-gz11-01`《论语十二章》、`classic-gw-64`
       《吾日三省吾身》、`classic-gw-111`《论语选段》）
       `孔子及其弟子`（`classic-gw-124`《子路、曾皙、冉有、公西华侍坐》、
       `classic-gw-126`《季氏将伐颛臾》、`classic-gw-153`《论志向》）
     「及」与「及其」是同一件事的两种写法，并到**出现较早、条数较多**的
     `孔子及弟子` 上。

     ⚠️ 这是**写法归一**，不是「把《论语》判给孔子一个人」：《论语》是
     结集，作者一格直接填书名的《论语》那一条另有去处（见 `COLLECTIVE`）。 */
  "孔子及其弟子": "孔子及弟子",

  /* ── 「某某等」这一批（与网页版 Issue #480 第四轮同一条） ──────────
     名册上站着几个带「等」的署名。分两类：

     **一、官修史书 / 类书的总裁官 —— 原样留着，一个字不改。**
     `房玄龄等`《晋书》、`脱脱等`《宋史》、`宋濂等`《元史》、
     `李昉等`《太平广记》、`张廷玉等`《明史》、`薛居正等`《旧五代史》——
     奉敕开馆、多人分撰，「某某等」是这类书在文献上**通行的署名**。
     它们**不进这张表**（原样进名册），条目列表顶上另有一行注明。

     **二、先秦子书里托名的书 —— 归到书上那位主人。**
     `吕不韦等`《吕氏春秋》（`classic-gw-13/24/26/73/74/156` 六条）、
     `刘安等`《淮南子》（`classic-gw-20`《后羿射日》、`classic-gw-154`
     《塞翁失马》）。《史记·吕不韦列传》说吕不韦「使其客人人著所闻」，
     《汉书》说淮南王刘安「招致宾客方术之士数千人」—— 这两部书的通行
     署名就题一个人，「等」指的是他门下那一群没有名字的门客，
     说不清是谁，因此归到书上那一位。

     归并不改任何一条数据的 `author` —— 各集子自己的列表页照旧显示
     「吕不韦等」。 */
  "吕不韦等": "吕不韦",
  "刘安等": "刘安",

  /* ── 作者一格填的是**书名**的那四条 ──────────────────────────────────
     《礼记》的《大学之道》、《论语》的《子路曾皙冉有公西华侍坐》带着书名号；
     《国语》的《召公谏厉王止谤》、《战国策》的《唐雎说信陵君》在《古文观止》里
     作者一格写的是这部书的书名。摘掉「《》」之后还是四个像人名的词，
     所以先归成一个名字，由 `isCollective()` 交给上层决定去留
     （网页版作者索引把它们剔出人名册 —— 这四部是结集，作者本来就不止一人）。 */
  "《礼记》": "礼记",
  "《论语》": "论语"
};

/** 作者一格其实是书名的那几部结集 */
const COLLECTIVE = { 礼记: 1, 论语: 1, 国语: 1, 战国策: 1 };

/** 归一到通行名。查不到就原样返回（去掉首尾空白） */
function aliasOf(name) {
  const n = String(name == null ? "" : name).trim();
  if (!n) return "";
  return ALIAS[n] || n;
}

/** 这条「作者」是不是一部结集（《礼记》《论语》《国语》《战国策》） */
function isCollective(name) {
  return !!COLLECTIVE[aliasOf(name)];
}


/* ── 3. 收哪些集子 ────────────────────────────────────────────────────
   与网页版 `data/author-index.js` 的 LIT_BOOKS **同一份名单**：
   只收「作品」十部。其余七部（成语 / 文学常识 / 名著 / 名家中国·外国 /
   帝王中国·外国）里「作者」是词条本身 —— 收了名册就从 491 位涨到 2300 多位，
   多出来的全是词条。

   判据认**集子**，不认「这条有没有作者」：帝王卷每一条也有作者，
   但它讲的是人、不是作品。 */
const LIT_BOOKS = [
  "poems", "classic", "guwen", "yuefu", "tangshi",
  "gushi", "songci", "yuanqu", "jinxiandai", "zhaoming"
];

/* ── 合编课文的归属（与网页版 Issue #480 第三轮同一条） ────────────────
   一篇文章的正文、署名都是两家的，只有一条：

     `classic-gw-10`《古人谈读书》—— 小学那一课。正文是**两段拼的**：
     前三句「敏而好学，不耻下问 / 知之为知之 / 默而识之」出自《论语》，
     后面一段「余尝谓读书有三到」是**朱熹**的话（《训学斋规》）。语料里
     `source` 写着「《论语》、[宋]朱熹」、`d` 写着「先秦·宋」，本来就是
     如实登记的两家。

   ⚠️ 不整篇判给朱熹 —— 它一半是《论语》，判给朱熹就是把《论语》那三句
   也记到朱熹头上。走的是这条路：

     · **显示与详情页一个字不改** —— 照旧读得到「先秦·宋 · 孔子及弟子、
       朱熹 · 《论语》、[宋]朱熹」，读者一眼看得出这是两段两家；
     · **名册里让它挂在「朱熹」名下**（用户要的结果：移进宋朝那一段）。
       不挂「孔子及弟子」：那一边是**纯《论语》**的五条，混进一条半是
       朱熹的，反倒把干净的那一堆搅浑。

   判据认**完整 id**（含集子前缀），不认作者名 —— 按名认会连着把
   「孔子及弟子」名下的别的条目一起搬走。要改哪条，往这里加一行。 */
const ATTRIB = {
  "classic-gw-10": { person: "朱熹", dynasty: "宋" }
};

/**
 * 名册：朝代 → 作者 → 作品。
 *
 * 输入是**已经摊平的条目数组**（每一条 `{id, t, a, d, g, b, n}`）——
 * 这一层不认识 corpus，也不 require 任何东西：自检要在没有小程序运行时的
 * 环境里跑它，页面要在有小程序运行时的环境里跑它。给它数据，它还你名册。
 *
 * @param {Array} entries 全站条目
 * @param {Object} [opt] readIds：已读的条目 id → 任意真值（决定「未读」那一筛）
 * @returns {{eras: Array, people: Object, total: number, unread: number}}
 */
function build(entries, opt) {
  const readIds = (opt && opt.readIds) || {};
  const byBook = {};
  (LIT_BOOKS || []).forEach(function (b) { byBook[b] = true; });

  const byPerson = {};
  const order = [];
  /* 课内那 251 首的 id —— 判重只认它们（见文件头「判重」那一节） */
  const courseWid = {};

  /* 合编课文按 `ATTRIB` 指定的人归属 —— 覆写作者名与朝代，其余条目一个字不动 */
  const personOf = function (p) {
    const fix = ATTRIB[p.id];
    if (fix) return fix.person;
    return aliasOf(p.a);
  };

  (entries || []).forEach(function (p) {
    if (!p || byBook[p.b] !== true) return;
    const name = personOf(p);
    /* 结集不进名册：作者一格填的是书名（《礼记》《论语》《国语》《战国策》），
       硬挂上去就是「《礼记》写了《大学之道》」—— 那是编。 */
    if (!name || isCollective(name)) return;
    /* 课内的先登记：后面的同篇壳条都按它判重 */
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
    /* 一位作者名下可能挂着好几处朝代写法（同一个人在不同选本里写法不同，
       例如一位唐代诗人被某处误标成「先秦」）。取**最早**那一朝 ——
       与网页版 `data/author-index.js` 的 `build()` 同一条：那里是
       `if (at > 0 && at < 18 && at < w.at) w.at = at`。
       不取最早的话，名册上会出现「先秦 · 骆宾王」，而名册自己把他摆在唐。

       `at` 初值 0 = 「还没有朝代」：
         · 认得出的写法（1–17）一律收下，取最小的那个
         · 表外的写法（TAIL=18）**不参与** —— 它不该把一位唐代人拉到「其他」
         · 一条朝代都没有的，`at` 留在 0，出循环后摆到最末一段 */
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


  /* 索引卡的段：**只要有作者**就有段，哪怕这一朝只有一位 ——
     这一页的存在理由就是那张朝代表。两个数分开算：一张朝代表上
     「唐 105 家」比「唐 596 条」有用，段头把两件事一起说清。 */
  const rows = ERAS.map(function (e) {
    return { at: e.at, name: e.name, count: 0, works: 0 };
  });
  const tail = { at: TAIL, name: "其他", count: 0, works: 0 };
  order.forEach(function (n) {
    const w = people[n];
    /* `at === 0` 是「一条朝代都没有的」—— 摆到最末的「其他」段，
       与网页版 `build()` 末尾那句 `if (w.at === 99) w.at = 0` 同一个去处。
       不落段的话这个人会从名册上**静默消失**（488 位里少几位，没人会数）。 */
    let row = tail;
    for (let i = 0; i < rows.length; i++) if (rows[i].at === w.at) row = rows[i];
    row.count += 1;
    row.works += w.count;
  });
  const eras = rows.filter(function (r) { return r.count > 0; });
  if (tail.count) eras.push(tail);

  /* 名册里的作者按「朝代 → 拼音」排开（同一朝内按拼音）。
     段名取 `name` 不是原写法 —— 读者找的是「宋代的作者」，不是「北宋」。 */
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

/**
 * 一位作者名下作品的顺序：**集子 → 组 → id**。
 *
 * 与网页版 `data/author-index.js` 的口径同一条：不重排，按集子自己的
 * 卷次 / 册次走（那是书的顺序，不是编出来的「李白先背哪首」）。
 *
 * ⚠️ 这一段排序**只有一个出处**：作者索引那②层与阅读页的「下一篇」
 * 都走它。曾经在两处各写一遍（一模一样的两行），而它们必须始终一致 ——
 * 「列表里看到的顺序」与「下一篇跳到的顺序」一旦对不上，用户当成 bug。
 * 所以摆成导出函数，谁要谁调。
 */
function orderItems(items) {
  return (items || []).slice().sort(function (a, b) {
    const ka = String(a.b) + "|" + String(a.g || "") + "|" + String(a.id);
    const kb = String(b.b) + "|" + String(b.g || "") + "|" + String(b.id);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * 一位作者名下作品的 id 列表 —— **顺序就是②层列出来的那一个**。
 *
 * 为什么要单开一个函数，而不是让阅读页自己去筛：那样筛出来的是
 * 「语料里写着这位作者的全部条目」，而**名册收下的是判重之后的**
 * （课内背过的，在选集里那条壳不算）。两者差 17 条（李白 77 vs 60），
 * 于是「列表里看到的顺序」与「下一篇跳到的顺序」对不上 ——
 * 用户翻到第 36 首，返回列表一看，自己在列表里的位置很陌生。
 *
 * 所以「这位作者有哪些作品」只能从**名册那一份**里取。
 * 名册是现算的（60ms），这个函数也就现算 —— 调用方把名册给它。
 *
 * @param {Object} roster `build()` 的返回值
 * @param {string} author 通行名
 * @returns {string[]} 条目 id，顺序与②层一致
 */
function worksOf(roster, author) {
  const w = roster && roster.people && roster.people[author];
  if (!w) return [];
  return w.items.map(function (p) { return p.id; });
}

/** 判重用的键：篇名（去掉标点与空白）+ 作者。语料里同一篇跨集重复时题名一字不差 */
function dedupKey(title, author) {
  return String(title || "").replace(/[\s，。！？；：、,.!?;:"'“”‘’「」『』《》〈〉（）()\[\]【】—－\-…·~～]/g, "") +
    "|" + String(author || "");
}

/** 一位作者「是哪一朝人」：取他名下**最早**那一朝的原写法。段头与名册都拿它 */
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

/** 拼音序。名字是中文，装 `localeCompare` 认它 —— 认不得就退回码点序 */
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

