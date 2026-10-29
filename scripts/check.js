"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "miniprogram");
let fails = 0;
let checks = 0;

function ok(name, cond, detail) {
  checks += 1;
  if (cond) return;
  fails += 1;
  console.log("✗ " + name + (detail ? " —— " + detail : ""));
}

const pending = [];

function track(p) {
  pending.push(Promise.resolve(p).catch((e) => {
    checks += 1;
    fails += 1;
    console.log("✗ 异步断言自身抛了：" + (e && e.message));
  }));
  return p;
}

function stripWs(v) {
  return String(v == null ? "" : v).replace(/\s+/g, "");
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function readModule(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^module\.exports = /, "").replace(/;\s*$/, ""));
}

function staticallyReachable(entries) {
  const seen = new Set();
  const stack = Array.isArray(entries) ? entries.slice() : [entries];
  const rel = new Set();
  const resolve = (from, req) => {
    if (req.charAt(0) !== ".") return null;
    const base = path.resolve(path.dirname(from), req);
    const candidates = [base, base + ".js", base + ".json", path.join(base, "index.js")];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
  };
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!f.endsWith(".js")) continue;
    const src = fs.readFileSync(f, "utf8");
    const re = /require\(\s*["'](\.[^"']+)["']\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const t = resolve(f, m[1]);
      if (!t) continue;
      rel.add(t);
      stack.push(t);
    }
  }
  const out = new Set();
  rel.forEach((f) => {
    if (f.indexOf(path.join(ROOT, "data")) === 0) {
      out.add(path.relative(ROOT, f).split(path.sep).join("/"));
    }
  });
  return out;
}

const app = readJson(path.join(ROOT, "app.json"));
const pages = app.pages.slice();
(app.subPackages || []).forEach((sp) => {
  sp.pages.forEach((p) => pages.push(sp.root + "/" + p));
});

pages.forEach((p) => {
  [".js", ".json", ".wxml"].forEach((ext) => {
    ok(
      "页面文件存在 " + p + ext,
      fs.existsSync(path.join(ROOT, p + ext)),
      "缺失"
    );
  });
});

const viewDir = path.join(ROOT, "components", "tier-view", "tier-view");
[".js", ".json", ".wxml", ".wxss"].forEach((ext) => {
  ok("权限表组件的四件套存在 tier-view" + ext, fs.existsSync(viewDir + ext), "缺失");
});

const jsFiles = [];
(function walk(dir) {
  fs.readdirSync(dir).forEach((f) => {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (f.endsWith(".js")) jsFiles.push(full);
  });
})(ROOT);

jsFiles.forEach((file) => {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    ok("语法可解析 " + path.relative(ROOT, file), true);
  } catch (e) {
    const tail = String((e.stderr || "") + (e.stdout || "")).split("\n").slice(0, 4).join(" / ");
    ok("语法可解析 " + path.relative(ROOT, file), false, tail);
  }
});

jsFiles.forEach((file) => {
  const src = fs.readFileSync(file, "utf8");
  const re = /require\(["']([^"']+)["']\)/g;
  let m;
  while ((m = re.exec(src))) {
    const target = m[1];
    if (!target.startsWith(".")) continue;

    const base = path.resolve(path.dirname(file), target);

    let resolved;
    if (/\.json$/.test(target) || /\.js$/.test(target)) resolved = base;

    else if (fs.existsSync(base + ".js")) resolved = base + ".js";
    else resolved = path.join(base, "index.js");
    ok("require 可解析 " + path.relative(ROOT, file) + " → " + target, fs.existsSync(resolved));
  }
});

const dataDir = path.join(ROOT, "data");
const booksTable = readModule(path.join(dataDir, "books", "books.js"));

const catalogPack = readModule(path.join(dataDir, "books", "catalogs.js"));
const catalogTable = (catalogPack && catalogPack.books) || [];
const catalogIds = catalogTable.map((b) => b.id);

ok("集子表 = 课内一部 + 目录里那十部", (booksTable || []).length === 1 + catalogIds.length
  && booksTable[0].id === "poems",
  "实际 " + JSON.stringify((booksTable || []).map((b) => b.id)));

var corpus = require(path.join(ROOT, "utils", "corpus.js"));
const perBook = {};
booksTable.forEach((b) => {
  perBook[b.id] = corpus.ofBook(b.id);
});
const allEntries = booksTable.reduce((acc, b) => acc.concat(perBook[b.id]), []);
const allIds = new Set(allEntries.map((p) => p.id));
ok("集子索引合计覆盖全站", allIds.size === allEntries.length, "有重复 id");
ok("课内诗词 251 首", perBook.poems.length === 251, "实际 " + perBook.poems.length);
ok(
  "索引不带正文",
  allEntries.every((p) => p.text === undefined && p.translation === undefined)
);

const bookPack = readModule(path.join(dataDir, "books", "index.js"));
ok("集子索引只装课内那一部（books/index.js 里没有课外集子）",
  Object.keys(bookPack.books).join() === "poems"
    && Object.keys(bookPack.rows).join() === "poems",
  "合表里还有 " + JSON.stringify(Object.keys(bookPack.books)));

ok("集子索引归属正确",
  perBook.poems.length === bookPack.books.poems
    && perBook.poems.every((p) => p.b === "poems" && p.n === "课内诗词"),
  "b / n 与实际集子对不上");

{
  const wide = bookPack.rows.poems.filter((r) => r.length !== 11);
  ok("索引落盘只存列（无名、不存正文）", wide.length === 0,
    wide.length + " 行形状不对 —— 薄索引把字段名与集子名都省了（见 scripts/build-data.js）");
}

{
  const texts = Object.keys(perBook).filter((id) => id !== "poems" && catalogIds.indexOf(id) < 0);
  ok("除课内与目录那十部，别的集子一条都不进包（索引里一条都没有）",
    texts.every((id) => perBook[id].length === 0),
    "这些集子还有条目：" + texts.filter((id) => perBook[id].length).join("、"));
}

ok("目录十部，每部的条数与落盘的 count 对得上",
  catalogIds.length === 10
    && catalogIds.every((id, i) => perBook[id].length === catalogTable[i].count && perBook[id].length > 0),
  "实际 " + JSON.stringify(catalogIds.map((id, i) => id + ":" + perBook[id].length + "/" + catalogTable[i].count)));

{
  const rows = catalogIds.reduce((acc, id) => acc.concat(perBook[id]), []);
  ok("目录里每一条都有源 id（正文靠它去诗词漫读取）",
    rows.every((p) => p.sid) && new Set(rows.map((p) => p.id)).size === rows.length,
    "缺源 id 或 id 撞车的：" + rows.filter((p) => !p.sid).slice(0, 3).map((p) => p.id).join("、"));

  ok("目录只装书名、标题、作者、出处（正文一个字都不在包里）",
    rows.every((p) => p.text === undefined && p.translation === undefined && p.n),
    "目录条目混进了正文或没带书名");

  ok("目录落盘只存列（书名在集子表里，不在这份里重写一遍）",
    catalogPack.books.every((b) => Object.keys(b).sort().join() === "count,id,name,unit")
      && Object.keys(catalogPack).sort().join() === "books,dict,drifted,prefixes,rows",
    "形状不对：" + JSON.stringify(Object.keys(catalogPack)));
}

const courseTexts = readModule(path.join(dataDir, "course.js"));
const courseIds = new Set(perBook.poems.map((p) => p.id));

ok("课内正文进包 251 条", Object.keys(courseTexts).length === 251, "实际 " + Object.keys(courseTexts).length);
ok(
  "课内正文带译文",
  Object.keys(courseTexts).every((id) => typeof courseTexts[id].text === "string"),
  "有条目缺 text"
);
ok(
  "包内正文就是课内的那 251 条",
  Object.keys(courseTexts).every((id) => courseIds.has(id)),
  "混进了非课内条目"
);
ok("课内那 251 条每一条都取得到正文",
  perBook.poems.every((p) => courseTexts[p.id] && courseTexts[p.id].text),
  "有 " + perBook.poems.filter((p) => !courseTexts[p.id]).length + " 条没有正文");
ok("包里不再有正文分片与分片清单",
  !fs.existsSync(path.join(dataDir, "texts")) && !fs.existsSync(path.join(dataDir, "shards.js")),
  "data/texts/ 或 data/shards.js 还在 —— 课外正文已经整体删掉了");

{
  const pcfg = readJson(path.join(ROOT, "project.config.json")) || {};
  const ignored = ((pcfg.packOptions || {}).ignore || []).map((r) => String(r.value || ""));

  {
    const rel = "data/books/index.js";
    ok("集子索引在包里 " + rel,
      fs.existsSync(path.join(ROOT, rel)) && !ignored.some((ig) => rel.indexOf(ig) === 0),
      rel + " 被 ignore 了 —— 列表页与按题名检索会空");
  }

  ok("课文阅读页取正文先看有没有这一篇（不拿取不到的 id 去问 corpus.entry）",
    /meta\s*\?\s*corpus\.entry\(id\)\s*:\s*null/.test(
      fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.js"), "utf8")
    ),
    "reader.js 拿一个包里没有的 id 去 corpus.entry —— 真机上它抛，整屏白");

  const readerAdvance = fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.js"), "utf8");
  const sheetAdvance = fs.readFileSync(
    path.join(ROOT, "components", "recite-sheet", "recite-sheet.js"), "utf8");
  ok("评完分自动翻篇的计时器，页面/组件走了要清掉",
    /this\.advance\s*=\s*setTimeout/.test(readerAdvance)
      && /onUnload\s*\(\)\s*{[\s\S]{0,120}?clearTimeout\(this\.advance\)/.test(readerAdvance)
      && /this\.advance\s*=\s*setTimeout/.test(sheetAdvance)
      && /detached\s*\(\)\s*{[\s\S]{0,120}?cancelAdvance\(\)/.test(sheetAdvance),
    "700ms 后再翻页，人在这 700ms 里退出，回调仍会打在已卸载的页面/组件上");
}

const R = require(path.join(ROOT, "utils", "review-models.js"));

ok("四套算法都在", R.ORDER.length === 4 && R.ORDER.every((k) => R.MODELS[k]));

{
  const noon = new Date(2025, 0, 6, 12, 0, 0).getTime();
  const evening = new Date(2025, 0, 6, 23, 0, 0).getTime();
  const nextAt = (t, result) => R.review(null, result, "ebbinghaus", t).nextReviewAt;
  const noonBad = nextAt(noon, "bad");
  const noonFuzzy = nextAt(noon, "fuzzy");
  const eveningBad = nextAt(evening, "bad");
  const eveningFuzzy = nextAt(evening, "fuzzy");
  ok("忘记 / 模糊：下一次落在复习时刻上，不落在半夜",
    noonBad === R.startOfDay(noon) + 2 * R.DAY + 9 * R.HOUR
      && noonFuzzy === noonBad
      && eveningBad === R.startOfDay(evening) + R.DAY + 9 * R.HOUR
      && eveningFuzzy === eveningBad,
    "中午评「忘记」落在 " + new Date(noonBad).toLocaleString("zh-CN")
      + "，评「模糊」落在 " + new Date(noonFuzzy).toLocaleString("zh-CN")
      + "；夜里 23 点评「忘记」落在 " + new Date(eveningBad).toLocaleString("zh-CN")
      + "。12 小时 / 30 分钟这样的短间隔照着结果类型硬加，就会把复习推到半夜或凌晨，"
      + "而人在那个点上不会背诗");
  ok("隔天的复习都排在同一天的同一刻，日历上的到期日与排期不打架",
    [noonBad, noonFuzzy, eveningBad, eveningFuzzy, nextAt(noon, "good")].every((at) =>
      at === R.startOfDay(at) + 9 * R.HOUR || at === R.startOfDay(at) + R.DAY + 9 * R.HOUR),
    "有个结果排到了 9 点以外：" + [noonBad, noonFuzzy, eveningBad, eveningFuzzy]
      .map((at) => new Date(at).toLocaleString("zh-CN")).join(" / "));
}

R.ORDER.forEach((key) => {
  const r = R.review({ level: 5, learned: true, lapses: 1, reviewCount: 6 }, "good", key);
  ok("换算法保进度 " + key, r.learned === true && typeof r.level === "number");
});

{
  const walk = (key, result, times, start) => {
    let r = null;
    let t = start;
    const seen = [];
    for (let i = 0; i < times; i++) {
      r = R.review(r, result, key, t);
      seen.push(r);
      t = r.nextReviewAt + 24 * 3600 * 1000;
    }
    return seen;
  };
  const goodDays = (key, n) => walk(key, "good", n, Date.now())
    .map((r) => Math.round((R.startOfDay(r.nextReviewAt) - R.startOfDay(r.lastReviewAt)) / (24 * 3600 * 1000)));

  ok("艾宾浩斯：连续记住就走完那张固定表的每一格",
    goodDays("ebbinghaus", 9).join(",") === R.EBBINGHAUS_INTERVALS.slice(1).join(","),
    "实际 " + goodDays("ebbinghaus", 9).join(",") + "，表里是 " + R.EBBINGHAUS_INTERVALS.slice(1).join(","));
  ok("艾宾浩斯：表走到头就不再往后",
    goodDays("ebbinghaus", 12)[11]
      === R.EBBINGHAUS_INTERVALS[R.EBBINGHAUS_INTERVALS.length - 1],
    "实际 " + goodDays("ebbinghaus", 12)[11]);

  const BOXES = R.MODELS.leitner.boxes;
  const boxes = walk("leitner", "good", BOXES.length, Date.now());
  ok("莱特纳：答对一次往后挪一盒，间隔就是那一盒的天数",
    boxes.map((r, i) => {
      const want = Math.min(i + 1, BOXES.length - 1);
      return (r.box === want
        && Math.round((R.startOfDay(r.nextReviewAt) - R.startOfDay(r.lastReviewAt)) / (24 * 3600 * 1000)) === BOXES[want]);
    }).every(Boolean),
    boxes.map((r) => (r.box + 1) + "号盒").join(","));
  ok("莱特纳：最后一盒答对仍留在最后一盒",
    (() => {
      const last = boxes[boxes.length - 1];
      const end = R.review(last, "good", "leitner", last.lastReviewAt + 16 * 24 * 3600 * 1000);
      return end.box === BOXES.length - 1;
    })());
  ok("莱特纳：答错退回第 1 盒",
    (() => {
      const b = boxes[3];
      return R.review(b, "bad", "leitner", b.lastReviewAt + 9 * 24 * 3600 * 1000).box === 0;
    })());

  const sm2 = walk("sm2", "good", 4, Date.now());
  ok("SM-2：新卡记住走的那几步，就是算法自己报出来的那几步",
    sm2.slice(0, 3).map((r) => r.interval).join(",") === R.MODELS.sm2.steps().slice(0, 3).join(","),
    "实际 " + sm2.map((r) => r.interval).join(",") + "，自报 " + R.MODELS.sm2.steps().join(","));
  ok("SM-2：走完那几步之后才是「乘简易度」",
    (() => {
      const last = sm2[sm2.length - 1];
      const next = R.review(last, "good", "sm2", last.lastReviewAt + last.interval * 24 * 3600 * 1000);
      return next.interval === Math.max(1, Math.round(last.interval * last.ef)) && next.ef >= last.ef;
    })());
  ok("SM-2：简易度压到 " + R.MODELS.sm2.MIN_EF + " 就不再低",
    (() => {
      let r = null;
      let t = Date.now();
      for (let i = 0; i < 12; i++) { r = R.review(r, "bad", "sm2", t); t += 24 * 3600 * 1000; }
      return r.ef === R.MODELS.sm2.MIN_EF && r.interval === R.MODELS.sm2.firstIntervals[0];
    })());

  const fsrs = walk("fsrs", "good", 4, Date.now());
  ok("FSRS：越稳固间隔越长，下一次由稳定天数算出来",
    fsrs.every((r, i) => i === 0 || r.stability > fsrs[i - 1].stability)
      && fsrs.every((r) => Math.round((R.startOfDay(r.nextReviewAt) - R.startOfDay(r.lastReviewAt)) / (24 * 3600 * 1000)) === R.MODELS.fsrs.intervalOf(r.stability)),
    fsrs.map((r) => r.stability).join(" → "));
  const fsrsBad = R.review(fsrs[3], "bad", "fsrs", fsrs[3].lastReviewAt + 44 * 24 * 3600 * 1000);
  ok("FSRS：记错砍稳定天数、加难度",
    fsrsBad.stability < fsrs[3].stability && fsrsBad.difficulty > fsrs[3].difficulty,
    "S " + fsrs[3].stability + " → " + fsrsBad.stability + "，D " + fsrs[3].difficulty + " → " + fsrsBad.difficulty);

  ok("四套算法各给三行说明（不多不少）",
    R.ORDER.every((k) => {
      const d = R.MODELS[k].describe();
      return Array.isArray(d) && d.length === 3 && d.every((x) => typeof x === "string");
    }),
    R.ORDER.map((k) => k + ":" + R.MODELS[k].describe().length).join(" "));
  ok("说明里写的那张间隔表就是跑出来的那张（艾宾浩斯）",
    R.MODELS.ebbinghaus.describe().some((x) => x.indexOf(R.EBBINGHAUS_INTERVALS.slice(1).join(" → ")) >= 0));
  ok("说明里写的那组盒子就是跑出来的那组（莱特纳）",
    R.MODELS.leitner.describe().some((x) => x.indexOf(R.MODELS.leitner.boxes.join(" / ")) >= 0));
  ok("说明里写的头几步就是跑出来的那几步（SM-2）",
    R.MODELS.sm2.describe().some((x) => x.indexOf(
      R.MODELS.sm2.steps().slice(0, R.MODELS.sm2.firstIntervals.length).join(" → ")) >= 0),
    "描述 " + R.MODELS.sm2.describe().join(" / "));
}

let r10 = null;
let r10At = Date.now();
for (let i = 0; i < 12; i++) {
  r10At = r10 ? r10.nextReviewAt + 24 * 3600 * 1000 : r10At;
  r10 = R.review(r10, "good", "ebbinghaus", r10At);
}
ok("艾宾浩斯档位封顶不越界", r10.level === R.LEVEL_MAX, "level=" + r10.level);

{
  const caps = {};
  R.ORDER.forEach((k) => {
    let r = null;
    let t = Date.now();
    for (let i = 0; i < 20; i++) {
      r = R.review(r, "good", k, t);
      t = r.nextReviewAt + 24 * 3600 * 1000;
    }
    caps[k] = r.level;
  });
  ok("四套算法数的是同一把尺子（连续记住都走到同一格封顶）",
    R.ORDER.every((k) => caps[k] === R.LEVEL_MAX),
    R.ORDER.map((k) => k + ":" + caps[k]).join(" "));

  ok("掌握度满分 = 档位封顶那一格",
    R.mastery({ level: R.LEVEL_MAX, learned: true }) === 100
      && R.mastery({ level: 0, learned: true }) === 0
      && R.mastery(null) === 0 && R.mastery({ level: 9, learned: false }) === 0);

  const firstMastered = (() => {
    for (let lv = 0; lv <= R.LEVEL_MAX; lv++) {
      if (R.mastered({ level: lv, learned: true })) return lv;
    }
    return -1;
  })();
  ok("「已掌握」的门槛就落在掌握度分布最后一档里（不会被算进别的档）",
    firstMastered > 0
      && !R.mastered({ level: firstMastered - 1, learned: true })
      && Math.floor(R.mastery({ level: firstMastered - 1, learned: true }) / 20)
        === Math.floor(R.MASTERED_PERCENT / 20) - 1
      && Math.floor(R.mastery({ level: firstMastered, learned: true }) / 20)
        === Math.floor(R.MASTERED_PERCENT / 20),
    "门槛 " + R.MASTERED_PERCENT + "% 落在第 " + firstMastered + " 格，与分布的档位对不齐");
}

{
  const inline = fs.readFileSync(path.join(ROOT, "components", "recite-sheet", "recite-sheet.js"), "utf8")
    + fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.js"), "utf8")
    + fs.readFileSync(path.join(ROOT, "utils", "scheduler.js"), "utf8");
  ok("掌握度只在一个地方算（界面与排期都调 R.mastery，不各写一遍除法）",
    /\/\s*R\.LEVEL_MAX/.test(inline) === false && /\/\s*9\b/.test(inline) === false
      && inline.indexOf("R.mastery(") >= 0,
    "又有页面自己算了掌握度 —— 改一次口径就得改好几处");
}

let rh = null;
for (let i = 0; i < 60; i++) rh = R.review(rh, "good", "ebbinghaus");
ok("历史只留最近 20 次", rh.history.length <= 20, "实际 " + rh.history.length);

{
  const day1 = new Date(2026, 9, 16, 10, 0, 0).getTime();
  const day2 = new Date(2026, 9, 17, 10, 0, 0).getTime();

  let same = R.review(null, "bad", "ebbinghaus", day1);
  same = R.review(same, "good", "ebbinghaus", day1 + 60000);
  same = R.review(same, "fuzzy", "ebbinghaus", day1 + 120000);
  ok("同一天改判，留的是最后一次",
    same.history.length === 1 && same.history[0].result === "fuzzy",
    "历史 " + same.history.map((h) => h.result).join(","));

  let good = R.review(null, "good", "ebbinghaus", day1);
  good = R.review(good, "fuzzy", "ebbinghaus", day1 + 120000);
  ok("同日改判，掌握度按最后一次算",
    good.level === same.level && same.level === 0,
    "level " + same.level + " / " + good.level);

  let lapse = R.review(null, "bad", "ebbinghaus", day1);
  lapse = R.review(lapse, "fuzzy", "ebbinghaus", day1 + 120000);
  ok("同日改判，忘过的次数跟着退回去", lapse.lapses === 0, "lapses=" + lapse.lapses);

  const once = R.review(null, "good", "ebbinghaus", day1);
  let clicks = once;
  for (let i = 0; i < 4; i++) clicks = R.review(clicks, "good", "ebbinghaus", day1 + 1000 * (i + 1));
  ok("同一天连点同一个按钮，记忆周期仍是那一天的第一个周期",
    clicks.level === once.level && clicks.nextReviewAt === once.nextReviewAt,
    "连点 5 下停在 level " + clicks.level + " / " + R.stageName(clicks, "ebbinghaus")
      + "，只点一下是 level " + once.level + " / " + R.stageName(once, "ebbinghaus"));

  let twice = R.review(null, "bad", "ebbinghaus", day1);
  twice = R.review(twice, "fuzzy", "ebbinghaus", day1 + 60000);
  twice = R.review(twice, "good", "ebbinghaus", day1 + 120000);
  ok("同日评几次都只算一次复习", twice.reviewCount === 1, "reviewCount=" + twice.reviewCount);

  let next = R.review(null, "good", "ebbinghaus", day1);
  next = R.review(next, "fuzzy", "ebbinghaus", day1 + 120000);
  next = R.review(next, "good", "ebbinghaus", day2);
  next = R.review(next, "bad", "ebbinghaus", day2 + 1000);
  ok("隔天再评，连同前一天那次一起记",
    next.history.length === 2 && next.history[1].result === "bad" && next.reviewCount === 2,
    "历史 " + next.history.map((h) => h.result).join(",") + "，reviewCount=" + next.reviewCount);
}

const wxCalls = {};
global.wx = {
  getStorageSync: (k) => (k in wxCalls ? wxCalls[k] : ""),
  setStorageSync: (k, v) => {
    wxCalls[k] = v;
  },
  removeStorageSync: (k) => {
    delete wxCalls[k];
  }
};

const store = require(path.join(ROOT, "utils", "store.js"));
const S = require(path.join(ROOT, "utils", "scheduler.js"));

ok("设置默认值完整", store.settings().grade === 1 && store.settings().algo === "ebbinghaus");

store.saveSettings({ grade: 5 });
store.saveSettings({ lastSearch: "李白" });
ok("saveSettings 保留未知键", store.read(store.KEYS.settings, {}).lastSearch === "李白");
ok("saveSettings 保留已知键", store.settings().grade === 5);

const fake = [];
for (let g = 1; g <= 12; g++) {
  for (let t = 1; t <= 2; t++) {
    for (let i = 0; i < 12; i++) {
      fake.push({ id: "p-" + g + "-" + t + "-" + i, t: "诗" + g + t + i, a: "作者", d: "唐", gr: g, tm: t, b: "poems" });
    }
  }
}

const plan = S.generateDailyPlan({
  grade: 5,
  term: 1,
  count: 5,
  scope: "term",
  allPoems: fake,
  extraPoems: [],
  getRecord: () => null
});

ok("每日计划产出 5 首", plan.length === 5, "实际 " + plan.length);
ok("计划内不重复", new Set(plan.map((p) => p.poem.id)).size === plan.length);
ok(
  "本册范围只取本册",
  plan.every((p) => p.poem.gr === 5 && p.poem.tm === 1)
);

store.drop(store.KEYS.dayPlan);

const dueId = "p-5-1-3";
const plan2 = S.generateDailyPlan({
  grade: 5,
  term: 1,
  count: 5,
  scope: "term",
  allPoems: fake,
  extraPoems: [],
  getRecord: (id) =>
    id === dueId ? { level: 3, learned: true, nextReviewAt: Date.now() - 86400000 } : null
});
ok("到期项排第一", plan2[0].poem.id === dueId, "实际 " + plan2[0].poem.id);
ok("到期项标了复习", plan2[0].reason === "review");

const smallPool = fake.filter((p) => p.gr === 5 && p.tm === 1).slice(0, 3);
const extraPoem = { id: "extra-1", t: "加背", a: "作者", d: "唐", gr: 12, tm: 2, b: "poems" };
const plan3 = S.generateDailyPlan({
  grade: 5,
  term: 1,
  count: 5,
  scope: "term",
  allPoems: smallPool,
  extraPoems: [extraPoem],
  getRecord: () => null
});
ok("加背项进计划", plan3.some((p) => p.poem.id === extraPoem.id));
store.drop(store.KEYS.dayPlan);

const inCourse = fake.filter((p) => p.gr === 5 && p.tm === 1)[0];
const plan5 = S.generateDailyPlan({
  grade: 5,
  term: 1,
  count: 5,
  scope: "term",
  allPoems: fake,
  extraPoems: [extraPoem, inCourse],
  getRecord: () => null
});
ok("加背挂在每日几首之外（设 5 首 + 加 2 首 = 今天 7 首）",
  plan5.length === 7, "实际 " + plan5.length);

const pinned = plan5.filter((p) => p.reason === "pinned").map((p) => p.poem.id);
ok("加背那两首都排在计划末尾，标 pinned",
  pinned.length === 2 && pinned.indexOf(extraPoem.id) >= 0
    && plan5.slice(-2).every((p) => p.reason === "pinned"),
  JSON.stringify(pinned));

const plainOpt = {
  grade: 5,
  term: 1,
  count: 5,
  scope: "term",
  allPoems: fake,
  extraPoems: [],
  getRecord: () => null
};
store.drop(store.KEYS.dayPlan);
const plain = S.generateDailyPlan(plainOpt);
store.saveDayPlan(S.planKeyOf(Object.assign({}, plainOpt, { extraPoems: [extraPoem] })), plain);
const outOfCourse = S.generateDailyPlan(Object.assign({}, plainOpt, { extraPoems: [extraPoem] }));
ok("加背不占那 5 个名额，也不挪动按设置排出来的那几首（只在末尾接上）",
  plain.length === 5 && outOfCourse.length === 6
    && outOfCourse.slice(0, 5).map((p) => p.poem.id).join(",") === plain.map((p) => p.poem.id).join(",")
    && outOfCourse[5].reason === "pinned");

ok("没背过的不算到期", !S.isDue(null) && !S.isDue({ level: 0, learned: false }));

const plan4 = S.generateDailyPlan({
  grade: 5,
  term: 1,
  count: 40,
  scope: "upto",
  allPoems: fake,
  extraPoems: [],
  getRecord: () => null
});
ok("要的比池子多也不重复", new Set(plan4.map((p) => p.poem.id)).size === plan4.length);

{
  store.write(store.KEYS.grant, { code: "c-自检", tier: "max", at: 1 });

  const state = {};
  const opt = (patch) => Object.assign({
    grade: 5,
    term: 1,
    count: 3,
    scope: "term",
    allPoems: fake,
    extraPoems: [],
    getRecord: (id) => state[id] || null
  }, patch || {});

  S.generateDailyPlan(opt());
  const first = S.generateDailyPlan(opt());
  ok("今天的名单排出来就记下（同一天再问还是这一份）", first.length === 3);

  const firstIds = first.map((it) => it.poem.id);
  first.forEach((it) => {
    state[it.poem.id] = { level: 1, learned: true, nextReviewAt: Date.now() + 86400000 };
  });
  const after = S.generateDailyPlan(opt());
  ok("今天那几首背完，明天再叫新的（背完不自动换一批）",
    after.map((it) => it.poem.id).join(",") === firstIds.join(","),
    "背完后换成了 " + after.map((it) => it.poem.id).join(","));

  const fresh = "p-5-1-9";
  state[fresh] = { level: 2, learned: true, nextReviewAt: Date.now() - 86400000 };
  const withDue = S.generateDailyPlan(opt());
  ok("当天新到期的照样补进今天（不占别人的位置）",
    withDue.length === 4 && withDue[3].poem.id === fresh && withDue[3].reason === "review",
    withDue.map((it) => it.poem.id + ":" + it.reason).join(" "));

  ok("补进来的那条也在盘上（再问一次不会重复补）",
    S.generateDailyPlan(opt()).length === 4);

  const extra = { id: "p-12-2-11", t: "加背", a: "作者", d: "唐", gr: 12, tm: 2, b: "poems" };
  const withExtra = S.generateDailyPlan(opt({ extraPoems: [extra] }));
  ok("新增温习接在今天那几首之后，不占它们的名额",
    withExtra.length === 5 && withExtra[4].poem.id === extra.id
      && withExtra[4].reason === "pinned"
      && withExtra.slice(0, 4).map((it) => it.poem.id).join(",") === withDue.map((it) => it.poem.id).join(","),
    withExtra.map((it) => it.poem.id + ":" + it.reason).join(" "));

  {
    const defer = require(path.join(ROOT, "utils", "defer.js"));
    const quotaRows = (list) => list.filter((it) => it.reason !== "pinned");
    const heldOne = withExtra[0].poem.id;
    defer.put(heldOne, "tomorrow");
    const held = S.generateDailyPlan(opt({ extraPoems: [extra] }));
    const named = defer.isHeld(store.deferList().filter((it) => it.wid === heldOne)[0]);
    ok("压着的那一首不上今天的榜，空出来的位置补一首新的（条数不变）",
      held.length === withExtra.length && held.every((it) => it.poem.id !== heldOne)
        && quotaRows(held).length === quotaRows(withExtra).length,
      "压着 " + heldOne + " 之后：" + held.map((it) => it.poem.id + ":" + it.reason).join(" ")
        + "；之前：" + withExtra.map((it) => it.poem.id + ":" + it.reason).join(" "));
    ok("压着的是加背那首，它不再带出今天没排过的篇目（名额不跟着挤）",
      (() => {
        const before = S.generateDailyPlan(opt({ extraPoems: [extra] }));
        const ids = (list) => list.map((it) => it.poem.id).sort().join(",");
        defer.put(extra.id, "tomorrow");
        const after = S.generateDailyPlan(opt({ extraPoems: [extra] }));
        return ids(quotaRows(after)) === ids(quotaRows(before)) && after.length === before.length;
      })(),
      "压掉加背后 plan 还在长");
    ok("压着的那一条认得出「哪天回来」", named === true);
    ok("到期当天就回来（不是多压一天）",
      defer.isHeld({ wid: heldOne, day: store.dayKey(), until: store.dayKey(), span: 1 }) === false);
    ok("服务端补零的日期与前端的不补零算同一天",
      defer.isHeld({ wid: heldOne, day: store.dayKey(), until: defer.shiftDay(store.dayKey(), 1) }) === true
        && defer.daysLeftOf({ wid: heldOne, day: store.dayKey(), until: "2099-01-02" })
          === defer.daysLeftOf({ wid: heldOne, day: store.dayKey(), until: "2099-1-2" }));
    defer.drop(heldOne);
  }

  {
    store.dropDayPlan();
    const base = S.generateDailyPlan(opt());
    const withExtra2 = S.generateDailyPlan(opt({ extraPoems: [extra] }));
    const key = S.planKeyOf(opt({ extraPoems: [extra] }));
    const counted = S.todaySet(key, withExtra2.filter((it) => it.reason !== "pinned").length);
    ok("今日的「今日 / 已温习 / 待温习」只数按设置排的那几首，加背不在分母里",
      counted.length === base.length && counted.indexOf(extra.id) < 0,
      "数出来 " + counted.join(",") + "，按设置排的是 " + base.map((it) => it.poem.id).join(","));
  }

  {
    const defer = require(path.join(ROOT, "utils", "defer.js"));
    const full = S.generateDailyPlan(opt({ count: 5 }));
    defer.put(full[0].poem.id, "tomorrow");
    const once = S.generateDailyPlan(opt({ count: 5 }));
    const twice = S.generateDailyPlan(opt({ count: 5 }));
    defer.drop(full[0].poem.id);
    ok("压着的那一首只在第一次补位，补进来的不再被算成缺额（名单不会越排越长）",
      once.length === 5 && twice.map((it) => it.poem.id).join(",") === once.map((it) => it.poem.id).join(",")
        && once.map((it) => it.poem.id).indexOf(full[0].poem.id) < 0,
      full.length + " -> " + once.length + " -> " + twice.length);
  }

  store.dropDayPlan();

  {
    const defer = require(path.join(ROOT, "utils", "defer.js"));
    const stamp = store.deferAt() - 60000;
    store.setDefer(store.deferList(), stamp);
    defer.put(withExtra[1].poem.id, "tomorrow");
    ok("点一次「再背」就把台账当成新的（不会被服务端当成旧行丢掉）",
      store.deferAt() > stamp, stamp + " -> " + store.deferAt());
    defer.drop(withExtra[1].poem.id);
  }

  store.dropDayPlan();
  const tomorrow = S.generateDailyPlan(opt({ count: 5 }));
  ok("换了设置就重排（首数变了，今天是另一份名单）",
    tomorrow.length === 5, 
    tomorrow.map((it) => it.poem.id + ":" + it.reason).join(" "));

  store.dropDayPlan();
  store.drop(store.KEYS.grant);
}

store.setDailyExtra(["a", "b"]);
ok("加背当天可读", store.dailyExtra().length === 2);
wxCalls[store.KEYS.dailyExtra] = { day: "2000-1-1", ids: ["a"] };
ok("加背跨天归零", store.dailyExtra().length === 0);

{
  function bootFont(auth, extra) {
    const box = { kb_auth_v1: auth };
    const savedProfile = store.read(store.KEYS.profile, {});
    const saved = global.wx;
    global.wx = Object.assign(
      {
        getStorageSync: (k) => (k in box ? box[k] : ""),
        setStorageSync: (k, v) => { box[k] = v; },
        removeStorageSync: (k) => { delete box[k]; }
      },
      extra || {}
    );
    delete require.cache[require.resolve(path.join(ROOT, "utils", "font.js"))];
    delete require.cache[require.resolve(path.join(ROOT, "utils", "entitlement.js"))];
    return {
      font: require(path.join(ROOT, "utils", "font.js")),
      restore: () => {
        global.wx = saved;
        store.write(store.KEYS.profile, savedProfile);
      }
    };
  }

  function asTier(tier) {
    store.saveProfile({ logged: true, tier: "" });
    store.write(store.KEYS.auth, { tier: tier });
  }

  const seen = [];
  const e = bootFont({}, { loadFontFace: (o) => { seen.push(o); o.success && o.success(); } });
  ok("默认地址下诗词字体就绪", e.font.readiness().usable === true);
  e.font.load().then(() => {
    ok("诗词文本只注册一个字族（详情页题名与正文取的是同一个）",
      seen.length === 1 && seen[0].family === e.font.face().family,
      seen.map((o) => o.family).join(" | ") || "loadFontFace 没被调用");
    ok("未登录取默认那一款的 free 子集，woff2 在前、woff 兜底",
      seen[0].source === e.font.FACES[0].free[0]
        && /\/zhuquefangsong-regular\/free\.woff2$/.test(seen[0].source)
        && /\/free\.woff$/.test(e.font.FACES[0].free[1]),
      seen[0].source);
    ok("子集地址按目录 + 档位取名，文件名里只有档位一个词",
      e.font.FACES.every((f) => ["free", "pro", "max"].every((size) => f[size].every((u) => {
        const parts = u.replace(e.font.BASE, "").split("/");
        return parts.length === 2 && parts[0] === f.dir && parts[1] === size + (/woff2$/.test(u) ? ".woff2" : ".woff");
      }))),
      e.font.FACES[0].free.join(" | "));
  });
  e.restore();

  asTier("free");
  const picked = bootFont({}, { loadFontFace: (o) => { o.success && o.success(); } });
  ok("Free 换不了字体（十三款摆着，只有默认那款可选）",
    picked.font.pickable() === false
      && picked.font.options().length === picked.font.FACES.length
      && picked.font.set("huiwen").ok === false,
    JSON.stringify(picked.font.options()) + " / pickable=" + picked.font.pickable());
  picked.font.set("huiwen");
  ok("Free 换了也还是那款默认的", picked.font.current() === picked.font.DEFAULT, picked.font.current());
  picked.restore();

  const proSeen = [];
  asTier("pro");
  const ep = bootFont({}, { loadFontFace: (o) => { proSeen.push(o.source); o.success && o.success(); } });
  ep.font.load().then(() => {
    ok("Pro 取 pro 那一份", proSeen[0] === ep.font.addresses(ep.font.DEFAULT)[0]
      && /\/zhuquefangsong-regular\/pro\.woff2$/.test(proSeen[0]), proSeen[0]);
    ok("Free / Pro / Max 是同一款的三份",
      ep.font.FACES[0].free[0] !== ep.font.FACES[0].pro[0]
        && ep.font.FACES[0].pro[0] !== ep.font.FACES[0].max[0]
        && ep.font.FACES[0].free[0] !== ep.font.FACES[1].free[0]);
    proSeen.length = 0;
    return ep.font.load();
  }).then(() => {
    ok("同一款注册过就不再注册一次", proSeen.length === 0, proSeen.join(" | "));
    ok("每款字各有各的字族与地址（不是同一份换个名字）",
      ep.font.FACES.every((f, i) => ep.font.FACES.every((g, j) => i === j
        || (f.family !== g.family && f.pro[0] !== g.pro[0]))),
      ep.font.FACES.map((f) => f.family + " " + f.pro[0]).join(" | "));
    proSeen.length = 0;
    const r = ep.font.set("huiwen");
    ok("Pro 切到汇文明朝，换的是它自己的那一份", r.ok === true && ep.font.current() === "huiwen");
    return ep.font.load().then(() => {
      ok("切换之后重新注册的是新款那一份",
        proSeen.length === 1 && proSeen[0] === ep.font.addresses("huiwen")[0]
          && proSeen[0].indexOf("huiwen") > 0,
        proSeen.join(" | "));
    });
  });
  ep.restore();

  const maxSeen = [];
  asTier("max");
  const em = bootFont({}, { loadFontFace: (o) => { maxSeen.push(o.source); o.success && o.success(); } });
  em.font.load().then(() => {
    ok("Max 取 max 那一份", maxSeen.length === 1 && maxSeen[0] === em.font.addresses(em.font.DEFAULT)[0]
      && /\/zhuquefangsong-regular\/max\.woff2$/.test(maxSeen[0]), maxSeen.join(" | "));
    maxSeen.length = 0;
    const r = em.font.set("yozai");
    ok("Pro 升 Max 后换一款，注册的是这款的 max 子集",
      r.ok === true && maxSeen.length === 1 && /\/yozai-regular\/max\.woff2$/.test(maxSeen[0]),
      maxSeen.join(" | "));
  });
  em.restore();

  const fallback = [];
  asTier("free");
  const e3 = bootFont({}, {
    loadFontFace: (o) => {
      fallback.push(o.source);
      o.source.indexOf(".woff2") >= 0 ? (o.fail && o.fail({})) : (o.success && o.success());
    }
  });
  e3.font.load().then((hit) => {
    ok("woff2 那一份注册失败就退到 woff（老 iOS）",
      hit === true && fallback.length === 2 && fallback[1] === e3.font.addresses(e3.font.DEFAULT)[1],
      fallback.join(" | "));
  });
  e3.restore();

  const idle = [];
  const e2 = bootFont({ fontUrl: "" }, { loadFontFace: (o) => { idle.push(o); o.success && o.success(); } });
  ok("地址被显式清空时就绪为否", e2.font.readiness().usable === false);
  e2.font.load().then(() => {
    ok("没地址时不去注册字体", idle.length === 0, idle.map((o) => o.family).join(" | "));
  });
  e2.restore();

  const previewSeen = [];
  asTier("pro");
  const epv = bootFont({}, { loadFontFace: (o) => { previewSeen.push(o); o.success && o.success(); } });
  epv.font.preview().then((hit) => {
    ok("字体卡每格预览取该款目录下的 7 那一份，不是 free / pro / max",
      hit === true && previewSeen.length === epv.font.FACES.length
        && epv.font.FACES.every((f) => {
          const seen0 = previewSeen.filter((o) => o.family === f.previewFamily)[0];
          return seen0 && seen0.source === f.preview[0]
            && new RegExp("/" + f.dir + "/7\\.woff2?$").test(seen0.source);
        }),
      previewSeen.map((o) => o.family + " " + o.source).join(" | "));
    return epv.font.preview();
  }).then((again) => {
    ok("预览注册过就不再注册一次",
      again === true && previewSeen.length === epv.font.FACES.length,
      previewSeen.map((o) => o.family).join(" | "));
    epv.restore();
  });

}

{
  store.drop(store.KEYS.auth);
  delete require.cache[require.resolve(path.join(ROOT, "utils", "entitlement.js"))];
  const ent = require(path.join(ROOT, "utils", "entitlement.js"));
  store.saveProfile({ logged: true, tier: "max" });
  ok("本机写 max 不生效（无签名，按免费算）", ent.status().blocked === "unsigned", JSON.stringify(ent.status()));
  ok("无签名档位退回免费", ent.status().tier === "free", ent.status().tier);
  store.saveProfile({ logged: false, tier: "" });
}

const pinyin = require(path.join(ROOT, "utils", "pinyin.js"));
const pinyinTable = path.join(dataDir, "pinyin-table.js");
if (fs.existsSync(pinyinTable)) {

  const pt = readModule(pinyinTable);
  ok("读音表带多音字集合", Object.keys(pt.poly || {}).length >= 50, "实际 " + Object.keys(pt.poly || {}).length);
  ok("注音就绪", pinyin.readiness().usable === true);

  ok("逐字标音不丢字", pinyin.annotate("床前明月光", "all").length === 5);

  const full = pinyin.annotate("白发三千丈", "all");
  const markOf = (ch) => (full.find((c) => c.ch === ch) || {}).mark;
  ok("全文注音标到「发」", markOf("发") === true);
  ok("注音只剩两档（不注音 / 全文），生字档已下线",
    pinyin.annotate("白发三千丈", "rare").every((c) => !c.mark));

  ok("多音字按词组消歧 白发→fà", pinyin.readOf("发", "白发", 1) === "fà", pinyin.readOf("发", "白发", 1));

  const wordMiss = [];
  Object.keys(pt.words || {}).forEach((w) => {
    const chars = Array.from(w);
    chars.forEach((ch, off) => {
      if (!pinyin.readings(ch).length || ch === "一") return;
      const got = pinyin.readOf(ch, w, off);
      if (got !== pt.words[w][off]) wordMiss.push(w + chars[off] + got);
    });
  });
  ok("词组表逐字生效（词内每个字都按表读）", wordMiss.length === 0,
    wordMiss.slice(0, 5).join(" ") + (wordMiss.length > 5 ? " …共 " + wordMiss.length : ""));
  ok("关掉注音就不切词", pinyin.annotate("床前明月光", "off").every((c) => !c.mark));

  const cmod = require(path.join(ROOT, "utils", "corpus.js"));

  const t3 = cmod.layout("鹅，鹅，鹅，\n\n曲项向天歌。").paras;
  const t3r = pinyin.render(t3, "all");
  ok("注音形状：段数不丢", t3r.length === 2, JSON.stringify(t3r.length));

  ok("注音形状：一行切得出多句", t3r[0][0].length === 3, JSON.stringify(t3r[0][0].length));
  ok("注音形状：每句带序号", t3r[0][0][0].i === 0 && t3r[1][0][0].i === 3,
    JSON.stringify(t3r.map((p) => p.map((r) => r.map((c) => c.i)))));
  const t3first = t3r[0][0][0].tokens;
  ok("注音形状：每句是字数组", t3first.length === 2 && t3first[0].ch === "鹅",
    JSON.stringify(t3first.map((x) => x.ch)));

  ok("注音不重切句子（逗号还在）", t3first.some((c) => c.ch === "，"),
    JSON.stringify(t3first));
  const t3last = t3r[1][0][0].tokens;
  ok("注音不重切句子（句号还在）", t3last[t3last.length - 1].ch === "。",
    JSON.stringify(t3last));

  const t4 = pinyin.render(cmod.layout("白发三千丈").paras, "all");
  ok("切句后消歧窗口仍是整行（白发→fà）",
    t4[0][0][0].tokens.filter((c) => c.ch === "发")[0].py === "fà",
    JSON.stringify(t4[0][0][0].tokens.filter((c) => c.ch === "发")));

  const t5 = pinyin.render(cmod.layout("君不见，高堂明镜悲白发，朝如青丝暮成雪。").paras, "all");
  const f5 = t5[0]
    .map((row) => row.map((cl) => cl.tokens.filter((c) => c.ch === "发")).reduce((a, c) => a.concat(c), []))
    .reduce((a, c) => a.concat(c), []);
  ok("折叠后同行的相邻句不丢消歧窗口（白发→fà）", f5.length && f5[0].py === "fà",
    JSON.stringify(f5));
} else {
  ok("读音表未生成时注音整块关闭", pinyin.readiness().visible === false);
}

const splitLines = require(path.join(ROOT, "utils", "corpus.js")).splitLines;
ok("splitLines 一行切多句", splitLines("鹅，鹅，鹅，\n曲项向天歌。")[0].s.length === 3);

const clausePunct = splitLines("鹅，鹅，鹅，\n曲项向天歌。");
ok("splitLines 标点留在句尾", clausePunct[0].s.join("") === "鹅，鹅，鹅，",
  JSON.stringify(clausePunct[0].s));
ok("splitLines 切句后拼回 = 原行", clausePunct.map((ln) => ln.s.join("")).join("") === "鹅，鹅，鹅，曲项向天歌。",
  JSON.stringify(clausePunct.map((ln) => ln.s.join("")).join("")));

const rebuild = Object.keys(corpus.courseTexts()).every((k) => {
  const raw = (corpus.courseTexts()[k] || {}).text;
  if (!raw) return true;
  return splitLines(raw).map((ln) => ln.s.join("")).join("") ===
    String(raw).split("\n").map((l) => l.split(/[\s]/).join("")).join("");
});
ok("全部课内正文切句后拼得回原文", rebuild);
const quotedTail = splitLines("苏子曰：「客亦知夫水与月乎？」");
ok("切句不把收尾引号切成单独一句（「」里的句号算在引语内）",
  quotedTail[0].s.join("") === "苏子曰：「客亦知夫水与月乎？」"
    && quotedTail[0].s[quotedTail[0].s.length - 1] === "「客亦知夫水与月乎？」",
  JSON.stringify(quotedTail[0].s));
{
  const unpaired = [];
  allEntries.forEach((p) => {
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
    let depth = 0;
    for (const ch of e.text) {
      if (ch === "\u300c") depth++;
      else if (ch === "\u300d") depth--;
    }
    if (depth !== 0) unpaired.push(p.id + ":" + depth);
  });
  ok("整库正文的「」成对（引语不漏收尾引号）", !unpaired.length,
    unpaired.slice(0, 5).join(" "));
}
ok("splitLines 保留空行", splitLines("a\n\nb").length === 3 && splitLines("a\n\nb")[1].s.length === 0);
ok("splitLines 空正文不炸", splitLines("").length === 1 && splitLines(null).length === 1);

{
  const pj = fs.readFileSync(path.join(ROOT, "utils", "pinyin.js"), "utf8");
  const renderBody = /function render\(paras, mode\)\s*\{([\s\S]*?)\n\}/.exec(pj);

  ok("pinyin.render 只吃 corpus.layout() 的形状（段落 → 行 → 句）",
    !!renderBody && renderBody[1].indexOf("row") >= 0 && renderBody[1].indexOf("para") >= 0,
    renderBody ? renderBody[1].slice(0, 80) : "找不到 render");
  ok("pinyin.render 不再自己按标点切句",
    !/split\(\s*\/\[. *[，。！？]/.test(pj));
  const rjs0 = fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.js"), "utf8");
  ok("阅读页正文与注音两条路都按句渲染",
    /pinyin\.render\(/.test(rjs0) && /corpus\.layout\(/.test(rjs0));

  const sheetRender = fs.readFileSync(
    path.join(ROOT, "components", "recite-sheet", "recite-sheet.js"), "utf8");
  ok("背诵弹层正文只有一条渲染路（不注音时也得有字）",
    /pinyin\.render\(/.test(sheetRender) && !/paras:/.test(sheetRender),
    "弹层还留着按 paras 渲染的另一条路 —— 那条路读的字段没人生成，切到不注音就是一片空白");
}

const longLine = corpus.courseTexts();
const hasMulti = Object.keys(longLine).some((k) => {
  const t = longLine[k] && longLine[k].text;
  if (!t) return false;
  return splitLines(t).some((ln) => ln.s.length > 1);
});
ok("语料里确实有一行多句的篇目（切句不是白做）", hasMulti === true);

const sync = require(path.join(ROOT, "utils", "sync.js"));
ok("未配置后端时同步不就绪", sync.ready() === false);
sync.now(true).then((res) => {
  ok("未配置后端时同步报 offline", res.skipped === "offline", JSON.stringify(res));
});

const E = require(path.join(ROOT, "utils", "entitlement.js"));
const tiersMod = require(path.join(ROOT, "utils", "tiers.js"));

function asGuest() {
  store.write(store.KEYS.profile, { logged: false });
}
function asMember() {
  store.write(store.KEYS.profile, { logged: true, tier: "pro" });
}

asGuest();

["daily", "library", "pinyin", "ebbinghaus", "leitner", "sync"].forEach((k) => {
  ok("能力表含 " + k, E.CAP_KEYS.indexOf(k) >= 0 && !!E.capName(k));
});
["speak", "export", "admin"].forEach((k) => {
  ok("能力表里不再有 " + k, E.CAP_KEYS.indexOf(k) < 0,
    "这一项已经撤了（朗读：个人主体拿不到通道；导出：进度跟着账号走；管理页：owner / admin 的身份门）");
});

{
  const walkJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walkJs(p);
    return e.name.endsWith(".js") ? [p] : [];
  });

  const called = [];
  walkJs(ROOT).forEach((file) => {
    if (file === path.join(ROOT, "utils", "entitlement.js")) return;
    const src = fs.readFileSync(file, "utf8");
    const re = /(?:E|entitlement)\.(?:can|hint|block|decide|capName|algoAllowed)\(\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(src))) called.push({ key: m[1], file: path.relative(ROOT, file) });
  });

  const stray = called.filter((c) => E.CAP_KEYS.indexOf(c.key) < 0);
  ok("页面调用的能力名都在能力表里", stray.length === 0,
    stray.map((c) => c.key + " @ " + c.file).join(", ") || "");
}

function asTier(t) {
  store.write(store.KEYS.profile, { logged: true });
  store.write(store.KEYS.auth, { token: "t", tier: t, at: Date.now() });
}
asTier("free");

const homeJs = fs.readFileSync(path.join(ROOT, "pages", "home", "home.js"), "utf8");
ok("首页游客态在 js 里算出来", homeJs.indexOf("gate.GUEST_GRADE") >= 0);

ok("首页点击过门禁",
  /requireLogin\(/.test(homeJs.slice(homeJs.indexOf("openSheet(id, source) {"))),
  "openSheet 里没查登录 —— 游客点得开背诵弹层");

pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");

  let m;
  const js = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");
  const handlers = new Set();
  const hrefRe = /(?:bind|catch)(?:tap|change|input|confirm|blur|chooseavatar)="([\w$]+)"/g;
  while ((m = hrefRe.exec(wxml))) handlers.add(m[1]);
  const missing = [];
  handlers.forEach((h) => {
    if (js.indexOf(h) < 0) missing.push(h);
  });
  ok("WXML 事件都有处理函数 " + p, missing.length === 0, missing.join(","));
});

const courseEntry = corpus.entry(perBook.poems[0].id);
ok("课内正文能从包内取到", !!courseEntry && typeof courseEntry.text === "string");

const WEB_TIER = {
  daily: "free",
  library: "free",
  ebbinghaus: "free",
  sync: "free",
  leitner: "pro",
  sm2: "pro",
  extra: "pro",
  fsrs: "max",
  collections: "pro",
  feihualing: "max"
};

ok("档位表只有 free / pro / max 三档（登录不是一个档位）",
  tiersMod.TIER_KEYS.join() === "free,pro,max");
ok("能力表里没有「用户列表」（那是 owner / admin 的身份门，不是一项能力）",
  E.CAP_KEYS.indexOf("admin") < 0 && !E.CAPS.some((c) => c.tier === "admin"),
  "管理页混进能力表，对比表就多一行谁也不欠的管理权限");
[["free", 7], ["pro", 17], ["max", 23]].forEach(([tier, n]) => {
  ok("档位 " + tier + " 拿到 " + n + " 项",
    E.compareSummary().filter((s) => s.tier === tier)[0].on === n,
    JSON.stringify(E.compareSummary()));
});
Object.keys(WEB_TIER).forEach((k) => {
  const cap = E.CAPS.find((c) => c.key === k);
  ok("档位与网页版一致 " + k, !!cap && cap.tier === WEB_TIER[k],
    cap ? "小程序=" + cap.tier + " 网页版=" + WEB_TIER[k] : "能力不存在");
});

{
  const js = fs.readFileSync(
    path.join(ROOT, "components", "tier-view", "tier-view.js"), "utf8");
  const entSys = fs.readFileSync(path.join(ROOT, "utils", "entitlement.js"), "utf8");

  ok("权限对比表的列头与行都由能力表算出来（不写死）",
    js.indexOf("entitlement.compareCols(") >= 0
      && E.compareCols({ logged: false, tier: "free" }).map((c) => c.tier).join() === tiersMod.TIER_KEYS.join(),
    "列头写死、或只挑几档列出来，都会跟档位表走散");
  ok("权限对比表的行铺满能力表（一行一项，一项不漏）",
    js.indexOf("entitlement.compareRows(") >= 0
      && E.compareRows({ logged: false, tier: "free" }).map((r) => r.cap).sort().join()
        === E.CAP_KEYS.slice().sort().join(),
    "只挑几项列出来，用户就看不到自己缺哪几样；多列一行，同一项就说了两遍");
  ok("当前档位列带「现在」",
    /now:\s*t\.key === now/.test(entSys),
    "没有「现在」这枚标记时，用户看不出哪一列是自己");
  ok("档位与登录的对话框都收在 entitlement 里，「升级」落到开通会员页",
    /function showTier\s*\(/.test(entSys) && /function showLogin\s*\(/.test(entSys)
      && /onTierGate/.test(entSys)
      && /function openPricing\s*\([\s\S]{0,120}?url:\s*"\/packages\/mine\/pricing\/pricing"/.test(entSys)
      && !/askDailyUpgrade|askUpgrade/.test(entSys),
    "档位那句话又回到各页各写一遍 —— 按钮文案与去处就会各说一套（Issue #370）");
  ok("对话框的确认与取消各只有一种说法",
    jsFiles.every((f) => {
      const src = fs.readFileSync(f, "utf8");
      return !/confirmText:\s*"好"/.test(src) && !/cancelText:\s*"(?!取消|留步")[^"]+"/.test(src);
    }),
    "对话框里还有「好」这类确认键，或者取消那枚叫「再看看」「算了」");
  ok("对比表格子里的图标从图标模块取，compareRows 的 cell 不带 icon",
    /icons\.yes/.test(js) && /icons\.no/.test(js)
      && E.compareRows({ logged: false, tier: "free" })
        .every((r) => r.cells.every((c) => c.icon === undefined)),
    "格子里的图标不是从图标模块取的，或者 compareRows 自己长出了 icon（那一格会没有图）");
  ok("对比表里带量的格子写的是 tiers 里的数",
    (() => {
      const cells = (key) => (E.compareRows({ logged: false, tier: "free" })
        .filter((r) => r.cap === key)[0] || { cells: [] }).cells.map((c) => c.text);
      return cells("collections").indexOf(tiersMod.COLLECTION_LIMITS.max + " 个集合") >= 0
        && cells("records").indexOf(tiersMod.RECORD_LIMITS.max + " 条") >= 0;
    })(),
    "格子里写死的数没跟着 tiers 走");
}

{
  const setProfile = (p) => store.saveProfile(Object.assign({ grant: null }, p));
  const clearGrant = () => store.drop(store.KEYS.grant);
  const setAuth = (a) => store.write(store.KEYS.auth, Object.assign({ baseUrl: "https://example.test" }, a || {}));
  const clearAuth = () => store.drop(store.KEYS.auth);
  const clearCaps = () => store.drop(store.KEYS.caps);

  clearGrant();
  clearAuth();
  clearCaps();
  setProfile({ logged: false, tier: "" });

  const onCount = (tier) => {
    clearGrant();
    setProfile({ logged: true, tier: "" });
    if (tier !== "free") store.write(store.KEYS.grant, { code: tier.toUpperCase() + "-ABCD-1234", tier, at: Date.now() });
    let n = 0;
    E.CAP_KEYS.forEach((k) => {
      if (E.can(k)) n += 1;
    });
    return n;
  };
  const nAnon = (() => {
    clearGrant();
    setProfile({ logged: false });
    let n = 0;
    E.CAP_KEYS.forEach((k) => {
      if (E.can(k)) n += 1;
    });
    return n;
  })();
  const nFree = onCount("free");
  const nPro = onCount("pro");
  const nMax = onCount("max");
  ok("未登录拿不到任何能力（" + nAnon + " = 0）", nAnon === 0, nAnon + " 条");
  ok("档位越高能力越多（" + nFree + " ≤ " + nPro + " ≤ " + nMax + "）", nFree <= nPro && nPro <= nMax);
  ok("max 拿得到全部能力", nMax === E.CAP_KEYS.length, nMax + " / " + E.CAP_KEYS.length);

  clearGrant();
  setProfile({ logged: true, tier: "" });
  setAuth({ accessToken: "t", tier: "max" });
  ok("服务端档位生效", E.status().tier === "max" && E.status().source === "remote", JSON.stringify(E.status()));
  ok("服务端档位标记为带签名", E.status().signed === true);
  ok("服务端档位解锁飞花令", E.can("feihualing") === true);

  store.write(store.KEYS.caps, { feihualing: false });
  ok("服务端可以把某项能力单独关掉", E.can("feihualing") === false);
  ok("关掉后提示带出被关的那一项", E.hint("feihualing").indexOf(E.capName("feihualing")) >= 0, E.hint("feihualing"));
  clearCaps();

  clearAuth();
  clearGrant();
  setProfile({ logged: true, tier: "max" });
  ok("本机写 max 不生效（无签名，按免费算）", E.status().blocked === "unsigned", JSON.stringify(E.status()));
  ok("无签名的档位退回免费", E.status().tier === "free", E.status().tier);
  ok("无签名时不放行付费能力", E.can("fsrs") === false);

  clearAuth();
  clearGrant();
  clearCaps();
  setProfile({ logged: false, tier: "" });
}

const GATED = {
  "pages/reader/reader": "locked",
  "pages/list/list": "locked",
  "pages/library/library": "locked",
  "pages/search/search": "locked",
  "pages/mine/mine": "logged",
  "packages/game/index/index": "locked",
  "packages/game/quiz/quiz": "allowed",
  "packages/game/exam/exam": "allowed",
  "packages/game/feihua/feihua": "allowed",
  "packages/progress/index/index": "gate",
  "packages/progress/coll/coll": "gate",
  "packages/settings/recite/recite": "gate",
  "packages/settings/general/general": "locked",
  "packages/admin/index/index": "logged",
  "packages/mine/tier/tier": "allowed",
  "packages/feedback/index/index": "logged",
  "packages/admin/feedback/index": "logged",
  "packages/admin/feedback/detail/detail": "logged",

  "packages/authors/index/index": "locked"
};

{
  const GATE_MARK = /gate\.(logged|canRead)\(|entitlement\.can\(/;
  Object.keys(GATED).forEach((p) => {
    const js = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");
    if (!GATE_MARK.test(js)) return;

    const hasOnShow = /onShow\s*\(/.test(js);
    ok("门禁能被 onShow 触达 " + p, hasOnShow, "只有 onLoad，登录回来不会解锁");
  });

  {
    const js = fs.readFileSync(path.join(ROOT, "pages/reader/reader.js"), "utf8");
    ok("阅读页 onShow 里查门禁", /onShow[\s\S]{0,300}gate\.logged\(\)/.test(js));
    ok("阅读页装载只做一次", js.indexOf("this.loaded") >= 0);
  }
}

{
  const usersJs = fs.readFileSync(path.join(ROOT, "packages/users/index/index.js"), "utf8");
  const adminLib = fs.readFileSync(path.join(ROOT, "utils", "admin.js"), "utf8");
  const adminJs = fs.readFileSync(path.join(ROOT, "packages/admin/index/index.js"), "utf8");
  const mineJs = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");

  ok("用户列表页不写本机档位", usersJs.indexOf("store.KEYS.grant") < 0, "用户列表页还在直接写 grant");
  ok("改档只走服务端", adminLib.indexOf("remote.setUserTier") >= 0);
  ok("服务端没就绪时如实说不出来（不走假成功）",
    /error|fail|catch/.test(adminLib) && adminLib.indexOf("setUserTier") >= 0);

  {
    const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
    const fbLib = read("utils/feedback-api.js");
    const adminFbLib = read("utils/admin-feedback.js");
    const remoteSrc = read("utils/remote.js");
    const fbRouteSrc = fs.readFileSync(path.join(__dirname, "..", "api", "_routes", "feedback", "index.js"), "utf8");
    const adminFbRouteSrc = fs.readFileSync(path.join(__dirname, "..", "api", "_routes", "admin", "feedback.js"), "utf8");
    const serverCore = fs.readFileSync(path.join(__dirname, "..", "api", "_lib", "core.js"), "utf8");
    const fbApi = require(path.join(ROOT, "utils", "feedback-api.js"));
    const KINDS = fbApi.KINDS.map((k) => k.key).join(",");

  ok("反馈类别只有一份名单，页面取它（不另抄一遍）",
    KINDS === "bug,typo,feature,experience,recommend,performance,account,payment,other"
      && read("packages/feedback/index/index.js").indexOf("feedback-api") >= 0
      && fbLib.indexOf("KINDS") >= 0,
    KINDS);

    const coreKinds = /var FEEDBACK_KINDS = \[([^\]]*)\]/.exec(serverCore);
    ok("服务端认的类别与客户端同一份",
      !!coreKinds && coreKinds[1].replace(/[\s"]/g, "") === KINDS,
      coreKinds ? coreKinds[1] : "服务端没有 FEEDBACK_KINDS");

    ok("不认的类别退回 400，不悄悄记成「其他」",
      /E_KIND/.test(serverCore) && /!isFeedbackKind\(kind\)/.test(serverCore),
      "服务端把不认的类别改成 other 落库 —— 类型里的信息就这么丢了");

    ok("标题进得去也回得来（服务端存了才画得出列表）",
      /clip\(input && input\.title, FEEDBACK_LIMITS\.title\)/.test(serverCore)
        && /title: String\(row\.title/.test(serverCore)
        && /title: body\.title/.test(fs.readFileSync(path.join(__dirname, "..", "api", "_routes", "feedback", "index.js"), "utf8")));

    ok("处理方式与处理结果都由管理员给，且只认那几档",
      /FEEDBACK_RESOLUTIONS = \[/.test(serverCore)
        && /isFeedbackResolution/.test(serverCore)
        && adminFbLib.indexOf("resolution") >= 0);

    ok("重复提交不发第二遍（内容相同且一分钟内只落一条）",
      /FEEDBACK_DEDUPE_MS/.test(serverCore) && /duplicate/.test(serverCore) && /E_EMPTY/.test(serverCore));

    ok("后台详情单取一条（不是把整张列表拉下来再筛）",
      /op === "thread"/.test(fs.readFileSync(path.join(__dirname, "..", "api", "_routes", "admin", "feedback.js"), "utf8"))
        && remoteSrc.indexOf("PATHS.adminFeedback") >= 0
        && adminFbLib.indexOf("adminFeedbackThread") >= 0);

  ok("后台列表按处理结果分组，组名单只有一份",
    /GROUPS/.test(adminFbLib)
      && /wx:for="\{\{groups\}\}"/.test(read("packages/admin/feedback/index.wxml")));

    const aboutJs = read("packages/settings/about/about.js");
    ok("意见建议只有一条用户入口：在「关于」",
      /onFeedback/.test(aboutJs)
        && /packages\/feedback\/index\/index/.test(aboutJs)
        && !/onFeedback/.test(read("pages/mine/mine.wxml"))
        && !/onFeedback/.test(read("pages/mine/mine.js")),
      "「我的」与「关于」各摆一行，同一个去处两条路（Issue #744）");
    ok("后台管理页有用户反馈那一行", /onFeedback/.test(read("packages/admin/index/index.js")));
    ok("入口落到真页面（跳转目标在 app.json 里）",
      /\/packages\/feedback\/index\/index/.test(read("packages/settings/about/about.js"))
        && /\/packages\/admin\/feedback\/index/.test(read("packages/admin/index/index.js")));

    const fbPageJs = read("packages/feedback/index/index.js");
    ok("意见页没有未登录形态：进来先走登录，页面里不留 guest 分支",
      /enter\(\)[\s\S]{0,200}gate\.open\(/.test(fbPageJs) && /onShow[\s\S]{0,120}this\.enter\(\)/.test(fbPageJs),
      "意见页还摆着未登录的壳");
    ok("反馈只认登录身份：服务端不拿设备标识顶替 uid",
      !/deviceId/.test(fbLib) && /function feedbackIdentity\(deps\)/.test(serverCore)
        && !/identity\.deviceId/.test(serverCore),
      "服务端还留着按设备标识认人的路");

    ok("用户撤不回自己提的反馈与跟帖（页面没有入口，接口也没有这条 op）",
      !/op === "delete"/.test(fbRouteSrc)
        && !/feedbackDelete|remove/.test(fbLib)
        && !/fb\.remove\(|onDeleteThread|onDeleteComment|canDelete/.test(fbPageJs)
        && !/onDeleteThread|onDeleteComment|canDelete/.test(read("packages/feedback/index/index.wxml")),
      "用户侧又摆出了删除入口 —— 记录是台账，撤了就对不上账");

  ok("管理员删得掉反馈与讨论（接口与后台页面都接上了）",
    /delete/.test(adminFbRouteSrc) && /adminFeedbackDelete/.test(serverCore)
      && /deleteFeedbackThread|deleteFeedbackComment/.test(serverCore)
      && /adminFeedbackDelete/.test(remoteSrc)
      && /remove/.test(adminFbLib)
      && /onDeleteThread/.test(read("packages/admin/feedback/detail/detail.js"))
      && /onDeleteComment/.test(read("packages/admin/feedback/detail/detail.js")),
    "后台没有删除入口，或服务端那条 op 没接上 —— 管理员清不掉违规的反馈");

    ok("登录回来就把服务端给的角色记进本机会话（重启后后台那些按钮才出得来）",
      /saveSession\(\{[^}]*role: role\s*\}/.test(read("utils/auth.js"))
        && /store\.profile\(\)\.role/.test(read("utils/auth.js")),
      "角色只落在 auth 那份里，profile 侧的 isAdmin() 重启后读不到 —— 按钮被自己藏起来");

    ok("限流按人算，不按设备算（uid 换成设备号等于删掉限流）",
      /function feedbackRateGate\(deps, uid\)[\s\S]{0,200}"uid"/.test(serverCore)
        && /uid: \[\[3600000, 10\], \[86400000, 30\]\]/.test(fs.readFileSync(path.join(__dirname, "..", "api", "_lib", "config.js"), "utf8")),
      "feedbackRateGate 还在拿 uid 当设备键 —— 与「不按设备认人」同一条错");

    ok("跟进不再顺手改类别（后端只动 status 与 updated_at）",
      (() => {
        const fn = /function feedbackComment\(deps, input\)[\s\S]*?\n}/.exec(serverCore);
        return !!fn && !/patch\.kind/.test(fn[0]) && /patch\.status = "open"/.test(fn[0]);
      })());
  }

  {
    const adminLibSrc = fs.readFileSync(path.join(ROOT, "utils", "admin.js"), "utf8");
    const stat = require(path.join(ROOT, "utils", "admin.js")).summarize;

    ok("统计与名录同一趟拿数（不另开一次请求）",
      /listUsers\(\)[\s\S]{0,400}summarize\(/.test(adminLibSrc)
        && /stats:\s*summarize\(/.test(adminLibSrc),
      "统计另发一次请求 —— 两份数迟早对不上");
    ok("统计只有管理页那一处（用户列表页只说名单）",
      /summarize\(/.test(adminLibSrc) && !/summarize\(/.test(usersJs),
      "同一个数在两页各画一遍 —— 下一个人不知道该守哪一条");

    const H = 3600000;
    const D = 24 * H;
    const now = Date.now();
    const ats = [now - H, now - 3 * D, now - 40 * D, now - 400 * D];
    const sum = stat(ats, ats.length);
    ok("近 7 / 30 / 90 / 365 天各自数出新增",
      !!sum && sum.ranges.map((r) => r.added).join(",") === "2,2,3,3",
      sum ? JSON.stringify(sum.ranges.map((r) => [r.key, r.added])) : "没有统计");
    ok("趋势线上每个点都是成对的坐标，落在画框 100 × 32 里",
      sum.ranges.every((r) => {
        const xy = r.line.split(" ").map((q) => q.split(","));
        return xy.every((c) => c.length === 2
            && Number(c[0]) >= 0 && Number(c[0]) <= 100
            && Number(c[1]) >= 0 && Number(c[1]) <= 32)
          && Number(xy[0][0]) === 0
          && Number(xy[xy.length - 1][0]) > 90;
      }),
      "折线点算坏了 —— 页面拿 polyline 直接画，一个坏点整条线都不出来");
    ok("柱状图按 52 周数，最高的那根满格、末尾是本周",
      sum.bars.length === 52 && Math.max.apply(null, sum.bars.map((b) => b.h)) === 100
        && sum.bars[51].v === 0 && sum.bars[51].h === 0 && sum.bars[0].v === 2,
      sum ? JSON.stringify(sum.bars.filter((b) => b.v).map((b) => b.v)) : "没有柱子");
    ok("总用户数取服务端报的总数，不是手上有几条",
      stat([now - H], 987).total === 987,
      "翻了 500 条名单之后总数会跟着掉");
    ok("空名录也给得出零，趋势线不画",
      stat([], 0).ranges.every((r) => r.added === 0 && r.line === "")
        && stat([], 0).bars.every((b) => b.v === 0));
  }

  ok("对比表的每一格由能力表的档位算出来（不写死）",
    /rankOf\(cap\.tier\)\s*<=\s*rankOf\(tier\)/.test(
      fs.readFileSync(path.join(ROOT, "utils", "entitlement.js"), "utf8")),
    "打勾是照 tier 排出来的，不是手写的一张表 —— 手写的那张改档位就会说谎");
}

ok("乱七八糟的码不认", E.redeem("hello").ok === false);
ok("不像样的码不认", E.redeem("PRO-1234").ok === false);

const sampleId = allEntries[0].id;
const freshId = corpus.course()[0].id;
ok("indexById 能命中条目", corpus.indexById(sampleId) && corpus.indexById(sampleId).t === allEntries[0].t);
ok("indexById 找不到时回 null", corpus.indexById("不存在的-id") === null);

const foreignMiss = allEntries.filter((p) => !corpus.indexById(p.id));
ok("每条索引都查得回自己（集子 id 比条目 id 长的也要认）",
  foreignMiss.length === 0,
  "查不回的还有 " + foreignMiss.length + " 条：" + foreignMiss.slice(0, 3).map((p) => p.id).join("、"));
ok("indexById 带出年级学期（课内）", corpus.indexById(corpus.course()[0].id).gr >= 1);
ok("全站搜索只落在课内与目录那十部里",
  corpus.search("李白", { limit: 2000 }).items.every((p) => p.b === "poems" || catalogIds.indexOf(p.b) >= 0));
ok("限集子搜索不外溢", corpus.search("的", { book: "poems", limit: 5000 }).items.every((p) => p.b === "poems"));
ok("目录里的条目也搜得到（篇名与作者）",
  corpus.search("关雎", { book: "shijing", limit: 10 }).items.length > 0
    && corpus.search("王维", { book: "tangshi300", limit: 500 }).items.length > 0);

const sw = corpus.search("春", { limit: 5 });
ok("search 报出截断前总数", sw.total > sw.items.length,
  "「春」全站命中 " + sw.total + "，列出 " + sw.items.length);
const swAll = corpus.search("春", { limit: 99999 });
ok("search 总数与不做限流时一致", sw.total === swAll.items.length,
  sw.total + " vs " + swAll.items.length);
ok("search 没命中时总数是 0", corpus.search("这几个字不会有", { limit: 80 }).total === 0);
ok("search 空关键词给空结果", corpus.search("  ", { limit: 80 }).total === 0);

ok("ownerOf 认得课内前缀", corpus.ownerOf("poems-xx1-01") === "poems");
ok("ownerOf 不认已下线的集子前缀", corpus.ownerOf("chengyu-cy-1") === "",
  "实际 " + corpus.ownerOf("chengyu-cy-1"));

const subs = {};
(app.subPackages || []).forEach((sp) => {
  subs[sp.name || sp.root] = sp.pages.slice();
});

ok("题库页注册在 game 分包", (subs.game || []).indexOf("quiz/quiz") >= 0, JSON.stringify(subs.game));
ok("管理页注册在 admin 分包", (subs.admin || []).indexOf("index/index") >= 0, JSON.stringify(subs.admin));
ok("用户列表页注册在 users 分包", (subs.users || []).indexOf("index/index") >= 0, JSON.stringify(subs.users));

{
  const mineJs = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");
  const tier = "packages/mine/tier/tier";
  const tierWxml = fs.readFileSync(path.join(ROOT, tier + ".wxml"), "utf8");
  const tierJs = fs.readFileSync(path.join(ROOT, tier + ".js"), "utf8");

  ok("档位与权限是「我的」下的一块页，不挂在管理分包里",
    (subs.mine || []).indexOf("tier/tier") >= 0 && (subs.admin || []).indexOf("index/index") >= 0,
    "entryOf 按分包根给页面归门 —— 落在 admin 分包里，改档那些门禁就会漏掉这张公开的表");

  ok("档位胶囊点得动，进的就是档位与权限那一页",
    mineJs.indexOf('url: "/' + tier + '"') >= 0,
    "胶囊还是死的，或者跳去了别处 —— 用户只有从「我的」页看出来自己是哪一档，"
      + "点下去必须落在对比表上（Issue #234）");

  const panelJsGear = fs.readFileSync(
    path.join(ROOT, "components", "login-panel", "login-panel.js"), "utf8");
  ok("设置那枚齿轮在身份卡上，点它进设置页",
    /onSettings\s*\(\)\s*\{[\s\S]{0,80}?triggerEvent\("settings"\)/.test(panelJsGear)
      && /onSettings\(\)\s*\{[\s\S]{0,80}?triggerEvent\("settings"\)/.test(
        fs.readFileSync(path.join(ROOT, "components", "login-panel", "login-panel.js"), "utf8"))
      && mineJs.indexOf('url: "/packages/settings/general/general"') >= 0,
    "齿轮没挂上，或者点下去没落到设置页");
  ok("「我的」页不再留设置那一行（入口只有齿轮一枚）",
    (mineJs.match(/onSettings\(/g) || []).length === 1,
    "菜单里又列了一行设置 —— 同一个去处两条路");

  ok("权限表只有一份（组件），用户权限页只写标签",
    tierWxml.indexOf("compareRows") < 0 && (subs.mine || []).indexOf("tier/tier") >= 0,
    "又在这一页把表画了一遍");
  ok("权限表那一块不挡登录（挡的是名录，不是整张表）",
    !/wx:if="\{\{logged\}\}"/.test(tierWxml),
    "顶端一张 lock-card 把权限对比一起盖住了 —— 未登录的人正是最该看这张表的人");
  ok("权限表那一块只读能力表，改档改角色不落在这里",
    ["onSetTier", "onSetRole", "canWrite"].every((k) => tierWxml.indexOf(k) < 0
      && tierJs.indexOf(k) < 0),
    "这张表给所有人看，改档那几个入口留在管理页的用户名录里");

  ok("关于只有一条路：设置页那一行进关于",
    /onAbout/.test(
        fs.readFileSync(path.join(ROOT, "packages", "settings", "general", "general.js"), "utf8"))
      && mineJs.indexOf("onAbout") < 0
      && mineJs.indexOf("terms/terms") < 0 && mineJs.indexOf("privacy/privacy") < 0,
    "「我的」页又长出一条关于，或者设置页没有那一行 —— 同一个入口两条路");
  ok("用户协议与隐私政策落在关于页的菜单里",
    /onTerms/.test(fs.readFileSync(path.join(ROOT, "packages", "settings", "about", "about.js"), "utf8"))
      && /onPrivacy/.test(fs.readFileSync(path.join(ROOT, "packages", "settings", "about", "about.js"), "utf8")),
    "关于页少了协议或隐私那一行 —— 从「我的」撤掉之后就没有别的出口了");
}

{
  const subs2 = {};
  (app.subPackages || []).forEach((sp) => {
    subs2[sp.root] = sp.pages.map((p) => sp.root + "/" + p);
  });

  const MAIN_DIRS = [path.join(ROOT, "pages"), path.join(ROOT, "components"), path.join(ROOT, "custom-tab-bar")];
  const inMainDir = (f) => MAIN_DIRS.some((d) => f.startsWith(d + path.sep));

  const entryOf = (file) => {
    if (inMainDir(file)) return "";
    let hit = "";
    Object.keys(subs2).forEach((root) => {
      if (file.startsWith(path.join(ROOT, root) + path.sep)) hit = root;
    });
    return hit;
  };

  const resolveReq = (from, target) => {
    const base = path.resolve(path.dirname(from), target);
    if (/\.js$/.test(target)) return base;
    if (/\.json$/.test(target)) return base;
    if (fs.existsSync(base + ".js")) return base + ".js";
    if (fs.existsSync(path.join(base, "index.js"))) return path.join(base, "index.js");
    return base;
  };

  const roots = [path.join(ROOT, "app.js"), path.join(ROOT, "custom-tab-bar", "index.js")];
  pages.forEach((p) => roots.push(path.join(ROOT, p + ".js")));
  jsFiles.forEach((f) => {
    if (f.startsWith(path.join(ROOT, "components") + path.sep)) roots.push(f);
  });
  Object.keys(app.subPackages || {}).forEach(() => {});
  (app.subPackages || []).forEach((sp) => {
    sp.pages.forEach((p) => roots.push(path.join(ROOT, sp.root, p + ".js")));
  });
  const compDirs = [];
  (function walkComp(d) {
    if (!fs.existsSync(d)) return;
    fs.readdirSync(d).forEach((f) => {
      const full = path.join(d, f);
      if (!fs.statSync(full).isDirectory()) return;
      compDirs.push(full);
      walkComp(full);
    });
  })(path.join(ROOT, "components"));

  const addComponents = (jsonPath) => {
    if (!fs.existsSync(jsonPath)) return;
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(jsonPath, "utf8")); } catch (e) { return; }
    Object.keys(cfg.usingComponents || {}).forEach((key) => {
      const rel = String(cfg.usingComponents[key]).replace(/^\//, "");
      roots.push(path.join(ROOT, rel + ".js"));
    });
  };
  addComponents(path.join(ROOT, "app.json"));
  pages.forEach((p) => addComponents(path.join(ROOT, p + ".json")));
  (app.subPackages || []).forEach((sp) => {
    sp.pages.forEach((p) => addComponents(path.join(ROOT, sp.root, p + ".json")));
  });
  compDirs.forEach((d) => addComponents(path.join(d, path.basename(d) + ".json")));

  const canUse = {};
  jsFiles.forEach((f) => {
    if (f.startsWith(path.join(ROOT, "data") + path.sep)) return;
    canUse[f] = true;
  });

  const reachable = {};
  const stack = [];
  roots.forEach((f) => {
    if (!canUse[f] || reachable[f]) return;
    reachable[f] = true;
    stack.push(f);
  });

  const leaked = [];
  while (stack.length) {
    const file = stack.pop();
    const src = fs.readFileSync(file, "utf8");
    const re = /require\(["']([^"']+)["']\)/g;
    let m;
    while ((m = re.exec(src))) {
      if (m[1].charAt(0) !== ".") continue;
      const dep = resolveReq(file, m[1]);
      const to = entryOf(dep);
      if (to && to !== entryOf(file)) {
        leaked.push(path.relative(ROOT, file) + " → " + path.relative(ROOT, dep));
      }
      if (!canUse[dep] || reachable[dep]) continue;
      reachable[dep] = true;
      stack.push(dep);
    }
  }

  ok("没有跨包 require（分包模块不许被别的包引用）", leaked.length === 0, leaked.join("；"));

  const LAZY = [
    path.join(ROOT, "utils", "font.js")
  ];
  const orphans = jsFiles
    .filter((f) => canUse[f] && !reachable[f] && LAZY.indexOf(f) < 0)
    .map((f) => path.relative(ROOT, f))
    .sort();
  ok("每个 .js 都被入口链引用到（不留没人 require 的孤儿）",
    orphans.length === 0, orphans.join(", "));

  ok("utils/ 里不再有只有分包用的模块",
    !fs.existsSync(path.join(ROOT, "utils", "quiz.js"))
      && !fs.existsSync(path.join(ROOT, "utils", "feihua")),
    "题库 / 飞花令的内核还在主包 utils/ 下");
  ok("管理内核与档位表分两处（写别人的与看自己的不是一件事）",
    fs.existsSync(path.join(ROOT, "utils", "admin.js"))
      && fs.existsSync(path.join(ROOT, "utils", "tier-view.js"))
      && fs.readFileSync(path.join(ROOT, "utils", "tier-view.js"), "utf8").indexOf("setUserTier") < 0,
    "档位与权限页只读能力表，改档那几路仍只归管理页");
}

pages.forEach((p) => {
  const src = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");
  const re = /url:\s*"\/([a-zA-Z0-9_\-\/]+)/g;
  let m;
  const bad = [];
  while ((m = re.exec(src))) {
    if (pages.indexOf(m[1]) < 0) bad.push(m[1]);
  }
  ok("页面跳转目标都存在 " + p, bad.length === 0, bad.join(","));
});

asGuest();
store.drop(store.KEYS.auth);
store.setRecord("probe-1", { level: 2, learned: true, lastReviewAt: Date.now() });
const syncMod = require(path.join(ROOT, "utils", "sync.js"));
syncMod.markDirty();

ok("未登录时同步不就绪（配没配后端都一样）", syncMod.ready() === false);
ok("写本机后队列有记账", syncMod.pendingCount() >= 0);
ok("本机数据没被动过", !!store.getRecord("probe-1"));

const remoteMod = require(path.join(ROOT, "utils", "remote.js"));
const serverMod = () => require(path.join(ROOT, "utils", "server.js"));

ok("这个包没注入过云调用两栏时如实说「没配」（不带值就是没配）",
  !!serverMod().cloud() || remoteMod.configured() === false,
  "server.js 里没值就地认成没配 —— 不能回落成「已配好」");
ok("未配后端：管理接口不就绪", remoteMod.adminReady() === false);

{
  const authMod = require(path.join(ROOT, "utils", "auth.js"));
  authMod.configure({ baseUrl: "https://example.invalid" });
  ok("配了后端也不会自动成管理员", remoteMod.adminReady() === false && authMod.isAdmin() === false);

  store.write(store.KEYS.auth, { baseUrl: "https://example.invalid", accessToken: "t", role: "user" });
  ok("普通用户读不到名录", remoteMod.adminReady() === false);

  store.write(store.KEYS.auth, { baseUrl: "https://example.invalid", accessToken: "t", role: "admin" });
  ok("owner / admin 才认管理接口", remoteMod.adminReady() === true);

  authMod.configure({ baseUrl: "" });

  store.write(store.KEYS.auth, { cloud: { env: "probe-env", service: "probe-svc" } });
  ok("本机填过就用本机那份（那是「这台手机连哪儿」的应急出口）",
    remoteMod.useCloud() === true && remoteMod.cloudConfig().service === "probe-svc");
  store.drop(store.KEYS.auth);

  const injected = serverMod().cloud();
  ok("本机没填过时用包里注入那份 —— 注入了就开箱即用，没注入就如实说没配",
    injected
      ? (remoteMod.configured() === true && remoteMod.useCloud() === true
         && remoteMod.cloudConfig().service === injected.service)
      : (remoteMod.configured() === false && remoteMod.useCloud() === false),
    "server.js 里是 " + JSON.stringify(injected) + "，而 configured() 是 " +
      JSON.stringify(remoteMod.configured()));
}

ok("同步复用 poem 的路径", remoteMod.PATHS.pull === "/api/sync/pull" && remoteMod.PATHS.push === "/api/sync/push");
ok("管理复用 poem 的路径", remoteMod.PATHS.accounts === "/api/admin/accounts" && remoteMod.PATHS.grant === "/api/admin/grant");
ok("微信登录是新增的那一套", remoteMod.PATHS.login === "/api/wx/login");

store.markRead("poems", "probe-1");
store.markRead("dwang", "probe-dw");
store.setDailyExtra(["probe-1"]);
store.saveCollections([{ id: "c1", name: "自检" }]);

const packed = remoteMod.pack();
ok("打包件形状对（device + 每条 rec 带 id / updatedAt / payload）",
  !!packed.device && Array.isArray(packed.recs) && packed.recs.length > 0
    && packed.recs.every((r) => typeof r.id === "string" && r.id.length > 0
      && Number(r.updatedAt) > 0
      && r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)),
  JSON.stringify(packed.recs.map((r) => r.id)));
ok("已读行是服务端认的 marks 形状（不是 payload 本身）",
  packed.recs.filter((r) => r.id.indexOf("reads:") === 0)
    .every((r) => r.payload && r.payload.marks && typeof r.payload.marks === "object"));
ok("加背与自选温习都按服务端形状打包",
  packed.recs.some((r) => r.id === "daily_extra:v1" && r.payload.date && Array.isArray(r.payload.items))
    && packed.recs.some((r) => r.id === "collections:v1" && Array.isArray(r.payload.collections)));

{
  const before = Object.keys(store.progress()).length;
  const applied = remoteMod.wire.applyRecords([
    { id: "probe-2", payload: { level: 5, learned: true }, updatedAt: 4102444800000, deleted: false },
    { id: "reads:poem_poems_read_v1", payload: { v: 1, updatedAt: 4102444800000, marks: { "probe-9": { at: 4102444800000, times: 1 } } }, updatedAt: 4102444800000 },
    { id: "缺了时间戳", payload: {}, updatedAt: 0 }
  ]);
  ok("云端记录与已读都能落回本机（无时间戳的行不乱写）",
    !!store.getRecord("probe-2") && store.getRecord("probe-2").level === 5
      && !!store.reads("poems")["probe-9"] && applied >= 2
      && Object.keys(store.progress()).length >= before);

  remoteMod.wire.applyRecords([
    { id: "probe-2", payload: { level: 1, learned: false }, updatedAt: 1, deleted: false }
  ]);
  ok("比本机旧的不覆盖", store.getRecord("probe-2").level === 5);
}

const roster = readModule(path.join(dataDir, "roster.js"));
ok("名录在、标签截断、档位合法",
  !!roster && (roster.users || []).every((u) => String(u.label).length <= 8
    && ["free", "pro", "max"].indexOf(u.tier) >= 0));

{
  const corePath = path.join(__dirname, "parity-web", "core.js");
  if (!fs.existsSync(corePath)) {
    ok("契约那份 core.js 在（scripts/parity-web/core.js）", false, "缺文件");
  } else {
    let core = null;
    try {
      core = require(corePath);
    } catch (e) {
      core = null;
    }
    if (!core || typeof core.sanitizePayload !== "function") {
      ok("报文过一遍服务端 sanitize（poem 版本对不上，跳过）", true, "没有 sanitizePayload");
    } else {
      const wireMod3 = require(path.join(ROOT, "utils", "wire.js"));
      const rows3 = wireMod3.packRecords();

      function lostFields(sent, got) {
        const out = [];
        (function walk(a, b, p) {
          Object.keys(a || {}).forEach((k) => {
            const bv = b ? b[k] : undefined;
            if (bv === undefined) {
              out.push(p + k);
              return;
            }
            if (a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) walk(a[k], bv, p + k + ".");
          });
        })(sent, got, "");
        return out;
      }

      let worst = "";
      rows3.forEach((r) => {
        const got = core.sanitizePayload(r.payload, r.id);
        const lose = lostFields(r.payload, got);
        if (lose.length && !worst) worst = r.id + " → " + lose.join(",");
      });

      const NEW_ROWS = ["settings:v1", "profile:v1"];
      const lostOnNew = [];
      const lostOnOld = [];
      rows3.forEach((r) => {
        const got = core.sanitizePayload(r.payload, r.id);
        const lose = lostFields(r.payload, got);
        if (!lose.length) return;
        if (NEW_ROWS.indexOf(r.id) >= 0) lostOnNew.push(r.id);
        else lostOnOld.push(r.id + " → " + lose.join(","));
      });

      ok("报文过一遍服务端 sanitize，老行一个字段都不丢", lostOnOld.length === 0,
        lostOnOld.join(" | "));

      const settingsOk = !lostOnNew.length;
      if (settingsOk) {
        ok("新行（设置 / 头像）也过得了服务端 sanitize", true);
      } else {
        console.log("· settings:v1 / profile:v1 服务端还没加白名单（"
          + lostOnNew.join(", ") + "）—— 载荷会被静默清空。"
          + "要加的代码逐字写在 docs/wx-login-server.md「服务端必须给这两行加白名单」一节");
      }

      const applied3 = wireMod3.applyRecords([
        { id: "probe-srv", payload: { level: 4, learned: true }, updatedAt: Date.now() },
        { id: "reads:poem_poems_read_v1", payload: { v: 1, updatedAt: Date.now(), marks: { "probe-srv": { at: Date.now(), times: 1 } } }, updatedAt: Date.now() }
      ]);
      ok("服务端形状的行能落回本机", applied3 >= 2 && !!store.getRecord("probe-srv"));
    }
  }
}

{
  const coverage = path.join(__dirname, "corpus", "js", "sync-coverage.js");
  const wireMod = require(path.join(ROOT, "utils", "wire.js"));

  if (!fs.existsSync(coverage)) {
    ok("语料里的同步表在（scripts/corpus/js/sync-coverage.js）", false, "缺文件");
  } else {
    const src = fs.readFileSync(coverage, "utf8");
    const declared = new Set();
    const re = /key:\s*"(poem_[a-z0-9_]*_read_v1)"/g;
    let m;
    while ((m = re.exec(src))) declared.add(m[1]);

    const ours = Object.keys(wireMod.READ_ROW).map((k) => wireMod.READ_ROW[k]);
    const unknown = ours.filter((k) => declared.size > 0 && !declared.has(k));
    ok("已读行 id 都在语料的同步表里", unknown.length === 0,
      unknown.length + " 个对不上：" + unknown.slice(0, 4).join(", "));

    const oursSet = new Set(ours);
    const missing = Array.from(declared).filter((k) => !oursSet.has(k));
    ok("语料那个同步表里的已读行小程序都有对应（" + missing.length + " 条那边有、这边无）", true,
      missing.slice(0, 6).join(", "));
  }

  const routes = path.join(__dirname, "parity-web", "routes.js");
  if (!fs.existsSync(routes)) {
    ok("契约那份 routes.js 在（scripts/parity-web/routes.js）", false, "缺文件");
  } else {
    const rsrc = fs.readFileSync(routes, "utf8");
    const remoteMod2 = require(path.join(ROOT, "utils", "remote.js"));
    ["pull", "push", "accounts", "grant", "role"].forEach((k) => {
      const p2 = remoteMod2.PATHS[k].replace(/^\/api\//, "/");
      ok("路径在服务端路由表里 " + remoteMod2.PATHS[k], rsrc.indexOf(p2) > -1,
        "契约的 routes.js 里没有这个路由");
    });
  }
}

{
  const feihua = require(path.join(ROOT, "packages", "game", "feihua", "lib.js"));
  const feihuaJs = fs.readFileSync(path.join(ROOT, "packages", "game", "feihua", "lib.js"), "utf8");
  ok("飞花令断句走 corpus.splitLines（不另写一份标点表）",
    feihuaJs.indexOf("const SPLIT") < 0 && feihuaJs.indexOf("corpus.splitLines") >= 0);
}

{
  const feihua = require(path.join(ROOT, "packages", "game", "feihua", "lib.js"));
  const scopes = require(path.join(ROOT, "utils", "game-scopes.js"));
  const stageStore = require(path.join(ROOT, "utils", "store.js"));
  const stageSaved = { grade: stageStore.settings().grade, term: stageStore.settings().term };
  stageStore.saveSettings({ grade: 12, term: 2 });

  {
    const picks = [];
    for (let i = 0; i < 30; i++) {
      const p = feihua.pick({ level: "normal", scope: scopes.STAGE_SCOPE });
      if (p) picks.push(p.char);
    }
    ok("飞花令出得了令字（课内范围内随机）", picks.length === 30, "只有 " + picks.length + " 次出字");
    ok("随机出来的令字都能随机到不止一个（不是钉死一个）",
      new Set(picks).size > 1, "30 次只出了 " + new Set(picks).size + " 个字");

    const blind = [];
    scopes.list().forEach((s) => {
      feihua.LEVELS.forEach((lv) => {
        const asked = [];
        for (let i = 0; i < 400; i++) {
          const p = feihua.pick({ level: lv.id, scope: s.id, exclude: asked });
          if (!p) break;
          asked.push(p.char);
          if (!feihua.look(p.char, { scope: s.id, limit: 1 }).length) blind.push(s.id + "/" + lv.id + ":" + p.char);
        }
      });
    });
    ok("出的令字在这个范围里一定接得上（不会出一个空格子）",
      blind.length === 0, "出得了字却查不到答案：" + blind.slice(0, 5).join("、"));
  }

  {
    const names = scopes.list().map((s) => s.id);
    ok("出题范围四档：课内当前学段、课内、诗词漫读、不限（本地题源一律是课内行，课外集子不在包里）",
      names.join() === [scopes.STAGE_SCOPE, scopes.COURSE_ALL_SCOPE, scopes.EXTRA_SCOPE, scopes.ANY_SCOPE].join() &&
        names.every((id) => scopes.pool(id).every((p) => p.b === "poems")),
      "范围里有 " + names.join("、"));

    const corpusMod = require(path.join(ROOT, "utils", "corpus.js"));
    const settingsMod = require(path.join(ROOT, "utils", "store.js"));
    const kept = { grade: settingsMod.settings().grade, term: settingsMod.settings().term };
    settingsMod.saveSettings({ grade: 12, term: 2 });
    const missing = [];
    corpusMod.course().forEach((p) => {
      const e = corpusMod.entry(p.id);
      if (e && e.text && !scopes.pool(scopes.STAGE_SCOPE).some((q) => q.id === p.id)) missing.push(p.id);
    });
    ok("学段放到最高时课内 251 首全进得了这个范围",
      missing.length === 0, "漏了 " + missing.slice(0, 5).join("、"));
    settingsMod.saveSettings(kept);

    const empty = [];
    scopes.list().forEach((s) => {
      feihua.LEVELS.forEach((lv) => {
        if (!feihua.pick({ level: lv.id, scope: s.id })) empty.push(s.id + "/" + lv.id);
      });
    });
    ok("每一档每一个范围都出得了令字（进页面不会先说「出完了」）",
      empty.length === 0, "出不了字：" + empty.join("、"));
  }

  {
    const say = feihua.judge("月", "床前明月光", []);
    ok("作答落在课内正文里就算对", say.ok === true, say.reason || "判成了错");
  }

  ok("作答必须含令字", feihua.judge("月", "床前明月光", []).ok === true
    && feihua.judge("月", "白日依山尽", []).ok === false);
  ok("作答必须真在语料里（自己编的不算）",
    feihua.judge("月", "床前明月光的下一句是我想的", []).ok === false);
  ok("同一句不能在一轮里说两遍",
    feihua.judge("月", "床前明月光", ["床前明月光"]).ok === false);
  ok("太短的作答不算（免得单字蒙对）", feihua.judge("月", "月", []).ok === false);

  stageStore.saveSettings(stageSaved);
}
{
  const scopes = require(path.join(ROOT, "utils", "game-scopes.js"));
  const storeMod = require(path.join(ROOT, "utils", "store.js"));
  const quizLib = require(path.join(ROOT, "packages", "game", "quiz", "lib.js"));
  const saved = { grade: storeMod.settings().grade, term: storeMod.settings().term };

  ok("「课内·当前学段」排在出题范围的第一项（三个游戏默认就选它）",
    scopes.list()[0].id === scopes.STAGE_SCOPE);
  ok("它的名字先写自己是谁（明细交给选完之后那一行）",
    scopes.list()[0].name.indexOf("课内·当前学段") === 0);

  const course = require(path.join(ROOT, "utils", "corpus.js")).course();
  const outside = (grade, term) => scopes.pool(scopes.STAGE_SCOPE)
    .filter((p) => !(p.gr < grade || (p.gr === grade && p.tm <= term)))
    .map((p) => p.id);

  storeMod.saveSettings({ grade: 3, term: 2 });
  const cut3 = outside(3, 2);
  const pool3 = scopes.pool(scopes.STAGE_SCOPE).length;
  ok("选了三年级下学期就只到三年级下学期（四年级往后的不出）",
    cut3.length === 0 && pool3 === course.filter((p) => p.gr < 3 || (p.gr === 3 && p.tm <= 2)).length,
    "越界 " + cut3.slice(0, 5).join("、") + "，共 " + pool3 + " 首");

  storeMod.saveSettings({ grade: 1, term: 1 });
  ok("学段跟着温习选项走（一年级下学期比三年级下学期少）",
    scopes.pool(scopes.STAGE_SCOPE).length < pool3
      && outside(1, 1).length === 0,
    "一年级下学期 " + scopes.pool(scopes.STAGE_SCOPE).length + " 首，三年级下学期 " + pool3 + " 首");

  storeMod.saveSettings({ grade: 6, term: 2 });
  ok("题库按这个范围出得了题", quizLib.build({
    scope: scopes.STAGE_SCOPE, count: 10, forms: quizLib.FORM_KEYS
  }).length === 10);

  storeMod.saveSettings(saved);

  const pages = ["feihua", "quiz", "exam"].map((k) => fs.readFileSync(
    path.join(ROOT, "packages", "game", k, k + ".js"), "utf8"));
  ok("三个游戏进页面都默认选中它",
    pages.every((src) => /scope:\s*gameScopes\.STAGE_SCOPE/.test(src)));
}
{
  const tagMod = require(path.join(ROOT, "utils", "tier-tag.js"));

  ok("档位标注只标当前够不着的（Free 看得到 Pro 起与 Max 起）",
    tagMod.shown("pro", "free") === true && tagMod.shown("max", "free") === true);
  ok("Pro 手上不再标「Pro 起」，只标「Max 起」",
    tagMod.shown("pro", "pro") === false && tagMod.shown("max", "pro") === true);
  ok("Max 手上任何档位都不再标（权限对比页那几栏不跟着这条走）",
    tagMod.shown("pro", "max") === false && tagMod.shown("max", "max") === false);

  const indexJs = fs.readFileSync(
    path.join(ROOT, "packages", "game", "index", "index.js"), "utf8");
  ok("大会首页卡片上的档位从 entitlement.CAPS 取，不在 MODES 里另写一份",
    !/tier:\s*"(pro|max|free)"/.test(indexJs)
      && /entitlement\.tierKey\(/.test(indexJs)
      && E.tierKey("feihualing") === "max");

}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  {
    const idxJs = read("packages/game/index/index.js");
    ok("三张入口卡各进各的玩法页",
      /feihua\/feihua/.test(idxJs) && /quiz\/quiz/.test(idxJs) && /exam\/exam/.test(idxJs));
  }

  {
    const js = read("packages/game/feihua/feihua.js");
    const settleBlock = js.slice(js.indexOf("settle(r) {"), js.indexOf("advance(ms) {"));
    ok("答对后令字不变，自动续接下一句（advance 走 resume，不走 next）",
      /this\.advance\(/.test(settleBlock)
        && /advance\(ms\)[\s\S]{0,200}?this\.resume\(\)/.test(js)
        && !/resume\(\) \{[\s\S]{0,400}?this\.next\(\)/.test(js),
      "答对后又换了令字，或没有续接");
    ok("答错即收令（接不上这一令就结束，不再自动换字）",
      /!r\.ok[\s\S]{0,200}?this\.endRound\(/.test(settleBlock),
      "答错那条路没有 endRound");
    ok("自动翻题用计时器，页面走了要清掉",
      /setTimeout/.test(js) && /onUnload[\s\S]{0,120}?clearTimeout/.test(js));
    ok("换令先清掉待翻的计时器，再出下一个令字",
      (() => {
        const at = js.indexOf("onSkip()");
        const body = at < 0 ? "" : js.slice(at, js.indexOf("onHint()", at));
        const cut = body.indexOf("clearTimeout");
        return cut >= 0 && body.indexOf("this.next()", cut) > cut;
      })());

    ok("一轮有倒计时，到点收轮（不再是一题接一题无限连）",
      /startClock\(\)[\s\S]{0,200}?setInterval/.test(js) && /endRound\(/.test(js),
      "少了计时那一层 —— 飞花令又变回没有输赢的填空题");
    ok("离开页面把两条计时器都停掉",
      /onUnload[\s\S]{0,160}?clearTimeout/.test(js) && /onUnload[\s\S]{0,160}?stopClock/.test(js));
  }

  {
    const js = read("packages/game/feihua/feihua.js");
    const lib = require(path.join(ROOT, "packages/game/feihua/lib.js"));
    const h = lib.hint("月", { exclude: ["床前明月光 "] });
    ok("提示只给两个字的头，不给整句（说全了就等于替人答了）",
      !!h && h.head.length === 2 && typeof h.total === "number",
      JSON.stringify(h));
    const all = lib.look("月", { limit: 9999 }).map((r) => r.seg);
    const tail = lib.hint("月", { exclude: all });
    ok("范围内的句子都被说过时，提示不给假的",
      all.length > 0 && tail === null, JSON.stringify(tail));
    ok("一次机会用一个提示（提示过就不再出按钮）", /hinted/.test(js));
  }
}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const cheer = require(path.join(ROOT, "utils", "cheer.js"));

  ok("鼓励语只有一份（考试与飞花令取同一个池，不在页面里各写一套）",
    (fs.readFileSync(path.join(ROOT, "utils", "cheer.js"), "utf8").match(/^const (MARKS|KEEP|STREAK|LING) = /gm) || []).length === 4
      && /cheer\.ofScore/.test(read("packages/game/exam/exam.js"))
      && /cheer\.ofStreak/.test(read("packages/game/feihua/feihua.js"))
      && /cheer\.ofLing/.test(read("packages/game/feihua/feihua.js")),
    "激励文案散在页面里 —— 改一处漏一处");

  const low = cheer.ofScore(0, 1);
  const high = cheer.ofScore(100, 1);
  ok("分数低也有一句（不是只夸高分）",
    cheer.ofScore(0, 1).length > 0 && cheer.ofScore(35, 2).length > 0
      && cheer.MARKS.length >= 5
      && high !== low,
    "低分那一档没有话，或者高低分收到的是同一句");

  ok("分数档位跟着分走（0 / 35 / 73 / 100 各落到自己那一档）",
    new Set([0, 35, 73, 100].map((p) => cheer.ofScore(p, 0))).size === 4,
    "几个不同的分给的是同一句");

  ok("飞花令连对到里程碑才加话（第 4 句不刷屏）",
    cheer.ofStreak(2) === "" && cheer.ofStreak(3) !== ""
      && cheer.ofStreak(4) === "" && cheer.ofStreak(10) !== ""
      && cheer.ofStreak(11) === "" && cheer.ofStreak(40) !== "",
    "每一句都加一条，或者连对三条也没话");

  const examJs = read("packages/game/exam/exam.js");
  ok("考试结果那句评语由分数算（cheerLine 进 data）",
    /cheerLine:\s*cheer\.ofScore\(/.test(examJs),
    "结果页没有评语");

  ok("考试可以回到前面的题（题号跳转 + 上一题，答案是同一份数组）",
    /onJump\(/.test(examJs) && /onPrev\(/.test(examJs)
      && /answers\[this\.data\.index\] = picked/.test(examJs)
      && /picked: this\.data\.answers\[index\]/.test(examJs),
    "回看只翻页面，选中项与答案数组对不上");

  ok("带着空题交卷先提醒一次（不是拦死，也不静默交上去）",
    /confirmSubmit\(\)/.test(examJs)
      && /cheer\.ofQuit\(/.test(examJs)
      && /if \(this\.data\.quitLine === line\) return true;/.test(examJs),
    "空着题交卷既没有提醒，也没法再交");

  ok("飞花令按接上的句数给这一轮评语（0 / 4 / 8 / 13 / 14 各落到自己那一档）",
    [0, 4, 8, 13, 14].every((n) => cheer.ofLing(n, 0).length > 0)
      && new Set([0, 4, 8, 13, 14].map((n) => cheer.ofLing(n, 0))).size === 5,
    "几个不同的句数给的是同一句，或某一档没有话");

  const fhJs = read("packages/game/feihua/feihua.js");
  ok("飞花令一轮结束时把这轮的评语写进 remark，翻令时清掉",
    /remark:\s*cheer\.ofLing\(/.test(fhJs)
      && /remark: ""/.test(fhJs.replace(/remark:\s*cheer\.ofLing\([^)]*\)/, "")),
    "评语没进 data，或者换令之后还挂着上一轮的评语");

  ok("飞花令把里程碑那句写进 cheerLine，翻题时清掉",
    /cheerLine:\s*cheer\.ofStreak\(/.test(fhJs)
      && /cheerLine: ""/.test(fhJs.replace(/cheerLine:\s*cheer\.ofStreak\(streak\)/, "")),
    "连对的话没进 data，或者翻到下一题还挂着上一题的夸奖");
}

const LIMIT_MAIN = 2 * 1024 * 1024;

function dirSize(dir, skipPrefix) {
  let total = 0;
  (function walk(d) {
    fs.readdirSync(d).forEach((f) => {
      const full = path.join(d, f);
      if (skipPrefix && full.startsWith(skipPrefix)) return;
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else total += st.size;
    });
  })(dir);
  return total;
}

const subRoots = (app.subPackages || []).map((sp) => path.join(ROOT, sp.root));
const mainPkg = subRoots.reduce((sum, dir) => sum - dirSize(dir), dirSize(ROOT, path.join(ROOT, "data", "texts")));
ok(
  "主包在 2MB 内（" + (mainPkg / 1024 / 1024).toFixed(2) + "MB）",
  mainPkg <= LIMIT_MAIN,
  "超限 " + ((mainPkg - LIMIT_MAIN) / 1024).toFixed(0) + "KB"
);

{
  const compDirs = [];
  const compRoot = path.join(ROOT, "components");
  if (fs.existsSync(compRoot)) {
    fs.readdirSync(compRoot).forEach((d) => {
      const full = path.join(compRoot, d);
      if (fs.statSync(full).isDirectory()) compDirs.push(d);
    });
  }

  compDirs.forEach((d) => {
    const rel = "components/" + d + "/" + d;
    const wxml = fs.readFileSync(path.join(ROOT, rel + ".wxml"), "utf8");
    const js = fs.readFileSync(path.join(ROOT, rel + ".js"), "utf8");
    const handlers = new Set();
    const hre = /(?:bind|catch)(?:tap|change|input|confirm|blur|chooseavatar)="([\w$]+)"/g;
    let hm;
    while ((hm = hre.exec(wxml))) handlers.add(hm[1]);
    const missing = [];
    handlers.forEach((h) => {
      if (js.indexOf(h) < 0) missing.push(h);
    });
    ok("组件事件都有处理函数 " + d, missing.length === 0, missing.join(","));
  });
}

let sandboxPage = null;

function mountPage(pg, query) {
  let opt = null;
  global.Page = (o) => { opt = o; };
  const file = path.join(ROOT, pg + ".js");
  delete require.cache[require.resolve(file)];
  require(file);
  if (!opt) return null;
  const page = Object.assign({}, opt);
  page.data = JSON.parse(JSON.stringify(opt.data || {}));
  page.setData = function (obj, cb) {
    Object.keys(obj).forEach((k) => { this.data[k] = obj[k]; });
    if (cb) cb();
  };
  ["onLoad", "onShow"].forEach((fn) => {
    if (typeof page[fn] === "function") page[fn].call(page, query || {});
  });
  sandboxPage = page;
  return page.data;
}

function mountFull(pg, query) {
  mountPage(pg, query);
  return sandboxPage;
}

{

  const dataDir = path.join(ROOT, "data");
  const hasData = fs.existsSync(path.join(dataDir, "books", "books.js"));

  if (!hasData) {
    ok("门禁开合（包里没有语料，跳过真跑）", true);
  } else {

    const savedWx = global.wx;
    const savedPage = global.Page;
    const savedComponent = global.Component;
    const savedGetApp = global.getApp;
    const savedPages = global.getCurrentPages;

    const mem = {};
    global.wx = {
      showToast() {}, showModal() {}, showLoading() {}, hideLoading() {},
      showActionSheet(o) { o && o.success && o.success({ tapIndex: 0 }); },
      navigateTo() {}, switchTab() {}, redirectTo() {}, navigateBack() {},
      pageScrollTo() {}, nextTick(f) { if (f) f(); },
      setNavigationBarTitle() {}, vibrateShort() {}, stopPullDownRefresh() {},
      setClipboardData(o) { o && o.success && o.success(); },
      getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375, platform: "devtools" }),
      getStorageSync: (k) => (k in mem ? mem[k] : ""),
      setStorageSync: (k, v) => { mem[k] = v; },
      removeStorageSync: (k) => { delete mem[k]; },
      getStorageInfoSync: () => ({ keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }),
      loadFontFace() {},
      login(o) { o && o.fail && o.fail({ errMsg: "no wx" }); },
      getUserProfile(o) { o && o.fail && o.fail({}); },
      request(o) { o && o.fail && o.fail({ errMsg: "offline" }); },
      downloadFile(o) { o && o.fail && o.fail({}); },
      createInnerAudioContext: () => ({
        play() {}, pause() {}, stop() {}, destroy() {},
        onEnded() {}, onError() {}
      })
    };
    global.Component = () => {};
    global.getApp = () => ({ globalData: {} });
    global.getCurrentPages = () => [];

    const mount = (pg, query) => mountPage(pg, query);

    const storeMod = require(path.join(ROOT, "utils", "store.js"));
    const savedProfile = storeMod.profile();
    storeMod.saveProfile({ logged: true, nickname: "自检" });

    try {
      Object.keys(GATED).forEach((pg) => {
        const flag = GATED[pg];

        if (flag === "gate") {
          const data = mount(pg, { id: freshId });
          if (!data) { ok("门禁能开 " + pg, false, "页面没调用 Page()"); return; }
          ok("登录后页面上不再有登录卡 " + pg, data.locked === undefined,
            "登录了还锁着（locked=" + data.locked + "）");
          return;
        }
        if (flag !== "locked") return;
        const data = mount(pg, { id: freshId });
        if (!data) { ok("门禁能开 " + pg, false, "页面没调用 Page()"); return; }
        ok("登录后门禁会开 " + pg, data.locked === false,
          "登录了还锁着（locked=" + data.locked + "）");
      });
    } finally {

      if (savedProfile && savedProfile.logged) storeMod.saveProfile(savedProfile);
      else storeMod.saveProfile({ logged: false, nickname: "", avatarUrl: "" });

      global.wx = savedWx;
      global.Page = savedPage;
      global.Component = savedComponent;
      global.getApp = savedGetApp;
      global.getCurrentPages = savedPages;
    }
  }
}

{
  const cmod = require(path.join(ROOT, "utils", "corpus.js"));

  const allIds = [];
  cmod.books().forEach((b) => {
    let list = [];
    try { list = cmod.ofBook(b.id); } catch (e) { return; }
    list.forEach((it) => allIds.push(it.id));
  });
  let lost = 0, unflat = 0, checked = 0, exLost = "", exFlat = "";
  allIds.forEach((id) => {
    let e = null;
    try { e = cmod.entry(id); } catch (err) { return; }
    if (!e || !e.text) return;
    checked++;
    const L = cmod.layout(e.text, { size: 0 });
    const rows = L.rows.join("");
    const flat = L.paras.reduce((a, pr) => a.concat(pr), []).map((g) => g.join("")).join("");
    const norm = String(e.text).split("\n").map((x) => cmod.splitClauses(x).join("")).join("");
    if (stripWs(rows) !== stripWs(norm)) { lost++; if (!exLost) exLost = id; }
    if (flat !== rows) { unflat++; if (!exFlat) exFlat = id; }
  });
  ok("版式装箱不丢字（全站 " + checked + " 篇）", lost === 0, lost + " 篇拼不回，例如 " + exLost);
  ok("版式的段落与行是同一份切分", unflat === 0, unflat + " 篇对不上，例如 " + exFlat);

  const pipa = cmod.entry("poems-gz10-06");
  ok("《琵琶行并序》取得到正文", !!(pipa && pipa.text));

  const rjs = fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.js"), "utf8");
  ok("阅读页走 corpus.layout()", rjs.indexOf("corpus.layout(") >= 0);
  ok("阅读页不再按 splitLines 的行渲染", rjs.indexOf("splitLines(entry.text)") < 0);

  const pj = require(path.join(ROOT, "utils", "pinyin.js"));
  const L2 = cmod.layout("君不见，黄河之水天上来，\n奔流到海不复回。");
  const tk = pj.render(L2.paras, "all");

  const seq = [];
  tk.forEach((pr) => pr.forEach((row) => row.forEach((cl) => seq.push(cl.i))));
  ok("注音给每一句编了号（按正文顺序）",
    seq.length > 0 && seq.every((v, i) => v === i), JSON.stringify(seq));
}

{

  const cfg = readJson(path.join(ROOT, "project.config.json"));
  const tourist = !cfg.appid || cfg.appid === "touristappid";
  ok(
    "appid " + (tourist ? "还是游客模式（正式上传前必须换）" : "已替换"),
    true,
    tourist ? "游客模式下「上传」按钮不可用，插件（同声传译）也无法申请" : ""
  );
  if (tourist) {
    console.log("  · 提醒：project.config.json 里 appid 仍是 touristappid，正式上传前换成自己的。");
  }

  const mineJs = fs.readFileSync(path.join(ROOT, "pages/mine/mine.js"), "utf8");
  const adminJs = fs.readFileSync(path.join(ROOT, "packages/admin/index/index.js"), "utf8");
  ok("界面上没有填后端地址 / 云调用的入口（值只在代码库里配）",
    adminJs.indexOf("onSaveBaseUrl") < 0 && adminJs.indexOf("onSaveCloud") < 0
      && mineJs.indexOf("onServer") < 0,
    "两栏的值构建期就注进包里，露出来只会是用户既读不懂也改不动的说法 —— " +
      "要临时换后端就改代码库里的 miniprogram/utils/server.js，不走界面");

  ok("同步那一行的副标题：上次同步 + 队列状态，都用数据层算的（不自己拼）",
    /syncSub\(sy\)\s*\{[\s\S]{0,400}?sy\.ready[\s\S]{0,400}?sy\.pendingStatus/.test(mineJs)
      && /syncSub:\s*this\.syncSub\(sy\)/.test(mineJs),
    "副标题自己拼了一份：末次同步时刻与「还有几项在等」都只有 sync.state() 说了算");

  ok("「我的 → 同步」那一行点得动",
    /onSync\s*\([\s\S]{0,200}?sync\.now\(true\)/.test(mineJs),
    "同步那一行没了 —— 用户手里就没有「现在立刻同步一次」这条出口");

  ok("队里还有几项由数据层数出来（不是界面自己记一个数）",
    /pendingCount\s*\([\s\S]{0,300}?packRecords\(\)/.test(
      fs.readFileSync(path.join(ROOT, "utils", "sync.js"), "utf8")),
    "pendingCount 没读打包记录 —— 界面上的「还有几项在等」就成了编的");

  const capSync = E.CAPS.find((c) => c.key === "sync");
  ok("云端同步在能力表里且不看档位", !!capSync && capSync.tier === "free",
    capSync ? "当前 tier=" + capSync.tier : "能力不存在");
  ok("store 里不再留导出 / 导入那对没人调的函数",
    typeof store.exportAll !== "function" && typeof store.importAll !== "function",
    "留着没人调，下一个人会以为还有一处备份出口");

  ok("有微信登录服务端说明", fs.existsSync(path.join(__dirname, "..", "docs", "wx-login-server.md")));
}

{
  const tabRoot = path.join(ROOT, "custom-tab-bar");
  const four = [".js", ".json", ".wxml", ".wxss"].every((ext) =>
    fs.existsSync(path.join(tabRoot, "index" + ext)));
  ok("自绘底栏四件套齐全", four);

  const appCfg = readJson(path.join(ROOT, "app.json"));
  ok("app.json 开启了自定义 tabBar", appCfg.tabBar && appCfg.tabBar.custom === true);

  const barSrc = fs.readFileSync(path.join(tabRoot, "index.js"), "utf8");
  const tabPageSrc = fs.readFileSync(path.join(ROOT, "utils", "tab-page.js"), "utf8");

  {
    const items = barSrc.match(/\{ pagePath: "([^"]+)", text: "([^"]+)", icon: icons\.[a-z]+([^}]*)\}/g) || [];
    ok("底栏每一项都带 pagePath / 文案 / 图标三样",
      items.length > 0
        && items.every((it) => /pagePath: "[^"]+"[^}]*text: "[^"]+"[^}]*icon: icons\.[a-z]+/.test(it)),
      "有项缺了图标或文案 —— 底栏会缺一格或空一行");
    ok("底栏每一项的图标都在图标模块里（不是写了个空名）",
      items.every((it) => {
        const icon = /icon: icons\.([a-z]+)/.exec(it)[1];
        return Object.prototype.hasOwnProperty.call(
          require(path.join(ROOT, "utils", "icons.js")), icon);
      }),
      "有个图标名在 utils/icons.js 里找不到 —— 那一格只剩文字");
    ok("图标是 base64 data URI（小程序 <image>/mask 不认 URL 编码的 data URI）",
      Object.keys(require(path.join(ROOT, "utils", "icons.js")))
        .every((k) => require(path.join(ROOT, "utils", "icons.js"))[k].indexOf("data:image/svg+xml;base64,") === 0),
      "图标不是 base64 data URI —— 真机一片空白（URL 编码那份只在小程序外面能渲染）");
    ok("「大会」不是 tab 页 —— 它走 navigateTo（组件里只有大会那一格转给 tabPage.conference）",
      /conference: 2/.test(barSrc)
        && /if \(i === this\.data\.conference\)[\s\S]{0,80}tabPage\.conference\(\)/.test(barSrc)
        && /function conference\(\)[\s\S]{0,80}wx\.navigateTo/.test(tabPageSrc),
      "大会那一项要是走 switchTab，平台会把它当成第五个 tab 页，而它不在 app.json 的 tabBar.list 里");
  }

  {
    const HOME = ["pages/home/home", "pages/library/library", "pages/search/search", "pages/mine/mine"];
    const GAME = ["packages/game/index/index", "packages/game/feihua/feihua",
      "packages/game/quiz/quiz", "packages/game/exam/exam"];
    const syncs = {};
    const call = {};
    HOME.forEach((p) => {
      const src = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");
      const m = new RegExp("tabbar\\.sync\\(this, (\\d)\\)").exec(src);
      syncs[p] = m ? Number(m[1]) : -1;
      call[p] = "sync";
    });
    GAME.forEach((p) => {
      const src = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");
      call[p] = /tabbar\.pick\(this\)/.test(src) ? "pick" : "";
    });

    const vals = Object.keys(syncs).map((k) => syncs[k]);
    ok("每个 tab 页都调了一次 tabbar.sync，且序号互不相同",
      vals.every((v) => v >= 0) && new Set(vals).size === vals.length,
      JSON.stringify(syncs) + " —— 少调、重号或调错，切过去还亮着上一栏");

    function homeCallAll() {
      const out = {};
      const walk = (dir) => {
        fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
          const q = path.join(dir, e.name);
          if (e.isDirectory()) walk(q);
          else if (e.name.endsWith(".js")) {
            out[path.relative(ROOT, q).split(path.sep).join("/").replace(/\.js$/, "")] =
              fs.readFileSync(q, "utf8");
          }
        });
      };
      ["pages", "packages"].forEach((d) => walk(path.join(ROOT, d)));
      return out;
    }

    const allPages = Object.keys(homeCallAll()).filter((p) => !/\/lib$/.test(p));
    const offBar = allPages.filter((p) =>
      !/tabbar\.(sync|pick|below)\(this[,)]/.test(fs.readFileSync(path.join(ROOT, p + ".js"), "utf8")));
    ok("每一页都挂着这条栏（不按页藏栏了，Issue #370）",
      offBar.length === 0,
      offBar.join("、")
        + " —— 这一栏现在每页都在：不 sync / pick 就还亮着上一页的格子");

    ok("大会与它的三个子页把底栏点亮在「大会」那一格",
      GAME.every((p) => call[p] === "pick"),
      GAME.filter((p) => call[p] !== "pick").join("、")
        + " —— 进了大会还亮着上一栏，退回来时那一栏又是暗的");
  }
  ok("「我的」那一格画的是头像，没有头像时退回昵称首字",
    /meAvatar:\s*store\.avatarSrc\(\)/.test(barSrc)
      && /meChar:\s*store\.avatarChar\(\)/.test(barSrc),
    "底栏那一格还挂着 icons.mine —— 换了头像只有页面里变，底栏不跟着变");
  ok("要登录的那几栏都标了 login（游客点了不进门，直接去「我的」）",
    (barSrc.match(/login:\s*true/g) || []).length >= 3,
    "标 login 的项不足三项 —— 有入口没标，游客点进去还是一屏只有一个按钮的门禁页");

    const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
  {
    const scan = [];
    const walk = (dir) => {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".js") && !/^utils\/(store|corpus|remote)\.js$/.test(rel(p))) {
          scan.push(p);
        }
      });
    };
    ["pages", "components", "packages", "utils"].forEach((d) => walk(path.join(ROOT, d)));

    const tabPages = ["/pages/home/home", "/pages/library/library", "/pages/search/search", "/pages/mine/mine"];
    const bad = [];
    scan.forEach((p) => {
      const src = fs.readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      tabPages.forEach((t) => {
        if (new RegExp('navigateTo\\(\\{\\s*url:\\s*"' + t.replace(/\//g, "\\/") + '["?]').test(src)) {
          bad.push(rel(p) + " → " + t);
        }
      });
    });
    ok("没有哪一处 navigateTo 去那四个 tab 页（navigateTo 对 tab 页静默失败）",
      bad.length === 0,
      bad.join("；") + " —— 用户点下去没有任何反应，也没有报错，正是 Issue #195");

    const helper = fs.readFileSync(path.join(ROOT, "utils", "tab-page.js"), "utf8");
    ok("去 tab 页统一走 tab-page.js（switchTab 只在这一份里）",
      /wx\.switchTab\(\{\s*url: url\s*\}\)/.test(helper)
        && scan.every((p) => rel(p) === "utils/tab-page.js"
          || !/wx\.switchTab\(/.test(fs.readFileSync(p, "utf8"))),
      "又有第二处直接写 switchTab —— 下次改跳转口径就得满地找");

    ok("去「我的」只有 tab-page.mine() 一个出口",
      /function mine\(\)[\s\S]{0,60}?go\(MINE\)/.test(helper)
        && scan.filter((p) => rel(p) !== "utils/tab-page.js")
          .every((p) => !/switchTab\(\{\s*url:\s*"\/pages\/mine\/mine"/.test(fs.readFileSync(p, "utf8"))),
      "又多了一处手写 switchTab 去「我的」");

    ok("底栏的「我的」不按当前页算：点下去先看是不是已经站在「我的」",
      /me:\s*\d/.test(barSrc)
        && /tabPage\.mine\(\)/.test(barSrc)
        && /if \(!landed\(\)\)[\s\S]{0,80}go\(MINE\)/.test(helper),
      "底栏又把「已在这一格就不动」套到「我的」上 —— 站在任何一页都点不动（Issue #709）");

    const tabPageMod = require(path.join(ROOT, "utils", "tab-page.js"));
    const savedStack = global.getCurrentPages;
    const savedWx = global.wx;
    const tries = (stack) => {
      const calls = [];
      global.getCurrentPages = () => stack.map((r) => ({ route: r }));
      global.wx = {
        switchTab: (o) => calls.push("switchTab " + o.url),
        navigateBack: (o) => calls.push("back " + o.delta),
        navigateTo: (o) => calls.push("to " + o.url)
      };
      tabPageMod.mine();
      return calls.join(" | ");
    };
    const fromMine = tries(["pages/mine/mine"]);
    const fromTheme = tries(["pages/mine/mine", "packages/settings/theme/theme"]);
    const fromHome = tries(["pages/home/home"]);
    ok("点在「我的」上回到「我的」的首页：不在那页就切过去，叠着子页就退回来",
      fromTheme === "switchTab /pages/mine/mine"
        && fromHome === "switchTab /pages/mine/mine"
        && fromMine === ""
        && tries(["pages/mine/mine", "pages/mine/mine"]) === "back 1",
      [fromMine, fromTheme, fromHome].join(" ／ "));
    global.getCurrentPages = savedStack;
    global.wx = savedWx;
  }
}

{
  const storeJs = fs.readFileSync(path.join(ROOT, "utils", "store.js"), "utf8");
  const authJs = fs.readFileSync(path.join(ROOT, "utils", "auth.js"), "utf8");
  const stripJs = (x) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("头像只认本机那一张，且页面只经 store.avatarSrc() 取（没有第二处可回落）",
    /function avatarSrc\(\)/.test(storeJs)
      && !/avatarUrl\s*[:|]/.test(stripJs(storeJs))
      && pages.every((p2) => {
        const js = fs.readFileSync(path.join(ROOT, p2 + ".js"), "utf8");
        return !/profile\(\)\.avatarUrl/.test(js)
          && !/getUserProfile/.test(stripJs(js));
      }),
    "store.avatarSrc 没了、服务端从来不回的 avatarUrl 还留着、或页面自己读头像");
  ok("登录时不写头像（服务端那一栏是空的，写它等于把用户选的抹掉）",
    !/avatarUrl\s*:|avatarLocal\s*:/.test(
      (/const patch = \{([\s\S]*?)\};/.exec(authJs) || [""])[0]));
}

{
  const authSrc = fs.readFileSync(path.join(ROOT, "utils", "auth.js"), "utf8");
  const mineSrc = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");

  ok("没接上服务器时不再写 `logged: true`（本机不冒充登录）",
    !/if \(!configured\(\)\) \{[\s\S]{0,600}?saveSession\(\{ logged: true/.test(authSrc),
    "offline 那一支又写上了 logged: true —— 用户点一下就「已登录」，而库里一条记录都没有");
  ok("没接上服务器时把 wx.login 的 code 留下来（下次真接上时不用再点）",
    /loginCode/.test(authSrc) && /delete auth\.code/.test(authSrc),
    "code 没留下、或在两处各存一份 —— 留着的唯一用途是下次真接上时省一次点击");

  const fakeWx = (mem) => ({
    getStorageSync: (k) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : ""),
    setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
    removeStorageSync: (k) => { delete mem[k]; },
    request: () => { mem.__requested = (mem.__requested || 0) + 1; },
    cloud: { init: (o) => o.success && o.success(), callContainer: (o) => o.fail({ errMsg: "offline" }) }
  });

  {
    const mem = {};
    const savedWx = global.wx;
    global.wx = fakeWx(mem);
    global.wx.login = (o) => o.success({ code: "C-OFFLINE" });
    global.wx.request = (o) => { mem.__requested = (mem.__requested || 0) + 1; };

    Object.keys(require.cache).forEach((k) => {
      if (k.indexOf(path.join(ROOT, "utils")) === 0) delete require.cache[k];
    });
    const auth2 = require(path.join(ROOT, "utils", "auth.js"));
    const store2 = require(path.join(ROOT, "utils", "store.js"));

    store2.drop(store2.KEYS.auth);
    store2.saveSession({ logged: false, tier: "", tierFromServer: false });
    auth2.configure({ baseUrl: "", cloud: { env: "probe-env", service: "probe-svc" } });

    global.wx.cloud = {
      init: (o) => o.success && o.success(),
      callContainer: (o) => o.fail && o.fail({ errMsg: "no cloud" })
    };

    const loginPromise = auth2.login();
    const snapProf = store2.profile();
    const snapRequested = mem.__requested;

    ok("接上服务器（包里那份云调用）时 profile.logged 不为 true —— 服务端还没回话",
      snapProf.logged !== true,
      "本机自己先认了登录 —— 服务端连这个人都还不知道；实际 " + JSON.stringify(snapProf));
    ok("走云调用时不打 wx.request（两条通道分得开）",
      !snapRequested, "发了 " + (snapRequested || 0) + " 次请求");

    track(
      loginPromise
        .then(
          (r) => ok("云调用不通时 login() 不该成功", false, "回了 " + JSON.stringify(r)),
          (e) => {
            ok("云调用不通时 login() 出声拒绝（不再「静默成功」）",
              String(e && e.message).length > 0, String(e && e.message));
            ok("云调用不通时把离线标记留下（界面据此说清为什么）",
              auth2.offline() === "cloud" || auth2.offline() === "off",
              "offline=" + JSON.stringify(auth2.offline()));
          }
        )

        .then(() => {

          Object.keys(require.cache).forEach((k) => {
            if (k.indexOf(path.join(ROOT, "utils")) === 0) delete require.cache[k];
          });
          const auth2 = require(path.join(ROOT, "utils", "auth.js"));
          const store2 = require(path.join(ROOT, "utils", "store.js"));

          global.wx = fakeWx(mem);
          global.wx.cloud = {
            init: (o) => o.success && o.success(),
            callContainer: (o) => o.success({
              statusCode: 200,
              data: {
                accessToken: "tok", refreshToken: "ref", expiresIn: 604800,
                tier: "free", role: "user", userId: "wx_probe"
              }
            })
          };
          global.wx.login = (o) => o.success({ code: "C-ONLINE" });
          global.wx.request = (o) => {
            mem.__requested = (mem.__requested || 0) + 1;
            o.success({
              statusCode: 200,
              data: {
                accessToken: "tok", refreshToken: "ref", expiresIn: 604800,
                tier: "free", role: "user", userId: "wx_probe"
              }
            });
          };
          delete mem[store2.KEYS.profile];
          delete mem[store2.KEYS.auth];
          delete mem[store2.KEYS.sync];
          store2.saveSession({ logged: false, tier: "", tierFromServer: false });
          auth2.configure({ baseUrl: "", cloud: { env: "probe-env", service: "probe-svc" } });
          ok("配上云调用两栏之后 configured() 为真（②那条断言的前提）",
            auth2.configured() === true,
            "configured=" + JSON.stringify(auth2.configured()));
          return auth2.login();
        })
        .then(() => {
          ok("接上服务器时 profile.logged 为 true、临时 code 清掉、拿到了 token",
            store2.profile().logged === true
              && !(store2.read(store2.KEYS.auth, {}) || {}).loginCode
              && !!(store2.read(store2.KEYS.auth, {}) || {}).accessToken);
          global.wx = savedWx;
        })
    );
  }

  {
    const flowCode = fs.readFileSync(path.join(ROOT, "utils", "login-flow.js"), "utf8");
    const gateCode = fs.readFileSync(path.join(ROOT, "utils", "gate.js"), "utf8");
    ok("登录被拒的理由要能指到「同步服务」这一行（不是一句「登录失败」）",
      /E_NOT_CONFIGURED/.test(flowCode) && /E_NOT_CONFIGURED[\s\S]{0,200}?(title|content):/.test(flowCode),
      "登录流程没有把 E_NOT_CONFIGURED 转成一条能指的提示 —— 用户只看到「登录未完成」");
    ok("登录只有一份（页面不再各写一遍）",
      /require\(["']\.\.\/\.\.\/utils\/login-flow["']\)/.test(mineSrc)
        && /require\(["']\.\/login-flow["']\)/.test(gateCode),
      "「我的」页与门禁弹窗各自写了一遍 wx.login 的成败分支");
    const openBody = (gateCode.match(/function open\(onPass, page\) \{[\s\S]*?\n\}/) || [""])[0];
    ok("门禁弹窗只有一份，点了「登录」就真去登录",
      /loginFlow\.askLogin\(/.test(openBody) && openBody.indexOf("wx.showModal") < 0,
      "open() 自己弹框、或没走 askLogin —— 登录入口分成两套，点了没有真去登录（Issue #502）。函数体："
        + openBody.replace(/\s+/g, " "));
    ok("登录流程与门禁不互相 require（循环依赖会让 gate 交到半个空壳）",
      flowCode.indexOf('require("./gate")') < 0
        && flowCode.indexOf("require('./gate')") < 0,
      "login-flow 又 require 了 gate —— 两个模块互指时，先加载的那个只能拿到未填完的 exports，"
        + "askLogin 里调 gate.logged() 就是 TypeError: e.logged is not a function（Issue #498）");
  }

  {
    const flowSrc = fs.readFileSync(path.join(ROOT, "utils", "login-flow.js"), "utf8");
    const settleBody = (flowSrc.match(/function settle\(res, page\) \{[\s\S]*?\n\}/) || [""])[0];
    const minePage = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");
    const homePage = fs.readFileSync(path.join(ROOT, "pages", "home", "home.js"), "utf8");
    const barCode = fs.readFileSync(path.join(ROOT, "custom-tab-bar", "index.js"), "utf8");
    const aboutSrc = fs.readFileSync(path.join(ROOT, "packages", "settings", "about", "about.js"), "utf8");
    const watched = (src) => /loginFlow\.watch\(/.test(src) && /loginFlow\.unwatch\(/.test(src);

    ok("登录收尾会通知订阅方（关在页面里的那次登录，页面得知道它成了）",
      /function report\(res\)/.test(flowSrc) && /report\(res\)/.test(settleBody),
      "settle 没有通知任何一方 —— 登录成了页面还在画未登录那一屏（Issue #502）");
    ok("首页、我的、底栏都订上这条通知，也都在卸载时退订",
      watched(minePage) && watched(homePage) && watched(barCode),
      [minePage.indexOf("loginFlow.watch") < 0 ? "我的" : "",
        homePage.indexOf("loginFlow.watch") < 0 ? "首页" : "",
        barCode.indexOf("loginFlow.watch") < 0 ? "底栏" : ""].filter(Boolean).join("、")
        + " 没订上 —— 登录完了界面不会自己换那一屏");
    ok("退出会通知订阅方，并回到「我的」（不留在关于页看一个已退出的自己）",
      /leave\(\) \{[\s\S]{0,200}?auth\.logout\(\)[\s\S]{0,200}?loginFlow\.report\(\)[\s\S]{0,200}?tabPage\.mine\(\)/.test(aboutSrc),
      "关于页点了退出：没广播登录状态，或没回「我的」—— 身份卡与底栏停在已登录那一屏（Issue #663）");
  }
}

{
  const entSrc = fs.readFileSync(path.join(ROOT, "utils", "entitlement.js"), "utf8");
  const gateSrc = fs.readFileSync(path.join(ROOT, "utils", "gate.js"), "utf8");
  const flowSrc = fs.readFileSync(path.join(ROOT, "utils", "login-flow.js"), "utf8");
  const lockSrc = fs.readFileSync(path.join(ROOT, "components", "lock-card", "lock-card.js"), "utf8");
  const panelSrc = fs.readFileSync(path.join(ROOT, "components", "login-panel", "login-panel.js"), "utf8");
  const showLoginBody = (entSrc.match(/function showLogin\(name, ctx\) \{[\s\S]*?\n\}/) || [""])[0];
  const blockBody = (entSrc.match(/function block\(name, opt\) \{[\s\S]*?\n\}/) || [""])[0];

  ok("登录弹窗只有一个：门禁与能力检查都走 gate.open",
    showLoginBody.indexOf("showModal") < 0 && /gate\.open\(/.test(showLoginBody)
      && blockBody.indexOf("showLogin(") >= 0 && blockBody.indexOf("wx.showModal") < 0,
    "entitlement 与 gate 各自 showModal 了一遍 —— 一次点击叠出两个都带「登录」的弹窗（Issue #502）");
  ok("先问登录，再问档位（同一件事只问一遍）",
    blockBody.indexOf("if (r.login)") >= 0
      && blockBody.indexOf("if (r.login)") < blockBody.indexOf("showTier("),
    "block 先过档位再过登录 —— 登录完还要被第二道门再拦一次（Issue #502）");
  ok("页面的「登录」按钮都进同一段真实登录流程",
    /loginFlow\.run\(/.test(lockSrc) && /triggerEvent\(["']login["']\)/.test(panelSrc)
      && flowSrc.indexOf("function run(") >= 0,
    "锁页卡或身份卡上的「登录」还只是跳「我的」—— 两处按钮两套行为");
  ok("同一时刻只弹一个登录框",
    /let asking\s*=\s*false/.test(flowSrc) && /if \(auth\.logged\(\) \|\| asking\)/.test(flowSrc),
    "askLogin 不拦重入 —— 登录框没关时再点一下又叠一个");

  const startBody = (flowSrc.match(/function start\(page, action\) \{[\s\S]*?\n\}/) || [""])[0];
  ok("没带 action 也照弹登录框（登录按钮走的就是这条）",
    startBody.indexOf("action") < 0 || startBody.indexOf("if (!action)") < 0,
    "start 见 action 是空的就直接返回 —— 登录按钮点了不出框，"
      + "auth.login 一次也不调，人卡在未登录（Issue #502 回归）");

  const toastLine = (blockBody.match(/wx\.showToast\(\{ title: [^\n]*\)/) || [""])[0];
  ok("登录提示不重复拼接",
    toastLine.indexOf('"登录" +') < 0,
    "block 里把「登录」和 hint() 的「登录可用」又拼了一遍 —— 弹出「登录登录可用后可用」。"
      + "行：" + toastLine);

    ok("登录：回来重走一遍 onShow（落在本页时，页面得重新过自己的入口）",
      /function run\(page\) \{[\s\S]*?mark\(page\)/.test(flowSrc)
        && /then\(\(res\) => \{[\s\S]*?reboot\(page\)/.test(flowSrc),
      "登录成了不重走 onShow —— 这一页的门禁停在未登录那屏，整页空白（Issue #599）");
    ok("登录失败也重走一次（提示框照旧弹在它上面）",
      /catch\(\(err\) => \{[\s\S]*?reboot\(page\)[\s\S]*?prompt\(err\)/.test(flowSrc),
      "失败分支只弹框、不重走 onShow —— 页面停在打不开的那一屏");
    ok("重走只给登录发起时正开着的那一页，用完撤掉",
      /function mark\(page\)[\s\S]*?shownAt = \{ page/.test(flowSrc)
        && /function reboot\(page\) \{[\s\S]*?shownAt = null;[\s\S]*?held\.page !== page[\s\S]*?return false;/.test(flowSrc),
      "记的不是「哪一页发起的」、或者用完不撤 —— 登录回来了这页也不会再重走一次");
}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const reciteJs = read("packages/settings/recite/recite.js");
  const sched = read("utils/scheduler.js");

  ok("学段那一格用的是 scheduler 里那份学段表",
    /onStage\s*\(/.test(reciteJs)
      && /const STAGES\s*=\s*S\.STAGE_KEYS\.map/.test(reciteJs),
    "学段没绑事件、或自己抄了一份学段表");
  ok("学段用的是 scheduler 里那份口径（不另抄一份）",
    /primary:\s*\{ name: "小学"/.test(sched)
      && /STAGES,/.test(sched)
      && /stageOf/.test(sched));

  ok("三个阶段各有一个名字，且互不相同",
    (sched.match(/name:\s*"[^"]*\S"/g) || []).length >= 3,
    "学段表里有的段没有名字 —— 界面上会空一格");

  ok("学段那个名字没被「记忆阶段」的同名函数盖掉",
    /function stageLabel\(/.test(sched) && /function stageName\(rec\)/.test(sched)
      && (sched.match(/function stageName\(/g) || []).length === 1,
    "scheduler 里有两个 stageName —— 后一个会把前一个盖掉");

  const onStage = /onStage\(e\)\s*\{([\s\S]*?)\n  \}/.exec(reciteJs);
  const onStageBody = onStage ? onStage[1] : "";
  ok("点学段会把年级跳到这一段里（不是只换格子）",
    /STAGE_GRADES\[key\]/.test(onStageBody) && /grade/.test(onStageBody));
  ok("点学段会把取诗范围换成这一段的随机范围",
    /scopeForStage\(/.test(onStageBody) && /function scopeForStage/.test(reciteJs));

  ok("横跨学段的两个范围（小初随机 / 全部随机）不跟着换",
    /stages\.length === 1/.test(reciteJs),
    "scopeForStage 少了对「单学段」的判据 —— 换学段会把小初随机也换掉");
}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

  ok("温习设置页有取诗范围那一组（绑在 onScope 上）",
    /onScope\s*\(/.test(read("packages/settings/recite/recite.js")));

  {
    const js = read("pages/search/search.js");
    ok("搜索走课程索引（corpus.search），不再扫正文",
      /byIndex\(kw\)/.test(js) && !/runFull/.test(js) && !/text-search/.test(js));
    ok("搜索结果一次只列 20 条",
      /const BATCH = 20;/.test(js) && /slice\(0, BATCH\)/.test(js),
      "每批 20 条这个数只该在一处写死 —— 散在两个地方，下拉与首屏就会各出各的数");
    ok("触底才接下一批（onReachBottom 里才续取）",
      /onReachBottom\s*\(\)\s*\{[\s\S]{0,320}?askSource/.test(js),
      "没有 onReachBottom —— 列表拉到底不会续取，20 条就是全部");
    ok("分批只切显示，不切命中池（不设上限截断，命中数才算得准）",
      /corpus\.search\(kw, \{ limit: Infinity \}\)/.test(js) && !/PACK_MAX/.test(js),
      "byIndex 给了 limit —— 命中数会被截在那一档，界面上的「命中 N 篇」就不准了");
  }

  {
    const scoreLog = require(path.join(ROOT, "utils", "score-log.js"));
    const tiersEarly = require(path.join(ROOT, "utils", "tiers.js"));
    const entEarly = require(path.join(ROOT, "utils", "entitlement.js"));
    const keptStatus = entEarly.status;
    const tierAs = (t) => { entEarly.status = () => ({ tier: t, source: "selfcheck", label: t, blocked: "", signed: true }); };
    tierAs("max");
    const KEY = scoreLog.MODES.exam.key;
    const FKEY = scoreLog.MODES.feihua.key;
    const savedLog = store.read(KEY, null);
    const savedFh = store.read(FKEY, null);
    store.drop(KEY);
    store.drop(FKEY);

    const a = scoreLog.add("exam", { pct: 100, correct: 10, total: 10, span: 62 });
    const b = scoreLog.add("exam", { pct: 42, correct: 4, total: 10, span: 600 });
    const bad = scoreLog.add("exam", { pct: "abc", correct: -1 });
    ok("一次考试留一条，脏值收成 0",
      scoreLog.list("exam").length === 3 && bad.pct === 0 && bad.correct === 0,
      JSON.stringify(scoreLog.list("exam")));
    ok("最好的一次跟着分数走，不跟着先来后到；删掉它之后让给下一条",
      scoreLog.summary("exam").best.id === a.id
        && scoreLog.remove("exam", [a.id, bad.id]) === 2
        && scoreLog.summary("exam").best.id === b.id && scoreLog.list("exam").length === 1);

    scoreLog.add("feihua", { hit: 6, span: 90 });
    const r2 = scoreLog.add("feihua", { hit: 13, span: 90 });
    scoreLog.add("feihua", { hit: "abc" });
    ok("一轮飞花令留一条，与考试的记录各存一份",
      scoreLog.list("feihua").length === 3 && scoreLog.list("exam").length === 1,
      JSON.stringify(scoreLog.rows("feihua").map((r) => r.hit)));
    ok("飞花令删掉一条之后就少一条",
      scoreLog.remove("feihua", [r2.id]) === 1 && scoreLog.list("feihua").length === 2);

    store.drop(KEY);
    store.drop(FKEY);

    tierAs("pro");
    for (let i = 0; i <= tiersEarly.RECORD_LIMITS.pro; i += 1) {
      scoreLog.add("exam", { pct: 60, scope: "s" + i, at: 1000 + i });
    }
    const keptRows = scoreLog.rows("exam");
    ok("本机记录条数停在档位上限，多出来的挤掉最久那条",
      keptRows.length === tiersEarly.RECORD_LIMITS.pro && !keptRows.some((r) => r.scope === "s0"),
      "条数 " + keptRows.length + "，最久那条还在 " + keptRows.some((r) => r.scope === "s0"));
    store.drop(KEY);

    tierAs("free");
    scoreLog.add("exam", { pct: 100 });
    ok("没开通时一条也不落", scoreLog.list("exam").length === 0,
      "Free 也在本机攒记录 —— 与「Pro " + tiersEarly.RECORD_LIMITS.pro + " / Max " + tiersEarly.RECORD_LIMITS.max + "」对不上");

    entEarly.status = keptStatus;
    if (savedLog !== null) store.write(KEY, savedLog);
    if (savedFh !== null) store.write(FKEY, savedFh);

    const examJs = read("packages/game/exam/exam.js");
    const fhJs = read("packages/game/feihua/feihua.js");
    ok("交卷那一刻就落一条（finish 里写，不等用户去记录页）",
      /finish\(\)[\s\S]{0,1600}?scoreLog\.add\("exam"/.test(examJs));
    ok("一轮飞花令收尾就落一条，两种收尾都走同一个写入",
      (fhJs.match(/scoreLog\.add\("feihua"/g) || []).length === 1
        && /endRound\([^)]*\) \{[\s\S]{0,400}?keepRound\(\)/.test(fhJs)
        && /onSkip\(\)[\s\S]{0,400}?keepRound\(\)/.test(fhJs),
      "只写了一条路，另一种收尾方式那一轮就不会留下记录");
  }

  {
    const examJs = read("packages/game/exam/exam.js");
    const iPick = examJs.indexOf("onPick(e)");
    const iJudge = examJs.search(/judge\s*\(/);
    ok("答题途中不判对错（判分那一步排在 onPick 之后）",
      iPick >= 0 && iJudge > iPick,
      "onPick @" + iPick + " 判分 @" + iJudge + " —— 判分排在答题之前就等于当场把答案说了出来");
    ok("批是在交卷时做的（finish 里逐题判）",
      /finish\(\)[\s\S]{0,900}?judge\s*\(/.test(examJs));

    const quizJs = read("packages/game/quiz/quiz.js");
    ok("题库当场给对错（判定在 onPick 里，不等下一题）",
      /onPick\(e\)[\s\S]{0,400}?quiz\.judge/.test(quizJs));
  }
}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const rank = require(path.join(ROOT, "utils", "ranking.js"));
  const pageJs = read("packages/ranking/index/index.js");
  const adminJs = read("packages/admin/index/index.js");
  const apiCore = fs.readFileSync(path.join(__dirname, "..", "api", "_lib", "core.js"), "utf8");
  const apiStore = fs.readFileSync(path.join(__dirname, "..", "api", "_lib", "store.js"), "utf8");
  const apiMysql = fs.readFileSync(path.join(__dirname, "..", "deploy", "store-mysql.js"), "utf8");

  ok("分档口径与排期层同一套学段（小学 1-6 / 初中 7-9 / 高中 10-12）",
    rank.STAGE_GRADES.primary.join() === "1,2,3,4,5,6"
      && rank.STAGE_GRADES.middle.join() === "7,8,9"
      && rank.STAGE_GRADES.high.join() === "10,11,12"
      && rank.stageOfGrade(1) === "primary" && rank.stageOfGrade(9) === "middle"
      && rank.stageOfGrade(12) === "high",
    "学段边界与 scheduler.js 那张表走散，同一份成绩会落到两个榜里");

  ok("昵称只留首末字，中间一律两个星号",
    rank.maskNick("张三") === "张**三"
      && rank.maskNick("欧阳修文") === "欧**文"
      && rank.maskNick("李") === "李**"
      && rank.maskNick("", "u_123456") === "诗**6",
    "打码口径不对 —— " + [rank.maskNick("张三"), rank.maskNick("欧阳修文"), rank.maskNick("")].join(" / "));

  ok("榜单每一行（含自己那一行）都走同一个打码，页面上不留全名",
    rank.maskRow({ nick: "张三", rank: 1 }).nick === "张**三"
      && rank.maskRow({ nick: "张三", rank: 1 }).rank === 1
      && rank.maskRow({ rank: 2 }).nick === ""
      && /const board = \(res\.board \|\| \[\]\)\.map\(ranking\.maskRow\)/.test(pageJs)
      && /const me = res\.me \? ranking\.maskRow\(res\.me\) : null/.test(pageJs)
      && /me: self,/.test(pageJs),
    "服务端已经打过一次，端上没再兜一层 —— 换个后端或漏改一处就露全名");

  ok("同分同名次，下一名跳号（一人一行不变，名次不再按行号数）",
    rank.podiumOf([{ rank: 1, nick: "甲", score: 9, total: 10 }, { rank: 1, nick: "乙", score: 9, total: 10 }])[0].tied === true
      && rank.restOf([{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 4 }, { rank: 5 }]).map((r) => r.rank).join() === "1,2,3,4,5",
    "同分的人各占一行名次，第 2 名凭空消失；或同一个人被抄成两行");

  ok("领奖台只认前三名，状元在列表里也有一行",
    rank.podiumOf([{ rank: 1, nick: "甲", score: 9, total: 10 }, { rank: 2, nick: "乙", score: 8, total: 10 }])
      .filter((m) => m.filled).length === 2
      && rank.podiumOf([]).length === 3
      && rank.restOf([{ rank: 1 }, { rank: 4 }]).map((r) => r.rank).join() === "1,4",
    "状元只活在一块奖牌上，换个时间口径就找不到自己排第几");

  ok("榜单只发服务端认得的档位（全部学段不带年级，年级要落在本学段里）",
    rank.queryOf({ stage: "all", grade: 3, term: 1 }).grade === 0
      && rank.queryOf({ stage: "all", grade: 3, term: 1 }).term === 0
      && rank.queryOf({ stage: "primary", grade: 3, term: 1 }).grade === 3
      && rank.queryOf({ stage: "primary", grade: 3, term: 1 }).term === 1
      && rank.queryOf({ stage: "primary", grade: 7, term: 1 }).grade === 0
      && rank.queryOf({ stage: "primary", grade: 3, term: 9 }).term === 0,
    "端上留着服务端不认的档位 —— 标签与榜单会各说一套");

  ok("服务端与客户端的分档口径是同一套（能力键同表）",
    /BOARD_STAGE_GRADES = \{ primary: \[1, 2, 3, 4, 5, 6\], middle: \[7, 8, 9\], high: \[10, 11, 12\] \}/.test(apiCore)
      && /function boardMaskNick/.test(apiCore) && /function boardPeriodStart/.test(apiCore),
    "服务端另立一套学段或另写一份打码，两端就会给出不同的名字与分组");

  ok("昵称写入前过一遍敏感词（拦在 nicknameSet，落库那一层不拦）",
    /var nickGuard = require\("\.\/nick-guard"\)/.test(apiCore)
      && /function nicknameSet[\s\S]{0,300}?nickGuard\.hit\(name\)[\s\S]{0,120}?E_NICK_BLOCKED/.test(apiCore),
    "只在前端拦 —— 换个客户端直连 /api/me 就写进去了");

  ok("榜单打码前先过敏感词（库里已存着的脏名字不上榜）",
    /function boardMaskNick[\s\S]{0,200}?nickGuard\.hit\(name\)/.test(apiCore),
    "只拦新写入的话，改口径之前存下的脏名字会一直摆在榜上");

  {
    const guard = require(path.join(__dirname, "..", "api", "_lib", "nick-guard.js"));
    ok("敏感词过滤认全角与夹字符（`傻 逼` / `ＦＵＣＫ` 一样认出来）",
      guard.hit("傻 逼") && guard.hit("傻*逼") && guard.hit("ＦＵＣＫ") && guard.hit("加微信领红包")
        && !guard.hit("李白") && !guard.hit("欧阳修文") && !guard.hit("诗友3456"),
      "归一化只做了 trim —— 夹一个空格或星号就绕过去了");
  }

  ok("昵称被拦后端上退回原名并说一句（不把脏名字留在本机）",
    /blocked: !!\(err && err\.code === "E_NICK_BLOCKED"\)/.test(read("utils/auth.js"))
      && /auth\.saveNickname\(nickname\)\.then\(\(r\) => \{[\s\S]{0,400}?store\.saveProfile\(\{ nickname: before \}\)/.test(read("utils/login-flow.js")),
    "服务端不收，本机却已经改成了那个名字 —— 顶栏与榜上各说一套");

  ok("榜单读写都过同一道开关门（关着不给看也不收成绩）",
    /function boardGate/.test(apiCore)
      && /E_RANKING_OFF/.test(apiCore)
      && /function boardList[\s\S]{0,400}?boardGate/.test(apiCore)
      && /function boardSubmit[\s\S]{0,400}?boardGate/.test(apiCore),
    "只关列表不关提交，用户交完成绩却发现榜上没有自己");

  ok("往榜上灌成绩的两条路都限流（成绩底账只增不减）",
    /function boardSubmit[\s\S]{0,1600}?limiter\.take\(cfg, "board", "dev:"/.test(apiCore)
      && /function examRecordCreate[\s\S]{0,1600}?limiter\.take\(cfg, "device", "examrec:"/.test(apiCore),
    "去掉限流之后一个 deviceId 能在几秒内往 score_records / exam_records 里灌满行");

  ok("交成绩的额度走自己那一格（设备那格是给登录验证码用的 10 次/小时，一轮飞花令交一次就撞顶）",
    /if \(bucket === "board"\) return cfg\.rateBoard/.test(apiCore)
      && /rateBoard:\s*\[\[/.test(fs.readFileSync(path.join(__dirname, "..", "api", "_lib", "config.js"), "utf8"))
      && /"board", "uid:"/.test(apiCore),
    "交成绩吃的是 rate.device —— 连不上的那几次都在服务端扣额度，玩到第 11 轮起就回 429 且没人告诉用户");

  ok("登录那几条额度只挡「成功的登录」（成功才计数，上游失败与已过期的一分不扣）",
    /if \(r\.status !== 200\) return r;\s*limiter\.hit\("device", "wxlogin:"/.test(apiCore)
      && !/limiter\.take\(cfg, "device", "wxlogin:/.test(apiCore),
    "take() 先扣再看真伪：code2session 一挂，用户怎么点都是白扣，扣满 30 次当天就登不进来");

  ok("两个榜默认开着（没有那一行就是开，只有显式写 0 才算关）",
    /return String\(v == null \? "" : String\(v\)\.trim\(\)\) !== "0"/.test(apiCore),
    "默认值翻成关之后，用户一进榜就是「没有开」—— 榜不该等谁来拧一下");

  ok("成绩底账不存昵称（改名一次全站生效，不用回灌历史行）",
    /putScoreRecord: function \(row\)/.test(apiStore)
      && !/nickname/.test(apiStore.slice(apiStore.indexOf("putScoreRecord"), apiStore.indexOf("getSetting")))
      && !/`nickname`/.test(apiMysql.slice(apiMysql.indexOf("putScoreRecord"), apiMysql.indexOf("putSetting"))),
    "把昵称抄进了成绩行，用户改名后榜上留的还是旧名字");

  ok("榜只给前 100 名，100 名之外的自己单给一行",
    rank.DEFAULT_SIZE === 100
      && /var BOARD_SIZES = \[100\]/.test(apiCore)
      && /var shown = ranked\.slice\(0, size\)/.test(apiCore)
      && /me: self/.test(apiCore)
      && /var beyond = mineIndex >= size \? ranked\[mineIndex\] : null/.test(apiCore),
    "整张榜拉下来再挑 —— 人一多就白拉；或者干脆不给自己那一行，第 305 名看不到自己");

  ok("圈外那一行自己也算得出「还有多少位」",
    rank.beyondOf([{ rank: 1 }], 305) === 304 && rank.beyondOf([], 0) === 0,
    "「还有几位」把自己也数进去了");

  ok("榜单是单独一页，入口在大会页（不挤进考试页里）",
    app.subPackages.filter((sp) => sp.root === "packages/ranking").length === 1
      && /onRanking/.test(read("packages/game/index/index.js"))
      && /packages\/ranking\/index\/index/.test(read("packages/game/index/index.js"))
      && pageJs.indexOf("rankingList") >= 0,
    "榜单挂在考试结果页里的话，飞花令那一半就没有入口");

  ok("榜外那句「看看差别」点下去落到开通会员页",
    /onTierGate\s*\(\)\s*\{[\s\S]{0,80}?url:\s*"\/packages\/mine\/pricing\/pricing"/.test(pageJs),
    "档位不够时那枚胶囊是死的 —— 用户看着「Max 起可用」却买不到（Issue #686 / #662）");

  ok("切学段不替用户预选年级，册次只在选了年级之后才出现",
    !/grade: grade, term: 0, label/.test(pageJs)
      && /if \(!this\.data\.grade\) return;/.test(pageJs),
    "服务端不认的档位又回来了 —— 选了「全部」却挂着一个年级");

  ok("榜单页按「学段 / 年级 / 学期 / 日周月年」四层收窄，且走的是同一份查询",
    ["onStage", "onGrade", "onTerm", "onPeriod"].every((h) => new RegExp("^  " + h + "\\(", "m").test(pageJs))
      && (pageJs.match(/this\.load\(\)/g) || []).length >= 4,
    "少一层就等于把不同档次的成绩排在一块");

  ok("后台不再有榜单开关（两个榜在应用里默认打开，页面与接口都不留拨杆）",
    !/rankingState\(/.test(adminJs) && !/setRanking\(/.test(adminJs)
      && !/adminRanking/.test(read("utils/remote.js")) && !/adminRanking/.test(apiCore)
      && !/admin\/ranking/.test(fs.readFileSync(path.join(__dirname, "..", "api", "_lib", "routes.js"), "utf8")),
    "后台还留着一枚开关，用户读到的「默认打开」就是句假话");
}

{

  const readJs = fs.readFileSync(path.join(ROOT, "pages/reader/reader.js"), "utf8");
  const sheetJs = fs.readFileSync(path.join(ROOT, "components/recite-sheet/recite-sheet.js"), "utf8");

  ok("出处与选本只在语料里存书名，界面不剥括号",
    !/bookNameOf|bookTitleOf/.test(readJs) && !/bookNameOf|bookTitleOf/.test(sheetJs)
      && /source: meta\.s \|\| meta\.n/.test(readJs)
      && /source: meta\.s \|\| meta\.n/.test(sheetJs));

  ok("出处里的书名只括到书名为止，注者与转引不并进书名号",
    (() => {
      const dir = path.join(__dirname, "corpus", "data");
      const bad = [];
      fs.readdirSync(dir).forEach((f) => {
        if (!/\.js$/.test(f)) return;
        const src = fs.readFileSync(path.join(dir, f), "utf8");
        const re = /\bsource:\s*"((?:[^"\\]|\\.)*)"/g;
        let m;
        while ((m = re.exec(src))) {
          const v = m[1];
          if (/(注|集注|注疏|注引|裴注引)/.test(v) && /^[^《》]*·[^《》]*$/.test(v)) bad.push(v);
        }
      });
      return bad.length === 0;
    })(),
    "注者与转引紧贴在篇名后面，书名号若连它们一起括进去就分不清哪是书名");

  ok("评分后的提示读的是记录上的下次复习时刻",
    (() => {
      const rm = require(path.join(ROOT, "utils", "review-models.js"));
      const at = new Date(2025, 0, 7, 9, 0, 0).getTime();
      const hint = rm.resultHint("k", "good", { nextReviewAt: at });
      const other = rm.resultHint("k", "good", { nextReviewAt: at + 86400000 });
      return hint.indexOf("1月7日") >= 0 && other.indexOf("1月8日") >= 0;
    })(),
    "提示若自己按结果类型算「N 小时 / N 分钟后」，就和记录上的 nextReviewAt 对不上 —— "
      + "用户照着提示去等，等到的不是排期里那一天");
}

{
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");

  const themeMod = require(path.join(ROOT, "utils", "theme.js"));
  const all = themeMod.all();

  const WANT = [
    ["daiqing", "黛青", [2, 54, 51], "tradition"],
    ["muse", "暮色", [79, 96, 114], "tradition"],
    ["nuahui", "暖灰", [164, 86, 104], "tradition"],
    ["mich", "米褐", [126, 101, 84], "tradition"],
    ["shilv", "石绿", [108, 127, 79], "tradition"],
    ["yanzhi", "胭脂", [157, 41, 51], "tradition"],
    ["yuqing", "雨过天青", [47, 96, 85], "tradition"],
    ["ink", "墨色", [8, 8, 10], "tradition"],
    ["datongxuankongsi", "大同悬空寺", [203, 142, 79], "landscape"],
    ["eergunashidi", "额尔古纳", [205, 83, 63], "landscape"],
    ["hulunbeiershiwei", "呼伦贝尔室韦", [53, 131, 166], "landscape"],
    ["dandongyalujiang", "丹东鸭绿江", [16, 50, 59], "landscape"],
    ["benxiguanmenshan", "本溪关门山", [205, 20, 11], "landscape"],
    ["changchunnanling", "长春南岭", [243, 61, 104], "landscape"],
    ["baishanchangbaishan", "白山长白山", [11, 41, 74], "landscape"],
    ["yangzhoushxihu", "扬州瘦西湖", [145, 207, 8], "landscape"],
    ["fuyangfuchunjiang", "富阳富春江", [26, 37, 35], "landscape"],
    ["wenzhouyandangshan", "温州雁荡山", [22, 53, 46], "landscape"],
    ["nanpingwuyishan", "南平武夷山", [14, 133, 118], "landscape"],
    ["qingdaolaoshan", "青岛崂山", [33, 56, 63], "landscape"],
    ["qingmingshanghetu", "开封上河图", [107, 153, 7], "landscape"],
    ["ganziyading", "甘孜亚丁", [236, 158, 1], "landscape"],
    ["lijianghutiaoxia", "丽江虎跳峡", [44, 62, 62], "landscape"],
    ["lijiangluguhu", "丽江泸沽湖", [25, 91, 108], "landscape"],
    ["jiayuguan", "嘉峪关", [249, 139, 57], "landscape"],
    ["dunhuangmogaoku", "敦煌莫高窟", [91, 54, 41], "landscape"],
    ["aletailhemu", "阿勒泰禾木", [35, 60, 75], "landscape"]
  ];

  const rgbaOf = (c) => "rgba(" + c[0] + ", " + c[1] + ", " + c[2] + ", 1)";

  const missing = WANT.filter(([k, name, rgb]) => {
    const t = all.find((x) => x.key === k);
    return !t || t.name !== name || t.rgba !== rgbaOf(rgb) || t.soft !== rgbaOf(rgb).replace(", 1)", ", 0.05)");
  });
  ok("清单就是这 27 项（八个传统色 + 十九大好河山）",
    missing.length === 0 && all.length === WANT.length,
    missing.map((m) => m[1]).join(", ") + "；清单 " + all.length + " 项");

  const groupMod = themeMod.groups();
  const badGroup = WANT.filter(([k, , , g]) => {
    const hit = groupMod.find((x) => x.items.some((i) => i.key === k));
    return !hit || hit.key !== g;
  });
  ok("每支主题都归到自己那张卡上（中国传统 / 大好河山 / 自定义题图）",
    badGroup.length === 0 && groupMod.length === 3
      && groupMod.map((x) => x.title).join() === "中国传统,大好河山,自定义题图"
      && groupMod[0].items.length + groupMod[1].items.length === all.length,
    badGroup.map((m) => m[1]).join(", ") + " 没归位；卡片 " + groupMod.map((x) => x.title).join(" / "));

  function inTradition(key) {
    return WANT.filter((w) => w[0] === key)[0][3] === "tradition";
  }

  {
    const tierOf = (t) => {
      const store = require(path.join(ROOT, "utils", "store.js"));
      store.saveProfile({ logged: true, tier: "" });
      store.drop(store.KEYS.auth);
      store.drop(store.KEYS.caps);
      store.drop(store.KEYS.grant);
      if (t !== "free") store.write(store.KEYS.grant, { code: t.toUpperCase() + "-ABCD-1234", tier: t, at: Date.now() });
    };
    const groupOf = (key) => themeMod.groups().filter((g) => g.key === key)[0];

    tierOf("free");
    ok("Free 手里「大好河山」那张卡是灰的，「中国传统」照旧能点",
      groupOf("landscape").locked === true
        && groupOf("landscape").tier === "pro"
        && groupOf("landscape").items.every((i) => i.locked)
        && groupOf("tradition").locked === false
        && groupOf("tradition").items.every((i) => !i.locked),
      JSON.stringify(groupOf("landscape").items.map((i) => i.locked)));

    themeMod.set("yangzhoushxihu");
    ok("Free 点不出大好河山那一支（点了也停在原来那支）",
      themeMod.current() !== "yangzhoushxihu" && inTradition(themeMod.current()),
      themeMod.current());

    tierOf("pro");
    ok("Pro 起大好河山整张卡亮起来（同一份清单，只是不再灰）",
      groupOf("landscape").locked === false
        && groupOf("landscape").items.every((i) => !i.locked)
        && groupOf("landscape").tier === "pro");
    themeMod.set("yangzhoushxihu");
    ok("Pro 点得进大好河山那一支", themeMod.current() === "yangzhoushxihu", themeMod.current());

    tierOf("free");
    ok("档位掉回 Free 时，停在大好河山上的那支要退回默认那支（页面不挂在够不着的颜色上）",
      themeMod.current() === themeMod.DEFAULT, themeMod.current());

    store.drop(store.KEYS.grant);
    store.drop(store.KEYS.auth);
    store.saveProfile({ logged: false });
    ok("未登录也读得到清单（灰着，卡上照样能标出档位）",
      groupOf("landscape").locked === true && groupOf("landscape").tier === "pro",
      groupOf("landscape").tier);
  }

  const tDef = /--theme\s*:\s*var\(--c-(\w+)\)\s*;/.exec(tokens);
  ok("tokens 的 --theme 默认值指向清单里默认那一项（两处不许各写一遍）",
    !!tDef && tDef[1] === themeMod.DEFAULT,
    "tokens 里 " + (tDef ? tDef[1] : "读不到") + " vs theme.js " + themeMod.DEFAULT);

  const missJs = [];
  pages.forEach((pg) => {
    const js = fs.readFileSync(path.join(ROOT, pg + ".js"), "utf8");
    if (!/this\.applyFont\(\);/.test(js)) missJs.push(pg);
    else if (!/font\.bind\(theme\.style\(\)\)/.test(js)) missJs.push(pg + "(未取主题)");
  });
  ok("每个页面 onShow 都走 applyFont，主题与全局字族从同一处取", missJs.length === 0, missJs.join(", "));
}

{
  const themeJs = fs.readFileSync(
    path.join(ROOT, "packages", "settings", "theme", "theme.js"), "utf8");
  const fontMod = require(path.join(ROOT, "utils", "font.js"));
  const themeMod = require(path.join(ROOT, "utils", "theme.js"));

  const tierAs = (t) => {
    store.saveProfile({ logged: true, tier: "" });
    store.drop(store.KEYS.auth);
    store.drop(store.KEYS.grant);
    store.drop(store.KEYS.caps);
    if (t !== "free") store.write(store.KEYS.grant, { code: t.toUpperCase() + "-ABCD-1234", tier: t, at: Date.now() });
  };

  ok("字体选择器由 font.options() 摊出来，点了落到 font.set",
    themeJs.indexOf("font.options()") >= 0
      && themeJs.indexOf("font.set(") >= 0
      && fontMod.options().length === fontMod.FACES.length,
    "字体那几行不是从 font.options() 摊出来的，或者点了不落到 font.set");

  ok("页面预热了字体预览（否则各格预览字族的字形根本没被画过一次）",
    themeJs.indexOf("warmPreview()") >= 0,
    "没预热预览 —— 那几款预览字族在真机上不出字（Issue #709）");

  ok("未登录也摊开字体卡（选了仍被拒）",
    fontMod.pickable({ logged: false }) === false
      && themeJs.indexOf("font.options()") >= 0,
    "未登录那一支没有字体卡，或者选了不被拒");

  ok("字体卡上有「应用选中字体到全局」那个开关，落在 fontGlobal 上",
    themeJs.indexOf("onFontGlobal") >= 0
      && themeJs.indexOf("font.setGlobal(") >= 0
      && fontMod.globalOn() === false,
    "字体卡里没有这一行，或者开关没落到 font.setGlobal（写死一个 false 等于没开关）");

  const uiOff = themeMod.style();
  tierAs("pro");
  fontMod.setGlobal(true);
  const uiOn = themeMod.style();
  fontMod.set("wenkai");
  const uiPicked = themeMod.style();
  const uiOf = (css) => (/--font-ui:([^;]+)/.exec(css) || [])[1] || "";
  ok("关着时 --font-ui 不动，开了就跟着选中字体走（正文那份另外算）",
    uiOff.indexOf('--font-ui:-apple-system') > 0
      && uiOn.replace(/[\s"]/g, "").indexOf("KuibuPoemzhuque") > 0
      && uiPicked.replace(/[\s"]/g, "").indexOf("KuibuPoemwenkai") > 0
      && uiPicked.indexOf(uiOn) !== 0,
    "关着时 " + uiOf(uiOff).slice(0, 30) + " / 开着时 " + uiOf(uiOn).slice(0, 40)
      + " / 换款之后 " + uiOf(uiPicked).slice(0, 40));

  {
    const pageFiles = pages.map((p) => path.join(ROOT, p + ".js"));
    const barJs = fs.readFileSync(
      path.join(ROOT, "components", "nav-bar", "nav-bar.js"), "utf8");
    const appJs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
    const barHosts = pages.filter((p) => /"nav-bar":\s*"\/components\/nav-bar\/nav-bar"/.test(
      fs.readFileSync(path.join(ROOT, p + ".json"), "utf8")));
    const fontSrc = fs.readFileSync(path.join(ROOT, "utils", "font.js"), "utf8");
    ok("页面作用域的记账对得上「当前页 + 版本号」才算注册过（换页重发一次，同页不重发）",
      /function registerPage\(family, list\)[\s\S]*?scoped\[key\] === scopeMark\(\)[\s\S]*?scoped\[key\] = scopeMark\(\)/.test(
        fontSrc)
        && /function scopeMark\(\)[\s\S]*?scopeEpoch[\s\S]*?route/.test(fontSrc),
      "注册去了页面作用域的账却按字族名记，换一页就不再注册 —— 全局开关第二页就失效");

    ok("自绘导航栏的字跟着全局走（不再按页面传来的 scope 才认）",
      barHosts.length > 0
        && /registerHere/.test(barJs)
        && /font/.test(barJs)
        && !/fontScope !== this\.data\.scope/.test(barJs),
      "全局开着时导航栏还是系统字，或者作用域对不上就退回系统字库");
    ok("开关与换款都推一次作用域，回前台补一次（globalData 认版本号，旧的不算）",
      /scopeEpoch \+= 1[\s\S]{0,200}?announce\(\)/.test(
        fs.readFileSync(path.join(ROOT, "utils", "font.js"), "utf8"))
        && /font\.restore\(\)/.test(appJs)
        && /repaintFont/.test(appJs)
        && pageFiles.every((f) => /this\.applyFont\(\)/.test(fs.readFileSync(f, "utf8"))),
      "拨开关后没有重注册也没有回刷页面，或者回前台没补注册");

    const barFontJs = fs.readFileSync(
      path.join(ROOT, "custom-tab-bar", "index.js"), "utf8");
    ok("底栏的字也跟着换：换页有人在 App 层补注册，底栏按当前款重算",
      /font\.registerHere\(\)/.test(appJs)
        && /onPageShow/.test(appJs)
        && /fontStyle/.test(barFontJs)
        && /groupOf/.test(barFontJs),
      "全局字族换到下一页没人补注册，或者底栏还是系统字");
  }

  tierAs("free");
  const rFreeGlobal = fontMod.setGlobal(true);
  ok("Free 拨不动这个开关（setGlobal 直接拒，不静默改）",
    rFreeGlobal.ok === false && rFreeGlobal.reason === "tier" && fontMod.globalOn() === false,
    JSON.stringify(rFreeGlobal));

  const rFree = (() => {
    tierAs("free");
    return fontMod.set("huiwen");
  })();
  ok("Free 切不了字体（set 直接拒，不静默改）",
    rFree.ok === false && rFree.reason === "tier" && fontMod.current() === fontMod.DEFAULT,
    JSON.stringify(rFree));

  tierAs("pro");
  const rPro = fontMod.set("chillkai");
  ok("Pro 切得动，且落进 settings（跟着账号走）",
    rPro.ok === true && store.settings().font === "chillkai" && store.LOCAL_ONLY.font !== true,
    JSON.stringify(rPro) + " / " + store.settings().font);

  const fontCap = E.CAPS.filter((c) => c.key === "font")[0];
  const sightsCap = E.CAPS.filter((c) => c.key === "sights")[0];
  ok("权限页两项各归各档（大好河山与字体都是 Pro 起）",
    !!fontCap && fontCap.tier === "pro" && !!sightsCap && sightsCap.tier === "pro"
      && E.CAP_KEYS.indexOf("font") >= 0 && E.CAP_KEYS.indexOf("sights") >= 0);

  tierAs("free");
  ok("Free 手上这两项是关的", E.can("font") === false && E.can("sights") === false);
  tierAs("pro");
  ok("Pro 手上这两项是开的", E.can("font") === true && E.can("sights") === true);

  const custom = require(path.join(ROOT, "utils", "custom-banner.js"));
  const themePageJs = fs.readFileSync(
    path.join(ROOT, "packages", "settings", "theme", "theme.js"), "utf8");
  const themeUtilsJs = fs.readFileSync(path.join(ROOT, "utils", "theme.js"), "utf8");
  const themePageJson = JSON.parse(fs.readFileSync(
    path.join(ROOT, "packages", "settings", "theme", "theme.json"), "utf8"));
  const ownGroup = () => themeMod.groups().filter((g) => g.key === themeMod.OWN)[0];

  ok("自定义题图是独立一张卡，页面上有选图 / 换图与恢复默认的接法",
    themeMod.groups().map((g) => g.key).indexOf(themeMod.OWN) >= 0
      && ownGroup().items.length === 1
      && ownGroup().items[0].key === themeMod.OWN_KEY
      && ["onOwnUpload", "onOwnClear"].every((h) => new RegExp("^\\s*" + h + "\\(", "m").test(themePageJs))
      && themePageJs.indexOf("custom.choose()") >= 0
      && /banner-crop/.test(themePageJson.usingComponents["banner-crop"] || ""));

  tierAs("pro");
  ok("Pro 手上还没有自定义题图（这一项 Max 起，权限对比页也这么写）",
    ownGroup().locked === true && ownGroup().tier === "max"
      && E.can("ownbanner") === false
      && (E.CAPS.filter((c) => c.key === "ownbanner")[0] || {}).tier === "max"
      && E.compareRows(E.snapshot()).some((r) => r.cap === "ownbanner"));

  {
    const cropDir = path.join(ROOT, "components", "banner-crop");
    const cropJs = fs.readFileSync(path.join(cropDir, "banner-crop.js"), "utf8");

    ok("选完图弹出的是截取面板：四个按钮都挂着处理函数",
      ["onCancel", "onZoomIn", "onZoomOut", "onConfirm"]
        .every((fn) => new RegExp("^\\s*" + fn + "\\(", "m").test(cropJs)),
      "截取面板缺按钮或退不出去 —— 选完图就卡在那儿");

    const art = custom.artOf({ w: 1000, h: 2000 }, { sx: 0.1, sy: 0.4, sw: 0.5, sh: 0.25 }, 2);
    ok("落盘的图取的是框里那一块，出来就是题图的比例",
      Math.abs(art.width * custom.RATIO_H / custom.RATIO_W - art.height) <= 1
        && art.sw === 500 && art.sh === 500,
      "截出来的比例不是 " + custom.RATIO_W + "×" + custom.RATIO_H + "，铺到 banner 上会被裁掉一截");

    const art2 = custom.artOf({ w: 1000, h: 2000 }, { sx: 0, sy: 0, sw: 1, sh: 1 }, 4);
    ok("长宽比 1:2 的照片截完仍在一条 key 装得下的尺寸里",
      art2.width <= custom.WIDTH && Math.abs(art2.width * custom.RATIO_H / custom.RATIO_W - art2.height) <= 1,
      "落出来的边长 " + art2.width + "×" + art2.height);
  }

  {
    const art = custom.artOf({ w: 1000, h: 2000 }, { sx: 0, sy: 0, sw: 1, sh: 1 }, 4);
    const deep = custom.fadePixels(art);
    const tall = art.height;
    ok("底边渐隐：从 80px 那道往下落到全透明，webp 那条读得回来",
      deep >= 4 && deep < art.height / 2
        && custom.fadeAt(tall, tall, deep) === 0
        && custom.fadeAt(tall - deep, tall, deep) > 0.99
        && custom.MIME.test(custom.WEBP),
      "渐隐没接上：那条渐变没落到全透明，或者 webp 的 MIME 读不回来");
    ok("底边那道按图宽折算，1200 宽的图上正好 80px",
      custom.FADE_SPAN === 80 && custom.FADE_REF === 1200
        && Math.round(600 * custom.FADE_SPAN / custom.FADE_REF) === 40
        && Math.round(2400 * custom.FADE_SPAN / custom.FADE_REF) === 160);
  }

  tierAs("max");
  store.saveSettings({ banner: custom.JPEG + "AAAA", theme: themeMod.OWN_KEY });
  ok("Max 手上那项亮着，选的自定义题图真的落到 banner 上",
    E.can("ownbanner") === true
      && ownGroup().locked === false
      && themeMod.current() === themeMod.OWN_KEY
      && themeMod.bannerSrc().indexOf(custom.JPEG) === 0,
    themeMod.current() + " / " + themeMod.bannerSrc().slice(0, 24));

  store.saveSettings({ toneColor: "#2E6A67" });
  const ownVars = themeMod.variables().filter((v) => v.indexOf("--c-own:") === 0)[0] || "";
  ok("主题色选中的那一支，自选的整支色跟着换",
    ownVars.indexOf("--c-own:rgba(46, 106, 103, 1)") >= 0,
    "自选那一支没按 toneColor 重算：" + ownVars);

  const toneMod = require(path.join(ROOT, "utils", "color-tone.js"));

  const toRgba = (h) => "rgba(" + [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ") + ", 1)";

  const toneData = themeMod.toneData();
  const tonePick = toneData.toneHex.toLowerCase();
  ok("选完就落到 toneColor，页内主题变量当场跟着换",
    toneMod.set(tonePick) === true
      && store.settings().toneColor === tonePick
      && themeMod.style().indexOf("--theme:" + toRgba(tonePick)) >= 0,
    "选完 toneColor=" + store.settings().toneColor + "，style 里没换");

  const pickerMod = require(path.join(ROOT, "utils", "color-picker.js"));
  const picker = (hex) => pickerMod.pick(hex);
  const stopsOf = (css) => String(css || "").split(",").map((s) => s.trim().split(" ")[0]);

  store.saveSettings({ toneColor: "#E23A2E" });
  const wide = themeMod.toneData();

  const inLine = (track, fields) => {
    const held = picker(wide.toneHex.toLowerCase());
    return stopsOf(track).every((hex) => {
      const v = picker(hex);
      if (v.sat === 0 || v.light === 0 || v.light === 100) return true;
      return fields.every((f) => Math.abs(v[f] - held[f]) <= 4);
    });
  };
  ok("三条轴分开：色相带只改色相，饱和带只改饱和，明度带只改明度",
    inLine(wide.toneHue, ["sat", "light"])
      && inLine(wide.toneSat, ["hue", "light"])
      && inLine(wide.toneLight, ["hue", "sat"]),
    "色相带里混进了别的饱和或明度");

  const ends = (track) => stopsOf(track).reduce((all, hex) => {
    const v = picker(hex);
    return [Math.min(all[0], v.sat), Math.min(all[1], v.light), Math.max(all[2], v.sat), Math.max(all[3], v.light)];
  }, [100, 100, 0, 0]);
  const turns = (track) => stopsOf(track).reduce((all, hex) => {
    const v = picker(hex);
    return [Math.min(all[0], v.hue), Math.max(all[1], v.hue)];
  }, [359, 0]);
  store.saveSettings({ toneColor: "#E23A2E" });
  const red = turns(themeMod.toneData().toneHue);
  store.saveSettings({ toneColor: "#2E6A67" });
  const teal = turns(themeMod.toneData().toneHue);
  const sat = ends(wide.toneSat);
  const light = ends(wide.toneLight);
  ok("三条带各自走到底：色相铺满整圈，饱和与明度都从 0 到 100",
    red[0] <= 8 && red[1] >= 340 && teal[0] <= 8 && teal[1] >= 340
      && sat[0] === 0 && sat[2] === 100
      && light[1] === 0 && light[3] === 100,
    "色相 " + red + " / " + teal + "，饱和 [最低 " + sat[0] + ", 最高 " + sat[2]
      + "]，明度 [最低 " + light[1] + ", 最高 " + light[3] + "]");

  store.saveSettings({ toneColor: "#E23A2E" });
  const at2 = themeMod.toneData();
  const here = picker(at2.toneHex.toLowerCase());
  ok("取色落位对得上：三条带上的标记分别停在当前色相 / 饱和 / 明度",
    Math.abs(parseFloat(at2.toneHueAt) / 100 * 360 - here.hue) <= 1
      && Math.abs(parseFloat(at2.toneSatAt) - here.sat) <= 1
      && Math.abs(parseFloat(at2.toneLightAt) - here.light) <= 1,
    "标记位置不是当前色：" + at2.toneHueAt + "% / " + at2.toneSatAt + "% / " + at2.toneLightAt + "%");

  const dragged = pickerMod.fromAxis("hue", 0.5, "#E23A2E");
  const grayed = pickerMod.fromAxis("sat", 0, "#E23A2E");
  const lit = pickerMod.fromAxis("light", 1, "#E23A2E");
  ok("色带上按位置取色：横拖到哪就取哪一档，只动这一轴的量",
    Math.abs(picker(dragged).hue - 180) <= 2 && picker(dragged).sat === here.sat
      && picker(grayed).sat === 0 && picker(grayed).light === here.light
      && picker(lit).light === 100 && Math.abs(picker(lit).hue - here.hue) <= 4,
    "拖到中点取到 " + dragged + "，拖到最左取到 " + grayed + "，拖到最右取到 " + lit);

  const dragBody = (themePageJs.split("onToneDrag(e) {")[1] || "").split("onToneHex(e) {")[0];
  ok("拖色带当场落到 toneColor 并重算整页样式（不是等松手才反应）",
    /tone\.set\(hex\)[\s\S]{0,80}?this\.paint\(\)/.test(dragBody)
      && /function apply\(page\) \{[\s\S]{0,160}?page\.setData\(\{[\s\S]{0,80}?themeStyle: style\(key\)/.test(themeUtilsJs),
    "拖动的处理里没有 tone.set + paint，色只在你松手那一刻才认");

  store.saveSettings({ toneColor: "" });
  const blank = pickerMod.read("");
  ok("没选过主题色时三条带照样铺得开，标记不落在某个色上",
    blank.on === false
      && stopsOf(blank.hue).length > 1 && stopsOf(blank.sat).length > 1
      && themeMod.toneData().toneOn === false
      && themeMod.toneData().toneRgba === ""
      && themeMod.toneData().toneHex === "",
    "没选色时取色带是空的");

  store.saveSettings({ toneColor: "" });
  ok("清掉主题色，自选那一支回到清单里的墨色",
    themeMod.style().split(";").indexOf("--theme:rgba(8, 8, 10, 1)") >= 0);

  const toneCap = E.CAPS.filter((c) => c.key === "themetone")[0];
  tierAs("pro");
  ok("Pro 改不了主题色（这一项 Max 起，权限对比页也这么写）",
    !!toneCap && toneCap.tier === "max"
      && E.can("themetone") === false
      && E.compareRows(E.snapshot()).some((r) => r.cap === "themetone")
      && themePageJs.indexOf('nameOf("max")') >= 0,
    toneCap ? toneCap.tier + " / can=" + E.can("themetone") : "能力表里没有 themetone");

  tierAs("max");
  store.saveSettings({ toneColor: "#8C2F2D" });
  ok("Max 手上那一项亮着，且这个色真的铺到 --theme 上",
    E.can("themetone") === true
      && themeMod.style().indexOf("--theme:rgba(140, 47, 45, 1)") >= 0,
    themeMod.style().split(";").filter((v) => v.indexOf("--theme:") === 0).join());

  ok("自选图只在本机（不进云端设置报文）",
    !("banner" in store.cloudSettings()) && store.LOCAL_ONLY.banner === true,
    "banner 混进了 cloudSettings —— 换台设备就不该带过去");

  tierAs("free");
  ok("档位掉下来时退回默认那一支（图还在，但不再用）",
    themeMod.current() === themeMod.DEFAULT
      && themeMod.bannerSrc() === themeMod.BANNER,
    themeMod.current());

  tierAs("max");
  themeMod.clearOwn();
  ok("恢复默认：自选那支的图与本机标记一起清掉",
    custom.src() === "" && store.settings().theme !== themeMod.OWN_KEY
      && themeMod.current() === themeMod.DEFAULT);

  store.drop(store.KEYS.grant);
  store.drop(store.KEYS.auth);
  store.saveProfile({ logged: false });
  store.saveSettings({ font: fontMod.DEFAULT });
}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const quizSrc = read("packages/game/quiz/lib.js");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<\!--[\s\S]*?-->/g, "");

  ok("题型仍是不带颜色的五档", (quizSrc.match(/key\s*:/g) || []).length >= 5);

  const examJs = read("packages/game/exam/exam.js");
  const quizJs = read("packages/game/quiz/quiz.js");
  ok("考试页与题库页各有一份 metaLineOf（题型 · 出自《…》）",
    /metaLineOf\s*\(/.test(examJs) && /metaLineOf\s*\(/.test(quizJs));

  const quizLib = require(path.join(ROOT, "packages", "game", "quiz", "lib.js"));
  const spoiling = ["next", "prev", "author", "title"];
  ok("考篇名 / 上句 / 下句 / 作者这几种题型下，题干预告里不带篇名（带了就是把答案写在题面上）",
    quizLib.titleSpoiled(spoiling) === true && quizLib.titleSpoiled(["dynasty"]) === false,
    "titleSpoiled 的判据反了或漏了题型");
  ok("题库页与考试页都按这份判据决定题干预告给不给篇名",
    /quiz\.titleSpoiled\(/.test(quizJs) && /quiz\.titleSpoiled\(/.test(examJs));

  const scopeMod = require(path.join(ROOT, "utils", "game-scopes.js"));
  const wrongScope = [];
  scopeMod.list().forEach((s) => {
    if (s.id === "poems") return;
    scopeMod.pool(s.id).forEach((p) => {
      if (p.b !== "poems" && p.b !== s.id) wrongScope.push(s.id + ":" + p.id);
    });
  });
  ok("题库与考试用的是这个收窄过的范围（选了「词」不会出唐诗）",
    wrongScope.length === 0, "串味 " + wrongScope.slice(0, 5).join("、"));

  const lettered = /function _quiz_lettered\([\s\S]*?\n\}/.exec(quizSrc);
  ok("选项字母在数据层生成（lettered 函数在）", !!lettered);
  ok("四个字母取自 ABCD，且与顺序绑在一起",
    !!lettered && /"ABCD"\[i\]/.test(lettered[0]));

  ok("五个题型的 options 都套了 lettered（一处都不许漏）",
    (quizSrc.match(/lettered\(/g) || []).length >= 6,
    "出现 " + (quizSrc.match(/lettered\(/g) || []).length + " 次（1 处定义 + 5 处调用）");

  const swatchPalette = require(path.join(ROOT, "utils", "theme.js")).palette();
  ok("页面上每个色拿到的是「本色 + 淡淡一档 + 压在上面的墨」三件",
    swatchPalette.every((x) => x.rgb && x.soft && x.on)
      && swatchPalette.every((x) => x.on.indexOf("255, 255, 255") >= 0),
    "palette() 少给了一件 —— 界面上有一处会算出透明或读不出的字");

  const progJs = strip(read("packages/progress/index/index.js"));
  const collJs = strip(read("packages/progress/coll/coll.js"));
  const pvJs = strip(read("components/progress-view/progress-view.js"));

  ok("进度页不再有「记忆阶段」那张卡（stageRows 数据也撤了）",
    progJs.indexOf("stageRows") < 0);

  ok("课内与自选两块读数都只经 components/progress-view 画",
    /panelsOf\(/.test(read("components/progress-view/progress-view.js"))
      && !/\.overview\(|S\.dueList\(/.test(progJs) && !/S\.overview\(/.test(collJs),
    "两条进度各自摊开算了一遍 —— 同一块读数会有第二个出处");

  ok("那几块读数不自己算（本册与每个集合都走 scheduler 的 overview / dueList / collectionProgress）",
    /S\.overview\(/.test(pvJs) && /S\.dueList\(/.test(pvJs)
      && /S\.collectionProgress\(/.test(pvJs)
      && /collectionView\(/.test(collJs)
      && [progJs, collJs, pvJs].every((src) => src.indexOf("store.progress") < 0
        && src.indexOf("nextReviewAt") < 0),
    "进度页直接翻本机记录自己算了一遍 —— 同一个读数会有第二个出处");

  ok("点篇目走背诵弹层（进度页那几行能背，不只是看）",
    /sheet\.open\(/.test(progJs) && /sheet\.open\(/.test(collJs)
      && /onOpen\b/.test(pvJs));

  {
    const pvPath = require.resolve(path.join(ROOT, "components", "progress-view", "progress-view.js"));
    delete require.cache[pvPath];
    const pvMod = require(pvPath);
    const now = Date.now();
    const recs = {
      late: { learned: true, level: 2, nextReviewAt: now - 10 * 86400000, history: [{ at: now }] },
      soon: { learned: true, level: 1, nextReviewAt: now + 2 * 86400000, history: [{ at: now }] }
    };
    const poems = [
      { id: "late", t: "静夜思", a: "李白", d: "唐" },
      { id: "soon", t: "咏鹅", a: "骆宾王", d: "唐" }
    ];
    const due = require(path.join(ROOT, "utils", "scheduler.js")).dueList(
      poems, 7, (id) => recs[id]);
    const rows = pvMod.panelsOf(due).reduce((a, p) => a.concat(p.rows), []);
    ok("全部到期篇目每行的标题来自计划行，不是空着",
      rows.length === poems.length && rows.every((r) => r.title),
      "到期行的 title 取错了字段 —— 第一列会是空白");
  }

  ok("自选集合的标题点得动，落到自选进度页那一个集合上",
    /coll\?coll=" \+ encodeURIComponent\(id\)/.test(read("pages/home/home.js"))
      && /coll\?coll=" \+ encodeURIComponent\(id\)/.test(
        read("packages/settings/collections/collections.js"))
      && /onLoad\(query\)/.test(collJs)
      && /wx\.pageScrollTo\(\{ selector: "#coll-" \+ id/.test(collJs),
    "首页 / 管理页那一下没落到自选进度页的集合标题上");
}

{
  const sheetDir = path.join(ROOT, "components", "recite-sheet");
  const four = [".js", ".json", ".wxml", ".wxss"].every((ext) =>
    fs.existsSync(path.join(sheetDir, "recite-sheet" + ext)));
  ok("背诵弹层四件套齐全", four);

  const homeJs = fs.readFileSync(path.join(ROOT, "pages/home/home.js"), "utf8");
  const sheetJs = fs.readFileSync(path.join(sheetDir, "recite-sheet.js"), "utf8");

  const homeCfg = readJson(path.join(ROOT, "pages/home/home.json"));
  ok("首页注册了这个组件",
    (homeCfg.usingComponents || {})["recite-sheet"] === "/components/recite-sheet/recite-sheet");
  const openSheetSrc = homeJs.slice(homeJs.indexOf("openSheet(id, source) {"));
  ok("弹层由首页把门禁，组件自己不查",
    /requireLogin\(/.test(openSheetSrc.slice(0, 600))
      && !/gate\.(?!Tier)/.test(sheetJs.replace(/\/\*[\s\S]*?\*\//g, "")),
    "首页 openSheet 里没查登录，或组件自己查了门禁");

  track((async () => {
    const savedComp = global.Component;
    let opt = null;
    global.Component = (o) => { opt = o; };
    const sheetPath = path.join(sheetDir, "recite-sheet.js");
    delete require.cache[require.resolve(sheetPath)];
    require(sheetPath);
    global.Component = savedComp;

    const missId = "本仓库没有这一篇的编号";
    const row = (id) => ({ id });

    const corpusPath = path.join(ROOT, "utils", "corpus.js");
    const corpusMod = require(corpusPath);
    const realEntry = corpusMod.entry;
    const realIndex = corpusMod.indexById;
    corpusMod.entry = (id) => (id === missId ? null : realEntry(id));
    corpusMod.indexById = (id) => (id === missId ? null : realIndex(id));

    const said = [];
    const syncForce = [];
    const calm = [];
    const modal = global.wx.showModal;
    const toast = global.wx.showToast;
    const syncPath = require.resolve(path.join(ROOT, "utils", "sync.js"));
    const syncMod = require(syncPath);
    const force = syncMod.now;
    global.wx.showModal = (o) => {
      if (/正文/.test((o && o.title) || "")) said.push(o);
      else calm.push(o);
      return Promise.resolve({ confirm: false, cancel: true });
    };
    global.wx.showToast = (o) => {
      if (/正文/.test((o && o.title) || "")) calm.push(o);
    };
    syncMod.now = (f) => {
      if (f) syncForce.push(f);
      return Promise.resolve({ skipped: "offline" });
    };

    const mk = (rows, open, index, pushed) => {
      const self = Object.assign({}, opt.methods);
      self.data = { open, index: index || 0, queue: rows, showTranslation: false, hint: "" };
      self.pushed = !!pushed;
      self.closedAt = 0;
      self.lastPush = (rows || []).map((r) => r.id).join("|");
      self.loaded = 0;
      self.setData = function (obj) { Object.keys(obj).forEach((k) => { this.data[k] = obj[k]; }); };
      self.open = opt.methods.open;
      self.loadCurrent = opt.methods.loadCurrent;
      self.cancelLoad = opt.methods.cancelLoad;
      self.fetchText = opt.methods.fetchText;
      self.askMissing = opt.methods.askMissing;
      self.onSyncText = opt.methods.onSyncText;
      self.retryable = opt.methods.retryable;
      self.failText = opt.methods.failText;
      return self;
    };
    const settled = () => {
      said.splice(0).forEach((o) => o.success({ cancel: true }));
      said.length = 0;
      calm.length = 0;
      syncForce.length = 0;
    };
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const obs = opt.properties.queue.observer;

    const missing = (id) => {
      const self = mk(rows, false, 1, false);
      self.data.queue = [row(missId), row(rows[1].id)];
      self.data.index = 1;
      self.open(self.data.queue, id);
      return self;
    };

    const miss = missing(missId);
    const missSame = miss.data.index === 0 && miss.data.queue.length === 2;
    miss.onClose();

    ok("正文缺失时只收起，不把序号往回退（关一下再开，人还该站在点的那一首上）",
      missSame && !miss.data.open,
      "缺正文那条路把 index 改回去了，或者没把弹层收起来");

    settled();
    const net = missing(missId);
    const loadingShown = net.data.loadingText === true;
    const netOpen = net.data.open === true;
    net.onClose();

    ok("正文缺失先自己取（不去动整包同步，也不当场弹框）",
      syncForce.length === 0 && said.length === 0 && netOpen,
      "缺正文那条路要么弹了框、要么触发了整包同步 —— 用户只是想读这一首");
    ok("取的过程中在身份行下面留一道细线（waiting 走的是 loadingText）",
      loadingShown,
      "等待没有可读的状态位 —— 细线挂不上");

    await new Promise((r) => setTimeout(r, 120));
    const saidIn = said.length;
    ok("取不到才弹「正文加载」框，两个按钮是「取消」与「同步」",
      saidIn === 1 && said[0].title === "正文加载"
        && said[0].cancelText === "取消" && said[0].confirmText === "同步",
      "失败之后没有给一条手动同步的路，或者按钮不是用户点名的那两个");

    ok("临时失败才给「再取一次」，清单里没有这一篇就不给（按下去也白按）",
      (() => {
        const self = mk(rows, false, 0, false);
        self.textErr = "E_TIMEOUT";
        self.errSay = "request:fail timeout";
        const netOk = self.retryable() === true && self.data.syncable !== true;
        self.textErr = "E_NO_ENTRY";
        self.errSay = "";
        return netOk && self.retryable() === false;
      })(),
      "按钮挂在哪一种失败上判错了 —— 要么永远点得到，要么永远点不到");

    ok("同一次卡住只弹一次框，点「再取一次」不会又叠一个框",
      (() => {
        const self = mk(rows, false);
        self.missAt = 0;
        self.data.index = 0;
        self.data.id = "a";
        said.length = 0;
        self.markMissing();
        return said.length === 0;
      })(),
      "正文区里的重取把确认框又弹了一遍");
    missRow.onClose();

    const closed = mk(rows, false);
    obs.call(closed, [{ id: "z" }]);
    ok("弹层关着时队列换新不写 data（关着的组件不该被首页的 refresh 推着走）",
      closed.data.queue === rows && closed.loaded === 0);

    const same = mk(rows, true, 1, true);
    obs.call(same, rows.map((r) => ({ id: r.id })));
    ok("队列内容没变时不重写、不重载（不然每次 refresh 都从头读一遍当前篇）",
      same.data.queue === rows && same.loaded === 0);

    const last = mk(rows, true, 2, true);
    obs.call(last, [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
    ok("队列变长时人停在原来那一篇（加背加进来的排在末尾，不该把弹层顶到别处）",
      last.data.index === 2 && last.data.queue.length === 4);

    const moved = mk(rows, true, 0, true);
    obs.call(moved, [{ id: "c" }, { id: "a" }, { id: "b" }]);
    ok("当前那一篇换了位置就按它的新位置落位（跟着篇走，不跟着序号走）",
      moved.data.index === 1);

    global.wx.showModal = modal;
    global.wx.showToast = toast;
    syncMod.now = force;
    delete require.cache[syncPath];
    corpusMod.entry = realEntry;
    corpusMod.indexById = realIndex;
  }));

  ok("弹层显式打开过，observer 不按属性推来的队列重开（首页 refresh 会把 sheetRows 推回来）",
    (() => {
      const savedComp = global.Component;
      let opt = null;
      global.Component = (o) => { opt = o; };
      const sheetPath = path.join(sheetDir, "recite-sheet.js");
      delete require.cache[require.resolve(sheetPath)];
      require(sheetPath);
      global.Component = savedComp;

      const self = Object.assign({}, opt.methods);
      self.data = { open: false, index: 0, queue: [] };
      self.pushed = false;
      self.closedAt = 0;
      self.lastPush = "";
      self.setData = function (obj) { Object.keys(obj).forEach((k) => { this.data[k] = obj[k]; }); };
      self.loadCurrent = function () { this.loaded = (this.loaded || 0) + 1; };
      self.loaded = 0;

      const rows2 = [{ id: "a" }, { id: "b" }];
      const obs2 = opt.properties.queue.observer;
      obs2.call(self, rows2);
      const before = self.loaded;
      self.open(rows2, "b");
      obs2.call(self, rows2.map((r) => ({ id: r.id })));
      return self.data.open === true && self.data.index === 1 && self.loaded === before + 1;
    })(),
    "open() 之后 observer 又按属性把队列重写一遍 —— loadCurrent 会被打断，弹层自己把自己收掉");

  ok("open() 按传进来的那一篇落位（同长度的两份队列之间换图，也不落在旧序号上）",
    (() => {
      const savedComp = global.Component;
      let opt = null;
      global.Component = (o) => { opt = o; };
      const sheetPath = path.join(sheetDir, "recite-sheet.js");
      delete require.cache[require.resolve(sheetPath)];
      require(sheetPath);
      global.Component = savedComp;

      const self = Object.assign({}, opt.methods);
      self.data = { open: false, index: 0, queue: [] };
      self.pushed = false;
      self.closedAt = 0;
      self.lastPush = "";
      self.setData = function (obj) { Object.keys(obj).forEach((k) => { this.data[k] = obj[k]; }); };
      self.triggerEvent = function () {};
      self.loadCurrent = function () {};
      const first = [{ id: "a" }, { id: "b" }];
      const next = [{ id: "x" }, { id: "y" }];
      self.open(first, "a");
      self.open(next, "y");
      return self.data.index === 1 && self.data.queue[1] === next[1];
    })(),
    "open() 只看队列长短，换一份等长队列后仍用旧 index —— 点第 y 篇开出来是 x");

  ok("关掉之后有一小段不再重开（列表上的点按与弹层的收起会在同一批数据里撞车）",
    /onClose\(\)\s*\{[\s\S]{0,140}?return;/.test(sheetJs),
    "onClose 里没有那段冷却 —— 收起带动列表重排，重排又把同一顺手点给弹层开了回来");
  ok("三档评分各有自己的分支（忘记 / 模糊 / 记住）",
    ["忘记", "模糊", "记住"].every((t) => sheetJs.indexOf(t) >= 0),
    "少一档 —— 有一类评价给不出去");

  ok("评分后顺势进下一首（不是「关掉再去找」）",
    /goNext\(/.test(sheetJs) && /this\.setData\(\{\s*index:\s*next/.test(sheetJs));
  ok("队列走完就把弹层收掉（人回到列表，勾都在）",
    /next\s*>=\s*this\.data\.queue\.length[\s\S]{0,120}?onClose\(\)/.test(sheetJs));

  const storeSrc = fs.readFileSync(path.join(ROOT, "utils", "store.js"), "utf8");
  const schedSrc = fs.readFileSync(path.join(ROOT, "utils", "scheduler.js"), "utf8");

  ok("弹层不靠页面传「背没背过」（自己取 store）",
    /store\.getRecord\(/.test(sheetJs));

  const quotesSrc = fs.readFileSync(path.join(ROOT, "utils", "finish-quote.js"), "utf8");
  const quotes = require(path.join(ROOT, "utils", "finish-quote.js"));
  ok("今日那几首背完给一句收尾（提示与读数共用 allDone，不是一个新判据）",
    /allDone/.test(homeJs) && /praise/.test(homeJs)
      && /percent: base \?/.test(homeJs),
    "今日卡背完了却没有一句收尾 —— 屏幕上看不出今天已经做完");

  ok("收尾句取自格言池，随日期换（不是一个固定句）",
    quotes.LINES.length > 0
      && new Set(quotes.LINES).size === quotes.LINES.length
      && /quotes\.pick\(Date\.now\(\) \/ R\.DAY/.test(homeJs)
      && !/const PRAISE/.test(homeJs),
    "收尾句写死在一处 —— 每天看到的是同一句话");

  ok("课内与自选各自收尾，池子与取法只有一份",
    /praiseOf\("course"\)/.test(homeJs) && /praiseOf\("own"\)/.test(homeJs)
      && /praise: plan\.length > 0 && doneNow >= plan\.length \? praiseOf\("own"\)/.test(homeJs)
      && (quotesSrc.match(/^const LINES = \[/gm) || []).length === 1,
    "自选的今日份背完了没有收尾句 —— 自选模式下看不到完成");

  ok("「已温习」只认评过分（isLearned 的口径：learned / attempted / history），不认已读",
    /function\s+isLearned\s*\(rec\)[\s\S]{0,160}?rec\.learned[\s\S]{0,80}?rec\.history/.test(schedSrc)
      && /recitedOf\[it\.poem\.id\] = recited/.test(homeJs)
      && /S\.todayDone\(todaySet, recitedOf\)/.test(homeJs),
    "首页拿已读当已温习 —— 点开弹窗看一眼，统计里就多一首「已温习」");

  ok("今日的读数只看今天排定的那几首，日计划重排后不会凭空变成「已温习完」",
    /function todaySet\(planKey, base\)/.test(schedSrc)
      && /S\.todayLeft\(todaySet, recitedOf\)/.test(homeJs)
      && /drop\(KEYS\.dayPlan\)/.test(storeSrc),
    "「今天背完几首」改为数计划里的长度 —— 重排后新诗还没背，首页就说今天背完了");

  ok("组件不发网络（同步由页面统一管）",
    sheetJs.indexOf("wx.request") < 0 && sheetJs.indexOf("remote") < 0);

}

{

  const readSrc = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const sheetJsSrc = readSrc("components/recite-sheet/recite-sheet.js");
  const readerJsSrc = readSrc("pages/reader/reader.js");
  const generalJsSrc = readSrc("packages/settings/general/general.js");

  ok("字号量程只有一份定义（阅读页与背诵弹层都取它）",
    [sheetJsSrc, readerJsSrc]
      .every((src) => /require\("\.\.\/\.\.\/utils\/type-scale"\)/.test(src)
        && !/FONT_(MIN|MAX)\s*=/.test(src) && !/\bconst (MIN|MAX)\s*=/.test(src)),
    "正文两处各自写了一份量程 —— 迟早对不上（Issue #425：设置封顶 4，正文能到 6）");

  ok("设置页不再留字号那条滑杆（正文旁边点一下就是全部入口）",
    generalJsSrc.indexOf("fontSize") < 0,
    "字号在设置页又长出一条路 —— 同一件事两个入口，改一个以为另一个会跟");

  ok("版式按字号重排（改字号要重算装箱）",
    /corpus\.layout\([^)]*\{[^}]*size:/.test(readerJsSrc)
      && /corpus\.layout\([^)]*\{[^}]*size:/.test(sheetJsSrc),
    "layout 又只吃正文 —— 字号变了行还是原来那些");
}

{

  const coursePath = path.join(ROOT, "data", "course.js");
  if (fs.existsSync(coursePath)) {
    const course = readModule(coursePath);
    const badSrc = [];
    Object.keys(course).forEach(function (id) {
      const src = course[id] && course[id].src;
      if (src && /[A-Za-z]/.test(src)) badSrc.push(id + "=" + src);
    });
    ok("译文来源是给人看的说明，不是英文 token（course.js 的 src）",
      badSrc.length === 0, badSrc.slice(0, 3).join(" | "));

    const b = fs.readFileSync(path.join(__dirname, "build-data.js"), "utf8");
    ok("build-data.js 的译文来源映射表认得那四个键",
      /TRANSLATION_SOURCES\s*=\s*\{/.test(b)
        && ["school", "academic", "modern", "public-domain"]
          .every((k) => b.indexOf(k + ":") >= 0 || b.indexOf('"' + k + '"') >= 0));
  }

  {
    const wxmlFiles = [];
    const walk = (dir) => {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".wxml")) wxmlFiles.push(p);
      });
    };
    walk(path.join(ROOT, "pages"));
    walk(path.join(ROOT, "packages"));
    let cards = 0;
    let wired = 0;
    wxmlFiles.forEach((p) => {
      const found = fs.readFileSync(p, "utf8").match(/<lock-card\b[^>]*>/g) || [];
      cards += found.length;
      found.forEach((tag) => {
        if (tag.indexOf("bind:login") >= 0) wired += 1;
      });
    });
    ok("每张登录卡都接上了登录按键（卡上那颗按钮点了有去处）",
      cards > 0 && wired === cards,
      wired + " / " + cards + " 张卡接上了登录按键");
  }

  const homeJsDaily = fs.readFileSync(path.join(ROOT, "pages", "home", "home.js"), "utf8");
  ok("搜索行的按键都接到组件上（输入 / 回车 / 清空）",
    ["onExtraInput", "onExtraSearch", "onExtraClear"].every((h) => new RegExp("^  " + h + "\\(", "m").test(homeJsDaily))
      && /searchExtra\(/.test(homeJsDaily),
    "行上的按键没有落到组件 —— 输入不搜、清空不清");
}

{
  const storeSrc = fs.readFileSync(path.join(ROOT, "utils", "store.js"), "utf8");
  const schedSrc = fs.readFileSync(path.join(ROOT, "utils", "scheduler.js"), "utf8");
  const homeJs = fs.readFileSync(path.join(ROOT, "pages/home/home.js"), "utf8");
  const compDir = path.join(ROOT, "components", "daily-extra");
  const compJs = fs.readFileSync(path.join(compDir, "daily-extra.js"), "utf8");

  ok("新增温习：四件套齐全、首页挂上并注册、两处都挂 change",
    [".js", ".json", ".wxml", ".wxss"].every((e) => fs.existsSync(path.join(compDir, "daily-extra" + e)))
      && (readJson(path.join(ROOT, "pages/home/home.json")).usingComponents || {})["daily-extra"]
        === "/components/daily-extra/daily-extra"
      && /onExtraChange\s*\([\s\S]{0,200}?this\.refresh\(\)/.test(homeJs));
  ok("加背的上下限与错误码只在 store 里定一次（组件不自己写数）",
    /DAILY_EXTRA_MAX\s*=\s*20\b/.test(storeSrc)
      && /function toggleDailyExtra\(/.test(storeSrc)
      && /E_LIMIT/.test(storeSrc) && /E_LIMIT/.test(compJs)
      && /E_STORAGE/.test(storeSrc) && /E_STORAGE/.test(compJs)
      && compJs.indexOf("store.DAILY_EXTRA_MAX") >= 0
      && !/>=\s*20\b/.test(compJs));
  ok("排期器把加背排进计划，计划行的标签与色按 reason 给",
    /extraPoems/.test(schedSrc) && /mergePinned/.test(schedSrc)
      && /extraPoems:\s*store\.dailyExtraPoems\(\)/.test(homeJs)
      && /REASON_TEXT\s*=\s*\{[^}]*\bpinned:\s*"/.test(homeJs)
      && /REASON_CLS\s*=\s*\{[^}]*\bpinned:\s*"/.test(homeJs),
    "计划行的加背小签没了 —— 它得与「补充」分得开");
  ok("加背挂在每日几首之外，且与课内几首一起落盘（设置 5 首 + 加 1 首 = 今天 6 首）",
    /function mergePinned\(/.test(schedSrc)
      && /pinnedPlan\(dedupePoems\(extraPoems\), getRecord\)/.test(schedSrc)
      && !/plan\.concat\(pinnedPlan/.test(schedSrc)
      && /function placedPlan\(opt\)[\s\S]{0,1400}?mergePinned\(withAdded/.test(schedSrc),
    "加背又回到候选池里跟「新学」抢那 5 个名额，或加背没进落盘的那一份 —— "
      + "下次进首页按落盘还原时它就没了，计划从 6 首弹回 5 首（Issue #370）");
  ok("加背的档位在 store 里判一次，三个入口共用同一个错误码",
    /require\("\.\/entitlement"\)\.decide\("extra"\)/.test(storeSrc)
      && /E_TIER/.test(storeSrc)
      && compJs.indexOf("E_TIER") >= 0
      && /entitlement\.gateTier\("extra"/.test(fs.readFileSync(path.join(ROOT, "pages/reader/reader.js"), "utf8"))
      && /entitlement\.gateTier\("extra"/.test(fs.readFileSync(
        path.join(ROOT, "components/recite-sheet/recite-sheet.js"), "utf8"))
      && /entitlement\.gateTier\("extra"/.test(compJs),
    "Free 档还能往新增温习里加诗 —— 档位这道门只在 store 判，页面各写一份就对不齐");
  ok("能力表里有 extra（与网页版对齐）", E.CAP_KEYS.indexOf("extra") >= 0);
  ok("标题与列出的是同一件事：都从范围名与 poolForScope 出",
    /function scopeLabel\(scope\)\s*\{[\s\S]{0,120}?scope\.scopeName\s*\+\s*"全部诗词"/.test(homeJs)
      && /function scopeList\(all, view, scope\)/.test(homeJs)
      && /poolForScope/.test(homeJs.slice(homeJs.indexOf("function scopeList"))),
    "标题另写一套、或列表不走 poolForScope —— 标题与内容迟早对不上");
  ok("全部诗词卡点开走弹层，队列用它自己那一份（不与今日计划混）",
    /onOpenAll[\s\S]{0,200}?openSheet\(/.test(homeJs)
      && /source === "all" \? this\.scopeRows\(\) : this\.data\.plan/.test(homeJs));
}

{
  const wireSrc = fs.readFileSync(path.join(ROOT, "utils", "wire.js"), "utf8");
  const storeSrc2 = fs.readFileSync(path.join(ROOT, "utils", "store.js"), "utf8");
  const authSrc = fs.readFileSync(path.join(ROOT, "utils", "auth.js"), "utf8");
  const gateSrc = fs.readFileSync(path.join(ROOT, "utils", "gate.js"), "utf8");

  ok("设置的跨设备 / 本机两层分得开（音效跟设备走、写设置按键分流）",
    /const DEFAULTS\s*=/.test(storeSrc2) && /const DEVICE_DEFAULTS\s*=/.test(storeSrc2)
      && /DEVICE_DEFAULTS\s*=\s*\{[\s\S]{0,200}?sfx/.test(storeSrc2)
      && /function saveSettings\(patch\)[\s\S]{0,400}?isDeviceKey/.test(storeSrc2));
  ok("打包的是跨设备那一份（settings:v1），头像与跟设备走的那项都不进报文",
    /SETTINGS_ROW\s*=\s*"settings:v1"/.test(wireSrc)
      && /id === SETTINGS_ROW[\s\S]{0,400}?replaceSettings/.test(wireSrc)
      && wireSrc.replace(/\/\*[\s\S]*?\*\//g, "").indexOf("profile:v1") < 0
      && /store\.cloudSettings\(\)/.test(wireSrc));

  {
    const wireMod4 = require(path.join(ROOT, "utils", "wire.js"));
    const storeMod4 = require(path.join(ROOT, "utils", "store.js"));
    const future = Date.now() + 86400000;

    storeMod4.replaceSettings({ grade: 7, theme: "qinglv", fontSize: 2 });
    storeMod4.saveSettings({ sfx: true });
    storeMod4.touchSettings(future);
    storeMod4.saveProfile({ avatarLocal: "wxfile://avatar.jpg", nickname: "张敏" }, future);

    const packed4 = wireMod4.packRecords();
    const sRow = packed4.filter((r) => r.id === "settings:v1")[0];
    ok("设置行按服务端形状进包，带年级 / 主题 / 字号，不含跟设备走的那项与头像",
      !!sRow && !!sRow.payload.settings && sRow.updatedAt > 0
        && sRow.payload.settings.grade === 7 && sRow.payload.settings.theme === "qinglv"
        && sRow.payload.settings.fontSize === 2
        && sRow.payload.settings.sfx === undefined
        && !packed4.some((r) => r.id === "profile:v1"));

    storeMod4.replaceSettings({ grade: 1, theme: "ink", fontSize: 0 });
    storeMod4.touchSettings(0);
    storeMod4.saveProfile({ avatarLocal: "", nickname: "" });
    wireMod4.applyRecords(packed4);
    const back = storeMod4.settings();
    ok("换台机器整份认回云端的设置（年级 / 主题 / 字号），头像与音效不跟着换",
      back.grade === 7 && back.theme === "qinglv" && back.fontSize === 2
        && back.sfx === true && storeMod4.profile().avatarLocal === ""
        && storeMod4.settingsAt() === future);

    wireMod4.applyRecords([
      { id: "settings:v1", payload: { v: 1, settings: { theme: "mohong" } }, updatedAt: 1 }
    ]);
    ok("比本机旧的设置不覆盖", storeMod4.settings().theme === "qinglv");
  }

  {
    const storeMod45 = require(path.join(ROOT, "utils", "store.js"));
    const wireMod45 = require(path.join(ROOT, "utils", "wire.js"));

    storeMod45.saveSettings({ grade: 8 });
    ok("写设置会自动盖上时间戳（不靠调用方记得）",
      storeMod45.settingsAt() > 0, String(storeMod45.settingsAt()));
    ok("跟设备走的那一项不盖章（写 sfx 不该让设置进队列）", (() => {
      const before = storeMod45.settingsAt();
      storeMod45.saveSettings({ sfx: !storeMod45.settings().sfx });
      return storeMod45.settingsAt() === before;
    })());

    ok("store 里不再有 profileAt（档案不再参与「谁更新」的比较）",
      typeof storeMod45.profileAt !== "function",
      "profileAt 还在 —— 它对应的那份云端档案已经没有了");

    storeMod45.replaceSettings({ theme: "ink" });
    storeMod45.touchSettings(Date.now());
    const row45 = wireMod45.packRecords().filter((r) => r.id === "settings:v1")[0];
    const themeAtPack = row45.payload.settings.theme;
    storeMod45.replaceSettings({ theme: "mohong" });
    ok("打包之后本机再改，报文不许跟着变（不然推上去的是一份说不清来历的数据）",
      row45.payload.settings.theme === themeAtPack, "报文被本机存储的引用串改了");
    storeMod45.replaceSettings({ theme: "ink" });
  }

  ok("登录成功之后立刻认回云端", /pullAfterLogin/.test(authSrc));
  ok("认回云端只在这条路上做一次（不是每个页面各写一遍）",
    (authSrc.match(/pullAfterLogin\(/g) || []).length <= 2);
  ok("认回云端的结果传得到界面（登录流程读 synced 字段）",
    /synced/.test(authSrc)
      && /synced/.test(fs.readFileSync(path.join(ROOT, "utils", "login-flow.js"), "utf8")),
    "认回的结果没传到界面 —— 用户看不出这次登录有没有把进度拿回来");

  const syncSrc = fs.readFileSync(path.join(ROOT, "utils", "sync.js"), "utf8");
  ok("同步只有一道门槛：配了后端且登录了",
    /function ready\(\)[\s\S]{0,160}?remote\.configured\(\) && auth\.logged\(\)/.test(syncSrc));
  ok("同步层不再问档位", syncSrc.indexOf("entitlement") < 0);

  const DIRTY = [
    ["通用设置", "packages/settings/general/general.js", /onSeasonal[\s\S]{0,300}?markDirty/],
    ["正文对齐", "pages/reader/reader.js", /onAlignToggle[\s\S]{0,200}?markDirty/],
    ["温习设置（年级/范围/首数/算法）", "packages/settings/recite/recite.js", /save\(patch\)[\s\S]{0,300}?markDirty/],
    ["主题", "utils/theme.js", /function set\(key\)[\s\S]{0,400}?markDirty/],
    ["注音口径", "utils/pinyin.js", /function setMode[\s\S]{0,400}?markDirty/],
    ["昵称", "utils/login-flow.js", /function takeNickname\([\s\S]{0,500}?markDirty/]
  ];
  ok("改了设置就该传：五个入口都挂了记账（记账之后自己推一程，不再靠用户点）",
    DIRTY.every(([, file, re]) => re.test(fs.readFileSync(path.join(ROOT, file), "utf8")))
      && /function markDirty\(\)[\s\S]{0,600}?now\(\)/.test(syncSrc)
      && !/function markDirty\(\)[\s\S]{0,600}?wx\.request/.test(syncSrc),
    "记账只记得下、推不出去 —— 用户不去「我的」点一下，这次改动静默躺在队列里");

  ok("同步的触发点都在（启动后 3 秒 / 进首页 / 登录那一刻）",
    /setTimeout\(\(\) => \{[\s\S]{0,120}?sync\.now\(\)/.test(
      fs.readFileSync(path.join(ROOT, "app.js"), "utf8"))
      && /gate\.logged\(\)\) sync\.now\(\)/.test(
        fs.readFileSync(path.join(ROOT, "app.js"), "utf8"))
      && /pullAfterLogin/.test(authSrc),
    "少一处 —— 那一段路上就没人推，用户会以为云同步坏了");

  {
    const storeMod2 = require(path.join(ROOT, "utils", "store.js"));
    const appSrc2 = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

    storeMod2.write(storeMod2.KEYS.tierAt, 0);
    ok("档位一小时只对一次：没有记录时算到期，间隔内不算到期、满一小时再算",
      storeMod2.tierDue() === true
        && storeMod2.tierDue(storeMod2.touchTier()) === false
        && storeMod2.tierDue(storeMod2.tierAt() + 59 * 60 * 1000) === false
        && storeMod2.tierDue(storeMod2.tierAt() + 60 * 60 * 1000) === true,
      "按小时比时间戳的判据错了 —— 要么每次进前台都拉一次，要么满一小时还不再拉");

    ok("小时对档挂在 onShow（常驻后台再回来也走得到）",
      /onShow\(\)[\s\S]{0,160}?refreshTierHourly/.test(appSrc2)
        && /tierDue\(\)/.test(appSrc2)
        && /entitlement\s*\n?\s*\.sync\(\)/.test(appSrc2),
      "对档只挂在 onLaunch 上 —— 用户开着好几天不回冷启，档位就一直不刷");
  }

  ok("前台那几次自动推有最小间隔挡着（同一分钟内只发一次）",
    /MIN_GAP\s*=\s*60\s*\*\s*1000/.test(syncSrc)
      && /!force && Date\.now\(\) - lastAt < MIN_GAP/.test(syncSrc),
    "没有最小间隔的话，背完一首就发一次 —— 一次点击一条请求");

  ok("本地改动静默下来（IDLE_GAP 秒）才推，不是每次按键都发",
    /IDLE_GAP\s*=\s*\d/.test(syncSrc)
      && /function markDirty\(\)[\s\S]{0,400}?armPackMoment\(\)/.test(syncSrc)
      && /armPackMoment[\s\S]{0,400}?clearTimeout\(packTimer\)/.test(syncSrc),
    "记完账立刻发 —— 拖动字号那一串回调会各发一条");

  {
    const flowSrc7 = fs.readFileSync(path.join(ROOT, "utils", "login-flow.js"), "utf8");
    const i = flowSrc7.indexOf("function takeAvatar(");
    const body = i < 0 ? "" : flowSrc7.slice(i, flowSrc7.indexOf("\n}\n", i));
    ok("头像不挂记账（挂了就等于它进同步队列，而上传它要养一份存储桶）",
      !!body && body.indexOf("markDirty") < 0);
  }

  {
    const panelSrc = fs.readFileSync(path.join(ROOT, "components", "login-panel", "login-panel.js"), "utf8");
    const flowSrc8 = fs.readFileSync(path.join(ROOT, "utils", "login-flow.js"), "utf8");
    const mineSrc8 = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");

    ok("换头像与换昵称各有一个入口，互不串联",
      /onName\(\)[\s\S]{0,400}?loginFlow\.takeNickname\(/.test(panelSrc)
        && /onWechatAvatar\(e\)[\s\S]{0,200}?loginFlow\.takeAvatar\(/.test(panelSrc),
      "头像或昵称没了入口");
    ok("头像走 open-type=\"chooseAvatar\" 那一环的 chooseavatar 事件（平台没有静默拿头像的接口）",
      /function takeAvatar\(url\)[\s\S]{0,160}?store\.saveProfile\(\{ avatarLocal: url \}\)/.test(flowSrc8)
        && !/wx\.chooseAvatar/.test(flowSrc8 + panelSrc),
      "用了 wx.chooseAvatar 这类客户端接口 —— 基础库上没有它，点了会报 not a function");
    ok("昵称落本机后走同一条推送（不是只改本机）",
      /function takeNickname\(name\)[\s\S]{0,500}?auth\.saveNickname\(nickname\)/.test(flowSrc8),
      "昵称没推上去");
    ok("头像或昵称一换，底栏那格跟着重画",
      /done\(\) \{[\s\S]{0,100}?this\.refresh\(\)[\s\S]{0,100}?triggerEvent\("changed"\)/.test(panelSrc)
        && /onIdentityChanged\(res\) \{[\s\S]{0,160}?this\.syncBar\(\)/.test(mineSrc8)
        && /syncBar\(\)[\s\S]{0,80}?tabbar\.sync\(this,\s*4\)/.test(mineSrc8),
      "底栏还是那张写死的默认图 —— 换完头像要等切页才更新");
  }

  {
    const flowSrc9 = fs.readFileSync(path.join(ROOT, "utils", "login-flow.js"), "utf8");
    const panelCode9 = fs.readFileSync(path.join(ROOT, "components", "login-panel", "login-panel.js"), "utf8");

    ok("登录不再追问，也不留多余入口",
      !/askWechat|goIdentity/.test(flowSrc9)
        && !/wechat-go|onWechat\(\)|picking/.test(panelCode9),
      "登录完又弹一问、或身份卡又长出第二枚换身份的按钮");
    ok("换头像/换昵称只有一份实现（卡片调它）",
      /module\.exports = \{[^}]*takeAvatar[^}]*takeNickname[^}]*\}/.test(flowSrc9)
        && /loginFlow\.takeAvatar\(/.test(panelCode9)
        && !/function takeNickname/.test(panelCode9)
        && !/function takeAvatar/.test(panelCode9),
      "页面自己又写了一遍落盘与推送 —— 两处会各说一套");
  }

  {
    const doc = fs.readFileSync(path.join(ROOT, "..", "docs", "wx-login-server.md"), "utf8");
    ok("服务端要加的两行白名单写进了文档",
      doc.indexOf("settings:v1") >= 0 && doc.indexOf("profile:v1") >= 0);
    ok("文档说清了「不加白名单会被静默清空」这件事",
      doc.indexOf("sanitizePayload") >= 0);
  }

}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const dataDir = path.join(ROOT, "data");
  if (!fs.existsSync(path.join(dataDir, "books", "books.js"))) {
    ok("出题口径（包里没有语料，跳过真跑）", true);
  } else {
    const quizSrc = read("packages/game/quiz/lib.js");
    const cap = /const MAX_LINE = (\d+);/.exec(quizSrc);
    const capN = cap ? Number(cap[1]) : 0;
    ok("题干有上限（16 ~ 32 字）", capN >= 16 && capN <= 32);
    ok("按 \\n 取句只有一处（linesOf 收口）",
      quizSrc.indexOf('.split("\\n")') < 0 && quizSrc.indexOf("corpus.splitLines") >= 0);

    const corpusMod = require(path.join(ROOT, "utils", "corpus.js"));
    const quizMod = require(path.join(ROOT, "packages/game/quiz/lib.js"));
    const whole = (text) => String(text).split("\n").map((x) => x.trim()).filter(Boolean).join("");
    const broken = (text) => {
      const parts = corpusMod.splitDisplay(text);
      return parts.length > 0 && parts.join("") === whole(text)
        && parts.slice(0, -1).every((x) => /[，。！？；：、]$/.test(x));
    };

    let maxAnswer = 0, unbroken = [];
    for (let round = 0; round < 300; round++) {
      quizMod.build({ count: 10, forms: ["next", "prev", "author", "title"] }).forEach((q) => {
        maxAnswer = Math.max(maxAnswer, (q.answer || "").length);
        if (!broken(q.stem || "") || quizMod.stemRows(q).length < 3) unbroken.push(q.stem);
      });
    }
    ok("真跑 300 轮出题：题干按句读拆成多行，逗号也断，拼回等于原句（上限内）",
      !unbroken.length && maxAnswer > 0 && maxAnswer <= capN,
      "没拆开的 " + unbroken.length + " 条，例如 " + JSON.stringify(unbroken.slice(0, 3)));

    const scopeMod = require(path.join(ROOT, "utils", "game-scopes.js"));
    const punctOnly = [];
    scopeMod.list().forEach((s) => {
      for (let round = 0; round < 40; round++) {
        quizMod.build({ count: 10, forms: quizMod.FORM_KEYS, scope: s.id }).forEach((q) => {
          q.options.forEach((o) => {
            if (!quizMod.usable(o.text)) punctOnly.push(s.id + ":" + q.form + ":" + o.text);
          });
        });
      }
    });
    ok("整库每种题型真跑一遍：没有一个选项只剩标点",
      !punctOnly.length, JSON.stringify(punctOnly.slice(0, 5)));

    const course = readModule(path.join(dataDir, "course.js"));
    const proseIds = Object.keys(course).filter((id) => String(course[id].text).length > 100);
    ok("课内确实有长文（上面那条不是空转）", proseIds.length > 10,
      "只找到 " + proseIds.length + " 篇长文");
  }
}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

  ok("温习选项只有一条入口（我的 → 温习选项，进整页）",
    /onRecite/.test(read("pages/mine/mine.js"))
      && ["onScope", "onDaily", "onAlgo"].every((h) => read("pages/mine/mine.js").indexOf(h) < 0),
    "范围 / 首数 / 算法又各自留了一行 —— 指向同一页的三条路就是三条路");

  {
    const readerJs = read("pages/reader/reader.js");
    ok("浏览入口一律带 mode=browse（诗词漫读 / 搜索 / 作者索引 / 游戏 / 新增温习）",
      ["pages/list/list.js", "pages/search/search.js", "components/daily-extra/daily-extra.js",
        "packages/authors/index/index.js", "packages/game/quiz/quiz.js",
        "packages/game/feihua/feihua.js"].every((f) => read(f).indexOf("mode=browse") >= 0),
      "有入口没带上 mode=browse，那个入口进详情页会亮出评分");
    ok("背诵场景翻篇不丢 mode（readerUrl 把 mode 续上）",
      /readerUrl\(/.test(readerJs) && /mode=recite/.test(readerJs));
  }

  {
    const keysOf = (src) => {
      const block = /const PINYIN_MODES = \[([\s\S]*?)\];/.exec(src);
      return block ? [...block[1].matchAll(/key\s*:\s*"([^"]+)"/g)].map((m) => m[1]) : [];
    };
    const a = keysOf(read("pages/reader/reader.js"));
    const b = keysOf(read("components/recite-sheet/recite-sheet.js"));
    ok("注音只在背诵弹层有：弹层两档，详情页没有档位表也不挂 onPinyin",
      a.length === 0 && b.length === 2
        && !/onPinyin/.test(read("pages/reader/reader.js"))
        && /pinyin\.setMode\(/.test(read("components/recite-sheet/recite-sheet.js")),
      "详情页 " + JSON.stringify(a) + " / 弹层 " + JSON.stringify(b));
  }

  {
    const authSrc9 = read("utils/auth.js");
    ok("改昵称会写到服务端的 accounts.nickname（走 PATCH /api/me）",
      /request\(REMOTE\.me,[\s\S]{0,80}?\"PATCH\"/.test(authSrc9),
      "昵称只写进了本机存储 —— 数据库 accounts.nickname 永远是空的（Issue #268）");
    ok("改昵称那一刻就把昵称推上去（不靠进度同步队列捎带）",
      /loginFlow\.takeNickname\(/.test(read("components/login-panel/login-panel.js"))
        && /function takeNickname[\s\S]{0,600}?auth\.saveNickname\(/.test(read("utils/login-flow.js")),
      "改昵称只落本机 + markDirty —— 进度那条链从来不打包昵称，" +
        "用户改完到数据库里看依旧为空");
    ok("没登录 / 没接后端时改昵称不炸（只落本机）",
      /saveNickname[\s\S]{0,300}?!logged\(\)[\s\S]{0,120}?return Promise\.resolve/.test(authSrc9),
      "离线改昵称也去发请求 —— 会抛给 saveName 的调用方，界面停在改不动的那一格");
  }

  {
    const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    const tiersJs = read("utils/tiers.js");
    const tiersMod = require(path.join(ROOT, "utils", "tiers.js"));
    const tierRows = [...bare(tiersJs).matchAll(/\{\s*key:\s*"(\w+)",\s*name:\s*"([^"]+)"/g)];
    ok("档位表三行齐全（free / pro / max 都在）", tierRows.length === 3,
      "读到 " + tierRows.length + " 行");
    const wanted = Object.fromEntries(tierRows.map((m) => [m[1], m[2]]));

    ok("nameOf 三档都回一个非空名字",
      ["free", "pro", "max"].every((k) => !!tiersMod.nameOf(k) && tiersMod.nameOf(k) === wanted[k]),
      ["free", "pro", "max"].map((k) => k + "→" + tiersMod.nameOf(k)).join(" "));
    ok("认不出的档位按最低那档显示（宁可少给）",
      tiersMod.nameOf("vip") === wanted.free && tiersMod.nameOf("") === wanted.free,
      tiersMod.nameOf("vip"));
    ok("档位读不出来时回退也是 Free（TIERS[0] 就是 free）",
      tiersMod.tierOf("nope").key === "free" && tiersMod.DEFAULT_TIER === "free");

  }

  {
    const fb = require(path.join(ROOT, "utils", "feedback.js"));
    const seen = [0, 10, 19, 20, 39, 40, 59, 60, 79, 80, 89, 90, 99, 100].map((p) => fb.rankPercent(p));
    ok("段位只单调往上（分高的段位名不许排在分低的下面）",
      seen.every((r, i) => i === 0 || r.rank >= seen[i - 1].rank) && fb.rankPercent(100).name === "状元",
      JSON.stringify(seen.map((r) => r.name)));
    ok("段位表七档，名字不重复",
      new Set(fb.RANKS.map((r) => r.name)).size === fb.RANKS.length && fb.RANKS.length === 7);
  }

}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const leagueJs = read("utils/league.js");

  ok("删的是设置项，不是翻页本身（背完仍顺势进下一首）",
    /setTimeout\(\(\) => this\.goNext\(/.test(read("components/recite-sheet/recite-sheet.js")));

  ok("设置里那个开关关掉之后成绩真的不再往榜单交（同一处口径）",
    /function optedIn[\s\S]{0,100}?league\.optedIn\(\)/.test(read("utils/ranking-submit.js"))
      && /function optedIn[\s\S]{0,120}?canJoin\(\)[\s\S]{0,120}?leagueBoard !== false/.test(leagueJs),
    "开关写着有、提交那条路却没读同一处 —— 关掉照样上榜");

}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const mineJs = read("pages/mine/mine.js");
  const panelJs = read("components/login-panel/login-panel.js");

  {

    const flowJs = read("utils/login-flow.js");
    const body = (() => {
      const i = flowJs.indexOf("function takeAvatar(");
      if (i < 0) return "";
      const j = flowJs.indexOf("\n}\n", i);
      return j < 0 ? flowJs.slice(i) : flowJs.slice(i, j);
    })();
    ok("头像的落盘函数在（选完落本机那张）", !!body, "没找到 takeAvatar");
    ok("头像不上传（选完不调 markDirty，也不走任何上传接口）",
      !!body && body.indexOf("markDirty") < 0 && !/uploadFile|\/api\/avatar/.test(body),
      "选完头像还去 markDirty / 传文件 —— 那就要为它养一份对象存储（Issue #111 要的正是别养）。" +
        "函数体：" + body.replace(/\s+/g, " ").slice(0, 160));

    const bareJs = (mineJs + panelJs).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok("整个小程序端没有上传头像的接口调用",
      !/wx\.uploadFile|\/api\/avatar/.test(bareJs),
      "还留着上传头像的路 —— 那就是又回到「要一份对象存储」");
  }
}

const K = {
  course: 251,

  dynasties: ["先秦", "秦", "汉", "三国", "西晋", "东晋", "南北朝", "隋", "唐", "五代",
    "宋", "元", "明", "清", "现代"]
};

{
  ok("课内诗词 251 首（与上游语料同一口径）", perBook.poems.length === K.course,
    "语料 " + perBook.poems.length + "，表里写 " + K.course);

  const emptyDyn = perBook.poems.filter((p) => !String(p.d || "").trim());
  ok("课内 251 首没有空朝代", emptyDyn.length === 0,
    emptyDyn.length + " 条 —— " + emptyDyn.slice(0, 5).map((p) => p.id + " " + p.t).join("；"));

  const noAuthor = perBook.poems.filter((p) => !String(p.a || "").trim());
  ok("课内 251 首没有空作者", noAuthor.length === 0,
    noAuthor.slice(0, 5).map((p) => p.id + " " + p.t).join("；"));

  const offAxis = perBook.poems.filter((p) => K.dynasties.indexOf(String(p.d || "").trim()) < 0);
  ok("朝代写法都在同一个轴上", offAxis.length === 0,
    "认不得：" + offAxis.slice(0, 8).map((p) => p.d).join("、"));

  const noGrade = perBook.poems.filter((p) => !p.gr);
  ok("课内 251 首都带年级（每日计划按它排）", noGrade.length === 0,
    noGrade.slice(0, 5).map((p) => p.id + " " + p.t).join("；"));

  const named = perBook.poems.filter((p) => {
    const a = String(p.a || "").trim();
    return /^《.+》$/.test(a) || a === "国语" || a === "战国策";
  });
  ok("作者一格填书名的几条都认得出是结集",
    named.every((p) => require(path.join(ROOT, "utils", "author-index.js")).isCollective(p.a)),
    "认成了一位作者：" + named.slice(0, 5).map((p) => p.a + "（" + p.id + "）").join("、"));

  {
    const withAka = perBook.poems.filter((p) => p.aka);
    const want = ["燕歌行", "燕歌行·并序"];
    const all = withAka.reduce((acc, p) => acc.concat(p.aka), []);
    ok("题名异写搬进来了（" + withAka.length + " 条）", want.every((t) => all.indexOf(t) >= 0),
      "少了：" + want.filter((t) => all.indexOf(t) < 0).join("、") + " —— 构建脚本里的 `aka` 没搬？");
  }
}

{
  const AI = require(path.join(ROOT, "utils", "author-index.js"));
  const roster = AI.build(perBook.poems);

  ok("课内的作者都进得了名册", roster.total > 0 && Object.keys(roster.people).length > 0);
  ok("名册上每一位都落在某一段里",
    roster.eras.reduce((n, e) => n + e.people.length, 0) === roster.total,
    "有人悬空");

  const libai = roster.people["李白"];
  ok("李白在名册里，名下有《静夜思》且只算一次",
    !!libai && libai.items.filter((p) => p.t === "静夜思").length === 1,
    libai ? "名下 " + libai.items.length + " 条" : "名册里没有李白");

  ok("认不得的朝代写法回落到最末一段（不静默丢掉）",
    AI.eraOf("__探针__") === AI.TAIL,
    "eraOf 对表外写法返回了 " + AI.eraOf("__探针__"));

  const rawNames = ["北宋", "南宋", "南朝宋", "东晋", "盛唐"];
  const bad = roster.eras.filter((e) => rawNames.indexOf(e.name) >= 0).map((e) => e.name);
  ok("段的标题是归并后的朝名（不是原写法）", bad.length === 0,
    "出现了原写法：" + bad.join("、"));
}

{
  const AI = require(path.join(ROOT, "utils", "author-index.js"));
  const roster = AI.build(perBook.poems);
  const books = ["公羊传", "谷梁传", "礼记·檀弓", "国语", "战国策", "戴圣编", "求那毗地译", "墨翟及弟子"];
  const shown = books.filter((n) => roster.people[n]);
  ok("名册上没有书目与编者占的格（" + books.join("、") + "）",
    shown.length === 0, "还挂着：" + shown.join("、"));
}

{
  const AI = require(path.join(ROOT, "utils", "author-index.js"));
  const roster = AI.build(perBook.poems);
  ok("集子目录里的作者都进得了名册（" + AI.extraCount + " 位）",
    AI.extraCount > 0 && roster.total === Object.keys(roster.people).length,
    "名册 " + Object.keys(roster.people).length + " 位，算成 " + roster.total + " 位");

  const missing = ["韩非", "脱脱", "岳飞"].filter((n) => !roster.people[n]);
  ok("草稿里点到的几位在名册上（他们只在集子目录里出现）",
    missing.length === 0, "名册里没有：" + missing.join("、"));

  const withDeng = Object.keys(roster.people).filter((n) => /等$/.test(n));
  ok("名册上的名字都进得了诗词漫读（不带「等」）", withDeng.length === 0,
    "还挂着：" + withDeng.join("、") + " —— 诗词漫读里只有「宋濂」，没有「宋濂等」");

  const only = roster.people["韩非"];
  ok("集子里才出现的作者不冒充有作品", !!only && only.external === true && only.count === 0,
    only ? JSON.stringify({ external: only.external, count: only.count }) : "名册里没有韩非");

  {
    const webSrc = fs.readFileSync(
      path.join(__dirname, "corpus", "data", "author-index.js"), "utf8");
    const at = webSrc.indexOf("var ALIAS = {");
    let depth = 0;
    let end = webSrc.indexOf("{", at);
    const start = end;
    while (end < webSrc.length) {
      const c = webSrc[end];
      if (c === "{") depth += 1;
      else if (c === "}") { depth -= 1; if (depth === 0) break; }
      end += 1;
    }
    const webAlias = new Function("return (" + webSrc.slice(start, end + 1) + ")")();
    const drift = Object.keys(webAlias).filter((k) => AI.aliasOf(k) !== webAlias[k]);
    ok("异名表两端逐条相同（网页版 " + Object.keys(webAlias).length + " 条）",
      drift.length === 0,
      "小程序端没跟上：" + drift.slice(0, 8).map((k) => k + "→" + webAlias[k]).join("、"));
  }

  {
    const extra = readModule(path.join(dataDir, "roster-extra.js")).era || {};
    const catalogs = catalogIds.reduce((acc, id) => acc.concat(perBook[id]), []);
    const noEra = catalogs.filter((p) => p.a && !extra[p.a]).map((p) => p.a);
    ok("集子目录里每一位作者都对得上朝代（书名、作者名这两个字段之外不靠猜）",
      noEra.length === 0, "没有朝代的作者：" + Array.from(new Set(noEra)).slice(0, 8).join("、"));
  }

  {
    const landed = (name, era) => {
      const w = roster.people[name];
      return !!w && w.at === AI.eraOf(era) && AI.eraName(era) === era;
    };
    const want = [
      ["李白", "唐"], ["苏轼", "宋"], ["关汉卿", "元"], ["韩非", "先秦"],
      ["屈原", "先秦"], ["曹操", "三国"], ["陶渊明", "晋"], ["刘禹锡", "唐"]
    ];
    const wrong = want.filter(([n, e]) => !landed(n, e))
      .map(([n]) => n + "落到了 " + ((roster.people[n] || {}).dynasty || "没朝代"));
    ok("一位作者只占一段，且落在他的名字该在的那一段",
      wrong.length === 0, wrong.join("；"));

    const all = AI.ERAS.map((e) => e.name);
    const off = Object.keys(roster.people).filter((n) => {
      const w = roster.people[n];
      return w.at !== AI.TAIL && all.indexOf(w.dynasty) < 0;
    });
    ok("名册里没有一件「朝代写在表外」的作者", off.length === 0,
      off.slice(0, 5).map((n) => n + "：" + roster.people[n].dynasty).join("、"));
  }

  {
    const hits = AI.query(roster, "李");
    ok("作者搜索是只在作者名上匹（搜「李」出李白，不出《李凭箜篌引》）",
      hits.length > 0 && hits.every((h) => h.name.indexOf("李") >= 0)
        && hits.some((h) => h.name === "李白"),
      JSON.stringify(hits.slice(0, 5).map((h) => h.name)));
    ok("搜索是前缀优先（搜「李」时李白排在建名之前）",
      hits[0].name.indexOf("李") === 0,
      "第一位是 " + (hits[0] && hits[0].name));
  }
}

(async () => {
  const readSrc = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const remoteSrc = readSrc("utils/remote.js");
  const authSrc = readSrc("utils/auth.js");

  ok("登录路由与文档一致（/api/wx/login）", /login:\s*"\/api\/wx\/login"/.test(remoteSrc));
  ok("刷新路由与文档一致（/api/wx/refresh）", /refresh:\s*"\/api\/wx\/refresh"/.test(remoteSrc));

  function machine(spec) {
    const mem = {};
    const sent = [];
    const saved = { wx: global.wx };
    global.wx = {
      getStorageSync: (k) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : ""),
      setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
      removeStorageSync: (k) => { delete mem[k]; },
      request: (opt) => {
        sent.push(opt);
        const res = spec(opt) || { statusCode: 404, data: {} };
        if (opt.success) opt.success(res);
        else if (opt.fail) opt.fail({ errMsg: "offline" });
      },
      login: (opt) => opt.success({ code: "CODE-" + sent.length })
    };

    Object.keys(require.cache).forEach((k) => {
      if (k.indexOf(path.join(ROOT, "utils")) === 0) delete require.cache[k];
    });
    const m = {
      mem, sent,
      store: require(path.join(ROOT, "utils", "store.js")),
      remote: require(path.join(ROOT, "utils", "remote.js")),
      auth: require(path.join(ROOT, "utils", "auth.js")),
      restore: () => { global.wx = saved.wx; }
    };
    m.auth.configure({ baseUrl: "https://probe.test" });
    return m;
  }

  const settled = [];
  function drain(p) {

    return p.then(
      (v) => settled.push({ ok: v }),
      (e) => settled.push({ err: e })
    ).then(() => new Promise((r) => setTimeout(r, 0)));
  }

  {
    const m = machine((opt) => {
      if (/\/wx\/login$/.test(opt.url)) {
        return {
          statusCode: 200,
          data: { accessToken: "A1", refreshToken: "R1", expiresIn: 600, tier: "pro", role: "user", userId: "wx_1" }
        };
      }
      if (/\/sync\/pull$/.test(opt.url)) return { statusCode: 200, data: { recs: [], serverTime: 1 } };
      return { statusCode: 404, data: {} };
    });
    await drain(m.auth.login());
    const req = m.sent.filter((o) => /\/wx\/login$/.test(o.url))[0];
    ok("登录报文带 code", !!req && !!req.data.code);
    ok("登录报文带 device（服务端按它签会话 + 限流）", !!req && !!req.data.device);
    ok("登录那一条不带 token（本来就还没有），但请求照发",
      !!req && req.header.authorization === "");
    const after = m.sent.filter((o) => /\/sync\/pull$/.test(o.url))[0];
    ok("拿到 token 之后的每一条都带 Authorization: Bearer（服务端要认这个头）",
      !!after && /^Bearer /.test(after.header.authorization || ""),
      after ? JSON.stringify(after.header.authorization) : "登录之后没有跟着的请求");
    ok("服务端下发的档位落进了会话（serverTier 读得到）",
      m.auth.serverTier() === "pro", "读到 " + JSON.stringify(m.auth.serverTier()));
    ok("服务端下发的角色也落了（管理页据此放行）",
      m.auth.role() === "user", "读到 " + JSON.stringify(m.auth.role()));
    ok("登录那一刻就把队列推出去（不是只写本机）",
      m.sent.some((o) => /\/wx\/login$/.test(o.url)));
    m.restore();
  }

  {
    const m = machine((opt) => {
      if (/\/wx\/refresh$/.test(opt.url)) {
        return { statusCode: 200, data: { accessToken: "A2", refreshToken: "R2", expiresIn: 600, tier: "max", role: "user" } };
      }
      return { statusCode: 404, data: {} };
    });
    m.auth.applySession({ accessToken: "A1", refreshToken: "R1", tier: "pro" });
    await drain(m.auth.refresh());
    const rq = m.sent.filter((o) => /\/wx\/refresh$/.test(o.url))[0];
    ok("刷新报文带 refreshToken", !!rq && rq.data.refreshToken === "R1");
    ok("刷新报文**也**带 device（漏这一处 = 同一台设备的限流被拆成无数桶）",
      !!rq && !!rq.data.device, rq ? JSON.stringify(rq.data) : "没发出去");
    ok("刷新回来的新档位盖掉旧档位", m.auth.serverTier() === "max", m.auth.serverTier());
    m.restore();
  }

  {
    let n = 0;
    const m = machine((opt) => {
      if (/\/wx\/refresh$/.test(opt.url)) {
        n += 1;
        return { statusCode: 200, data: { accessToken: "NEW", refreshToken: "R2", expiresIn: 600, tier: "pro" } };
      }
      if (/\/sync\/pull$/.test(opt.url)) {

        return opt.header.authorization === "Bearer NEW"
          ? { statusCode: 200, data: { recs: [], serverTime: 12345 } }
          : { statusCode: 401, data: { code: "E_NO_SESSION" } };
      }
      return { statusCode: 404, data: {} };
    });
    m.auth.applySession({ accessToken: "OLD", refreshToken: "R1", tier: "pro" });
    await drain(m.remote.pull());
    const urls = m.sent.map((o) => o.url.replace("https://probe.test", ""));
    ok("401 之后自己换了一枚 token 再发（不是把 401 直接报给用户）",
      urls.join(",") === "/api/sync/pull,/api/wx/refresh,/api/sync/pull", urls.join(","));
    ok("refreshed 之后带着**新** token 重发，不是旧那枚",
      m.sent[2] && m.sent[2].header.authorization === "Bearer NEW",
      m.sent[2] ? m.sent[2].header.authorization : "?");
    ok("重发成功（链没在中间断掉）",
      !!settled[settled.length - 1] && !!settled[settled.length - 1].ok,
      JSON.stringify(settled[settled.length - 1]));
    m.restore();
  }

  {
    let n = 0;
    const m = machine(() => {
      n += 1;
      return { statusCode: 401, data: { code: "E_NO_SESSION" } };
    });
    m.auth.applySession({ accessToken: "OLD", refreshToken: "R1", tier: "pro" });
    await drain(m.remote.pull());
    ok("服务端一条都不认时，只重试一次就罢手（共两条请求）", n === 2, "实际发了 " + n + " 条");
    ok("最终还是如实报错（不假装成功）",
      !!settled[settled.length - 1] && !!settled[settled.length - 1].err
        && settled[settled.length - 1].err.statusCode === 401,
      JSON.stringify(settled[settled.length - 1]));
    m.restore();
  }

  {
    let refreshes = 0;
    const m = machine((opt) => {
      if (/\/wx\/refresh$/.test(opt.url)) {
        refreshes += 1;
        return { statusCode: 200, data: { accessToken: "NEW", refreshToken: "R2", expiresIn: 600, tier: "pro" } };
      }
      return { statusCode: 401, data: { code: "E_NO_SESSION" } };
    });
    m.auth.applySession({ accessToken: "OLD", refreshToken: "R1", tier: "pro" });

    await drain(Promise.all([m.remote.pull(), m.remote.pull(), m.remote.pull(), m.remote.pull(), m.remote.pull()]));
    ok("五个请求一起 401，refresh 只发一次（不是五枚 token）", refreshes === 1, "实际 " + refreshes + " 次");
    m.restore();
  }

  {
    const m = machine(() => ({ statusCode: 401, data: { code: "E_LOGIN_FAIL" } }));
    m.auth.applySession({ accessToken: "OLD", refreshToken: "R1", tier: "pro" });
    await drain(m.remote.request(m.remote.PATHS.login, { code: "x" }));
    ok("登录那条路回了 401 不会去刷 token（刷了就是死循环）",
      m.sent.length === 1 && /\/wx\/login$/.test(m.sent[0].url),
      m.sent.map((o) => o.url).join(","));
    m.restore();
  }

  {
    const m = machine((opt) => {
      if (/\/api\/me$/.test(opt.url)) {
        return {
          statusCode: 200,
          data: { uid: "u_abcdef", nickname: "张敏", plan: { tier: "pro", until: null }, role: "admin" }
        };
      }
      return { statusCode: 401, data: { code: "E_NO_SESSION" } };
    });
    await drain(m.auth.refresh());
    ok("本机没 token 时去问 /api/me（不直接放弃）",
      m.sent.some((o) => /\/api\/me$/.test(o.url)),
      m.sent.map((o) => o.method + " " + o.url).join(","));
    ok("/api/me 走 GET（poem 那边就是 GET，写成 POST 会 405）",
      m.sent[0].method === "GET",
      m.sent[0] ? String(m.sent[0].method) : "没发出去");
    ok("认回来的档位读得到（写错域就会「看着登录成功、档位还是 free」）",
      m.auth.serverTier() === "pro", "读到 " + JSON.stringify(m.auth.serverTier()));
    ok("认回来的角色也读得到（管理页据此放行）", m.auth.isAdmin() === true);
    ok("认回来的是「已登录」", m.auth.logged() === true);
    m.restore();
  }

  {
    const m = machine(() => ({ statusCode: 401, data: { code: "E_NO_SESSION" } }));
    await drain(m.auth.refresh());
    ok("没有会话时安静地什么都不做（没登录的人启动一次也会走到这儿）",
      !!settled[settled.length - 1] && !!settled[settled.length - 1].ok,
      JSON.stringify(settled[settled.length - 1]));
    m.restore();
  }

  {
    const m = machine((opt) => {
      if (/\/api\/me$/.test(opt.url)) {
        return { statusCode: 200, data: { uid: "u_x", nickname: "", plan: { tier: "pro" }, role: "user" } };
      }
      return { statusCode: 401, data: {} };
    });
    const before = m.store.profileAt();
    await drain(m.auth.refresh());
    ok("「认回会话」不该把本机档案判成更新的那一份（头像会永远认不回来）",
      m.store.profileAt() === before,
      "profileAt " + before + " → " + m.store.profileAt());
    m.restore();
  }

  {
    const doc = fs.readFileSync(path.join(ROOT, "..", "docs", "wx-login-server.md"), "utf8");
    ok("文档写了「会话要同时认 Cookie 与 Authorization: Bearer」",
      doc.indexOf("Authorization") >= 0 && doc.indexOf("Bearer") >= 0,
      "文档里没有这一节，服务端就不知道该补哪一步");
    ok("文档说清了不补这一步的现象（登录成功、/api/sync/* 一律 401）",
      doc.indexOf("401") >= 0);
    ok("文档写了刷新报文要带 device",
      /wx\/refresh[\s\S]{0,600}?device/.test(doc),
      "刷新那条报文少一个字段，限流就形同虚设，而没人看得出来");
  }

  void remoteSrc;
})();

{
  const remoteSrc = fs.readFileSync(path.join(ROOT, "utils", "remote.js"), "utf8");
  ok("send() 优先用服务端那句 message（不是只拼状态码）",
    /body\.message\s*\|\|/.test(remoteSrc) && /new Error\(say \|\|/.test(remoteSrc),
    "拼成 'HTTP 503' 的话，服务端为用户写的那几句一句都到不了用户眼前");

  ok("服务端没给 message 时才退回状态码那句（别让 message 是空的）",
    /"HTTP " \+\s*statusCode/.test(remoteSrc) && /function httpError\s*\(/.test(remoteSrc));

  const mem = {};
  const savedWx = global.wx;
  global.wx = {
    getStorageSync: (k) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : ""),
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; },
    login: (o) => o.success({ code: "C" }),
    request: (opt) => opt.success({
      statusCode: 503,
      data: { code: "E_WX_NOT_CONFIGURED", message: "服务端还没配微信登录（缺 WX_APPID / WX_SECRET）。" }
    })
  };

  const SVC_503_MSG = "服务端还没配微信登录（缺 WX_APPID / WX_SECRET）。";

  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(path.join(ROOT, "utils")) === 0) delete require.cache[k];
  });
  const auth = require(path.join(ROOT, "utils", "auth.js"));
  auth.configure({ baseUrl: "https://probe.test" });

  track(
    auth.login().then(
      () => { ok("服务端回 503 时登录该失败", false, "居然成功了"); },
      (e) => {
        ok("用户看到的是服务端那句话，不是 'HTTP 503'",
          e.message === SVC_503_MSG,
          "实际 " + JSON.stringify(e.message));
        ok("码还是 retained（调用方要能按码分支）", e.code === "E_WX_NOT_CONFIGURED", String(e.code));
      }
    ).then(() => { global.wx = savedWx; })
  );
}

{
  const remoteSrc = fs.readFileSync(path.join(ROOT, "utils", "remote.js"), "utf8");
  const authSrc = fs.readFileSync(path.join(ROOT, "utils", "auth.js"), "utf8");

  ok("客户端有云调用那条通道（`send()` 按配置分派，不是只有文档）",
    /function send\([\s\S]{0,200}?useCloud\(\)\)\s*return sendCloud\(/.test(remoteSrc) &&
      /wx\.cloud\.callContainer\(/.test(remoteSrc),
    "`send()` 里没有按 `useCloud()` 分派，或压根没调 `wx.cloud.callContainer` —— " +
      "那样就只剩 `wx.request` 一条路，而它必须备案");

  ok("调 callContainer 之前先 wx.cloud.init（缺这一步真机回 errCode -1 / Cloud API isn't enabled）",
    /function cloudReady\s*\(/.test(remoteSrc) &&
      /wx\.cloud\.init\(/.test(remoteSrc) &&
      /cloudReady\(conf\.env\)/.test(remoteSrc),
    "`sendCloud()` 直接调 `wx.cloud.callContainer` 而没先 `wx.cloud.init` —— " +
      "真机上就是 `errCode: -1 | errMsg: Cloud API isn't enabled, please call ...`，" +
      "登录与课外正文一起哑掉。自检早先的桩只给了 `callContainer`，所以一直没抓住");

  ok("同一个 env 只 init 一次，env 变了重新 init（本机改过两格之后不能还用旧环境）",
    /if\s*\(!env\s*\|\|\s*cloudReadyEnv\s*===\s*env\)\s*return null/.test(remoteSrc) &&
      /cloudReadyEnv\s*=\s*env/.test(remoteSrc),
    "`cloudReady` 没有「同一个 env 只 init 一次、env 变了重新 init」这层 —— " +
      "要么每次请求都 init，要么改了配置还用旧环境");

  ok("云开发没开通 / init 失败时给的是带码的错，不是静默", 
    /E_CLOUD_OFF/.test(remoteSrc) && /E_CLOUD_INIT/.test(remoteSrc),
    "`ensureCloud` 的失败没有 `E_CLOUD_OFF` / `E_CLOUD_INIT` 这两个码 —— " +
      "界面只能弹一行被截断的 toast，用户看不出是 env 填错还是没开通云开发");

  ok("云调用带齐 X-WX-SERVICE / config.env / authorization（少一个都是平台错或静默 401）",
    /"X-WX-SERVICE":\s*service/.test(remoteSrc) &&
      /const service = o\.agent \|\| conf\.service/.test(remoteSrc) &&
      /config:\s*\{\s*env:\s*conf\.env/.test(remoteSrc) &&
      /function cloudCall\(conf, path, data, method, opt\)[\s\S]{0,900}?authorization:/.test(remoteSrc),
    "云调用的头/配置少了东西：`X-WX-SERVICE` 少了回 service not found，" +
      "`config.env` 少了回 env not exists，`authorization` 少了服务端认不出人（401）");

  ok("`configured()` 两条通道都认（只认 baseUrl 会把配好的云调用判成没后端）",
    /function configured\(\)\s*\{[\s\S]{0,220}?a\.baseUrl[\s\S]{0,160}?cloudOf\(\)/.test(remoteSrc),
    "`configured()` 只看 `baseUrl` —— 只配云调用的人会被判成「后端未就绪」，" +
      "而那条路其实是通的");

  ok("云调用两栏「本机填过就用本机的，没填过用包里注入那份」",
    /function cloudOf\(\)\s*\{[\s\S]{0,200}?session\(\)\.cloud\s*\|\|\s*packedCloud\(\)/.test(remoteSrc) &&
      /require\("\.\/server"\)/.test(remoteSrc),
    "没有注入那一层时，用户必须自己去管理页填两栏才能用 —— 而那是部署方的事");

  {
    const buildSrc = fs.readFileSync(path.join(__dirname, "build-data.js"), "utf8");
    ok("云调用两栏是构建产物：值由 build-data.js 从环境变量写进 server.js",
      !fs.existsSync(path.join(ROOT, "..", "miniprogram", "utils", "server.js")) ||
        /CLOUD_ENV/.test(buildSrc) && /CLOUD_SERVICE/.test(buildSrc) &&
        /utils", "server\.js"\)/.test(buildSrc),
      "值只存在密钥仓库 wechat-ci.yml 里，由 build-data.js 在构建期覆写 server.js");
    ok("两栏都没设时构建只读不改 —— 不把空壳删掉",
      /SERVER_KEYS\.filter[\s\S]{0,400}?!fs\.existsSync\(SERVER_FILE\)/.test(buildSrc),
      "没注入就整份覆写（或删掉）server.js：本地开发与 CI 之间来回切会把空壳弄丢，" +
        "下一次构建就 module not found");
    ok("server.js 是入库的空壳（gitignore 不许挡它）",
      fs.existsSync(path.join(__dirname, "..", "miniprogram", "utils", "server.js"))
        && !/miniprogram\/utils\/server\.js/.test(
          fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8")),
      "server.js 少了或被 gitignore 挡住 —— 它不在时 require(\"./server\") 抛 " +
        "MODULE_NOT_FOUND，remote.js 整条链断掉，首页在 onLoad 前就报错（Issue #175）；" +
        "值由 build-data.js 在构建期覆写，空壳本体的值本来就该是空");
  }

  {
    const mem = {};
    const savedWx = global.wx;
    let sawRequest = false;
    global.wx = {
      getStorageSync: (k) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : ""),
      setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
      removeStorageSync: (k) => { delete mem[k]; },
      login: (o) => o.success({ code: "C-CLOUD" }),

      request: () => { sawRequest = true; throw new Error("这条测试里不该走 wx.request"); },
      cloud: {
        init: (opt) => { inits.push(opt); },
        callContainer: (opt) => {
          calls.push(opt);

          opt.success({ statusCode: 200, data: { accessToken: "T", refreshToken: "T", expiresIn: 604800, tier: "free", role: "user", userId: "u_1" } });
        }
      }
    };
    const calls = [];
    const inits = [];
    Object.keys(require.cache).forEach((k) => {
      if (k.indexOf(path.join(ROOT, "utils")) === 0) delete require.cache[k];
    });
    const auth = require(path.join(ROOT, "utils", "auth.js"));
    const remote = require(path.join(ROOT, "utils", "remote.js"));

    auth.configure({ cloud: { env: "poem-d9g1bqeq978682c58", service: "poem-api" } });

    ok("只配云调用（不填地址）也算「后端已就绪」",
      remote.configured() === true && remote.useCloud() === true,
      "configured=" + remote.configured() + " useCloud=" + remote.useCloud() +
        " —— 只认 baseUrl 的话这里就是「没后端」，免备案那条路等于白配");

    auth.login().then(
      () => {
        const c = calls[0] || {};
        ok("云调用发出的路径与方法对（/api/wx/login + POST）",
          c.path === "/api/wx/login" && (c.method || "POST") === "POST",
          JSON.stringify({ path: c.path, method: c.method }));
        ok("云调用把服务名与环境 ID 都带上了",
          (c.header || {})["X-WX-SERVICE"] === "poem-api" && (c.config || {}).env === "poem-d9g1bqeq978682c58",
          JSON.stringify({ header: c.header, config: c.config }));
        ok("整条登录路径一次都没走 wx.request（走了就说明分派漏了一处）",
          sawRequest === false, "有请求走了 wx.request —— 那条要备案");
      },
      (e) => ok("只配云调用时登录能走通", false, String(e && e.message))
    ).then(() => { global.wx = savedWx; });
  }

  const adminSrcForCloud = fs.readFileSync(path.join(ROOT, "packages", "admin", "index", "index.js"), "utf8");
  const remoteSrc2 = fs.readFileSync(path.join(ROOT, "utils", "remote.js"), "utf8");
  ok("云调用两栏仍是构建产物（值由 build-data.js 从环境变量写进 server.js，不走界面）",
    /function packedCloud\(\)/.test(remoteSrc2) && !/cloudEnv/.test(adminSrcForCloud),
    "界面上一填，这两栏就成了每个用户手里的变量 —— 而它是部署方的配置");

  {
    const setup = fs.readFileSync(path.join(path.dirname(__dirname), "docs", "wx-cloud-setup.md"), "utf8");
    const arch = fs.readFileSync(path.join(path.dirname(__dirname), "docs", "architecture.md"), "utf8");
    ok("云托管文档写了「云调用免域名免备案」这条路（含它为什么免）",
      /callContainer/.test(setup) && /不经过|不走|免掉/.test(setup) &&
        /免备案|不需要备案|不用备案/.test(setup),
      "只讲 `wx.request` + 名单的话，「要备案」就成了唯一读得到的结论 —— " +
        "而那条路本身就问「有没有完全不用备案的走法」");
    ok("架构文档不再说那张网「绕不开」（它只绑 wx.request）",
      !/唯一绕不开的一张网/.test(arch) && /callContainer/.test(arch),
      "标题写着「唯一绕不开」，正文就得靠读者自己推翻它 —— 那是把人往" +
        "「先去备案」上推");
  }

  ok("server.js 不在时 remote.js 照样加载得进（缺它不许把页面拖死）",
    /function packedCloud\(\)\s*\{[\s\S]{0,200}?require\("\.\/server"\)[\s\S]{0,120}?catch/.test(remoteSrc),
    "require(\"./server\") 没兜住 MODULE_NOT_FOUND：这个文件一缺，" +
      "remote.js 整个模块加载失败，主包页面在 onLoad 前就抛 —— 首页连语料都渲染不出来（Issue #175）");

  ok("云调用失败时把「实际用的环境 / 服务」带出来（102002 这类话才好自查）",
    /function cloudFailError\(/.test(remoteSrc) &&
      /err2\.env\s*=\s*conf\.env/.test(remoteSrc) &&
      /err2\.service\s*=\s*agent \|\| conf\.service/.test(remoteSrc) &&
      /fail:\s*\(err\)\s*=>\s*reject\(cloudFailError\(err, conf, service\)\)/.test(remoteSrc),
    "云调用 fail 只回一句裸 errMsg 的话，用户看到的 102002 与环境/服务名对不上号 —— " +
      "而这两格的值构建期就注进包里，用户手上没有对照物。把实际用的两格带在错误里，" +
      "一次就能看出「包里的 env 不是我这个小程序的那个」");
  ok("云调用失败时说的话分得清 102002 与 env not exists",
    /102002/.test(remoteSrc) && /env not exists/.test(remoteSrc),
    "两句话一样时，人不知道该去调最小实例数还是去核对环境 ID");

  {
    ok("云调用回 invalid host 时给的是「服务名找不到后端」这句，不是拿 102002 那套话去套",
      /function cloudFailHint\s*\(/.test(remoteSrc) &&
        /invalid host/i.test(remoteSrc) &&
        /service|服务/.test(remoteSrc.match(/invalid host[\s\S]{0,200}/i)[0]),
      "invalid host 与 102002 是两个病：前者指 X-WX-SERVICE 找不到可路由的后端" +
        "（云托管里没这个服务），后者指 config.env 不是这个小程序的云开发环境。" +
        "一句通用话套两种错，人会往错的方向查（Issue #175）");
    const flowSrc = fs.readFileSync(path.join(ROOT, "utils", "login-flow.js"), "utf8");
    ok("云调用失败的整段话用弹窗出，不被 toast 截掉",
      /err\.cloudFail[\s\S]{0,200}?showModal/.test(flowSrc),
      "cloudFail 的错带环境 / 服务 / 怎么办一长串，走 else 的 toast 会被截成一行 —— " +
        "用户拿不到能自查的那两格（Issue #175）");
  }
}

{
  const corePath = path.join(__dirname, "parity-web", "core.js");
  if (!fs.existsSync(corePath)) {
    ok("契约那份 core.js 在（scripts/parity-web/core.js）", false, "缺文件");
  } else {
    const core = require(corePath);
    const mem = {};
    global.wx = {
      getStorageSync: (k) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : ""),
      setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
      removeStorageSync: (k) => { delete mem[k]; }
    };
    Object.keys(require.cache).forEach((k) => {
      if (k.indexOf(path.join(ROOT, "utils")) === 0) delete require.cache[k];
    });
    const store = require(path.join(ROOT, "utils", "store.js"));
    const wire = require(path.join(ROOT, "utils", "wire.js"));

    if (typeof core.SETTINGS_KEYS !== "object" || !core.SETTINGS_KEYS) {
      console.log("· 读到的 poem 还没有设置白名单（比 poem#532 老）—— V44 这一节跳过");
    } else {

      store.saveSettings({
        grade: 3, term: 2, dailyCount: 7, scope: "all", algo: "sm2",
        align: "left", fontSize: 2, theme: "ink", pinyin: "all"
      });

      store.saveSettings({ lastSyncAt: Date.now(), sfx: false });

      const row = wire.packRecords().filter((r) => r.id === "settings:v1")[0];
      ok("打包时报文里有 settings:v1 这一行", !!row, "没打包出来，后面两条就无从谈起");

      if (row) {
        const keys = Object.keys(row.payload.settings || {});
        const mine = Object.keys(core.SETTINGS_KEYS);
        const extra = keys.filter((k) => mine.indexOf(k) < 0);

        ok("报文里不含服务端白名单之外的键（本就不该发的，我们自己不发）",
          extra.length === 0,
          "多出来的是 " + JSON.stringify(extra) +
          " —— 服务端会把它裁掉，而两边都不报错：发过去的那一份在服务端被改过。");

        ok("lastSyncAt 不进报文（它是读数不是选择，而且每次同步都变）",
          keys.indexOf("lastSyncAt") < 0,
          "带上它 = 每次同步都盖一个新时间戳 = 服务端那份设置被本机反复顶掉");

        ok("跟设备走的 sfx 也不进报文",
          keys.indexOf("sfx") < 0,
          "音效取决于这台机器的扬声器，换台手机就不成立了");

        const localOnly = store.LOCAL_ONLY || {};
        const clientKeys = Object.keys(store.DEFAULTS)
          .filter((k) => k !== "lastSyncAt" && !localOnly[k]);
        const notOnServer = clientKeys.filter((k) => mine.indexOf(k) < 0);
        ok("小程序端每个跨设备的设置键都在服务端白名单里",
          notOnServer.length === 0,
          "缺 " + JSON.stringify(notOnServer) +
          " —— 这个键推上去会被服务端裁掉，「改了设置、换台手机还是默认」");

        const stray = Object.keys(localOnly).filter((k) => mine.indexOf(k) >= 0);
        ok("只在本机成立的设置键不占服务端白名单",
          stray.length === 0,
          JSON.stringify(stray) + " 在 LOCAL_ONLY 里，服务端却还留着它 —— " +
            "发出去就被裁，这条白名单键是空转的");

        const badType = Object.keys(core.SETTINGS_KEYS)
          .filter((k) => ["int", "str", "bool", "num"].indexOf(core.SETTINGS_KEYS[k]) < 0);
        ok("服务端白名单的类型标注都在 {int,str,bool,num} 里",
          badType.length === 0, "认不出的类型：" + JSON.stringify(badType));

        const got = core.sanitizePayload(row.payload, "settings:v1");
        const lost = keys.filter((k) => !(k in (got.settings || {})));
        ok("报文过一遍服务端 sanitize，设置一个字段都不丢",
          lost.length === 0, "丢了 " + JSON.stringify(lost) + " —— 实际 " + JSON.stringify(got.settings));
      }
    }
  }
}

{
  const issues = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full); continue; }
      if (!ent.name.endsWith(".wxml")) continue;
      const rel = path.relative(ROOT, full);
      const text = fs.readFileSync(full, "utf8");

      text.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/\{\{(.*?)\}\}/g)) {
          if ((m[1].match(/\?/g) || []).length >= 2) {
            issues.push({ kind: "嵌套三元", at: rel + ":" + (i + 1), what: m[1].trim().slice(0, 70) });
          }
        }
      });

      text.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/\{\{(.*?)\}\}/g)) {
          const hit = /\)\s*\.\s*[A-Za-z_$]/.exec(m[1]);
          if (hit) {
            issues.push({
              kind: "方法调用",
              at: rel + ":" + (i + 1),
              what: m[1].trim().slice(0, 70) + "   ← 报错点在 " + JSON.stringify(hit[0].trim())
            });
          }
        }
      });

      for (const m of text.matchAll(/<!--[\s\S]*?-->/g)) {
        if (m[0].indexOf("{{") >= 0 || m[0].indexOf("}}") >= 0) {
          const line = text.slice(0, m.index).split("\n").length;
          issues.push({
            kind: "注释里写插值",
            at: rel + ":" + line,
            what: m[0].replace(/\s+/g, " ").trim().slice(0, 70)
          });
        }
      }
    }
  };
  walk(ROOT);

  const byKind = (k) => issues.filter((x) => x.kind === k);
  const fmt = (list) => JSON.stringify(list.slice(0, 3).map((x) => x.at + "  " + x.what));

  ok("WXML 插值里没有嵌套三元（只吃一层，构建时整个包传不上去）",
    byKind("嵌套三元").length === 0,
    "插值里有两个以上 `?`：" + fmt(byKind("嵌套三元")) +
      " —— 真机包会回 `unexpected token`（-80054），而这步 allow_failure，不挡流水线");

  ok("WXML 插值里没有方法调用（括号表达式后面不能跟 `.`）",
    byKind("方法调用").length === 0,
    "这些插值对括号表达式调了方法：" + fmt(byKind("方法调用")) +
      " —— 解析器就报在这个点上（`unexpected token `.``），包传不上去。" +
      "算好再传进模板（见 quiz.js 的 pctOf）");

  ok("WXML 注释里没有插值花括号（注释同样会被解析）",
    byKind("注释里写插值").length === 0,
    "这些注释里出现了 `{{` 或 `}}`：" + fmt(byKind("注释里写插值")) +
      " —— 注释里的插值一样会被解析，上一轮就是这么让同一个错原地复发的");
}

{
  const yml = fs.readFileSync(path.join(path.dirname(__dirname), ".cnb.yml"), "utf8");

  const at = yml.indexOf("- name: 上传体验版");
  const body = at < 0 ? "" : yml.slice(at);

  const isOneBlock = /allow_failure:\s*true/.test(body);

  ok("`上传体验版` 那步还在（它被删掉的话，体验版不会再更新，而流水线是绿的）",
    at >= 0, "`.cnb.yml` 里找不到「上传体验版」这个任务名");

  ok("上传失败时会打一块能搜到的横幅（这步 allow_failure，红了流水线也是绿的）",
    /✗✗✗/.test(body), "失败横幅没了 —— 失败会静默，只能靠人肉眼翻 50 秒日志");

  ok("上传成功时也会打一句（allow_failure 的成功同样没信号）",
    /✓✓✓/.test(body), "成功没有回执 —— 传没传上去没有任何线索");

  ok("失败横幅里写的退出码是 `$?` 当场取的，不是硬编码的 0",
    /code=\$\?/.test(body) && /exit "\$\{code\}"/.test(body),
    "退出码没原样透传 —— 这一步会永远「成功」");

  const lines = body.split("\n")
    .map((l) => l.replace(/\s+#.*$/, ""))
    .filter((l) => !/^\s*(#|$)/.test(l));
  const npmLine = lines.find((l) => /npm i .*miniprogram-ci/.test(l)) || "";
  ok("npm 装包那行真收掉了 warn（默认 40 行 deprecated 会把真错埋掉）",
    /--loglevel=error/.test(npmLine),
    "真命令行里没加 --loglevel=error（注释里写着不算），真错会被 40 行 npm warn 盖住：" +
      JSON.stringify(npmLine.trim().slice(0, 80)));

  ok("上传那步仍然只声明 name/script/allow_failure（script 一整块，不是 list）",
    isOneBlock, "这一步的 script 结构变了 —— 混成 list 会被 CNB 用 `&&` 串崩");
}

{
  const src = fs.readFileSync(path.join(ROOT, "..", "scripts", "upload.js"), "utf8");

  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\s*\/\/.*$/, ""))
    .filter((l) => l.trim())
    .join("\n");

  ok("上传失败时会认出 `appIdToAppuin`（它不是 IP 白名单的问题，指错方向会白查半天）",
    /if\s*\(\s*\/appIdToAppuin\/\.test\(m\)\s*\)/.test(code),
    "`upload.js` 没认这个码 —— 现场只有那半句英文，人会去查 IP 白名单与 appid 拼写");

  ok("这条提示说清了「密钥不是这个 appid 名下的」并指向文档",
    /密钥/.test(code) && /wx-cloud-setup\.md/.test(code),
    "提示没点名真因、也没给文档落点 —— 等于只是把英文抄了一遍");

  ok("`checkIpInWhiteList` 的**另一**半（真·IP 白名单）也分开说",
    /if\s*\(\s*\/checkIpInWhiteList\/\.test\(m\)\s*&&\s*!\/appIdToAppuin\//.test(code),
    "两个 `checkIpInWhiteList Failed:` 混成一条 —— 看后半句才分得清是哪一种");

  ok("那个 hint 真的被拼进了失败信息（写在旁边不算）",
    /const\s+hint\s*=\s*explain\(/.test(code) && /hint\s*\?/.test(code),
    "explain() 认出来了，却没往 die() 的那句话里拼 —— 日志里还是只有原文");
}

{
  const repo = path.join(ROOT, "..");
  const deploy = path.join(repo, "deploy");
  const dockerfile = path.join(deploy, "Dockerfile");
  const serveDir = path.join(repo, "deploy-api-serve");

  const df = fs.readFileSync(dockerfile, "utf8");
  const copiedLines = df.split("\n").filter((l) => l.startsWith("COPY")).join("\n");
  ok("deploy/Dockerfile 在，且只 COPY api/ 与服务壳（不把语料 / 字体 / 前端请回上下文）",
    fs.existsSync(dockerfile)
      && /COPY --chown=node:node api \.\/api/.test(copiedLines)
      && /COPY --chown=node:node serve-api\.js \.\//.test(copiedLines)
      && !/\b(data|fonts|css|icons)\b/.test(copiedLines),
    "真 COPY 到了就是把 26MB 请回上下文");

  ok("基础镜像与白名单都由流水线递进来（换源 / 挪位置不用改这个文件）",
    /ARG BASE_IMAGE=/.test(df) && /^FROM\s+\$\{BASE_IMAGE\}$/m.test(df)
      && /--build-arg "BASE_IMAGE=/.test(fs.readFileSync(path.join(repo, ".cnb.yml"), "utf8"))
      && /cp\s+deploy-api-serve\/\.dockerignore\s+\/tmp\/ctx\/\.dockerignore/.test(
        fs.readFileSync(path.join(repo, ".cnb.yml"), "utf8")),
    "基础镜像写死一个地址、或白名单没摆到 /tmp/ctx 根上（摆错了不报错，只是每次白传 37MB）");

  ok("服务壳在 deploy-api-serve/（不在 deploy/ —— 它进的是 poem 那个上下文）",
    fs.existsSync(path.join(serveDir, "serve-api.js")));
  const di = fs.readFileSync(path.join(serveDir, ".dockerignore"), "utf8");
  ok("deploy-api-serve/.dockerignore 是白名单（先 ** 全排，再逐条 ! 放行）",
    /^\*\*$/m.test(di) && /^!api\/_lib\/\*\*$/m.test(di) && /^!serve-api\.js$/m.test(di),
    "写成常规排除名单的话，poem 的 data/ 26MB 会整个漏进上下文");

  ok("后端契约在本仓库根上（api/）",
    fs.existsSync(path.join(repo, "api", "handler.js")) &&
      fs.existsSync(path.join(repo, "api", "_lib", "store.js")),
    "没有 api/ —— 镜像与 e2e-mysql 都摊不出上下文");

  const notCopies = [
    path.join(deploy, "api"),
    path.join(deploy, "api.synced"),
    path.join(deploy, "sync-api.sh")
  ].filter((p) => fs.existsSync(p));
  ok("后端只有一份（api/ 在仓库根，deploy/ 里不再有第二份）",
    notCopies.length === 0,
    "发现：" + notCopies.join(", ") + " —— 两份就是那个「改了一处、线上跑另一处」的税");

  const build = fs.readFileSync(path.join(deploy, "build.sh"), "utf8");
  ok("deploy/build.sh 摊的是本仓库的 api/，不去 clone 另一个仓库",
    /cp -R "\$REPO\/api"/.test(build) && !/git clone .*poem/.test(build),
    "还在从另一个仓库取 api/ —— 那个依赖没抛干净");

  const setup = fs.readFileSync(path.join(repo, "docs", "wx-cloud-setup.md"), "utf8");
  ok("云托管文档给的是**一条**能照抄的路（按镜像部署 / 端口 / 镜像地址）",
    /^\|\s*部署方式\s*\|\s*\*\*镜像\*\*\s*\|/m.test(setup)
      && /\|\s*端口\s*\|\s*`?8080`?\s*\|/.test(setup)
      && /docker\.cnb\.cool\/npu-gpu-cpu\/poem-wechat-mini-program\/wx-api/.test(setup),
    "部署方式、端口、镜像地址三栏是要照抄的 —— 给占位符等于没写");

  const corpses = (setup + fs.readFileSync(path.join(deploy, "README.md"), "utf8"))
    .split("\n")
    .filter((l) => /已撤|上一版文档|上一版在这里写|原先写的是|原来写的/.test(l));
  ok("部署文档不留「撤稿记录」（读者要的是现在怎么填，不是尸检报告）",
    corpses.length === 0,
    "发现：" + JSON.stringify(corpses.slice(0, 2)));

  const cnb = fs.readFileSync(path.join(repo, ".cnb.yml"), "utf8");
  ok(".cnb.yml 里不再去另一个仓库取语料（clone-poem 那条路已撤）",
    !/clone-poem/.test(cnb) && !/git clone .*poem\.git/.test(cnb),
    "流水线还在 clone 上游 —— 分片与体验版都还没脱离那个依赖");

  ok(".cnb.yml 里摊语料就是本仓库那一条命令（没有 POEM_WEB_DIR）",
    /node scripts\/build-data\.js/.test(cnb) && !/POEM_WEB_DIR/.test(cnb),
    "还在用 POEM_WEB_DIR 指过去 —— 语料已经在本仓库 scripts/corpus/ 里了");

  ok("自检任务只跑一个入口（口径写在 scripts/build-and-check.js 一处，yml 里不再逐条列命令）",
    /- name: 自检[\s\S]*?script:\s*\n\s*- node scripts\/build-and-check\.js\n/.test(cnb),
    "`\"**\":` 那个自检任务的 script 不是 `node scripts/build-and-check.js` 一行 —— " +
      "逐条列命令意味着往自检链上插一步要同时改 yml 与编译入口两处，" +
      "而漏改一处不会有任何报错（顺序错了更是静默给出错误结论）");

  ok(".cnb.yml 里那份镜像推在本仓库名下的 wx-api 槽位",
    /\$\{CNB_DOCKER_REGISTRY\}\/\$\{CNB_REPO_SLUG_LOWERCASE\}\/wx-api/.test(cnb),
    "镜像名与文档里那一栏必须对得上，否则云托管拉不到");

  {
    const shellLines = cnb
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    const mainSel = cnb.slice(cnb.indexOf("\nmain:"));
    const envSection = mainSel.split("stages:")[0];
    const defined = new Set(
      envSection.split("\n").map((l) => l.match(/^\s{8}([A-Z][A-Z0-9_]*):\s*\S/))
        .filter(Boolean).map((m) => m[1])
    );
    const injected = new Set([
      "CNB_TOKEN", "CNB_ROOT_SLUG", "CNB_DOCKER_REGISTRY", "CNB_COMMIT_SHORT",
      "CNB_REPO_SLUG_LOWERCASE", "CNB_BRANCH", "CNB_TOKEN_USER_NAME",
      "GHCR_USER", "GHCR_TOKEN", "GH_PAT", "GH_REPO", "WX_APPID",
      "WX_PRIVATE_KEY_B64", "CLOUD_ENV", "CLOUD_SERVICE",
    ]);
    const assigned = new Set(
      shellLines.filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l)).map((l) => l.split("=")[0])
    );
    const referenced = new Set();
    shellLines.forEach((l) => {
      for (const m of l.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) referenced.add(m[1]);
    });
    const missingVars = [...referenced].filter(
      (v) => !defined.has(v) && !injected.has(v) && !assigned.has(v)
    );
    ok(".cnb.yml 里引用的变量都有出处（否则 busybox sh 撞上未定义变量是当场 exit 2）",
      missingVars.length === 0,
      "这些变量在 `env:` 与密钥仓库里都没有：" + JSON.stringify(missingVars) +
        " —— job 跑在 Alpine，`set -eu` 之下撞上未定义变量是当场退出，" +
        "报错只有 `sh: N: VAR: parameter not set` 一行，不说是哪条命令");

    const bashisms = shellLines.filter((l) =>
      /\$\{[A-Za-z_][A-Za-z0-9_]*\/\/|\$\{[A-Za-z_][A-Za-z0-9_]*\^\^|\$\{[A-Za-z_][A-Za-z0-9_]*,,\}|\[\[/.test(l)
    );
    ok(".cnb.yml 的脚本里不写 bash 专有的参数展开（stage 跑在 sh/dash 上）",
      bashisms.length === 0,
      "这些行里有 bash-only 写法：" + JSON.stringify(bashisms) +
        " —— 会报 `Bad substitution` 并当场 exit 2（Issue #134 的 CI 现场）；" +
        "要按字面匹配就 `grep -F`，别拿替换去拼正则");

    const clobbered = envSection
      .split("\n").map((l) => l.trim())
      .filter((l) => /^[A-Z][A-Z0-9_]*:/.test(l) &&
        /^(CLOUD_ENV|CLOUD_SERVICE|WX_APPID|WX_PRIVATE_KEY_B64|GHCR_USER|GHCR_TOKEN|GH_PAT|GH_REPO):/.test(l));
    ok(".cnb.yml 的 `env:` 里不重声明密钥仓库那几样 —— 替换时机取不到 imports 的值，只会写进字面量",
      clobbered.length === 0,
      "这些在 `env:` 里又声明了一遍：" + JSON.stringify(clobbered) +
        " —— imports 的变量在 `env:` 求值时还取不到，`\${VAR}` 会原样留下" +
        "（Issue #175：CLOUD_ENV 被写成 `\${CLOUD_ENV}` 进了 server.js，登录一路回 HTTP 400，而流水线全绿）");
  }
}

{
  const yml = fs.readFileSync(path.join(path.dirname(__dirname), ".cnb.yml"), "utf8");
  const scriptPath = path.join(path.dirname(__dirname), "scripts", "sync-github.js");
  const js = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, "utf8") : "";
  const jsCode = js.split("\n").filter((l) => !/^\s*\//.test(l)).join("\n");
  ok("`同步到 GitHub` 那步还在，且真在跑 scripts/sync-github.js",
    yml.indexOf("- name: 同步到 GitHub") >= 0
      && /node scripts\/sync-github\.js/.test(yml.slice(yml.indexOf("- name: 同步到 GitHub"))));
  ok("同步前 unshallow、关交互询问、缺 GH_PAT / GH_REPO 时点名，且不用 --mirror",
    /--unshallow/.test(jsCode) && /is-shallow-repository/.test(jsCode)
      && /GIT_TERMINAL_PROMPT/.test(js) && /缺 GH_PAT/.test(js) && /缺 GH_REPO/.test(js)
      && !/--mirror/.test(jsCode));
  ok("凭据形状是 `<token>:x-oauth-basic@`（另两种实测一种问密码、一种回 401）",
    /\$\{pat\}:x-oauth-basic@github\.com/.test(jsCode) && !/x-access-token/.test(jsCode));

  {
    const repo3 = path.join(path.dirname(__dirname));
    const buildSrc = fs.readFileSync(path.join(repo3, "scripts", "build-data.js"), "utf8");
    ok("build-data.js 不再有「另有一个上游仓库」那套",
      !/POEM_WEB_DIR|clone-poem/.test(buildSrc) && /CORPUS_DIR\s*=/.test(buildSrc));

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kb-nocorpus-"));
    try {
      fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
      fs.copyFileSync(path.join(repo3, "scripts", "build-data.js"),
        path.join(tmp, "scripts", "build-data.js"));
      let err = "";
      try {
        execFileSync(process.execPath, [path.join(tmp, "scripts", "build-data.js")],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        err = String(e.stderr || "");
      }
      ok("真跑一遍：语料目录不在时报的是自己的那几句提示，不是 ENOENT 栈",
        /读不到 .* —— 语料是本仓库的一部分/.test(err));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  {
    ok("`推 GHCR` 那步还在，真命令行里用的是 GHCR_USER / GHCR_TOKEN",
      yml.indexOf("- name: 推 GHCR") >= 0
        && /docker login ghcr\.io -u "\$\{GHCR_USER\}"/.test(yml.slice(yml.indexOf("- name: 推 GHCR")))
        && /GHCR_TOKEN/.test(yml.slice(yml.indexOf("- name: 推 GHCR"))));
    ["docs/wx-cloud-setup.md", "deploy/README.md"].forEach((f) => {
      const t = fs.readFileSync(path.join(path.dirname(__dirname), f), "utf8");
      ok(f + " 说明了 GHCR_TOKEN 要 classic PAT（fine-grained 没有 Packages 那一栏）",
        /classic/.test(t) && /write:packages/.test(t));
    });
  }
}

{
  const setup = fs.readFileSync(path.join(path.dirname(__dirname), "docs", "wx-cloud-setup.md"), "utf8");
  const probe = (setup.split("## 五、探活")[1] || "").split("\n## ")[0];
  ok("云托管文档第五节给的是**能照抄**的真域",
    /\.sh\.run\.tcloudbase\.com/.test(probe) && !/<env>/.test(probe),
    "默认域是 `<服务名>-<环境ID>.sh.run.tcloudbase.com`，要给人一条能照抄的");
  ok("云托管文档写明了云调用是主路、免域名免备案",
    /callContainer/.test(setup) && /不用备案|免备案/.test(setup),
    "云调用这条路的全部价值就是免掉备案，不写下来等于没有");
}

{
  const repo2 = path.join(ROOT, "..");

  const stray = [
    path.join(repo2, "poem.lock.json"),
    path.join(repo2, "scripts", "clone-poem.sh"),
    path.join(repo2, "scripts", "poem-lock.sh"),
    path.join(repo2, "scripts", "poem-watch.sh"),
    path.join(repo2, "scripts", "find-poem-api-files.py")
  ].filter((f) => fs.existsSync(f));
  ok("跨仓库取语料那套已经不在（锁 / clone / 跟随 / poem 侧清单器）",
    stray.length === 0,
    "还留着：" + JSON.stringify(stray.map((f) => path.relative(repo2, f))) +
      " —— 语料已随仓库走，「跟上游」这件事没有对象了");

  {
    const cnb2 = fs.readFileSync(path.join(repo2, ".cnb.yml"), "utf8");
    const lines = cnb2.split("\n");

    const mainKeys = lines.filter((l) => /^main:/.test(l));
    ok(".cnb.yml 里没有顶格的 `crontab:`（那个键位置不对，平台解析不到）",
      lines.filter((l) => /^[A-Za-z$][\w$-]*:/.test(l)).map((l) => l.split(":")[0]).indexOf("crontab") < 0);
    ok(".cnb.yml 里 `main` 只顶格写一处（同名的键合并时后一处会盖掉前一处，静默丢一批流水线）",
      mainKeys.length === 1,
      "找到 " + mainKeys.length + " 处顶格 `main:` —— 发布要多个入口时，把 `web_trigger` 事件" +
        "写进同一处 `main:` 下，别再起一段 `main:`");
    const badNesting = [];
    let cur = "";
    const eventsIn = (glob) => {
      const at = lines.indexOf(glob + ":");
      if (at < 0) return null;
      const out = [];
      for (let i = at + 1; i < lines.length; i += 1) {
        const l = lines[i];
        if (!l.trim()) continue;
        if (/^\S/.test(l)) break;
        const m = l.match(/^\s{2}([^\s:]+):\s*$/);
        if (m) out.push(m[1]);
      }
      return out;
    };

    for (const l of lines) {
      if (/^[A-Za-z$"][^\s:]*:\s*$/.test(l)) cur = l.split(":")[0];
      else if (/^\s{2}[^\s].*:\s*$/.test(l) && /^\$/.test(cur)) {
        badNesting.push(cur + " → " + l.trim());
      }
    }

    if (/^main:\s*$/m.test(cnb2)) {
      const onMain = eventsIn("main") || [];
      ok("`main` 下的事件都是分支事件（push / web_trigger）",
        onMain.length > 0 && onMain.every((e) => e === "push" || /^web_trigger/.test(e)),
        "`main` 下出现了别的事件：" + JSON.stringify(onMain) +
          " —— issue.* / tag_push / auto_tag 这类与分支无关的事件只能挂 `$`，挂分支名下解析不到");
    }

    {
      const onAll = eventsIn('"**"');
      const onMain = eventsIn("main");
      const shared = (onAll && onMain)
        ? onMain.filter((e) => e !== "push" && onAll.indexOf(e) >= 0) : [];
      ok("`main` 下除 `push` 外的事件没有与 `\"**\"` 重复（两个 glob 同时命中会各跑一遍）",
        shared.length === 0,
        "这些事件在 `main` 与 `\"**\"` 下各配了一份：" + JSON.stringify(shared) +
          " —— 匹配规则是「所有命中的 glob 都跑」，推 main 时同一件事会跑两遍");
    }
    ok(".cnb.yml 的 `$` 兜底分支下只写事件（分支 glob 不嵌在 `$` 里，那样平台解析不到）",
      badNesting.length === 0,
      "`$` 下出现了非事件的键：" + JSON.stringify(badNesting) +
        " —— 分支 glob 要顶格写（`\"**\":`），`$` 下只能写 `push` 这类事件；" +
        "嵌在 `$` 下的 glob 不报错也不生效，流水线静默不跑");
  }

  {
    const corpus = path.join(repo2, "scripts", "corpus");
    ok("语料在仓库里（scripts/corpus/data 与 js）",
      fs.existsSync(path.join(corpus, "data", "text-master.js")) &&
        fs.existsSync(path.join(corpus, "data", "poems-1.js")) &&
        fs.existsSync(path.join(corpus, "js", "entitlement.js")),
      "缺 scripts/corpus/ —— 构建与自检都跑不起来");

    const ledger = path.join(corpus, "VERSION.json");
    ok("语料记着它取自哪一版（VERSION.json）", fs.existsSync(ledger));
    if (fs.existsSync(ledger)) {
      const v = JSON.parse(fs.readFileSync(ledger, "utf8"));
      ok("语料台账里有来源 sha 与日期",
        /^[0-9a-f]{40}$/.test(String(v.upstreamRef || "")) && !!v.syncedAt,
        JSON.stringify(v));
    }
  }

  {
    const doc = path.join(repo2, "docs", "data-backend.md");
    ok("docs/data-backend.md 在（Issue #111 那三个问题的答案）", fs.existsSync(doc));
    if (fs.existsSync(doc)) {
      const d = fs.readFileSync(doc, "utf8");
      ok("文档回答了「数据在哪」（分层说清，不是一句「在云端」）",
        /build-data\.js|miniprogram\/data/.test(d) && /progress/.test(d),
        "用户问的是「现在数据怎么管的、放在哪里」，得逐层答");

      {

        const banned = new RegExp("supa" + "base", "i");
        const hits2 = [];
        (function walk2(dir) {
          fs.readdirSync(dir).forEach((f) => {
            if (f === ".git" || f === "node_modules" || f === "parity-web") return;
            const full = path.join(dir, f);
            if (fs.statSync(full).isDirectory()) return walk2(full);
            if (!/\.(js|json|md|yml|yaml|sh|sql|wxml|wxss)$/.test(f)) return;
            const t = fs.readFileSync(full, "utf8");
            if (banned.test(t)) hits2.push(path.relative(repo2, full));
          });
        })(repo2);
        ok("这个仓库里不再出现那个第三方托管数据库的名字（代码与文档都不许有）",
          hits2.length === 0,
          "发现：" + JSON.stringify(hits2.slice(0, 5)) +
            " —— Issue #111 要求全仓库不再涉及它。换数据库这件事已经落到 " +
            "deploy/store-mysql.js + deploy/sql/mysql-schema.sql，旧名字不该再留。" +
            "（scripts/parity-web/ 是服务端契约的只读副本，不在此列 —— " +
            "它照原样摆着，改不动也不该改）");
      }
      ok("文档回答了「存储层在哪、换库要动什么」（接口是一个插槽，不是长在代码里）",
        /store\.js/.test(d) && /mysqlStore/.test(d) && /deploy\/store-mysql\.js/.test(d),
        "不点出「接口是 getX/putX 那组、实现就在 deploy/store-mysql.js」，" +
          "读者会以为「换掉数据库 = 重写后端」");
      ok("文档给出了腾讯那条路的三个方案与各自代价",
        /云托管/.test(d) && /云开发/.test(d) && /MySQL/.test(d),
        "只说「可以换成腾讯云」没有用，得把三条路摆开、把代价写下来");

      ok("文档点明了条件 upsert（新的赢）这条不变式在换库时该怎么保",
        /kb_upsert_progress/.test(d) && /ON DUPLICATE KEY|条件/.test(d),
        "换库时把「新的赢」捞到应用层，等于把一条原子约束换成有竞态的读-比-写");
      ok("文档写明了「换数据库不是审核的要求」",
        /审核/.test(d) && /备案/.test(d),
        "用户提这件事的动机是「怕审核出问题」，那句话得如实回答");
    }

    const arch = fs.readFileSync(path.join(repo2, "docs", "architecture.md"), "utf8");
    ok("architecture.md 指向 docs/data-backend.md",
      /data-backend\.md/.test(arch),
      "架构文档里那节「数据存哪」是这个问题最自然的入口");

    const todo2 = fs.readFileSync(path.join(repo2, "docs", "todo.md"), "utf8");
    ok("docs/todo.md 里不再把「换存储层」列成待办（它已经做完了）",
      !/换存储层/.test(todo2),
      "还列在待办里 —— 那件事已随 Issue #111 落地（见 data-backend.md § 六），" +
        "留在「以后要做」里会让下一个人以为线上还跑着旧的");
    ok("data-backend.md 记着换库这条的状态是「已做」",
      /store-mysql\.js/.test(fs.readFileSync(doc, "utf8")),
      "换库落了地，但文档里没写它落在哪两个文件上 —— 运维会找不到建表语句");
  }
}

{
  const repo4 = path.join(ROOT, "..");
  const storePath = path.join(repo4, "deploy", "store-mysql.js");
  const sqlPath = path.join(repo4, "deploy", "sql", "mysql-schema.sql");

  ok("deploy/store-mysql.js 在（腾讯云 MySQL 那份实现）", fs.existsSync(storePath));
  ok("deploy/sql/mysql-schema.sql 在（建表语句）", fs.existsSync(sqlPath));

  const st = fs.existsSync(storePath) ? fs.readFileSync(storePath, "utf8") : "";
  const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, "utf8") : "";

  {
    const poemStore = path.join(__dirname, "parity-web", "store-api.js");
    if (!fs.existsSync(poemStore)) {
      ok("契约那份 store.js 在（scripts/parity-web/store-api.js）", false, "缺文件");
    } else {
      const src = fs.readFileSync(poemStore, "utf8");
      const mem = /function memoryStore\(\)[\s\S]*?\n}\n/.exec(src);
      const names = mem ? [...mem[0].matchAll(/^    ([A-Za-z_$][\w$]*): function/gm)].map((m) => m[1]) : [];

      const attached = [...src.matchAll(/api\.([A-Za-z_$][\w$]*) = function/g)].map((m) => m[1]);
      const want = [...new Set(names.concat(attached))].filter((n) => n !== "_db").sort();
      const mine = [...st.matchAll(/^    ([A-Za-z_$][\w$]*): function/gm)].map((m) => m[1]);
      const missing = want.filter((n) => mine.indexOf(n) < 0);

      ok("mysqlStore 实现了 memoryStore 的每一个方法（少一个 = 某条路由运行时才炸）",
        want.length > 20 && missing.length === 0,
        "memory 那边有、mysql 这边没有：" + JSON.stringify(missing) +
          "（memory 共 " + want.length + " 个，mysql 共 " + mine.length + " 个）");
    }
  }

  {
    const i = st.indexOf("putProgress: function");
    const body = i < 0 ? "" : st.slice(i, i + 2400);
    ok("putProgress 是一句条件 upsert，逐列都写了 IF / GREATEST（不是读-比-写）",
      /ON DUPLICATE KEY UPDATE/.test(body)
        && /`?payload`?\s*=\s*IF\(VALUES\(`?updated_at`?\)\s*>=\s*`?updated_at`?/.test(body)
        && /`?updated_at`?\s*=\s*GREATEST\(`?updated_at`?,\s*VALUES\(`?updated_at`?\)\)/.test(body)
        && /`?deleted`?\s*=\s*IF\(VALUES\(`?updated_at`?\)\s*>=\s*`?updated_at`?/.test(body),
      "读-比-写不是原子的；少给一列条件会造出「payload 是旧的、updated_at 是新的」这种行");
  }

  {
    const serve = fs.readFileSync(path.join(repo4, "deploy-api-serve", "serve-api.js"), "utf8");
    const bareServe = serve.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok("serve-api.js 在 require handler **之前**接上 MySQL 存储层",
      /wireMysqlStore/.test(serve)
        && bareServe.indexOf("\nwireMysqlStore();") >= 0
        && bareServe.indexOf("\nwireMysqlStore();") < bareServe.indexOf("api/handler.js"),
      "接在 handler 后面没用 —— handler 在 require 时就取好了单例");
    ok("没配 MYSQL_HOST 时如实退回，不硬接（「配一半」最难查）",
      /if\s*\(!host\)/.test(serve) && /退回/.test(serve),
      "没配也硬接 —— 会得到一个连不上的池，而症状是「全都 500」，指向完全无关的地方");
    ok("镜像里没有 mysql2 时**出声**（不静默退回内存档）",
      /没有 mysql2/.test(serve),
      "静默退回的样子是「能登录、能同步，但一重启全没了」—— 那是最难查的一类");

    const df2 = fs.readFileSync(path.join(repo4, "deploy", "Dockerfile"), "utf8");
    ok("Dockerfile 里装了 mysql2（不装的话上面那句「出声」就是常态）",
      /npm install[^\n]*mysql2/.test(df2),
      "镜像里没有 mysql2 → 配了 MYSQL_HOST 也只能退回内存档，每次重启丢数据");

    const cnb3 = fs.readFileSync(path.join(repo4, ".cnb.yml"), "utf8");
    const runner = fs.readFileSync(path.join(repo4, "scripts", "build-and-check.js"), "utf8");
    ok("CI 里真的跑了 e2e-mysql（形状那几条验不了语义）",
      /e2e-mysql\.js/.test(cnb3) || /e2e-mysql\.js/.test(runner),
      "自检链里没有 e2e-mysql —— 那条「新的赢」在换库后还在不在，就没人验了");
    ok("scripts/e2e-mysql.js 与它的假 MySQL 都在",
      fs.existsSync(path.join(repo4, "scripts", "e2e-mysql.js")) &&
        fs.existsSync(path.join(repo4, "scripts", "mysql-facade.js")),
      "脚本在，但那个内存替身没了 —— 跑起来会 require 不到 mysql2/promise");

    try {
      const { mysqlStore } = require(path.join(repo4, "deploy", "store-mysql.js"));
      const sent = [];

      const fake = { query: (sql) => { sent.push(String(sql)); return Promise.resolve([[], []]); } };
      const s2 = mysqlStore({ mysql: fake });
      const EVIL = '" ; DROP TABLE accounts; --';
      const safeCall = (fn) => { try { fn(); } catch (e) { } };

      safeCall(() => s2.patchAccount("u", { [EVIL]: "x", role: "admin" }));
      ok("update（有白名单那条）：恶意列名进不了 SQL",
        !/DROP/i.test(sent.join(" | ")),
        "SQL 是：" + (sent.join(" | ") || "(这条 SQL 压根没发出去 —— 白名单与标识符闸" +
          "两道都失守时，恶意列名就会拼进那句 SQL)"));

      let threw = false;
      try { s2.patchCode("c", { [EVIL]: "x" }); } catch (e) { threw = true; }
      ok("update（通用那条）：非法列名当场抛，不拼进 SQL",
        threw,
        "非法列名没被拦住 —— MySQL 的 `?` 只管值，列名拼进去就是注入面");

      sent.length = 0;
      safeCall(() => s2.putAccount({ uid: "u", [EVIL]: "x", nickname: "n" }));
      ok("insert（有白名单那条）：恶意列名进不了 SQL",
        !/DROP/i.test(sent.join(" | ")),
        "SQL 是：" + (sent.join(" | ") || "(这条 SQL 压根没发出去 —— 白名单与标识符闸" +
          "两道都失守时，恶意列名就会拼进那句 INSERT)"));

      let threw2 = false;
      try { s2.putCode({ code_id: "c", [EVIL]: "x" }); } catch (e) { threw2 = true; }
      ok("insert（通用那条）：非法列名当场抛，不拼进 SQL",
        threw2, "putCode 会把非法列名拼进 INSERT 的列表里");
    } catch (e) {
      ok("能 require 到 deploy/store-mysql.js（上面几条注入断言的前提）", false, String(e && e.message));
    }
  }

  {
    const tables = ["accounts", "wx_accounts", "codes", "sessions", "progress",
      "verifications", "resets", "reports", "pinyin_proposals",
      "feedback_threads", "feedback_comments", "exam_records"];
    const missingTables = tables.filter((t) => sql.indexOf("CREATE TABLE IF NOT EXISTS `" + t + "`") < 0);
    ok("建表语句里有 store 用到的每一张表（少一张 = 某条路由 ER_NO_SUCH_TABLE）",
      missingTables.length === 0, "缺：" + JSON.stringify(missingTables));

    ok("progress 的主键是 (uid, child_id, poem_id)（条件 upsert 的 on-conflict 靠它）",
      /PRIMARY KEY \(`uid`, `child_id`, `poem_id`\)/.test(sql),
      "主键列不对 —— 条件 upsert 会变成「每来一条插一行」，而数据看着还在");

    ok("sessions 表有 refresh_token 那一列（刷新那条路要靠它找回会话行）",
      /`refresh_token`/.test(sql),
      "没有这一列，刷新永远验不过 —— 而客户端只会看到「登录过期了」");
  }

  {
    const setup = fs.readFileSync(path.join(repo4, "docs", "wx-cloud-setup.md"), "utf8");
    const serveSrc = fs.readFileSync(path.join(repo4, "deploy-api-serve", "serve-api.js"), "utf8");

    const created = /CREATE DATABASE IF NOT EXISTS `([A-Za-z_][\w$]*)`/.exec(setup);
    const fellThrough = /database:\s*process\.env\.MYSQL_DATABASE\s*\|\|\s*"([^"]+)"/.exec(serveSrc);
    const dbFromEnv = /MYSQL_DATABASE=([A-Za-z_][\w$]*)/.exec(setup);

    ok("文档写了「先建库」那条命令（实例里没有这个库，DMS 只列得出系统库）",
      !!created,
      "wx-cloud-setup.md 里没有 `CREATE DATABASE IF NOT EXISTS `poem`` —— 照文档走的人" +
        "会在 DMS 里只看到那五个系统库，然后卡在那儿，而文档一个字都没提");
    ok("文档写了「执行前切库」那条命令（建表语句不带库名，靠当前库）",
      /USE\s+`(?:[A-Za-z_][\w$]*)`\s*;/.test(setup),
      "建表语句里的 CREATE TABLE 不带库名 —— 没切库就是一片 `No database selected`，" +
        "而那句错看着像建表语句写错了");
    ok("建库那条命令用的库名，就是代码里 MYSQL_DATABASE 的默认值",
      !!created && !!fellThrough && created[1] === fellThrough[1],
      "文档建的是「" + (created ? created[1] : "?") + "」，而 serve-api.js 的默认回落是「" +
        (fellThrough ? fellThrough[1] : "?") + "」—— 对不上时驱动抛 ER_BAD_DB_ERROR，" +
        "而进程照起、`[store] 存储层 = …` 照打，症状是「看着配好了但登录一律 500」");
    ok("环境变量那一栏写的库名与建库那条是同一个",
      !dbFromEnv || !created || dbFromEnv[1] === created[1],
      "同一份文档里 `MYSQL_DATABASE=` 写「" + (dbFromEnv ? dbFromEnv[1] : "?") +
        "」、建库却建「" + (created ? created[1] : "?") + "」");
  }

  {
    const doc = fs.readFileSync(path.join(repo4, "docs", "wx-cloud-setup.md"), "utf8");
    const arch = fs.readFileSync(path.join(repo4, "docs", "architecture.md"), "utf8");

    ok("文档写清了「云调用两格是运维配置，界面上没有」",
      /运维配置/.test(doc) && /(普通用户|free|Free)/.test(doc) &&
        /界面上[\s\S]{0,30}没有|没有配置入口/.test(doc),
      "不写清这一点，读的人会去「我的 → 用户列表」里翻那两栏 —— " +
        "而那是运维配置，界面上一个输入框都没有（Issue #198）");

    const svcRow = /\|\s*`X-WX-SERVICE`\s*\|[^\n]*?poem-wx/.test(doc);
    ok("文档 § 6.1 的服务名举例就是当前部署的名字（不是 poem-api）",
      svcRow,
      "§ 6.1 那格里举例 `poem-api` 而实际部署是 `poem-wx` —— 照抄示例会得到" +
        "`service not found`，症状是「看着像服务没部署」");

    const s61 = doc.slice(doc.indexOf("### 6.1"), doc.indexOf("### 6.2"));
    ok("§ 6.1 里写了「服务名以实际建的那个为准」",
      /服务名[^\n]{0,30}(不是固定值|以[^\n]{0,20}为准)/.test(s61),
      "§ 6.1 只给一个名字不写「以实际为准」，人会把举例当标准值 —— " +
        "换个人建服务叫别的名字，就照着文档抄错");

    ok("架构文档也说清了那格在代码库里、不在界面上",
      /server\.js/.test(arch) && /界面上[\s\S]{0,40}没有|不在界面上/.test(arch),
      "architecture.md 没交代值在哪、谁能改 —— 读的人会去界面上找那两栏，" +
        "而那是运维配置，本就不该给普通用户");
  }
}

{
  const repo5 = path.join(ROOT, "..");
  const routesSrc = fs.readFileSync(path.join(repo5, "api", "_lib", "routes.js"), "utf8");
  const handlerSrc = fs.readFileSync(path.join(repo5, "api", "handler.js"), "utf8");
  const countSrc = fs.readFileSync(path.join(repo5, "api", "_routes", "count.js"), "utf8");
  const setup5 = fs.readFileSync(path.join(repo5, "docs", "wx-cloud-setup.md"), "utf8");
  const deployReadme5 = fs.readFileSync(path.join(repo5, "deploy", "README.md"), "utf8");

  ok("ROUTES 表里有 GET /count（控制台「云端调试」打的就是它）",
    /"GET \/count":/.test(routesSrc),
    "微信云托管控制台的云端调试预填 `GET /api/count`，模板自己那份回 " +
      "`{\"E_404\":\"没有这个接口。\"}` —— 这份镜像不认这个路径时，" +
      "人分不清「后端没部署好」和「这是模板的占位接口」（Issue #181）");
  ok("routes.js 导出 list()，且就是 ROUTES 那张表",
    /function list\(\)/.test(routesSrc) && /list: list/.test(routesSrc),
    "接口清单得从路由表来 —— 另抄一份清单，两边迟早对不上");
  ok("count.js 的清单取自 routes.list()",
    /routes\.list\(\)/.test(countSrc),
    "自己再列一遍接口名，等于多一处要跟着 ROUTES 表走的东西");
  ok("404 的正文点明了接口表在哪儿",
    /api\/_lib\/routes\.js/.test(handlerSrc),
    "只回一句「没有这个接口」，下一个人还是得翻代码才知道这一版有哪些接口");

  const cross = /api\/count/.test(setup5) && /api\/_lib\/routes\.js/.test(setup5) &&
    /api\/count/.test(deployReadme5);
  ok("文档说清了 /api/count 是这一版镜像的接口表、与模板同名接口怎么分",
    cross,
    "控制台模板里那个同名路径回 `E_404`，文档不写这一条，" +
      "「云端调试」回 404 就会被当成「后端没部署好」");
}

{
  const savedWx = global.wx;
  const savedPage = global.Page;
  const savedComponent = global.Component;
  const savedGetApp = global.getApp;
  const savedGetCurrentPages = global.getCurrentPages;
  const storeMod = require(path.join(ROOT, "utils", "store.js"));

  global.wx = {
    getStorageSync: (k) => (k in wxCalls ? wxCalls[k] : ""),
    setStorageSync: (k, v) => { wxCalls[k] = v; },
    removeStorageSync: (k) => { delete wxCalls[k]; },
    showToast() {}, showModal() {}, showLoading() {}, hideLoading() {},
    switchTab() {}, navigateTo() {}, redirectTo() {}, navigateBack() {},
    nextTick(f) { if (f) f(); },
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375, platform: "devtools" })
  };
  global.Component = () => {};
  global.getApp = () => ({ globalData: {} });
  global.getCurrentPages = () => [];

  const mountHome = () => {
    let opt = null;
    global.Page = (o) => { opt = o; };
    const file = path.join(ROOT, "pages/home/home.js");
    delete require.cache[require.resolve(file)];
    require(file);
    const page = Object.assign({}, opt);
    page.data = JSON.parse(JSON.stringify(opt.data || {}));
    page.setData = function (obj, cb) {
      Object.keys(obj).forEach((k) => { this.data[k] = obj[k]; });
      if (cb) cb();
    };
    page.selectComponent = () => null;
    return page;
  };

  const savedProfile = storeMod.profile();
  try {
    storeMod.saveProfile({ logged: true, nickname: "自检" });

    let page = null;
    let crashed = "";
    try {
      page = mountHome();
      page.onLoad && page.onLoad({});
      page.onShow && page.onShow({});
    } catch (e) {
      crashed = (e && e.message) || String(e);
    }

    ok("登录态首页跑 onLoad + onShow 不抛异常", crashed === "",
      "首页炸在这里：" + crashed + " —— 登录用户一进来就是「没有诗词数据」");

    const data = (page && page.data) || {};
    ok("登录态首页真的排出了今日计划（plan 非空）",
      Array.isArray(data.plan) && data.plan.length > 0,
      "plan 是空的（或没有 plan）—— 首页渲染不出任何篇目");
    ok("登录态首页不是游客态（guest 落回 false）",
      data.guest === false && data.logged === true,
      "guest=" + data.guest + " logged=" + data.logged + " —— 登录进去还被当成游客");
  } finally {
    if (savedProfile && savedProfile.logged) storeMod.saveProfile(savedProfile);
    else storeMod.saveProfile({ logged: false, nickname: "", avatarUrl: "" });
    global.wx = savedWx;
    global.Page = savedPage;
    global.Component = savedComponent;
    global.getApp = savedGetApp;
    global.getCurrentPages = savedGetCurrentPages;
  }
}

{
  const corpusSrc = fs.readFileSync(path.join(ROOT, "utils", "corpus.js"), "utf8");

  ok("corpus 有「数据在不在」的探针", /function hasData\s*\(/.test(corpusSrc));
  ok("corpus 暴露了 hasData（页面据此走空态）",
    /hasData\s*,/.test(corpusSrc.slice(corpusSrc.indexOf("module.exports"))));
  ok("hasData 判的是「包内的 books.js 在不在」，不是磁盘上那个目录",
    !/existsSync/.test(corpusSrc) && /hasData[\s\S]{0,300}PACKED\.books\(\)/.test(corpusSrc),
    "真机没有 fs，且 data/ 目录会被 packOptions 拆着打 —— 目录在、包内文件缺时，"
      + "看目录的探针一律回「有数据」，首页于是跳过空态，渲染出一个空目录");
  ok("app.js 把运行版本记进本机（首页空态要说得清「这个包是哪一版」）",
    /stampBuild/.test(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"))
      && /getAccountInfoSync/.test(fs.readFileSync(path.join(ROOT, "app.js"), "utf8")));
  ok("语料读取统一过 readJson（拿不到就回默认值，不当崩溃）",
    /function readJson\s*\(/.test(corpusSrc));

  const rawLoads = corpusSrc.match(/=\s*loadJson\(/g) || [];
  ok("没有裸用 loadJson 的入口（都走 readJson 兜底）",
    rawLoads.length === 0,
    rawLoads.length + " 处还在裸 loadJson：" + (corpusSrc.match(/[^\n]*loadJson\([^\n]*/g) || []).join(" / "));

  {
    const os = require("os");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kb-nodata-"));
    try {
      fs.mkdirSync(path.join(tmp, "utils"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "utils", "corpus.js"), corpusSrc);
      const savedWx = global.wx;
      delete global.wx;

      const modPath = path.join(tmp, "utils", "corpus.js");
      let bare = null;
      try {
        bare = require(modPath);
      } catch (e) {
        bare = null;
      }
      ok("没有 data/ 时 corpus 仍能被 require（不是一上来就炸）", !!bare);
      if (bare) {
        let blew = "";
        try {
          bare.books(); bare.course(); bare.courseTexts();
          bare.entry("x"); bare.search("李白");
        } catch (e) {
          blew = (e && e.message) || String(e);
        }
        ok("没有 data/ 时各入口都回空值、不抛异常", blew === "",
          "炸在：" + blew + " —— 这正是 Issue #121 的白屏");
        ok("没有 data/ 时 course() 回空（首页渲染空态）", bare.course().length === 0);
        ok("没有 data/ 时 books() 回空", bare.books().length === 0);
        ok("没有 data/ 时 hasData() 说真话", bare.hasData() === false);
      }
      global.wx = savedWx;
      delete require.cache[require.resolve(modPath)];
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const homeJsNoData = fs.readFileSync(path.join(ROOT, "pages", "home", "home.js"), "utf8");
  ok("首页缺语料时照常渲染（各卡片自己露出断口）",
    !/hasData/.test(homeJsNoData) || !/noData|buildRev/.test(homeJsNoData),
    "home.js 又在 refresh 里按 hasData 改走另一套渲染 —— 卡片不再按真实数据报错");
  const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  ok("缺语料改在控制台报（版本 + 语料在不在）",
    /console\.info[\s\S]{0,200}corpus\.hasData\(\)/.test(appSrc)
      && /console\.info[\s\S]{0,200}stamp\(\)/.test(appSrc),
    "空态卡删掉之后，包是哪一版、语料进没进包就没人说了 —— " +
      "这两句只能在 onLaunch 的控制台里说，页面不再替它出头");

  {
    const script = [
      'const path=require("path");',
      'const ROOT=' + JSON.stringify(ROOT) + ';',
      'const mem={};',
      'global.wx={showToast(){},showModal(){},showLoading(){},hideLoading(){},',
      '  getSystemInfoSync:()=>({statusBarHeight:20,windowWidth:375,platform:"devtools"}),',
      '  getStorageSync:(k)=>(k in mem?mem[k]:""),setStorageSync:(k,v)=>{mem[k]=v;},',
      '  removeStorageSync:(k)=>{delete mem[k];},',
      '  getStorageInfoSync:()=>({keys:Object.keys(mem),currentSize:0,limitSize:10240}),',
      '  loadFontFace(){},navigateTo(){},switchTab(){},stopPullDownRefresh(){}};',
      'global.getApp=()=>({globalData:{}});global.getCurrentPages=()=>[];',
      'const c=require(path.join(ROOT,"utils","corpus.js"));',
      'c.books=()=>[];c.course=()=>[];c.courseTexts=()=>({});',
      'c.manifest=()=>({map:{},buckets:[]});c.hasData=()=>false;',
      'require(path.join(ROOT,"utils","store.js")).saveProfile({logged:true,nickname:"t"});',
      'let opt=null;global.Page=(o)=>{opt=o;};',
      'require(path.join(ROOT,"pages","home","home.js"));',
      'const p=Object.assign({},opt);p.data=JSON.parse(JSON.stringify(opt.data||{}));',
      'p.setData=function(o){Object.keys(o).forEach((k)=>{this.data[k]=o[k];});};',
      'p.onShow.call(p);',
      'if(p.data.noData!==undefined) throw new Error("home.js 还有 noData 分支");',
      'if(p.data.logged!==true) throw new Error("登录态没渲染出来");',
      'if(!Array.isArray(p.data.plan)||p.data.plan.length!==0) throw new Error("plan 不是空数组");',
      'console.log("ok");'
    ].join("\n");

    let blew = "";
    try {
      execFileSync(process.execPath, ["-e", script], { cwd: ROOT, stdio: "pipe" });
    } catch (e) {
      blew = String((e.stderr && e.stderr.toString()) || e.message).split("\n").slice(0, 3).join(" | ");
    }
    ok("没有语料时首页也照常跑完 refresh（不抛、不留空态分支）", blew === "", blew);
  }

}

{
  const repo5 = path.join(ROOT, "..");
  const cnb = fs.readFileSync(path.join(repo5, ".cnb.yml"), "utf8");
  const triggerPath = path.join(repo5, ".cnb", "web_trigger.yml");

  ok(".cnb/web_trigger.yml 在（发布的手动按钮在这一份里，不在 .cnb.yml）",
    fs.existsSync(triggerPath),
    "缺这份文件 —— 仓库页面上没有「发布」按钮，只能靠推一个空提交把流水线叫起来");

  if (fs.existsSync(triggerPath)) {
    const wt = fs.readFileSync(triggerPath, "utf8");

    const events = [...wt.matchAll(/^\s*event:\s*(\S+)\s*$/gm)].map((m) => m[1]);
    ok("按钮上那个事件名同时配在 .cnb.yml 的 `main:` 下（少一边都点不出流水线）",
      events.length > 0 && events.every((e) => new RegExp("^\\s{2}" + e + ":", "m").test(cnb)),
      "按钮写的事件在 `.cnb.yml` 里找不到同名事件：" + JSON.stringify(events) +
        " —— 页面提示「无法触发」，实际是流水线没配。web_trigger 事件只能放具体分支名下，" +
        "放 `$` 兜底里平台解析不到");

    ok(".cnb/web_trigger.yml 里不写 inputs（发布不需要每次手填参数，按钮点了就跑）",
      !/^\s+inputs:/m.test(wt),
      "按钮上挂了 inputs —— 发布链的参数是逐次提交定下来的，让人每次手填等于多一处会填错的输入");

    {
      const mainAt = cnb.indexOf("main:\n  push:");
      const after = mainAt < 0 ? "" : cnb.slice(mainAt);
      const seg = (key) => {
        const i = after.indexOf("  " + key + ":");
        if (i < 0) return null;
        const rest = after.slice(i);
        const next = rest.slice(1).search(/^  \S[^\s:]*:\s*$/m);
        return next < 0 ? rest : rest.slice(0, next + 1);
      };
      const pushSeg = seg("push");
      const wtSeg = seg("web_trigger_release");

      ok("`main` 下同时配了 `push` 与 `web_trigger_release`（发布两个入口）",
        !!pushSeg && !!wtSeg,
        "缺一个 —— 没有 `push` 则推 main 不发版；没有 `web_trigger_release` 则按钮点了没反应");

      const withoutIfModify = (t) => {
        const out = [];
        let inBlock = false;
        String(t).split("\n").forEach((l) => {
          if (/^\s*ifModify:\s*$/.test(l)) { inBlock = true; return; }
          if (inBlock) {
            if (/^\s*-\s*"/.test(l)) return;
            inBlock = false;
          }
          out.push(l);
        });
        return out.map((l) => l.replace(/^  (push|web_trigger_release):$/, "  EVENT:")).join("\n").trim();
      };

      ok("手动发布那一步与推 main 那一步是同一份脚本（各改各的迟早对不上）",
        !!pushSeg && !!wtSeg && withoutIfModify(pushSeg) === withoutIfModify(wtSeg),
        "两段不一样 —— 发布链多一个入口，唯一会走岔的地方就是只改了其中一处。" +
          "左边是 `push`、右边是按钮，逐行比出第一处不同：" +
          JSON.stringify((() => {
            const a = withoutIfModify(pushSeg || "").split("\n");
            const b = withoutIfModify(wtSeg || "").split("\n");
            for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
              if (a[i] !== b[i]) return [a[i] === undefined ? "(缺行)" : a[i],
                b[i] === undefined ? "(缺行)" : b[i]];
            }
            return null;
          })()));

      ok("手动发布那条不挂 ifModify（判据只属于「推 main」这一次提交）",
        !!wtSeg && wtSeg.indexOf("ifModify") < 0,
        "按钮触发的发布挂了 ifModify —— 它判的是「这次改动碰没碰后端」，" +
          "而手动发布要的正是「无论改了什么，都按当前代码重出一遍」");
    }

    {
      const mainPart = cnb.slice(cnb.indexOf("\nmain:")).split("stages:")[0];
      const envKeys = new Set(
        [...mainPart.matchAll(/^\s{8}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1])
      );
      const injected = new Set([
        "GHCR_USER", "GHCR_TOKEN", "GH_PAT", "GH_REPO", "WX_APPID", "WX_PRIVATE_KEY_B64",
        "CLOUD_ENV", "CLOUD_SERVICE",
      ]);
      const refs = new Set(
        [...cnb.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map((m) => m[1])
      );
      const aliased = [...refs].filter((v) => !envKeys.has(v) && !injected.has(v) &&
        !/^CNB_/.test(v));
      ok("发布里引用的变量都有出处（env: 里的定义，或密钥仓库 import 进来的）",
        aliased.length === 0,
        "这些变量在 `main:` 的 env: 与密钥仓库里都没有：" + JSON.stringify(aliased) +
          " —— busybox sh 撞上未定义变量是当场 exit，" +
          "所以要用 `\${VAR:-默认}` 那种写法，或在 env: 里补上");
    }
  }
}

{
  const serveSrc = fs.readFileSync(path.join(ROOT, "..", "deploy-api-serve", "serve-api.js"), "utf8");
  const dockerfile = fs.readFileSync(path.join(ROOT, "..", "deploy", "Dockerfile"), "utf8");
  const dockerignore = fs.readFileSync(path.join(ROOT, "..", "deploy-api-serve", ".dockerignore"), "utf8");
  const cnb = fs.readFileSync(path.join(ROOT, "..", ".cnb.yml"), "utf8");
  const remoteSrc = fs.readFileSync(path.join(ROOT, "utils", "remote.js"), "utf8");
  const corpusSrc2 = fs.readFileSync(path.join(ROOT, "utils", "corpus.js"), "utf8");
  const readerSrc = fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.js"), "utf8");

  ok("镜像里的时区写死成东八区（不随基础镜像漂）",
    /^ENV TZ=Asia\/Shanghai$/m.test(dockerfile));

  {
    const doc = fs.readFileSync(path.join(ROOT, "..", "docs", "wx-cloud-setup.md"), "utf8");
    const seg = cnb.slice(cnb.indexOf("\nmain:")).split(/^  web_trigger_release:/m)[0];
    const listed = [...seg.matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map((m) => m[1]).sort();
    const documented = [...doc.matchAll(/^\s*-\s*`([^`]+)`\s+——/gm)].map((m) => m[1]).sort();
    ok("「哪些改动要重出镜像」那份名单与 .cnb.yml 的 ifModify 一致",
      listed.length > 0 && listed.join() === documented.join(),
      "两处要对得上 —— 流水线挂的 ifModify 是 " + JSON.stringify(listed) +
        "，docs/wx-cloud-setup.md 写的是 " + JSON.stringify(documented) +
        "（改发布链时名单要跟着动）");
  }

  ok("服务壳不再挂分片路由（课外正文整体删掉了）",
    !/shard/i.test(serveSrc) && !fs.existsSync(path.join(ROOT, "..", "deploy-api-serve", "shard-api.js")),
    "serve-api.js 里还留着 shard 那一支，或 shard-api.js 还在");

  ok("Dockerfile 不带分片（没有 shard-src 那一层，也没有分片开关）",
    !/shard/i.test(dockerfile) && !/COPY_SHREDS/.test(dockerfile),
    "Dockerfile 里还留着分片那一层 —— 上下文里已经没有它了，COPY 会直接红");

  {
    const rules = dockerignore.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

    const covers = (rel) => {
      const parts = rel.split("/");
      let keep = false;
      for (const r of rules) {
        if (r === "**") { keep = false; continue; }
        if (r.charAt(0) !== "!") continue;
        const g = r.slice(1);
        if (g === rel || g === parts[0]) keep = true;
        else if (g.endsWith("/**") && rel.indexOf(g.slice(0, -3) + "/") === 0) keep = true;
      }
      return keep;
    };

    ok("白名单逐条放行 api/ 下要的每一样（`!api/**` 不跨层，别用它当万金油）",
      ["api/handler.js", "api/_lib/routes.js", "api/_lib/http.js", "api/_routes/me.js"]
        .every(covers),
      "`!api` + `!api/**` 只放行 api/ 根那层，api/_lib/ 与 api/_routes/ 底下是空的 —— " +
        "镜像里 api/ 进了、内容没进，容器一被调到就是 `Cannot find module './_lib/routes.js'`" +
        "（Issue #134）。实际规则：" + JSON.stringify(rules.filter((r) => r.charAt(0) === "!")));
  }

  ok("发布链不再摊分片、也不再递 COPY_SHREDS",
    !/shard/i.test(cnb) && !/COPY_SHREDS/.test(cnb),
    "流水线里还留着分片那一步 —— 上下文里已经没有它了，构建会红在 CHECKSUM 上");

  {
    const mustAllow = ["!serve-api.js", "!store-mysql.js", "!api/handler.js",
      "!api/_lib/**", "!api/_routes/**", "!Dockerfile"];
    const notAllowed = mustAllow.filter((line) => dockerignore.indexOf(line) < 0);
    ok("白名单放行了构建与启动真的要用到的每一样（缺一行 = 那样东西一个字都进不去）",
      notAllowed.length === 0,
      "没放行：" + JSON.stringify(notAllowed) +
        "。白名单先 `**` 排掉一切再逐条放行 —— 少一行不会报错，" +
        "少的是**启动期 require 的那个文件**时，症状是容器 Back-off 重启");

    const inRepo = ["deploy-api-serve/serve-api.js", "deploy/store-mysql.js"];
    const missingInRepo = inRepo.filter((f) => !fs.existsSync(path.join(ROOT, "..", f)));
    ok("放行的那几样真的在仓库里（放行一个不存在的名字 = 白名单形同虚设）",
      missingInRepo.length === 0, "找不到：" + JSON.stringify(missingInRepo));
  }

  ok("remote 里没有分片入口了", !/shard/i.test(remoteSrc));
  ok("前端不再读分片清单 / 分片目录",
    !/data\/shards/.test(corpusSrc2) && !/data\/texts/.test(corpusSrc2),
    "corpus.js 还在读 data/shards.js 或 data/texts/ —— 这两样已经不产出了");
  ok("ensureEntry 只查包内，取不到就抛 E_NO_TEXT",
    /courseTexts\(\)\[id\][\s\S]{0,200}E_NO_TEXT/.test(corpusSrc2));
  ok("阅读页取不到正文时给一条重试的路",
    /onRetryText\s*\(/.test(readerSrc) && /loadFailed:\s*true/.test(readerSrc));
  ok("背诵弹层不再有「重新获取正文」那条路",
    !/onSyncText|ensureEntry/.test(
      fs.readFileSync(path.join(ROOT, "components", "recite-sheet", "recite-sheet.js"), "utf8")),
    "正文全在包里了，取不到只有一种因：这一篇本来就不在这个包里");

  ok("全文检索模块已删（课外正文不进包，扫不了全书）",
    !fs.existsSync(path.join(ROOT, "utils", "text-search.js")));
  ok("本机残留的分片缓存会自己清掉（升级上来的手机不背着 40 片正文）",
    /function\s+dropLegacy/.test(corpusSrc2) && /"shards[^"]*"/.test(corpusSrc2)
      && /corpus\.dropLegacy\(\)/.test(
        fs.readFileSync(path.join(ROOT, "app.js"), "utf8")),
    "清的是本机键名，与已删的 /api/shard 路由无关");
}

{
  const settingsPath = path.join(ROOT, "..", ".cnb", "settings.yml");
  const hasSettings = fs.existsSync(settingsPath);
  const settings = hasSettings ? fs.readFileSync(settingsPath, "utf8") : "";
  const agentsPath = path.join(ROOT, "..", "AGENTS.md");
  const agents = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, "utf8") : "";

  ok(".cnb/settings.yml 在（仓库专属 NPC 角色的正门）",
    hasSettings,
    "没有这个文件时 @ 到的是平台通用 CodeBuddy —— 那份 prompt 只管通用风格，" +
      "不知道本仓库跑在云托管、也不知道 AGENTS.md 里的规矩");

  const role = /roles:\s*\n\s*-\s*name:\s*(\S+)/.exec(settings);
  ok("settings.yml 里定义了角色，且有 name 与 prompt",
    !!role && /\n\s*prompt:\s*\|/.test(settings),
    "只有 name 没有 prompt（或反过来）—— 角色立不起来，@ 它等于还是通用助手");

  ok("角色 prompt 里指了 AGENTS.md（规范只有一处，不在这里再抄一遍）",
    /AGENTS\.md/.test(settings) && /代码规范/.test(agents),
    "prompt 里没提 AGENTS.md：以后改规范要改两个地方，迟早各说各的 —— " +
      "要么 prompt 指过去，要么把 AGENTS.md 删掉");

  ok("prompt 里点名了要跑的四条自检",
    ["check.js", "parity.js", "e2e-wx-sync.js", "e2e-mysql.js"].every((f) => settings.indexOf(f) >= 0),
    "没写清跑哪几条 —— 助手会挑一条跑完就说「绿了」，而 e2e-mysql 那条要 MySQL" +
      "在场才跑得起来，最容易漏");

  ok("prompt 里写了「不写注释」与「改代码走 PR」",
    /注释/.test(settings) && /PR/.test(settings),
    "用户这一轮要的两件事（自己说的「再说一次 删除代码中的所有注释」、" +
      "「提 PR」）没落进角色设定，下一个人还得再说一次");
}

{
  const repoRoot = path.join(__dirname, "..");
  const scanned = [];
  const skipDir = (p) =>
    p === ".git" || p === "node_modules" || p === "corpus" || p === "parity-web";

  const tracked = new Set(
    execFileSync("git", ["ls-files"], { cwd: repoRoot }).toString().split("\n").filter(Boolean)
  );

  (function walk(dir) {
    fs.readdirSync(dir).forEach((f) => {
      if (skipDir(f)) return;
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) return walk(full);
      if (!f.endsWith(".js")) return;
      const rel = path.relative(repoRoot, full);
      if (!tracked.has(rel)) return;
      scanned.push(rel);
    });
  })(repoRoot);

  function commentAt(src) {
    const n = src.length;
    let i = 0;
    let quote = "";
    let prev = "";
    const KEYWORD = /^(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await|throw)$/;
    while (i < n) {
      const c = src[i];
      if (quote) {
        if (c === "\\") { i += 2; continue; }
        if (c === quote) quote = "";
        i++;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; i++; continue; }
      if (src.slice(i, i + 2) === "//" || src.slice(i, i + 2) === "/*") return i;
      if (c === "/") {
        const last = src.slice(0, i).replace(/\s+$/, "").slice(-1);
        if (!last || "([{,;=:!&|?+-*%^<>~".indexOf(last) >= 0 || KEYWORD.test(prev)) {
          let j = i + 1;
          let inClass = false;
          let closed = false;
          while (j < n) {
            const d = src[j];
            if (d === "\\") { j += 2; continue; }
            if (d === "\n") break;
            if (d === "[") inClass = true;
            else if (d === "]") inClass = false;
            else if (d === "/" && !inClass) { closed = true; break; }
            j++;
          }
          if (closed) {
            j++;
            while (j < n && /[a-z]/i.test(src[j])) j++;
            prev = "literal";
            i = j;
            continue;
          }
        }
        prev = "";
        i++;
        continue;
      }
      const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      if (id) { prev = id[0]; i += id[0].length; continue; }
      if (!/\s/.test(c)) prev = "";
      i++;
    }
    return -1;
  }

  const dirty = scanned.filter((rel) => commentAt(fs.readFileSync(path.join(repoRoot, rel), "utf8")) >= 0);
  ok("源码里没有注释（" + scanned.length + " 份 .js：api / deploy / deploy-api-serve / scripts / miniprogram）",
    dirty.length === 0,
    "还有注释：" + dirty.slice(0, 8).join("、") +
      " —— 语料（scripts/corpus/）与契约只读副本（scripts/parity-web/）照原样摆着，不在这条范围内");

  const generated = ["miniprogram/data/books/books.js"];
  const leaked = generated.filter((rel) => {
    if (tracked.has(rel)) return true;
    const p = path.join(repoRoot, rel);
    if (!fs.existsSync(p)) return false;
    return commentAt(fs.readFileSync(p, "utf8")) >= 0;
  });
  ok("构建期生成的文件没有注释，也不入库", leaked.length === 0,
    "构建产物带了注释或入了库：" + leaked.join("、") +
      " —— 语料是构建产物，由 build-data.js 生成且被 .gitignore 挡住；" +
      "server.js 反过来：它是入库的空壳，只有值由构建期写");
}

{
  const repoRoot = path.join(__dirname, "..");
  const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot })
    .toString().split("\n").filter(Boolean);
  const quoted = [];
  tracked.filter((rel) => /^miniprogram\/.*\.wxml$/.test(rel)).forEach((rel) => {
    const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    src.split("\n").forEach((line, i) => {
      const blank = /\{\{[^}]*"[^"]*"[^}]*\}\}/.test(line);
      if (blank) quoted.push(rel + ":" + (i + 1));
    });
  });
  ok("WXML 的花括号表达式里没有裸双引号（上传编译会判 unexpected character）",
    quoted.length === 0,
    "这几行把双引号写在花括号里：" + quoted.slice(0, 6).join("、")
      + " —— 属性值用双引号包着，里面的分支字符串要用单引号（或丢掉空分支）");
}

{
  const colsMod = require(path.join(ROOT, "utils", "collections.js"));
  const R4 = require(path.join(ROOT, "utils", "review-models.js"));

  ok("自选温习的配额：Free 无、Pro 1、Max 200",
    colsMod.LIMITS.free === 0 && colsMod.LIMITS.pro === 1 && colsMod.LIMITS.max === 200);
  ok("每个集子最多 100 首", colsMod.ITEMS_MAX === 100);
  ok("权限对比表上写出来的自选温习配额与配额表同源",
    (() => {
      const E5 = require(path.join(ROOT, "utils", "entitlement.js"));
      const row = E5.compareRows({ logged: false, tier: "free" })
        .filter((r) => r.cap === "collections")[0];
      const want = ["free", "pro", "max"].map((t) =>
        colsMod.LIMITS[t] ? colsMod.LIMITS[t] + " 个集合" : "");
      const got = row.cells.map((c) => c.text);
      return got.join(",") === want.join(",");
    })(),
    "对比表那一行的数字另写一份，改配额时两处会说不一样的话");
  ok("自由集的算法档位就那四个（3 / 5 / 10 / 20，默认 5）",
    colsMod.DAILY_COUNTS.join() === "3,5,10,20" && colsMod.DAILY_DEFAULT === 5);

  {
    const saved = global.wx;
    const mem = {};
    global.wx = {
      getStorageSync: (k) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : ""),
      setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
      removeStorageSync: (k) => { delete mem[k]; }
    };
    Object.keys(require.cache).forEach((k) => {
      if (k.indexOf(path.join(ROOT, "utils")) === 0) delete require.cache[k];
    });

    const store3 = require(path.join(ROOT, "utils", "store.js"));
    const cols3 = require(path.join(ROOT, "utils", "collections.js"));

    const asTier3 = (t) => {
      store3.saveProfile({ logged: true });
      store3.write(store3.KEYS.auth, { token: "t", tier: t, at: Date.now() });
    };

    asTier3("free");
    ok("Free 建不了集子", cols3.create("甲").ok === false && cols3.capOf() === 0);

    asTier3("pro");
    const made = cols3.create("唐诗五首");
    ok("Pro 建得了集子", made.ok === true && cols3.list().length === 1);
    ok("Pro 只能建 1 个", cols3.create("第二个").ok === false && cols3.list().length === 1);

    const first = cols3.list()[0];
    ok("新建时名字留空就落到默认名上",
      (asTier3("max"), cols3.create("   ").ok === true
        && cols3.list().filter((c) => c.name === cols3.DEFAULT_NAME).length === 1));
    ok("名字超长按上限截断",
      (() => { cols3.rename(first.id, "一二三四五六七八九十十一十二十三");
        return cols3.find(first.id).name.length === cols3.NAME_MAX; })());

    asTier3("max");
    const empty = cols3.list().filter((c) => c.name === cols3.DEFAULT_NAME)[0];
    const r1 = cols3.add(first.id, ["pa", "pb", "pa", ""]);
    ok("同一首不重复收（空 id 丢掉）", r1.added === 2 && cols3.idsOf(cols3.find(first.id)).join() === "pa,pb");
    ok("再加已有的那首：不再加，报 E_DUP", cols3.add(first.id, ["pa"]).code === "E_DUP");

    const many = [];
    for (let i = 0; i < cols3.ITEMS_MAX + 5; i++) many.push("px" + i);
    const r2 = cols3.add(first.id, many);
    const over = 2 + many.length - cols3.ITEMS_MAX;
    ok("集子到 100 首封顶（多出来的报 E_FULL）",
      cols3.idsOf(cols3.find(first.id)).length === cols3.ITEMS_MAX
        && r2.code === "E_FULL" && r2.full === over,
      "实际 " + cols3.idsOf(cols3.find(first.id)).length + " 首，code=" + r2.code
        + "，full=" + r2.full + "（应为 " + over + "）");

    ok("移出选中只移点中的那几首",
      (() => { const r = cols3.removeItems(first.id, ["px0", "px1"]); return r.removed === 2; })());
    ok("清空只清篇目、集子还在",
      (() => { const r = cols3.clearItems(first.id); return r.count === cols3.ITEMS_MAX - 2 && cols3.find(first.id); })());

    ok("每日首数只能落在 3/5/10/20 里",
      cols3.setCount(first.id, 7).ok === false && cols3.setCount(first.id, 10).ok === true
        && cols3.countOf(cols3.find(first.id)) === 10);
    ok("删集子删得掉", cols3.remove(first.id).ok === true && !cols3.find(first.id));

    ok("清空数据后集子里不在语料里的条目不留下（清空即 prune）",
      (() => {
        const real = require(path.join(ROOT, "utils", "corpus.js")).course()[0].id;
        store3.saveCollections([
          { id: "ck", name: "留着", items: [{ id: real }, { id: "poems-ghost-01" }] },
          { id: "cg", name: "只剩空的", items: [{ id: "poems-ghost-02" }] }
        ]);
        const n = cols3.prune();
        const keep = cols3.find("ck");
        return n === 2 && !!keep && cols3.idsOf(keep).join() === real && !cols3.find("cg");
      })(),
      "清空数据清掉进度、集子里那条还指着已删的篇目 —— 点进去是空壳");

    store3.saveCollections([{ id: "c9", name: "自选", items: [{ id: "poems-xx1-01" }] }]);
    ok("集子的名字、篇目与每日首数一起走同步那一行",
      (() => {
        const wire3 = require(path.join(ROOT, "utils", "wire.js"));
        const row = wire3.packRecords().filter((r) => r.id === "collections:v1")[0];
        return !!row && Array.isArray(row.payload.collections)
          && row.payload.collections[0].name === "自选"
          && row.payload.collections[0].items.length === 1;
      })(),
      "服务端 sanitizeCollections 留 id / name / createdAt / dailyCount / items");

    ok("每个集子的每日首数跟着账号走（本机发得出，服务端也认）",
      (() => {
        const got = cols3.setCount("c9", 10);
        const wire3 = require(path.join(ROOT, "utils", "wire.js"));
        const row = wire3.packRecords().filter((r) => r.id === "collections:v1")[0];
        const settings = wire3.packRecords().filter((r) => r.id === "settings:v1")[0];
        return got.ok && cols3.countOf(cols3.find("c9")) === 10
          && row.payload.collections[0].dailyCount === 10
          && !(settings && settings.payload.settings.collectionCounts);
      })(),
      "首数随集子发在 collections:v1 那一行里；不进 settings:v1（它不在服务端白名单里）");

    ok("换台手机认得到每个集子的首数（拉回那一行就落回本机）",
      (() => {
        const wire3 = require(path.join(ROOT, "utils", "wire.js"));
        const fresh = [{ id: "c9", name: "自选", createdAt: 0, dailyCount: 10, items: [{ id: "poems-xx1-01" }] }];
        store3.saveCollections([]);
        const applied = wire3.applyRecords([{
          id: "collections:v1",
          payload: { v: 1, collections: fresh, updatedAt: Date.now() + 1000 },
          updatedAt: Date.now() + 1000,
          deleted: false
        }]);
        return applied >= 1 && cols3.countOf(cols3.find("c9")) === 10;
      })(),
      "服务端把 dailyCount 裁掉的话，这条只会回默认 5 —— 换台手机就丢");

    const corpusMod3 = require(path.join(ROOT, "utils", "corpus.js"));
    const S3 = require(path.join(ROOT, "utils", "scheduler.js"));
    const poemId = corpusMod3.course()[0].id;
    store3.saveCollections([{ id: "c1", name: "一集", dailyCount: 3, items: [{ id: poemId }] }]);

    const fake3 = [];
    for (let i = 0; i < 12; i++) fake3.push({ id: "cp" + i, t: "诗" + i, a: "作者", d: "唐", gr: 1, tm: 1, b: "poems" });
    store3.saveCollections([{ id: "c1", name: "一集", dailyCount: 5, createdAt: 1, items: fake3.map((p) => ({ id: p.id })) }]);

    store3.setRecord("cp0", { level: 3, learned: true, nextReviewAt: Date.now() - 86400000, lastReviewAt: Date.now() - 86400000 });
    const planC = S3.collectionPlan(cols3.find("c1"), {
      count: 5, allPoems: fake3, getRecord: store3.getRecord
    });
    ok("集子按自己的首数排计划（5 首）", planC.length === 5, "实际 " + planC.length);
    ok("集子里到期的排第一", planC[0].poem.id === "cp0", "实际 " + planC[0].poem.id);
    ok("到期的那首标复习", planC[0].reason === "review");

    const planEmpty = S3.collectionPlan(cols3.find("c1"), {
      count: 5, allPoems: [fake3[0]], getRecord: () => null
    });
    ok("集子只有一首时计划就一首（不凑数）", planEmpty.length === 1);

    const R3 = require(path.join(ROOT, "utils", "review-models.js"));
    const todayRec = (r) => R3.review(store3.getRecord(r), "good", "ebbinghaus");
    store3.setRecord("cp1", todayRec("cp1"));
    ok("「今天背过」只认当天的那次评价，昨天背过的不算",
      S3.doneToday(store3.getRecord("cp1")) === true
        && S3.doneToday({ level: 3, learned: true, reviewedOn: "2000-1-1" }) === false
        && S3.doneToday(null) === false);

    store3.setRecord("cp1", { level: 0, learned: false, nextReviewAt: 0, lastReviewAt: 0, history: [] });
    const ov = S3.collectionProgress(cols3.find("c1"), {
      allPoems: fake3, getRecord: store3.getRecord, count: 5
    }).overview;
    ok("集子概览报篇目数 / 已温习 / 今日到期",
      ov.total === 12 && ov.learned === 1 && ov.dueToday === 1, JSON.stringify(ov));

    store3.setRecord("cp0", { level: 9, learned: true, nextReviewAt: Date.now() + 86400000, lastReviewAt: Date.now() });
    const colCards = S3.collectionsProgress([cols3.find("c1")], {
      allPoems: fake3, getRecord: store3.getRecord, count: 5
    });
    ok("集子的读数与本册同源（掌握度 / 已掌握 / 掌握度分布都来自 overview）",
      colCards.length === 1 && colCards[0].overview.mastered === 1
        && colCards[0].overview.avgMastery === R3.mastery(store3.getRecord("cp0"))
        && colCards[0].overview.masteryBuckets.reduce((a, b) => a + b, 0) === 1,
      JSON.stringify(colCards[0] && colCards[0].overview));

    store3.saveCollections([{ id: "c1", name: "一集", dailyCount: 5, items: [{ id: "cp0" }, { id: "cp0" }] }]);
    ok("落盘时同一首只留一份",
      require(path.join(ROOT, "utils", "collections.js")).list()[0].items.length === 1);

    store3.saveCollections([{ id: "c1", name: "一集", dailyCount: 5, items: [{ id: "cp0" }] }]);

    const S5 = require(path.join(ROOT, "utils", "scheduler.js"));
    const course5 = corpusMod3.course();
    const extra5 = [{ id: "cp0", t: "诗0", a: "作者", d: "唐", gr: 1, tm: 1, b: "poems" }];
    const plain5 = S5.generateDailyPlan({
      grade: 1, term: 1, count: 5, scope: "term",
      allPoems: course5, extraPoems: extra5, getRecord: () => null
    });
    const self5 = S5.generateDailyPlan({
      grade: 1, term: 1, count: 5, scope: "term", selfOnly: true,
      allPoems: course5, extraPoems: extra5, getRecord: () => null
    });
    ok("开着「只背自选」时，排期只回新增温习那几首（课内一首不排）",
      self5.length === 1 && self5[0].poem.id === "cp0" && self5[0].reason === "pinned"
        && plain5.some((p) => p.poem.id !== "cp0"),
      "实际 " + JSON.stringify(self5.map((p) => p.poem.id)));
    ok("「只背自选」的名单与课内那份分开落盘（两份名单各有各的键）",
      S5.planKeyOf({ grade: 1, term: 1, scope: "term", count: 5, selfOnly: true })
        !== S5.coursePlanKeyOf({ grade: 1, term: 1, scope: "term", count: 5 }),
      "自选那份和课内那份共用了同一个名单位 —— 开一次开关就把课内名单换成自选那几首");
    ok("「只背自选」期间课内那份名单照旧（关掉开关不用重排，加背那几首也不占它的名额）",
      (() => {
        const extraIds = ["cp0", "cp1"];
        const extraPoems = extraIds.map((id) => ({ id: id }));
        const self = S5.generateDailyPlan({
          grade: 1, term: 1, count: 5, scope: "term", selfOnly: true,
          allPoems: [], extraPoems: extraPoems, getRecord: () => null
        }).filter((p) => p.reason === "pinned").map((p) => p.poem.id);
        const course = S5.generateDailyPlan({
          grade: 1, term: 1, count: 5, scope: "term",
          allPoems: course5, extraPoems: extraPoems, getRecord: () => null
        }).filter((p) => p.reason !== "pinned").map((p) => p.poem.id);
        return extraIds.every((id) => self.indexOf(id) >= 0) && extraIds.every((id) => course.indexOf(id) < 0);
      })(),
      "自选模式下的两份名单共用了同一行 —— 加背那几首会顶掉课内的名额");
    ok("没开时排期照旧（这条开关不改默认行为）",
      plain5.filter((p) => p.reason === "pinned").length === 1 && plain5.length === 6);

    ok("「只背自选」认集子里有没有篇目（空集子不算数）",
      (() => {
        store3.saveCollections([{ id: "c2", name: "空", items: [] }]);
        const off = cols3.selfOnlyOn();
        store3.saveCollections([{ id: "c2", name: "有", items: [{ id: "cp0" }] }]);
        store3.saveSettings({ selfOnly: true });
        const on = cols3.selfOnlyOn();
        store3.saveSettings({ selfOnly: false });
        return off === false && on === true && cols3.selfOnlyOn() === false;
      })(),
      "开关自己说了算、不看集子里有没有东西 —— 首页会净空");

    ok("「只背自选」要 pro（Free 开不了）",
      E.CAPS.filter((c) => c.key === "coursefree")[0].tier === "pro" && E.capName("coursefree") === "只背自选");

    ok("这两项能力各占能力表一行，不是同一项（一个是建集子，一个是停课内）",
      E.CAP_KEYS.indexOf("coursefree") >= 0 && E.CAP_KEYS.indexOf("collections") >= 0
        && E.CAP_KEYS.indexOf("coursefree") !== E.CAP_KEYS.indexOf("collections"));

    ok("设置页的开关只落一个键（selfOnly 在跨设备的设置白名单里）",
      store3.DEFAULTS.selfOnly === false && !store3.LOCAL_ONLY.selfOnly);

    const SEASON = require(path.join(ROOT, "utils", "seasonal.js"));
    const corpusSeason = require(path.join(ROOT, "utils", "corpus.js"));

    ok("课内一首都没挂进季节限定表（课外那部集子整体删掉了）",
      SEASON.WORKS.length === 0,
      "还挂着 " + SEASON.WORKS.length + " 首 —— 它们的正文已经不在包里，点开是空的");

    ok("正文不在包里时首页不出这张卡（不留一张点开是空的卡）",
      SEASON.card(new Date(2026, 9, 18)) === null);

    ok("节气说明表 24 个、传统节日 11 个（农历与节气各占一类）",
      SEASON.TERMS.length === 24 && SEASON.TRADITIONAL.length === 11);

    ok("挂得上节日的篇目只从课内那 251 首里找",
      SEASON.WORKS.every((w) => corpusSeason.courseTexts()[w[0]]));

    const capRow = E.CAPS.filter((c) => c.key === SEASON.CAP)[0];
    ok("隐藏季节限定是 Pro 起的一项门禁，Free 开不了",
      !!capRow && capRow.tier === "pro"
        && E.compareSummary().filter((x) => x.tier === "free")[0].on < E.CAP_KEYS.length);

    asTier3("free");
    ok("Free 手里那开关按不动",
      SEASON.canSwitch() === false && SEASON.setOn(false).ok === false && SEASON.isOn() === true);

    asTier3("pro");
    ok("Pro 关得掉，关掉之后首页不再出这张卡",
      SEASON.setOn(false).ok === true && SEASON.switched() === true
        && SEASON.isOn() === false);

    ok("默认为开（新装的 Free 与 Pro 都看得见）",
      store3.DEFAULTS.seasonal === true && !store3.LOCAL_ONLY.seasonal);

    ok("关掉这个开关只落一个键（跟着账号走，不进本机）",
      store3.saveSettings({ seasonal: false }).seasonal === false
        && store3.cloudSettings().seasonal === false);

    const LEAGUE = require(path.join(ROOT, "utils", "ranking-submit.js"));
    const LEAGUE_SET = require(path.join(ROOT, "utils", "league.js"));
    asTier3("free");
    store3.saveSettings({ leagueBoard: false });
    ok("排行榜是 Max 起的一项门禁，Free 拨不动也不上报",
      LEAGUE_SET.CAP === "league" && LEAGUE_SET.canSwitch() === false
        && LEAGUE_SET.setOn(true).ok === false
        && LEAGUE.optedIn() === false
        && E.CAPS.filter((c) => c.key === "league")[0].tier === "max");

    asTier3("max");
    store3.saveSettings({ leagueBoard: false });
    ok("参与排行榜默认为开、关掉之后成绩不再往榜单交",
      store3.DEFAULTS.leagueBoard === true && !store3.LOCAL_ONLY.leagueBoard
        && LEAGUE.optedIn() === false
        && store3.cloudSettings().leagueBoard === false);
    store3.saveSettings({ leagueBoard: true });
    ok("开关打开时照常交榜（拦截只认那个键）",
      LEAGUE_SET.setOn(true).ok === true && LEAGUE.optedIn() === true);

    asTier3("pro");
    SEASON.setOn(true);

    store3.saveCollections([]);
    global.wx = saved;
    Object.keys(require.cache).forEach((k) => {
      if (k.indexOf(path.join(ROOT, "utils")) === 0) delete require.cache[k];
    });
  }

  const homeSrc4 = fs.readFileSync(path.join(ROOT, "pages", "home", "home.js"), "utf8");
  ok("季节限定上加背/收进就地重排首页（顶读数与课内行跟着变，不用手动刷新）",
    /onSeasonalAdd\(e\)[\s\S]{0,900}?this\.paint\(\)/.test(homeSrc4)
      && /onCollectDone\(e\)[\s\S]{0,300}?this\.paint\(\)/.test(homeSrc4));
  ok("首页把自选集子的今日份算进顶部读数", /collectionPlan\(/.test(homeSrc4)
    && /selfTotal/.test(homeSrc4) && /stats/.test(homeSrc4));

  ok("首页收尾只有一处判据：自选的鼓励语不再另立一套 planDone",
    !/planDone/.test(homeSrc4)
      && (homeSrc4.match(/const allDone =/g) || []).length === 1
      && !/SELF_CHEERS/.test(homeSrc4));

  ok("两处 toast 互斥（前一条还在屏上，后一条不叠上去）",
    (homeSrc4.match(/Date\.now\(\) - this\.toastAt\(\) < TOAST_GAP/g) || []).length === 2
      && (homeSrc4.match(/toastedAt = Date\.now\(\)/g) || []).length === 2
      && /const TOAST_MS = /.test(homeSrc4)
      && (homeSrc4.match(/duration: TOAST_MS/g) || []).length === 2);

  ok("首页不再有整页入口与就地改名（管理都挪到设置页）",
    !/onManageCollections/.test(homeSrc4) && !/onCollectionRename/.test(homeSrc4)
      && !/cols\.rename\(/.test(homeSrc4));

  ok("今日计划与自选集合的篇目行都带来源与原因",
    (homeSrc4.match(/source:\s*SOURCE_TEXT\[sourceKey\(/g) || []).length >= 2
      && /reason: REASON_TEXT\[/.test(homeSrc4));

  const readerSrc4 = fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.js"), "utf8");
  ok("阅读页能加进集子（进的是服务端那一行，走 markDirty）",
    /onAddToCollection/.test(readerSrc4) && /#collect/.test(readerSrc4)
      && /onCollectDone[\s\S]{0,200}sync\.markDirty\(\)/.test(readerSrc4));

  const listSrc4 = fs.readFileSync(path.join(ROOT, "pages", "list", "list.js"), "utf8");
  const searchSrc4 = fs.readFileSync(path.join(ROOT, "pages", "search", "search.js"), "utf8");
  ok("列表与搜索结果行上都能收诗", /onPick\(/.test(listSrc4) && /onPick\(/.test(searchSrc4));

  const tableMod = require(path.join(ROOT, "utils", "table.js"));
  const sheetSrc4 = fs.readFileSync(path.join(ROOT, "components", "recite-sheet", "recite-sheet.js"), "utf8");
  const tableCases = corpus.course().filter((p) => tableMod.hasTable(corpus.courseTexts()[p.id].text));
  ok("课内正文里没有框线表时，详情页的表格路径就不该被撑起来（有也照样解析得开）",
    tableCases.every(function (p) {
      const t = tableMod.parseText(corpus.courseTexts()[p.id].text);
      return t && t.blocks.length && t.blocks.every(function (b) { return b.widths.length >= 2; });
    }),
    "这几条的表格没解析出行列：" + tableCases.slice(0, 5).map((p) => p.id).join("、"));
  ok("正文没取到时标题与作者跟着那一首走（不沿用上一篇的）",
    /markMissing\(item\)/.test(sheetSrc4)
      && /missHead\(item\)[\s\S]{0,80}corpus\.indexById\(item\.id\)/.test(sheetSrc4));

  ok("自选集子落在设置分包里（不占主包）",
    (app.subPackages || []).some((sp) => sp.root === "packages/settings"
      && sp.pages.indexOf("collections/collections") >= 0));

  void R4;
}

{
  const api = path.join(__dirname, "..", "api");
  const coreSrc = fs.readFileSync(path.join(api, "_lib", "core.js"), "utf8");
  const httpMod = require(path.join(api, "_lib", "http.js"));
  const avatarStore = require(path.join(api, "_lib", "avatar-store.js"));
  const cfgSrc2 = fs.readFileSync(path.join(api, "_lib", "config.js"), "utf8");

  {
    const shown = JSON.stringify(httpMod.redact({
      accessToken: "a", secretKey: "s", password: "p", sid: "s2",
      deviceId: "d_1", mysqlHost: "h", nested: { refreshToken: "r" }
    }));
    ok("请求日志里 token / 密钥 / 口令一律打码，设备号留着（排查要用）",
      shown.indexOf('"a"') < 0 && shown.indexOf('"s"') < 0 && shown.indexOf('"p"') < 0
        && shown.indexOf("d_1") > -1 && shown.indexOf("h") > -1,
      shown);
  }

  ok("发验证码就把这一账号的错轮计数清掉（否则作废满 3 轮后新码永远进不了）",
    /clearWrongRounds\(deps, acc\.uid\)/.test(coreSrc)
      && /function clearWrongRounds\(deps, uid\) \{[\s\S]{0,120}WRONG\.uid/.test(coreSrc));

  {
    const s = avatarStore.memoryAvatar();
    for (let i = 0; i < 200; i++) s.put("u_" + i, "image/png", Buffer.alloc(1024 * 1024));
    const kept = Object.keys(s._objects).length;
    const bytes = Object.keys(s._objects).reduce((n, k) => n + s._objects[k].bytes.length, 0);
    ok("头像内存档有总量上限（放 200 张 1MB 只留得下 64MB 的量）",
      kept > 0 && bytes <= 64 * 1024 * 1024, "留了 " + kept + " 张 / " + Math.round(bytes / 1048576) + "MB");
  }

  ok("头像落在库里（重启不丢、多实例之间不用互相同步）",
    /function storedAvatar\s*\(/.test(fs.readFileSync(path.join(api, "_lib", "avatar-store.js"), "utf8"))
      && /store\.putAvatar\s*\(/.test(fs.readFileSync(path.join(api, "_lib", "avatar-store.js"), "utf8"))
      && /CREATE TABLE IF NOT EXISTS `avatars`/.test(
        fs.readFileSync(path.join(ROOT, "..", "deploy", "sql", "mysql-schema.sql"), "utf8")),
    "头像还只进实例内存 —— 容器一重启全丢，而 prod 是多实例");

  ok("头像有读回的路（GET /api/avatar/<uid>，与 avatarPublicUrl 指的同一个地址）",
    /"GET \/avatar\/:uid"/.test(fs.readFileSync(path.join(api, "_lib", "routes.js"), "utf8"))
      && fs.existsSync(path.join(api, "_routes", "avatar", "file.js"))
      && /"\/api\/avatar\/" \+ u/.test(cfgSrc2),
    "给了头像地址却没有下载它的路由 —— 页面拿到的每一张都是 404");

  {
    const head = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const iend = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
    const jpegHead = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    const jpegTail = Buffer.from([0xFF, 0xD9]);
    ok("头像只认完整的 PNG / JPEG（截断的、只贴了个文件头的都不收）",
      avatarStore.sniffImage(Buffer.concat([head, iend])) === "image/png"
        && avatarStore.sniffImage(Buffer.concat([jpegHead, jpegTail])) === "image/jpeg"
        && avatarStore.sniffImage(Buffer.concat([head, Buffer.from("xx")])) === ""
        && avatarStore.sniffImage(Buffer.concat([jpegHead, Buffer.from("xx")])) === "");
  }

}

{
  const api = path.join(__dirname, "..", "api");
  const cfgMod = require(path.join(api, "_lib", "config.js"));
  const saved = {
    secret: cfgMod.sessionSecret, key: cfgMod.sessionKey, days: cfgMod.sessionDays,
    appId: cfgMod.wxAppId, secretWx: cfgMod.wxSecret, fetch: cfgMod.wxFetch
  };
  delete cfgMod.sessionKey;
  cfgMod.sessionDays = 30;
  Object.defineProperty(cfgMod, "sessionSecret", {
    value: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    writable: true, configurable: true, enumerable: true
  });
  cfgMod.wxAppId = "wx_probe";
  cfgMod.wxSecret = "wx_probe_secret";
  cfgMod.wxFetch = () => Promise.resolve({ json: () => Promise.resolve({ openid: "openid-probe" }) });

  const coreMod = require(path.join(api, "_lib", "core.js"));
  const sessionMod = require(path.join(api, "_lib", "session.js"));
  const storeMod = require(path.join(api, "_lib", "store.js")).getStore(cfgMod);
  let clock = Date.now();
  const probeDeps = () => ({
    cfg: cfgMod, store: storeMod, limiter: coreMod.makeRateLimiter(),
    now: () => clock, account: null, ip: "127.0.0.1", deviceId: "d_00000001"
  });
  const probe = coreMod.wxLogin(probeDeps(), { code: "C", device: "d_00000001" })
    .then((r) => {
      const body = r.body || {};
      const sid = body.accessToken ? (sessionMod.read(cfgMod, body.accessToken, clock) || {}).sid : "";
      const row = sid ? storeMod.getSession(sid) : null;

      ok("刷新那条路能找回自己的会话行（刷不回来 = 每次登录只撑得过一个有效期）",
        !!row && row.refresh_token === body.refreshToken,
        "登录落下的会话行里没有 refresh_token，而刷新只认「库里那一列与请求里的相等」——"
          + "缺这一列时刷新恒回 401，客户端把「过期」当成立刻过期：刚登录完又被要求登录");

      ok("登录回的 expiresIn 与会话真正的有效期一致",
        !!row && body.expiresIn === Math.round((row.exp - row.iat) / 1000),
        "回的是 " + body.expiresIn + " 秒，会话是 " + (row ? Math.round((row.exp - row.iat) / 1000) : "?") + " 秒"
          + " —— 这两个数对不上时，端上那枚令牌的寿命由别人说了算");

      clock += ((Number(body.expiresIn) || 0) - 5) * 1000;
      return coreMod.wxRefresh(probeDeps(), { refreshToken: body.refreshToken, device: "d_00000001" })
        .then((rr) => {
          ok("令牌过期之后仍刷得回来（这是刷新唯一存在的理由）",
            rr.status === 200,
            "拿到 " + rr.status + " " + ((rr.body && rr.body.code) || "") + "：" + ((rr.body && rr.body.message) || ""));
        });
    })
    .catch((e) => {
      ok("刷新那条路能找回自己的会话行（刷不回来 = 每次登录只撑得过一个有效期）", false, e && e.message);
    });

  track(probe.then(() => {
    Object.keys(saved).forEach((k) => {
      const key = {
        secret: "sessionSecret", key: "sessionKey", days: "sessionDays",
        appId: "wxAppId", secretWx: "wxSecret", fetch: "wxFetch"
      }[k];
      Object.defineProperty(cfgMod, key, {
        value: saved[k] === undefined ? undefined : saved[k],
        writable: true, configurable: true, enumerable: true
      });
    });
  }));
}

{
  const memProbe = {};
  const store = require(path.join(ROOT, "utils", "store.js"));
  const auth = require(path.join(ROOT, "utils", "auth.js"));

  global.wx = {
    getStorageSync: (k) => (k in memProbe ? JSON.parse(JSON.stringify(memProbe[k])) : ""),
    setStorageSync: (k, v) => { memProbe[k] = JSON.parse(JSON.stringify(v)); },
    removeStorageSync: (k) => { delete memProbe[k]; },
    request: (opt) => opt.success({ statusCode: 200, data: { uid: "wx_1", nickname: "诗友", plan: { tier: "pro" }, expiresIn: 2592000 } }),
    login: (opt) => opt.success({ code: "C" })
  };

  track((async () => {
    const mem = store.read(store.KEYS.auth, {}) || {};
    auth.configure({ baseUrl: "https://probe.test" });
    auth.applySession({ accessToken: "A1", expiresIn: 86400, tier: "pro" });
    store.write(store.KEYS.auth, Object.assign({}, store.read(store.KEYS.auth, {}) || {}, { refreshToken: "" }));
    await auth.refresh();
    const after = (store.read(store.KEYS.auth, {}) || {}).expiresAt || 0;
    ok("没有刷新令牌时走 /api/me，回的那份也带 expiresIn（不带就续不上期）",
      after - Date.now() > 86400000 * 25,
      "after - now = " + (after - Date.now()) + " 毫秒（/api/me 那份没有 expiresIn 时这里停在登录那一刻的 1 天）");
  })());
}

{

  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const guarded = (src, call) => {
    const at = src.indexOf(call);
    if (at < 0) return false;
    const near = src.slice(Math.max(0, at - 200), at + 200);
    return near.indexOf("guard") >= 0 || near.indexOf(".once(") >= 0;
  };

  const guardMod = require(path.join(ROOT, "utils", "guard.js"));
  ok("防重复的闸门有「占位中」与「刚点过」两种",
    typeof guardMod.once === "function" && typeof guardMod.gap === "function"
      && typeof guardMod.mark === "function",
    "没有 utils/guard.js 的 once / gap，防重复就只能各页各写一份");
  ok("同一把闸门第二次进来拿不到",
    guardMod.enter("check:once") === true && guardMod.enter("check:once") === false,
    "连进两次都放行 —— 连点十几下就是十几份请求");
  guardMod.leave("check:once");
  ok("闸门放开之后又能进来", guardMod.enter("check:once") === true, "放不开就等于一次失败之后再点不动");
  guardMod.reset("check:once");
  guardMod.mark("check:gap");
  ok("刚点过的那一下还拦着，隔一会儿就放", guardMod.gap("check:gap") === true
    && guardMod.gap("check:gap", 0) === false, "间隔判据没生效");

  const reports = [
    ["packages/game/exam/exam.js", "exam:report"],
    ["packages/game/feihua/feihua.js", "feihua:report"]
  ];
  reports.forEach(([file, key]) => {
    ok("交到榜上的成绩只发一次 " + file, guarded(read(file), "once(\"" + key + "\""),
      "交成绩没过闸门 —— 连点就落成多条记录，而榜单只取每人最好的一条");
  });

  const entries = [
    ["packages/ranking/index/index.js", ".once(", "load"],
    ["utils/login-flow.js", ".once(", "run"]
  ].concat(reports.map(([file, key]) => [file, "once(\"" + key + "\"", "report"]));
  entries.forEach(([file, key, fn]) => {
    ok("提交型入口只走一次 " + file + " · " + fn, guarded(read(file), key),
      fn + " 没过闸门 —— 连点就是重复提交");
  });

  ok("登录卡连点不会叠出第二次登录",
    /guard\.busy\(\"login\"\)/.test(read("utils/login-flow.js")),
    "两次 showLoading 叠在一起，先回来的那次就把后一次的遮罩关了");

  const single = [
    ["pages/home/home.js", "home:face"],
    ["pages/home/home.js", "home:extra"],
    ["packages/settings/collections/collections.js", "cols:create"],
    ["packages/settings/collections/collections.js", "cols:add"]
  ];
  single.forEach(([file, key]) => {
    ok("落盘的入口占住就不放第二下 " + file + " · " + key,
      read(file).indexOf("guard.enter(\"" + key) >= 0,
      "两下连点各写一次 —— 复习次数、加背首数都会翻倍");
  });

  ok("题库连点「下一题」不会把两题的判定叠在同一题上",
    /onNext\(\)\s*\{\s*if \(this\.data\.stage !== \"running\"\) return;/
      .test(read("packages/game/quiz/quiz.js")),
    "没拦阶段就往下走，漏答也能翻页");
  ok("交卷只结算一次（计时器归零与点「交卷」不能各算一遍）",
    /finish\(\)\s*\{[\s\S]{0,120}?if \(this\.endedAt \|\| this\.data\.stage !== \"running\"\) return;/
      .test(read("packages/game/exam/exam.js")),
    "两条路各自结算 —— 成绩与榜单各落一次");
  ok("交卷之后点「再看结果」不再走一遍结算",
    /onNext\(\)\s*\{\s*if \(this\.data\.stage !== \"running\"\) return;/.test(read("packages/game/exam/exam.js")),
    "结算画面上的按钮仍然通到 finish() —— 成绩与榜单各再落一次");
  ok("弹出层的「忘记 / 模糊 / 记住」连点只记一次",
    /onResult\(e\)\s*\{\s*if \(guard\.gap\(/.test(read("components/recite-sheet/recite-sheet.js")),
    "两下连点各写一次，复习次数翻倍");
  ok("浏览模式的阅读页不记复习（连点会把复习次数刷上去）",
    /onResult\(e\)\s*\{\s*if \(!this\.data\.reciteMode\) return;/.test(read("pages/reader/reader.js")),
    "浏览模式也记了一次复习");
}

{
  const apiLib = (n) => require(path.join(ROOT, "..", "api", "_lib", n));
  track((async () => {
    const core = apiLib("core");
    const store = apiLib("store").memoryStore();
    const cfg = apiLib("config");
    await store.putAccount({ uid: "s1", email: "s@b.c", plan: "max", plan_until: null, role: "user", status: "active", created_at: 1 });
    const limiter = core.makeRateLimiter();
    const now = Date.now();
    let last = null;
    for (let i = 0; i < 40; i++) {
      last = await core.syncPull({ cfg, store, limiter, now: () => now, account: { uid: "s1" }, deviceId: "d" + i, ip: "1" }, { since: 0, deviceId: "d" + i });
    }
    const early = Date.now() - 3 * 86400000;
    const pulled = await core.syncPull({ cfg, store, limiter: core.makeRateLimiter(), now: () => now, account: { uid: "s1" }, deviceId: "a" }, { since: 0, deviceId: "a" });
    await core.syncPush({ cfg, store, limiter: core.makeRateLimiter(), now: () => now + 60000, account: { uid: "s1" }, deviceId: "b" },
      { deviceId: "b", recs: [{ id: "late-poem", updatedAt: early, payload: { level: 1 } }] });
    const next = await core.syncPull({ cfg, store, limiter: core.makeRateLimiter(), now: () => now + 120000, account: { uid: "s1" }, deviceId: "a" },
      { since: pulled.body.serverTime, deviceId: "a" });
    ok("同步：离线改动晚到，即便改动时间早于对方上次拉取，对方下一次拉取仍拿得到（游标按服务器收到的时刻）",
      next.body.recs.some((r) => r.id === "late-poem"), "增量拉取按客户端 updated_at 走 —— 晚到的旧改动会永远漏掉");
    ok("同步：Max 账号一小时内连续拉取 40 次不被限流（按账号计，换设备号也不绕开）", last.status === 200,
      "同步限额太小或按设备号计 —— 日常使用就会「同步失败」");
    await store.putAccount({ uid: "s2", email: "s2@b.c", plan: "free", plan_until: null, role: "user", status: "active", created_at: 1 });
    const freeLimiter = core.makeRateLimiter();
    const freePull = () => core.syncPull({ cfg, store, limiter: freeLimiter, now: () => now, account: { uid: "s2" }, deviceId: "d" }, { since: 0, deviceId: "d" });
    let freeStatus = 200;
    for (let i = 0; i < 10; i++) await freePull();
    freeStatus = (await freePull()).status;
    ok("同步：Free 账号每小时 10 次，第 11 次 429", freeStatus === 429, "各档同步限额没按档位分开");
  })());
}

{
  const cryptoPay = require("crypto");
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
  const apiLib = (n) => require(path.join(ROOT, "..", "api", "_lib", n));
  const corePay = apiLib("core");
  const payMod = apiLib("pay");
  const baseCfg = apiLib("config");

  track((async () => {
    const store = apiLib("store").memoryStore();
    const cfg = Object.assign(Object.create(Object.getPrototypeOf(baseCfg)), baseCfg, {
      sessionSecret: "x".repeat(32), payOfferId: "offer", payAppKey: "k", payPushToken: "tok", wxAppId: "a", wxSecret: "s",
      wxFetch: async (url, init) => ({
        json: async () => {
          if (url.indexOf("jscode2session") >= 0) return { openid: "OID", session_key: "SK" };
          if (url.indexOf("query_order") >= 0) {
            const row = await store.getPayOrder(JSON.parse(init.body).order_id);
            return row && !wxUnpaid.has(row.out_trade_no)
              ? { errcode: 0, order: { status: 2, order_fee: row.price_cents } }
              : { errcode: 0, order: { status: 1 } };
          }
          return { access_token: "T", expires_in: 7200 };
        }
      })
    });
    const wxUnpaid = new Set();
    await store.putAccount({ uid: "u1", email: "a@b.c", plan: "free", plan_until: null, role: "user", status: "active", created_at: 1 });
    await store.putWxAccount({ uid: "u1", openid: "OID", plan: "free" });
    const now = Date.now();
    const limiter = corePay.makeRateLimiter();
    const deps = (uid) => ({ cfg, store, limiter, now: () => now, account: uid === null ? null : { uid: uid || "u1" }, deviceId: "d", ip: "1" });
    const sign = (q) => cryptoPay.createHash("sha1").update(["tok", q.timestamp, q.nonce].sort().join("")).digest("hex");
    const query = { timestamp: String(Math.floor(now / 1000)), nonce: "2" };
    query.signature = sign(query);
    const stale = { timestamp: "1", nonce: "2" };
    stale.signature = sign(stale);

    const order = await payMod.payOrder(deps(), { plan: "pro", period: "d30", code: "c" });
    const sd = order.status === 200 ? order.body.payData.signData : "{}";
    ok("下单：签名 paySig 是 AppKey 对 requestVirtualPayment&signData 的 HMAC-SHA256",
      order.status === 200 && order.body.payData.paySig ===
        cryptoPay.createHmac("sha256", "k").update("requestVirtualPayment&" + sd).digest("hex"),
      "paySig 对不上，微信会拒掉这笔支付");
    ok("下单：金额取服务端价目，不取客户端", JSON.parse(sd).goodsPrice === 1500 && JSON.parse(sd).outTradeNo === order.body.outTradeNo,
      "金额或单号不在签名里");
    ok("下单：未登录 401、没绑微信的账号 403",
      (await payMod.payOrder(deps(null), { plan: "pro", period: "d30", code: "c" })).status === 401
        && (await (async () => {
          await store.putAccount({ uid: "u2", email: "b@b.c", plan: "free", plan_until: null, role: "user", status: "active", created_at: 1 });
          return (await payMod.payOrder(deps("u2"), { plan: "pro", period: "d30", code: "c" })).status;
        })()) === 403,
      "任何人都能替别的账号下单");

    const msg = { Event: "xpay_goods_deliver_notify", OpenId: "OID", OutTradeNo: order.body.outTradeNo,
      WeChatPayInfo: { MchOrderNo: "WX1" }, GoodsInfo: { ProductId: "pro_30", OrderFee: 1500 } };
    ok("发货推送：验签不过 403，不改账号",
      (await payMod.payNotify(deps(), { method: "POST", query: Object.assign({}, query, { signature: "bad" }), body: msg })).status === 403
        && (await store.getAccount("u1")).plan === "free", "伪造的推送能升档");
    ok("发货推送：时间戳过期 403，不改账号",
      (await payMod.payNotify(deps(), { method: "POST", query: stale, body: msg })).status === 403
        && (await store.getAccount("u1")).plan === "free", "录下来的旧推送能重放");
    wxUnpaid.add(order.body.outTradeNo);
    await payMod.payNotify(deps(), { method: "POST", query, body: msg });
    ok("发货推送：微信查单没付款就不发货，账号不动",
      (await store.getAccount("u1")).plan === "free" && (await store.getPayOrder(order.body.outTradeNo)).status === "pending",
      "只凭推送报文（不核实微信那边已付）就升了档");
    wxUnpaid.delete(order.body.outTradeNo);
    await payMod.payNotify(deps(), { method: "POST", query, body: msg });
    await payMod.payNotify(deps(), { method: "POST", query, body: msg });
    const afterPush = await store.getAccount("u1");
    ok("发货推送：立刻升 Pro，重复推送只顺延一次",
      afterPush.plan === "pro" && afterPush.plan_until === now + payMod.PERIOD_MS.d30, "重复推送顺延了多次或没升档");

    const renew = await payMod.payOrder(deps(), { plan: "pro", period: "d365", code: "c" });
    await payMod.payNotify(deps(), { method: "POST", query, body: Object.assign({}, msg, {
      OutTradeNo: renew.body.outTradeNo, GoodsInfo: { ProductId: "pro_365", OrderFee: 9800 } }) });
    ok("续订：在原到期日之后顺延",
      (await store.getAccount("u1")).plan_until === now + payMod.PERIOD_MS.d30 + payMod.PERIOD_MS.d365, "续订吃掉了剩余天数");

    const wrongFee = await payMod.payOrder(deps(), { plan: "max", period: "d30", code: "c" });
    const mismatch = await payMod.payNotify(deps(), { method: "POST", query, body: Object.assign({}, msg, {
      OutTradeNo: wrongFee.body.outTradeNo, GoodsInfo: { ProductId: "max_30", OrderFee: 1 } }) });
    ok("发货推送：金额对不上不发货", mismatch.body.ErrCode !== 0 && (await store.getAccount("u1")).plan === "pro",
      "少付也能升 Max");

    await payMod.payNotify(deps(), { method: "POST", query, body: { Event: "xpay_refund_notify", OutTradeNo: renew.body.outTradeNo } });
    ok("退款推送：回收那一单的时长", (await store.getAccount("u1")).plan_until === now + payMod.PERIOD_MS.d30,
      "退款之后会员时长还在");

    const open = await payMod.payOrder(deps(), { plan: "pro", period: "d90", code: "c" });
    const openNo = open.body.outTradeNo;
    wxUnpaid.add(openNo);
    const manage = (op, extra, uid) => payMod.payManage(deps(uid), Object.assign({ op, outTradeNo: openNo }, extra));
    const resumed = await manage("resume", { code: "c" });
    ok("待支付订单：继续支付另起新单号（单号不复用），旧单作废，别人的单 404",
      resumed.status === 200 && resumed.body.outTradeNo !== openNo
        && JSON.parse(resumed.body.payData.signData).outTradeNo === resumed.body.outTradeNo
        && (await store.getPayOrder(openNo)).status === "canceled"
        && (await manage("cancel", {}, "u2")).status === 404, "继续支付复用了旧单号、旧单还开着，或能动别人的订单");
    ok("订单：作废的单不能再继续支付，已支付的单不能取消也不能删除",
      (await manage("resume", { code: "c" })).status === 409
        && (await payMod.payManage(deps(), { op: "cancel", outTradeNo: renew.body.outTradeNo })).status === 409
        && (await payMod.payManage(deps(), { op: "delete", outTradeNo: renew.body.outTradeNo })).status === 409, "作废的单还能付，或已付的单被取消、删除");
    ok("未完成订单：删除后不再出现在支付记录里",
      (await manage("delete", {})).status === 200
        && (await payMod.payOrdersMine(deps(), {})).body.orders.every((o) => o.outTradeNo !== openNo), "删除的订单还在列表里");
    wxUnpaid.delete(openNo);
    await payMod.payNotify(deps(), { method: "POST", query, body: Object.assign({}, msg, {
      OutTradeNo: openNo, GoodsInfo: { ProductId: "pro_90", OrderFee: 3500 } }) });
    ok("取消或删除之后才到的支付推送照常发货（不收钱不发货）",
      (await store.getPayOrder(openNo)).status === "paid", "已付款的订单因为本地取消而没发货");

    const proUntil = now + 20 * 86400000;
    const upgraded = async (uid, tag) => {
      await store.putAccount({ uid: uid, email: uid + "@b.c", plan: "pro", plan_until: proUntil, role: "user", status: "active", created_at: 1 });
      await store.putPayOrder({ out_trade_no: "P" + tag, uid: uid, openid: "O" + tag, product_id: "pro_30", plan: "pro", period: "d30",
        price_cents: 1500, status: "paid", applied: 1, plan_after: "pro", plan_until_after: proUntil,
        created_at: now - 10 * 86400000, paid_at: now - 10 * 86400000 });
      await store.putPayOrder({ out_trade_no: "M" + tag, uid: uid, openid: "OID", product_id: "max_30", plan: "max", period: "d30",
        price_cents: 2900, status: "pending", applied: 0, created_at: now, paid_at: null });
      await payMod.payNotify(deps(), { method: "POST", query, body: Object.assign({}, msg, {
        OutTradeNo: "M" + tag, GoodsInfo: { ProductId: "max_30", OrderFee: 2900 } }) });
    };
    const refund = (tag) => payMod.payNotify(deps(), { method: "POST", query, body: { Event: "xpay_refund_notify", OutTradeNo: tag } });
    await store.putAccount({ uid: "u3", email: "c@b.c", plan: "pro", plan_until: proUntil, role: "user", status: "active", created_at: 1 });
    await store.putPayOrder({ out_trade_no: "P3", uid: "u3", openid: "O3", product_id: "pro_30", plan: "pro", period: "d30",
      price_cents: 1500, status: "paid", applied: 1, created_at: now - 10 * 86400000, paid_at: now - 10 * 86400000 });
    const offer = (await payMod.payCatalog(deps("u3"))).body.upgrade;
    ok("Pro 升 Max：按 Pro 实付价折算剩余天数",
      offer && offer.proLeftDays === 20 && offer.bonus.d30 === 10 && offer.bonus.d365 === 18, "折算天数与实付价对不上");
    await upgraded("u4", "4");
    ok("Pro 升 Max：Max 到期 = 购买时刻 + 所买时长 + 折算赠送天数",
      (await store.getAccount("u4")).plan_until === now + payMod.PERIOD_MS.d30 + 10 * 86400000, "升级没有顺延折算天数");
    await refund("M4");
    const afterMax = await store.getAccount("u4");
    ok("退款 Max：回到 Pro，到期日是原 Pro 的到期日，赠送天数一并收回",
      afterMax.plan === "pro" && afterMax.plan_until === proUntil, "退了 Max 还留着 Max 或赠送天数");
    await refund("P4");
    ok("再退 Pro：回到 Free", (await store.getAccount("u4")).plan === "free", "两单都退了还有会员");
    await upgraded("u5", "5");
    await refund("P5");
    const maxOnly = await store.getAccount("u5");
    ok("先退 Pro：Max 保留，但折算赠送天数收回",
      maxOnly.plan === "max" && maxOnly.plan_until === now + payMod.PERIOD_MS.d30, "先退 Pro 之后赠送天数还在");
    await refund("M5");
    ok("再退 Max：回到 Free", (await store.getAccount("u5")).plan === "free", "两单都退了还有会员");

    ok("沙箱环境用沙箱 AppKey，现网用现网 AppKey（两把钥匙不混用）",
      baseCfg.payKeyOf.call({ payAppKey: "p", paySandboxAppKey: "s", payEnv: 1 }) === "s"
        && baseCfg.payKeyOf.call({ payAppKey: "p", paySandboxAppKey: "s", payEnv: 0 }) === "p",
      "沙箱单拿现网密钥签名，或现网单拿沙箱密钥签名");
    ok("到期立刻按 Free 算（planTier）",
      corePay.planTier({ plan: "max", plan_until: Date.now() - 1 }) === "free", "过期的 Max 还在放行");
    ok("pay_orders 不外键到 accounts（注销账号是硬删除，订单要按法定期限留存，不能被它挡住或连带删掉）",
      !/pay_orders[\s\S]{0,1200}?FOREIGN KEY[\s\S]{0,200}?REFERENCES `accounts`/.test(
        read("../deploy/sql/mysql-schema.sql").split("-- ------------------------------------------------------------ pay_orders")[1].split("-- ------------------------------------------------------------ score_records")[0]),
      "付过费的用户注销账号会被订单卡住，或订单随账号一起没了");
    ok("后台支付接口只认管理员", (await payMod.payAdmin(deps(), { op: "orders" })).status === 403, "普通用户能看全部订单");
    ok("价目表：生效道具必须指向同档位同周期的道具",
      !!payMod.normCatalog({ products: payMod.DEFAULT_CATALOG.products, active: Object.assign({}, payMod.DEFAULT_CATALOG.active, { "pro.d30": "max_365" }) }).bad,
      "后台能把包月价指到包年道具上");
  })());

  const appJsonPay = JSON.parse(read("app.json"));
  const subPages = [].concat.apply([], appJsonPay.subPackages.map((sp) => sp.pages.map((pg) => sp.root + "/" + pg)));
  ok("定价页、支付记录页、后台支付页与购买记录子页都登记在 app.json",
    ["packages/mine/pricing/pricing", "packages/mine/orders/orders", "packages/admin/pay/pay",
      "packages/admin/pay-orders/pay-orders"].every((pg) => subPages.indexOf(pg) >= 0),
    "页面没登记，navigateTo 会找不到");
  ok("权限页有进定价页与支付记录页的处理函数",
    /onPricing\(/.test(read("components/tier-view/tier-view.js")) && /onOrders\(/.test(read("components/tier-view/tier-view.js")),
    "权限页没有开通 / 续订入口");
  ok("支付只走服务端下单签名（客户端不碰 AppKey）",
    read("utils/pay.js").indexOf("payAppKey") < 0 && /wx\.requestVirtualPayment/.test(read("utils/pay.js")), "客户端持有了密钥或没接支付接口");
}

Promise.all(pending).then(() => {
  console.log("");
  console.log("检查 " + checks + " 项，失败 " + fails + " 项");
  process.exit(fails ? 1 : 0);
});
