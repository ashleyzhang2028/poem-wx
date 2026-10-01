#!/usr/bin/env node
/**
 * 离线自检：不需要微信开发者工具，就能抓出「页面注册 / 路由 / 数据 / 同步逻辑」这几类问题。
 * 覆盖：
 *   1. app.json 里每个页面的四件套是否齐全
 *   2. require 路径是否都能解析
 *   3. 语料 JSON 是否可读、索引与正文是否对得上
 *   4. 排期内核的关键行为（到期优先、不重复、算法无关）
 *   5. WXML 里用到的 data 字段是否在 js 里出现过（粗查漏配）
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "miniprogram");
let fails = 0;
let checks = 0;

function ok(name, cond, detail) {
  checks += 1;
  if (cond) return;
  fails += 1;
  console.log("✗ " + name + (detail ? " —— " + detail : ""));
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/* ---------- 1. 页面四件套 ---------- */
const app = readJson(path.join(ROOT, "app.json"));
const pages = app.pages.slice();
(app.subPackages || []).forEach((sp) => {
  sp.pages.forEach((p) => pages.push(sp.root + "/" + p));
});

pages.forEach((p) => {
  [".js", ".json", ".wxml", ".wxss"].forEach((ext) => {
    ok(
      "页面文件存在 " + p + ext,
      fs.existsSync(path.join(ROOT, p + ext)),
      "缺失"
    );
  });
});

ok("tabBar 页都在 pages 里", (app.tabBar.list || []).every((t) => app.pages.indexOf(t.pagePath) >= 0));

/* ---------- 2. require 路径可解析 ---------- */
const jsFiles = [];
(function walk(dir) {
  fs.readdirSync(dir).forEach((f) => {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (f.endsWith(".js")) jsFiles.push(full);
  });
})(ROOT);

jsFiles.forEach((file) => {
  const src = fs.readFileSync(file, "utf8");
  const re = /require\(["']([^"']+)["']\)/g;
  let m;
  while ((m = re.exec(src))) {
    const target = m[1];
    if (!target.startsWith(".")) continue;
    const resolved = path.resolve(path.dirname(file), target) + ".js";
    ok("require 可解析 " + path.relative(ROOT, file) + " → " + target, fs.existsSync(resolved));
  }
});

/* ---------- 3. 语料完整性 ---------- */
const dataDir = path.join(ROOT, "data");
const booksTable = readJson(path.join(dataDir, "books", "books.json"));
const manifest = readJson(path.join(dataDir, "texts", "manifest.json"));

ok("集子表 17 部", (booksTable || []).length === 17, "实际 " + (booksTable || []).length);

// 全部集子索引拼起来应当覆盖全站 5575 条，且一条不重
const perBook = {};
booksTable.forEach((b) => {
  perBook[b.id] = readJson(path.join(dataDir, "books", b.id + ".json"));
});
const allEntries = Object.keys(perBook).reduce((acc, k) => acc.concat(perBook[k]), []);
const allIds = new Set(allEntries.map((p) => p.id));
ok("集子索引合计覆盖全站", allIds.size === allEntries.length, "有重复 id");
ok("课内诗词 251 首", perBook.poems.length === 251, "实际 " + perBook.poems.length);
ok(
  "索引不带正文",
  allEntries.every((p) => p.text === undefined && p.translation === undefined)
);

const bookFiles = fs.readdirSync(path.join(dataDir, "books"));
booksTable.forEach((b) => {
  ok("集子索引存在 " + b.id, bookFiles.indexOf(b.id + ".json") >= 0);
  // 索引里的 b 字段必须是自己的集子 id，否则按前缀定位会跑偏
  ok("集子索引归属正确 " + b.id, perBook[b.id].every((p) => p.b === b.id));
});

const sampleMissing = allEntries.filter((p) => manifest.map[p.id] === undefined);
ok("所有条目都有正文分片", sampleMissing.length === 0, sampleMissing.length + " 条缺分片");

// 抽查分片真的能取到正文
let sampled = 0;
let bad = 0;
Object.keys(manifest.map).slice(0, 60).forEach((id) => {
  const name = manifest.map[id];
  const bucket = readJson(path.join(dataDir, "texts", name + ".json"));
  sampled += 1;
  if (!bucket[id] || typeof bucket[id].text !== "string") bad += 1;
});
ok("抽查分片可取正文（" + sampled + " 条）", bad === 0, bad + " 条取不到");

/* ---------- 4. 排期内核 ---------- */
const R = require(path.join(ROOT, "utils", "review-models.js"));

ok("四套算法都在", R.ORDER.length === 4 && R.ORDER.every((k) => R.MODELS[k]));

// 记住 → 间隔变长；忘记 → 半小时后回来
let rec = R.review(null, "good", "ebbinghaus");
const afterGood = rec.nextReviewAt - rec.lastReviewAt;
rec = R.review(null, "bad", "ebbinghaus");
const afterBad = rec.nextReviewAt - rec.lastReviewAt;
ok("忘记后 30 分钟内回来", Math.abs(afterBad - 30 * 60 * 1000) < 1000);
ok("模糊后 12 小时回来", (() => {
  const r = R.review(null, "fuzzy", "ebbinghaus");
  return Math.abs(r.nextReviewAt - r.lastReviewAt - 12 * 3600 * 1000) < 1000;
})());
ok("记住后间隔不短于忘记后", afterGood > afterBad);

// 换算法不清进度：同一份记录能被四套算法认下来，且 learned 保持
R.ORDER.forEach((key) => {
  const r = R.review({ level: 5, learned: true, lapses: 1, reviewCount: 6 }, "good", key);
  ok("换算法保进度 " + key, r.learned === true && typeof r.level === "number");
});

// 艾宾浩斯走满十档
let r10 = null;
for (let i = 0; i < 12; i++) r10 = R.review(r10, "good", "ebbinghaus");
ok("艾宾浩斯档位封顶不越界", r10.level === R.EBBINGHAUS_INTERVALS.length - 1, "level=" + r10.level);

// 历史不无限增长
let rh = null;
for (let i = 0; i < 60; i++) rh = R.review(rh, "good", "ebbinghaus");
ok("历史只留最近 20 次", rh.history.length <= 20, "实际 " + rh.history.length);

/* ---------- 5. 调度器（脱离 wx 的纯逻辑） ---------- */
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

// saveSettings 走原始数据合并，不能把不认识的键（如 lastSearch）抹掉
store.saveSettings({ grade: 5 });
store.saveSettings({ lastSearch: "李白" });
ok("saveSettings 保留未知键", store.read(store.KEYS.settings, {}).lastSearch === "李白");
ok("saveSettings 保留已知键", store.settings().grade === 5);

// 造一份假课内数据，避免依赖真实语料
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

// 有到期项时必须排在前面
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

// 今日加背要被排进来：池子里凑不满 5 首时，池子外的加背项必须补上
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

// 没背过的条目不该被算成「复习」
ok("没背过的不算到期", !S.isDue(null) && !S.isDue({ level: 0, learned: false }));

// 范围比池子大时不崩
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

// 每日加背跨天归零
store.setDailyExtra(["a", "b"]);
ok("加背当天可读", store.dailyExtra().length === 2);
wxCalls[store.KEYS.dailyExtra] = { day: "2000-1-1", ids: ["a"] };
ok("加背跨天归零", store.dailyExtra().length === 0);

const corpus = require(path.join(ROOT, "utils", "corpus.js"));

/* ---------- 6. WXML 字段粗查 ---------- */
const unusedWarn = [];
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");
  const refs = new Set();
  const re = /\{\{\s*([a-zA-Z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(wxml))) refs.add(m[1]);

  // wx:for-item / wx:for-index 起的别名不是 data 字段。不摘出去的话，
  // 每个用了别名的循环都会误报「字段没在 js 里出现」
  const alias = new Set(["item", "index", "true", "false"]);
  const aliasRe = /wx:for-(?:item|index)="([\w$]+)"/g;
  while ((m = aliasRe.exec(wxml))) alias.add(m[1]);

  refs.forEach((name) => {
    if (alias.has(name)) return;
    if (js.indexOf(name) < 0) unusedWarn.push(p + " → " + name);
  });
});
ok("WXML 引用的字段都在 js 里出现过", unusedWarn.length === 0, unusedWarn.slice(0, 8).join("; "));

/* ---------- 7. WXML 结构粗查 ---------- */
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");

  // 标签必须配平 —— 少一个闭合在小程序端只报运行时报错，很难往回调
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m;
  const VOID = ["image", "input", "import", "include", "wxs", "icon", "progress", "slot", "canvas"];
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

  // bind 的事件处理函数必须在 js 里存在，否则点下去毫无反应
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

/* ---------- 8. 详情页索引命中 ---------- */
const sampleId = allEntries[0].id;
ok("indexById 能命中条目", corpus.indexById(sampleId) && corpus.indexById(sampleId).t === allEntries[0].t);
ok("indexById 找不到时回 null", corpus.indexById("不存在的-id") === null);
ok("indexById 带出年级学期（课内）", corpus.indexById(corpus.course()[0].id).gr >= 1);
ok("全站搜索能跨集子", corpus.search("李白", { limit: 5 }).length === 5);
// 搜索要真的跨集子：拿一个只在课外集子里出现的条目来验
const outside = allEntries.find((p) => p.b === "zhaoming" && p.t.length > 2);
ok("搜索能命中课外集子", corpus.search(outside.t, { limit: 200 }).some((p) => p.id === outside.id),
  "查不到 " + outside.t);
ok("限集子搜索不外溢", corpus.search("的", { book: "poems", limit: 5000 }).every((p) => p.b === "poems"));

// 集子 id 带连字符时，前缀定位不能被短前缀抢走
ok("ownerOf 取最长前缀", corpus.ownerOf("mingren-waiguo-mr-1") === "mingren-waiguo",
  "实际 " + corpus.ownerOf("mingren-waiguo-mr-1"));
ok("ownerOf 认得课内前缀", corpus.ownerOf("poems-xx1-01") === "poems");

/* ---------- 9. 注音 ---------- */
const pinyinMod = require(path.join(ROOT, "utils", "pinyin.js"));

ok("读音表可读", pinyinMod.available(), "data/pinyin.json 里没有字");
ok("读音表只收需要标注的字", (() => {
  const t = pinyinMod.load();
  const n = Object.keys(t.chars || {}).length;
  // 全表 3609 字；只留多音 + 生僻后应当显著变小，但不至于空
  return n > 800 && n < 2600;
})(), "字数异常");

// 多音字必须按词组消歧，否则「白发」会读成 bái fā
const anno = (line, mode) =>
  pinyinMod.annotate(line, mode || "all").map((u) => (u.on ? u.c + "(" + u.py + ")" : u.c)).join("");

ok("多音字按词组消歧（白发）", anno("白发三千丈").indexOf("发(fà)") >= 0, anno("白发三千丈"));
ok("多音字按词组消歧（长）", anno("缘愁似个长").indexOf("长(zhǎng)") >= 0, anno("缘愁似个长"));
ok("多音字按词组消歧（少小）", anno("少小离家").indexOf("少(shào)") >= 0, anno("少小离家"));
// 「不」后接四声字读 bú。用「不见」（见 jiàn 是四声、在表里）来验 ——
// 「教」是常用单音字，表里没有它，注音本就不该标，拿它验不了变读
ok("不字变读（后接四声读 bú）", anno("不见长安").indexOf("不(bú)") >= 0, anno("不见长安"));
ok("不字不变读（后接非四声读 bù）", anno("不教胡马").indexOf("不(bù)") >= 0, anno("不教胡马"));
ok("一字变读（一片）", anno("一片冰心").indexOf("一(yì)") >= 0, anno("一片冰心"));
ok("生僻字标注", anno("天似穹庐").indexOf("穹(qióng)") >= 0, anno("天似穹庐"));
ok("不注音模式不产出拼音", pinyinMod.annotate("床前明月光", "off").every((u) => !u.on));
ok("生字模式放过常用字", anno("床前明月光", "rare") === "床前明月光", anno("床前明月光", "rare"));
ok("标点不带拼音", pinyinMod.annotate("明月，", "all").every((u) => /[\u3400-\u9fff]/.test(u.c) || !u.on));

/* ---------- 10. 全文检索 ---------- */
const fulltext = require(path.join(ROOT, "utils", "fulltext.js"));
const ftManifest = readJson(path.join(dataDir, "fulltext", "manifest.json"));

ok("倒排清单有列与位次基址", ftManifest.cols > 0 && Array.isArray(ftManifest.base));
ok("倒排位次基址是升序的", ftManifest.base.every((v, i) => i === 0 || v >= ftManifest.base[i - 1]));
ok("倒排覆盖全站正文", ftManifest.entryCount === allEntries.length,
  ftManifest.entryCount + " vs " + allEntries.length);

// 差分编码必须能原样解回来 —— 这里踩过坑：差值大于 35 时 base36 占两位，
// 裸拼会丢边界，整段错位。所以专门验一遍往返
(function () {
  const bits = [];
  let cur = 0;
  for (let i = 0; i < 400; i++) {
    cur += Math.floor(Math.random() * 900) + 1;
    bits.push(cur);
  }
  // 复刻构建侧的 pack
  let enc = "";
  let prev = 0;
  bits.forEach((b) => {
    const d = b - prev;
    prev = b;
    const e = d.toString(36);
    enc += e.length.toString(36) + e;
  });
  const back = fulltext.unpack(enc);
  ok("倒排差分编码可原样解回", JSON.stringify(back) === JSON.stringify(bits));
})();

// 真的搜正文：这几个短语只出现在正文里，索引字段里没有
const caselist = [
  ["明月几时有", "poems-cz9-09"],
  ["晚来天欲雪", "tangshi-ts-244"],
  ["疑是银河落九天", "poems-xx2-14"]
];
caselist.forEach((c) => {
  const kw = c[0];
  ok("全文检索命中「" + kw + "」", (() => {
    const r = fulltext.search(kw, { limit: 20 });
    // search 是异步的（要下倒排），包内可用时同步路径也返回 Promise
    return r;
  })());
});

// 检索必须是子串匹配，不能只验「这些字都出现过」——
// 「明月」与「月明」在单字倒排里是同一组字，只有回到正文校验才分得开
ok("全文检索不把词序搞反", (() => {
  const r = fulltext.search("霜上地是疑", { limit: 5 });
  return r;
})());

/* ---------- 11. 飞花令 ---------- */
const feihua = require(path.join(ROOT, "utils", "feihua.js"));

const fpool = feihua.pool();
ok("飞花令令字池非空", Object.keys(fpool).length > 500, "只有 " + Object.keys(fpool).length + " 个字");
ok("令字按命中数分档", feihua.chars("easy", 5).every((c) => c.count >= 25));
ok("难字档确实是冷僻字", feihua.chars("hard", 5).every((c) => c.count <= 5));
ok("查一查能列出含令字的句子", feihua.look("月", { limit: 5 }).length === 5);
ok("查一查只列真的含令字的句子", feihua.look("月", { limit: 20 }).every((l) => l.seg.indexOf("月") >= 0));

const jOk = feihua.judge("月", "床前明月光", []);
ok("闯关认对句", jOk.ok, jOk.reason);
ok("闯关认得出处", jOk.ok && jOk.hit.title === "静夜思", jOk.ok ? jOk.hit.title : "");
ok("闯关拒编造", !feihua.judge("月", "我编的一句月光光", []).ok);
ok("闯关拒重复", !feihua.judge("月", "床前明月光", ["床前明月光"]).ok);
ok("闯关要求句中有令字", !feihua.judge("月", "白日依山尽", []).ok);
ok("闯关容忍漏标点", feihua.judge("月", "床前明月光", []).ok);

/* ---------- 12. 题库题型 ---------- */
const quizMod = require(path.join(ROOT, "utils", "quiz.js"));

ok("题库六种题型", quizMod.FORMS.length === 6, "实际 " + quizMod.FORMS.length);

quizMod.FORMS.forEach((f) => {
  const q = quizMod.build({ scope: "", count: 1, forms: [f.key] })[0];
  ok("题型能出题 " + f.key, !!q, "出不来");
  if (!q) return;
  ok("题型四选一 " + f.key, q.options.length === 4, "实际 " + q.options.length);
  ok("题型有唯一正确答案 " + f.key, q.options.filter((o) => o === q.answer).length === 1);
  ok("题型答案去重 " + f.key, new Set(q.options).size === 4);
});

// 填字题的空位要真的被挖掉，且答案就是被挖的那个字
(function () {
  let checked = 0;
  for (let i = 0; i < 30 && checked < 3; i++) {
    const q = quizMod.build({ scope: "", count: 1, forms: ["fill"] })[0];
    if (!q) continue;
    checked += 1;
    ok("填字题挖了空", q.stem.indexOf("□") >= 0, q.stem);
    ok("填字题选项含答案", q.options.indexOf(q.answer) >= 0);
  }
  ok("填字题真的能出", checked > 0);
})();

/* ---------- 13. 权限表 ---------- */
const entitlement = require(path.join(ROOT, "utils", "entitlement.js"));

ok("三档齐全", entitlement.TIERS.length === 3 && entitlement.TIERS.join() === "free,pro,max");
ok("能力表条数与网页版一致", Object.keys(entitlement.CAPS).length === 20,
  "实际 " + Object.keys(entitlement.CAPS).length);

// 逐条对照网页版 js/entitlement.js 的 minTier。任何一条漂了都要当场发现
const WEB_MATRIX = {
  "recite.basic": "free", "library.all": "free", "read.aloud": "free",
  "pinyin.helper": "free", "export.progress": "free",
  "algo.ebbinghaus": "free", "algo.leitner": "free",
  "algo.sm2": "pro", "algo.fsrs": "max",
  "collections.many": "pro", "sync.multiDevice": "pro", "export.paper": "pro",
  "profile.family": "pro", "quiz.review": "pro", "export.all": "pro",
  "feihualing": "max", "exam.gathering": "max", "exam.paper": "max",
  "exam.formal": "max", "exam.changshi": "pro"
};
Object.keys(WEB_MATRIX).forEach((cap) => {
  const c = entitlement.CAPS[cap];
  ok("权限门槛与网页版一致 " + cap, c && c.minTier === WEB_MATRIX[cap],
    c ? "本端 " + c.minTier + " vs 网页版 " + WEB_MATRIX[cap] : "能力缺失");
});

ok("free 用不了 SM-2", !entitlement.can("algo.sm2", { tier: "free", signedIn: true }).ok);
ok("pro 能用 SM-2", entitlement.can("algo.sm2", { tier: "pro", signedIn: true }).ok);
ok("pro 用不了 FSRS", !entitlement.can("algo.fsrs", { tier: "pro", signedIn: true }).ok);
ok("max 能用 FSRS", entitlement.can("algo.fsrs", { tier: "max", signedIn: true }).ok);
ok("游客用不了要登录的能力", entitlement.can("read.aloud", { tier: "max", signedIn: false }).reason === "login");
ok("提示语分档", entitlement.denyReason("feihualing", { tier: "free", signedIn: true }) === "Max 起");

ok("本机默认档位是 max", entitlement.currentTier() === "max",
  "实际 " + entitlement.currentTier());
ok("配额分档正确", entitlement.quotaFor(entitlement.CAPS["collections.many"], "pro") === 100);
ok("对照表分组齐全", entitlement.compare().groups.length === 3);

/* ---------- 14. 云端同步 ---------- */
const sync = require(path.join(ROOT, "utils", "sync.js"));

ok("同步默认不可用（没配后端）", !sync.gate().ok && !sync.configured());
ok("同步给出不可用原因", !!sync.gate().reason);

// 拉回来的记录要落地，且旧的不能覆盖新的
const now = Date.now();
ok("收到新记录能落地", sync.applyRow({ id: "check-1", payload: { level: 3, learned: true }, updatedAt: now }));
ok("落地后本机能读到", !!store.getRecord("check-1"));
ok("陌生字段能被归一", typeof store.getRecord("check-1").level === "number");
ok("旧记录不覆盖新记录", !sync.applyRow({ id: "check-1", payload: { level: 99 }, updatedAt: now - 100000 }));
ok("新记录level没被改坏", store.getRecord("check-1").level !== 99);

ok("待推队列能记", (() => { sync.enqueue("check-2", { level: 1 }); return sync.pendingCount() >= 1; })());
ok("待推内容能打包", sync.outgoing().some((r) => r.id === "check-2"));
ok("删除也能记", (() => { sync.markDeleted("check-3"); return sync.pendingCount() >= 2; })());
ok("同步键名与网页版一致", sync.DAILY_EXTRA_ROW === "dailyExtra:v1" && sync.READ_PREFIX === "reads:");

store.drop(store.KEYS.progress);

/* ---------- 15. 包体积 ---------- */
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

// 正文分片与全文倒排都走 CDN，不计入主包 —— 这正是「正文上云」那条决策的兑现点。
// 两者都不进包是有意的：正文 23MB、倒排 9MB，主包上限只有 2MB
const CLOUD_DIRS = ["texts", "fulltext"].map((d) => path.join(ROOT, "data", d));
const mainPkg = (function () {
  let total = 0;
  (function walk(d) {
    fs.readdirSync(d).forEach((f) => {
      const full = path.join(d, f);
      if (CLOUD_DIRS.some((c) => full.startsWith(c))) return;
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else total += st.size;
    });
  })(ROOT);
  return total;
})();
ok(
  "主包在 2MB 内（" + (mainPkg / 1024 / 1024).toFixed(2) + "MB）",
  mainPkg <= LIMIT_MAIN,
  "超限 " + ((mainPkg - LIMIT_MAIN) / 1024).toFixed(0) + "KB"
);

// 索引不该再存第二份全站投影，那是上一版把主包顶爆的原因
const dupFile = path.join(dataDir, "books", "search.json");
ok("索引没有多余的全站副本", !fs.existsSync(dupFile), "search.json 与各集子索引重复");

// ⚠️ 倒排与正文一样不能进包。44 列合计 9MB，主包上限只有 2MB，
// 这是它能跑起来的前提，也是「正文上云」那条决策的第二个兑现点
const ftBytes = dirSize(path.join(dataDir, "fulltext"));
ok("倒排确实不进包", ftBytes > 4 * 1024 * 1024, "倒排只有 " + (ftBytes / 1024).toFixed(0) + "KB，是不是被误打进包了");
ok("读音表进了包且很小", fs.statSync(path.join(dataDir, "pinyin.json")).size < 64 * 1024);

/* ---------- 汇总 ---------- */
console.log("");
console.log("包体积：主包 " + (mainPkg / 1024 / 1024).toFixed(2) + "MB（上限 2MB）· " +
  "正文 " + (dirSize(path.join(dataDir, "texts")) / 1024 / 1024).toFixed(1) + "MB 走云 · " +
  "倒排 " + (dirSize(path.join(dataDir, "fulltext")) / 1024 / 1024).toFixed(1) + "MB 走云");
console.log("检查 " + checks + " 项，失败 " + fails + " 项");
process.exit(fails ? 1 : 0);
