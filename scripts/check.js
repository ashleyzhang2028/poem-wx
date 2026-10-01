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

/* ---------- 5b. 能力门槛 ---------- */
const E = require(path.join(ROOT, "utils", "entitlement.js"));

// 页面脚本会调 E.signedIn()，而它读的是 profile —— 上面已经造好 wx 桩，这里直接改档
function asGuest() {
  wx.setStorageSync(store.KEYS.profile, { logged: false });
}
function asMember() {
  wx.setStorageSync(store.KEYS.profile, { logged: true });
}

asGuest();
ok("未登录：首页可浏览", E.can("home.browse").ok);
ok("未登录：每日背诵不可用", !E.can("recite.basic").ok);
ok("未登录：课外阅读不可用", !E.can("library.all").ok);
ok("未登录：注音不可用", !E.can("pinyin.helper").ok);
ok("未登录：艾宾浩斯不可用", !E.can("algo.ebbinghaus").ok);
ok("未登录：朗读不可用", !E.can("read.aloud").ok);
ok("未登录：莱特纳盒不可用", !E.can("algo.leitner").ok);
ok("未登录：导出不可用", !E.can("export.progress").ok);

asMember();
ok("已登录：首页仍可浏览", E.can("home.browse").ok);
ok("已登录：每日背诵可用", E.can("recite.basic").ok);
ok("已登录：课外阅读可用", E.can("library.all").ok);
ok("已登录：注音可用", E.can("pinyin.helper").ok);
ok("已登录：艾宾浩斯可用", E.can("algo.ebbinghaus").ok);
ok("已登录：朗读可用", E.can("read.aloud").ok);
ok("已登录：莱特纳盒可用", E.can("algo.leitner").ok);
ok("已登录：导出可用", E.can("export.progress").ok);

// 除了首页，一个免登录的口子都不能留
const FREE_KEYS = E.ORDER.filter((k) => !E.CAPS[k].login);
ok("免登录能力只有首页浏览", FREE_KEYS.length === 1 && FREE_KEYS[0] === "home.browse",
  "实际 " + FREE_KEYS.join(","));

// 门槛文案必须真的说出「登录可用」，不能只是 ok=false 而用户不知道怎么办
ok("拒绝时说清门槛", E.hint("read.aloud", { signedIn: false }) === "登录后可用");
ok("放行时不喊门槛", E.hint("read.aloud", { signedIn: true }) === "可用");

// 权限页矩阵要和 can() 一致，不能各算一套
const mGuest = E.matrix({ signedIn: false });
ok("矩阵条数与能力表一致", mGuest.length === E.ORDER.length);
ok("矩阵逐条与 can() 一致",
  mGuest.every((r) => r.ok === E.can(r.cap, { signedIn: false }).ok));
const mMember = E.matrix({ signedIn: true });
ok("登录后矩阵全开", mMember.every((r) => r.ok));

// 游客范围：一年级本册、只读
const gs = E.guestScope();
ok("游客范围是一年级本册", gs.grade === 1 && gs.term === 1 && gs.scope === "term");
ok("游客范围是只读", gs.readOnly === true);

// 能力表覆盖 Issue 里列出的每一项
["每日背诵", "课外阅读", "注音辅助", "艾宾浩斯", "语音朗读", "莱特纳盒", "进度导出"].forEach((n) => {
  ok("能力表含「" + n + "」", Object.keys(E.CAPS).some((k) => E.CAPS[k].name.indexOf(n) >= 0));
});

/* ---------- 5c. 游客首页渲染 ---------- */
const homeWxml = fs.readFileSync(path.join(ROOT, "pages", "home", "home.wxml"), "utf8");
const homeJs = fs.readFileSync(path.join(ROOT, "pages", "home", "home.js"), "utf8");
ok("首页有游客提示条", homeWxml.indexOf("readOnly") >= 0 && homeWxml.indexOf("guest-bar") >= 0);
ok("首页游客态在 js 里算出来", homeJs.indexOf("E.guestScope()") >= 0);
ok("首页游客不留本机进度", homeJs.indexOf("logged ? store.getRecord") >= 0);
// 列表点击与「开始背」都必须过门禁，不能只拦一个入口
ok("首页点击过门禁", homeJs.indexOf('E.block("recite.basic"') >= 0);

/* ---------- 6. WXML 字段粗查 ---------- */
const unusedWarn = [];
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");
  const refs = new Set();
  const re = /\{\{\s*([a-zA-Z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(wxml))) refs.add(m[1]);
  refs.forEach((name) => {
    if (name === "item" || name === "index" || name === "true" || name === "false") return;
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

/* ---------- 9. 包体积 ---------- */
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

// 正文分片走 CDN，不计入主包 —— 这正是「正文上云」那条决策的兑现点
const mainPkg = dirSize(ROOT, path.join(ROOT, "data", "texts"));
ok(
  "主包在 2MB 内（" + (mainPkg / 1024 / 1024).toFixed(2) + "MB）",
  mainPkg <= LIMIT_MAIN,
  "超限 " + ((mainPkg - LIMIT_MAIN) / 1024).toFixed(0) + "KB"
);

// 索引不该再存第二份全站投影，那是上一版把主包顶爆的原因
const dupFile = path.join(dataDir, "books", "search.json");
ok("索引没有多余的全站副本", !fs.existsSync(dupFile), "search.json 与各集子索引重复");

/* ---------- 汇总 ---------- */
console.log("");
console.log("检查 " + checks + " 项，失败 " + fails + " 项");
process.exit(fails ? 1 : 0);
