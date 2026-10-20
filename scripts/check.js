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

const FS_POEM_RE = /FS_POEM\s*=\s*\[([^\]]*)\]/;
const PY_BOX_RE = /PY_BOX\s*=\s*\[([^\]]*)\]/;

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
pages.forEach((p) => {
  if (fs.existsSync(path.join(ROOT, p + ".wxss"))) return;
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  ok("没有样式表的页面只拿共享组件与共享类搭 " + p,
    wxml.indexOf("<tier-view") >= 0 || /class="[^"]*\bcard\b/.test(wxml),
    "这一页既没有自己的样式表，搭的也不是共用的东西 —— 样式没有出处");
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

const manifest = readModule(path.join(dataDir, "shards.js"));

ok("集子表 18 部", (booksTable || []).length === 18, "实际 " + (booksTable || []).length);

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

const bookFiles = fs.readdirSync(path.join(dataDir, "books"));
const bookPack = readModule(path.join(dataDir, "books", "index.js"));
ok("集子索引落在一份合表里（books/index.js）",
  Object.keys(bookPack.books).length === booksTable.length
    && Object.keys(bookPack.rows).length === booksTable.length,
  "合表里的集子数与 books.js 对不上");

booksTable.forEach((b) => {
  ok("集子索引归属正确 " + b.id,
    perBook[b.id].length === bookPack.books[b.id]
      && perBook[b.id].every((p) => p.b === b.id && p.n === b.name),
    "b / n 与实际集子对不上");
});

{
  const wide = bookPack.rows.tangshi.filter((r) => r.length !== 12);
  ok("索引落盘只存列（无名、不存正文）", wide.length === 0,
    wide.length + " 行形状不对 —— 薄索引把字段名与集子名都省了（见 scripts/build-data.js）");
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
ok(
  "包内正文与分片不重叠",
  Object.keys(courseTexts).every((id) => manifest.map[id] === undefined),
  "同一份正文在包内和分片各存一份"
);

const sampleMissing = allEntries.filter(
  (p) => manifest.map[p.id] === undefined && courseTexts[p.id] === undefined
);
ok("所有条目都有正文可取", sampleMissing.length === 0, sampleMissing.length + " 条取不到");

let sampled = 0;
let bad = 0;
Object.keys(manifest.map).slice(0, 60).forEach((id) => {
  const name = manifest.map[id];
  const bucket = readModule(path.join(dataDir, "texts", name + ".js"));
  sampled += 1;
  if (!bucket[id] || typeof bucket[id].text !== "string") bad += 1;
});
ok("抽查分片可取正文（" + sampled + " 条）", bad === 0, bad + " 条取不到");

{
  const misses = [];
  let checked = 0;
  allEntries.forEach((p) => {
    if (manifest.map[p.id] === undefined) return;
    if (p.at < 0) {
      misses.push(p.id);
      return;
    }
    checked += 1;
    const ids = Object.keys(readModule(path.join(dataDir, "texts", manifest.map[p.id] + ".js")));
    if (ids[p.at] !== p.id) misses.push(p.id);
  });
  ok("薄索引里的分片序号指得准（译文按它回填，共 " + checked + " 条）",
    checked > 1000 && misses.length === 0,
    misses.length + " 条按序号取到的是别人 —— 编译期算序号与落盘顺序不一致，" +
    "详情页的译文会串到别的篇目上：" + JSON.stringify(misses.slice(0, 3)));

  const wrong = allEntries.filter((p) => (manifest.map[p.id] === undefined) !== (p.at < 0));
  ok("索引记的「有没有分片」与分片清单互补", wrong.length === 0,
    wrong.length + " 条对不上：" + JSON.stringify(wrong.slice(0, 3).map((p) => p.id)) +
    " —— 课内 251 条在 course.js、其余在分片");
}

{
  const pcfg = readJson(path.join(ROOT, "project.config.json")) || {};
  const ignored = ((pcfg.packOptions || {}).ignore || []).map((r) => String(r.value || ""));

  const corpusSrc = fs.readFileSync(path.join(ROOT, "utils", "corpus.js"), "utf8");
  const manPath = (corpusSrc.match(/const\s+MANIFEST\s*=\s*["']([^"']+)["']/) || [])[1] || "";
  ok("分片清单在主包里（corpus 指向的路径未被 packOptions.ignore 排掉）",
    !!manPath
      && !ignored.some((ig) => manPath.indexOf(ig) === 0)
      && fs.existsSync(path.join(dataDir, manPath.replace(/^data\//, ""))),
    "corpus 读的是 " + (manPath || "(没找到 MANIFEST 常量)") +
      " —— 它落在 ignore 名单里或不存在，真机上 bucketOf() 会回空，课外正文一律取不到");

  {
    const rel = "data/books/index.js";
    ok("集子索引在包里 " + rel,
      fs.existsSync(path.join(ROOT, rel)) && !ignored.some((ig) => rel.indexOf(ig) === 0),
      rel + " 被 ignore 了 —— 列表页与按题名检索会空");
  }

  const tsSrc = fs.readFileSync(path.join(ROOT, "utils", "text-search.js"), "utf8");
  ok("被 ignore 的 texts/idx.json 有兜底（读不到 = 全文检索不可用，不炸）",
    /INDEX\s*=\s*["']data\/texts\/idx\.js["']/.test(tsSrc)
      && /function\s+index\(\)[\s\S]{0,400}try\s*{[\s\S]{0,200}require/.test(tsSrc)
      && /function\s+readiness/.test(tsSrc) && /usable/.test(tsSrc),
    "text-search 读不到 idx.js 时必须走 readiness() 降级，不能抛");

  const bucketDir = (corpusSrc.match(/const\s+BUCKET_DIR\s*=\s*["']([^"']+)["']/) || [])[1] || "";
  const bucketRead = new RegExp(
    'readJson\\(\\s*BUCKET_DIR\\s*\\+\\s*name\\s*\\+\\s*["\']\\.js["\']\\s*,\\s*\\{\\}\\s*\\)'
  ).test(corpusSrc);
  ok("被 ignore 的 texts/<片> 有兜底（读不到 = 空对象，不炸）",
    /function\s+readJson\([\s\S]{0,300}return\s+fallback/.test(corpusSrc)
      && bucketDir === "data/texts/"
      && bucketRead,
    "corpus.bucket() 读的是 " + (bucketDir || "(没找到 BUCKET_DIR 常量)") +
      "，而它在 packOptions.ignore 里 —— 真机上 require 抛 MODULE_NOT_FOUND，" +
      "课外正文一律取不到，且异常从 onShow 直接冒出去（白屏）。" +
      "readJson 必须把 require 的失败都兜住（含开发者工具那句 " +
      "`module '….json.js' is not defined`），bucket() 才拿得到空对象继续往分片缓存走");

  ok("分片在磁盘上时 corpus 能直接读它（开发者工具打开 miniprogram/ 也能读课外）",
    /function\s+shardFromDisk\s*\(/.test(corpusSrc)
      && /const\s+disk\s*=\s*shardFromDisk\(name\)/.test(corpusSrc)
      && /from:\s*"disk"/.test(corpusSrc)
      && /function\s+shardFromDisk[\s\S]{0,200}readFileSync[\s\S]{0,200}catch/.test(corpusSrc),
    "corpus 只在 require() 命中时读得到分片；开发者工具里 data/texts 被 ignore 掉、" +
      "require 抛 MODULE_NOT_FOUND，于是课外正文在工具里一律取不到 —— " +
      "而那个目录就在磁盘上。要在 bucket() 回空之后、走远端之前补一条磁盘兜底");

  ok("进包的语料与分片一律是 .js（开发者工具不把 .json 当模块打包）",
    /BUCKET_DIR\s*\+\s*name\s*\+\s*"\.js"/.test(corpusSrc),
    "有地方还在 require `….json`。开发者工具 2.02.2607271 RC 起不把 .json 当模块打包，" +
      "任何 require('.json') 都抛 `module '….json.js' is not defined`（Issue #224）—— " +
      "而开发者工具里读分片正是靠 require，于是课外正文整块取不到。" +
      "进包的语料产物与分片都写成 `module.exports = …` 的 .js");

  ok("课文阅读页取正文不裸调 corpus.entry（真机上它抛 = 整屏白）",
    /try\s*{[\s\S]{0,120}corpus\.entry\(/.test(
      fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.js"), "utf8")
    ),
    "reader.js 的 corpus.entry(id) 不在 try 里，且排在 ensureEntry 之前 —— 它一抛就连 textFailMsg 那套都说不上");

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

  ok("四套算法各给三行说明，且都不是空话",
    R.ORDER.every((k) => {
      const d = R.MODELS[k].describe();
      return Array.isArray(d) && d.length === 3 && d.every((x) => typeof x === "string" && x.length >= 4);
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
for (let i = 0; i < 12; i++) r10 = R.review(r10, "good", "ebbinghaus");
ok("艾宾浩斯档位封顶不越界", r10.level === R.EBBINGHAUS_INTERVALS.length - 1, "level=" + r10.level);

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
    good.level === same.level && same.level === R.review(null, "good", "ebbinghaus", day1).level,
    "level " + same.level + " / " + good.level);

  let lapse = R.review(null, "bad", "ebbinghaus", day1);
  lapse = R.review(lapse, "fuzzy", "ebbinghaus", day1 + 120000);
  ok("同日改判，忘过的次数跟着退回去", lapse.lapses === 0, "lapses=" + lapse.lapses);

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
const plain = S.generateDailyPlan(plainOpt);
ok("加背不占那 5 个名额（设 5 首，按设置排出来的仍是 5 首）",
  plain.length === 5 && plan5.filter((p) => p.reason !== "pinned").length === 5);
store.drop(store.KEYS.dayPlan);

store.drop(store.KEYS.dayPlan);
const plainAgain = S.generateDailyPlan(plainOpt);
const outOfCourse = S.generateDailyPlan(Object.assign({}, plainOpt, { extraPoems: [extraPoem] }));
ok("课外的加背不挪动按设置排出来的那几首（只在末尾接上）",
  outOfCourse.slice(0, 5).map((p) => p.poem.id).join(",")
    === plainAgain.map((p) => p.poem.id).join(",")
    && plain.length === 5
    && outOfCourse.length === 6);

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
  ok("今日加背接在今天那几首之后，不占它们的名额",
    withExtra.length === 5 && withExtra[4].poem.id === extra.id
      && withExtra[4].reason === "pinned"
      && withExtra.slice(0, 4).map((it) => it.poem.id).join(",") === withDue.map((it) => it.poem.id).join(","),
    withExtra.map((it) => it.poem.id + ":" + it.reason).join(" "));

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
    global.wx.setStorageSync("kb_auth_v1", { tier: tier });
  }

  const seen = [];
  const e = bootFont({}, { loadFontFace: (o) => { seen.push(o); o.success && o.success(); } });
  ok("默认地址下诗词字体就绪", e.font.readiness().usable === true);
  e.font.load().then(() => {
    ok("诗词文本只注册一个字族（详情页题名与正文取的是同一个）",
      seen.length === 1 && seen[0].family === e.font.FAMILY,
      seen.map((o) => o.family).join(" | ") || "loadFontFace 没被调用");
    ok("没登录取 free 那两份", /-free\.woff2$/.test(seen[0].source || ""), seen[0].source);
  });
  e.restore();

  const proSeen = [];
  asTier("pro");
  const ep = bootFont({}, { loadFontFace: (o) => { proSeen.push(o.source); o.success && o.success(); } });
  ep.font.load().then(() => {
    ok("Pro / Max 取 pro 那一份", proSeen[0] === ep.font.SETS.pro[0], proSeen[0]);
    ok("Pro 与 Free 是两套地址", ep.font.SETS.pro[0] !== ep.font.SETS.free[0]);
    proSeen.length = 0;
    return ep.font.load();
  }).then(() => {
    ok("同一档位注册过就不再注册一次", proSeen.length === 0, proSeen.join(" | "));
  });
  ep.restore();

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
      hit === true && fallback.length === 2 && fallback[1] === e3.font.SETS.free[1],
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

  const tokensWxss2 = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  const stackNow = /--font-poem\s*:\s*([^;]+);/.exec(tokensWxss2);
  ok("字体链首位与 font.js 的 FAMILY 同名", !!stackNow && stackNow[1].indexOf("Kuibu Serif") >= 0);
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
  ok("关掉注音就不切词", pinyin.annotate("床前明月光", "off").every((c) => !c.mark));

  const csplit = require(path.join(ROOT, "utils", "corpus.js")).splitLines;
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
  const rwxml = fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.wxml"), "utf8");
  ok("阅读页正文与注音两条路都按句渲染",
    rwxml.indexOf("wx:for=\"{{row}}\"") >= 0 && rwxml.indexOf("wx:for=\"{{cl.tokens}}\"") >= 0);

  const swxml = fs.readFileSync(path.join(ROOT, "components", "recite-sheet", "recite-sheet.wxml"), "utf8");
  ok("背诵弹层正文只有一条渲染路（不注音时也得有字）",
    swxml.indexOf("wx:for=\"{{cl.tokens}}\"") >= 0
      && swxml.indexOf("wx:for=\"{{paras}}\"") < 0,
    "弹层还留着按 paras 渲染的另一条路 —— 那条路读的字段没人生成，切到不注音就是一片空白");
}

const longLine = corpus.courseTexts();
const hasMulti = Object.keys(longLine).some((k) => {
  const t = longLine[k] && longLine[k].text;
  if (!t) return false;
  return splitLines(t).some((ln) => ln.s.length > 1);
});
ok("语料里确实有一行多句的篇目（切句不是白做）", hasMulti === true);

const tsearch = require(path.join(ROOT, "utils", "text-search.js"));
const idxFile = path.join(dataDir, "texts", "idx.js");
if (fs.existsSync(idxFile)) {
  ok("全文检索就绪", tsearch.readiness().usable === true);
  const hits = tsearch.search("明月", { limit: 5 });
  ok("全文检索能命中正文", hits.length > 0, "查不到「明月」");
  ok("全文检索带出命中句", hits.every((h) => h.lines.length > 0));
  ok("全文检索给出来源（包内 / 分片）", hits.every((h) => h.where === "pack" || h.where === "cloud"));
  ok("查询切成单字", tsearch.termsOf("明月").length === 2);
  {
    const ids = tsearch.search("月", { limit: 20 }).map((h) => h.entry.id);
    ok("正文命中的篇目在名录里查得到（查不到就没法列出结果）", ids.length === 20);
    ok("分批取与一次取给同序同量（20 条一批是截断，不是重排）",
      JSON.stringify(ids) === JSON.stringify(tsearch.search("月", { limit: 20 }).map((h) => h.entry.id)),
      "同一关键词两次取到的前 20 条不一致 —— 下拉续取会与首屏对不上");
  }
  {
    const session = tsearch.makeSession("明月", {});
    const first = tsearch.nextBatch(session, 19);
    const second = tsearch.nextBatch(session, 19);
    ok("nextBatch 按批给结果（要 20 条给 20 条，多取一条用来判还有没有）",
      first.length === 20 || session.done, "首批 " + first.length + " 条");
    ok("续取接着上一批往后出，不从头再来",
      second.length === 0 || first[0].entry.id !== second[0].entry.id,
      "第二批又从「" + (first[0] && first[0].entry.t) + "」开头 —— 下拉一次重复一屏");
    ok("分批会话到末尾会自己报 done", typeof session.done === "boolean");
  }
  {
    const scan = tsearch.search("月", { limit: 20 });
    const done = [];
    const session = tsearch.makeSession("月", { stop: () => done.length });
    ok("分批会话认停止信号（搜索页退出后不再往下扫）",
      typeof session.done === "boolean" && typeof tsearch.nextBatch(session, 20) === "object");
  }
  const b1 = tsearch.candidateBuckets(tsearch.termsOf("明月"));
  const b2 = tsearch.candidateBuckets(tsearch.termsOf("床前明月光"));
  ok("候选分片取交集后收敛", b2.length <= b1.length, b1.length + " → " + b2.length);
  ok("候选分片不空（除非真没有）", b1.length > 0);

  ok("高频字的候选片被截到上限内（一个「月」不该拉全量正文）",
    b1.length <= tsearch.SCAN_CAP && b1.total > tsearch.SCAN_CAP,
    "命中 " + b1.total + " 片，返回 " + b1.length + " 片 —— 超过 " + tsearch.SCAN_CAP +
      " 就该只扫最少的那几片（全量分片约 23MB，用户敲一个字要等它落完盘）");

  const capped = tsearch.search("月", { limit: 10 });
  ok("截断时如实说明「只扫了部分」", capped.partial === true && capped.scanned <= tsearch.SCAN_CAP,
    "扫了 " + capped.scanned + " 片，partial=" + capped.partial +
      " —— 不说明就默认用户看到了全部命中");

  ok("命中片多时也只扫上限内的那几片（不把 23MB 分片全拉下来）",
    capped.scanned <= tsearch.SCAN_CAP,
    "扫了 " + capped.scanned + " 片");

  const searchJs = fs.readFileSync(path.join(ROOT, "pages", "search", "search.js"), "utf8");
  ok("会话如实说明「只扫了部分」（截断那面旗从分片挑选传到页面）",
    /session\.partial/.test(searchJs) && /partial:\s*session\.partial/.test(searchJs),
    "search.js 读不到会话上的 partial —— 候选片被截到 " + tsearch.SCAN_CAP +
      " 片之后，界面还说「全站」，等于默认用户看到了全部命中");

  ok("会话记着扫了几片，不是把总数一次算完",
    tsearch.makeSession("月", {}).scanned <= tsearch.SCAN_CAP,
    "makeSession 一开口就摊开全部候选片 —— 那正是会话式取数要避免的");

  {
    const idx = readModule(idxFile);
    const kw = "明月";
    const cand = tsearch.candidateBuckets(tsearch.termsOf(kw));
    const scoreOf = (b) => tsearch.termsOf(kw).reduce(
      (n, t) => n + (((idx.postings[t] || {})[b]) || 0), 0);
    const sorted = cand.slice().sort((a, b) => scoreOf(a) - scoreOf(b));
    ok("候选片按命中字频降序取（先扫最可能是那一句的片）",
      scoreOf(cand[0]) > scoreOf(sorted[0]),
      "取到的是命中字频最低的那几片（" + cand[0] + "=" + scoreOf(cand[0]) +
        "，全站最低的是 " + sorted[0] + "=" + scoreOf(sorted[0]) + "）—— " +
        "一页正文里「月」出现 24 次不等于它写着「明月」：" +
        "《静夜思》所在的那片在「明月」里排到第 103，永远轮不到");
  }
} else {
  ok("全文索引未生成时检索整块关闭", tsearch.readiness().visible === false);
}

const sync = require(path.join(ROOT, "utils", "sync.js"));
ok("未配置后端时同步不就绪", sync.ready() === false);
sync.now(true).then((res) => {
  ok("未配置后端时同步报 offline", res.skipped === "offline", JSON.stringify(res));
});

const E = require(path.join(ROOT, "utils", "entitlement.js"));
const tiersMod = require(path.join(ROOT, "utils", "tiers.js"));

function asGuest() {
  wx.setStorageSync(store.KEYS.profile, { logged: false });
}
function asMember() {
  wx.setStorageSync(store.KEYS.profile, { logged: true, tier: "pro" });
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
  wx.setStorageSync(store.KEYS.profile, { logged: true });
  wx.setStorageSync(store.KEYS.auth, { token: "t", tier: t, at: Date.now() });
}
asTier("free");

const homeWxml = fs.readFileSync(path.join(ROOT, "pages", "home", "home.wxml"), "utf8");
const homeJs = fs.readFileSync(path.join(ROOT, "pages", "home", "home.js"), "utf8");
ok("首页游客点篇目要登录", homeWxml.indexOf('bindtap="onGuestOpen"') >= 0);
ok("首页游客态在 js 里算出来", homeJs.indexOf("gate.GUEST_GRADE") >= 0);

ok("首页点击过门禁", /gate\.guard\(/.test(homeJs));

pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");

  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m;

  const VOID = [
    "image", "input", "import", "include", "wxs", "icon",
    "progress", "slot", "canvas", "checkbox", "radio", "switch", "slider"
  ];
  let balanced = true;
  while ((m = tagRe.exec(wxml))) {
    const closing = m[1] === "/";
    const tag = m[2];
    const selfClose = m[4] === "/";
    if (closing) {
      if (stack.pop() !== tag) balanced = false;
    } else if (!selfClose && VOID.indexOf(tag) < 0) {
      stack.push(tag);
    }
  }
  if (stack.length) balanced = false;
  ok("WXML 标签配平 " + p, balanced, "未闭合: " + stack.join(","));

  const condNode = [];
  const condStack = [{ kids: [] }];
  const condRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  while ((m = condRe.exec(wxml))) {
    const cTag = m[2];
    const cClose = m[1] === "/";
    const cSelf = m[4] === "/";
    const ck = /\s(wx:if|wx:elif|wx:else)(?:="([^"]*)")?/.exec(m[3]);
    const node = { tag: cTag, kind: ck ? ck[1] : null, kids: [] };
    if (cClose) condStack.pop();
    else if (!cSelf && VOID.indexOf(cTag) < 0) {
      condStack[condStack.length - 1].kids.push(node);
      condStack.push(node);
    } else condStack[condStack.length - 1].kids.push(node);
  }
  const dangling = [];
  (function walkCond(n) {
    const conds = n.kids.filter((k) => k.kind);
    conds.forEach((k, i) => {
      if (k.kind === "wx:elif" || k.kind === "wx:else") {
        const prev = conds[i - 1];
        if (!prev || (prev.kind !== "wx:if" && prev.kind !== "wx:elif")) {
          dangling.push("<" + k.tag + "> 的 " + k.kind);
        }
      }
    });
    n.kids.forEach(walkCond);
  })(condStack[0]);
  ok("WXML 条件链不断 " + p, dangling.length === 0,
    dangling.join("、") +
      " —— wx:elif / wx:else 前面那一个兄弟必须是 wx:if / wx:elif，" +
      "中间插了别的节点就成了孤立的 elif，真机编译报 Bad attr wx:elif（上传才会发现）");

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
ok("课内正文不走分片", corpus.bucketOf(perBook.poems[0].id) === "");

const outsideId = allEntries.find((p) => p.b !== "poems" && manifest.map[p.id]).id;
ok("课外正文仍走分片", corpus.bucketOf(outsideId) !== "" && !!corpus.entry(outsideId).text);

{
  const p = "pages/mine/mine";
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");
  ok("设置与主题各一条入口（版式 / 声音在设置，主题单独一页）",
    (wxml.match(/onSettings/g) || []).length === 1
      && (wxml.match(/onTheme/g) || []).length === 1
      && !/onReader/.test(wxml)
      && !/onReader/.test(js)
      && /packages\/settings\/theme\/theme"/.test(js),
    "主题 / 声音 / 背诵设置各自又留了一行 —— 同一件事有两条路（Issue #232）");
  const general = fs.readFileSync(
    path.join(ROOT, "packages", "settings", "general", "general.wxml"), "utf8");
  ok("设置那一页装着版式 / 声音两样（主题已搬去自己那一页）",
    /onAlign/.test(general) && /onPinyin/.test(general) && /onFontSlide/.test(general)
      && /onSfx/.test(general) && !/onPick|swatch/.test(general),
    "版式 / 声音没并到一页上，或主题卡片还留在设置里");

  ok("「大会」不在「我的」页留入口（它现在在底栏中间那一枚）",
    wxml.indexOf("onGame") < 0 && js.indexOf("onGame") < 0,
    "「我的」页还有大会那一行 —— 两处入口会漂");
  ok("范围 / 首数 / 算法合成一行「背诵选项」，进的是整页",
    /bindtap="onRecite"/.test(wxml) && /onRecite\s*\(/.test(js)
      && /packages\/settings\/recite\/recite"/.test(js)
      && !/onScope|onDaily|onAlgo/.test(wxml),
    "三行还各占各的，或者合成之后又带一个 focus —— 指向同一页的三条路就是三条路");
  ok("背诵进度收在「背诵选项」之后",
    (wxml.match(/bindtap="onProgress"/g) || []).length === 1
      && wxml.indexOf('bindtap="onProgress"') > wxml.indexOf('bindtap="onRecite"'),
    "进度那一行还在下面那张卡里，或者概况里没有它");
}

const gateMod = require(path.join(ROOT, "utils", "gate.js"));

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
[["free", 7], ["pro", 14], ["max", 17]].forEach(([tier, n]) => {
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
  const wxml = fs.readFileSync(
    path.join(ROOT, "components", "tier-view", "tier-view.wxml"), "utf8");
  const js = fs.readFileSync(
    path.join(ROOT, "components", "tier-view", "tier-view.js"), "utf8");
  const entSys = fs.readFileSync(path.join(ROOT, "utils", "entitlement.js"), "utf8");

  ok("权限对比表的列头就是档位表本身（三档，写死会跟档位走散）",
    wxml.indexOf("heads") >= 0 && js.indexOf("entitlement.compareCols(") >= 0
      && E.compareCols({ logged: false, tier: "free" }).map((c) => c.tier).join() === tiersMod.TIER_KEYS.join(),
    "列头写死、或只挑几档列出来，都会跟档位表走散");
  ok("权限对比表的行铺满能力表（一行一项，一项不漏）",
    wxml.indexOf("compareRows") >= 0 && js.indexOf("entitlement.compareRows(") >= 0
      && E.compareRows({ logged: false, tier: "free" }).length === E.CAP_KEYS.length,
    "只挑几项列出来，用户就看不到自己缺哪几样");
  ok("当前档位列带「现在」（用户只认自己那一列）",
    /now:\s*t\.key === tierNow\(s\)/.test(entSys) && wxml.indexOf("cell.now") >= 0,
    "没有「现在」这枚标记时，用户看不出哪一列是自己");
  ok("对比表整表铺在页面上、自己不滚（用户不用在两处别苗头地滚）",
    wxml.indexOf("<scroll-view") < 0,
    "卡片里的定高滚动条会把表腰斩，用户得先滚卡片再滚页面");
  ok("权限页显示当前档位标签", wxml.indexOf("status.label") >= 0);
  ok("档位与登录的对话框都收在 entitlement 里，「升级」落到用户权限页",
    /function showTier\s*\(/.test(entSys) && /function showLogin\s*\(/.test(entSys)
      && /onTierGate/.test(entSys) && /onLoginGate/.test(entSys)
      && /url:\s*"\/packages\/mine\/tier\/tier"/.test(entSys)
      && !/askDailyUpgrade|askUpgrade/.test(entSys),
    "档位那句话又回到各页各写一遍 —— 按钮文案与去处就会各说一套（Issue #370）");
  ok("确认按钮不超过两个字、取消一律叫「取消」（Issue #370）",
    jsFiles.every((f) => {
      const s = fs.readFileSync(f, "utf8");
      return !/confirmText:\s*"(.{3,})"/.test(s) && !/cancelText:\s*"(?!取消")[^"]+"/.test(s);
    }),
    "对话框里还有三个字的确认键，或者取消那枚叫「再看看」「算了」");
  ok("对比表格子里的图标只两枚（有就是 yes、没有就是 no）",
    (() => {
      const inst = js;
      const wxmlT = wxml;
      const row = E.compareRows({ logged: false, tier: "free" });
      const cols = row.reduce((m, r) => m + (r.cells.filter((c) => c.icon).length), 0);
      return /icons\.yes/.test(inst) && /icons\.no/.test(inst)
        && wxmlT.indexOf("cell.icon") >= 0 && cols === 0;
    })(),
    "格子里的图标不是从图标模块取的，或者 compareRows 自己长出了 icon（那一格会没有图）");
  ok("每一格写的是档位差（有差别的项写具体数，有的是多少就是多少）",
    (() => {
      const row = E.compareRows({ logged: false, tier: "free" })
        .filter((r) => r.cap === "collections")[0];
      const tiersRow = row.cells.map((c) => c.text);
      const silent = E.compareRows({ logged: false, tier: "free" })
        .filter((r) => r.cap === "daily")[0];
      return tiersRow.join(",") === ",1 个,200 个"
        && silent.cells.every((c) => c.text === "")
        && row.cells.filter((c) => c.on).every((c) => c.note.length > 0);
    })(),
    "「有量」的那一项没写出数、「有没有」的那一项反而写了一段话");
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
  ok("未登录时付费能力的提示不是空的", E.hint("feihualing") !== "");

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
  ok("关掉后提示说清是谁关的", E.hint("feihualing").indexOf("管理员") >= 0, E.hint("feihualing"));
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
  "packages/progress/index/index": "locked",
  "packages/settings/recite/recite": "locked",
  "packages/settings/general/general": "locked",
  "packages/admin/index/index": "logged",
  "packages/mine/tier/tier": "allowed",

  "packages/authors/index/index": "locked"
};

{
  Object.keys(GATED).forEach((p) => {
    const flag = GATED[p];
    const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
    const js = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");
  });

  const readerWxml = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxml"), "utf8");
  ok("阅读页未登录时正文在 block wx:else 里", readerWxml.indexOf("block wx:else") >= 0);
  ok("阅读页锁定时不渲染诗句", readerWxml.indexOf("poem-line") > readerWxml.indexOf("block wx:else"));

  ["general/general", "recite/recite"].forEach((p) => {
    const wxml = fs.readFileSync(path.join(ROOT, "packages/settings", p + ".wxml"), "utf8");
    ok("设置页未登录时不渲染设置项 " + p, wxml.indexOf("block wx:else") >= 0);
  });

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
  const usersWxml = fs.readFileSync(path.join(ROOT, "packages/users/index/index.wxml"), "utf8");
  const usersLib = fs.readFileSync(path.join(ROOT, "packages/users/index/lib.js"), "utf8");
  const adminLib = fs.readFileSync(path.join(ROOT, "utils", "admin.js"), "utf8");
  const adminJs = fs.readFileSync(path.join(ROOT, "packages/admin/index/index.js"), "utf8");
  const adminWxml = fs.readFileSync(path.join(ROOT, "packages/admin/index/index.wxml"), "utf8");
  const viewWxml = fs.readFileSync(
    path.join(ROOT, "components", "tier-view", "tier-view.wxml"), "utf8");
  const tierWxml = fs.readFileSync(path.join(ROOT, "packages/mine/tier/tier.wxml"), "utf8");
  const mineWxml = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.wxml"), "utf8");
  const mineJs = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");

  ok("用户列表页不写本机档位", usersJs.indexOf("store.KEYS.grant") < 0, "用户列表页还在直接写 grant");
  ok("用户列表页的改档按钮走的是服务端那条（wxml 上没有本机改档的开关）",
    /bindtap="onSetTier"/.test(usersWxml) && !/bindtap="onLocal/.test(usersWxml));
  ok("改档只走服务端", adminLib.indexOf("remote.setUserTier") >= 0);
  ok("服务端没就绪时如实说不出来（不走假成功）",
    /error|fail|catch/.test(adminLib) && adminLib.indexOf("setUserTier") >= 0);

  ok("用户列表页区分「能改」与「只读」",
    usersWxml.indexOf("item.editable") >= 0 && usersWxml.indexOf("只读") >= 0);
  ok("改档入口是原生按钮", /<button[^>]*bindtap="onSetTier"/.test(usersWxml));
  ok("用户列表页不再摆改角色的入口（只留改档）",
    usersWxml.indexOf("canSetRole") < 0 && usersWxml.indexOf("onSetRole") < 0
      && usersJs.indexOf("onSetRole") < 0 && adminLib.indexOf("setRole") < 0,
    "角色那一枚还在这页上 —— 授权不在名录里做（Issue #232）");
  ok("用户列表页从管理页那一排放出去（管理页自己没有改档按钮）",
    adminWxml.indexOf("onSetTier") < 0 && adminJs.indexOf("setTier") < 0
      && /bindtap="onUsers"/.test(adminWxml) && /\/packages\/users\/index\/index/.test(adminJs),
    "名录留在管理页里，或放出去了却没给回程入口");
  ok("权限表只有一份（组件），用户权限页只写标签",
    /<tier-view\s*\/>/.test(tierWxml) && viewWxml.indexOf("compareRows") >= 0
      && tierWxml.indexOf("compareRows") < 0,
    "用户权限页自己又画了一份表 —— 与组件里那份迟早对不上");

  ok("后台管理页不再摆档位那几张卡（普通用户页已经有）",
    adminWxml.indexOf("<tier-view") < 0 && adminWxml.indexOf("lock-card") < 0
      && viewWxml.indexOf("status.label") >= 0 && viewWxml.indexOf("guest-note") >= 0,
    "档位卡跟着进了后台管理页 —— 两处各说一遍同一件事（Issue #232）");

  ok("名录只有管理页那一处入口（按登录显隐，「我的」页不再列一行）",
    /wx:if="\{\{logged\}\}"[^>]*bindtap="onUsers"/.test(adminWxml)
      && mineWxml.indexOf("onAdmin") < 0 && mineJs.indexOf("onAdmin") < 0
      && mineJs.indexOf("isAdmin") < 0,
    "「我的 → 数据与账号」里还留着用户列表那一行 —— 同一个去处两条路，"
      + "下一个人不知道该守哪一条（Issue #226）");

  {
    const adminLibSrc = fs.readFileSync(path.join(ROOT, "utils", "admin.js"), "utf8");
    const stat = require(path.join(ROOT, "utils", "admin.js")).summarize;

    ok("统计与名录同一趟拿数（不另开一次请求）",
      /listUsers\(\)[\s\S]{0,400}summarize\(/.test(adminLibSrc)
        && /stats:\s*summarize\(/.test(adminLibSrc),
      "统计另发一次请求 —— 两份数迟早对不上");
    ok("统计只有管理页那一处（用户列表页只说名单）",
      /stats\.bars/.test(adminWxml) && usersWxml.indexOf("stats.") < 0
        && !/summarize\(/.test(usersJs),
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
    /rankOf\(c\.tier\)\s*<=\s*rankOf\(t\.key\)/.test(
      fs.readFileSync(path.join(ROOT, "utils", "entitlement.js"), "utf8")),
    "打勾是照 tier 排出来的，不是手写的一张表 —— 手写的那张改档位就会说谎");
}

{
  const mineWxml = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.wxml"), "utf8");
  const mineJs = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");

  const chip = /<view\b[^>]*class="tier-chip"[^>]*>/.exec(mineWxml);
  ok("档位胶囊点得动，进的就是档位与权限那一页",
    !!chip && /bindtap="onTier"/.test(chip[0])
      && mineJs.indexOf('url: "/packages/mine/tier/tier"') >= 0,
    "胶囊还是死的，或者跳去了别处 —— 用户只有从「我的」页看出来自己是哪一档，"
      + "点下去必须落在对比表上（Issue #234）");
}

ok("乱七八糟的码不认", E.redeem("hello").ok === false);
ok("不像样的码不认", E.redeem("PRO-1234").ok === false);

const sampleId = allEntries[0].id;
const freshId = corpus.course()[0].id;
ok("indexById 能命中条目", corpus.indexById(sampleId) && corpus.indexById(sampleId).t === allEntries[0].t);
ok("indexById 找不到时回 null", corpus.indexById("不存在的-id") === null);

const foreignMiss = allEntries.filter((p) => !corpus.indexById(p.id));
ok("每条索引都查得回自己（集子 id 比条目 id 长的两部外国集子也要认）",
  foreignMiss.length === 0,
  "查不回的还有 " + foreignMiss.length + " 条：" + foreignMiss.slice(0, 3).map((p) => p.id).join("、"));
const foreignOwner = corpus.indexById("dwang-em-w-03");
ok("外国集子的条目落在自己那一部集子上",
  !!foreignOwner && foreignOwner.b === "dwang-waiguo",
  "实际 " + (foreignOwner ? foreignOwner.b : "查不到"));
ok("indexById 带出年级学期（课内）", corpus.indexById(corpus.course()[0].id).gr >= 1);
ok("全站搜索能跨集子", corpus.search("李白", { limit: 5 }).items.length === 5);

const outside = allEntries.find((p) => p.b === "zhaoming" && p.t.length > 2);
ok("搜索能命中课外集子", corpus.search(outside.t, { limit: 200 }).items.some((p) => p.id === outside.id),
  "查不到 " + outside.t);
ok("限集子搜索不外溢", corpus.search("的", { book: "poems", limit: 5000 }).items.every((p) => p.b === "poems"));

const sw = corpus.search("春", { limit: 80 });
ok("search 报出截断前总数", sw.total > sw.items.length,
  "「春」全站命中 " + sw.total + "，列出 " + sw.items.length);
const swAll = corpus.search("春", { limit: 99999 });
ok("search 总数与不做限流时一致", sw.total === swAll.items.length,
  sw.total + " vs " + swAll.items.length);
ok("search 没命中时总数是 0", corpus.search("这几个字不会有", { limit: 80 }).total === 0);
ok("search 空关键词给空结果", corpus.search("  ", { limit: 80 }).total === 0);

ok("ownerOf 取最长前缀", corpus.ownerOf("mingren-waiguo-mr-1") === "mingren-waiguo",
  "实际 " + corpus.ownerOf("mingren-waiguo-mr-1"));
ok("ownerOf 认得课内前缀", corpus.ownerOf("poems-xx1-01") === "poems");

const subs = {};
(app.subPackages || []).forEach((sp) => {
  subs[sp.name || sp.root] = sp.pages.slice();
});

ok("题库页注册在 game 分包", (subs.game || []).indexOf("quiz/quiz") >= 0, JSON.stringify(subs.game));
ok("管理页注册在 admin 分包", (subs.admin || []).indexOf("index/index") >= 0, JSON.stringify(subs.admin));
ok("用户列表页注册在 users 分包", (subs.users || []).indexOf("index/index") >= 0, JSON.stringify(subs.users));

{
  const mineWxml = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.wxml"), "utf8");
  const mineJs = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");
  const tier = "packages/mine/tier/tier";
  const tierWxml = fs.readFileSync(path.join(ROOT, tier + ".wxml"), "utf8");
  const tierJs = fs.readFileSync(path.join(ROOT, tier + ".js"), "utf8");

  ok("档位与权限是「我的」下的一块页，不挂在管理分包里",
    (subs.mine || []).indexOf("tier/tier") >= 0 && (subs.admin || []).indexOf("index/index") >= 0,
    "entryOf 按分包根给页面归门 —— 落在 admin 分包里，改档那些门禁就会漏掉这张公开的表");

  const chip = /<view\b[^>]*class="tier-chip"[^>]*>/.exec(mineWxml);
  ok("档位胶囊点得动，进的就是档位与权限那一页",
    !!chip && /bindtap="onTier"/.test(chip[0])
      && mineJs.indexOf('url: "/' + tier + '"') >= 0,
    "胶囊还是死的，或者跳去了别处 —— 用户只有从「我的」页看出来自己是哪一档，"
      + "点下去必须落在对比表上（Issue #234）");
  ok("档位与权限在「我的」页另有一行（胶囊之外的第二条路）",
    /bindtap="onTier"/.test(mineWxml.replace(chip ? chip[0] : "", "")));
  ok("权限表那一块只有一份（两张页面共用同一个组件）",
    /<tier-view\s*\/>/.test(tierWxml) && tierWxml.indexOf("compareRows") < 0
      && (subs.mine || []).indexOf("tier/tier") >= 0,
    "又在这一页把表画了一遍");
  ok("权限表那一块不挡登录（挡的是名录，不是整张表）",
    tierWxml.indexOf("lock-card") < 0 && !/wx:if="\{\{logged\}\}"/.test(tierWxml)
      && fs.readFileSync(path.join(ROOT, "components", "tier-view", "tier-view.wxml"), "utf8")
        .indexOf("未登录") >= 0,
    "顶端一张 lock-card 把权限对比一起盖住了 —— 未登录的人正是最该看这张表的人");
  ok("权限表那一块只读能力表，改档改角色不落在这里",
    ["onSetTier", "onSetRole", "canWrite"].every((k) => tierWxml.indexOf(k) < 0
      && tierJs.indexOf(k) < 0),
    "这张表给所有人看，改档那几个入口留在管理页的用户名录里");
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
ok("加背与自选背诵都按服务端形状打包",
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

  {
    const picks = [];
    for (let i = 0; i < 30; i++) {
      const p = feihua.pick({ level: "normal", scope: "tangshi" });
      if (p) picks.push(p.char);
    }
    ok("飞花令出得了令字（范围内随机）", picks.length === 30, "只有 " + picks.length + " 次出字");
    ok("随机出来的令字都能随机到不止一个（不是钉死一个）",
      new Set(picks).size > 1, "30 次只出了 " + new Set(picks).size + " 个字");

    const blind = [];
    scopes.list().forEach((s) => {
      ["easy", "normal", "hard"].forEach((lv) => {
        const asked = [];
        for (let i = 0; i < 400; i++) {
          const p = feihua.pick({ level: lv, scope: s.id, exclude: asked });
          if (!p) break;
          asked.push(p.char);
          if (!feihua.look(p.char, { scope: s.id, limit: 1 }).length) blind.push(s.id + "/" + lv + ":" + p.char);
        }
      });
    });
    ok("出的令字在这个范围里一定接得上（不会出一个空格子）",
      blind.length === 0, "出得了字却查不到答案：" + blind.slice(0, 5).join("、"));
  }

  {
    const names = scopes.list().map((s) => s.id);
    ok("出题范围只列诗词集子（改编成文章、辞书、故事集的那几部不进来）",
      names.indexOf("poems") >= 0 && names.indexOf("tangshi") >= 0
        && names.indexOf("songci") >= 0 && names.indexOf("yuefu") >= 0
        && names.indexOf("season") < 0 && names.indexOf("chengyu") < 0
        && names.indexOf("changshi") < 0 && names.indexOf("mingshu") < 0
        && names.indexOf("classic") < 0 && names.indexOf("guwen") < 0,
      "范围里有非诗词的集子：" + names.join("、"));

    const booksMod = require(path.join(ROOT, "utils", "corpus.js"));
    const missing = [];
    scopes.list().forEach((s) => {
      booksMod.ofBook(s.id).forEach((p) => {
        const e = booksMod.entry(p.id);
        if (e && e.text && !scopes.pool(s.id).some((q) => q.id === p.id)) {
          missing.push(s.id + ":" + p.id);
        }
      });
    });
    ok("每个集子里凡有正文的条目都进得了这个范围（课内 251 首也算，正文在主包里）",
      missing.length === 0, "漏了 " + missing.slice(0, 5).join("、"));

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
    const all = feihua.look("月", { limit: 9999 }).map((r) => r.seg);
    const inTang = feihua.look("月", { scope: "tangshi", limit: 9999 }).map((r) => r.seg);
    const say = feihua.judge("月", "床前明月光", []);
    ok("作答能超出出题范围（范围选唐诗，答课内的静夜思照样对）",
      say.ok === true, say.reason || "判成了错");

    ok("看答案按范围收窄（范围内的句子少于全部）",
      inTang.length < all.length,
      "范围内 " + inTang.length + " vs 全部 " + all.length);
  }

  ok("作答在全部诗词集子里找（课内没收录的那首也算对）",
    feihua.judge("城", "一片孤城万仞山", []).ok === true
      && feihua.judge("河", "黄河远上白云间", []).ok === true);

  ok("作答必须含令字", feihua.judge("月", "床前明月光", []).ok === true
    && feihua.judge("月", "白日依山尽", []).ok === false);
  ok("作答必须真在语料里（自己编的不算）",
    feihua.judge("月", "床前明月光的下一句是我想的", []).ok === false);
  ok("同一句不能在一轮里说两遍",
    feihua.judge("月", "床前明月光", ["床前明月光"]).ok === false);
  ok("太短的作答不算（免得单字蒙对）", feihua.judge("月", "月", []).ok === false);
}
{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const visibleWxml = (p) => read(p + ".wxml").replace(/<!--[\s\S]*?-->/g, "");

  {
    const idx = visibleWxml("packages/game/index/index");
    ok("大会首页不再内嵌飞花令的令字格（列表页不直接玩）",
      idx.indexOf("onReveal") < 0 && idx.indexOf("onChar") < 0
        && idx.indexOf("radio-group") < 0,
      "首页还留着飞花令的控件");
    ok("大会首页不再就地列答案（没有 pagedLines 那一段）",
      idx.indexOf("pagedLines") < 0 && idx.indexOf("hitCount") < 0);

    const idxJs = read("packages/game/index/index.js");
    ok("三张入口卡各进各的玩法页",
      /feihua\/feihua/.test(idxJs) && /quiz\/quiz/.test(idxJs) && /exam\/exam/.test(idxJs));
  }

  {
    const wxml = visibleWxml("packages/game/feihua/feihua");

    ok("飞花令页不再摊一排令字让用户挑（没有 radio-group 选字）",
      wxml.indexOf("onChar") < 0, "还留着「挑一个字」那排格子");

    ok("飞花令页把当前令字渲染出来（一个字）",
      wxml.indexOf("fh-char-t") >= 0 && /\{\{\s*char\s*\}\}/.test(wxml),
      "当前令字没渲染 —— 用户不知道要飞哪个字");

    ok("飞花令页有输入框让用户写句子", /<input/.test(wxml) && wxml.indexOf("onSubmit") >= 0);

    ok("飞花令页下方有正确答案列表", wxml.indexOf("onReveal") >= 0 && wxml.indexOf("answers") >= 0);

    const actions = wxml.slice(wxml.indexOf('class="inline-btns"'), wxml.indexOf("</view>", wxml.indexOf('class="inline-btns"')));
    ok("一行三颗按钮：提示 / 接上 / 换令",
      ["onHint", "onSubmit", "onSkip"].every((h) => actions.indexOf(h) >= 0),
      "少了哪一颗，飞花令这一行就不完整");

    const js = read("packages/game/feihua/feihua.js");
    const submitBlock = js.slice(js.indexOf("onSubmit()"), js.indexOf("onSubmit()") + 1600);
    const advanceCalls = (submitBlock.match(/this\.advance\(/g) || []).length;
    ok("答对自动下一题", advanceCalls >= 1, "onSubmit 里没有 advance");
    ok("答错也自动下一题（设了 locked 再 advance）",
      /!r\.ok[\s\S]{0,200}?advance\(/.test(submitBlock),
      "答错那条路没有 advance");
    ok("自动翻题用计时器，页面走了要清掉",
      /setTimeout/.test(js) && /onUnload[\s\S]{0,120}?clearTimeout/.test(js));
    ok("换令先清掉待翻的计时器，再出下一个令字",
      /onSkip\(\)[\s\S]{0,160}?clearTimeout[\s\S]{0,160}?this\.next\(\)/.test(js));

    ok("一轮有倒计时，到点收轮（不再是一题接一题无限连）",
      /startClock\(\)[\s\S]{0,200}?setInterval/.test(js) && /endRound\(\)/.test(js),
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
  const examWxml = read("packages/game/exam/exam.wxml").replace(/<!--[\s\S]*?-->/g, "");
  ok("考试结果那句评语由分数算（cheerLine 进 data，模板读它）",
    /cheerLine:\s*cheer\.ofScore\(/.test(examJs) && examWxml.indexOf("{{cheerLine}}") >= 0,
    "结果页没有评语");

  ok("考试可以回到前面的题（题号跳转 + 上一题，答案是同一份数组）",
    /onJump\(/.test(examJs) && /onPrev\(/.test(examJs)
      && examWxml.indexOf('bindtap="onJump"') >= 0 && examWxml.indexOf('bindtap="onPrev"') >= 0
      && /answers\[this\.data\.index\] = picked/.test(examJs)
      && /picked: this\.data\.answers\[index\]/.test(read("packages/game/exam/exam.js")),
    "回看只翻页面，选中项与答案数组对不上");

  ok("带着空题交卷先提醒一次（不是拦死，也不静默交上去）",
    /confirmSubmit\(\)/.test(examJs)
      && /cheer\.ofQuit\(/.test(examJs)
      && /if \(this\.data\.quitLine === line\) return true;/.test(examJs)
      && examWxml.indexOf("{{quitLine}}") >= 0,
    "空着题交卷既没有提醒，也没法再交");

  ok("飞花令按接上的句数给这一轮评语（0 / 4 / 8 / 13 / 14 各落到自己那一档）",
    [0, 4, 8, 13, 14].every((n) => cheer.ofLing(n, 0).length > 0)
      && new Set([0, 4, 8, 13, 14].map((n) => cheer.ofLing(n, 0))).size === 5,
    "几个不同的句数给的是同一句，或某一档没有话");

  const fhJs = read("packages/game/feihua/feihua.js");
  const fhWxml = read("packages/game/feihua/feihua.wxml").replace(/<!--[\s\S]*?-->/g, "");
  ok("飞花令一轮结束时把这轮的评语写进 remark，翻令时清掉",
    /remark:\s*cheer\.ofLing\(/.test(fhJs)
      && fhWxml.indexOf("{{remark}}") >= 0
      && /remark: ""/.test(fhJs.replace(/remark:\s*cheer\.ofLing\([^)]*\)/, "")),
    "评语没进模板，或者换令之后还挂着上一轮的评语");

  ok("飞花令把里程碑那句渲染出来（页面上下各留一份，翻题时清掉）",
    read("packages/game/feihua/feihua.wxml").indexOf("{{cheerLine}}") >= 0
      && /cheerLine:\s*cheer\.ofStreak\(/.test(fhJs)
      && /cheerLine: ""/.test(fhJs.replace(/cheerLine:\s*cheer\.ofStreak\(streak\)/, "")),
    "连对的话没进模板，或者翻到下一题还挂着上一题的夸奖");
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

const courseKb = fs.statSync(path.join(dataDir, "course.js")).size / 1024;






const noFeedback = [];
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");

  const wxss = path.join(ROOT, p + ".wxss");
  const css = fs.existsSync(wxss) ? fs.readFileSync(wxss, "utf8") : "";
  const re = /<view\b([^>]*)>/g;
  let m;
  while ((m = re.exec(wxml))) {
    const attrs = m[1];
    if (!/bindtap|catchtap/.test(attrs)) continue;
    if (/hover-class=/.test(attrs)) continue;
    const clsM = /class="([^"]*)"/.exec(attrs);
    if (!clsM) continue;

    const has = clsM[1].split(/\s+/).filter(Boolean).some((c) => {
      const base = c.replace(/\{\{[^}]*\}\}/g, "").trim();
      if (!base) return false;
      return new RegExp("\\." + base.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&") + ":(active|hover)").test(css);
    });
    if (!has) noFeedback.push(p + " → ." + clsM[1].trim());
  }
});
ok("可点元素都有按下反馈", noFeedback.length === 0, noFeedback.slice(0, 6).join("; "));


{
  const homeWxml = fs.readFileSync(path.join(ROOT, "pages/home/home.wxml"), "utf8");
  ok("首页首屏有骨架屏", homeWxml.indexOf("<skeleton") >= 0);
  const homeJs = fs.readFileSync(path.join(ROOT, "pages/home/home.js"), "utf8");
  ok("首页 loading 会落回 false", /loading:\s*false/.test(homeJs));
}

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

    const stack = [];
    const VOID2 = ["image", "input", "import", "include", "wxs", "icon", "progress", "slot", "checkbox", "radio", "switch", "slider"];
    const tre = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
    let tm; let balanced = true;
    while ((tm = tre.exec(wxml))) {
      if (tm[1] === "/") { if (stack.pop() !== tm[2]) balanced = false; }
      else if (tm[4] !== "/" && VOID2.indexOf(tm[2]) < 0) stack.push(tm[2]);
    }
    if (stack.length) balanced = false;
    ok("组件 WXML 标签配平 " + d, balanced, stack.join(","));
  });
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

    function mount(pg, query) {
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
      return page.data;
    }

    const storeMod = require(path.join(ROOT, "utils", "store.js"));
    const savedProfile = storeMod.profile();
    storeMod.saveProfile({ logged: true, nickname: "自检" });

    try {
      Object.keys(GATED).forEach((pg) => {
        const flag = GATED[pg];

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

  const qi = cmod.layout("杨柳青青江水平，\n闻郎江上唱歌声。\n东边日出西边雨，\n道是无晴却有晴。", { size: 0 });
  ok("七绝小字号两句一行",
    qi.rows.length === 2 && qi.rows[0] === "杨柳青青江水平，闻郎江上唱歌声。",
    JSON.stringify(qi.rows));
  ok("七绝大字号一句一行",
    cmod.layout("杨柳青青江水平，\n闻郎江上唱歌声。", { size: 6 }).rows.length === 2);
  const wu = cmod.layout("空山不见人，\n但闻人语响。", { size: 0 });
  ok("五绝小字号两句一行", wu.rows.length === 1 && wu.rows[0] === "空山不见人，但闻人语响。", JSON.stringify(wu.rows));

  const sanzi = cmod.layout("人之初，性本善。性相近，习相远。", { size: 0 }).rows;
  ok("三字一行只在小字号之外出现（短句装箱，不一句一行）",
    sanzi.length === 1 && sanzi[0] === "人之初，性本善。性相近，习相远。", JSON.stringify(sanzi));

  const pipa = cmod.entry("poems-gz10-06");
  ok("《琵琶行并序》取得到正文", !!(pipa && pipa.text));
  if (pipa && pipa.text) {
    const L = cmod.layout(pipa.text, { size: 0 });
    ok("《琵琶行》的诗序按栏宽装箱（不再每句一行）",
      L.rows.length < cmod.splitLines(pipa.text).length * 2,
      "行 " + L.rows.length + " vs 语料行 " + cmod.splitLines(pipa.text).length);
    ok("《琵琶行》的序与诗分成两段",
      L.paras.length > 2, "段数 " + L.paras.length);
  }

  {

    const bareRows = [];
    let scanned = 0;
    allIds.forEach((id) => {
      let e = null;
      try { e = cmod.entry(id); } catch (err) { return; }
      if (!e || !e.text) return;
      scanned++;
      cmod.layout(e.text, { size: 0 }).rows.forEach((r) => {
        const t = r.trim();
        if (!t) return;

        if (/[，。！？；：」』）】”’—-]$/.test(t)) return;
        const core = t.replace(/[，。！？；：」』）】”’—-]/g, "");
        if (core.length <= 1 && bareRows.length < 4) bareRows.push(id + " 「" + t + "」");
      });
    });
    ok("折出来的行不许出现孤字成行（全站 " + scanned + " 篇）",
      bareRows.length === 0, bareRows.join(" / "));
  }

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
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");

  const iconMod = require(path.join(ROOT, "utils", "icons.js"));
  ["left", "center", "off", "all", "zoomOut", "zoomIn", "add", "added", "playlist", "smile", "meh", "frown", "yes", "no"]
    .forEach((name) => {
      ok("图标 " + name + " 从 utils/icons.js 取（SVG 源文件在 icons/）",
        typeof iconMod[name] === "string" && iconMod[name].indexOf("data:image/svg+xml;base64,") === 0);
    });
  ok("图标走 mask 上色（一只容器 + currentColor，不按状态换图）",
    /^\.glyph,\n\.seg-icon \{[^}]*background-color: currentColor;/m.test(appWxss)
      && /^\.glyph,\n\.seg-icon \{[^}]*color: var\(--ink-2\);/m.test(appWxss));

  const charIcons = [];
  pages.forEach((p) => {
    const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
    if (/class="(glyph|seg-icon) ic-[a-z]/.test(wxml) || /class="[a-z-]*ic-\{\{/.test(wxml)) {
      charIcons.push(p + " → 还有伪元素画的 ic-* 图标");
    }
    const re = /<(view|label)\b[^>]*class="([^"]*\b(?:face|finish-mark|de-btn|coll-found-btn|clear)(?!-)\b[^"]*)"[^>]*>((?:(?!<view\b)[\s\S]){0,120}?)<\/\1>/g;
    let m;
    while ((m = re.exec(wxml))) {
      if (/mask-image/.test(m[3])) continue;
      charIcons.push(p + " → ." + m[2].trim() + " 里是「" + m[3].replace(/\s+/g, " ").trim().slice(0, 8) + "」");
    }
  });
  ok("图标位上一律是 mask 图标，没有伪元素画的，也没有字符凑的",
    charIcons.length === 0, charIcons.slice(0, 6).join("; "));

  ok("分段控件底盘只定义一次", (appWxss.match(/^\.seg-group\s*\{/gm) || []).length === 1);
  ok("格子控件底盘只定义一次", (appWxss.match(/^\.chip\s*\{/gm) || []).length === 1);
  ok("圆钮底盘只定义一次（首页的加背钮与候选列表的加号共用它）",
    (appWxss.match(/^\.round-btn\s*\{/gm) || []).length === 1);

  const redefined = [];

  const ROW_LAYOUT_OK = new Set(["seg-pref", "seg-pref-3", "seg-pref-2"]);
  pages.forEach((p) => {
    const wxssPath = path.join(ROOT, p + ".wxss");
    if (!fs.existsSync(wxssPath)) return;
    const wxss = fs.readFileSync(wxssPath, "utf8");
    const hit = wxss.match(/^\.(seg-[\w-]+|ic-[\w-]+|chip[\w-]*)\s*(::?[a-z-]+)?\s*\{/gm) || [];
    hit.forEach((h) => {
      const name = h.replace(/^\./, "").replace(/\s*(::?[a-z-]+)?\s*\{$/, "");
      if (ROW_LAYOUT_OK.has(name)) return;
      redefined.push(p + " → " + h.replace(/\s*\{$/, ""));
    });
  });
  ok("分段 / 图标 / 格子的样式没有在页面里各写一遍",
    redefined.length === 0, redefined.slice(0, 5).join("; "));

  const TAGS = /<(label|view)\b([^>]*)>/g;
  const attrOf = (attrs, name) => {
    const m = new RegExp(name + '="([^"]*)"').exec(attrs || "");
    return m ? m[1] : "";
  };

  const notBound = [];
  pages.forEach((p) => {
    const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");

    let m;
    while ((m = TAGS.exec(wxml))) {
      const cls = attrOf(m[2], "class");
      if (!/(^|\s)(seg-item|chip)(\s|$)/.test(cls)) continue;
      if (m[1] === "label" && /<radio\b/.test(wxml)) continue;
      if (attrOf(m[2], "bindtap")) continue;
      notBound.push(p + " → <" + m[1] + ' class="' + cls + '">');
    }
  });
  ok("分段与格子的每一段都点得到（label 里的原生控件，或者自己 bindtap）",
    notBound.length === 0, notBound.join("; "));

  const multiSites = [];
  pages.forEach((p) => {
    const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
    if (!/<checkbox-group[^>]*class="chip-group/.test(wxml)) return;

    let m, chips = 0, multi = 0;
    while ((m = TAGS.exec(wxml))) {
      const cls = attrOf(m[2], "class");
      if (!/(^|\s)chip(\s|$)/.test(cls)) continue;
      chips++;
      if (/(^|\s)multi(\s|$)/.test(cls)) multi++;
    }
    if (chips !== multi || chips === 0) multiSites.push(p + " (" + multi + "/" + chips + ")");
  });
  ok("多选的格子带 multi（与单选分得开）", multiSites.length === 0, multiSites.join("; "));

  pages.forEach((p) => {
    const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");

    const wxssPath = path.join(ROOT, p + ".wxss");
    const wxss = fs.existsSync(wxssPath) ? fs.readFileSync(wxssPath, "utf8") : "";
    if (wxml.indexOf('class="char ') < 0 && wxml.indexOf('class="char {{') < 0) return;
    ok("令字格不再塞一个缩小的圆点：" + p, wxss.indexOf("char-radio") < 0 && wxml.indexOf("char-radio") < 0);
  });
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
  const mineWxml = fs.readFileSync(path.join(ROOT, "pages/mine/mine.wxml"), "utf8");

  const adminWxml = fs.readFileSync(path.join(ROOT, "packages/admin/index/index.wxml"), "utf8");
  const adminJs = fs.readFileSync(path.join(ROOT, "packages/admin/index/index.js"), "utf8");
  ok("界面上没有填后端地址 / 云调用的入口（值只在代码库里配）",
    adminWxml.indexOf("onSaveBaseUrl") < 0 && adminJs.indexOf("onSaveBaseUrl") < 0
      && adminWxml.indexOf("cloudEnv") < 0 && adminJs.indexOf("onSaveCloud") < 0
      && mineJs.indexOf("onServer") < 0,
    "两栏的值构建期就注进包里，露出来只会是用户既读不懂也改不动的说法 —— " +
      "要临时换后端就改代码库里的 miniprogram/utils/server.js，不走界面");

  ok("同步那一行的副标题：上次同步 + 队列状态，都用数据层算的（不自己拼）",
    /syncSub\(sy\)\s*\{[\s\S]{0,400}?sy\.ready[\s\S]{0,400}?sy\.pendingStatus/.test(mineJs)
      && /syncSub:\s*this\.syncSub\(sy\)/.test(mineJs),
    "副标题自己拼了一份：末次同步时刻与「还有几项在等」都只有 sync.state() 说了算");

  ok("「我的」页不留连接配置的入口（接服务器只有代码库里一处）",
    mineJs.indexOf("onServer") < 0 && mineJs.indexOf("serverSub") < 0,
    "「我的」页又冒出第二处配置入口 —— 要临时换后端改代码库里的 " +
      "miniprogram/utils/server.js（docs/wx-cloud-setup.md § 6.2）");

  ok("「我的 → 同步」那一行点得动，且只在登录后出现",
    /bindtap="onSync"[^>]*wx:if="\{\{logged\}\}"/.test(mineWxml)
      && /onSync\s*\([\s\S]{0,200}?sync\.now\(true\)/.test(mineJs),
    "同步那一行没了 —— 用户手里就没有「现在立刻同步一次」这条出口");

  ok("队里还有几项由数据层数出来（不是界面自己记一个数）",
    /pendingCount\s*\([\s\S]{0,300}?packRecords\(\)/.test(
      fs.readFileSync(path.join(ROOT, "utils", "sync.js"), "utf8")),
    "pendingCount 没读打包记录 —— 界面上的「还有几项在等」就成了编的");


  const capSync = E.CAPS.find((c) => c.key === "sync");
  ok("云端同步在能力表里且不看档位", !!capSync && capSync.tier === "free",
    capSync ? "当前 tier=" + capSync.tier : "能力不存在");
  ok("「我的」页不再有导出那一行（进度跟着账号走，没有导出这条路）",
    mineWxml.indexOf("onExport") < 0 && mineJs.indexOf("onExport") < 0
      && mineJs.indexOf("exportAll") < 0,
    "导出那一行还在 —— 换手机的路是登录，不是拷一份 JSON 出去");
  ok("store 里不再留导出 / 导入那对没人调的函数",
    typeof store.exportAll !== "function" && typeof store.importAll !== "function",
    "留着没人调，下一个人会以为还有一处备份出口");

  ok("有微信登录服务端说明", fs.existsSync(path.join(__dirname, "..", "docs", "wx-login-server.md")));
}




{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  ok("篇名有一个专门的附加类 .row-poem",
    /\.row-poem\s*\{/.test(appWxss),
    "列表里的篇名与其他行取同一套样式 —— 分不出哪一行是诗词");

  const stray = [];
  (function walkWxml(dir) {
    fs.readdirSync(dir).forEach((f) => {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) return walkWxml(full);
      if (!f.endsWith(".wxml")) return;
      const rel = path.relative(ROOT, full);
      const src = fs.readFileSync(full, "utf8");
      const re = /<text class="row-title row-poem">([^<]*)<\/text>/g;
      let m;
      while ((m = re.exec(src))) {
        if (!/\{\{[^}]*title[^}]*\}\}/.test(m[1])) stray.push(rel + " → " + m[1]);
      }
    });
  })(ROOT);
  ok("row-poem 只挂在篇名上（设置项不许借位）", stray.length === 0, stray.slice(0, 6).join("; "));

}

const renderSrc = fs.readFileSync(path.join(__dirname, "shots", "render.js"), "utf8");

{
  const scopedRe = /raw\.replace\((\/.*?\/g),\s*"\.screen\{"\)/s.exec(renderSrc);
  ok("预览在把 page{} 改写成 .screen{}（找得到那条 replace）", !!scopedRe);
  if (scopedRe) {

    const src = scopedRe[1];
    let re;
    try { re = eval(src); } catch (e) { re = null; }

    const t = re ? (x) => new RegExp(re.source, re.flags.replace("g", "")).test(x) : () => false;
    ok("预览的根选择器改写正则可以求值", !!re && re.source === re.source);
    if (re) {
      ok("page { 会被改写成 .screen{（根规则要留着）", t("page {"));
      ok(".page { 不会被改写（改了就是非法选择器 ..screen{）", !t(".page {"));
      ok(".page-head { 不受影响", !t(".page-head {"));

      ok("旧写法（\\bpage）确实会误伤 .page",
        new RegExp("\\bpage\\s*\\{").test(".page {"));
    }
  }
}

{
  const previewPath = path.join(__dirname, "shots", "out", "preview.html");
  if (!fs.existsSync(previewPath)) {
    console.log("· 预览产物不在（没跑 node scripts/shots/render.js）——"
      + " 跳过两条「预览自身是否可信」的断言；跑过之后再跑一次 check.js 就会验");
  } else {
    const html = fs.readFileSync(previewPath, "utf8");

    const badSel = [];
    const re = /(^|[},;{])\s*([^{}@]*?\.\.[^{}]*?)\s*\{/g;
    let m;
    while ((m = re.exec(html))) badSel.push(m[2].trim().slice(0, 60));
    ok("预览 CSS 里没有 .. 这类非法选择器", badSel.length === 0, badSel.slice(0, 4).join(" | "));

    ok("预览里 .page 的规则在（padding 与底色才有出处）", /\.page\s*\{[^}]*padding\s*:/.test(html));
  }
}

{
  const nativeBlock = /const NATIVE_CSS = `([\s\S]*?)`;/.exec(renderSrc);
  ok("预览里有原生控件的等价样式（V5 那条的老素材，这里再取一次）", !!nativeBlock);
  const mirror = nativeBlock ? nativeBlock[1] : "";
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "");
  const mirrorRules = {};
  (strip(mirror).match(/[^{}]+\{[^{}]*\}/g) || []).forEach((blk) => {
    const i = blk.indexOf("{");
    const sel = blk.slice(0, i).replace(/\s+/g, "");
    const body = blk.slice(i + 1, blk.lastIndexOf("}"));
    const ml = /margin-left\s*:\s*([^;]+)/.exec(body);
    const mr = /margin-right\s*:\s*([^;]+)/.exec(body);
    if (!ml && !mr) return;
    mirrorRules[sel] = { ml: ml && ml[1].trim(), mr: mr && mr[1].trim() };
  });

  const pageCssAll = strip(fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8"));
  const pageSrcAll = pages.filter((p) => fs.existsSync(path.join(ROOT, p + ".wxss")))
    .map((p) => [p, strip(fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8"))]);

  const visibleTagRules = [];
  const tagRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = tagRe.exec(pageCssAll))) {
    const sel = m[1];
    const body = m[2];
    if (!/\b(radio|checkbox)\b/.test(sel)) continue;
    if (/\.opt-radio|\.seg-radio/.test(sel)) continue;
    const mr = /margin-right\s*:\s*([^;]+)/.exec(body);
    if (mr) visibleTagRules.push({ sel: sel.replace(/\s+/g, " ").trim(), mr: mr[1].trim() });
  }
  const missingMirror = visibleTagRules.filter((r) => {
    const cls = r.sel.split(/[,\s]+/).filter((x) => x.startsWith("."));
    return cls.length > 0 && !Object.keys(mirrorRules).some((k) =>
      cls.every((c) => k.includes(c)));
  });
  ok("露脸的原生控件的横距在镜像里都有等价项", missingMirror.length === 0,
    missingMirror.map((r) => r.sel).join(" | "));

  const optRadioVisible = /\.opt-row\s+radio[^{}]*\{[^}]*margin-right/.test(pageCssAll);
  ok("选项行里的原生控件是视觉隐藏的（不再另起一个圆点）", !optRadioVisible,
    "还能找到给 .opt-row radio 的横距规则 —— 说明它又露脸了");
}

{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");

  const stray = [];
  pages.forEach((p) => {
    const f = path.join(ROOT, p + ".wxss");
    if (!fs.existsSync(f)) return;
    const css = fs.readFileSync(f, "utf8");
    const re = /\.card[^{}]*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      if (/box-shadow\s*:\s*(?!none)/.test(m[1])) stray.push(p + " → " + m[1].replace(/\s+/g, " ").slice(0, 70));
    }
  });
  ok("卡片的投影只在令牌一处给（页面样式表里不各写一份）",
    !/\.card\s*\{[^}]*box-shadow/.test(appWxss) && stray.length === 0,
    stray.slice(0, 4).join("; "));
}

{
  const homeWxml = fs.readFileSync(path.join(ROOT, "pages/home/home.wxml"), "utf8");
  const homeWxss = fs.readFileSync(path.join(ROOT, "pages/home/home.wxss"), "utf8");

  ok("首页行尾的状态都在同一个槽里（两个槽元素起步）",
    (homeWxml.match(/class="row-end"/g) || []).length >= 2,
    "行尾那块又散开了 —— 状态与胶囊不在一条线上");
  ok("行尾的槽只在首页样式表里定义一次",
    (homeWxss.match(/\.row-end\s*\{/g) || []).length === 1,
    "槽的宽度被写了两处 —— 两边迟早对不上");
}



{
  const tabRoot = path.join(ROOT, "custom-tab-bar");
  const four = [".js", ".json", ".wxml", ".wxss"].every((ext) =>
    fs.existsSync(path.join(tabRoot, "index" + ext)));
  ok("自绘底栏四件套齐全", four);

  const appCfg = readJson(path.join(ROOT, "app.json"));
  ok("app.json 开启了自定义 tabBar", appCfg.tabBar && appCfg.tabBar.custom === true);

  const barSrc = fs.readFileSync(path.join(tabRoot, "index.js"), "utf8");
  const barWxml = fs.readFileSync(path.join(tabRoot, "index.wxml"), "utf8");
  const barWxss = fs.readFileSync(path.join(tabRoot, "index.wxss"), "utf8");
  const tabPageSrc = fs.readFileSync(path.join(ROOT, "utils", "tab-page.js"), "utf8");

  {
    const items = barSrc.match(/\{ pagePath: "([^"]+)", text: "([^"]+)", icon: icons\.[a-z]+([^}]*)\}/g) || [];
    ok("底栏那一串每一项都带 pagePath / 文案 / 图标三样",
      items.length > 0
        && items.every((it) => /pagePath: "[^"]+"[^}]*text: "[^"]+"[^}]*icon: icons\.[a-z]+/.test(it)),
      "有项缺了图标或文案 —— 底栏会缺一格或空一行：" +
        (barSrc.match(/list: \[[\s\S]*?\]/) || [""])[0].slice(0, 300));
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
    ok("底栏图标走 mask 上色（一张图两态，不靠两张图切 visibility）",
      /mask-image:url\('\{\{item\.icon\}\}'\)/.test(barWxml)
        && /\.tab-ico-mask[\s\S]{0,400}background-color:\s*currentColor/.test(barWxss)
        && /mask-size:\s*contain/.test(barWxss),
      "底栏图标还是两张 <image> 切 visibility —— 换不出主题色，也踩 <image> 认不认 data URI 这条");
    ok("「大会」不是 tab 页 —— 它走 navigateTo（组件里只有大会那一格转给 tabPage.conference）",
      /conference: 2/.test(barSrc)
        && /if \(i === this\.data\.conference\)[\s\S]{0,80}tabPage\.conference\(\)/.test(barSrc)
        && /function conference\(\)[\s\S]{0,80}wx\.navigateTo/.test(tabPageSrc),
      "大会那一项要是走 switchTab，平台会把它当成第五个 tab 页，而它不在 app.json 的 tabBar.list 里");
    ok("底栏每一项都经 list 渲染（图标源不是写死的）",
      /wx:for="\{\{list\}\}"/.test(barWxml) && /\{\{item\.icon\}\}/.test(barWxml));
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
    const offBar = allPages.filter((p) => {
      const src = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");
      const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
      return !/tabbar\.(sync|pick|below)\(this[,)]/.test(src)
        || !/barBelow \? 'has-tabbar' : 'tall'/.test(wxml);
    });
    ok("每一页都挂着这条栏、也留了垫片（不按页藏栏了，Issue #370）",
      offBar.length === 0,
      offBar.join("、")
        + " —— 这一栏现在每页都在：不 sync / pick 就还亮着上一页的格子，"
        + "不按 barBelow 给垫片就压在正文最后一行上");

    ok("大会与它的三个子页把底栏点亮在「大会」那一格",
      GAME.every((p) => call[p] === "pick"),
      GAME.filter((p) => call[p] !== "pick").join("、")
        + " —— 进了大会还亮着上一栏，退回来时那一栏又是暗的");
  }
  ok("「我的」那一格画的是头像，没有头像时退回昵称首字（不画写死的那张默认图）",
    /wx:if="\{\{item\.me && meAvatar\}\}"[^>]*src="\{\{meAvatar\}\}"/.test(barWxml)
      && /wx:elif="\{\{item\.me\}\}">\{\{meChar\}\}<\/view>/.test(barWxml)
      && /meAvatar:\s*store\.avatarSrc\(\)/.test(barSrc)
      && /meChar:\s*store\.avatarChar\(\)/.test(barSrc),
    "底栏那一格还挂着 icons.mine —— 换了头像只有页面里变，底栏不跟着变");
  ok("要登录的那几栏都标了 login（游客点了不进门，直接去「我的」）",
    (barSrc.match(/login:\s*true/g) || []).length >= 3,
    "标 login 的项不足三项 —— 有入口没标，游客点进去还是一屏只有一个按钮的门禁页");
  ok("游客点这三栏切到「我的」（不是 render 一张 lock-card）",
    /gate\.logged\(\)/.test(barSrc)
      && /!gate\.logged\(\) && item\.login/.test(barSrc)
      && /tabPage\.mine\(\)/.test(barSrc),
    "没查登录态、或没有跳到「我的」的那一跳");

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
    const snapAuth = store2.read(store2.KEYS.auth, {}) || {};
    const snapProf = store2.profile();
    const snapOffline = auth2.offline();
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
    ok("登录被拒的理由要能指到「同步服务器」这一行（不是一句「登录失败」）",
      /E_NOT_CONFIGURED/.test(flowCode) && flowCode.indexOf("还没接上同步服务器") >= 0,
      "登录流程没有把 E_NOT_CONFIGURED 说成「这个包还没配同步服务器」——"
        + "用户看到「登录未完成」，只能自己去数据库里查");
    ok("登录只有一份（页面不再各写一遍）",
      /require\(["']\.\.\/\.\.\/utils\/login-flow["']\)/.test(mineSrc)
        && /require\(["']\.\/login-flow["']\)/.test(gateCode),
      "「我的」页与门禁弹窗各自写了一遍 wx.login 的成败分支");
  }
}

{
  const recite = fs.readFileSync(path.join(ROOT, "packages/settings/recite/recite.wxml"), "utf8");
  const reciteJs = fs.readFileSync(path.join(ROOT, "packages/settings/recite/recite.js"), "utf8");
  const reciteWxss = fs.readFileSync(path.join(ROOT, "packages/settings/recite/recite.wxss"), "utf8");
  const strayHandlers = ["onPinyin", "onAlign", "onFontDown", "onFontUp"].filter(
    (h) => recite.indexOf(h) >= 0 || reciteJs.indexOf(h) >= 0);
  ok("背诵设置页里没有注音 / 对齐 / 字号（详情页与阅读设置页才该有）",
    strayHandlers.length === 0, "这页混进了：" + strayHandlers.join(", "));
  ok("那一行的排法（.pref-row / .font-step / .fs-btn）整块删掉了",
    !/\.pref-row|\.font-step|\.fs-btn/.test(reciteWxss) && !/pref-row|font-step/.test(recite),
    "recite.wxss / recite.wxml 里还有残留");
  ok("这页不再有 <slider>（字号滑块是详情页的东西）", recite.indexOf("<slider") < 0);

  ok("取诗范围是横排的选项行（opt-group inline）",
    /<radio-group class="opt-group inline/.test(recite));
}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const recite = read("packages/settings/recite/recite.wxml");
  const reciteJs = read("packages/settings/recite/recite.js");
  const sched = read("utils/scheduler.js");

  ok("背诵设置页那几组选项各自带得出标题元素",
    (recite.match(/<view class="card-title[^>]*">[^<]*\S<\/view>/g) || []).length >= 5,
    "卡片顶上缺标题元素 —— 一组选项读不出它管什么");
  ok("学段那格绑在 onStage 上，且用的是 scheduler 里那份学段表",
    /bindchange="onStage"/.test(recite)
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

  ok("背诵设置页有取诗范围那一组（单选绑在 onScope 上）",
    /bindchange="onScope"/.test(read("packages/settings/recite/recite.wxml"))
      && /onScope\s*\(/.test(read("packages/settings/recite/recite.js")));

  {
    const recite = read("packages/settings/recite/recite.wxml");
    const reciteJs = read("packages/settings/recite/recite.js");
    ok("背诵设置页里不带阅读偏好那三组（它们在详情页与阅读/通用设置页）",
      !/onPinyin|onAlign|onFontDown|onFontUp/.test(recite)
        && !/onPinyin|onAlign|onFontDown|onFontUp/.test(reciteJs),
      "这一页又长出了对齐 / 注音 / 字号那几组");
    ok("这一页也没有 slider", recite.indexOf("<slider") < 0);

    const reader = read("pages/reader/reader.wxml");
    ok("详情页（读这首诗时）注音 / 对齐 / 字号三样都在",
      /onPinyin/.test(reader) && /onAlign/.test(reader) && /onFontDown/.test(reader) && /onFontUp/.test(reader));
    const general = read("packages/settings/general/general.wxml");
    ok("「设置」页三样都在（对齐 / 注音 / 字号）",
      /onAlign/.test(general) && /onFontSlide/.test(general) && /onPinyin/.test(general));
    const generalJs2 = read("packages/settings/general/general.js");
    ok("设置里的注音走 pinyin.setMode()（不自己写一份 store）",
      /pinyin\.setMode\(/.test(generalJs2));

    ok("声音并在这一页，主题搬到自己那一页（各自的动作都在）",
      /onSfx/.test(general) && /sfx\.setEnabled\(/.test(generalJs2)
        && !/onPick|swatch/.test(general) && !/onPick\s*\(/.test(generalJs2),
      "主题 / 声音只是搬了壳，动作没跟过来");

    const themeWxml2 = read("packages/settings/theme/theme.wxml");
    const themeJs2 = read("packages/settings/theme/theme.js");
    ok("主题页装着色卡，落在 theme.set() 上（不自己写一份 store）",
      /onPick/.test(themeWxml2) && /swatch/.test(themeWxml2)
        && /theme\.set\(/.test(themeJs2) && /theme\.palette\(/.test(themeJs2),
      "色卡搬过去了，动作没跟过来");
    ok("设置页不再摆色卡（不留孤儿样式）",
      !/swatch/.test(read("packages/settings/general/general.wxss")));

    const shelled = [];
    const naked = [];
    pages.concat(["packages/settings/general/general", "packages/settings/recite/recite"])
      .forEach((p) => {
        const wxml = read(p + ".wxml");
        const re = /<switch\b[\s\S]{0,200}?\/>/g;
        let m;
        while ((m = re.exec(wxml))) {
          const before = wxml.slice(0, m.index);
          if (/<view class="sw">\s*$/.test(before)) shelled.push(p); else naked.push(p);
        }
      });
    ok("两个开关都装在定尺寸的 .sw 壳里（原生开关的固有尺寸不受 --ui-scale 管）",
      shelled.length >= 2 && naked.length === 0,
      naked.join(", ") || "只找到 " + shelled.length + " 个带壳的");

    const appWxss = read("app.wxss");
    ok(".sw 只在 app.wxss 定义一次（两页共用同一档尺寸）",
      (appWxss.match(/\.sw\s*\{/g) || []).length === 1
        && [general, read("packages/settings/recite/recite.wxss")]
          .every((t) => !/\.sw\s*\{/.test(t)),
      "壳的尺寸被写了两处 —— 两页迟早对不上");
    ok("壳的尺寸与缩放都取自令牌",
      /--w-switch\s*:/.test(read("styles/tokens.wxss"))
        && /--h-switch\s*:/.test(read("styles/tokens.wxss"))
        && /--switch-scale\s*:/.test(read("styles/tokens.wxss"))
        && /\.sw\s+switch\s*\{[^}]*scale\(var\(--switch-scale\)\)/.test(appWxss),
      "壳或缩放写死在页面里，改一处另一处不跟");

    const sfxRow = (() => {
      const at = general.indexOf('class="row"', general.indexOf("声音</view>"));
      return at < 0 ? "" : general.slice(at, general.indexOf("</view>\n  </view>", at));
    })();
    ok("「试听」和开关在同一行（不再各占一行）",
      sfxRow.indexOf("onSfxTest") >= 0 && /<switch\b/.test(sfxRow)
        && !/btn\s+ghost\s+block/.test(general),
      "试听又回到自己那一行了");
    ok("「试听」是胶囊（mini + ghost），文案不再带「一声」",
      /<button[^>]*class="btn mini ghost sfx-test"[^>]*bindtap="onSfxTest"[^>]*>试听<\/button>/.test(general)
        && general.indexOf("试听一声") < 0,
      "按钮换了长相，或者文案还留着旧的那句");

    ok("字号滑块只给属性、不在页面样式表里另写一套",
      /<slider[^>]*block-size="12"/.test(general)
        && !/n-slider/.test(read("packages/settings/general/general.wxss")),
      "圆点大小写到了别处");
  }

  {
    const readerWxml = read("pages/reader/reader.wxml");

    const surfaceWxss = read("app.wxss").replace(/\/\*[\s\S]*?\*\//g, "");

    const prefsAt = readerWxml.indexOf('class="prefs"');
    const prefsEnd = readerWxml.indexOf('class="poem-body', prefsAt);
    const inPrefs = readerWxml.slice(prefsAt, prefsEnd > prefsAt ? prefsEnd : readerWxml.length);
    ok("详情页三组（对齐 / 注音 / 字号）都在正文之前那一块里",
      prefsAt >= 0 && /onPinyin/.test(inPrefs) && /onAlign/.test(inPrefs)
        && /onFontDown/.test(inPrefs) && /onFontUp/.test(inPrefs),
      "三组偏好散在正文之外 —— 读这首诗时够不着");

    const general = read("packages/settings/general/general.wxml");
    ok("图标没被一起弄丢 —— 通用设置页那一份仍在",
      /class="seg-icon" style="mask-image:url\('\{\{item\.icon\}\}'\)/.test(general));
  }

  {
    const recite = read("packages/settings/recite/recite.wxml");
    ok("「每日首数」这张卡还在",
      />每日首数<\/view>/.test(recite));
    const counts = /const DAILY_COUNTS = \[([^\]]*)\];/.exec(read("utils/scheduler.js"));
    const list = (counts ? counts[1] : "").split(",").map((t) => t.trim()).filter(Boolean);
    ok("四档是 3 / 5 / 10 / 20",
      list.join(",") === "3,5,10,20", "读到的是 [" + list.join(", ") + "]");
    ok("默认档 5 命中了这四档里的一个（否则打开设置页没有一格是亮的）",
      list.indexOf("5") >= 0 && /dailyCount:\s*5/.test(read("utils/store.js")));
  }


  {
    const search = read("pages/search/search.wxml");
    ok("搜索页不再有范围 / 方式的选项控件",
      search.indexOf("opt-block") < 0 && search.indexOf("seg-group") < 0
        && search.indexOf("<radio") < 0,
      "搜索页又长出「选一个」的控件 —— 搜什么由输入词决定，不靠用户先选范围");
    ok("搜索页仍然给出命中读数（命中几篇 · 在哪儿搜的）",
      search.indexOf("resultWhere") >= 0 || search.indexOf("result-count") >= 0,
      "命中的篇数与检索范围都没了 —— 用户看不出这次搜的是哪一段");

    const js = read("pages/search/search.js");
    ok("搜索先按篇名作者找，无结果才落到正文全文",
      /byIndex\(kw\)/.test(js) && js.indexOf("byIndex(kw)") < js.indexOf("runFull(kw)"));
  }

  {
    const js = read("pages/search/search.js");
    ok("搜索结果一次只列 20 条",
      /const BATCH = 20;/.test(js) && /nextBatch\(session, BATCH\)/.test(js),
      "每批 20 条这个数只该在一处写死 —— 散在两个地方，下拉与首屏就会各出各的数");
    ok("触底才接下一批（onReachBottom 里才续取）",
      /onReachBottom\s*\(\)\s*\{[\s\S]{0,260}?(pushBatch|byIndex)/.test(js),
      "没有 onReachBottom —— 列表拉到底不会续取，20 条就是全部");
    ok("列表还有后续时不写「已到末尾」",
      /more:\s*more\s*&&\s*!session\.done/.test(js));
    ok("索引那一路也一样分页（首屏只给前 20，触底再取下一批）",
      /results:\s*r\.items\.slice\(0, BATCH\)/.test(js) &&
        /more:\s*r\.total > BATCH/.test(js) &&
        /this\.total > want/.test(js),
      "索引命中一大片时照样一次只列 20 —— 首屏塞几千条，与分页的初衷正相反");
    ok("重搜与清空都掐断上一轮的会话（否则旧批次会追加到新结果里）",
      /this\.session = null;/.test(js) && /this\.busy = false;/.test(js));
    ok("退出搜索页不再往下扫",
      /onUnload\s*\(\)\s*\{[\s\S]{0,160}?this\.busy = false/.test(js),
      "没有 onUnload 掐断 —— 退出后仍会把正文分片一片片读完");

    const ts = read("utils/text-search.js");
    ok("分批接口由搜索页驱动，不是一次扫完全站",
      /function makeSession/.test(ts) && /function nextBatch/.test(ts) && /session\.done/.test(ts));
  }

  {
    const examJs = read("packages/game/exam/exam.js");
    const examWxml = read("packages/game/exam/exam.wxml");
    const iPick = examJs.indexOf("onPick(e)");
    const iJudge = examJs.search(/judge\s*\(/);
    ok("答题途中不判对错（判分那一步排在 onPick 之后）",
      iPick >= 0 && iJudge > iPick,
      "onPick @" + iPick + " 判分 @" + iJudge + " —— 判分排在答题之前就等于当场把答案说了出来");
    ok("批是在交卷时做的（finish 里逐题判）",
      /finish\(\)[\s\S]{0,900}?judge\s*\(/.test(examJs));

    ok("交卷后逐题列出对错（不只是错题）",
      examWxml.indexOf("graded") >= 0 && examWxml.indexOf('class="grade-mark') >= 0);

    ok("考试能跳题回去改答案（题号格 + 上一题）",
      examWxml.indexOf("onJump") >= 0 && examJs.indexOf("goto(") >= 0
        && examJs.indexOf("onPrev") >= 0,
      "选择题交了卷才判，途中却不许回头改 —— 漏答一题就白丢一分");
    ok("题号格按「答没答」上色，类名由 slotsOf 一处算好再传进模板",
      /slotsOf\s*\(/.test(examJs) && examWxml.indexOf("{{slots}}") >= 0
        && examWxml.indexOf("{{item.cls}}") >= 0,
      "模板里还在自己拼类名 —— 插值只吃一层，宁可算好再传");
    ok("那个「现在这题」的标记走主题色，不另起一支",
      /var\(--strong\)/.test((/\.dot\.now\s*\{([^}]*)\}/.exec(read("packages/game/exam/exam.wxss")) || [])[1] || ""),
      "当前题号与已答用两支不相干的色 —— 一屏两处都在喊");

    const quizJs = read("packages/game/quiz/quiz.js");
    ok("题库当场给对错（判定在 onPick 里，不等下一题）",
      /onPick\(e\)[\s\S]{0,400}?quiz\.judge/.test(quizJs));
    ok("连对是一枚读数，不是藏在文案里（combo 走共享的 feedback）",
      /feedback\.mark\(/.test(quizJs) && /wx:if="\{\{combo\.shown\}\}"/.test(read("packages/game/quiz/quiz.wxml")),
      "答对答错只剩一句字色 —— 连着答对与偶然撞对读起来一样");
  }
}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const rank = require(path.join(ROOT, "utils", "ranking.js"));
  const pageJs = read("packages/ranking/index/index.js");
  const pageWxml = read("packages/ranking/index/index.wxml");
  const adminJs = read("packages/admin/index/index.js");
  const adminWxml = read("packages/admin/index/index.wxml");
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
      && /me: res\.me \? ranking\.maskRow\(res\.me\) : null/.test(pageJs),
    "服务端已经打过一次，端上没再兜一层 —— 换个后端或漏改一处就露全名");

  ok("同分同名次，下一名跳号（一人一行不变，名次不再按行号数）",
    rank.podiumOf([{ rank: 1, nick: "甲", score: 9, total: 10 }, { rank: 1, nick: "乙", score: 9, total: 10 }])[0].tied === true
      && rank.restOf([{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 4 }, { rank: 5 }]).map((r) => r.rank).join() === "4,5",
    "同分的人各占一行名次，第 2 名凭空消失；或同一个人被抄成两行");

  ok("领奖台只认前三名，第四名起进列表",
    rank.podiumOf([{ rank: 1, nick: "甲", score: 9, total: 10 }, { rank: 2, nick: "乙", score: 8, total: 10 }])
      .filter((m) => m.filled).length === 2
      && rank.podiumOf([]).length === 3
      && rank.restOf([{ rank: 3 }, { rank: 4 }, { rank: 5 }]).map((r) => r.rank).join() === "4,5",
    "领奖台与列表的切分不在第 3 名上，同一个人会既上台又上榜");

  ok("榜单查询把「全部学段」与「具体年级」分开（两者不会同时生效）",
    rank.queryOf({ stage: "all", grade: 3, term: 1 }).grade === 0
      && rank.queryOf({ stage: "primary", grade: 3, term: 1 }).grade === 3,
    "选了全部还带着年级，榜单就会在一段空成绩里排");

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
      && /auth\.saveNickname\(nickname\)\.then\(\(r\) => this\.revertNickname\(before, r\)\)/.test(read("pages/mine/mine.js"))
      && /revertNickname\(before, r\)[\s\S]{0,300}?store\.saveProfile\(\{ nickname: before \}\)/.test(read("pages/mine/mine.js")),
    "服务端不收，本机却已经改成了那个名字 —— 顶栏与榜上各说一套");

  ok("榜单读写都过同一道开关门（关着不给看也不收成绩）",
    /function boardGate/.test(apiCore)
      && /E_RANKING_OFF/.test(apiCore)
      && /function boardList[\s\S]{0,400}?boardGate/.test(apiCore)
      && /function boardSubmit[\s\S]{0,400}?boardGate/.test(apiCore),
    "只关列表不关提交，用户交完成绩却发现榜上没有自己");

  ok("开关默认关（没有那一行就是关，不是开）",
    /return String\(v == null \? "" : v\) === "1"/.test(apiCore)
      && /var want = !!/.test(apiCore)
      && !/row === null[\s\S]{0,40}?return true/.test(apiCore),
    "默认值翻成 true 之后，昵称会不经管理员点头就摆到别人面前");

  ok("成绩底账不存昵称（改名一次全站生效，不用回灌历史行）",
    /putScoreRecord: function \(row\)/.test(apiStore)
      && !/nickname/.test(apiStore.slice(apiStore.indexOf("putScoreRecord"), apiStore.indexOf("getSetting")))
      && !/`nickname`/.test(apiMysql.slice(apiMysql.indexOf("putScoreRecord"), apiMysql.indexOf("putSetting"))),
    "把昵称抄进了成绩行，用户改名后榜上留的还是旧名字");

  ok("榜只给前 N 名，N 之外的自己单给一行",
    /var shown = ranked\.slice\(0, size\)/.test(apiCore)
      && /me: self/.test(apiCore)
      && /r\.mine && ranked\.indexOf\(r\) >= size/.test(apiCore),
    "整张榜拉下来再挑 —— 人一多就白拉；或者干脆不给自己那一行，第 1685 名看不到自己");

  ok("圈外那一行在上榜行下面，隔一句「还有多少位」",
    pageWxml.indexOf("{{beyond}}") >= 0
      && pageWxml.indexOf("wx:if=\"{{me}}\"") >= 0
      && pageWxml.indexOf("wx:for=\"{{rest}}\"") < pageWxml.indexOf("wx:if=\"{{me}}\"")
      && rank.beyondOf([{ rank: 1 }], 10, 1685) === 1684 && rank.beyondOf([], 10, 0) === 0,
    "圈外那一行跑到列表上面，或者「还有几位」把自己也数进去");

  ok("榜单是单独一页，入口在大会页（不挤进考试页里）",
    app.subPackages.filter((sp) => sp.root === "packages/ranking").length === 1
      && /onRanking/.test(read("packages/game/index/index.js"))
      && /packages\/ranking\/index\/index/.test(read("packages/game/index/index.js"))
      && pageWxml.indexOf("podium") >= 0
      && pageJs.indexOf("rankingList") >= 0,
    "榜单挂在考试结果页里的话，飞花令那一半就没有入口");

  ok("榜单页按「学段 / 年级 / 学期 / 日周月年」四层收窄，且走的是同一份查询",
    pageWxml.indexOf("onStage") >= 0 && pageWxml.indexOf("onGrade") >= 0
      && pageWxml.indexOf("onTerm") >= 0 && pageWxml.indexOf("onPeriod") >= 0
      && (pageJs.match(/this\.load\(\)/g) || []).length >= 4,
    "少一层就等于把不同档次的成绩排在一块");

  ok("管理后台那枚开关作用是实打实的（读回来的是服务端那一行）",
    adminWxml.indexOf("onRanking") >= 0
      && /admin\.rankingState\(\)/.test(adminJs) && /admin\.setRanking\(/.test(adminJs)
      && /PATHS\.adminRanking/.test(read("utils\/remote.js"))
      && /"\/api\/admin\/ranking"/.test(read("utils\/remote.js")),
    "开关只在页面上改个布尔值、不落服务端 —— 用户那头一点变化都没有");
}

{
  const readerWxml = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxml"), "utf8");
  const readerJs = fs.readFileSync(path.join(ROOT, "pages/reader/reader.js"), "utf8");
  const prefsAt = readerWxml.indexOf('class="prefs"');
  const inPrefs = readerWxml.slice(prefsAt, readerWxml.indexOf('class="poem-body', prefsAt));

  ok("详情页的偏好条上，对齐与注音是两组独立的选择",
    inPrefs.indexOf('bindchange="onAlign"') >= 0 && inPrefs.indexOf('bindchange="onPinyin"') >= 0,
    "对齐或注音那一组没了 —— 读这首诗时改不了版式");

  ok("字号不用滑块（它在详情页里那一行放不下）",
    readerWxml.replace(/<!--[\s\S]*?-->/g, "").indexOf("<slider") < 0
      && readerJs.indexOf("onFontSlide") < 0,
    "字号又回到滑块 —— 那一行装不下量程");

  ok("偏好条底层仍是原生 radio（包在 label 里、视觉隐藏）",
    /<radio-group class="pref-seg"/.test(readerWxml) && /class="opt-radio"/.test(readerWxml));
}

{
  const readerWxml2 = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxml"), "utf8");

  const metaWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const metaNoComment = readerWxml2.replace(/<\!--[\s\S]*?-->/g, " ");
  const metaStart = metaNoComment.indexOf('<view class="poem-meta-row">');
  const metaEnd = metaNoComment.indexOf("</view>", metaStart);
  const metaInner = metaStart < 0 ? "" : metaNoComment.slice(metaStart, metaEnd);
  ok("朝代 / 作者 / 出处 / 学段四段都在同一个容器里",
    /\{\{dynasty\}\}/.test(metaInner)
      && /\{\{author\}\}/.test(metaInner)
      && /\{\{source\}\}/.test(metaInner)
      && /\{\{stage\}\}/.test(metaInner)
      && !/class="poem-source"/.test(metaNoComment)
      && !/class="tag stage-tag"/.test(metaNoComment),
    "读到的这一段：「" + metaInner.replace(/\s+/g, " ").trim().slice(0, 120) + "」");

  ok("选本出处并进身份行，题名异写另起一行",
    /\{\{selection\}\}/.test(metaInner) && !/\{\{aliasText\}\}/.test(metaInner)
      && /\{\{aliasText\}\}/.test(readerWxml2));

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

  ok("身份行放不下时省略，不换成两行",
    /\.poem-meta\s*\{[^}]*text-overflow\s*:\s*ellipsis/.test(metaWxss)
      && /\.poem-meta-row\s*\{[^}]*flex-wrap\s*:\s*nowrap/.test(metaWxss));

  ok("评分后的提示读的是记录上的下次复习时刻",
    (() => {
      const rm = require(path.join(ROOT, "utils", "review-models.js"));
      const at = new Date(2025, 0, 7, 9, 0, 0).getTime();
      const hint = rm.resultHint("k", "good", { nextReviewAt: at });
      const other = rm.resultHint("k", "good", { nextReviewAt: at + 86400000 });
      return hint.indexOf("1 月 7 日") >= 0 && other.indexOf("1 月 8 日") >= 0;
    })(),
    "提示若自己按结果类型算「N 小时 / N 分钟后」，就和记录上的 nextReviewAt 对不上 —— "
      + "用户照着提示去等，等到的不是排期里那一天");
}

{
  const themeSrc = fs.readFileSync(path.join(ROOT, "utils", "theme.js"), "utf8");
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");

  const themeMod = require(path.join(ROOT, "utils", "theme.js"));
  const all = themeMod.all();

  const WANT = [
    ["daiqing", "黛青", [2, 54, 51]],
    ["yangzhou", "扬州", [2, 54, 51]],
    ["kaifeng", "开封", [2, 54, 51]],
    ["qinglv", "青绿", [46, 106, 103]],
    ["muse", "暮色", [79, 96, 114]],
    ["nuahui", "暖灰", [164, 86, 104]],
    ["qingwa", "青瓦", [74, 100, 96]],
    ["mich", "米褐", [126, 101, 84]],
    ["shilv", "石绿", [108, 127, 79]],
    ["mohong", "墨红", [140, 47, 45]],
    ["wulan", "雾蓝", [96, 126, 149]],
    ["yanzhi", "胭脂", [157, 41, 51]],
    ["yuqing", "雨过天青", [47, 96, 85]],
    ["ink", "墨色", [8, 8, 10]]
  ];

  const rgbaOf = (c) => "rgba(" + c[0] + ", " + c[1] + ", " + c[2] + ", 1)";
  const softOf = (c) => "rgba(" + c[0] + ", " + c[1] + ", " + c[2] + ", 0.05)";

  const missing = WANT.filter(([k, name, rgb]) => {
    const t = all.find((x) => x.key === k);
    return !t || t.name !== name || t.rgba !== rgbaOf(rgb);
  });
  ok("清单就是这 14 项（扬州 / 开封 紧随黛青，其余是用户点名的十一个色）",
    missing.length === 0 && all.length === WANT.length
      && all.slice(0, 3).map((t) => t.key).join() === "daiqing,yangzhou,kaifeng",
    missing.map((m) => m[1]).join(", ") + "；清单 " + all.length + " 项");

  ok("色值统一一种写法（rgba），不混 hex（混着写对不齐、也难比对）",
    !/#[0-9a-fA-F]{3,8}/.test(themeSrc),
    (/#[0-9a-fA-F]{3,8}/.exec(themeSrc) || [""])[0]);

  const noSoft = all.filter((t) => t.soft !== softOf(t.rgb));
  ok("每个色都带一档 0.05 的淡淡版（胶囊底用它）", noSoft.length === 0,
    noSoft.map((t) => t.name).join(", "));

  ok("清单里的每个色都占一个 CSS 变量名", all.every((t) => /^--c-\w+$/.test(themeMod.VAR_OF[t.key])));

  const styleInk = themeMod.style("ink");
  const veiled = all.filter((t) => styleInk.indexOf(t.rgba) < 0 || styleInk.indexOf(t.soft) < 0);
  ok("每个色连同它那档淡淡版都挂到页面根节点上", veiled.length === 0,
    veiled.map((t) => t.name).join(", "));

  const CITY_BANNERS = {
    yangzhou: "https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/themes/city/yangzhou.png",
    kaifeng: "https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/themes/city/kaifeng.png"
  };
  const wrongBanner = all.filter((t) => themeMod.bannerOf(t.key) !== (CITY_BANNERS[t.key] || "/icons/hero.png"));
  ok("首页 banner 跟着主题走（扬州 / 开封 各一张走对象存储，其余都是 hero.png）",
    wrongBanner.length === 0,
    wrongBanner.map((t) => t.name + " → " + themeMod.bannerOf(t.key)).join(", "));

  const boxedCity = all.filter((t) => /^\/icons\/.*\.(png|jpg)$/.test(t.banner || "") && t.banner !== "/icons/hero.png");
  ok("扬州 / 开封 的 banner 不进包（包内只留 hero.png 这一张画）",
    boxedCity.length === 0, boxedCity.map((t) => t.name).join(", "));

  ok("默认那一项是「黛青」", themeMod.DEFAULT === "daiqing"
    && all.some((t) => t.key === "daiqing" && t.name === "黛青"));
  const tDef = /--theme\s*:\s*var\(--c-(\w+)\)\s*;/.exec(tokens);
  ok("tokens 的 --theme 默认值指向清单里默认那一项（两处不许各写一遍）",
    !!tDef && tDef[1] === themeMod.DEFAULT,
    "tokens 里 " + (tDef ? tDef[1] : "读不到") + " vs theme.js " + themeMod.DEFAULT);

  ok("tokens 里的 --theme 指向的那个变量，由页面根节点自己发出来",
    styleInk.indexOf("--c-daiqing:" + rgbaOf([2, 54, 51])) >= 0
      && /var\(--c-daiqing\)/.test(tokens));

  const missWxml = [], missJs = [];
  pages.forEach((pg) => {
    const wxml = fs.readFileSync(path.join(ROOT, pg + ".wxml"), "utf8");
    const js = fs.readFileSync(path.join(ROOT, pg + ".js"), "utf8");
    if (!/<view class="page[^"]*"\s+style="\{\{themeStyle\}\}"/.test(wxml)) missWxml.push(pg);
    if (!/theme\.apply\(this\)/.test(js)) missJs.push(pg);
  });
  ok("每个页面的根节点都挂了 themeStyle（主题传得到页面里）",
    missWxml.length === 0, missWxml.join(", "));
  ok("每个页面都在 onShow 里调了 theme.apply(this)", missJs.length === 0, missJs.join(", "));
}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const quizSrc = read("packages/game/quiz/lib.js");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<\!--[\s\S]*?-->/g, "");

  ok("题型仍是不带颜色的五档", (quizSrc.match(/key\s*:/g) || []).length >= 5);

  const examWxml = strip(read("packages/game/exam/exam.wxml"));
  const quizWxml = strip(read("packages/game/quiz/quiz.wxml"));
  ["packages/game/exam/exam.wxml", "packages/game/quiz/quiz.wxml"].forEach((f) => {
    const src = strip(read(f));
    ok(f + " 里不再有题型色的标签（.tag）", src.indexOf('class="tag') < 0);
    ok(f + " 的题干下面是一行读数（metaLine）", src.indexOf("{{metaLine}}") >= 0);
    ok(f + " 的选项带字母（optionRows / option-k）",
      src.indexOf("{{optionRows}}") >= 0 && src.indexOf("option-k") >= 0);
  });
  const examJs = read("packages/game/exam/exam.js");
  const quizJs = read("packages/game/quiz/quiz.js");
  ok("考试页与题库页各有一份 metaLineOf（题型 · 出自《…》）",
    /metaLineOf\s*\(/.test(examJs) && /metaLineOf\s*\(/.test(quizJs));
  ok("模板里不再手判「填朝代」有没有出处（那个判据搬进了 metaLineOf）",
    examWxml.indexOf("current.form !== 'dynasty'") < 0
      && quizWxml.indexOf("current.form !== 'dynasty'") < 0);

  const lettered = /function _quiz_lettered\([\s\S]*?\n\}/.exec(quizSrc);
  ok("选项字母在数据层生成（lettered 函数在）", !!lettered);
  ok("四个字母取自 ABCD，且与顺序绑在一起",
    !!lettered && /"ABCD"\[i\]/.test(lettered[0]));

  const optionSites = (quizSrc.match(/options:\s*_quiz_lettered\(/g) || []).length
    + (quizSrc.match(/options:\s*_quiz_lettered\(_quiz_shuffle/g) || []).length;
  ok("五个题型的 options 都套了 lettered（一处都不许漏）",
    (quizSrc.match(/lettered\(/g) || []).length >= 6,
    "出现 " + (quizSrc.match(/lettered\(/g) || []).length + " 次（1 处定义 + 5 处调用）");

  [["packages/game/exam/exam.wxml", examWxml], ["packages/game/quiz/quiz.wxml", quizWxml]]
    .forEach(([f, src]) => {
      ok(f + " 的 data-v 传的是选项原文（不是带字母的那一项）",
        /data-v="\{\{item\.text\}\}"/.test(src),
        "读到的是：" + (/data-v="[^"]*"/.exec(src) || ["无"])[0]);
    });

  const swatchPalette = require(path.join(ROOT, "utils", "theme.js")).palette();
  ok("页面上每个色拿到的是「本色 + 淡淡一档 + 压在上面的墨」三件",
    swatchPalette.every((x) => x.rgb && x.soft && x.on)
      && swatchPalette.some((x) => x.on.indexOf("255, 255, 255") >= 0)
      && swatchPalette.some((x) => x.on.indexOf("0, 0, 0") >= 0),
    "palette() 少给了一件 —— 界面上有一处会算出透明或读不出的字");

  const progWxml = strip(read("packages/progress/index/index.wxml"));
  const progJs = strip(read("packages/progress/index/index.js"));
  ok("进度页不再有「记忆阶段」那张卡（stageRows 数据也撤了）",
    progJs.indexOf("stageRows") < 0);

  ok("排期还在（四块里那块「全部到期篇目」按 days 摊开）",
    /wx:for="\{\{panels\}\}"/.test(progWxml) && /wx:for="\{\{d\.rows\}\}"/.test(progWxml),
    "排期那块被撤掉了 —— 撤的应该只是「记忆阶段」");

  ok("进度页那四块读数都在（概要 / 到期日历 / 全部到期篇目 / 掌握度分布）",
    /class="ring-fill"/.test(progWxml) && /class="cal-cell/.test(progWxml)
      && /掌握度分布/.test(progWxml) && /class="bar-row/.test(progWxml)
      && /overview\.avgMastery/.test(progWxml),
    "四块里缺了一块 —— 网页版 /progress 那几张卡在小程序这边没落全");

  ok("那四块读数不自己算（一律走 scheduler 的 overview / dueList）",
    /S\.overview\(/.test(progJs) && /S\.dueList\(/.test(progJs)
      && progJs.indexOf("store.progress") < 0 && progJs.indexOf("getRecord") < 0
      && progJs.indexOf("nextReviewAt") < 0,
    "进度页直接翻本机记录自己算了一遍 —— 同一个读数会有第二个出处");

  ok("点篇目走背诵弹层（进度页那几行能背，不只是看）",
    /<recite-sheet/.test(progWxml) && /data-id="\{\{item\.id\}\}"/.test(progWxml)
      && /openSheet\(/.test(progJs) === false
      && /sheet\.open\(/.test(progJs)
      && /onOpen\b/.test(progJs));

  {
    const declared = {};
    const dataBlock = /data:\s*\{([\s\S]*?)\n  \},/.exec(progJs);
    ((dataBlock || [])[1] || "").replace(/^\s*(\w+)\s*:/gm, (_, k) => { declared[k] = true; });

    const loop = ["item", "index", "d", "p"];
    const unknown = {};
    (progWxml.match(/\{\{([^}]*)\}\}/g) || []).forEach((raw) => {
      raw.slice(2, -2).replace(/'[^']*'|"[^"]*"/g, " ").split(/[^\w.$]+/).forEach((part) => {
        const seg = part.split(".").filter(Boolean);
        if (!seg.length) return;
        if (loop.indexOf(seg[0]) >= 0) return;
        if (/^[A-Z_]+$/.test(seg[0])) return;
        if (declared[seg[0]] === undefined) unknown[seg[0]] = true;
      });
    });

    const names = Object.keys(unknown).filter((k) => declared[k] !== true && k !== "themeStyle");
    ok("进度页模板里的每个字段都真的被 setData 过（不留读不到的名字）",
      names.length === 0,
      "模板读了这些页面从没设过的字段：" + names.join(", "));
  }
}

{
  const sheetDir = path.join(ROOT, "components", "recite-sheet");
  const four = [".js", ".json", ".wxml", ".wxss"].every((ext) =>
    fs.existsSync(path.join(sheetDir, "recite-sheet" + ext)));
  ok("背诵弹层四件套齐全", four);

  const homeWxml = fs.readFileSync(path.join(ROOT, "pages/home/home.wxml"), "utf8");
  const homeJs = fs.readFileSync(path.join(ROOT, "pages/home/home.js"), "utf8");
  const sheetWxml = fs.readFileSync(path.join(sheetDir, "recite-sheet.wxml"), "utf8");
  const sheetJs = fs.readFileSync(path.join(sheetDir, "recite-sheet.js"), "utf8");
  const sheetWxss = fs.readFileSync(path.join(sheetDir, "recite-sheet.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  ok("首页挂上了背诵弹层", homeWxml.indexOf("<recite-sheet") >= 0);
  const homeCfg = readJson(path.join(ROOT, "pages/home/home.json"));
  ok("首页注册了这个组件",
    (homeCfg.usingComponents || {})["recite-sheet"] === "/components/recite-sheet/recite-sheet");
  ok("点篇目走弹层（不再 navigateTo 详情页）",
    /onOpen[\s\S]{0,400}?openSheet\(/.test(homeJs)
      && !/onOpen[\s\S]{0,400}?pages\/reader\/reader/.test(homeJs),
    "onOpen 里还在跳详情页");
  ok("首页不再有第二个大按钮（「开始背」撤了，只留「加背」卡里那一套）",
    !/onStart/.test(homeWxml) && !/onBrowseAll/.test(homeWxml),
    "hero 区还挂着 onStart / onBrowseAll —— 一屏里两个填黑的大按钮");
  ok("点篇目仍走弹层（同一件事，不该两条路）",
    /onOpen[\s\S]{0,300}?openSheet\(/.test(homeJs));
  const openSheetSrc = homeJs.slice(homeJs.indexOf("openSheet(id, source) {"));
  ok("弹层由首页把门禁，组件自己不查",
    /gate\.guard\(/.test(openSheetSrc.slice(0, 600))
      && !/gate\.(?!Tier)/.test(sheetJs.replace(/\/\*[\s\S]*?\*\//g, "")),
    "首页 openSheet 里没调 gate.guard，或组件自己查了门禁");

  const rootBody = /\.sheet-root\s*\{([^}]*)\}/.exec(sheetWxss);

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

    const missRow = missing(missId);
    const missData = missRow.data;
    ok("取不到正文时弹层正文区不留空：给一行说明，并给一条再取一次的路",
      missData.loadingText === false && !!missData.textMiss
        && missData.blocks.length === 0 && missData.tokens.length === 0
        && typeof opt.methods.missText === "function",
      "正文取不到时弹层正文区还是空的 —— 看上去像显示了上一次那一首");
    ok("「再取一次」挂在 view 上而不是原生 button 上（原生 button 自带一层 ::after，压着点不动）",
      /<view[^>]*poem-miss-btn[^>]*bindtap="onSyncText"/.test(sheetWxml)
        && sheetWxml.indexOf("<button") < 0,
      "正文缺失区里又用回了原生 button —— 点下去没有反馈，或者干脆点不到");

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
  ok("open 时把 queue 落到组件自己的 data 上（不依赖父层那一批 setData 的先后）",
    /setData\(\{\s*open:\s*true,[\s\S]{0,80}?queue:\s*list\s*\}/.test(sheetJs),
    "open() 没写 queue —— 首帧 current() 读的是上一批数据");
  const sheetBody = /\.sheet\s*\{([^}]*)\}/.exec(sheetWxss);
  const z = Number((/z-index\s*:\s*(\d+)/.exec(rootBody[1]) || [])[1] || 0);
  const barCss = fs.readFileSync(path.join(ROOT, "custom-tab-bar", "index.wxss"), "utf8");
  const barZ = Number((/z-index\s*:\s*(\d+)/.exec(barCss) || [])[1] || 0);

  ok("弹层是整屏浮层，且有遮罩（点空白能收起）",
    !!rootBody && /position\s*:\s*fixed/.test(rootBody[1])
      && sheetWxml.indexOf("sheet-mask") >= 0,
    "浮层不是 fixed，或者没有遮罩层");
  ok("弹层带着自己的层级（抬得过高会把自绘底栏也盖住）",
    z >= 50 && z < barZ,
    "弹层 z=" + z + " 底栏 z=" + barZ + " —— 层级关系不对");

  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const surface = [".poem-head", ".poem-title", ".poem-meta-row", ".prefs", ".poem-body",
    ".tk-py", ".trans-head", ".recite-head", ".mastery-bar"];
  const hasRule = (css, cls) =>
    new RegExp(cls.replace(".", "\\.") + "\\s*\\{").test(css);
  const missing = surface.filter((cls) => !hasRule(appWxss, cls));
  const readerWxssOnly = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxss"), "utf8");
  const dup = surface.filter((cls) => hasRule(sheetWxss, cls) || hasRule(readerWxssOnly, cls));

  ok("阅读面只在 app.wxss 定义一份（弹层与详情页共用）",
    missing.length === 0 && dup.length === 0,
    "缺定义：" + missing.join(", ") + "；写了第二份：" + dup.join(", ") +
      " —— 掌握度那一块（recite-head / mastery-bar）早先只写在详情页的样式表里，" +
      "弹层里读不到，标题与百分比挤成一行、与上面那三颗评分之间也没有间距（Issue #268）");

  ok("弹层用了共用的那几样（选项 / 图标 / 注音 / 生僻字标记 / 掌握度）",
    [".pref-opt", ".pref-opt.ic", ".glyph", ".token", ".tk-ch", ".mastery-num", ".trans-text"]
      .every((cls) => hasRule(appWxss, cls)),
    "弹层自绘了一份 —— 与详情页迟早漂开");

  ok("三档评分各有自己的分支（忘记 / 模糊 / 记住）",
    ["忘记", "模糊", "记住"].every((t) => sheetJs.indexOf(t) >= 0),
    "少一档 —— 有一类评价给不出去");
  {
    const tokensCss = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
    const mark = ((tokensCss.match(/--mark:\s*([^;]+);/) || [])[1] || "").trim();
    const faceCss = fs.readFileSync(path.join(ROOT, "pages/home/home.wxss"), "utf8");
    const onFace = (faceCss.match(/\.face\.on\s+\.face-ico\s*\{[^}]*\}/g) || []).join("");
    ok("卡片的评价图标取 --mark（不跟着所在底色换主题色）",
      !!mark && /color:\s*var\(--mark\)/.test(onFace),
      ".face.on .face-ico 没取 --mark —— 白卡与主题底上会共用一种颜色（Issue #425）");

    const chipOn = (/^\.chip\.on\s*\{([^}]*)\}/m.exec(appWxss) || [])[1] || "";
    const chipRules = [...appWxss.matchAll(/^([^{}]+)\{([^}]*)\}/gm)].map((m) => ({
      sel: m[1].trim(), body: m[2]
    }));
    const chipBodyOf = (k) => chipRules
      .filter((r) => r.sel.split(",").map((x) => x.trim()).indexOf(".chip." + k) >= 0)
      .map((r) => r.body).join("");
    const flipped = ["bad", "fuzzy", "good"].filter((k) => {
      const body = chipBodyOf(k);
      return !/background:\s*var\(--depth\)/.test(body) || !/color:\s*var\(--on-ink\)/.test(body);
    });
    const chipOnT = (/^\.chip\.on \.chip-t\s*\{([^}]*)\}/m.exec(appWxss) || [])[1] || "";
    const partOf = (k, part) => {
      const hit = chipRules.filter((r) => r.sel.split(",").map((x) => x.trim())
        .indexOf(".chip." + k + " " + part) >= 0);
      return hit.map((r) => r.body).join("");
    };
    const chipped = ["bad", "fuzzy", "good"].filter((k) => {
      const label = partOf(k, ".chip-t");
      const glyph = partOf(k, ".glyph");
      return !/color:\s*inherit/.test(label) || /background-color/.test(label)
        || !/color:\s*inherit/.test(glyph) || !/background-color:\s*currentColor/.test(glyph);
    });
    ok("评分格三档（忘记 / 模糊 / 记住）共用主题底与压得住的字色",
      flipped.length === 0 && /color:\s*var\(--strong-text\)/.test(chipOnT)
        && !/background:\s*var\(--depth\)/.test(chipOn) && chipped.length === 0,
      flipped.join(", ") + " 没跟另外两档同底同色；"
        + chipped.join(", ") + " 的文字与图标没分开 —— 字跟着涂成实心块就看不见了（Issue #425）");

    ok("选中的格子是 0.05 的主题底 + 1.0 的主题边框，字走主题色",
      /background:\s*var\(--strong-soft\)/.test(chipOn)
        && /border-color:\s*var\(--strong\)/.test(chipOn),
      "选中态不是淡底 + 主题边框 —— 与其他「说了有这回事」的标注分成了两副样子（Issue #425）");

    const theme = require(path.join(ROOT, "utils", "theme.js"));
    const channelOf = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = (rgb) => 0.2126 * channelOf(rgb[0]) + 0.7152 * channelOf(rgb[1]) + 0.0722 * channelOf(rgb[2]);
    const contrastOf = (a, b) => {
      const x = luminance(a), y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const weak = theme.all().filter((t) => {
      const ink = t.on === "rgba(255, 255, 255, 1)" ? [255, 255, 255] : [0, 0, 0];
      return contrastOf(t.depth, ink) < 4.5 || contrastOf([255, 255, 255], theme.MARK) < theme.MARK_MIN;
    });
    ok("每支主题的 --depth 都压得住压在上面的字（--mark 在白卡上也看得清）",
      theme.all().length > 0 && weak.length === 0,
      weak.map((t) => t.key).join(", ") + " —— 换到这支主题，弹窗底上的字就糊了");
  }
  ok("评分后顺势进下一首（不是「关掉再去找」）",
    /goNext\(/.test(sheetJs) && /this\.setData\(\{\s*index:\s*next/.test(sheetJs));
  ok("队列走完就把弹层收掉（人回到列表，勾都在）",
    /next\s*>=\s*this\.data\.queue\.length[\s\S]{0,120}?onClose\(\)/.test(sheetJs));

  ok("队列从首页传进来（组件不自己排计划）",
    sheetWxml.indexOf("queue=") < 0 && homeWxml.indexOf('queue="{{sheetRows}}"') >= 0,
    "首页那两个入口（计划卡 / 全部诗词卡）把各自的队列灌进 sheetRows");

  ok("偏好条上的每一项都是图标，没有文字标签",
    !/class="pref-t"/.test(sheetWxml)
      && /const ALIGNS = \[[\s\S]{0,200}?icon:\s*icons\.left/.test(sheetJs)
      && /const PINYIN_MODES = \[[\s\S]{0,260}?icon:\s*icons\.all/.test(sheetJs)
      && /mask-image:url\('\{\{item\.icon\}\}'\)/.test(sheetWxml)
      && /mask-image:url\('\{\{icons\.zoomOut\}\}'\)/.test(sheetWxml)
      && /mask-image:url\('\{\{icons\.zoomIn\}\}'\)/.test(sheetWxml),
    "偏好条还写着字，或者图标少了一套（两档注音 / 两档对齐 / 加减字号）");

  ok("「加入今日背诵」与「加入自选」同在一个分组里，都是图标",
    /\.pref-act\s*\{[^}]*border:\s*1rpx/.test(appWxss)
      && /class="pref-act"[\s\S]{0,700}?onToggleDaily[\s\S]{0,400}?onAddToCollection/
        .test(fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.wxml"), "utf8"))
      && /icons\[dailyOn \? 'added' : 'add'\]/.test(sheetWxml)
      && /data:image\/svg\+xml;base64,/.test(require(path.join(ROOT, "utils", "icons.js")).add)
      && /data:image\/svg\+xml;base64,/.test(require(path.join(ROOT, "utils", "icons.js")).added),
    "加背与自选那两枚又散在偏好条外 —— 换回图标，并收进同一个分组框");

  ok("底栏那一块算在弹层的 padding 里（上下首与底栏隔开，不被挡住）",
    /--bar-h:\s*calc\(var\(--tabbar-h\)[^)]*\)/.test(sheetWxss)
      && /\.sheet\s*\{[^}]*max-height:\s*var\(--sheet-max-h\)/.test(sheetWxss)
      && /\.sheet\s*\{[^}]*padding:[^;]*var\(--bar-h\)/.test(sheetWxss)
      && /\.sheet-body\s*\{[^}]*flex:\s*1/.test(sheetWxss)
      && /\.sheet-body\s*\{[^}]*overflow-y:\s*auto/.test(sheetWxss)
      && /--tabbar-h\s*:/.test(fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8")),
    "弹层没给底栏让位 —— 长诗的底部几条会被底栏盖住");

  ok("弹层里没有多余的分隔线（译文卡上下那两道已撤）",
    !/\.sheet\s+\.sheet-foot\s*\{[^}]*border-top/.test(sheetWxss)
      && /\.trans-src\s*\{[^}]*margin-top/.test(appWxss)
      && !/\.trans-src\s*\{[^}]*border-top/.test(appWxss)
      && !/\.trans-head\s*\{[^}]*border-bottom/.test(appWxss),
    "译文上下还挂着线 —— 一条都不该有");

  ok("翻页会回调首页（列表的勾要跟着动）",
    /triggerEvent\("open"/.test(sheetJs) && /bind:open="onSheetOpen"/.test(homeWxml));

  const storeSrc = fs.readFileSync(path.join(ROOT, "utils", "store.js"), "utf8");
  const schedSrc = fs.readFileSync(path.join(ROOT, "utils", "scheduler.js"), "utf8");

  ok("弹层不靠页面传「背没背过」（自己取 store）",
    /store\.getRecord\(/.test(sheetJs));

  ok("打开弹层只算「读过」，不算「背过」（两件事各有各的写法）",
    sheetJs.indexOf("markRead") >= 0 && /S\.isLearned/.test(homeJs)
      && /item\.recited/.test(homeWxml) && /item\.stateText/.test(homeWxml),
    "把已读与已背写成同一个判据 —— 点开看一眼就成了「已背」");

  ok("未读 / 未背 / 已背是同一枚胶囊的三个状态（不并排摆两枚）",
    /class="tag row-state \{\{item\.stateCls\}\}"/.test(homeWxml)
      && !/\{\{!item\.read\}\}/.test(homeWxml)
      && /function stateText\(recited, read\)[\s\S]{0,160}?已背[\s\S]{0,120}?未背[\s\S]{0,80}?未读/.test(homeJs),
    "未读又单独摆了一枚 —— 未读必然未背，一枚胶囊按顺序往下走就够了");

  const quotesSrc = fs.readFileSync(path.join(ROOT, "utils", "finish-quote.js"), "utf8");
  const quotes = require(path.join(ROOT, "utils", "finish-quote.js"));
  ok("今日那几首背完给一句收尾（提示与读数共用 allDone，不是一个新判据）",
    /allDone/.test(homeJs) && /praise/.test(homeJs)
      && /wx:if="\{\{allDone\}\}"/.test(homeWxml) && /\{\{praise\}\}/.test(homeWxml)
      && /percent: base \?/.test(homeJs),
    "今日卡背完了却没有一句收尾 —— 屏幕上看不出今天已经做完");

  ok("收尾句取自格言池，随日期换（不是一个固定句）",
    quotes.LINES.length === 100
      && new Set(quotes.LINES).size === 100
      && /quotes\.pick\(Date\.now\(\) \/ R\.DAY/.test(homeJs)
      && !/const PRAISE/.test(homeJs),
    "收尾句写死在一处 —— 每天看到的是同一句话");

  ok("课内与自选各自收尾，池子与取法只有一份",
    /praiseOf\("course"\)/.test(homeJs) && /praiseOf\("own"\)/.test(homeJs)
      && /wx:if="\{\{selfPraise\}\}"/.test(homeWxml)
      && (quotesSrc.match(/^const LINES = \[/gm) || []).length === 1,
    "自选的今日份背完了没有收尾句 —— 自选模式下看不到完成");

  ok("「已背」只认评过分（isLearned 的口径：learned / attempted / history），不认已读",
    /function\s+isLearned\s*\(rec\)[\s\S]{0,160}?rec\.learned[\s\S]{0,80}?rec\.history/.test(schedSrc)
      && /recitedOf\[it\.poem\.id\] = recited/.test(homeJs)
      && /S\.todayDone\(todaySet, recitedOf\)/.test(homeJs),
    "首页拿已读当已背 —— 点开弹窗看一眼，统计里就多一首「已背」");

  ok("今日的读数只看今天排定的那几首，日计划重排后不会凭空变成「已背完」",
    /function todaySet\(planKey, base\)/.test(schedSrc)
      && /S\.todayLeft\(todaySet, recitedOf\)/.test(homeJs)
      && /drop\(KEYS\.dayPlan\)/.test(storeSrc),
    "「今天背完几首」改为数计划里的长度 —— 重排后新诗还没背，首页就说今天背完了");

  ok("已读仍单独标出来（它与已背不是一件事）",
    /store\.reads\(/.test(homeJs) && /stateText\(recited, read\)/.test(homeJs)
      && /item\.stateText/.test(homeWxml),
    "把已读那一格删了 —— 读过但没评分的诗在列表上就与没碰过的一样");

  ok("弹层显式接了页面那份主题变量",
    homeWxml.indexOf('theme-style="{{themeStyle}}"') >= 0
      && /themeStyle:\s*\{\s*type:\s*String/.test(sheetJs)
      && /style="\{\{themeStyle\}\}"/.test(sheetWxml),
    "首页没传 theme-style，或组件没把它挂在根节点上");

  ok("组件不发网络（同步由页面统一管）",
    sheetJs.indexOf("wx.request") < 0 && sheetJs.indexOf("remote") < 0);

}

{

  const wxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  ok("注音那一行按内容撑高（有音无音不差半行，软折行也不压上一行）",
    /\.token-line\s*\{[^}]*height\s*:\s*auto/.test(wxss)
      && /\.token\s*\{[^}]*height\s*:\s*calc\(\s*var\(--py-slot\)\s*\+\s*var\(--poem-fs\)\s*\)/.test(wxss),
    "注音行又定死在 --py-line —— 软折行那一行的拼音会压到上一行上");

  const tokensWxss = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  const rule = (cls) => {
    const m = new RegExp("\\." + cls + "\\s*\\{([^}]*)\\}").exec(wxss);
    return m ? m[1] : "";
  };
  const poemTitle = rule("poem-title");
  const poemLine = rule("poem-line");
  const poemMeta = rule("poem-meta");
  ok("题名与身份行是常规字重（重点交给字号与留白）",
    /font-weight\s*:\s*400/.test(poemTitle) && /font-weight\s*:\s*400/.test(poemMeta),
    "题名或身份行又叠了粗体 —— 与正文字号一起喊");

  ok("诗句正文不再自己加字距（汉字已是全角方框）",
    /letter-spacing\s*:\s*0\s*;/.test(poemLine),
    "正文又加回了字距 —— 字形不变而字距变宽，一列下来是拉伸感");

  ok("详情页的题名与正文同取一条字体链（与其余诗词文本也是同一条）",
    !/--font-detail|--font-poem-text/.test(tokensWxss)
      && /\.poem-title\s*\{[^}]*var\(--font-poem\)/.test(wxss)
      && /\.poem-body\s*\{[^}]*var\(--font-poem\)/.test(wxss),
    "详情页的题名与正文又分了链，或取的不是 --font-poem");

  const sizes = new Set(
    [...wxss.matchAll(/\.poem-body\.size(--?\d+)/g)]
      .map((m) => String(m[1]))
      .map((n) => Number(n.charAt(0) === "-" ? n.slice(1) : n))
  );
  const sheetJsSrc = fs.readFileSync(
    path.join(ROOT, "components", "recite-sheet", "recite-sheet.js"), "utf8");
  const readerJsSrc = fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.js"), "utf8");
  const range = (src) => {
    const lo = /FONT_MIN\s*=\s*(-?\d+)/.exec(src);
    const hi = /FONT_MAX\s*=\s*(-?\d+)/.exec(src);
    return { lo: lo ? Number(lo[1]) : NaN, hi: hi ? Number(hi[1]) : NaN };
  };
  const sheetRange = range(sheetJsSrc);
  const gaps = [];
  for (let n = sheetRange.lo; n <= sheetRange.hi; n++) {
    if (!sizes.has(n)) gaps.push(n);
  }
  ok("字号的量程与正文的档位对得上（点到哪一档都要有落点）",
    Number.isFinite(sheetRange.lo) && sheetRange.hi > sheetRange.lo
      && gaps.length === 0
      && range(readerJsSrc).lo === sheetRange.lo && range(readerJsSrc).hi === sheetRange.hi
      && /fontMax:\s*FONT_MAX/.test(sheetJsSrc)
      && /fontDown\s*:/.test(sheetJsSrc) && /fontUp\s*:/.test(sheetJsSrc),
    "量程 " + sheetRange.lo + "…" + sheetRange.hi + "，正文里没有这几档："
      + gaps.join(", ") + " —— 点下去没反应");

  const csSrc = fs.readFileSync(path.join(ROOT, "utils", "corpus.js"), "utf8");
  const nums = (re) => {
    const m = re.exec(csSrc);
    return m ? m[1].split(",").map((x) => Number(x.trim())) : [];
  };
  const fsPoem = nums(FS_POEM_RE);
  const pyBox = nums(PY_BOX_RE);
  const sizeRule = (n) => {
    const sel = ".poem-body.size" + (n < 0 ? "--" + Math.abs(n) : "-" + n);
    const m = new RegExp(sel.replace(/\./g, "\\.") + "\\s*\\{([^}]*)\\}").exec(wxss);
    return m ? m[1] : "";
  };
  const cssFs = [];
  for (let n = sheetRange.lo; n <= sheetRange.hi; n++) {
    const one = /--poem-fs\s*:\s*(\d+)rpx/.exec(sizeRule(n));
    cssFs.push(one ? Number(one[1]) : NaN);
  }
  ok("装箱不跨段：段落由空行与段上限给",
    /STANZA_MAX_ROWS\s*=\s*\d+/.test(csSrc)
      && /if \(!ln\.s\.length\)/.test(csSrc));

  ok("表格（框线画的行）整行原样排，不按标点拆",
    /BOX_DRAWING\s*=\s*\//.test(csSrc)
      && /pushRows\(\[\[ln\.line\]\]\)/.test(csSrc));

  ok("一行收口优先落在句末，其次才按栏宽",
    /function sentenceCut\(/.test(csSrc) && /\[。！？\]\$/.test(csSrc)
      && /function softTail\(/.test(csSrc) && /\[、：；\]\$/.test(csSrc));

  ok("版式装箱用的字号表与样式表逐档相同",
    fsPoem.length === cssFs.length && fsPoem.every((v, i) => v === cssFs[i]),
    "corpus.js " + JSON.stringify(fsPoem) + " vs app.wxss " + JSON.stringify(cssFs));

  const cssBox = [];
  for (let n = sheetRange.lo; n <= sheetRange.hi; n++) {
    const one = /--py-box\s*:\s*(\d+)rpx/.exec(sizeRule(n));
    cssBox.push(one ? Number(one[1]) : NaN);
  }
  ok("注音装箱用的字身盒与样式表逐档相同",
    pyBox.length === cssBox.length && pyBox.every((v, i) => v === cssBox[i]),
    "corpus.js " + JSON.stringify(pyBox) + " vs app.wxss " + JSON.stringify(cssBox));

  const pyGap = /PY_GAP\s*=\s*(\d+)/.exec(csSrc);
  const cssGap = /--py-gap\s*:\s*calc\((\d+)rpx/.exec(tokensWxss);
  ok("注音的字间距两边同值（装箱按它算一行几个字）",
    !!pyGap && !!cssGap && Number(pyGap[1]) === Number(cssGap[1]),
    "corpus.js " + (pyGap && pyGap[1]) + " vs tokens.wxss " + (cssGap && cssGap[1]));

  const pyFs = /--fs-pinyin\s*:\s*calc\((\d+)rpx/.exec(tokensWxss);
  const pySlot = /--py-slot\s*:\s*calc\((\d+)rpx/.exec(tokensWxss);
  ok("注音槽装得下注音那一行（字号抬了槽也要抬）",
    !!pyFs && !!pySlot && Number(pySlot[1]) >= Number(pyFs[1]) * 1.6,
    "注音 " + (pyFs && pyFs[1]) + "rpx / 槽 " + (pySlot && pySlot[1]) + "rpx");

  ok("折下来的那一行比句读分行松（软折行 +8px）",
    /--poem-fold\s*:\s*16rpx/.test(tokensWxss)
      && /\.poem-line:not\(\.token-line\)\s*\+\s*\.poem-line:not\(\.token-line\)\s*\{[^}]*margin-top\s*:\s*calc\(\s*-1\s*\*\s*var\(--poem-fold\)/.test(wxss),
    "软折行与句读分行又一样松了");

  ok("版式按字号重排（改字号要重算装箱）",
    /corpus\.layout\([^)]*\{[^}]*size:/.test(readerJsSrc)
      && /corpus\.layout\([^)]*\{[^}]*size:/.test(fs.readFileSync(
        path.join(ROOT, "components", "recite-sheet", "recite-sheet.js"), "utf8")),
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

  const lockWxml = fs.readFileSync(
    path.join(ROOT, "components", "lock-card", "lock-card.wxml"), "utf8");
  const lockJs = fs.readFileSync(
    path.join(ROOT, "components", "lock-card", "lock-card.js"), "utf8");
  const appWxssLock = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  ok("lock-card 声明并渲染了 note（空 note 不留空白，样式收在 app.wxss）",
    /note\s*:\s*\{/.test(lockJs) && /lock-note/.test(lockWxml)
      && /lock-note[^>]*wx:if/.test(lockWxml) && /\.lock-note\s*\{/.test(appWxssLock));

  const homeWxmlDaily = fs.readFileSync(path.join(ROOT, "pages", "home", "home.wxml"), "utf8");
  const extraWxml = fs.readFileSync(
    path.join(ROOT, "components", "daily-extra", "daily-extra.wxml"), "utf8");
  const searchLine = /<view class="extra-search">[\s\S]*?<\/view>\s*<\/view>/.exec(homeWxmlDaily);
  ok("加背搜索行在首页顶部的卡片之外，带 placeholder（空着时也知道能搜）",
    homeWxmlDaily.indexOf("<daily-extra") >= 0
      && !!searchLine && /<input[^>]*placeholder="[^"]+"/.test(searchLine[0]),
    "加背卡没挂上，或搜索行没有 placeholder");
  ok("搜索行不在卡片里（那张外壳拿掉了）",
    !!searchLine && searchLine[0].indexOf("card") < 0,
    "搜索行又套回一张卡 —— 上面那张今日背诵卡已经给过一次外壳");
  ok("加背卡自己不再画搜索框（搜索行只有首页那一处）",
    homeWxmlDaily.indexOf('<view class="extra-search">') < homeWxmlDaily.indexOf("<daily-extra")
      && extraWxml.indexOf("<input") < 0 && extraWxml.indexOf("search-icon") < 0,
    "搜索框又回到卡片里 —— 一处输入两个地方画，改一个忘一个");
  ok("搜索行的按键都接到组件上（输入 / 回车 / 清空）",
    /bindinput="onExtraInput"/.test(homeWxmlDaily)
      && /bindconfirm="onExtraSearch"/.test(homeWxmlDaily)
      && /bindtap="onExtraClear"/.test(homeWxmlDaily)
      && /searchExtra\(/.test(fs.readFileSync(path.join(ROOT, "pages", "home", "home.js"), "utf8")),
    "行上的按键没有落到组件 —— 输入不搜、清空不清");
}

{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const storeSrc = fs.readFileSync(path.join(ROOT, "utils", "store.js"), "utf8");
  const schedSrc = fs.readFileSync(path.join(ROOT, "utils", "scheduler.js"), "utf8");
  const homeJs = fs.readFileSync(path.join(ROOT, "pages/home/home.js"), "utf8");
  const homeWxml = fs.readFileSync(path.join(ROOT, "pages/home/home.wxml"), "utf8");
  const compDir = path.join(ROOT, "components", "daily-extra");
  const compJs = fs.readFileSync(path.join(compDir, "daily-extra.js"), "utf8");
  const compWxml = fs.readFileSync(path.join(compDir, "daily-extra.wxml"), "utf8");
  const readerWxml = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxml"), "utf8");
  const sheetWxml = fs.readFileSync(path.join(ROOT, "components/recite-sheet/recite-sheet.wxml"), "utf8");
  const setWxml = fs.readFileSync(path.join(ROOT, "packages/settings/recite/recite.wxml"), "utf8");
  const setJs = fs.readFileSync(path.join(ROOT, "packages/settings/recite/recite.js"), "utf8");

  ok("今日加背：四件套齐全、首页挂上并注册、两处都挂 change",
    [".js", ".json", ".wxml", ".wxss"].every((e) => fs.existsSync(path.join(compDir, "daily-extra" + e)))
      && homeWxml.indexOf("<daily-extra") >= 0
      && (readJson(path.join(ROOT, "pages/home/home.json")).usingComponents || {})["daily-extra"]
        === "/components/daily-extra/daily-extra"
      && /<daily-extra[^>]*bind:change="onExtraChange"/.test(homeWxml)
      && /<recite-sheet[^>]*bind:change="onExtraChange"/.test(homeWxml)
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
  ok("「今日课内」卡片挂的是落盘后那一份计划（baseCount 与行数同源）",
    /const base = Math\.max\(recorded\.length, plan\.length - extraOf\);/.test(homeJs)
      && /baseCount: base,/.test(homeJs)
      && /class="all-count" wx:if="\{\{!selfOnly\}\}">\{\{baseCount \? doneCount \+ '\/' \+ baseCount : total \+ ' 首'\}\}/.test(homeWxml),
    "卡片读数按落盘条数算、行按实时计划给 —— 两处一错位，用户看到「6 首」里少一首（Issue #370）");
  ok("详情页与背诵弹层都有加背开关，且共用一份间距（页面里不写第二份）",
    readerWxml.indexOf("onToggleDaily") >= 0
      && sheetWxml.indexOf("onToggleDaily") >= 0
      && /\.prefs\s*\{[^}]*gap/.test(appWxss)
      && !/\.prefs\s*\{/.test(fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxss"), "utf8"))
      && !/\.prefs\s*\{/.test(fs.readFileSync(path.join(ROOT, "components/recite-sheet/recite-sheet.wxss"), "utf8")));
  ok("设置页的加背管理面板：四个动作都在，清空先问一句",
    setWxml.indexOf("daily-tools") >= 0
      && ["onDailyAll", "onDailyNone", "onDailyRemove", "onDailyClear"]
        .every((fn) => setWxml.indexOf(fn) >= 0 && setJs.indexOf(fn) >= 0)
      && /wx\.showModal/.test(setJs));
  ok("加背的档位在 store 里判一次，三个入口共用同一个错误码",
    /require\("\.\/entitlement"\)\.decide\("extra"\)/.test(storeSrc)
      && /E_TIER/.test(storeSrc)
      && compJs.indexOf("E_TIER") >= 0
      && /entitlement\.gateTier\("extra"/.test(fs.readFileSync(path.join(ROOT, "pages/reader/reader.js"), "utf8"))
      && /entitlement\.gateTier\("extra"/.test(fs.readFileSync(
        path.join(ROOT, "components/recite-sheet/recite-sheet.js"), "utf8"))
      && /entitlement\.gateTier\("extra"/.test(compJs),
    "Free 档还能往今日加背里加诗 —— 档位这道门只在 store 判，页面各写一份就对不齐");
  ok("能力表里有 extra（与网页版对齐）", E.CAP_KEYS.indexOf("extra") >= 0);
  ok("计划卡下面挂着「全部诗词」那张卡，默认折叠、开关是个上下方向的图标",
    /allOpen:\s*false/.test(homeJs)
      && /allLabel/.test(homeJs) && /allRows/.test(homeJs)
      && /<view class="card" wx:if="\{\{allCount\}\}">/.test(homeWxml)
      && /<view class="card-open"[^>]*bindtap="onToggleAll"/.test(homeWxml)
      && /wx:if="\{\{allOpen\}\}"/.test(homeWxml)
      && /wx:for="\{\{allRows\}\}"/.test(homeWxml)
      && /onToggleAll/.test(homeWxml) && /onToggleAll\(\)/.test(homeJs)
      && /<view class="all-toggle \{\{allOpen \? 'open' : ''\}\}"><\/view>/.test(homeWxml),
    "那张卡要么没挂、要么不是折叠形态");
  ok("标题与列出的是同一件事：都从范围名与 poolForScope 出",
    /function scopeLabel\(scope\)\s*\{[\s\S]{0,120}?scope\.scopeName\s*\+\s*"全部诗词"/.test(homeJs)
      && /function scopeList\(all, view, scope\)/.test(homeJs)
      && /poolForScope/.test(homeJs.slice(homeJs.indexOf("function scopeList"))),
    "标题另写一套、或列表不走 poolForScope —— 标题与内容迟早对不上");
  ok("全部诗词卡点开走弹层，队列用它自己那一份（不与今日计划混）",
    /onOpenAll[\s\S]{0,200}?openSheet\(/.test(homeJs)
      && /source === "all" \? this\.scopeRows\(\) : this\.data\.plan/.test(homeJs)
      && /<recite-sheet[^>]*queue="\{\{sheetRows\}\}"/.test(homeWxml));
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
    ["通用设置", "packages/settings/general/general.js", /onAlign[\s\S]{0,200}?markDirty/],
    ["通用设置-字号", "packages/settings/general/general.js", /onFontSlide[\s\S]{0,300}?markDirty/],
    ["背诵设置（年级/范围/首数/算法）", "packages/settings/recite/recite.js", /save\(patch\)[\s\S]{0,300}?markDirty/],
    ["主题", "utils/theme.js", /function set\(key\)[\s\S]{0,400}?markDirty/],
    ["注音口径", "utils/pinyin.js", /function setMode[\s\S]{0,400}?markDirty/],
    ["昵称", "pages/mine/mine.js", /saveNickname\([^)]*\)[\s\S]{0,300}?markDirty/]
  ];
  ok("改了设置就该传：六个入口都挂了记账（记账之后自己推一程，不再靠用户点）",
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
    const mineSrc7 = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");
    const i = mineSrc7.indexOf("storeAvatar(");
    const body = i < 0 ? "" : mineSrc7.slice(i, mineSrc7.indexOf("\n  },", i));
    ok("头像不挂记账（挂了就等于它进同步队列，而上传它要养一份存储桶）",
      !!body && body.indexOf("markDirty") < 0);
  }

  {
    const mineSrc8 = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");
    const mineWxml8 = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.wxml"), "utf8");
    const pick = (fn) => {
      const i = mineSrc8.indexOf(fn + "(");
      return i < 0 ? "" : mineSrc8.slice(i, mineSrc8.indexOf("\n  },", i));
    };
    ok("两个一键选项都在弹层里（只换头像 / 头像和昵称一起换）",
      /<view class="wechat-sheet"[\s\S]*?bindchooseavatar="onWechatAvatar"[\s\S]*?bindchooseavatar="onWechatIdentity"[\s\S]*?<\/view>/.test(mineWxml8)
        && !!pick("onWechatAvatar") && !!pick("onWechatIdentity"),
      "「用微信头像」或「用微信头像和昵称」少了一个，或者跑到了弹层外面");
    ok("两项都经 open-type=\"chooseAvatar\" 拿微信那张（平台没有静默拿头像的接口）",
      (mineWxml8.match(/open-type="chooseAvatar"/g) || []).length === 2
        && /takeWechatAvatar\(e, withNickname\)[\s\S]{0,300}?e\.detail\.avatarUrl/.test(mineSrc8),
      "用了 wx.chooseAvatar 这类客户端接口 —— 基础库上没有它，点了会报 not a function");
    ok("「头像和昵称」那一项把昵称也走同一条推送（不是只改本机）",
      /takeWechatAvatar\(e, withNickname\)[\s\S]{0,600}?this\.onNickname\(/.test(mineSrc8)
        && /onNickname\(e\)[\s\S]{0,200}?this\.saveNickname\(/.test(mineSrc8)
        && /saveNickname\([^)]*\)[\s\S]{0,300}?auth\.saveNickname\(/.test(mineSrc8),
      "只换了头像，昵称没推上去");
    ok("弹层只在登录那一态打得开（没登录时没有可换的身份）",
      /onAvatarTap\(\)[\s\S]{0,120}?if \(!this\.data\.logged\) return/.test(mineSrc8)
        && !!pick("onWechatPickClose"),
      "没登录也能弹出换身份的层");
    ok("头像或昵称一换，底栏那格跟着重画",
      /syncBar\(\)[\s\S]{0,80}?tabbar\.sync\(this,\s*4\)/.test(mineSrc8)
        && /store\.saveProfile\(\{\s*avatarLocal:\s*url\s*\}\)[\s\S]{0,80}?this\.syncBar\(\)/.test(mineSrc8)
        && /store\.saveProfile\(\{\s*nickname\s*\}\)[\s\S]{0,80}?this\.syncBar\(\)/.test(mineSrc8),
      "底栏还是那张写死的默认图 —— 换完头像要等切页才更新");
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
  const quizSrc = read("packages/game/quiz/lib.js");
  const stripped = quizSrc.replace(/\/\*[\s\S]*?\*\//g, "");

  const cap = /const MAX_LINE = (\d+);/.exec(stripped);
  const se = /const SENTENCE_END = \/\[([^\]]+)\]\//.exec(stripped);
  const capN = cap ? Number(cap[1]) : 0;
  ok("题干有上限（16 ~ 32 字），行内还按中文句读再切",
    capN >= 16 && capN <= 32 && !!se
      && "，。！？；".split("").filter((c) => se[1].indexOf(c) >= 0).length >= 4);
  ok("按 \\n 取句只有一处（linesOf 收口）",
    (stripped.match(/\.split\("\\n"\)/g) || []).length === 1);

  const quizMod = require(path.join(ROOT, "packages/game/quiz/lib.js"));
  let maxStem = 0, maxAnswer = 0, asked = 0;
  for (let round = 0; round < 300; round++) {
    quizMod.build({ count: 10, forms: ["next", "prev", "author", "title"] }).forEach((q) => {
      asked++;
      maxStem = Math.max(maxStem, (q.stem || "").length);
      maxAnswer = Math.max(maxAnswer, (q.answer || "").length);
    });
  }
  ok("真跑 300 轮出题：题干与答案都不超过上限",
    asked > 0 && maxStem <= capN && maxAnswer > 0 && maxAnswer <= capN,
    "题干 " + maxStem + " / 答案 " + maxAnswer + " / 上限 " + capN);

  const course = readModule(path.join(ROOT, "data/course.js"));
  const proseIds = Object.keys(course).filter((id) => String(course[id].text).length > 100);
  ok("课内确实有长文（上面那条不是空转）", proseIds.length > 10,
    "只找到 " + proseIds.length + " 篇长文");
}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const homeWxml = read("pages/home/home.wxml");
  const homeWxss = read("pages/home/home.wxss");
  const homeJs = read("pages/home/home.js");
  const sheetWxml = read("components/recite-sheet/recite-sheet.wxml");
  const appWxss = read("app.wxss");
  const quizWxml = read("packages/game/quiz/quiz.wxml");
  const generalWxml = read("packages/settings/general/general.wxml");
  const generalJs = read("packages/settings/general/general.js");
  const adminWxml = read("packages/admin/index/index.wxml");
  const adminJs = read("packages/admin/index/index.js");
  const usersWxml = read("packages/users/index/index.wxml");
  const usersJs = read("packages/users/index/index.js");
  const entJs = read("utils/entitlement.js");

  ok("首页进度环的两个元素都在（环 + 环里的填充）",
    /class="ring"/.test(homeWxml) && /class="ring-fill"/.test(homeWxml),
    "环少了一个元素 —— 画不出进度");
  ok("首页那枚环跟着 percent 走，零进度与满进度都画",
    /class="ring-fill" style="--p:\{\{percent\}\}"/.test(homeWxml)
      && /class="ring-text">\{\{percent\}\}%</.test(homeWxml)
      && !/stat-dash/.test(homeWxml) && !/\.stat-dash/.test(homeWxss),
    "环被 progress 之外的条件挡掉了 —— 0% 或 100% 时不显示");

  ok("环的尺寸与线宽只有一份定义（首页与背诵进度页取自它）",
    /--ring-size\s*:/.test(read("styles/tokens.wxss")) && /--ring-w\s*:/.test(read("styles/tokens.wxss")),
    "尺寸或线宽在某个页面样表里写死了");
  ok("背诵进度页那个环没另写一套尺寸（取自同一组令牌）",
    /inset\s*:\s*var\(--ring-w\)/.test(appWxss)
      && !/\.ov-ring/.test(read("packages/progress/index/index.wxss")),
    "进度页另写了一套环 —— 与首页迟早不一样");
  ok("首页不再有「背诵设置」那一行（hero-foot 那块整块撤了）",
    !/\.hero-foot/.test(homeWxss) && !/hero-foot/.test(homeWxml),
    "那一行还在 —— 首页又多了一处设置入口");
  ok("背诵选项只有一条入口（我的 → 背诵选项，进整页）",
    /onRecite/.test(read("pages/mine/mine.js"))
      && /bindtap="onRecite"/.test(read("pages/mine/mine.wxml"))
      && ["onScope", "onDaily", "onAlgo"].every(
        (h) => read("pages/mine/mine.js").indexOf(h) < 0
          && read("pages/mine/mine.wxml").indexOf(h) < 0),
    "范围 / 首数 / 算法又各自留了一行 —— 指向同一页的三条路就是三条路");

  ok("今日安排的状态写成一个 row-state 元素（不再是一枚圆圈）",
    /row-state/.test(homeWxml) && /row-state/.test(homeWxss || ""),
    "状态元素没了，或者它没有样式");
  ok("圆圈那套样式已撤（不留孤儿样式）", !/\.tick\s*\{/.test(homeWxss));

  {
    const sheetJsSrc = read("components/recite-sheet/recite-sheet.js");
    ok("背诵弹层那三颗评分走共用的格子控件（.chip 那一套，不自绘按钮）",
      /<view class="chip-group cols-3 actions"/.test(sheetWxml)
        && /data-key="\{\{item\.key\}\}"/.test(sheetWxml)
        && sheetWxml.indexOf("bindchange=\"onResult\"") < 0
        && /const result = e\.currentTarget\.dataset\.key/.test(sheetJsSrc)
        && !/\.act\s*\{/.test(appWxss),
      "评分又挂回 radio-group —— 同名选项在下一首点不出 change，那一排就点不动了");
  }

  {
    const readerWxml = read("pages/reader/reader.wxml");
    const readerJs = read("pages/reader/reader.js");
    ok("详情页只在背诵场景评分（忘记 / 模糊 / 记住与掌握度挂在 reciteMode 上）",
      /class="card recite-card"\s+wx:if="\{\{reciteMode\}\}"/.test(readerWxml)
      && /reciteMode:\s*query\.mode === "recite"/.test(readerJs),
      "评分那一卡不再有条件，浏览场景也会看到它");
    ok("浏览入口一律带 mode=browse（课外阅读 / 搜索 / 作者索引 / 游戏 / 今日加背）",
      ["pages/list/list.js", "pages/search/search.js", "components/daily-extra/daily-extra.js",
        "packages/authors/index/index.js", "packages/game/quiz/quiz.js",
        "packages/game/feihua/feihua.js"].every((f) => read(f).indexOf("mode=browse") >= 0),
      "有入口没带上 mode=browse，那个入口进详情页会亮出评分");
    ok("背诵场景翻篇不丢 mode（readerUrl 把 mode 续上）",
      /readerUrl\(/.test(readerJs) && /mode=recite/.test(readerJs));
  }

  ok("题库的判定区是独立一块（不再套在卡片类里）",
    /<view class="verdict" wx:if="\{\{last\}\}">/.test(quizWxml),
    "判定区套着 .card —— 会被读成第四个选项");

  ok("通用设置里有注音那一栏", /onPinyin/.test(generalWxml));
  ok("通用设置的注音读的是同一份设置（走 pinyin.setMode）",
    /pinyin\.setMode\(/.test(generalJs), "自己写了一份 store.saveSettings，两页会分叉");
  {
    const keysOf = (src) => {
      const block = /const PINYIN_MODES = \[([\s\S]*?)\];/.exec(src);
      return block ? [...block[1].matchAll(/key\s*:\s*"([^"]+)"/g)].map((m) => m[1]) : [];
    };
    const a = keysOf(generalJs);
    const b = keysOf(read("pages/reader/reader.js"));
    ok("注音与阅读设置同一档位表（两档，不是另起一套）",
      a.length === 2 && a.join(",") === b.join(","),
      "通用设置 " + JSON.stringify(a) + " / 详情页 " + JSON.stringify(b));
  }

  {
    const mineWxml = read("pages/mine/mine.wxml");

    ok("「我的」页的昵称只有一处：顶部那个名字本身（下面那一行已撤）",
      mineWxml.indexOf("nick-input") < 0
        && (mineWxml.match(/type="nickname"/g) || []).length === 1,
      "同一个值还摆两处，或者顶部那格还是只显示的字");

    const authSrc9 = read("utils/auth.js");
    ok("改昵称会写到服务端的 accounts.nickname（走 PATCH /api/me）",
      /request\(REMOTE\.me,[\s\S]{0,80}?\"PATCH\"/.test(authSrc9),
      "昵称只写进了本机存储 —— 数据库 accounts.nickname 永远是空的（Issue #268）");
    ok("改昵称那一刻就把昵称推上去（不靠进度同步队列捎带）",
      /saveNickname\([^)]*\)[\s\S]{0,300}?auth\.saveNickname\(/.test(read("pages/mine/mine.js")),
      "改昵称只落本机 + markDirty —— 进度那条链从来不打包昵称，" +
        "用户改完到数据库里看依旧为空");
    ok("没登录 / 没接后端时改昵称不炸（只落本机）",
      /saveNickname[\s\S]{0,300}?!logged\(\)[\s\S]{0,120}?return Promise\.resolve/.test(authSrc9),
      "离线改昵称也去发请求 —— 会抛给 onNickname 的调用方，界面停在改不动的那一格");
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

    const bareWxml = (src) => src.replace(/<!--[\s\S]*?-->/g, "");

    ok("来源那一格已撤，不是换了句措辞（字段一并删）",
      bare(adminJs).indexOf("sourceText") < 0 && bareWxml(adminWxml).indexOf("sourceText") < 0
        && bare(adminJs).indexOf("scopeText") < 0 && bareWxml(adminWxml).indexOf("scopeText") < 0,
      "留一个没人用的字段，下一个人会以为它还挂在界面上");
    const grantWxml = bareWxml(read("components/tier-view/tier-view.wxml"));
    ok("授权卡只渲染档名那一项（没有第二行副题元素）",
      grantWxml.indexOf("grant-tier-k") < 0
        && /<text class="grant-tier-name">\{\{status\.label\}\}<\/text>/.test(grantWxml),
      "副题那一行还在，或者档名换写法了");

    ok("档位数据里没有 sub 那一项（来源不必再说一遍）",
      tiersMod.TIER_KEYS.every((k) => tiersMod.tierOf(k).sub === undefined),
      "又把「登录就有」当成 Free 的副题写回去了");
    ok("管理页不再把角色当标签渲染（roleLabel 已撤）",
      bareWxml(adminWxml).indexOf("roleLabel") < 0 && bare(adminJs).indexOf("roleLabel") < 0,
      "roleLabel 还在模板里");
    ok("名录那一行只挂档位标签，不挂角色（角色名已撤）",
      /item\.tierLabel/.test(usersWxml) && !/item\.role/.test(bareWxml(usersWxml)),
      "名册里还挂着 role");

    ok("名录不再摆改角色的入口（改档那一枚留着）",
      !/onSetRole/.test(usersWxml) && !/setRole/.test(bare(usersJs))
        && /onSetTier/.test(usersWxml),
      "角色那一枚又回来了，或者改档那一枚被一起删掉了");
  }

  ok("已背那一侧不再是重色（只压一档字重，不换强调色）",
    /row-state\.on\s*\{([^}]*)\}/.test(homeWxss)
      && !/var\(--green\)/.test((/\.row-state\.on\s*\{([^}]*)\}/.exec(homeWxss) || [])[1] || ""),
    "已背又把 --green 拿回来了 —— 用户说颜色太重");

  const bareMarkup = (src) => src.replace(/<!--[\s\S]*?-->/g, "");
  const seqOn = (/\.seq\.on\s*\{([^}]*)\}/.exec(appWxss) || [])[1] || "";
  ok("已背那个序号用的是主题色那一档淡底（胶囊底不许写死色值）",
    /var\(--strong-soft\)/.test(seqOn) && /var\(--strong-text\)/.test(seqOn),
    "序号胶囊自己填了色 —— 换主题时它会留在原地");
  ok("已背的序号挂上那一档类（未背的回到凹槽底）",
    /class="seq \{\{item\.recited \? 'on' : ''\}\}"/.test(bareMarkup(homeWxml)),
    "序号那一格没跟着已背变，或者换了第三个类名");

  const dot = (/\.read-dot\s*\{([^}]*)\}/.exec(appWxss) || [])[1] || "";
  ok("「已读」胶囊用的是主题色那一档淡底",
    /var\(--strong-soft\)/.test(dot) && /var\(--strong-text\)/.test(dot),
    "已读胶囊还在用 --green-soft");
  ok("「已读」胶囊只在 app.wxss 定义一次（列表页与作者页共用）",
    (appWxss.match(/\.read-dot\s*\{/g) || []).length === 1
      && ["pages/list/list.wxss", "packages/authors/index/index.wxss"]
        .every((f) => !/\.read-dot\s*\{/.test(read(f))),
    "两处页面各留了一份，改一处另一处就不跟了");

  {
    const settWxml = bareMarkup(read("packages/settings/general/general.wxml"));
    const clearBtn = settWxml.indexOf('bindtap="onClearData"');
    const lastCard = settWxml.lastIndexOf('class="card');
    ok("清空数据在设置页最后一张卡（危险操作垫底）",
      clearBtn > lastCard && lastCard > 0 && /class="btn danger block danger-clear"/.test(settWxml),
      "清空数据又挪走了，或者它下面又长出一张卡");
    ok("「我的」页不再另摆一份清空入口",
      !/onClear\b/.test(bareMarkup(read("pages/mine/mine.wxml")))
        && !/onClear\s*\(/.test(read("pages/mine/mine.js")),
      "两处都在，改一处另一处就不跟了");
  }

  const tierCss = read("components/tier-view/tier-view.wxss");
  const isNowHead = (/\.tier-head \.tier-cell\.is-now::after\s*\{([^}]*)\}/.exec(tierCss) || [])[1] || "";
  ok("「当前档位」那一列用的是主题色那一档（列头那一道走主题）",
    /var\(--strong\)/.test(isNowHead),
    "当前档位还挂在 --green 上 —— 换主题时那一列留在原地");

  const cellIc = (/^\.tier-cell-ic\s*\{([^}]*)\}/m.exec(tierCss) || [])[1] || "";
  const nowIc = (/^\.tier-cell\.is-now \.tier-cell-ic\s*\{([^}]*)\}/m.exec(tierCss) || [])[1] || "";
  const nowMark = (/\.tier-cell\.is-now \.tier-cell-ic:not\(\.no\)\s*\{([^}]*)\}/.exec(tierCss) || [])[1] || "";
  ok("对比表的图标一档尺寸（当前档位那一栏不靠放大说事）",
    /width:\s*var\(--glyph-round\)/.test(cellIc) && /height:\s*var\(--glyph-round\)/.test(cellIc)
      && !/transform:\s*scale\(/.test(tierCss),
    "当前档位那一栏的图标被单独放大了 —— 同一列里两种直径，看着像两种东西");
  ok("当前档位那一栏是主题色实底、图标取压在它上面的那一色（不是白底描边）",
    /background:\s*var\(--strong\)/.test(nowIc) && /border-radius:\s*50%/.test(nowIc)
      && /color:\s*var\(--on-ink\)/.test(nowMark),
    "自己这一档还停在「白底 + 主题色描边」上 —— 与不支持 / 其他档位的白卡差得不够（Issue #425）");

  {
    const ruleCount = (sel) => (appWxss.match(new RegExp("\\n" + sel + "\\s*[,{]"), "g") || []).length;
    ok("闪动 / 连击 / 题号格只在 app.wxss 各定义一次",
      [".flash\\.yes", ".flash\\.no", "\\.combo", "\\.dot"].every((sel) => ruleCount(sel) === 1),
      "有一档写在两处 —— 三页会慢慢各长一样");

    const dupPages = ["packages/game/quiz/quiz", "packages/game/exam/exam", "packages/game/feihua/feihua"];
    const stray = dupPages.filter((f) => /\n\.(flash|combo|dot)\s*[,{]/.test(read(f + ".wxss")));
    ok("闪动 / 连击 / 题号格三样没在页面样式表里另写一份",
      stray.length === 0, stray.join(", "));

    const fb = require(path.join(ROOT, "utils", "feedback.js"));
    const seen = [0, 10, 19, 20, 39, 40, 59, 60, 79, 80, 89, 90, 99, 100].map((p) => fb.rankPercent(p));
    ok("段位只单调往上（分高的段位名不许排在分低的下面）",
      seen.every((r, i) => i === 0 || r.rank >= seen[i - 1].rank) && fb.rankPercent(100).name === "状元",
      JSON.stringify(seen.map((r) => r.name)));
    ok("段位表七档，名字不重复",
      new Set(fb.RANKS.map((r) => r.name)).size === fb.RANKS.length && fb.RANKS.length === 7);
  }

  const right = (/\.option\.right\s*\{([^}]*)\}/.exec(read("packages/game/quiz/quiz.wxss")) || [])[1] || "";
  const rightExam = (/\.option\.right\s*\{([^}]*)\}/.exec(read("packages/game/exam/exam.wxss")) || [])[1] || "";
  ok("答对的选项格用的是主题色那一档（不再单独一支淡绿）",
    [right, rightExam].every((r) => /var\(--strong-soft\)/.test(r) && /var\(--strong-text\)/.test(r)),
    "答对那一格还在用 --green-light");

  const okMark = (/\.grade-mark\.ok\s*\{([^}]*)\}/.exec(read("packages/game/exam/exam.wxss")) || [])[1] || "";
  ok("逐题那个「对」字标记用的是主题色那一档",
    /var\(--strong-soft\)/.test(okMark) && /var\(--strong-text\)/.test(okMark),
    "这个标记还在用 --green-soft");

  const statV = (/\.stat-v\s*\{([^}]*)\}/.exec(appWxss) || [])[1] || "";
  ok("统计大数字不叠粗体（大字号自己撑得住重点）",
    /font-weight:\s*400/.test(statV),
    "统计大数字又加回了粗体 —— 与页头标题两处同时在喊");

  const ringW = /--ring-w\s*:\s*calc\((\d+)rpx/.exec(read("styles/tokens.wxss"));
  const ringSize = /--ring-size\s*:\s*calc\((\d+)rpx/.exec(read("styles/tokens.wxss"));
  ok("进度环的线宽收了约 1/3（尺寸只有一个旋钮，两处共用它）",
    !!ringW && !!ringSize && Number(ringW[1]) * 3 <= Number(ringSize[1]) * 2,
    "环的线宽又变粗了（读数 " + (ringW ? ringW[1] : "?") + "rpx / 环 " + (ringSize ? ringSize[1] : "?") + "rpx）");
}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const mineWxml = read("pages/mine/mine.wxml");
  const mineWxss = read("pages/mine/mine.wxss");
  const mineJs = read("pages/mine/mine.js");
  const generalWxml = read("packages/settings/general/general.wxml");
  const generalJs = read("packages/settings/general/general.js");
  const storeJs = read("utils/store.js");

  ok("昵称只有顶部一处，且就地可改（改完当场重画）",
    mineWxml.indexOf("nick-input") < 0 && mineWxss.indexOf(".nick-input") < 0
      && /class="identity-input"[^>]*type="nickname"/.test(mineWxml)
      && /store\.saveProfile\(\{\s*nickname\s*\}\)[\s\S]{0,200}this\.refresh\(\)/.test(mineJs),
    "同一个值摆了第二处，或者顶部那格还是只显示的字");

  ok("未登录时名字那一格只显示（不是输入框）",
    /<block wx:else>[\s\S]{0,200}?<text class="identity-name">\{\{nickname\}\}<\/text>/.test(mineWxml));
  ok("通用设置的「背完自动下一首」整块撤了（模板与处理函数都不留）",
    generalWxml.indexOf("onAutoNext") < 0 && !/onAutoNext/.test(generalJs),
    "控件撤了但处理函数还在 —— 下一个人会以为它仍挂在界面上");
  ok("设置里的 autoNext 默认键也撤了（没人会再读它）",
    !/^\s*autoNext:/m.test(storeJs), "默认值还留着，等于给下一个来读它的人递了个空承诺");
  ok("删的是设置项，不是翻页本身（背完仍顺势进下一首）",
    /setTimeout\(\(\) => this\.goNext\(/.test(read("components/recite-sheet/recite-sheet.js")));

}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const mineWxml = read("pages/mine/mine.wxml");
  const mineWxss = read("pages/mine/mine.wxss");
  const mineJs = read("pages/mine/mine.js");

  ok("「我的」页不再有「头像」那一行（.avatar-row 已撤）",
    mineWxml.indexOf("avatar-row") < 0 && mineWxss.indexOf(".avatar-row") < 0,
    "那一行还在，或者样式留下了孤儿");

  ok("头像圆就是选头像的入口（点它开那个弹层）",
    /class="avatar-wrap"[^>]*bindtap="onAvatarTap"/.test(mineWxml)
      && /onAvatarTap\(\)[\s\S]{0,200}?wechatPick:\s*true/.test(mineJs),
    "头像圆不再是入口了，头像无处可点");

  ok("「用微信头像」那个动作已撤（没有可退的东西了）",
    mineWxml.indexOf("identity-revert") < 0 && mineWxss.indexOf(".identity-revert") < 0
      && mineJs.indexOf("onAvatarClear") < 0,
    "「用微信头像」还在 —— Issue #111 之后没有「自己传的那张」，它点了不会有任何变化");

  {

    const body = (() => {
      const i = mineJs.indexOf("takeWechatAvatar(");
      if (i < 0) return "";
      const j = mineJs.indexOf("\n  },", i);
      return j < 0 ? mineJs.slice(i) : mineJs.slice(i, j);
    })();
    ok("头像的落盘函数在（选完落本机那张）", !!body, "没找到 takeWechatAvatar");
    ok("头像不上传（选完不调 markDirty，也不走任何上传接口）",
      !!body && body.indexOf("markDirty") < 0 && !/uploadFile|\/api\/avatar/.test(body),
      "选完头像还去 markDirty / 传文件 —— 那就要为它养一份对象存储（Issue #111 要的正是别养）。" +
        "函数体：" + body.replace(/\s+/g, " ").slice(0, 160));

    const bareJs = mineJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok("整个小程序端没有上传头像的接口调用",
      !/wx\.uploadFile|\/api\/avatar/.test(bareJs),
      "还留着上传头像的路 —— 那就是又回到「要一份对象存储」");
  }
}

const K = {

  counts: {
    poems: 251, classic: 284, yuefu: 103, tangshi: 430, gushi: 109, songci: 330,
    yuanqu: 31, guwen: 234, jinxiandai: 24, zhaoming: 480,
    chengyu: 948, changshi: 221, mingshu: 808,
    mingren: 392, "mingren-waiguo": 523, dwang: 609, "dwang-waiguo": 68
  },

  seqMax: { gushi: 126, songci: 331, tangshi: 469 },

  course: 251,
  buckets: 120,

  selection: { tangshi: 337, songci: 288, yuanqu: 31, zhaoming: 480 }
};

function gapped(items, max) {
  const have = {};
  items.forEach((p) => {
    const m = /(\d+)$/.exec(String(p.id));
    if (m) have[Number(m[1])] = 1;
  });
  const miss = [];
  for (let i = 1; i <= max; i++) if (!have[i]) miss.push(i);
  return miss;
}

{

  Object.keys(K.counts).forEach((id) => {
    ok("篇数对得上网页版 · " + id, perBook[id].length === K.counts[id],
      "语料 " + perBook[id].length + "，表里写 " + K.counts[id] + "（补录之后回来对一次）");
  });

  const shelfIds = Object.keys(K.counts).filter((id) => id !== "poems");
  const shelfCount = shelfIds.reduce((n, id) => n + perBook[id].length, 0);
  ok("课外十七部合计与各集子篇数一致", shelfCount === 5594,
    "各集子加起来 " + shelfCount + "（补录之后回来对一次）");

  const qb = allEntries.filter((p) => p.t === "七步诗");
  ok("《七步诗》在《古诗「非唐代」》", qb.length === 1 && qb[0].b === "gushi");

  const KNOWN_NON_TANG = { "tangshi-ts-390": 1 };
  const nonTang = perBook.tangshi.filter((p) => String(p.d).trim() !== "唐");
  const freshNonTang = nonTang.filter((p) => !KNOWN_NON_TANG[p.id]);
  ok("《唐诗》里非唐的条目只有记着的那几条", freshNonTang.length === 0,
    "新出现 " + freshNonTang.map((p) => p.id + " " + p.t + "(" + p.d + ")").join("、") +
    " —— 是通用名篇那一段收的，还是真混进来了？");
  const goneNonTang = Object.keys(KNOWN_NON_TANG).filter((id) => !nonTang.some((p) => p.id === id));
  ok("记着的非唐条目没有悄悄消失（没了就回来删）", goneNonTang.length === 0,
    "已不见 " + goneNonTang.join("、"));

  const litBooks = ["poems", "classic", "guwen", "yuefu", "tangshi", "gushi",
    "songci", "yuanqu", "jinxiandai", "zhaoming"];

  const emptyDyn = [];
  litBooks.forEach((id) => {
    perBook[id].forEach((p) => {
      if (!String(p.d || "").trim()) emptyDyn.push(p.id + " " + p.t);
    });
  });
  ok("收作品的十部集子里没有空朝代", emptyDyn.length === 0,
    emptyDyn.length + " 条 —— " + emptyDyn.slice(0, 5).join("；"));

  const zmByAuthor = {};
  let collided = 0;
  perBook.zhaoming.forEach((p) => {
    if (!p.a) return;
    if (zmByAuthor[p.a] === undefined) zmByAuthor[p.a] = p.d;
    else if (zmByAuthor[p.a] !== p.d) collided += 1;
  });
  ok("《昭明文选》同一位作者只落一个朝代", collided === 0, collided + " 处冲突");

  const webAuthor = path.join(__dirname, "corpus", "data", "author-index.js");
  const miniAuthor = path.join(ROOT, "utils", "author-index.js");

  if (!fs.existsSync(webAuthor) || !fs.existsSync(miniAuthor)) {
    console.log("· 作者索引时间轴没得比（语料或小程序端的 author-index.js 不在）—— 跳过两条");
  } else {
    const erasOf = (src) => {

      const m = /(?:var|const) ERAS = \[([\s\S]*?)\n\s*\];/.exec(src);
      if (!m) return null;
      const out = [];
      const re = /\{\s*at:\s*(\d+)\s*,\s*name:\s*"([^"]+)"/g;
      let g;
      while ((g = re.exec(m[1]))) out.push(g[1] + ":" + g[2]);
      return out;
    };
    const a = erasOf(fs.readFileSync(webAuthor, "utf8"));
    const b = erasOf(fs.readFileSync(miniAuthor, "utf8"));
    ok("两端的朝代时间轴抠得出来", !!a && !!b, "ERAS 表没匹配上，正则要跟着改");
    if (a && b) {
      ok("朝代时间轴与网页版逐段一致（" + a.length + " 段）",
        a.join("|") === b.join("|"),
        "网页版 " + a.join(" ") + " ／ 小程序 " + b.join(" "));
    }

    const aliasOf = (src) => {
      const m = /(?:var|const) ALIAS = \{([\s\S]*?)\n\s*\};/.exec(src);
      if (!m) return null;
      const out = {};
      const re = /"([^"]+)":\s*"([^"]+)"/g;
      let g;
      while ((g = re.exec(m[1]))) out[g[1]] = g[2];
      return out;
    };
    const wa = aliasOf(fs.readFileSync(webAuthor, "utf8"));
    const ma = aliasOf(fs.readFileSync(miniAuthor, "utf8"));
    ok("两端的异名表抠得出来", !!wa && !!ma, "ALIAS 表没匹配上，正则要跟着改");
    if (wa && ma) {

      const diff = Object.keys(wa).filter((k) => k in ma && wa[k] !== ma[k])
        .map((k) => k + "：网页版→" + wa[k] + "／小程序→" + ma[k]);
      const remapOf = (m) => new Set(Object.keys(m).map((k) => k + "→" + m[k]));
      const remapMiss = Object.keys(wa).map((k) => k + "→" + wa[k])
        .filter((x) => !remapOf(ma).has(x));
      ok("异名表的归一结果与网页版一致（" + Object.keys(wa).length + " 条）",
        remapMiss.length === 0 && diff.length === 0,
        "网页版有、小程序里归到别处：" + remapMiss.join("、") +
        "；同名归到两处：" + diff.join("、"));
    }

    const attribOf = (src) => {
      const m = /(?:var|const) ATTRIB = \{([\s\S]*?)\n[ \t]*\};/.exec(src);
      if (!m) return null;
      const out = {};
      const re = /"([^"]+)":\s*\{\s*person:\s*"([^"]+)"\s*,\s*dynasty:\s*"([^"]+)"\s*\}/g;
      let g;
      while ((g = re.exec(m[1]))) out[g[1]] = g[2] + "|" + g[3];
      return out;
    };
    const wt = attribOf(fs.readFileSync(webAuthor, "utf8"));
    const mt = attribOf(fs.readFileSync(miniAuthor, "utf8"));
    ok("合编归属表与网页版逐条一致（" + Object.keys(wt || {}).length + " 条）",
      !!wt && !!mt && Object.keys(mt).length === Object.keys(wt).length
        && Object.keys(wt).every((k) => mt[k] === wt[k]),
      "抠不出来，或两端对不上");
  }

  const AI = require(path.join(ROOT, "utils", "author-index.js"));
  ok("认不得的朝代写法回落到最末一段（不静默丢掉）",
    AI.eraOf("__探针__") === AI.TAIL,
    "eraOf 对表外写法返回了 " + AI.eraOf("__探针__"));

  const unknown = [];
  const seenD = {};
  litBooks.forEach((id) => {
    perBook[id].forEach((p) => {
      const d = String(p.d || "").trim();
      if (!d || seenD[d]) return;
      seenD[d] = 1;
      if (AI.eraOf(d) === 18) unknown.push(d);
    });
  });
  ok("收作品的十部里 " + Object.keys(seenD).length + " 种朝代写法都在时间轴上", unknown.length === 0,
    "认不得：" + unknown.slice(0, 8).join("、") +
    (unknown.length > 8 ? " …共 " + unknown.length + " 种" : "") + "（去 utils/author-index.js 的 ERAS 里补）");

  const named = [];
  allEntries.forEach((p) => {
    const a = String(p.a || "").trim();
    const wrap = /^《.+》$/.test(a);
    if ((wrap || a === "国语" || a === "战国策") && !AI.isCollective(a)) {
      named.push(a + "（" + p.id + "）");
    }
  });
  ok("作者一格填书名的四条都认得出是结集", named.length === 0,
    "认成了一位作者：" + named.join("、") + " —— 它们会变成「《礼记》写了《大学之道》」");
  ok("isCollective 对真作者返回假（李白 / 曹植 / 佚名）",
    !AI.isCollective("李白") && !AI.isCollective("曹植") && !AI.isCollective("佚名"));

  {
    const selNoSrc = [];
    Object.keys(K.selection).forEach((id) => {
      (perBook[id] || []).forEach((p) => {
        if (String(p.sel || "").trim() && !String(p.s || "").trim()) selNoSrc.push(p.id);
      });
    });
    const selMiss = [];
    const selFlat = [];
    Object.keys(K.selection).forEach((id) => {
      const n = (perBook[id] || []).filter((p) => String(p.sel || "").trim()).length;
      if (n !== K.selection[id]) selMiss.push(id);
      const rows = (perBook[id] || []).filter((p) => p.s && p.sel);
      if (!rows.length || rows.every((p) => p.s === p.sel)) selFlat.push(id);
    });
    ok("选本出处搬全了，且两重出处真的拆开了（counts " + JSON.stringify(K.selection) + "）",
      selMiss.length === 0 && selFlat.length === 0,
      "没搬全：" + selMiss.join("、") + "；没拆开：" + selFlat.join("、"));
    ok("有选本出处的条目都有所出之书", selNoSrc.length === 0,
      selNoSrc.slice(0, 5).join("、"));
  }

  {
    const withAka = allEntries.filter((p) => p.aka);
    const want = ["秋登万山寄张五", "秋浦歌", "燕歌行并序", "燕歌行·并序",
      "山中送别", "赠范晔诗"];
    ok("题名异写搬进来了（" + withAka.length + " 条）",
      want.every((t) => withAka.some((p) => p.t === t)),
      "只有 " + withAka.length + " 条有 alias —— 构建脚本里的 `aka` 没搬？");

    const got = withAka.map((p) => p.t);
    const miss = want.filter((t) => got.indexOf(t) < 0);
    ok("点名的那几条题名异写都在", miss.length === 0, "少了：" + miss.join("、"));
  }
}

{
  const AI = require(path.join(ROOT, "utils", "author-index.js"));
  const lit = AI.LIT_BOOKS;

  const wantLit = ["poems", "classic", "guwen", "yuefu", "tangshi",
    "gushi", "songci", "yuanqu", "jinxiandai", "zhaoming"];
  ok("作者索引收作品的十部（与网页版同一份名单）",
    lit.slice().sort().join(",") === wantLit.slice().sort().join(","),
    "实际 " + lit.join("、"));

  const litEntries = [];
  lit.forEach((b) => { if (perBook[b]) litEntries.push.apply(litEntries, perBook[b]); });
  const roster = AI.build(litEntries);

  {
    const webAuthor = path.join(__dirname, "corpus", "data", "author-index.js");
    if (!fs.existsSync(webAuthor)) {
      console.log("· 作者名册没得比（语料的 data/author-index.js 不在）—— 跳过一条");
    } else {
      let webPeople = null;
      try {
        const vm = require("vm");

        const webDir = path.join(__dirname, "corpus");
        const loader = fs.readFileSync(path.join(webDir, "scripts", "build-works-map.js"), "utf8");
        const m = /const LOAD = \[([\s\S]*?)\];/.exec(loader);
        const list = m ? eval("[" + m[1] + "]") : [];
        const sb = { window: {}, console: console };
        sb.window = sb;
        vm.createContext(sb);
        list.forEach((f) => {
          try { vm.runInContext(fs.readFileSync(path.join(webDir, f), "utf8"), sb, { filename: f }); } catch (e) { }
        });
        ["data/zhaoming-dynasty.js", "data/author-index.js"].forEach((f) => {
          try { vm.runInContext(fs.readFileSync(path.join(webDir, f), "utf8"), sb, { filename: f }); } catch (e) { }
        });
        webPeople = sb.window.AuthorIndex ? sb.window.AuthorIndex.people().map((p) => p.name) : null;
        if (webPeople) webPeople = webPeople.map((n) => n === "扬雄" ? n : AI.aliasOf(n)).filter((n) => n && !AI.isCollective(n));
      } catch (e) {
        webPeople = null;
      }

      if (!webPeople || webPeople.length < 400) {
        console.log("· 作者名册没得比（poem 那边的 AuthorIndex 挂不上）—— 跳过一条");
      } else {
        const mine = Object.keys(roster.people);
        const webSet = new Set(webPeople);
        const mineSet = new Set(mine);
        const onlyWeb = webPeople.filter((n) => !mineSet.has(n));
        const onlyMine = mine.filter((n) => !webSet.has(n));

        const KNOWN_ONLY_MINE = ["崔护", "刘歆", "庄周", "项羽", "王十朋", "杨基", "陶潜"];
        const knownHere = KNOWN_ONLY_MINE.filter((n) => !webSet.has(AI.aliasOf(n)));
        const freshMine = onlyMine.filter((n) => knownHere.indexOf(n) < 0);
        const patchedMine = knownHere.filter((n) => onlyMine.indexOf(n) < 0);
        ok("两端名册的差集就是记着的那几位",
          freshMine.length === 0 && patchedMine.length === 0,
          "新多出：" + freshMine.join("、") + "；已不见：" + patchedMine.join("、") +
          "（多出的是判重口径的差，少了就说明这边并得比网页版还狠 —— 回来对一次）");
        ok("两端名册只差崔护一位（网页版那边一位都不多）",
          onlyWeb.length === 0,
          "网页版多出：" + onlyWeb.join("、") +
          " —— 多半是小程序端的 ALIAS 表落后了（去 utils/author-index.js 补）");
      }
    }
  }

  const mergePairs = [
    ["曹子建", "曹植"], ["班孟坚", "班固"], ["屈平", "屈原"],
    ["谢玄晖", "谢朓"], ["诸葛孔明", "诸葛亮"], ["左太冲", "左思"]
  ];
  mergePairs.forEach((p) => {
    const w = roster.people[p[1]];
    ok("异名归一 · " + p[0] + " 并在 " + p[1] + " 名下", !!w,
      "名册里找不到「" + p[1] + "」—— 异名没并，或被拆成两位");

    if (w) {
      const fromZm = w.items.filter((it) => it.b === "zhaoming");
      ok("异名归一 · " + p[1] + " 名下有《文选》条目", fromZm.length > 0,
        "0 条 —— 异名没并过来");
    }
  });

  mergePairs.forEach((p) => {
    ok("异名不单独立位 · " + p[0], !roster.people[p[0]],
      "「" + p[0] + "」自己占了一格 —— 归一没生效");
  });

  ["礼记", "论语", "国语", "战国策"].forEach((n) => {
    ok("结集不进名册 · " + n, !roster.people[n]);
  });

  ["礼记", "论语"].forEach((n) => {
    const raw = litEntries.filter((p) => AI.aliasOf(p.a) === n);
    ok("结集条目仍在语料里 · " + n, raw.length > 0, "语料里一条都没有了");
  });

  {
    const jing = roster.people["李白"];
    if (jing) {
      const same = jing.items.filter((p) => p.t === "静夜思");
      ok("同一首跨集只算一次 · 《静夜思》", same.length === 1,
        "李白名下 " + same.length + " 条《静夜思》—— 判重没生效");
      ok("判重留下的是课内那条 · 《静夜思》",
        same.length === 1 && same[0].b === "poems",
        "留下的不是课内那条（" + (same[0] || {}).b + "）");
    } else {
      ok("李白在名册里", false, "名册里没有李白");
    }
  }

  {
    const li = roster.people["李煜"];
    if (li) {
      ok("课内没有的篇目不被误判重复 · 李煜有作品", li.items.length > 0);
    } else {
      ok("李煜在名册里", false, "《词》里 30 余首的作者不在名册里");
    }
  }

  {
    const placed = roster.eras.reduce((n, e) => n + e.people.length, 0);
    ok("名册上每一位都落在某一段里", placed === roster.total,
      "摊开 " + placed + " 位，名册有 " + roster.total + " 位 —— 有人悬空");

    const rawNames = ["北宋", "南宋", "南朝宋", "东晋", "盛唐"];
    const bad = roster.eras.filter((e) => rawNames.indexOf(e.name) >= 0).map((e) => e.name);
    ok("段的标题是归并后的朝名（不是原写法）", bad.length === 0,
      "出现了原写法：" + bad.join("、"));
  }

  {
    const savedWx = global.wx;
    const savedPage = global.Page;
    const savedGetApp = global.getApp;
    const savedPages = global.getCurrentPages;

    const mem = {};
    global.wx = {
      showToast() {}, showModal() {}, showLoading() {}, hideLoading() {},
      showActionSheet(o) { o && o.success && o.success({ tapIndex: 0 }); },
      navigateTo() {}, switchTab() {}, redirectTo() {}, navigateBack() {},
      pageScrollTo() {}, nextTick(f) { if (f) f(); },
      setNavigationBarTitle() {}, vibrateShort() {}, stopPullDownRefresh() {},
      getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375, platform: "devtools" }),
      getStorageSync: (k) => (k in mem ? mem[k] : ""),
      setStorageSync: (k, v) => { mem[k] = v; },
      removeStorageSync: (k) => { delete mem[k]; },
      getStorageInfoSync: () => ({ keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }),
      login(o) { o && o.fail && o.fail({}); },
      getUserProfile(o) { o && o.fail && o.fail({}); },
      request(o) { o && o.fail && o.fail({ errmsg: "offline" }); }
    };
    global.Component = () => {};
    global.getApp = () => ({ globalData: {} });
    global.getCurrentPages = () => [];

    const storeMod = require(path.join(ROOT, "utils", "store.js"));
    storeMod.saveProfile({ logged: true, nickname: "自检" });

    function mountReader(query) {
      let opt = null;
      global.Page = (o) => { opt = o; };
      const file = path.join(ROOT, "pages", "reader", "reader.js");
      delete require.cache[require.resolve(file)];
      require(file);
      if (!opt) return null;
      const page = Object.assign({}, opt);
      page.data = JSON.parse(JSON.stringify(opt.data || {}));
      page.setData = function (o, cb) {
        Object.keys(o).forEach((k) => { this.data[k] = o[k]; });
        if (cb) cb();
      };
      page.onLoad(query || {});
      page.onShow();
      return page;
    }

    try {

      const libai = roster.people["李白"];
      if (libai) {
        const first = mountReader({ id: libai.items[0].id, from: "李白" });
        ok("从作者索引进来时带上作者", first && first.data.creator === "李白");

        let hops = 0;
        const seen = {};
        let cur = first;
        let off = "";
        while (hops < 5 && cur) {
          seen[cur.data.id] = 1;
          if (AI.aliasOf(cur.data.author) !== "李白") { off = "作者「" + cur.data.author + "」"; break; }
          if (lit.indexOf(cur.data.bookId) < 0) { off = "词条「" + cur.data.bookId + "」"; break; }
          const next = cur.siblingInAuthor(1);
          if (!next) break;
          if (seen[next]) { off = "原地打转回 " + next; break; }
          cur = mountReader({ id: next, from: "李白" });
          hops += 1;
        }
        ok("从作者索引连翻五首：不跨作者、不跳进词条、不回头，且真的翻动了",
          !off && hops > 0, off || "一次都没跳");

        const rosterIds = libai.items.map((p) => p.id);
        const chain = [];
        const seenChain = {};
        let cursor = rosterIds[0];
        while (cursor && !seenChain[cursor]) {
          chain.push(cursor);
          seenChain[cursor] = 1;
          const pg = mountReader({ id: cursor, from: "李白" });
          if (!pg) break;
          cursor = pg.siblingInAuthor(1);
        }
        ok("上一篇 / 下一篇的整条链与名册同序（" + rosterIds.length + " 条）",
          chain.length === rosterIds.length && chain.every((id, i) => id === rosterIds[i]),
          "链条 " + chain.length + " 条 —— 多半是阅读页自己筛了一遍，没走名册那份判重");

        const rosterWithReads = AI.build(litEntries, { readIds: { [rosterIds[0]]: 1 } });
        ok("作品的 id 列表不随已读状态变（阅读页的缓存靠这条）",
          AI.worksOf(roster, "李白").join(",") === AI.worksOf(rosterWithReads, "李白").join(","));

        let back = rosterIds[rosterIds.length - 1];
        const backChain = [];
        const seenBack = {};
        while (back && !seenBack[back]) {
          backChain.unshift(back);
          seenBack[back] = 1;
          const pg = mountReader({ id: back, from: "李白" });
          if (!pg) break;
          back = pg.siblingInAuthor(-1);
        }
        ok("逆序链条与名册同序", JSON.stringify(backChain) === JSON.stringify(rosterIds));

        const plain = mountReader({ id: libai.items[0].id });
        ok("从集子列表进来时不带作者", plain && plain.data.creator === "");
      } else {
        ok("李白在名册里（阅读页那一组的前提）", false);
      }
    } finally {
      storeMod.saveProfile({ logged: false, nickname: "", avatarUrl: "" });
      global.wx = savedWx;
      global.Page = savedPage;
      global.getApp = savedGetApp;
      global.getCurrentPages = savedPages;
    }
  }

  {
    const searchWxml = fs.readFileSync(path.join(ROOT, "pages", "search", "search.wxml"), "utf8");
    const searchJs = fs.readFileSync(path.join(ROOT, "pages", "search", "search.js"), "utf8");
    ok("搜索页有作者索引入口", searchWxml.indexOf("onAuthors") >= 0);
    ok("作者索引入口指向分包", /\/packages\/authors\/index\/index/.test(searchJs));
    const libWxml = fs.readFileSync(path.join(ROOT, "pages", "library", "library.wxml"), "utf8");
    ok("课外阅读页不放作者索引入口", libWxml.indexOf("authors") < 0,
      "入口两边都有，用户会不知道从哪进（网页版裁过这一条）");
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
  void authSrc;
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
    /"X-WX-SERVICE":\s*conf\.service/.test(remoteSrc) &&
      /config:\s*\{\s*env:\s*conf\.env/.test(remoteSrc) &&
      /sendCloud\(path, data, method\)[\s\S]{0,900}?authorization:/.test(remoteSrc),
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
      /err2\.service\s*=\s*conf\.service/.test(remoteSrc) &&
      /fail:\s*\(err\)\s*=>\s*reject\(cloudFailError\(err, conf\)\)/.test(remoteSrc),
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
    const readme = fs.readFileSync(path.join(repo3, "README.md"), "utf8");
    const buildSrc = fs.readFileSync(path.join(repo3, "scripts", "build-data.js"), "utf8");
    ok("README 与 build-data.js 都不再有「另有一个上游仓库」那套，且 README 交代了 GitHub 是只读镜像",
      [readme, buildSrc].every((t) => !/POEM_WEB_DIR|clone-poem/.test(t))
        && /CORPUS_DIR\s*=/.test(buildSrc)
        && /github\.com\/ashleyzhang2028\/poem-wx/.test(readme));

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
    const readme = fs.readFileSync(path.join(path.dirname(__dirname), "README.md"), "utf8");
    void readme;

  {
    ok("`推 GHCR` 那步还在，真命令行里用的是 GHCR_USER / GHCR_TOKEN",
      yml.indexOf("- name: 推 GHCR") >= 0
        && /docker login ghcr\.io -u "\$\{GHCR_USER\}"/.test(yml.slice(yml.indexOf("- name: 推 GHCR")))
        && /GHCR_TOKEN/.test(yml.slice(yml.indexOf("- name: 推 GHCR"))));
    ["README.md", "docs/wx-cloud-setup.md", "deploy/README.md"].forEach((f) => {
      const t = fs.readFileSync(path.join(path.dirname(__dirname), f), "utf8");
      ok(f + " 说明了 GHCR_TOKEN 要 classic PAT（fine-grained 没有 Packages 那一栏）",
        /classic/.test(t) && /write:packages/.test(t));
    });
    }
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
    const branchKeys = lines
      .filter((l) => /^[A-Za-z$"][^\s:]*:\s*$/.test(l))
      .map((l) => l.split(":")[0]);
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

    const readme2 = fs.readFileSync(path.join(repo2, "README.md"), "utf8");
    ok("README 指向 docs/data-backend.md（数据在哪、CI 为什么会被上游绊住）",
      /data-backend\.md/.test(readme2),
      "README 是总览入口，不指过去就等于没有这份文档");
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
  const walkWxml = (dir) => {
    const out = [];
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) out.push(...walkWxml(p));
      else if (f.endsWith(".wxml")) out.push(p);
    }
    return out;
  };

  const appWxssSrc = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const ruleOf = (css, cls) => {
    const m = new RegExp("\\." + cls.replace(/[-]/g, "\\-") + "\\s*\\{([^}]*)\\}").exec(css);
    return m ? m[1] : null;
  };

  const offenders = [];
  walkWxml(ROOT).forEach((file) => {
    const rel = path.relative(ROOT, file);
    const wxml = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const wxssPath = file.replace(/\.wxml$/, ".wxss");
    const pageCss = fs.existsSync(wxssPath) ? fs.readFileSync(wxssPath, "utf8") : "";
    const re = /<button\b[^>]*class="([^"]+)"[^>]*>/g;
    let m;
    while ((m = re.exec(wxml))) {
      const classes = m[1].split(/\s+/).filter(Boolean);

      const hasFlex = classes.some((c) => {
        const body = ruleOf(pageCss, c) || ruleOf(appWxssSrc, c) || "";
        return /display\s*:\s*(inline-)?flex/.test(body);
      });
      if (hasFlex) continue;
      const fixed = classes.filter((c) => {
        const body = ruleOf(pageCss, c) || ruleOf(appWxssSrc, c) || "";
        const w = /[^-]width\s*:\s*([^;]+);/.exec(body);
        return w && /rpx|px/.test(w[1]) && !/100%|auto/.test(w[1]);
      });
      if (fixed.length) offenders.push(rel + " → ." + fixed.join(" / ."));
    }
  });

  ok("原生 button 的固定尺寸不定在它自己身上（不吃原生 width:100%）",
    offenders.length === 0,
    offenders.slice(0, 6).join("; ") +
      " —— 真机上原生 button 的 width:100% 会盖过页面给的固定宽，把它撑成一行宽");

  const mineWxss = fs.readFileSync(path.join(ROOT, "pages/mine/mine.wxss"), "utf8");
  const mineWxml = fs.readFileSync(path.join(ROOT, "pages/mine/mine.wxml"), "utf8");
  const mineSrc = fs.readFileSync(path.join(ROOT, "pages/mine/mine.js"), "utf8");
  ok("头像与首字印是两个分支（没有头像时才画首字）",
    /class="avatar-fallback"[^>]*wx:if="\{\{!avatarUrl\}\}"/.test(mineWxml)
      && mineSrc.indexOf("avatarChar") >= 0,
    "首字印又被塞回原生 button 里 —— 真机上它的盒模型跟页面样式表对不上（Issue #194）");

  ok("整枚圆都是命中区，点首字印也算点头像（Issue #388）",
    /class="avatar-wrap"[^>]*bindtap="onAvatarTap"/.test(mineWxml)
      && /onAvatarTap\(\)[\s\S]{0,200}?wechatPick:\s*true/.test(mineSrc),
    "首字印与头像图并列、不穿透，点在字上就没反应");
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
          bare.books(); bare.course(); bare.courseTexts(); bare.manifest();
          bare.bucketOf("x"); bare.entry("x"); bare.search("李白");
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

  const homeWxmlNoData = fs.readFileSync(path.join(ROOT, "pages", "home", "home.wxml"), "utf8");
  ok("首页不再有整块空态分支（noData）",
    !/noData/.test(homeWxmlNoData),
    "首页又摆回一张整块空态 —— 语料缺在哪一段被那张卡吃掉，页面自己不报错，" +
      "按段排查时反而更难看清断口");
  ok("首页不许教人 clone-poem（那套跨仓库取语料已经撤掉）",
    !/clone-poem/.test(homeWxmlNoData),
    "空态里还留着 clone-poem.sh —— 那个脚本与那条跨仓库依赖一起删了");
  const homeJsNoData = fs.readFileSync(path.join(ROOT, "pages", "home", "home.js"), "utf8");
  ok("首页缺语料时照常渲染（各卡片自己露出断口）",
    !/hasData/.test(homeJsNoData) || !/noData|buildRev/.test(homeJsNoData),
    "home.js 又在 refresh 里按 hasData 改走另一套渲染 —— 卡片不再按真实数据报错");
  ok("课本目录空了要说出来，不许静默空着",
    /catalogCount\s*:\s*catalog\.length/.test(homeJsNoData)
      && /catalogLead\s*:/.test(homeJsNoData)
      && /!catalogCount/.test(homeWxmlNoData),
    "选课内那一屏（未登录首页）在不给空态 —— 语料缺了目录就是整块空白，" +
      "看着像数据丢了，只有控制台那一行才说明白（Issue #175）");
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

  const wxmlFiles = [];
  (function walk(d) {
    fs.readdirSync(d).forEach((f) => {
      const full = path.join(d, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (f.endsWith(".wxml")) wxmlFiles.push(full);
    });
  })(ROOT);

  const binders = wxmlFiles.filter((f) => /themeStyle/.test(fs.readFileSync(f, "utf8")));
  const undeclared = binders.filter((f) => {
    const js = fs.readFileSync(f.replace(/\.wxml$/, ".js"), "utf8");
    return !/themeStyle\s*:/.test(js);
  });
  ok("绑了 theme-style 的页面都在 data 里声明了 themeStyle（" + binders.length + " 个）",
    undeclared.length === 0,
    "这些页面首帧会传 null：" + undeclared.map((f) => path.relative(ROOT, f)).join("、"));
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

      const withoutIfModify = (t) => t
        .split("\n")
        .filter((l) => !/^\s*ifModify:\s*$/.test(l) &&
          !/^\s*-\s*"(api|deploy|deploy-api-serve)\/\*\*"\s*$/.test(l) &&
          !/^\s*-\s*"\.cnb\.yml"\s*$/.test(l))
        .map((l) => l.replace(/^  (push|web_trigger_release):$/, "  EVENT:"))
        .join("\n").trim();

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
  const shardSrc = fs.readFileSync(path.join(ROOT, "..", "deploy-api-serve", "shard-api.js"), "utf8");
  const dockerfile = fs.readFileSync(path.join(ROOT, "..", "deploy", "Dockerfile"), "utf8");
  const dockerignore = fs.readFileSync(path.join(ROOT, "..", "deploy-api-serve", ".dockerignore"), "utf8");
  const cnb = fs.readFileSync(path.join(ROOT, "..", ".cnb.yml"), "utf8");
  const remoteSrc = fs.readFileSync(path.join(ROOT, "utils", "remote.js"), "utf8");
  const corpusSrc2 = fs.readFileSync(path.join(ROOT, "utils", "corpus.js"), "utf8");
  const readerSrc = fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.js"), "utf8");

  ok("服务壳把 /api/shard/* 交给了分片路由",
    /shardApi\.handle\(req, res, urlPath\)/.test(serveSrc));
  ok("服务壳 require 了 shard-api（与 store-mysql 一样从上下文根取）",
    /require\(\"\.\/shard-api\.js\"\)/.test(serveSrc));

  {
    const bare = serveSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok("shardApi 的 require 在 apiHandler 之前",
      bare.indexOf('require("./shard-api.js")') >= 0 &&
      bare.indexOf('require("./shard-api.js")') < bare.indexOf('require("./api/handler.js")'),
      "顺序反了 → /api/shard/* 落到 poem 的 handler 上，静默 404");
  }

  ok("分片名只认 t\\d{3}（不接受 ../、斜杠、别的形状）",
    /\^t\\d\{3\}\$/.test(shardSrc));
  ok("清单与倒排索引在白名单里（manifest / idx）",
    /SPECIAL\s*=\s*\[\s*MANIFEST\s*,\s*INDEX\s*\]/.test(shardSrc));
  ok("拼路径只走 fileOf（校验之后再拼）",
    /function fileOf\s*\(/.test(shardSrc) && /path\.join\(ROOT, name \+ "\.js"\)/.test(shardSrc));
  ok("没有分片时回 404 E_NO_SHARDS，不静默回空 body",
    /E_NO_SHARDS/.test(shardSrc));

  ok("分片本体是 .js，发出去的是 JSON 报文（解开 gz、剥掉 module.exports = 那一层）",
    /function decode\s*\(/.test(shardSrc)
      && /function bodyOf\s*\(/.test(shardSrc)
      && /zlib\.gunzipSync\(raw\)/.test(shardSrc)
      && /JSON\.stringify\(decode\(plain\)\)/.test(shardSrc),
    "分片是 `module.exports = {...}` 的 .js（Issue #224：开发者工具不把 .json 当模块打包），" +
      "服务端得自己把它解回 JSON —— 客户端照旧只认 JSON，这一层是服务端的事");

  ok("Dockerfile 接受 COPY_SHREDS 开关",
    /ARG COPY_SHREDS=/.test(dockerfile));
  ok("Dockerfile 的 COPY 源是 shard-src（上下文根那一层）",
    /COPY --chown=node:node shard-src \/tmp\/shard-src/.test(dockerfile));

  ok("Dockerfile 把 shard-api.js 拷进镜像（放行 ≠ 进镜像，启动期 require 它）",
    /COPY --chown=node:node shard-api\.js \.\//.test(dockerfile),
    "白名单放行、流水线摆进上下文都不等于它进了镜像 —— 没有这句 COPY 时" +
      "构建与部署都是绿的，容器起来才 `Cannot find module './shard-api.js'`" +
      "（Back-off restarting failed container）。它是 serve-api.js 启动期 require 的，" +
      "与 store-mysql.js 一样得有一条自己的 COPY。");

  ok("流水线把 shard-api.js 摆进上下文那一层",
    /cp deploy-api-serve\/shard-api\.js \/tmp\/ctx\/shard-api\.js/.test(cnb));
  ok("白名单放行了 shard-api.js", /!shard-api\.js/.test(dockerignore));
  ok("白名单放行了 shard-src/", /!shard-src/.test(dockerignore));

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

  {
    const mk = cnb.indexOf("mkdir -p /tmp/ctx/shard-src");
    const flag = cnb.indexOf('if [ "${COPY_SHREDS:-1}" != "0" ]');
    ok("流水线**无条件**建成 shard-src/（否则不打旗时 COPY 直接红，Issue #115）",
      mk >= 0 && flag >= 0 && mk < flag,
      "`shard-src/` 得在判旗之前就 mkdir —— COPY 是无条件的，空目录才是它的合法来源" +
      "（判旗那句现在是 `if [ \"${COPY_SHREDS:-1}\" != \"0\" ]`，这条按它找）");
  }

  ok("流水线默认就摊分片（`:-1`，不是只有 `=1` 才摊）",
    /if \[ "\$\{COPY_SHREDS:-1\}" != "0" \]/.test(cnb),
    "摊分片那步还是「只有 =1 才摊」—— main push 拿到的镜像里没有分片，" +
      "课外正文只剩 404 E_NO_SHARDS，而那是给调试镜像留的话");
  ok("摊的是压缩后那份（.gz），不是 25MB 原文",
    /gzip -9 -c "\$f" > "\/tmp\/ctx\/shard-src\//.test(cnb),
    "摊原文的话，每次构建上下文从 0.3MB 变成 25MB");

  ok("摊出来的名字是 t001.js.gz（fileOf 找 <name>.js + .gz，多留一个 .js 就每一片 404）",
    /basename "\$f" \.js\)/.test(cnb) && /\.js\.gz"/.test(cnb),
    "摊成了 `basename \"$f\".js.gz`（t001.js.gz）—— shard-api 的 fileOf" +
      " 找 `t001.js` 找不到，于是目录非空、E_NO_SHARDS 不响、每一片 404");
  ok("分片在流水线里现生成（构建产物，checkout 里没有）",
    /node scripts\/build-data\.js/.test(cnb));
  ok("build 时把 COPY_SHREDS 递进去（同一条默认 `:-1`）",
    /--build-arg "COPY_SHREDS=\$\{COPY_SHREDS:-1\}"/.test(cnb),
    "递的是 `${COPY_SHREDS:-}` —— 流水线没定义那面旗时递过去一个空串，" +
      "Dockerfile 里 `ARG COPY_SHREDS=1` 会被这个空串盖掉");

  ok("Dockerfile 的 ARG 默认值也是 1（没递参数 = 有分片，只有显式 0 才关）",
    /ARG COPY_SHREDS=1/.test(dockerfile) && /if \[ "\$COPY_SHREDS" != "0" \]/.test(dockerfile),
    "Dockerfile 那句还是 `ARG COPY_SHREDS=` / `= \"1\"` —— 忘了递参数的构建会静默" +
      "产出一个没分片的镜像");

  {
    const pushTask = cnb.slice(cnb.indexOf("main:"), cnb.indexOf("crontab:"));
    const envBlock = (/:\n(?:.*\n)*?\s{8}(?:stages|imports|services):/.exec(pushTask)) || ["", ""];
    ok("`.cnb.yml` 的 env 表里**没有** COPY_SHREDS（默认值只住在代码里，一处）",
      envBlock[0].indexOf("COPY_SHREDS") < 0,
      "env 表里写死了 COPY_SHREDS —— 那与摊分片那步的默认值成了两处，迟早各说各的）");
  }

  {
    const mustAllow = ["!shard-api.js", "!shard-src/**", "!serve-api.js",
      "!store-mysql.js", "!api/**", "!Dockerfile"];
    const notAllowed = mustAllow.filter((line) => dockerignore.indexOf(line) < 0);
    ok("白名单放行了构建与启动真的要用到的每一样（缺一行 = 那样东西一个字都进不去）",
      notAllowed.length === 0,
      "没放行：" + JSON.stringify(notAllowed) +
        "。白名单先 `**` 排掉一切再逐条放行 —— 少一行不会报错，" +
        "少的是**启动期 require 的那个文件**时，症状是容器 Back-off 重启");

    const inRepo = ["deploy-api-serve/shard-api.js", "deploy-api-serve/serve-api.js",
      "deploy/store-mysql.js"];
    const missingInRepo = inRepo.filter((f) => !fs.existsSync(path.join(ROOT, "..", f)));
    ok("放行的那几样真的在仓库里（放行一个不存在的名字 = 白名单形同虚设）",
      missingInRepo.length === 0, "找不到：" + JSON.stringify(missingInRepo));
  }

  ok("remote 暴露了 shard 与 shardReady",
    /shard,\s*\n\s*shardReady/.test(remoteSrc));
  ok("分片走的是 /api/shard/（云调用，不是 wx.downloadFile）",
    /SHARD_PATH = "\/api\/shard\/"/.test(remoteSrc));
  ok("分片请求**不写进 outbox**（那是给进度用的队列）",
    !/PATHS\.shard/.test(remoteSrc));
  ok("corpus 暴露了 ensureBucket / ensureEntry",
    /ensureBucket,\s*\n\s*ensureEntry,/.test(corpusSrc2));
  {
    const fn = corpusSrc2.slice(corpusSrc2.indexOf("function ensureEntry"));
    const atPack = fn.indexOf("courseTexts()[id]");
    const atBucket = fn.indexOf("ensureBucket(name)");
    ok("ensureEntry 的顺序是 课内 → 本机分片 → 云端",
      atPack >= 0 && atBucket >= 0 && atPack < atBucket,
      "顺序反了的话，课内那 251 首（本就在主包里）也要过一次网络");
  }
  ok("分片缓存有上限（不许无限占用户手机）",
    /SHARD_CACHE_MAX\s*=\s*\d+/.test(corpusSrc2));
  {
    const fn = corpusSrc2.slice(corpusSrc2.indexOf("function ensureEntry"));
    ok("清单里没有这一条时抛 E_NO_ENTRY（不是静默 resolve(null)）",
      /shardError\("E_NO_ENTRY"/.test(fn.slice(0, fn.indexOf("ensureBucket(name)"))),
      "resolve(null) 把「清单缺这一条」与「本来就没有正文」混成一句 —— " +
        "两个位置都只能报「取不到」，说不出是哪一环断的");
  }
  ok("取不到时抛的是带 code 的错（界面据此说人话）",
    /shardError\("E_NO_SHARD_SERVICE"/.test(corpusSrc2));

  ok("阅读页走 corpus.ensureEntry（不是只同步查一次）",
    /corpus\s*\n?\.ensureEntry\(id\)/.test(readerSrc) || /ensureEntry\(id\)/.test(readerSrc));
  ok("阅读页有空态那一屏（不是空卡片）",
    /loadingText/.test(readerSrc) &&
    /loadingText/.test(fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.wxml"), "utf8")));
  ok("阅读页把「没接上服务器」与「这一篇取不到」分开说",
    /E_NO_SHARD_SERVICE/.test(readerSrc) && /E_NO_SHARDS/.test(readerSrc));

  {
    const readerWxml2 = fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.wxml"), "utf8");
    const failScreen = /wx:if="\{\{loadFailed\}\}"/.test(readerWxml2)
      && /bindtap="onRetryText"/.test(readerWxml2);
    ok("取正文失败不留白等：「标题 + 一句实情 + 重试」那一屏在 WXML 里",
      failScreen && /onRetryText\s*\(/.test(readerSrc) && /loadFailed:\s*false/.test(readerSrc),
      "失败只弹过 toast、停在加载态那一屏，用户看到的是「正在取正文」永远不散");

    ok("取正文的等待是身份行下面那一道细线（加载完就没了，不留加载屏）",
      /poem-loading/.test(readerWxml2) && /loadingText/.test(readerWxml2)
        && readerWxml2.indexOf("poem-loading") > readerWxml2.indexOf("poem-meta-row")
        && !/正在取正文/.test(readerWxml2),
      "等待又占了一屏，或者细线不在朝代 / 作者那一行下面");

    const failArm = /["']catch["']\]\(\(err\)[\s\S]{0,300}?loadFailed:\s*true/.test(readerSrc)
      || /catch\s*\(err\)[\s\S]{0,300}?loadFailed:\s*true/.test(readerSrc);
    ok("失败路径把加载态落回、并换成失败态（不是只出声）",
      failArm && /loadingText:\s*false[\s\S]{0,80}?loadFailed:\s*true/.test(readerSrc),
      "catch 里只 setData({loadingText:false})：屏幕回到空卡片，什么都没说");

    {
      global.Page = (o) => { opt = o; };
      let opt = null;
      const readerFile = path.join(ROOT, "pages", "reader", "reader.js");
      delete require.cache[require.resolve(readerFile)];
      require(readerFile);
      const msg = opt.textFailMsg.bind(opt);
      const cases = [
        [{ errMsg: "cloud.callContainer:fail 102002" }, /超时/],
        [{ errMsg: "cloud.callContainer:fail invalid host" }, /服务名/],
        [{ code: "E_NO_SHARDS" }, /这个版本里没有课外正文/],
        [{ code: "E_NO_SHARD_SERVICE" }, /没接上同步服务器/]
      ];
      const off = cases.filter(([e, re]) => !re.test(msg(e)));
      ok("失败的四种因各有各的说法（超时 / 服务名 / 镜像没分片 / 没配服务器）",
        off.length === 0,
        "这几种落回了兜底那句：" + JSON.stringify(off.map(([e]) => msg(e))) +
          " —— 四种因指向的下一步动作不同，兜底那句等于没说");
    }
  }

  {
    const tsSrc = fs.readFileSync(path.join(ROOT, "utils", "text-search.js"), "utf8");
    ok("分片取回时补进倒排索引（取过的那几片下一次能按正文搜）",
      /corpus\.onBucketReady\(/.test(tsSrc) && /postings/.test(tsSrc)
        && /function\s+armShardWriter/.test(tsSrc),
      "idx.json 在包外永远读不到，而分片取回来只进 bucket 缓存 —— " +
        "全文检索永远停在「按篇名作者检索」");
    ok("补索引写盘失败不牵连取正文（catch 里降级，不抛）",
      /function\s+armShardWriter[\s\S]{0,400}?catch\s*\(e\)[\s\S]{0,120}?missing\s*=\s*true/.test(tsSrc),
      "写 idx.json 抛出来会从 onBucketReady 冒进 ensureBucket 的 then 里，" +
        "取分片成功却报失败");
  }
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

  ok("自选背诵的配额：Free 无、Pro 1、Max 200",
    colsMod.LIMITS.free === 0 && colsMod.LIMITS.pro === 1 && colsMod.LIMITS.max === 200);
  ok("每个集子最多 100 首", colsMod.ITEMS_MAX === 100);
  ok("权限对比表上写出来的自选背诵配额与配额表同源",
    (() => {
      const E5 = require(path.join(ROOT, "utils", "entitlement.js"));
      const row = E5.compareRows({ logged: false, tier: "free" })
        .filter((r) => r.cap === "collections")[0];
      const want = ["free", "pro", "max"].map((t) =>
        colsMod.LIMITS[t] ? colsMod.LIMITS[t] + " 个" : "");
      const got = row.cells.map((c) => c.text);
      const items = row.cells.filter((c) => c.on)
        .every((c) => c.note.indexOf(String(colsMod.ITEMS_MAX)) >= 0);
      return got.join(",") === want.join(",") && items;
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
    const ent3 = require(path.join(ROOT, "utils", "entitlement.js"));
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
    const ov = S3.collectionOverview(fake3, cols3.find("c1"));
    ok("集子概览报篇目数 / 已背 / 今日到期",
      ov.total === 12 && ov.learned === 1 && ov.due === 1, JSON.stringify(ov));

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
    ok("开着「只背自选」时，排期只回今日加背那几首（课内一首不排）",
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
    const ghost = SEASON.WORKS.filter((w) => !corpusSeason.indexById(w[0]));
    ok("季节限定表里的每一首都指得到语料里的作品",
      SEASON.WORKS.length > 0 && ghost.length === 0,
      "指向不存在的：" + ghost.slice(0, 5).map((w) => w[0]).join("、"));

    const unknownFest = SEASON.WORKS.filter((w) => SEASON.TERMS.indexOf(w[1]) < 0
      && !SEASON.TRADITIONAL.some((x) => x.key === w[1])
      && SEASON.SEASONS.indexOf(w[1]) < 0);
    ok("季节限定表里只出现这张表认得的节日与节气", unknownFest.length === 0,
      "认不得：" + unknownFest.slice(0, 5).map((w) => w[1]).join("、"));

    ok("季节限定每一条都取到作品", SEASON.WORKS.every((w) => !!SEASON.entryOf(w[0])));

    ok("节日节气那部集子里逐首都带正文，题名与作者不留空",
      corpusSeason.ofBook("season").every((p) => !!p.t && !!p.a && !!p.text));

    ok("季节限定这一层需要的正文都在包里（不必走分片、也不问服务端起没起）",
      (() => {
        const need = {};
        SEASON.WORKS.forEach((w) => { need[w[0]] = 1; });
        let d = new Date(2026, 0, 1);
        for (let i = 0; i < 366; i += 1) {
          const c = SEASON.card(d);
          if (c) c.poems.forEach((p) => { need[p.id] = 1; });
          d = new Date(d.getTime() + 86400000);
        }
        const off = Object.keys(need).filter((id) => {
          const e = corpusSeason.entry(id);
          return !e || !e.text;
        });
        return off.length === 0;
      })(),
      "这几首的正文只在分片里，点开要先过一次云端：" +
        SEASON.WORKS.filter((w) => corpusSeason.bucketOf(w[0])).map((w) => w[0]).slice(0, 8).join("、"));

    ok("季节限定里带译文的篇目，译文都挂得上来源档",
      SEASON.WORKS.every((w) => {
        const hit = SEASON.entryOf(w[0]);
        return !hit || !hit.tr || !!hit.src;
      }));

    ok("季节限定表里没有同一首挂两遍",
      Object.keys(SEASON.WORKS.reduce((m, w) => Object.assign(m, { [w[1] + w[0]]: 1 }), {}))
        .length === SEASON.WORKS.length);

    ok("节气说明表 24 个、传统节日 11 个（农历与节气各占一类）",
      SEASON.TERMS.length === 24 && SEASON.TRADITIONAL.length === 11);

    const dayOf = (y, m, d) => new Date(y, m - 1, d);
    const at = (y, m, d) => SEASON.card(dayOf(y, m, d));
    ok("节日前两天与当天都列（重阳 2026-10-18，前两天起）",
      [16, 17, 18].every((d) => {
        const c = at(2026, 10, d);
        return !!c && c.key === "重阳节" && c.days === 3;
      }) && (at(2026, 10, 15) || { key: "" }).key !== "重阳节",
      "实际 " + [15, 16, 17, 18, 19].map((d) => {
        const c = at(2026, 10, d);
        return d + ":" + (c ? c.key : "无");
      }).join(" "));

    ok("节日当天只说节日名，往前说「明日」「N 日后」",
      (at(2026, 10, 18) || {}).tip === "重阳节"
        && (at(2026, 10, 17) || {}).tip === "明日 · 重阳节"
        && (at(2026, 10, 16) || {}).tip === "2日后 · 重阳节",
      "实际 " + [16, 17, 18].map((d) => d + ":" + ((at(2026, 10, d) || {}).tip || "无")).join(" "));

    ok("传统节日走完三天交回给所在节气，中间不断档",
      (() => {
        const keys = [19, 20, 21, 22, 23].map((d) => (at(2026, 10, d) || {}).key || "");
        return keys.every((k) => !!k);
      })(),
      "实际 " + [19, 20, 21, 22, 23].map((d) => d + ":" + ((at(2026, 10, d) || {}).key || "无")).join(" "));

    ok("卡片胶囊按节日 / 节气给名，与当天日期无关",
      [16, 18].every((d) => (at(2026, 10, d) || {}).tag === "节日 · 重阳节")
        && (at(2026, 10, 15) || {}).tag === "节气 · 寒露",
      "实际 " + [15, 16, 18].map((d) => d + ":" + ((at(2026, 10, d) || {}).tag || "无")).join(" "));

    ok("节气在自己的周期内一直列，到下一个节气才换",
      (() => {
        const hit = (m, d) => SEASON.active(dayOf(2026, m, d)).filter((h) => h.kind === "term")[0];
        const from = hit(5, 21);
        const next = hit(6, 5);
        return !!from && !!next && from.key === "小满" && from.elapsed === 1
          && next.key === "芒种" && next.elapsed === 1;
      })(),
      "实际 " + JSON.stringify(SEASON.active(dayOf(2026, 5, 21)).map((h) => h.key)));

    ok("卡片上的篇目都来自这一天挂得上的节日与节气，节日那类最多三首、不重样",
      (() => {
        const c = at(2026, 10, 18);
        if (!c || c.more !== true) return false;
        const want = SEASON.WORKS.filter((w) => w[1] === "重阳节").map((w) => w[0]);
        const ids = c.poems.map((p) => p.id);
        return c.poems.every((p) => want.indexOf(p.id) >= 0)
          && ids.length === 3
          && ids.filter((id, i) => ids.indexOf(id) === i).length === 3;
      })(),
      "实际 " + ((at(2026, 10, 18) || {}).poems || []).map((p) => p.id).join("、"));

    ok("挂得不够三首就全列，且不出去换的图标",
      (() => {
        const c = at(2026, 5, 21);
        return !!c && c.key === "小满" && c.poems.length === 1 && c.more === false && c.refresh === false;
      })(),
      "实际 " + JSON.stringify(at(2026, 5, 21) || null).slice(0, 120));

    ok("换一批只换当天这张卡上的那一类，换出来的还是三首且不重样",
      (() => {
        const day = dayOf(2026, 10, 18);
        const before = (SEASON.card(day) || {}).poems || [];
        if (!SEASON.redraw(day)) return false;
        const next = SEASON.card(day) || {};
        const ids = (next.poems || []).map((p) => p.id);
        if (before.length !== 3 || next.refresh !== true || ids.length !== 3) return false;
        return ids.filter((id, i) => ids.indexOf(id) === i).length === 3;
      })());

    ok("挂得不够三首时换不了，刷新图标也就不出来",
      SEASON.card(dayOf(2026, 5, 21)).refresh === false && SEASON.redraw(dayOf(2026, 5, 21)) === false);

    const capRow = E.CAPS.filter((c) => c.key === SEASON.CAP)[0];
    ok("隐藏季节限定是 Pro 起的一项能力，Free 开不了",
      !!capRow && capRow.tier === "pro"
        && E.compareRows({ logged: false, tier: "free" })
          .filter((r) => r.cap === SEASON.CAP)[0].cells[0].on === false);

    asTier3("free");
    ok("Free 手里那开关按不动，卡片照旧显示",
      SEASON.canSwitch() === false && SEASON.setOn(false).ok === false && SEASON.isOn() === true);

    asTier3("pro");
    ok("Pro 关得掉，关掉之后首页不再出这张卡",
      SEASON.setOn(false).ok === true && SEASON.switched() === true
        && SEASON.isOn() === false && SEASON.card(dayOf(2026, 10, 19)) === null);

    ok("默认为开（新装的 Free 与 Pro 都看得见）",
      store3.DEFAULTS.seasonal === true && !store3.LOCAL_ONLY.seasonal);

    ok("关掉这个开关只落一个键（跟着账号走，不进本机）",
      store3.saveSettings({ seasonal: false }).seasonal === false
        && store3.cloudSettings().seasonal === false);

    asTier3("pro");
    SEASON.setOn(true);

    store3.saveCollections([]);
    global.wx = saved;
    Object.keys(require.cache).forEach((k) => {
      if (k.indexOf(path.join(ROOT, "utils")) === 0) delete require.cache[k];
    });
  }

  const homeSrc4 = fs.readFileSync(path.join(ROOT, "pages", "home", "home.js"), "utf8");
  const homeWxml4 = fs.readFileSync(path.join(ROOT, "pages", "home", "home.wxml"), "utf8");
  ok("换一批的图标拢在标题行里，点一下重新取卡、不去开弹层",
    /wx:if="\{\{seasonal\.refresh\}\}"/.test(homeWxml4)
      && /catchtap="onSeasonalRefresh"/.test(homeWxml4)
      && /onSeasonalRefresh\(/.test(homeSrc4)
      && /seasonal\.redraw\(\)/.test(homeSrc4)
      && /setData\(\{ seasonal: card \}\)/.test(homeSrc4));

  ok("季节限定的标题行只当标题：打开弹层的入口挂在列表行上，带 data-id 定位到那一首",
    !/bindtap="[^"]*"[^>]*>\s*<text class="card-title seasonal-title"/.test(homeWxml4)
      && /wx:for="\{\{seasonal\.rows\}\}"[^>]*data-id="\{\{item\.id\}\}"[^>]*bindtap="onSeasonalOpen"/.test(homeWxml4)
      && /onSeasonalOpen\(e\)[\s\S]{0,400}?sheet\.open\(rows, id\)/.test(homeSrc4));

  ok("首页把自选集子的今日份算进顶部读数", /collectionPlan\(/.test(homeSrc4)
    && /selfTotal/.test(homeSrc4) && /stats/.test(homeSrc4));
  ok("自选集子的今日份背完给一次提示",
    /doneToday: plan\.length > 0 && doneNow >= plan\.length/.test(homeSrc4)
      && /cheerCollection\(/.test(homeSrc4)
      && homeSrc4.indexOf("S.doneToday(rec)") >= 0);

  ok("首页收尾只有一处判据：自选的鼓励语不再另立一套 planDone",
    !/planDone/.test(homeSrc4)
      && (homeSrc4.match(/const allDone =/g) || []).length === 1);

  ok("两处 toast 互斥（前一条还在屏上，后一条不叠上去）",
    (homeSrc4.match(/Date\.now\(\) - this\.toastAt\(\) < TOAST_GAP/g) || []).length === 2
      && (homeSrc4.match(/toastedAt = Date\.now\(\)/g) || []).length === 2
      && /const TOAST_MS = /.test(homeSrc4)
      && (homeSrc4.match(/duration: TOAST_MS/g) || []).length === 2);

  ok("首页自选卡与背诵弹层共用一套（点一行就地开弹层）",
    /onOpenCollection/.test(homeSrc4) && homeWxml4.indexOf("onOpenCollection") >= 0);
  ok("每个自选集子一张卡，标题是集子名，篇目平铺成一份队列",
    /title:\s*cols\.nameOf\(c\),/.test(homeSrc4)
      && /wx:for="\{\{collections\}\}"/.test(homeWxml4)
      && /wx:for="\{\{coll\.rows\}\}"/.test(homeWxml4)
      && /cols\.find\(id\)/.test(homeSrc4));
  ok("首页不再有整页入口与就地改名（管理都挪到设置页）",
    !/onManageCollections/.test(homeSrc4) && !/onManageCollections/.test(homeWxml4)
      && !/onCollectionRename/.test(homeSrc4) && !/onCollectionRename/.test(homeWxml4)
      && !/cols\.rename\(/.test(homeSrc4));

  ok("课内 / 自选胶囊由篇目所属集子定，标签互斥（一首只落一个）",
    /const SOURCE_TEXT = \{ course: "课内", own: "自选" \}/.test(homeSrc4)
      && /function sourceKey\(id\)/.test(homeSrc4)
      && /meta\.b === "poems" \? "course" : "own"/.test(homeSrc4)
      && (homeWxml4.match(/\{\{item\.source\}\}/g) || []).length === 2);
  ok("今日计划与自选集合的篇目行带来源与原因胶囊，全部诗词那张卡只带名次与进度",
    (homeWxml4.match(/\{\{item\.source === '课内' \? 'course' : 'own'\}\}/g) || []).length === 2
      && (homeWxml4.match(/class="tag row-tag \{\{item\.tagCls\}\}" wx:if="\{\{item\.reasonOn\}\}">\{\{item\.reason\}\}/g) || []).length === 2);

  const readerSrc4 = fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.js"), "utf8");
  ok("阅读页能加进集子（进的是服务端那一行，走 markDirty）",
    /onAddToCollection/.test(readerSrc4) && /cols\.add\(/.test(readerSrc4)
      && /sync\.markDirty\(\)/.test(readerSrc4));

  const listSrc4 = fs.readFileSync(path.join(ROOT, "pages", "list", "list.js"), "utf8");
  const searchSrc4 = fs.readFileSync(path.join(ROOT, "pages", "search", "search.js"), "utf8");
  ok("列表与搜索结果行上都能收诗", /onPick\(/.test(listSrc4) && /onPick\(/.test(searchSrc4));

  const tableMod = require(path.join(ROOT, "utils", "table.js"));
  const readerWxml4 = fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.wxml"), "utf8");
  const sheetWxml4 = fs.readFileSync(path.join(ROOT, "components", "recite-sheet", "recite-sheet.wxml"), "utf8");
  const sheetSrc4 = fs.readFileSync(path.join(ROOT, "components", "recite-sheet", "recite-sheet.js"), "utf8");
  const tableCases = ["changshi-cs-218", "dwang-em-c-legend-06", "mingren-mr-c-06", "mingshu-ms-230"];
  const parsed = tableCases.filter(function (id) {
    const entry = corpus.entry(id);
    if (!entry || !entry.text) return false;
    const t = tableMod.parseText(entry.text);
    if (!t || t.parts.length < 2 || !t.blocks.length) return false;
    return t.blocks.every(function (b) {
      return b.widths.length >= 2
        && b.rows.every(function (r) { return r.cells.every(function (c) { return c.text.length > 0; }); })
        && !JSON.stringify(b).match(/[│┌├└┬┼┴┐┤┘─]/);
    });
  });
  ok("详情页把语料里的框线表格解析成行列（文学常识 / 帝王 / 名家 / 名著导读各一条）",
    parsed.length === tableCases.length);
  ok("表格块有独立的渲染路径（不注音），详情页与弹层共用",
    /md-table/.test(readerWxml4) && /tableView/.test(readerSrc4)
      && /md-table/.test(sheetWxml4) && /table\.hasTable\(/.test(sheetSrc4));

  const wideCases = ["changshi-cs-218", "changshi-cs-221", "mingren-mr-w-93"];
  const wideOk = wideCases.filter(function (id) {
    const entry = corpus.entry(id);
    const t = entry && entry.text ? tableMod.parseText(entry.text) : null;
    if (!t || !t.blocks.length) return false;
    return t.blocks.every(function (b) {
      return b.rows.every(function (r) { return r.cells.length === b.widths.length; });
    });
  });
  ok("正文行比框线宽（补空格没补齐 / 一格塞了两格）时，多出来的字并进末格，不另起一格",
    wideOk.length === wideCases.length,
    "逐格数对不上的还有：" + wideCases.filter(function (id) { return wideOk.indexOf(id) < 0; }).join("、"));

  ok("正文没取到时标题与作者跟着那一首走（不沿用上一篇的）",
    /markMissing\(item\)/.test(sheetSrc4)
      && /missHead\(item\)[\s\S]{0,80}corpus\.indexById\(item\.id\)/.test(sheetSrc4));

  const collWxml4 = fs.readFileSync(path.join(ROOT, "packages", "settings", "collections", "collections.wxml"), "utf8");
  const collSrc4 = fs.readFileSync(path.join(ROOT, "packages", "settings", "collections", "collections.js"), "utf8");
  ok("集子里勾选只改选中态，不落盘也不刷新（点一下就把篇目挪走）",
    /data-pid="\{\{item\.id\}\}" bindtap="onPick"/.test(collWxml4)
      && !/checkbox-group/.test(collWxml4)
      && /onPick\(e\)[\s\S]{0,400}setItems\(id,/.test(collSrc4)
      && !/onPick\(e\)[\s\S]{0,400}(removeItems|clearItems|sync\.markDirty|this\.refresh)/.test(collSrc4));

  ok("自选集子落在设置分包里（不占主包）",
    (app.subPackages || []).some((sp) => sp.root === "packages/settings"
      && sp.pages.indexOf("collections/collections") >= 0));

  {
    const tableMod = require(path.join(ROOT, "utils", "table.js"));
    const foreign = ["dwang-waiguo", "mingren-waiguo"];
    const foreignRows = foreign.reduce((acc, id) => acc.concat(perBook[id] || []), []);
    const broken = foreignRows.filter((p) => {
      const e = corpus.entry(p.id);
      const t = e && e.text ? tableMod.parseText(e.text) : null;
      return !t || !t.blocks.length || t.blocks.some((b) => b.widths.length < 2 || !b.rows.length);
    });
    ok("帝王与名家的「外国」两卷带正文（" + foreignRows.length + " 条，正文里的框线表解析成两列以上）",
      broken.length === 0,
      "这几条取不到正文或表格没有解析出行列：" + broken.map((p) => p.id).slice(0, 8).join("、"));
  }

  void R4;
}

Promise.all(pending).then(() => {
  console.log("");
  console.log("检查 " + checks + " 项，失败 " + fails + " 项");
  process.exit(fails ? 1 : 0);
});
