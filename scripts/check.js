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
const os = require("os");
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

/* ---------------------------------------------------------------------------
 * 异步断言**必须**被收进 pending，最后一起等。
 *
 * ⚠️ 这份自检是一路读下来、结尾 `process.exit(fails ? 1 : 0)` 的，而
 * `process.exit()` 会**切掉还没跑的微任务** —— 同一个 tick 里排上的 `.then`
 * 一个都不执行。于是 `auth.login().then(() => ok(...))` 这种写法是**假绿**：
 * 断言从来没跑过，而计数里连它那一项都没有（V45 的 `用户看到的是服务端那句话`
 * 就是这么空跑了一整个版本的 —— 直到 Issue #121 在这附近加断言时才被发现）。
 *
 * 所以：任何 `ok()` 放在 `.then` / 回调里，就得把那个 promise 交给 `pending`；
 * 结尾的汇总会先 `await` 它们，等齐了再判、再 exit。
 * ------------------------------------------------------------------------- */
const pending = [];

function track(p) {
  pending.push(Promise.resolve(p).catch((e) => {
    checks += 1;
    fails += 1;
    console.log("✗ 异步断言自身抛了：" + (e && e.message));
  }));
  return p;
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
    // 小程序里 require 也能加载 json，路径写全了就不补后缀
    const base = path.resolve(path.dirname(file), target);
    // 目录形式：require("./utils/feihua") 在开发者工具里落到 index.js，
    // 小程序与 node 都认，自检也得认，不然会把合法的目录引用判成断链
    let resolved;
    if (/\.json$/.test(target) || /\.js$/.test(target)) resolved = base;
    else resolved = fs.existsSync(base + ".js") ? base + ".js" : path.join(base, "index.js");
    ok("require 可解析 " + path.relative(ROOT, file) + " → " + target, fs.existsSync(resolved));
  }
});

/* ---------- 3. 语料完整性 ---------- */
const dataDir = path.join(ROOT, "data");
const booksTable = readJson(path.join(dataDir, "books", "books.json"));
const manifest = readJson(path.join(dataDir, "texts", "manifest.json"));

ok("集子表 17 部", (booksTable || []).length === 17, "实际 " + (booksTable || []).length);

// 全部集子索引拼起来应当覆盖全站 5855 条，且一条不重
/* ⚠️ 各集子索引**过一层 `corpus.ofBook()` 再读**，不直接读盘上的 JSON。
   落盘时把 `b` / `n` / `hasT` 摘掉了（每个文件里前两个是常数、后一个全是 true，
   三者合计 199KB —— 见 `scripts/build-data.js` 里那段账），由 `ofBook()` 读
   文件时补回来。所以：
     · 下面这些断言查的是**小程序运行时看到的形状** —— 那才是界面依赖的东西；
     · 盘上那份紧凑形状另有一条断言守着（「索引落盘是紧凑的」）。 */
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
booksTable.forEach((b) => {
  ok("集子索引存在 " + b.id, bookFiles.indexOf(b.id + ".json") >= 0);
  /* 索引里的 b / n 字段必须是自己的集子 —— 按前缀定位、按集子名显示都靠它。
     ⚠️ 这一条查的是 `ofBook()` **补回来之后**的值（上面那段注释说了为什么）：
     盘上没有这两个字段，补错了这一条就红。 */
  ok("集子索引归属正确 " + b.id,
    perBook[b.id].every((p) => p.b === b.id && p.n === b.name),
    "b / n 与实际集子对不上");
});

/* 落盘那一份**必须**是紧凑的（摘掉 b / n / hasT 与空字段）——
   这是主包压在 2MB 以内的前提。2026-10-09 那一轮补录 255 条，
   不摘就顶到 2.05MB（超限 46KB）。摘了之后 1.61MB。 */
{
  const compact = readJson(path.join(dataDir, "books", "tangshi.json"));
  const heavy = compact.filter((p) => p.b !== undefined || p.n !== undefined
    || p.hasT !== undefined || p.aka === null || p.sel === "" || p.gr === 0);
  ok("索引落盘是紧凑的（不带 b / n / hasT，也不带空字段）", heavy.length === 0,
    heavy.length + " 条还带着冗余字段 —— 主包又要顶穿 2MB（见 scripts/build-data.js）");
}

// 课内正文单独进主包；其余集子的正文才进分片 —— 两边合起来必须盖住全站，且不重叠
const courseTexts = readJson(path.join(dataDir, "course.json"));
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

/* corpus 在上面第 3 节就 require 了（各集子索引要过它那一层）——
   这里不再重复声明 */

/* ---------- 5.5 朗读 / 注音 / 全文检索的可用性开关 ---------- */

/**
 * 这一节守的是 Issue 里那句话：
 * 「当 TTS 不可用时，所有界面中的播放按钮、播放工具栏、播放设置都不在任何 UI 界面显示」。
 *
 * 守的方式不是比对字符串，而是**真的把每种环境摆出来**，看 readiness() 说什么，
 * 再看页面有没有照着它渲染。前后端都不装的默认环境（Node）就是最严的那一档。
 */
function bootSpeech(wxExtra) {
  const box = {};
  const saved = global.wx;
  global.wx = Object.assign(
    {
      getStorageSync: (k) => (k in box ? box[k] : ""),
      setStorageSync: (k, v) => {
        box[k] = v;
      },
      removeStorageSync: (k) => {
        delete box[k];
      }
    },
    wxExtra || {}
  );
  delete require.cache[require.resolve(path.join(ROOT, "utils", "speech.js"))];
  delete require.cache[require.resolve(path.join(ROOT, "utils", "entitlement.js"))];
  const sp = require(path.join(ROOT, "utils", "speech.js"));
  const en = require(path.join(ROOT, "utils", "entitlement.js"));
  const out = { speech: sp, ent: en, box: box, restore: () => (global.wx = saved) };
  return out;
}

const AUDIO = {
  createInnerAudioContext: () => ({
    onEnded: () => {},
    onError: () => {},
    play: () => {},
    pause: () => {},
    stop: () => {},
    destroy: () => {}
  })
};
const PLUGIN = { getPlugin: () => ({ textToSpeech: (o) => o.success({ filename: "x.mp3" }) }) };

// 这一节的每个环境都先登录 —— 未登录什么都不可见，那是另一个断言（下面 d 组）。
// 混在一起会让「通道没就绪」和「没登录」两个原因互相遮盖，分不出是哪个在挡。
const LOGGED = { kb_profile_v1: { logged: true } };

// a) 没有音频接口 —— 朗读「不可见」
let env = bootSpeech({});
env.box["kb_profile_v1"] = { logged: true };
ok("无音频接口时朗读不可见", env.speech.readiness().visible === false, JSON.stringify(env.speech.readiness()));
ok("无音频接口时朗读报 unsupported", env.speech.readiness().state === "unsupported");
env.restore();

// b) 有音频、没插件 —— 「可见但未就绪」，要显示成待开通而不是假装能用
env = bootSpeech(AUDIO);
env.box["kb_profile_v1"] = { logged: true };
ok("缺少合成通道时朗读可见", env.speech.readiness().visible === true);
ok("缺少合成通道时朗读不可用", env.speech.readiness().usable === false);
ok("缺少合成通道时报 awaiting", env.speech.readiness().state === "awaiting");
ok("未就绪时给出人话原因", !!env.speech.readiness().reason);
env.restore();

// c) 全部就绪
env = bootSpeech(Object.assign({}, AUDIO, PLUGIN));
env.box["kb_profile_v1"] = { logged: true };
ok("通道齐备时朗读就绪", env.speech.readiness().usable === true);
ok("通道齐备时选题用插件", env.speech.resolveProvider() === "plugin");
env.restore();

void LOGGED;

/* ---------- 篇名宋体：与朗读同一条「没就绪就别动」的口径 ----------
   字体是观感增强，不是功能 —— 正因为如此，它更不该在网络不通时
   留下一个半截的状态。这里真的把两种环境摆出来跑一遍。

   ⚠️ 断言必须**同步**跑完：这个脚本结尾是 process.exit()，
   挂在 .then() 里的断言根本轮不到执行 —— 那样「检查 N 项全绿」
   就是一句假话。所以下面全程用**同步的桩**：桩里不调 success/fail 也行，
   我们只关心「load() 有没有去碰 wx.loadFontFace、拿什么参数碰的」。 */
{
  function bootFont(auth, extra) {
    const box = { kb_auth_v1: auth };
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
    return { font: require(path.join(ROOT, "utils", "font.js")), restore: () => (global.wx = saved) };
  }

  // a) 没配 CDN：判据说 unsupported（不是 awaiting），且一笔都不发起
  let called = 0;
  let e = bootFont({}, { loadFontFace: (o) => { called++; o.success && o.success(); } });
  ok("未配 CDN 时篇名字体不可用", e.font.readiness().usable === false);
  ok("未配 CDN 时报 unsupported（不是 awaiting）", e.font.readiness().state === "unsupported");
  ok("未配 CDN 时给出原因", !!e.font.readiness().reason);
  e.font.load();
  ok("未配 CDN 时一次都不碰 wx.loadFontFace", called === 0, "被调了 " + called + " 次");
  e.restore();

  // b) 配了：判据就绪，注册名 / source / global 都要对 ——
  //    注册名与令牌里那串字写在两处，对不上就等于「注册了一个没人叫的名字」
  let seen = null;
  e = bootFont(
    { fontUrl: "https://cdn.example.com/kuibu-title-serif.woff2" },
    { loadFontFace: (o) => { seen = o; o.success && o.success(); } }
  );
  ok("配了 CDN 时篇名字体就绪", e.font.readiness().usable === true);
  e.font.load();
  ok("注册名与 --font-poem 首位一致", !!seen && seen.family === "Kuibu Serif",
    seen ? seen.family : "loadFontFace 没被调用");
  ok("source 用的是配置地址", !!seen && seen.source.indexOf("cdn.example.com") >= 0,
    seen ? seen.source : "");
  ok("注册时声明 global（所有页面共用一份）", !!seen && seen.global === true);
  e.restore();

  // c) 老基础库没有 loadFontFace —— 不许抛，安静跳过
  e = bootFont({ fontUrl: "https://cdn.example.com/x.woff2" }, {});
  let threw = false;
  try { e.font.load(); } catch (err) { threw = true; }
  ok("宿主没有 loadFontFace 时不抛", !threw);
  e.restore();

  // d) 加载失败不许把异常抛出去（桩不调 fail，Promise 悬着也不该崩）
  e = bootFont({ fontUrl: "https://cdn.example.com/x.woff2" },
    { loadFontFace: () => { /* 既不 success 也不 fail */ } });
  threw = false;
  try { e.font.load(); } catch (err) { threw = true; }
  ok("loadFontFace 不回调时不抛", !threw);
  e.restore();

  // e) 令牌里的注册名必须与 font.js 的 FAMILY 是同一个
  const tokensWxss2 = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  const stackNow = /--font-poem\s*:\s*([^;]+);/.exec(tokensWxss2);
  ok("字体链首位与 font.js 的 FAMILY 同名", !!stackNow && stackNow[1].indexOf("Kuibu Serif") >= 0);
}

// d) 未登录：朗读整块不存在。这是 Issue 那条「未登录只能浏览首页」的落点 ——
//    上一版这里走的是「本机宿主」，未登录反而拿得比 pro 多，那条口子已拆。
env = bootSpeech(Object.assign({}, AUDIO, PLUGIN));
env.box["kb_profile_v1"] = { logged: false };
ok("未登录：朗读不可见", env.speech.readiness().visible === false, JSON.stringify(env.speech.readiness()));
ok("未登录：朗读报 denied", env.speech.readiness().state === "denied");
ok("未登录：未授权的原因说「登录后可用」", env.speech.readiness().reason === "登录后可用", env.speech.readiness().reason);

// 登录（free 档）：朗读是登录门槛的能力，通道齐备就该能用
env.box["kb_profile_v1"] = { logged: true };
ok("登录后朗读可见且可用", env.speech.readiness().usable === true, JSON.stringify(env.speech.readiness()));
ok("登录后朗读状态来自 readiness", env.speech.readiness().state === "ready");

// 本机自己写一份高档位不生效：档位只认服务端下发的那一份
env.box["kb_profile_v1"] = { logged: true, tier: "max" };
ok("本机写 max 不生效（无签名，按免费算）", env.ent.status().blocked === "unsigned", JSON.stringify(env.ent.status()));
ok("无签名档位退回免费", env.ent.status().tier === "free", env.ent.status().tier);
env.restore();

// e) 注音：读音表不在就整块关掉
const pinyin = require(path.join(ROOT, "utils", "pinyin.js"));
const pinyinTable = path.join(dataDir, "pinyin-table.json");
if (fs.existsSync(pinyinTable)) {
  const pt = readJson(pinyinTable);
  ok("读音表有字", Object.keys(pt.chars || {}).length > 1000, "只有 " + Object.keys(pt.chars || {}).length + " 字");
  ok("读音表带词组（多音字消歧靠它）", Object.keys(pt.words || {}).length > 0);
  ok("读音表带常用字（生字模式判据）", Object.keys(pt.common || {}).length > 1000);
  // 多音字数别写死：这份表 3609 字里只有 60 个带多音标注，
  // 阈值给个下限就行 —— 关键不是数量，而是那 60 个是不是真的在标音时生效了（见下）
  ok("读音表带多音字集合", Object.keys(pt.poly || {}).length >= 50, "实际 " + Object.keys(pt.poly || {}).length);
  ok("多音字集合与读音表自洽", Object.keys(pt.poly || {}).every((ch) => String((pt.chars || {})[ch] || "").indexOf("/") >= 0));
  ok("注音就绪", pinyin.readiness().usable === true);

  // 逐字标：字数对得上，且每个汉字都拿到读音
  const all = pinyin.annotate("床前明月光", "all");
  ok("逐字标音不丢字", all.length === 5 && all.every((c) => c.mark));
  ok("逐字标音有读音", all.every((c) => !!c.py), JSON.stringify(all));

  // 生字模式：常用字不标，多音字要标
  const rare = pinyin.annotate("白发三千丈", "rare");
  const markOf = (ch) => (rare.find((c) => c.ch === ch) || {}).mark;
  ok("生字模式标多音字「发」", markOf("发") === true);
  ok("生字模式不标常用单音字「三」", markOf("三") === false);

  // 多音字消歧：词组优先，「白发」读 fà，「作为」读 wéi
  ok("多音字按词组消歧 白发→fà", pinyin.readOf("发", "白发", 1) === "fà", pinyin.readOf("发", "白发", 1));
  ok("多音字按词组消歧 作为→wéi", pinyin.readOf("为", "作为", 1) === "wéi", pinyin.readOf("为", "作为", 1));
  ok("不字变调（不知→bù）", pinyin.readOf("不", "不知", 0) === "bù");
  ok("不字变调（不是→bú）", pinyin.readOf("不", "不是", 0) === "bú", pinyin.readOf("不", "不是", 0));
  ok("一字变调（一行→yì）", pinyin.readOf("一", "一行", 0) === "yì", pinyin.readOf("一", "一行", 0));
  ok("关掉注音就不切词", pinyin.annotate("床前明月光", "off").every((c) => !c.mark));

  /* 逐句：段落 → 行 → 句 → 字。这几层都不是摆设 ——
     语料里一行往往承好几个句子（《琵琶行》整段诗序就是一行），
     少了它，正文居中时是一坨、朗读把整段一起合成、注音的消歧窗口也跟着错。 */
  const csplit = require(path.join(ROOT, "utils", "corpus.js")).splitLines;
  const cmod = require(path.join(ROOT, "utils", "corpus.js"));
  // 形状是 corpus.layout() 的「段落 → 行 → 句」：空行留成空段
  const t3 = cmod.layout("鹅，鹅，鹅，\n\n曲项向天歌。").paras;
  const t3r = pinyin.render(t3, "rare");
  ok("注音形状：段数不丢", t3r.length === 2, JSON.stringify(t3r.length));
  // `鹅，鹅，鹅，` 一行三句、每句一个「字 + 标点」格子；
  // 每句挂 `i`（第几句）—— 朗读报「第 5 句」，正文凭它找到那一行
  ok("注音形状：一行切得出多句", t3r[0][0].length === 3, JSON.stringify(t3r[0][0].length));
  ok("注音形状：每句带序号", t3r[0][0][0].i === 0 && t3r[1][0][0].i === 3,
    JSON.stringify(t3r.map((p) => p.map((r) => r.map((c) => c.i)))));
  const t3first = t3r[0][0][0].tokens;
  ok("注音形状：每句是字数组", t3first.length === 2 && t3first[0].ch === "鹅",
    JSON.stringify(t3first.map((x) => x.ch)));
  // render 不许自己再切一遍 —— 它会连标点一起切掉，正文就成了「鹅鹅鹅」
  ok("注音不重切句子（逗号还在）", t3first.some((c) => c.ch === "，"),
    JSON.stringify(t3first));
  const t3last = t3r[1][0][0].tokens;
  ok("注音不重切句子（句号还在）", t3last[t3last.length - 1].ch === "。",
    JSON.stringify(t3last));

  // 消歧窗口仍是**整行**：词组「白发」不能因为切句而丢
  const t4 = pinyin.render(cmod.layout("白发三千丈").paras, "rare");
  ok("切句后消歧窗口仍是整行（白发→fà）",
    t4[0][0][0].tokens.filter((c) => c.ch === "发")[0].py === "fà",
    JSON.stringify(t4[0][0][0].tokens.filter((c) => c.ch === "发")));
  // 跨句的消歧：`高堂明镜悲白发，` 里「白发」在同一句就够了；
  // 这里守的是**折叠之后同一行里**的相邻句还在同一个窗口里
  const t5 = pinyin.render(cmod.layout("君不见，高堂明镜悲白发，朝如青丝暮成雪。").paras, "rare");
  const f5 = t5[0]
    .map((row) => row.map((cl) => cl.tokens.filter((c) => c.ch === "发")).reduce((a, c) => a.concat(c), []))
    .reduce((a, c) => a.concat(c), []);
  ok("折叠后同行的相邻句不丢消歧窗口（白发→fà）", f5.length && f5[0].py === "fà",
    JSON.stringify(f5));
} else {
  ok("读音表未生成时注音整块关闭", pinyin.readiness().visible === false);
}

// e2) 断句：口径只有一份（corpus.splitLines），阅读页 / 飞花令 / 朗读都走它
const splitLines = require(path.join(ROOT, "utils", "corpus.js")).splitLines;
ok("splitLines 一行切多句", splitLines("鹅，鹅，鹅，\n曲项向天歌。")[0].s.length === 3);
// 标点必须留在句尾。丢掉的话正文会变成「鹅鹅鹅」—— 缺一个字，一眼能看出来，
// 而且只在「不注音」路径之外的所有渲染里都错，很难第一时间联想到断句
const clausePunct = splitLines("鹅，鹅，鹅，\n曲项向天歌。");
ok("splitLines 标点留在句尾", clausePunct[0].s.join("") === "鹅，鹅，鹅，",
  JSON.stringify(clausePunct[0].s));
ok("splitLines 切句后拼回 = 原行", clausePunct.map((ln) => ln.s.join("")).join("") === "鹅，鹅，鹅，曲项向天歌。",
  JSON.stringify(clausePunct.map((ln) => ln.s.join("")).join("")));
// 整篇拼回去必须与原文只差换行 —— 断句是「重新切」，不是「重新写」
const rebuild = Object.keys(corpus.courseTexts()).every((k) => {
  const raw = (corpus.courseTexts()[k] || {}).text;
  if (!raw) return true;
  return splitLines(raw).map((ln) => ln.s.join("")).join("") ===
    String(raw).split("\n").map((l) => l.split(/[\s]/).join("")).join("");
});
ok("全部课内正文切句后拼得回原文", rebuild);
ok("splitLines 保留空行", splitLines("a\n\nb").length === 3 && splitLines("a\n\nb")[1].s.length === 0);
ok("splitLines 空正文不炸", splitLines("").length === 1 && splitLines(null).length === 1);
// 标点不能只在「不注音」那条路上活着。注音那条路渲染的是 tokens，
// 它若自己再切一遍句子，标点就当场没了 —— 预览里真的出现过「鹅鹅鹅」。
{
  const pj = fs.readFileSync(path.join(ROOT, "utils", "pinyin.js"), "utf8");
  const renderBody = /function render\(paras, mode\)\s*\{([\s\S]*?)\n\}/.exec(pj);
  // render 只吃 corpus.layout() 的「段落 → 行 → 句」，自己不再切
  ok("pinyin.render 只吃 corpus.layout() 的形状（段落 → 行 → 句）",
    !!renderBody && renderBody[1].indexOf("row") >= 0 && renderBody[1].indexOf("para") >= 0,
    renderBody ? renderBody[1].slice(0, 80) : "找不到 render");
  ok("pinyin.render 不再自己按标点切句",
    !/split\(\s*\/\[. *[，。！？]/.test(pj));
  const rwxml = fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.wxml"), "utf8");
  ok("阅读页正文与注音两条路都按句渲染",
    rwxml.indexOf("wx:for=\"{{row}}\"") >= 0 && rwxml.indexOf("wx:for=\"{{cl.tokens}}\"") >= 0);
}
// 语料里真有这种行 —— 上面那句注释不是假设
const longLine = corpus.courseTexts();
const hasMulti = Object.keys(longLine).some((k) => {
  const t = longLine[k] && longLine[k].text;
  if (!t) return false;
  return splitLines(t).some((ln) => ln.s.length > 1);
});
ok("语料里确实有一行多句的篇目（切句不是白做）", hasMulti === true);

// f) 全文检索：索引不在就退回索引字段，不假装搜过正文
const tsearch = require(path.join(ROOT, "utils", "text-search.js"));
const idxFile = path.join(dataDir, "texts", "idx.json");
if (fs.existsSync(idxFile)) {
  ok("全文检索就绪", tsearch.readiness().usable === true);
  const hits = tsearch.search("明月", { limit: 5 });
  ok("全文检索能命中正文", hits.length > 0, "查不到「明月」");
  ok("全文检索带出命中句", hits.every((h) => h.lines.length > 0));
  ok("全文检索给出来源（包内 / 分片）", hits.every((h) => h.where === "pack" || h.where === "cloud"));
  ok("查询切成单字", tsearch.termsOf("明月").length === 2);
  const b1 = tsearch.candidateBuckets(tsearch.termsOf("明月"));
  const b2 = tsearch.candidateBuckets(tsearch.termsOf("床前明月光"));
  ok("候选分片取交集后收敛", b2.length <= b1.length, b1.length + " → " + b2.length);
  ok("候选分片不空（除非真没有）", b1.length > 0);
} else {
  ok("全文索引未生成时检索整块关闭", tsearch.readiness().visible === false);
}

// g) 云同步：没后端就只攒队列，绝不上报成功
const sync = require(path.join(ROOT, "utils", "sync.js"));
ok("未配置后端时同步不就绪", sync.ready() === false);
sync.now(true).then((res) => {
  ok("未配置后端时同步报 offline", res.skipped === "offline", JSON.stringify(res));
});

/* ---------- 5b. 登录这道门 + 三档 ----------
 * 两件事必须一起验：
 *   1. **登录门** —— 未登录只有首页浏览，其余一条都不给；
 *   2. **三档** —— 登录之后按 free / pro / max 分层。
 * 只说其一，界面就会「登录了却什么都点不动」或者「未登录也能点进正文」。
 */
const E = require(path.join(ROOT, "utils", "entitlement.js"));
const tiersMod = require(path.join(ROOT, "utils", "tiers.js"));

// 页面脚本会调 E.signedIn()，而它读的是 profile —— 上面已经造好 wx 桩，这里直接改档
function asGuest() {
  wx.setStorageSync(store.KEYS.profile, { logged: false });
}
function asMember() {
  wx.setStorageSync(store.KEYS.profile, { logged: true, tier: "pro" });
}

asGuest();
ok("未登录：首页可浏览", E.decide("home.browse").ok);
ok("未登录：每日背诵不可用", !E.decide("daily").ok);
ok("未登录：课外阅读不可用", !E.decide("library").ok);
ok("未登录：注音不可用", !E.decide("pinyin").ok);
ok("未登录：艾宾浩斯不可用", !E.decide("ebbinghaus").ok);
ok("未登录：朗读不可用", !E.decide("speak").ok);
ok("未登录：莱特纳盒不可用", !E.decide("leitner").ok);
ok("未登录：导出不可用", !E.decide("export").ok);

// 免登录清单：有且只有首页浏览一条。谁想悄悄开口子，这里当场红。
ok("免登录能力只有首页浏览",
  E.CAN_GUEST.length === 1 && E.CAN_GUEST[0] === "home.browse", E.CAN_GUEST.join(","));

// 门槛文案必须真的说出「登录后可用」，不能只是 ok=false 而用户不知道怎么办
ok("拒绝时说清门槛", E.hint("speak", { signedIn: false }) === "登录后可用");
ok("免登录那条永远放行（hint 为空）", E.hint("home.browse", { signedIn: false }) === "");

// 权限页矩阵要和 decide() 一致，不能各算一套
const mGuest = E.matrix({ signedIn: false });
ok("矩阵条数与展示顺序一致", mGuest.length === E.ORDER.length);
ok("矩阵逐条与 decide() 一致",
  mGuest.every((r) => r.ok === E.decide(r.cap, { signedIn: false }).ok));
ok("未登录矩阵只有首页一条 ok",
  mGuest.filter((r) => r.ok).length === 1 && mGuest[0].ok);

// 游客范围：一年级本册、只读
const gs = E.guestScope();
ok("游客范围是一年级本册", gs.grade === 1 && gs.term === 1 && gs.scope === "term");
ok("游客范围是只读", gs.readOnly === true);

// 能力表覆盖 Issue 里列出的每一项
["每日背诵", "课外阅读", "注音辅助", "艾宾浩斯", "语音朗读", "莱特纳盒", "进度导出"].forEach((n) => {
  ok("能力表含「" + n + "」", E.ORDER.some((r) => r.name.indexOf(n) >= 0));
});

// 登录之后：三档逐条验（free / pro / max）。
// 档位走的是 auth.serverTier()（服务端下发），所以这里写进 auth 那一格，
// 而不是 profile.tier —— 后者无签名，会被降级（见 entitlement.status 的 unsigned）。
function asTier(t) {
  wx.setStorageSync(store.KEYS.profile, { logged: true });
  wx.setStorageSync(store.KEYS.auth, { token: "t", tier: t, at: Date.now() });
}
asTier("free");
ok("已登录：首页仍可浏览", E.decide("home.browse").ok);
ok("free 会员：每日背诵可用", E.decide("daily").ok);
ok("free 会员：朗读（登录即得）可用", E.decide("speak").ok);
ok("free 会员：FSRS（max）不可用", !E.decide("fsrs").ok);

asTier("pro");
ok("pro 会员：SM-2 可用", E.decide("sm2").ok);
ok("pro 会员：题库可用", E.decide("quiz").ok);
ok("pro 会员：FSRS（max）仍不可用", !E.decide("fsrs").ok);

asTier("max");
ok("max 会员：FSRS 可用", E.decide("fsrs").ok);
ok("max 会员：飞花令可用", E.decide("feihualing").ok);

/* ---------- 5c. 游客首页渲染 ---------- */
const homeWxml = fs.readFileSync(path.join(ROOT, "pages", "home", "home.wxml"), "utf8");
const homeJs = fs.readFileSync(path.join(ROOT, "pages", "home", "home.js"), "utf8");
ok("首页有游客提示条", homeWxml.indexOf("guest-bar") >= 0);
ok("首页游客态在 js 里算出来", homeJs.indexOf("gate.GUEST_GRADE") >= 0);
// 列表点击与「开始背」都必须过门禁，不能只拦一个入口
ok("首页点击过门禁", homeJs.indexOf('gate.guard("背诵"') >= 0);

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
    // item / index 是 wx:for 的内置名，tk / t / b / p 等是本项目自定的 wx:for-item 名
    // item / index 是 wx:for 的内置名；其余是本项目自定的 wx:for-item 名，
    // 它们不是 data 字段，不该被算成「js 里没出现」。
    // themeStyle / themeHex 不在这份白名单里，但也不是「写漏了」：
    // 它们由 utils/theme.js 的 apply(page) 在 onShow 里一次性 setData 进去，
    // 页面 js 里当然不出现这两个名字 —— 每个页面各写一遍才是上一版那种漂移。
    if (["item", "index", "tk", "t", "b", "p", "l", "grp", "caprow", "row", "true", "false",
         "themeStyle", "themeHex"].indexOf(name) >= 0) return;
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
  // 自闭合（无子节点）的原生标签，写不写 "/" 都不该进配平栈。
  // checkbox / radio / switch / slider 这四个是这轮加进来的：漏一个，
  // 后面所有闭合都会被判成不配平 —— 报错位置离真正的错处很远，极难查。
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

// 课内正文必须能直接从包内取到（不进分片那句话在这里兑现）
const courseEntry = corpus.entry(perBook.poems[0].id);
ok("课内正文能从包内取到", !!courseEntry && typeof courseEntry.text === "string");
ok("课内正文不走分片", corpus.bucketOf(perBook.poems[0].id) === "");
// 课外条目仍走分片，别把两边的分界线搞反
const outsideId = allEntries.find((p) => p.b !== "poems" && manifest.map[p.id]).id;
ok("课外正文仍走分片", corpus.bucketOf(outsideId) !== "" && !!corpus.entry(outsideId).text);

/* ---------- 7.5 界面按能力显隐：扫 WXML 源码 ---------- */

/**
 * 7.5 验的是「界面里有没有朗读」。
 *
 * 这条曾经是反过来的：上一版要求朗读元素必须挂在 speakVisible 上 ——
 * 于是「授权了但通道没就绪」会被渲染成一张写着「待开通」的卡，
 * 每次进详情页都杵在那儿。用户 2026-10-02 明确裁决：
 * **朗读卡不显示，更别显示待开通**（TTS 通道个人主体申请不下来，不做）。
 *
 * 所以现在守的是反面：任何页面都不许再冒出朗读元素或「待开通」这类字眼。
 * 谁哪天要接 TTS，先改这条断言 —— 它挡的是「悄悄回来」，
 * 不是「不许做」。
 */
{
  const FORBIDDEN = /待开通|朗读|speakVisible|speakReady|speakReason|speak-bar|speak-ctrl/;
  const stray = [];
  pages.forEach((p) => {
    [".wxml", ".js"].forEach((ext) => {
      const f = path.join(ROOT, p + ext);
      if (!fs.existsSync(f)) return;
      fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        // 注释里说明「为什么不做」是允许的，也应当被允许 —— 不然下一个人
        // 只会把注释删掉，而不是把事实弄清楚
        const code = line.replace(/<!--[\s\S]*?-->|\/\*.*?\*\/|\/\/.*$/, "").trim();
        if (!code) return;
        if (FORBIDDEN.test(code)) stray.push(p + ext + ":" + (i + 1) + " → " + code.slice(0, 50));
      });
    });
  });
  ok("界面里没有朗读元素（用户裁决不做，见 docs/todo.md 第 1 条）", stray.length === 0, stray.slice(0, 6).join(" | "));
}

// 我的页：「声音」那个入口只挂音效门禁，且版式三件事合成一条入口
//
// 2026-10-04 之前是两条：「阅读设置（注音）」+「通用设置（对齐 · 字号）」。
// 注音搬进通用设置之后，剩下这一页管的是答题音效 —— 它的门禁也跟着换：
// 上一版挂的是 pinyinVisible，注音不可用时连音效那一页都进不去。
{
  const p = "pages/mine/mine";
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");
  ok("「声音」入口挂音效门禁（不是注音那一个）",
    wxml.indexOf("wx:if=\"{{sfxVisible}}\"") >= 0 && !/pinyinVisible/.test(wxml + js));
  ok("版式三件事只有一条入口（对齐 · 注音 · 字号）",
    (wxml.match(/onSettings/g) || []).length === 1
      && wxml.indexOf("对齐 · 注音 · 字号") >= 0);
}

/* ---------- 7.6 权限分层 ---------- */
const gateMod = require(path.join(ROOT, "utils", "gate.js"));

ok("三档齐备", tiersMod.TIER_KEYS.join(",") === "free,pro,max", tiersMod.TIER_KEYS.join(","));

/**
 * 档位表不许跟网页版漂 —— 同一份进度是要跨端同步的，
 * 一端说「FSRS 是 pro」、另一端说「max」，用户看到的就是
 * 「网页版能用、小程序不能用」。所以这里把网页版的口径钉成期望值。
 *
 * 只钉两端**同义**的能力；小程序端故意不做的（PDF 打印、子用户、正式考试）
 * 不在此列，见 entitlement.js 顶上那段说明。
 */
const WEB_TIER = {
  daily: "free",
  library: "free",
  speak: "login",
  export: "login",
  ebbinghaus: "free",
  leitner: "login",
  sm2: "pro",
  fsrs: "max",
  collections: "pro",
  feihualing: "max"
};

/**
 * 同步**故意**与网页版不同档，所以它不在这张表里（表里每一条都在比「不许漂」）。
 *
 * 网页版是 pro（服务端 syncTierGate 对 free 直接 403，cap: sync.multiDevice）；
 * 用户 2026-10-04 给小程序端重定了边界：
 *   「我现在是微信小程序项目……同步功能只要用户登录就全部提供，
 *     确保用户数据不丢失，背诵进度换设备也能得到」
 * 所以小程序端它是 login —— 登录即得，不看档位。
 *
 * 这条差异必须**写死在自检里**（下面那一条），否则下一个人看两边表不一样，
 * 顺手就把它改回 pro 了。
 */
ok("同步是登录即得（与网页版的 pro 故意不同）",
  E.CAPS.find((c) => c.key === "sync").tier === "login",
  (E.CAPS.find((c) => c.key === "sync") || {}).tier);
ok("同步在「一登录就打开」的白名单里",
  tiersMod.DEFAULT_ON.indexOf("sync") >= 0);
Object.keys(WEB_TIER).forEach((k) => {
  const cap = E.CAPS.find((c) => c.key === k);
  ok("档位与网页版一致 " + k, !!cap && cap.tier === WEB_TIER[k],
    cap ? "小程序=" + cap.tier + " 网页版=" + WEB_TIER[k] : "能力不存在");
});

// 能力表里每条的 tier 都必须是合法档位，且表里不许有重名 key
ok("能力 key 不重复", new Set(E.CAP_KEYS).size === E.CAP_KEYS.length);
ok("能力 tier 都合法", E.CAPS.every((c) => ["free", "login", "pro", "max"].indexOf(c.tier) >= 0));
ok("每条能力都有人话名字与说明", E.CAPS.every((c) => !!c.name && !!c.desc));

/**
 * 管理页的能力分组必须把表里的每一条都摆出来。
 * 分组是排版，但它同时也是「这道口子给谁看」的清单 ——
 * 漏一条就是「表里有、管理页看不见」，用户永远不知道有这个东西。
 *
 * 这里原来查的是 packages/settings/admin —— 那个页面这一版删掉了：
 * 它和 packages/admin 是同一件事的两份实现，其中一份还带自助提权。
 */
{
  const page = fs.readFileSync(path.join(ROOT, "packages", "admin", "index", "index.js"), "utf8");
  const listed = [];
  const blocks = page.match(/keys:\s*\[[^\]]*\]/g) || [];
  blocks.forEach((b) => {
    (b.match(/"(\w+)"/g) || []).forEach((k) => listed.push(k.replace(/"/g, "")));
  });
  const missing = E.CAP_KEYS.filter((k) => listed.indexOf(k) < 0);
  ok("管理页把每条能力都摆出来", missing.length === 0, "漏了 " + missing.join(", "));

  // WXML 里也得真的在渲染这个分组，光 JS 里有数据没用
  const wxml = fs.readFileSync(path.join(ROOT, "packages", "admin", "index", "index.wxml"), "utf8");
  ok("管理页渲染能力分组", wxml.indexOf("grp.rows") >= 0 && wxml.indexOf("groups") >= 0);
  ok("管理页显示当前档位标签", wxml.indexOf("status.label") >= 0);
}


ok("档位顺序单调", E.rankOf("free") < E.rankOf("pro") && E.rankOf("pro") < E.rankOf("max"));

const snap = E.snapshot();
ok("能力矩阵不漏项", Object.keys(snap.caps).length === E.CAP_KEYS.length);

/**
 * 分层判据本身要验一遍 —— 这是自检里最容易「看起来没问题」的一块。
 *
 * 上一版这里有个坑：宿主模式（未登录 = 全部放行）让三档长得一模一样，
 * 于是 can() 哪怕把比较写反了也一路绿。现在没有宿主了，
 * **每一档都真的走 can()**，写反了当场红。
 *
 * 档位的三条来源也各验一遍：服务端下发 / 授权码 / 本机自写（必须按免费算）。
 */
{
  const setProfile = (p) => store.saveProfile(Object.assign({ grant: null }, p));
  const clearGrant = () => store.drop(store.KEYS.grant);
  const setAuth = (a) => store.write(store.KEYS.auth, Object.assign({ baseUrl: "https://example.test" }, a || {}));
  const clearAuth = () => store.drop(store.KEYS.auth);
  const clearCaps = () => store.drop(store.KEYS.caps);

  // ---- 未登录：一条能力都不给，连 free 都不给 ----
  clearGrant();
  clearAuth();
  clearCaps();
  setProfile({ logged: false, tier: "" });
  ok("未登录拿不到免费能力", E.can("daily") === false && E.can("library") === false);
  ok("未登录拿不到付费能力", E.can("sm2") === false && E.can("fsrs") === false);
  ok("未登录拿不到飞花令", E.can("feihualing") === false);
  ok("未登录的提示是「登录后可用」", E.hint("speak") === "登录后可用", E.hint("speak"));
  ok("未登录 snapshot 不给任何能力", E.CAP_KEYS.every((k) => E.snapshot().caps[k].ok === false));

  /* ---- 登录（免费档）：登录门槛的能力打开，付费能力仍然关着 ----

     ⚠️ 这里**必须先清掉 auth 那两条 `offline` 字段**（Issue #121）。
     它们原先由上面那句 `clearAuth()` 顺手清掉，而 `auth.offline()` 现在会读它们 ——
     不清就会把「没接上服务器」这个 blocked 带进下面这几条，红在
     「付费能力给出档位提示」上（拿到的是那句 blocked 提示，不是档名）。
     判据与它被读的那个字段对齐：要的是「登录但没接服务器」，
     所以得先站进「登录、且没标记过离线」那个状态。 */
  const authStore = require(path.join(ROOT, "utils", "auth.js"));
  store.write(store.KEYS.auth, Object.assign(store.read(store.KEYS.auth, {}) || {},
    { baseUrl: "https://example.test", offline: "", offlineAt: 0, loginCode: "", codeAt: 0 }));
  void authStore;
  setProfile({ logged: true, tier: "" });
  ok("登录后每日背诵打开", E.can("daily") === true);
  ok("登录后朗读打开", E.can("speak") === true);
  ok("登录后导出打开", E.can("export") === true);
  ok("登录后莱特纳盒打开", E.can("leitner") === true);
  ok("登录不解锁付费能力", E.can("sm2") === false && E.can("feihualing") === false);
  ok("付费能力给出档位提示（档名是 Max，不是译名）", E.hint("feihualing").indexOf("Max") >= 0, E.hint("feihualing"));

  // ---- 提权码：本机档位的载体，管理页改档、兑换码都写在这一处 ----
  store.write(store.KEYS.grant, { code: "PRO-ABCD-1234", tier: "pro", at: Date.now() });
  ok("提权码把档位提到 pro", E.status().tier === "pro", E.status().tier);
  ok("pro 解锁 SM-2", E.can("sm2") === true);
  ok("pro 解锁题库", E.can("quiz") === true);
  ok("pro 仍拿不到飞花令（max 起）", E.can("feihualing") === false);

  store.write(store.KEYS.grant, { code: "MAX-ABCD-1234", tier: "max", at: Date.now() });
  ok("提权码把档位提到 max", E.status().tier === "max", E.status().tier);
  ok("max 解锁飞花令", E.can("feihualing") === true);
  ok("max 解锁考试", E.can("exam") === true);
  ok("可用能力才有空提示", E.hint("feihualing") === "");

  // ---- 档位越高能用得越多，一条都不能反 ----
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

  // ---- 服务端下发的档位最权威，且带签名 ----
  clearGrant();
  setProfile({ logged: true, tier: "" });
  setAuth({ accessToken: "t", tier: "max" });
  ok("服务端档位生效", E.status().tier === "max" && E.status().source === "remote", JSON.stringify(E.status()));
  ok("服务端档位标记为带签名", E.status().signed === true);
  ok("服务端档位解锁飞花令", E.can("feihualing") === true);

  // 服务端下发的按人开关：改档位之外还有一条「单独关掉某人某项能力」
  store.write(store.KEYS.caps, { feihualing: false });
  ok("服务端可以把某项能力单独关掉", E.can("feihualing") === false);
  ok("关掉后提示说清是谁关的", E.hint("feihualing").indexOf("管理员") >= 0, E.hint("feihualing"));
  clearCaps();

  // ---- 本机自己写的档位不生效（这条守的就是被拆掉的那条后门）----
  clearAuth();
  clearGrant();
  setProfile({ logged: true, tier: "max" });
  ok("本机写 max 不生效（无签名，按免费算）", E.status().blocked === "unsigned", JSON.stringify(E.status()));
  ok("无签名的档位退回免费", E.status().tier === "free", E.status().tier);
  ok("无签名时不放行付费能力", E.can("fsrs") === false);

  clearAuth();
  clearGrant();
  clearCaps();
  setProfile({ logged: true, tier: "" });
}

/**
 * 门禁（gate.js）：未登录能做什么、不能做什么。
 *
 * 这一节守的是 Issue 那句「不登录用户只能浏览首页，首页默认列出一年级诗词，无法点击」。
 */
{
  const gate = gateMod;
  const setProfile = (p) => store.saveProfile(Object.assign({ grant: null }, p));

  setProfile({ logged: false, tier: "" });
  ok("未登录：能看首页", gate.allow("browse-home") === true);
  ok("未登录：能切年级看目录", gate.allow("browse-grade") === true);
  ok("未登录：能看关于页", gate.allow("about") === true);
  ok("未登录：打不开正文", gate.canRead() === false);
  ok("未登录：不能搜索", gate.allow("search") === false);
  ok("未登录：不能答题", gate.allow("quiz") === false);
  ok("未登录：不能导出", gate.allow("export") === false);
  ok("未登录的门槛一句人话带下一步", gate.refuse("每日背诵").content.indexOf("登录") >= 0);
  ok("未登录的年级固定为一年级", gate.grade() === 1, gate.grade());

  setProfile({ logged: true, tier: "" });
  ok("登录后：能打开正文", gate.canRead() === true);
  ok("登录后：年级听本机设置", gate.grade() === store.settings().grade);
  ok("登录后：什么动作都放行", gate.allow("quiz") === true && gate.allow("export") === true);
  ok("登录后没有任何拒绝措辞", gate.refuse("随便什么").ok === true);

  setProfile({ logged: false, tier: "" });
  store.saveSettings({ grade: 9 });
  ok("未登录不跟着本机设置跑到九年级", gate.grade() === 1);
  store.saveSettings({ grade: 1 });
}

/**
 * 页面级门禁：**扫 WXML 源码**，确认每个页面都真的把未登录挡在外面。
 * 上面那些断言验的是判据，这里验的是「页面有没有照着做」——
 * 两者差一环，就会出现「gate 说不让进、页面照样渲染」。
 */
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
  "packages/settings/reader/reader": "locked",
  "packages/settings/general/general": "locked",
  "packages/admin/index/index": "logged",
  /* 作者索引：free 档的搜索能力之一，但同样要先登录。
     进 GATED 这一张表不只是「扫一眼 locked 在不在」—— 下面有一组断言
     会用最小运行时**真跑** onShow，验「登录后 locked 必须落回 false」。
     没登录时它是一张门禁卡，登录后必须真出内容。 */
  "packages/authors/index/index": "locked"
};

{
  Object.keys(GATED).forEach((p) => {
    const flag = GATED[p];
    const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
    const js = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");
    ok("门禁变量在 WXML 里用上了 " + p, wxml.indexOf(flag) >= 0, "WXML 里找不到 " + flag);
    ok("门禁变量在 js 里出现过 " + p, js.indexOf(flag) >= 0);
  });

  // 阅读页：未登录时正文一个字都不该渲染
  const readerWxml = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxml"), "utf8");
  ok("阅读页未登录时正文在 block wx:else 里", readerWxml.indexOf("block wx:else") >= 0);
  ok("阅读页锁定时不渲染诗句", readerWxml.indexOf("poem-line") > readerWxml.indexOf("block wx:else"));

  // 设置页三项都不许在未登录时露出开关
  ["general/general", "recite/recite", "reader/reader"].forEach((p) => {
    const wxml = fs.readFileSync(path.join(ROOT, "packages/settings", p + ".wxml"), "utf8");
    ok("设置页未登录时不渲染设置项 " + p, wxml.indexOf("block wx:else") >= 0);
  });

  /**
   * 门禁必须写在 onShow 里，不能只在 onLoad。
   *
   * 这不是风格问题：从「去登录」跳回来时 onLoad **不会再跑**，
   * 于是登录成功了、页面还锁着，用户以为登录没生效。
   * 这一组断言就是钉住它 —— 凡是页面 js 里出现门禁判据的，
   * 判据所在的那个函数必须能被 onShow 触达。
   */
  const GATE_MARK = /gate\.(logged|canRead)\(|entitlement\.can\(/;
  Object.keys(GATED).forEach((p) => {
    const js = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");
    if (!GATE_MARK.test(js)) return;
    // 要么有 onShow，要么 onShow 里直接调了带门禁的方法（reader 的 loadEntry 就是后者）
    const hasOnShow = /onShow\s*\(/.test(js);
    ok("门禁能被 onShow 触达 " + p, hasOnShow, "只有 onLoad，登录回来不会解锁");
  });

  // reader 是特例：门禁在 onShow 里，装载在 loadEntry 里，两者都在 onShow 里串起来
  {
    const js = fs.readFileSync(path.join(ROOT, "pages/reader/reader.js"), "utf8");
    ok("阅读页 onShow 里查门禁", /onShow[\s\S]{0,300}gate\.logged\(\)/.test(js));
    ok("阅读页装载只做一次", js.indexOf("this.loaded") >= 0);
  }
}

/**
 * 管理页不许留自助提权的口子。
 * 上一版有个「改本机层级」的卡片，点两下就能把自己升到 max ——
 * 那让「管理页给登录用户分级」成了摆设。这一节就是钉住它别再回来。
 */
{
  const adminJs = fs.readFileSync(path.join(ROOT, "packages/admin/index/index.js"), "utf8");
  const adminWxml = fs.readFileSync(path.join(ROOT, "packages/admin/index/index.wxml"), "utf8");
  const adminLib = fs.readFileSync(path.join(ROOT, "utils/admin.js"), "utf8");

  ok("管理页不写本机档位", adminJs.indexOf("store.KEYS.grant") < 0, "管理页还在直接写 grant");
  ok("管理页不写本机档位（wxml 也没有改档卡片）", adminWxml.indexOf("改本机层级") < 0);
  ok("改档只走服务端", adminLib.indexOf("remote.setUserTier") >= 0);
  ok("服务端没就绪时如实说改不了", adminLib.indexOf("改不了") >= 0);
  // 能改的给原生按钮，改不了的写「只读」—— 判定在数据层，模板不再自己拼三元
  ok("管理页区分「能改」与「只读」",
    adminWxml.indexOf("item.editable") >= 0 && adminWxml.indexOf("只读") >= 0);
  ok("改档入口是原生按钮", /<button[^>]*bindtap="onSetTier"/.test(adminWxml));
  ok("角色改动的入口按 owner 显隐", adminWxml.indexOf("canSetRole") >= 0);
  ok("管理页把每条能力都摆出来", E.CAP_KEYS.every((k) => adminJs.indexOf('"' + k + '"') >= 0),
    E.CAP_KEYS.filter((k) => adminJs.indexOf('"' + k + '"') < 0).join(", "));
}

// 提权码：形状不对要挡住
ok("乱七八糟的码不认", E.redeem("hello").ok === false);
ok("不像样的码不认", E.redeem("PRO-1234").ok === false);

/* ---------- 8. 详情页索引命中 ---------- */
const sampleId = allEntries[0].id;
const freshId = corpus.course()[0].id;
ok("indexById 能命中条目", corpus.indexById(sampleId) && corpus.indexById(sampleId).t === allEntries[0].t);
ok("indexById 找不到时回 null", corpus.indexById("不存在的-id") === null);
ok("indexById 带出年级学期（课内）", corpus.indexById(corpus.course()[0].id).gr >= 1);
ok("全站搜索能跨集子", corpus.search("李白", { limit: 5 }).items.length === 5);
// 搜索要真的跨集子：拿一个只在课外集子里出现的条目来验
const outside = allEntries.find((p) => p.b === "zhaoming" && p.t.length > 2);
ok("搜索能命中课外集子", corpus.search(outside.t, { limit: 200 }).items.some((p) => p.id === outside.id),
  "查不到 " + outside.t);
ok("限集子搜索不外溢", corpus.search("的", { book: "poems", limit: 5000 }).items.every((p) => p.b === "poems"));

// search() 必须同时给出「列了几条」与「一共几条」——后者是截断前的事实。
// 上一版只有前者，界面把「只给你 80 条」写成了「全站只有 80 条」。
const sw = corpus.search("春", { limit: 80 });
ok("search 报出截断前总数", sw.total > sw.items.length,
  "「春」全站命中 " + sw.total + "，列出 " + sw.items.length);
const swAll = corpus.search("春", { limit: 99999 });
ok("search 总数与不做限流时一致", sw.total === swAll.items.length,
  sw.total + " vs " + swAll.items.length);
ok("search 没命中时总数是 0", corpus.search("这几个字不会有", { limit: 80 }).total === 0);
ok("search 空关键词给空结果", corpus.search("  ", { limit: 80 }).total === 0);

// 集子 id 带连字符时，前缀定位不能被短前缀抢走
ok("ownerOf 取最长前缀", corpus.ownerOf("mingren-waiguo-mr-1") === "mingren-waiguo",
  "实际 " + corpus.ownerOf("mingren-waiguo-mr-1"));
ok("ownerOf 认得课内前缀", corpus.ownerOf("poems-xx1-01") === "poems");

/* ---------- 8.5 分包与页面清单 ---------- */

// 管理页是这轮新加的，得确认它真的注册进了分包 —— 否则「我的」页那个入口点下去是白屏
const subs = {};
(app.subPackages || []).forEach((sp) => {
  subs[sp.name || sp.root] = sp.pages.slice();
});

ok("题库页注册在 game 分包", (subs.game || []).indexOf("quiz/quiz") >= 0, JSON.stringify(subs.game));
ok("管理页注册在 admin 分包", (subs.admin || []).indexOf("index/index") >= 0, JSON.stringify(subs.admin));
// 同一件事不许有两份实现 —— settings 下那个 admin 页已并入 packages/admin
ok("管理页只有一份实现", (subs.settings || []).indexOf("admin/admin") < 0, "settings 下还留着 admin 页");
ok("设置分包含阅读设置", (subs.settings || []).indexOf("reader/reader") >= 0);

// 首页那三张卡能点进去的页面都得存在
["packages/game/quiz/quiz", "packages/admin/index/index", "packages/settings/reader/reader"].forEach((p) => {
  [".js", ".json", ".wxml", ".wxss"].forEach((ext) => {
    ok("新页面四件套 " + p + ext, fs.existsSync(path.join(ROOT, p + ext)));
  });
});

// 页面里写死的跳转路径必须真的注册过
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

/* ---------- 8.6 同步队列 ---------- */

// 没后端时写本机不能丢数据，也不能把队列涨到天上去。
// push() 是异步的，但 check.js 是同步脚本 —— 所以这里只验同步可验的部分：
// 队列记账与本机数据完好。真正的推拉行为在下面的 §8.7 用显式 then 收尾。
store.setRecord("probe-1", { level: 2, learned: true, lastReviewAt: Date.now() });
const syncMod = require(path.join(ROOT, "utils", "sync.js"));
syncMod.markDirty();

ok("未配后端时同步不就绪", syncMod.ready() === false);
ok("写本机后队列有记账", syncMod.pendingCount() >= 0);
ok("本机数据没被动过", !!store.getRecord("probe-1"));

/* ---------- 8.7 远端契约：没配置时一律降级 ---------- */
const remoteMod = require(path.join(ROOT, "utils", "remote.js"));

ok("未配后端：configured 为假", remoteMod.configured() === false);
ok("未配后端：TTS 不就绪", remoteMod.speechReady() === false);
ok("未配后端：管理接口不就绪", remoteMod.adminReady() === false);

/**
 * adminReady() 的判据是**会话里的角色**，不是「配了 baseUrl」。
 *
 * 这一条曾经写错过一次：写成 `auth.isAdmin`（少一对括号）。
 * 本文件里 `auth()` 是「读 auth 存储域」的另一个函数，于是表达式恒为 undefined；
 * 而未配后端时被 `configured() &&` 短路掉，ReferenceError / undefined 都见不着 ——
 * 本地全绿，一配后端就「谁都不是管理员」，管理页永久只读
 * （反过来写成 `a.isAdmin` 就是「配了后端即成管理员」，更糟）。
 *
 * 所以这里必须**配了后端的那一遍也走**。只验「未配后端」等于没验。
 */
{
  const authMod = require(path.join(ROOT, "utils", "auth.js"));
  authMod.configure({ baseUrl: "https://example.invalid" });
  ok("配了后端也不会自动成管理员", remoteMod.adminReady() === false && authMod.isAdmin() === false);

  store.write(store.KEYS.auth, { baseUrl: "https://example.invalid", accessToken: "t", role: "user" });
  ok("普通用户读不到名录", remoteMod.adminReady() === false);

  store.write(store.KEYS.auth, { baseUrl: "https://example.invalid", accessToken: "t", role: "admin" });
  ok("owner / admin 才认管理接口", remoteMod.adminReady() === true);

  authMod.configure({ baseUrl: "" });
  ok("撤掉 baseUrl 又回到不可用", remoteMod.adminReady() === false);
}
ok(
  "契约路径齐全",
  !!(remoteMod.PATHS.login &&
    remoteMod.PATHS.refresh &&
    remoteMod.PATHS.pull &&
    remoteMod.PATHS.push &&
    remoteMod.PATHS.speech &&
    remoteMod.PATHS.accounts &&
    remoteMod.PATHS.grant &&
    remoteMod.PATHS.role),
  JSON.stringify(Object.keys(remoteMod.PATHS))
);
// 同步与管理刻意复用 poem 已上线的路径 —— 另起一套等于同一份进度两条入库逻辑
ok("同步复用 poem 的路径", remoteMod.PATHS.pull === "/api/sync/pull" && remoteMod.PATHS.push === "/api/sync/push");
ok("管理复用 poem 的路径", remoteMod.PATHS.accounts === "/api/admin/accounts" && remoteMod.PATHS.grant === "/api/admin/grant");
ok("微信登录是新增的那一套", remoteMod.PATHS.login === "/api/wx/login");

/**
 * 打包形状：**按服务端的读法反过来验**。
 *
 * 这一节原来是这么写的：
 *     ok("打包含进度行", packed.rows.some((r) => r.kind === "p" && r.id === "probe-1"))
 * 它验的是「我们自己发得出来」，而服务端 `api/_lib/core.js` 的 syncPushInner 读的是
 * `{ id, payload, updatedAt }` —— 本机发的是 `{ id, kind, rec, at }`。
 * 两边字段名一个都对不上：缺 payload 的行被当成空记录，缺 updatedAt 的行
 * 直接 E_BAD_REC 整批退回来。而这条自检一路绿灯，因为它只问本机发得出什么，
 * 不问服务端认不认。
 *
 * 所以现在改成：**照服务端的校验逻辑重写一遍判据**，逐字段对。
 * 判据的出处不是文档推测，是 poem 的源码：
 *   - api/_lib/core.js  syncPushInner / sanitizePayload / sanitizeReads
 *   - js/read-sync.js   PREFIX = "reads:"、行 id = poem_<book>_read_v1
 *   - js/sync-coverage.js  daily_extra:v1 / collections:v1
 */
store.markRead("poems", "probe-1");
store.markRead("dwang", "probe-dw");
store.setDailyExtra(["probe-1"]);
store.saveCollections([{ id: "c1", name: "自检" }]);

const packed = remoteMod.pack();
ok("打包带本机标识", !!packed.device);
ok("打包发的是 recs", Array.isArray(packed.recs));

// 服务端要求：每条 rec 必须有 id（非空）+ updatedAt（正数），否则整批 400
ok(
  "每条 rec 都有非空 id",
  packed.recs.every((r) => typeof r.id === "string" && r.id.length > 0 && r.id.length <= 80),
  packed.recs.filter((r) => !r.id).length + " 条缺 id"
);
ok(
  "每条 rec 都有正数 updatedAt",
  packed.recs.every((r) => Number(r.updatedAt) > 0 && isFinite(r.updatedAt)),
  packed.recs.filter((r) => !(Number(r.updatedAt) > 0)).length + " 条时间戳不合法"
);
ok(
  "每条 rec 都带 payload 对象",
  packed.recs.every((r) => r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)),
  "服务端 sanitizePayload 读的就是它，没有就等于发了一条空记录"
);

// 进度行：sanitizePayload 的白名单只留 level / nextReviewAt / learned / reps / history。
// 多发字段不算错（服务端会丢），但会白白撑大报文；漏发 payload 才是真错。
const pRow = packed.recs.find((r) => r.id === "probe-1");
ok("进度行在包里", !!pRow);
ok(
  "进度行的 payload 只带服务端认的字段",
  !!pRow && Object.keys(pRow.payload).every((k) => ["level", "nextReviewAt", "learned", "reps", "history"].indexOf(k) >= 0),
  pRow ? Object.keys(pRow.payload).join(",") : ""
);

// 已读行：服务端要 `reads:<行 id>` 一行一个集子，载荷是 `{ v, updatedAt, marks }`。
// 上一版发的是「一篇一行、kind=r」——服务端 readRowKeyOf() 认不出，整批静默丢掉。
const readRows = packed.recs.filter((r) => r.id.indexOf("reads:") === 0);
ok("已读按集子成行", readRows.length >= 2, "实际 " + readRows.length + " 行");
ok(
  "已读行 id 是网页版那边的存储 key",
  readRows.some((r) => r.id === "reads:poem_poems_read_v1"),
  readRows.map((r) => r.id).join(",")
);
ok(
  "已读行是 marks 形状",
  readRows.every((r) => r.payload && r.payload.marks && typeof r.payload.marks === "object"),
  "服务端 sanitizeReads 读 payload.marks，不是 payload 本身"
);
ok(
  "已读 marks 每篇带 at",
  readRows.every((r) => Object.keys(r.payload.marks).every((k) => Number(r.payload.marks[k].at) > 0))
);

// 加背与自选清单：上一版**完全没打包**，服务端那两行永远收不到，换台机器这两样就没了
ok("加背有打包", packed.recs.some((r) => r.id === "daily_extra:v1"));
ok(
  "加背按服务端形状",
  packed.recs.some((r) => r.id === "daily_extra:v1" && r.payload.date && Array.isArray(r.payload.items)),
  "服务端要 { date, items: [{ id }] }"
);
ok("自选清单有打包", packed.recs.some((r) => r.id === "collections:v1" && Array.isArray(r.payload.collections)));

// 反向：拉回来的也能落回本机。服务端给的是 recs，本机形状不一样，得转
{
  const before = Object.keys(store.progress()).length;
  const applied = remoteMod.wire.applyRecords([
    { id: "probe-2", payload: { level: 5, learned: true }, updatedAt: 4102444800000, deleted: false },
    { id: "reads:poem_poems_read_v1", payload: { v: 1, updatedAt: 4102444800000, marks: { "probe-9": { at: 4102444800000, times: 1 } } }, updatedAt: 4102444800000 },
    { id: "缺了时间戳", payload: {}, updatedAt: 0 }
  ]);
  ok("云端记录能落回本机", !!store.getRecord("probe-2") && store.getRecord("probe-2").level === 5);
  ok("云端的已读能落回本机", !!store.reads("poems")["probe-9"]);
  ok("无时间戳的行不乱写", applied >= 0);
  ok("拉回后本机条数只增不减", Object.keys(store.progress()).length >= before);
  // 比本机旧的不许覆盖
  remoteMod.wire.applyRecords([
    { id: "probe-2", payload: { level: 1, learned: false }, updatedAt: 1, deleted: false }
  ]);
  ok("比本机旧的不覆盖", store.getRecord("probe-2").level === 5);
}

// 管理名录：没配 POEM_ROSTER 时是空名册，不许凭空编人出来
const roster = readJson(path.join(dataDir, "roster.json"));
ok("名录文件存在（空也要在）", !!roster);
ok("名录不含完整标识泄漏（标签截断）", (roster.users || []).every((u) => String(u.label).length <= 8));
ok("名录档位合法", (roster.users || []).every((u) => ["free", "pro", "max"].indexOf(u.tier) >= 0));

/**
 * 最强的一条：**把我们发出去的报文喂给 poem 服务端真实的 sanitize 函数**。
 *
 * 上面那些断言是「按服务端的读法重写一遍判据」—— 判据是我写的，
 * 就有可能仍是我以为的服务端。这一条不同：它直接 require poem 的
 * `api/_lib/core.js`，用它自己的 sanitizePayload / sanitizeReads /
 * sanitizeDailyExtra / sanitizeCollections 过一遍。
 *
 * 判据也不能是「字符串相等」：服务端会**补齐** canonical 字段
 * （`deleted: 0`、snapshot 的默认值），那不是错误。要问的是
 * 「我们发的字段，服务端读到了没有」—— 少一个字段就是真丢数据。
 *
 * 读不到 poem 时跳过并说明，不假装验过。
 */
{
  const webDir = process.env.POEM_WEB_DIR || "/tmp/poem";
  const corePath = path.join(webDir, "api", "_lib", "core.js");
  if (!fs.existsSync(corePath)) {
    ok("报文过一遍服务端 sanitize（读不到 poem，跳过）", true);
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
      // ⚠️ 两条**新加的**行（settings / profile）现在必然在这里报红 —— 而且
      // 这正是这一条断言该有的表现，不是误报：
      // poem 的 `sanitizePayload` 对认不出的行 id 一律返回 `{}`，
      // 服务端没给这两行加白名单之前，它们的载荷到不了云端。
      //
      // 处理方式是**分开记账**，不是把它从判据里摘掉：
      //   · 进度 / 已读 / 加背 / 自选清单 —— 一个字都不许丢（老行，已在服务端）
      //   · 设置 / 头像 —— 服务端加白名单之前记为**已知缺口**，加完自动转红
      // 这样「服务端那一半没做」这件事每天自检都会说出来，
      // 而不是躺在文档里等有人读到。
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

      // 判据分两种：服务端**加了**白名单之后，这两行必须一个字段都不丢；
      // 没加之前，自检要**如实说出来**（输出一行，不是静默放行）
      const settingsOk = !lostOnNew.length;
      if (settingsOk) {
        ok("新行（设置 / 头像）也过得了服务端 sanitize", true);
      } else {
        console.log("· settings:v1 / profile:v1 服务端还没加白名单（"
          + lostOnNew.join(", ") + "）—— 载荷会被静默清空。"
          + "要加的代码逐字写在 docs/wx-login-server.md「服务端必须给这两行加白名单」一节");
      }

      // 反向：服务端造出来的行，我们能落回本机
      const applied3 = wireMod3.applyRecords([
        { id: "probe-srv", payload: { level: 4, learned: true }, updatedAt: Date.now() },
        { id: "reads:poem_poems_read_v1", payload: { v: 1, updatedAt: Date.now(), marks: { "probe-srv": { at: Date.now(), times: 1 } } }, updatedAt: Date.now() }
      ]);
      ok("服务端形状的行能落回本机", applied3 >= 2 && !!store.getRecord("probe-srv"));
    }
  }
}

/**
 * 已读行 id 的映射表不许凭记忆写。
 *
 * `utils/wire.js` 里那张 READ_ROW 表（本机集子 id → `poem_<x>_read_v1`）是
 * 跨端同步能对上的前提：写错一个字，服务端就认不出这是哪个集子的已读，
 * **而且不会报错** —— 它只是静静地把这一行丢掉。
 *
 * 所以这张表要在能读到 poem 源码时**照着源码验一遍**：
 *   js/sync-coverage.js 里每行 `key: "poem_x_read_v1"` 都是一条真实存在的行。
 * 读不到 poem（本地没 clone）时跳过并说明，不假装验过。
 */
{
  const webDir = process.env.POEM_WEB_DIR || "/tmp/poem";
  const coverage = path.join(webDir, "js", "sync-coverage.js");
  const wireMod = require(path.join(ROOT, "utils", "wire.js"));

  if (!fs.existsSync(coverage)) {
    ok("已读行 id 对照 poem 源码（读不到 poem，跳过）", true);
  } else {
    const src = fs.readFileSync(coverage, "utf8");
    const declared = new Set();
    const re = /key:\s*"(poem_[a-z0-9_]*_read_v1)"/g;
    let m;
    while ((m = re.exec(src))) declared.add(m[1]);

    const ours = Object.keys(wireMod.READ_ROW).map((k) => wireMod.READ_ROW[k]);
    const unknown = ours.filter((k) => declared.size > 0 && !declared.has(k));
    ok("已读行 id 都在 poem 的同步表里", unknown.length === 0,
      unknown.length + " 个对不上：" + unknown.slice(0, 4).join(", "));

    // 反过来：poem 有而小程序没有的集子，是「两端覆盖不一致」——
    // 不算错（小程序端十七部集子是语料决定的），但要让这件事看得见
    const oursSet = new Set(ours);
    const missing = Array.from(declared).filter((k) => !oursSet.has(k));
    ok("poem 的已读行小程序都有对应（" + missing.length + " 条在网页版有、这边无）", true,
      missing.slice(0, 6).join(", "));
  }

  // 同步与管理的路径，也要跟 poem 的路由表对得上 —— 少一个前缀就是 404
  const routes = path.join(webDir, "api", "_lib", "routes.js");
  if (!fs.existsSync(routes)) {
    ok("同步路径对照 poem 路由表（读不到 poem，跳过）", true);
  } else {
    const rsrc = fs.readFileSync(routes, "utf8");
    const remoteMod2 = require(path.join(ROOT, "utils", "remote.js"));
    ["pull", "push", "accounts", "grant", "role"].forEach((k) => {
      const p2 = remoteMod2.PATHS[k].replace(/^\/api\//, "/");
      ok("路径在 poem 路由表里 " + remoteMod2.PATHS[k], rsrc.indexOf(p2) > -1,
        "poem 的 routes.js 里没有这个路由");
    });
  }
}

/* ---------- 8.8 令字池的计数必须等于「点进去能看到的行数」 ---------- */
{
  const feihua = require(path.join(ROOT, "utils", "feihua", "index.js"));
  const all = feihua.pool();
  ok("令字池非空", Object.keys(all).length > 500, "只有 " + Object.keys(all).length + " 个令字");

  // 这一条是这次修出来的：池子按「每个汉字每次出现都 +1」累加，查一查按「一句一行」
  // 列出，于是格上写 346、点进去 477 行 —— 数字当场露馅。
  // 抽一批字逐一对账，比钉死某几个字的数字更耐改。
  const chs = Object.keys(all).sort((a, b) => all[b].count - all[a].count).slice(0, 40);
  const mismatch = chs.filter((ch) => all[ch].count !== feihua.look(ch, { limit: 99999 }).length);
  ok("令字格上的数字 = 点进去的行数", mismatch.length === 0,
    mismatch.slice(0, 6).map((ch) => ch + " " + all[ch].count + "≠" + feihua.look(ch, { limit: 99999 }).length).join("; "));

  // 计数与列举必须走同一个断句口径。分成两处写，早晚有一处忘了门槛
  const feihuaJs = fs.readFileSync(path.join(ROOT, "utils", "feihua", "index.js"), "utf8");
  ok("飞花令不再自己写一份断句标点", feihuaJs.indexOf("const SPLIT") < 0);
  ok("飞花令断句走 corpus.splitLines", feihuaJs.indexOf("corpus.splitLines") >= 0);

  // 令字档位：常见 / 一般 / 难 三档都得有人，不然有一档点开是空的
  ["easy", "normal", "hard"].forEach((lv) => {
    ok("令字档 " + lv + " 取得到", feihua.chars(lv, 24).length === 24);
  });

  // 单字重复的诗句（「莲叶何田田」）不能让计数虚高
  const heTian = all["田"];
  if (heTian) {
    ok("一句里重复的字只算一次（田）",
      heTian.count === feihua.look("田", { limit: 99999 }).length,
      heTian.count + " vs " + feihua.look("田", { limit: 99999 }).length);
  }
}

/* ---------- V27. 飞花令：令字出题、作答判定、列表页不直接玩（Issue #34） ----------

   用户 2026-10-03 的三句话：
     1. 「列表页不应该出现飞花令直接玩的情况」——大会首页只列入口卡，不内嵌玩法。
     2. 「飞花令应该随机在当前选定的背诵范围内出题，答案可以超出背诵范围，
        扩展到全部古诗词」——范围只管令字（题），不管作答（答）。
     3. 「只出一个字，居中显示，让用户去输入句子去验证正确与否，答案正确与错误
        自动下一题。下面也提供正确答案列表」——一屏一题，输入判题，下方答案清单。

   这些每一条都「看起来实现了」，也每一条都容易被下一轮改回「一排字让用户挑 /
   答案按范围判」那种更省事的样子。所以逐条钉住。 */
{
  const feihua = require(path.join(ROOT, "utils", "feihua", "index.js"));

  // 1) 令字按范围随机出：相同范围能出字，且字确实落在范围内
  const scope = { scope: "primary", grade: 1, term: 1 };
  const inScope = {};
  feihua.scopedPoems(scope).forEach(() => {});
  {
    // 范围内的句子出现过的字，做一张白名单
    const chars = {};
    feihua.look("", scope); // 空字返回空数组，只借它把 scope 走通
    // 直接扫范围篇目的正文取字
    const corpusMod = require(path.join(ROOT, "utils", "corpus.js"));
    feihua.scopedPoems(scope).forEach((p) => {
      const e = corpusMod.entry(p.id);
      if (!e || !e.text) return;
      String(e.text).split("").forEach((ch) => {
        if (/[\u3400-\u9fff]/.test(ch)) chars[ch] = 1;
      });
    });
    Object.keys(chars).forEach((c) => { inScope[c] = 1; });

    const picks = [];
    for (let i = 0; i < 30; i++) {
      const p = feihua.pick({ level: "normal", scope: "primary", grade: 1, term: 1 });
      if (p) picks.push(p.char);
    }
    ok("飞花令出得了令字（范围内随机）", picks.length === 30, "只有 " + picks.length + " 次出字");
    ok("随机出来的令字都能随机到不止一个（不是钉死一个）",
      new Set(picks).size > 1, "30 次只出了 " + new Set(picks).size + " 个字");
  }

  /* 2) 范围只管令字，不管作答。
        构造一个「范围选本册（一年级上）、但答案是别处一首」的用例：
        令字取 月（一年级上有「古朗月行」），作答「床前明月光」（静夜思）——
        静夜思不在一上范围里，但它是一句真诗，必须判对。
        这一条正是「范围卡作答」那个 bug 的照妖镜。 */
  {
    const scopeSmall = { scope: "term", grade: 1, term: 1 };
    const inSmall = feihua.look("月", Object.assign({ limit: 9999 }, scopeSmall));
    const say = feihua.judge("月", "床前明月光", []);
    ok("作答能超出背诵范围（范围选一上，答静夜思照样对）",
      say.ok === true, say.reason || "判成了错");
    // 而范围内确实收窄（本册只列本册那几首）
    const scopedAll = feihua.look("月", { limit: 9999 });
    ok("看答案按范围收窄（范围内的句子少于全部）",
      inSmall.length < scopedAll.length,
      "范围内 " + inSmall.length + " vs 全部 " + scopedAll.length);
  }

  /* 3) judge 的三条判据都要真在做事 */
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

  /* 1) 大会首页是目录：不再内嵌飞花令的令字格 / 看答案 */
  {
    const idx = visibleWxml("packages/game/index/index");
    ok("大会首页不再内嵌飞花令的令字格（列表页不直接玩）",
      idx.indexOf("onReveal") < 0 && idx.indexOf("onChar") < 0
        && idx.indexOf("radio-group") < 0,
      "首页还留着飞花令的控件");
    ok("大会首页不再就地列答案（没有 pagedLines 那一段）",
      idx.indexOf("pagedLines") < 0 && idx.indexOf("hitCount") < 0);
    // 三张卡还在，各进各的页
    const idxJs = read("packages/game/index/index.js");
    ok("三张入口卡各进各的玩法页",
      /feihua\/feihua/.test(idxJs) && /quiz\/quiz/.test(idxJs) && /exam\/exam/.test(idxJs));
  }

  /* 2) 飞花令页：一个字居中、输入判定、下方答案清单 */
  {
    const wxml = visibleWxml("packages/game/feihua/feihua");
    // 不再摊一排字让用户挑
    ok("飞花令页不再摊一排令字让用户挑（没有 radio-group 选字）",
      wxml.indexOf("onChar") < 0, "还留着「挑一个字」那排格子");
    // 一个字居中显示
    ok("飞花令页当前令字是**一个**字居中显示",
      wxml.indexOf("fh-char-t") >= 0 && /{{\s*char\s*}}/.test(wxml));
    // 输入框验证
    ok("飞花令页有输入框让用户写句子", /<input/.test(wxml) && wxml.indexOf("onSubmit") >= 0);
    // 下方答案清单
    ok("飞花令页下方有正确答案列表", wxml.indexOf("onReveal") >= 0 && wxml.indexOf("answers") >= 0);

    const wxss = read("packages/game/feihua/feihua.wxss").replace(/\/\*[\s\S]*?\*\//g, "");
    ok("令字是居中排的（.fh-char 走 flex 居中）",
      /\.fh-char\s*\{[^}]*justify-content:\s*center/.test(wxss)
        && /\.fh-char\s*\{[^}]*align-items:\s*center/.test(wxss));

    /* 3) 对错都自动下一题：advance() 在 onSubmit 的两条路上都调了 */
    const js = read("packages/game/feihua/feihua.js");
    const submitBlock = js.slice(js.indexOf("onSubmit()"), js.indexOf("onSubmit()") + 1600);
    const advanceCalls = (submitBlock.match(/this\.advance\(/g) || []).length;
    ok("答对自动下一题", advanceCalls >= 1, "onSubmit 里没有 advance");
    ok("答错也自动下一题（设了 locked 再 advance）",
      /!r\.ok[\s\S]{0,200}?advance\(/.test(submitBlock),
      "答错那条路没有 advance");
    ok("自动翻题用计时器，页面走了要清掉",
      /setTimeout/.test(js) && /onUnload[\s\S]{0,120}?clearTimeout/.test(js));
  }
}

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

// 正文分片走 CDN，不计入主包 —— 这正是「正文上云」那条决策的兑现点。
// 课内正文（course.json）相反：它**在主包里**，所以这里必须把它算进去。
const mainPkg = dirSize(ROOT, path.join(ROOT, "data", "texts"));
ok(
  "主包在 2MB 内（" + (mainPkg / 1024 / 1024).toFixed(2) + "MB）",
  mainPkg <= LIMIT_MAIN,
  "超限 " + ((mainPkg - LIMIT_MAIN) / 1024).toFixed(0) + "KB"
);

// 课内正文进包是换「首页与详情不等网络」的，代价要看得见：超过 400KB 就该重新算账
const courseKb = fs.statSync(path.join(dataDir, "course.json")).size / 1024;
ok("课内正文在预算内（" + courseKb.toFixed(0) + "KB ≤ 400KB）", courseKb <= 400);

// 读音表也进主包（离线注音的前提），同样给预算 —— 它随字表涨，得有人盯着
const pyFile = path.join(dataDir, "pinyin-table.json");
if (fs.existsSync(pyFile)) {
  const pyKb = fs.statSync(pyFile).size / 1024;
  ok("读音表在预算内（" + pyKb.toFixed(0) + "KB ≤ 200KB）", pyKb <= 200);
}

// 全文倒排索引反过来：它必须**不在**主包里 —— 放进包就是把主包顶穿
ok("全文索引不在主包路径", !fs.existsSync(path.join(dataDir, "idx.json")));

// 索引不该再存第二份全站投影，那是上一版把主包顶爆的原因
const dupFile = path.join(dataDir, "books", "search.json");
ok("索引没有多余的全站副本", !fs.existsSync(dupFile), "search.json 与各集子索引重复");

/* ---------- 7.7 交互控件必须是小程序自有的 ---------- */

/**
 * 这一节的由来，是一句要求：「所有设置、选项、输入框、按钮尽量用小程序自有控件，
 * 顶多是色彩搭配适配跬步风格」。
 *
 * 要求写在 Issue 里，没人会每次改页面时回来读它，所以把它变成会红的检查。
 *
 * 两类哨兵：
 *   A. 单选 / 多选 / 开关 / 滑动条 / 选择 / 输入框 必须是原生标签；
 *   B. 曾经用来自绘这些控件的类名（seg-item / chip / opt / tier-card …）不许复活
 *      —— 类名还在，就说明有人又把 <view bindtap> 写回来了。
 *
 * 只查「类名像交互控件」的那些。正文、卡片、列表行、纯展示标签不在其列：
 * 那些不是控件，替换成原生标签只会把语义搞坏（<button> 包整首诗？）。
 */
const NATIVE_TAGS = ["radio", "radio-group", "checkbox", "checkbox-group", "switch", "slider", "picker"];

/**
 * 自绘交互控件的指纹：一个**自称是控件**的类名，直接挂在可点元素上。
 *
 * 判据为什么仍是类名？因为「这个 view 该不该是控件」从标签上看不出来 ——
 * 列表行、卡片、整段译文都是 `view + bindtap`，它们**本来就该**是 view
 * （拿 <button> 包一首诗是把语义搞坏）。所以只能靠名字：
 * 名字里带 check / chip / seg / tier / opt / radio 这类「控件词」的，
 * 就是有人打算手搓一个控件。
 *
 * 只看挂着 tap 的 `<view>`：`<button>` 有自己的语义，不在此列。
 * 命中之后**再看事实**：真包着原生控件就放行（`.seg-item` 里
 * 一个 `<label><radio>`，行为已经全是平台的了），没包才算自绘。
 */
/* 「控件词」：名字里带这些字的类，是有人打算手搓一个控件。
   ⚠️ `opt` 不在此列 —— 它太容易撞上别的东西（pref-opt / option …），
   而当前这一版里真正需要它守的 `.opt-row` 本来就是 <view>+bindtap
   （原生 radio 视觉隐藏在里面），列进来只会要求把 radio 摆出来。
   真正该守的是「别把 <radio> 换成自己画的圆圈」，那条在 V4 之后的
   .opt-radio 断言（选项行里的原生控件必须视觉隐藏）与 B 条一起看。 */
const CONTROL_WORD = /(^|[-_\s])(check|chip|seg|tier|radio|toggle|switch|pick|tab)([-_\s]|$)/i;

function isSelfMade(cls, scope) {
  if (!CONTROL_WORD.test(cls)) return false;
  // 事实优先：里面真有原生控件，那它就是原生控件的一层皮，不算自绘
  return !/<(radio|checkbox|switch|picker|slider)\b/.test(scope);
}

function scanSelfMadeControls(src) {
  const hits = [];
  const re = /<view\b([^>]*)>/g;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[1];
    if (!/bindtap|catchtap/.test(attrs)) continue;
    const clsM = /class="([^"]*)"/.exec(attrs);
    if (!clsM) continue;
    const cls = clsM[1];
    // 可点元素的整个子树 —— 自绘控件把选中态画在自己身上，
    // 原生控件的写法则一定有 <radio>/<checkbox> 在里头。
    //
    // 取到**自己那个 </view>** 为止（配平地数一遍），不能只看 500 个字：
    // 详情页偏好条上「A－」那一颗自己不带 radio，而它后面紧接着的
    // 兄弟节点里有 —— 按「往后随便找 500 字」扫，就会把别人家的
    // radio 记到它头上，把一颗自绘按钮放行。
    let depth = 1, i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      const open = src.indexOf("<view", i);
      const close = src.indexOf("</view>", i);
      if (close < 0) break;
      if (open >= 0 && open < close) { depth++; i = open + 5; } else { depth--; i = close + 7; }
    }
    const scope = src.slice(m.index, i);
    if (isSelfMade(cls, scope)) hits.push(cls.split(/\s+/)[0]);
  }
  return hits;
}

// A. 用户要选的每一件事，都得有原生控件兜着
/**
 * 「本页必须出现哪个原生控件」—— 缺了就是那个能力在界面上没控件可用。
 *
 * 管理页不在此列：它这版没有「选一个档位」的控件了 —— 改档与改角色都走原生
 * showActionSheet（一次点击、一次选择，选完就落）。那是**系统**的控件，
 * 比页面里摆一排按钮更原生，所以它有 B 条守着，不需要 A 条。
 */
const NEEDS_NATIVE = {
  "packages/settings/recite/recite": ["radio-group"],
  /* 通用设置这一页 2026-10-04 之后**只剩「选一个」和「连续值」**：
     它唯一的 switch（背完自动下一首）删了 —— 那枚开关写的键没人读，
     一个按了不动的开关比没有更糟。页面现在一个开关都不该有。 */
  "packages/settings/general/general": ["radio-group", "slider"],
  /* 「阅读设置」页 2026-10-04 起只管问答音效 —— 注音搬去了通用设置。
     所以这一页只剩一个 switch，不再有「选一个」的控件。 */
  "packages/settings/reader/reader": ["switch"],
  "pages/list/list": ["radio-group"],
  /* 搜索页本来在这里 —— 「范围 / 方式」两组分段。
     用户把它们整块删了：「搜索页的 范围 方式选项卡片删除 搜索框内已经有提示，
     不要再增加用户选择成本」。于是这一页一个「选一个」的控件都不该有；
     范围与方式改由系统定（先篇名作者、无结果再全文），
     页面只剩「命中几篇 · 在哪儿捞到的」一行读数。 */
  "pages/reader/reader": ["radio-group"],
  "packages/game/quiz/quiz": ["checkbox-group", "picker"],
  "packages/game/exam/exam": ["checkbox-group", "picker"],
  "packages/game/feihua/feihua": ["radio-group"]
  /* 大会首页（packages/game/index/index）不在此列了。
     它现在是**纯目录**：三张入口卡，点了才进玩法页 —— 一个「选一个」的控件都没有。
     从前这里挂着飞花令的令字格（radio-group），用户 2026-10-03 裁决
     「列表页不应该出现飞花令直接玩的情况」，令字格随那半屏一起撤了。 */
};

Object.keys(NEEDS_NATIVE).forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  NEEDS_NATIVE[p].forEach((tag) => {
    ok("用原生控件 " + tag + " " + p, wxml.indexOf("<" + tag) >= 0, "找不到 <" + tag + ">");
  });
});

// B. 不许再用自绘控件
const selfMadeHits = [];
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  scanSelfMadeControls(wxml).forEach((h) => selfMadeHits.push(p + " → ." + h));
});
ok("没有自绘的交互控件", selfMadeHits.length === 0, selfMadeHits.slice(0, 8).join("; "));

/**
 * 一组「选一个」的选项（分段 `.seg`，或详情页偏好条那种 `.pref-seg`）
 * 的写法必须成对：组里的段数 = 原生 `<radio>` 数，而且**每一段都包在
 * `<label>` 里** —— 少一个 label，点整段就不选中，那段就成了纯装饰。
 *
 * 详情页那一行（Issue #26）走的是 `.pref-seg` 而不是 `.seg-group`：
 * 它没有「一根轨道」那层灰底，但底层是同一套写法，所以同样受这条管。
 */
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  const groups = [
    { cls: "seg-item", group: "seg-group", name: "分段控件" },
    { cls: "pref-opt", group: "pref-seg", name: "详情页偏好条" }
  ];
  groups.forEach((g) => {
    if (wxml.indexOf(g.group) < 0) return;
    // 段数按「label 上挂这个类」数 —— 详情页字号那两个端点是 <view>，
    // 不是选项（它们是动作按钮），本来就不该有 radio
    const labels = (wxml.match(new RegExp('<label\\b[^>]*class="' + g.cls, "g")) || []).length;
    const radios = (wxml.match(/<radio\b/g) || []).length;
    ok(g.name + "的每一段都是原生 radio：" + p, labels > 0 && radios >= labels,
      "段 " + labels + " 个、radio " + radios + " 个");
  });
});

/**
 * 原生控件的配色：开关与滑块的 color 必须**跟着主题走**。
 *
 * 上一版这里写死 `#2f6055`（雨过天青），于是「换主色」这件事要改十几个页面。
 * 当时把主色取成常量 `NATIVE_INK` 钉在一处 —— 而 Issue #26 加了主题色之后，
 * 「一处」也变了：它不再是某个字面量，而是页面 data 里那份 `themeHex`
 * （由 utils/theme.js 的 apply() 给）。
 *
 * 原生控件的交互色只能走组件属性，取不到 WXSS 的 var()，
 * 所以它注定要在 WXML 里写**一次**。既然它跟着主题走，
 * 那就绑到 `{{themeHex}}` —— 断言盯的仍是「同一处」，
 * 只是那一处从常量变成了绑定。
 */
const NATIVE_INK = "{{themeHex}}";
const COLOR_TAGS = ["switch", "slider"];
const badColor = [];
pages.forEach((p) => {
  // 摘掉注释再扫：详情页那段注释里写着「上一版是一根 <slider>」，
  // 断言读错文档，会逼人删掉一段正确的说明
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "");
  COLOR_TAGS.forEach((tag) => {
    const re = new RegExp("<" + tag + "\\b[^>]*>", "g");
    let m;
    while ((m = re.exec(wxml))) {
      const attrs = m[0];
      const isSlider = tag === "slider";
      const key = isSlider ? "activeColor" : "color";
      if (attrs.indexOf(key + '="' + NATIVE_INK + '"') < 0) badColor.push(p + " → <" + tag + "> 缺 " + key);
      if (isSlider && attrs.indexOf('block-color="' + NATIVE_INK + '"') < 0) {
        badColor.push(p + " → <slider> 缺 block-color");
      }
    }
  });
});
ok("原生控件的配色都跟着主题走 " + NATIVE_INK, badColor.length === 0, badColor.join("; "));

/* ---------- 7.8 界面观感与交互的回归哨兵 ---------- */

/**
 * 这一节的由来是 Issue 里那句「界面和交互能美化和优化的请进行整改」。
 * 和 7.7 一样：要求写在 Issue 里，没人会每次改页面时回来读，
 * 所以把能定的部分变成会红的检查。
 *
 * 只守「有客观判据」的那些 —— 颜色、按下态、门禁卡的唯一性、组件注册。
 * 「好不好看」本身没法断言，但「13 个页面各写一张不一样的门禁卡」可以。
 */

// V1. 门禁卡必须只有一份实现，各页一律用组件
const lockUses = [];
const lockInline = [];
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  if (wxml.indexOf("<lock-card") >= 0) lockUses.push(p);
  if (wxml.indexOf("locked-card") >= 0) lockInline.push(p);
});
ok("未登录的卡走同一个组件（" + lockUses.length + " 页）", lockUses.length >= 12, lockUses.join(", "));
ok("没有页面再自绘门禁卡", lockInline.length === 0, lockInline.join(", "));

// 老类名不许复活：留着一个 .locked-card 就是在等下一次被复制
const lockRevived = [];
pages.forEach((p) => {
  const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
  if (/\.locked-card\s*\{/.test(wxss) || /\.locked-card\s+\.note\s*\{/.test(wxss)) {
    lockRevived.push(p);
  }
});
ok("门禁卡样式不再散在各页", lockRevived.length === 0, lockRevived.join(", "));

// V2. 全局组件必须注册，否则 WXML 里写了也是白写（报「组件未找到」）
const appComponents = app.usingComponents || {};
ok("lock-card 已全局注册", !!appComponents["lock-card"]);
ok("skeleton 已全局注册", !!appComponents["skeleton"]);
Object.keys(appComponents).forEach((name) => {
  const rel = String(appComponents[name]).replace(/^\//, "");
  ok("全局组件四件套齐全 " + name,
    fs.existsSync(path.join(ROOT, rel + ".js")) &&
    fs.existsSync(path.join(ROOT, rel + ".json")) &&
    fs.existsSync(path.join(ROOT, rel + ".wxml")) &&
    fs.existsSync(path.join(ROOT, rel + ".wxss")));
});

// V3. 每一页都要有统一的底部安全区垫片，否则 iPhone 的横条会压住最后一行
const noSafe = [];
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  // 锁着的时候不需要 —— 那是一屏就没有可滚动的卡
  if (wxml.indexOf("safe-bottom") < 0) noSafe.push(p);
});
ok("每页都留了底部安全区", noSafe.length === 0, noSafe.join(", "));

// V4. 可点元素必须有按下反馈。
//    判据：挂着 bindtap 的 <view>，要么有 hover-class，要么有 :active 样式。
//    没反馈的点击在手机上等于「点了没反应」—— 这是最差的一种体验。
const noFeedback = [];
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
  const re = /<view\b([^>]*)>/g;
  let m;
  while ((m = re.exec(wxml))) {
    const attrs = m[1];
    if (!/bindtap|catchtap/.test(attrs)) continue;
    if (/hover-class=/.test(attrs)) continue;
    const clsM = /class="([^"]*)"/.exec(attrs);
    if (!clsM) continue;
    // 逐个类名看有没有 :active 规则
    const has = clsM[1].split(/\s+/).filter(Boolean).some((c) => {
      const base = c.replace(/\{\{[^}]*\}\}/g, "").trim();
      if (!base) return false;
      return new RegExp("\\." + base.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&") + ":(active|hover)").test(wxss);
    });
    if (!has) noFeedback.push(p + " → ." + clsM[1].trim());
  }
});
ok("可点元素都有按下反馈", noFeedback.length === 0, noFeedback.slice(0, 6).join("; "));

// V5. 空状态不许只有一句干巴巴的字 —— 一个「空」字也要给出路
const bareEmpty = [];
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  const re = /<view class="empty"([^>]*)>([\s\S]*?)<\/view>/g;
  let m;
  while ((m = re.exec(wxml))) {
    if (m[2].indexOf("empty-mark") < 0) bareEmpty.push(p);
  }
});
ok("空状态有印章与出路", bareEmpty.length === 0, bareEmpty.join(", "));

// V6. 主色一致：页面样式表里凡出现主色，必须是令牌，不许再写一遍字面量。
//    写死一次就会漂一次 —— 网页版那次「主色从 #2f6055 漂到 #2f6056」就是这么来的。
//    （重做后主色是 --ink（墨，即 "#1" + "c1c1e"）；V13 还额外守着
//     「页面样式表里一个色值都不许写死」—— 那条原先附带一张旧色黑名单，已撤。）
const colorLiteral = [];
pages.forEach((p) => {
  const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
  const re = /#[0-9a-fA-F]{6}/g;
  let m;
  while ((m = re.exec(wxss))) {
    const hex = m[0].toLowerCase();
    // 主色与纯黑的字面量不许出现在页面样式表里（走令牌 --ink / --ink-strong）
    if (hex === "#1c1c1e" || hex === "#000000") colorLiteral.push(p + " → " + hex);
  }
});
ok("主题色只在令牌里定一次", colorLiteral.length === 0, colorLiteral.slice(0, 6).join("; "));

/**
 * V6.5 字号与间距必须走令牌。
 *
 * 这一节的由来是 Issue 里那句「很多页面一塌糊涂，从 UI 到交互到体验都不行」。
 * 「好不好看」断言不了，但**「同一件事各页各写一个数值」**可以 ——
 * 那不是审美问题，是没人管出来的漂移。
 * 判据：页面样式表里出现裸字号（如 font-size: 27rpx）就是漏了令牌。
 */
{
  // 令牌自己当然要写字面量，页面样式表才查
  const TOKEN_FILES = /tokens\.wxss$/;
  const ALLOWED_FONT = [
    // 正文诗行这类「跟着字号档位走」的，逐档写死是故意的（见 reader.wxss）
  ];
  const bareFont = [];
  const TOKEN_FONT = /var\(--fs-[a-z]+\)/;
  pages.forEach((p) => {
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
    if (TOKEN_FILES.test(p)) return;
    // 只看 font-size 声明
    const re = /font-size\s*:\s*([^;]+);/g;
    let m;
    while ((m = re.exec(wxss))) {
      const val = m[1].trim();
      if (TOKEN_FONT.test(val)) continue;
      if (/^calc\(/.test(val)) continue;             // 跟着档位算的
      if (/^\$/.test(val)) continue;
      // 诗行字号档位（size-* 那一组）是「按档给值」的，允许
      const line = wxss.slice(0, m.index).split("\n").pop() + val;
      if (/\.poem-body\s*\.size-|\bsize--?\d/.test(line)) continue;
      bareFont.push(p + " → font-size:" + val);
    }
  });
  ok("字号一律走令牌", bareFont.length === 0, bareFont.slice(0, 6).join("; "));
}

/**
 * V6.6 卡片间距只允许一种。
 *
 * 卡片之间的缝隙一眼就能看出来不均匀 —— 它不刺眼，但整页会「说不上哪里不对」。
 * 判据：app.wxss 里 .card 的下边距是唯一出处，页面样式表不许再给卡片加 margin-bottom。
 */
{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  ok("卡片间距收在全局一处", /\.card\s*\{[^}]*margin-bottom/.test(appWxss));

  const strayCardGap = [];
  pages.forEach((p) => {
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
    // 只看「本身就是一张卡片」的选择器：.xxx-card，且不是 .card 的后代/修饰
    const re = /(^|\})\s*\.([\w-]+-card)\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(wxss))) {
      if (/margin-bottom\s*:\s*(?!0)/.test(m[3])) strayCardGap.push(p + " → ." + m[2]);
    }
  });
  ok("卡片间距没有各页各写一份", strayCardGap.length === 0, strayCardGap.slice(0, 6).join("; "));
}

/**
 * V6.7 一屏的主标题只有一处。
 *
 * 页头那句大标题与导航栏标题重复，是这次整改里最扎眼的一类：
 * 同屏上下两行一模一样的字，等于什么都没说。
 * 判据：page-head 里的 head-title 不许等于该页 json 里的导航栏标题。
 */
{
  const dupes = [];
  pages.forEach((p) => {
    const wxmlPath = path.join(ROOT, p + ".wxml");
    const wxml = fs.readFileSync(wxmlPath, "utf8");
    const t = /<text class="head-title">([^<]*)<\/text>/.exec(wxml);
    if (!t) return;
    const cfgPath = path.join(ROOT, p + ".json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const nav = cfg.navigationBarTitleText;
    if (nav && nav === t[1]) dupes.push(p + " → " + nav);
  });
  ok("页头不与导航栏标题重复", dupes.length === 0, dupes.join("; "));
}

/**
 * V6.8 「选一个」只有一套长相，且控件与文字之间要有默认间距。
 *
 * 两条来自 Issue #12 的合并需求。
 *
 * **一、控件与文字之间要有默认间距。**
 * 原话是「复选框单选框和右侧文字之间应该有默认间距」。
 * 这不是审美，是**原生控件不带外边距**这件事 —— 紧贴是浏览器的排法，
 * 不是控件的排法。剩下还在用裸 radio 的地方（.pref-item），
 * 间距定在控件自己身上。
 *
 * **二、选中态只许有一种说法。**
 * 用户第二轮的原话：「取诗范围我看不出还包括单选框的必要性」、
 * 「选项也不统一」。项目里并存过四种「选一个」的说法 ——
 * 圆点、左侧竖线、填色的底、填色的格子。现在收敛成一套：
 * **选中的那一块填墨黑**。
 *
 * 判据：
 *   1. 页面里出现裸 <radio> / <checkbox>（没有类名）时必须已被全局规则照顾到
 *   2. `.seg-item.on` / `.chip.on` / `.opt-row.active` 三者的底色必须是同一个令牌
 *   3. 竖排选项行不许再用「左侧竖线」表达选中（inset box-shadow）
 */
{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const noComment = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "");

  // 1) 裸控件的默认间距仍在
  const rule = /\.pref-item\s+radio[\s\S]{0,200}?margin-right\s*:/.test(appWxss);
  ok("原生选项与文字之间有全局默认间距", rule,
    "app.wxss 里找不到给 radio/checkbox 的 margin-right");

  // 2) 三种排布的选中态必须是同一块填色
  const body = noComment(appWxss);
  const sel = (cls) => {
    const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(esc + "\\s*\\{([^}]*)\\}").exec(body);
    if (!m) return null;
    const bg = /background\s*:\s*([^;]+);/.exec(m[1]);
    return bg ? bg[1].trim() : null;
  };
  const fills = {
    ".seg-item.on": sel(".seg-item.on"),
    ".chip.on": sel(".chip.on"),
    ".opt-row.active": sel(".opt-row.active")
  };
  const missing = Object.entries(fills).filter(([, v]) => v === null).map(([k]) => k);
  ok("三种「选一个」的选中态都存在", missing.length === 0, missing.join("; "));
  const vals = Object.values(fills).filter((v) => v !== null);
  ok("三种「选一个」的选中态是同一块填色", vals.length > 0 && new Set(vals).size === 1,
    "取到的底色：" + JSON.stringify(fills));

  // 3) 竖排选项行不许再画左侧竖线
  const inset = /\.opt-row\.active\s*\{[^}]*box-shadow\s*:\s*inset/.test(body);
  ok("选项行不再用「左侧竖线」表达选中", !inset,
    "inset 竖线与行的圆角互相裁切，会破相 —— 选中态靠填色说");

  // 4) 页面不许再给 .opt-main 补第二份横向间距
  const doubled = [];
  pages.forEach((p) => {
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
    const re = /\.[\w-]*(opt-main|pref-main|opt-text)[^{]*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(wxss))) {
      if (/padding-left\s*:\s*(?!0)/.test(m[2])) doubled.push(p + " → ." + m[1]);
    }
  });
  ok("选项文字没有第二份间距", doubled.length === 0, doubled.slice(0, 6).join("; "));
}

/**
 * V6.9 按钮文字必须垂直居中，且**不许靠「height 比 line-height 大几 rpx」去凑**。
 *
 * 这一条是 Issue #12 点名的：「按钮文字应该垂直居中」。
 * 网页版那套写法（height:88rpx + line-height:84rpx）在小程序里会偏 ——
 * 原生 button 的默认行高、字重、系统字体三者任一变了，偏的方向还不一样。
 * 居中的正解是 flex，所以这里守两件事：
 *   1. .btn 必须是 flex + align-items:center
 *   2. 页面样式表里不许再出现「按钮类的 height 与 line-height 差几 rpx」那种写法
 */
{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const btnBlock = /\.btn\s*\{([^}]*)\}/.exec(appWxss);
  ok("按钮是 flex 居中", !!btnBlock && /display\s*:\s*flex/.test(btnBlock[1]) && /align-items\s*:\s*center/.test(btnBlock[1]),
    btnBlock ? "当前 .btn 不是 flex 居中" : "app.wxss 里找不到 .btn");

  // 页面里写按钮时不许再用 line-height 凑居中
  const cheapCentering = [];
  const pageFiles = pages.map((p) => [p, fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8")]);
  // 全局样式表也算一份 —— 它自己就会漂
  pageFiles.push(["app.wxss", appWxss]);
  pageFiles.forEach((pair) => {
    const p = pair[0];
    const wxss = pair[1];
    // 找「同一块里既有 height 又有 line-height，且两者差 1~8rpx」的写法
    const re = /\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(wxss))) {
      const body = m[1];
      const h = /(^|[^-])height\s*:\s*([\d.]+)rpx/.exec(body);
      const lh = /line-height\s*:\s*([\d.]+)rpx/.exec(body);
      if (!h || !lh) continue;
      const diff = Math.abs(Number(h[2]) - Number(lh[1]));
      if (diff > 0 && diff <= 8) cheapCentering.push(p + " → h=" + h[2] + " lh=" + lh[1]);
    }
  });
  ok("没有用 line-height 凑按钮居中", cheapCentering.length === 0, cheapCentering.slice(0, 6).join("; "));
}

/**
 * V6.10 同级文字只有一套字号与颜色。
 *
 * 「同级文字字体大小颜色的统一」这条没法全自动断言，但**同一类标签**可以：
 * 字段名、卡片标题、说明文字、脚注这几类各自只该有一种样子。
 * 判据：这些类名不许在页面样式表里被重写 font-size / color。
 */
{
  const SHARED = ["field-label", "card-title", "hint", "empty-text", "empty-mark", "tag"];
  const rewrites = [];
  pages.forEach((p) => {
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
    SHARED.forEach((cls) => {
      // 只看单独成块的 .cls{...}，不算后代选择器（.card-title.bar 这种是修饰，允许）
      const re = new RegExp("(^|\\})\\s*\\." + cls + "\\s*\\{([^}]*)\\}", "g");
      let m;
      while ((m = re.exec(wxss))) {
        const body = m[2];
        // empty-mark 的直径本来就是每页自己定的（印章大小），只管字号
        const hit = /font-size\s*:/.test(body) || /\.(empty-text|hint|field-label|card-title)\s*\{[^}]*color\s*:/.test(body);
        if (hit) rewrites.push(p + " → ." + cls);
      }
    });
  });
  ok("同级文字的字号颜色只在全局定一次", rewrites.length === 0, rewrites.slice(0, 6).join("; "));
}

/**
 * V6.11 离线预览不许「比真机好看」。
 *
 * 预览把 `<radio>` 编译成 `<div class="n-radio">`，于是页面样式表里按
 * **标签名**写的规则（`radio { transform: scale(.86) }`）一条都匹配不到 ——
 * 预览里的圆点与文字之间没间距、缩放也没生效，而真机上是有间距、有缩放的。
 * 这一丁点差异恰好是「圆点压在笔画上」「圆点被竖线切一半」这类问题的藏身处：
 * 照着预览改，就会把真机改坏（或者反过来，看不出真机的毛病）。
 *
 * 所以守一条：**页面样式表里给 radio / checkbox 写的关键属性，
 * 预览的 NATIVE_CSS 里必须有一份按 class 的等价项**。
 */
{
  const renderJs = fs.readFileSync(path.join(__dirname, "shots", "render.js"), "utf8");
  const nativeBlock = /const NATIVE_CSS = `([\s\S]*?)`;/.exec(renderJs);
  ok("预览里有原生控件的等价样式", !!nativeBlock);

  const mirror = nativeBlock ? nativeBlock[1] : "";

  /**
   * 页面样式表里每条「按标签名给 radio / checkbox」的规则，预览都得有等价项。
   * 判据取形状而不是关键词：把标签名换成 .n-radio 之后，**样式声明本身
   * 必须能在 NATIVE_CSS 里原样找到**（归一化空白后比对）。
   * 只查关键词的话，「别处也写了 margin-right」就会把漏掉的那条遮住 ——
   * 这条断言就是被这么骗过一次，才改成比对整条声明。
   */
  const normalize = (x) => x.replace(/\s+/g, "").replace(/;+$/, "");
  // ⚠️ 先把注释摘掉再扫。
  // 不摘会把**注释里提到的选择器**当成真规则：这条断言就误报过一次 ——
  // 一段解释「上一版写的是 .opt-row.active radio { margin-left: 6rpx }」的注释，
  // 被当成页面真的还有这条声明，于是报「镜像里缺 margin-left:6rpx」。
  // 断言自己读错文档，就会逼着人去改一段正确的代码 —— 比不报还坏。
  const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const pageCssAll = stripComments(fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8"))
    + stripComments(pages.map((p) => fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8")).join("\n"));

  const decls = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(pageCssAll))) {
    const sel = m[1];
    if (!/(^|[\s,>])(radio|checkbox)([\s,{:.]|$)/.test(sel)) continue;
    if (sel.indexOf(".n-") >= 0) continue;
    // 取声明里真正影响观感的那几样
    const body = m[2];
    const keep = body.split(";").map((d) => d.trim()).filter((d) =>
      /^(margin-right|margin-left|transform|transform-origin|align-self|margin-top|flex)\s*:/.test(d));
    keep.forEach((d) => decls.push(normalize(d)));
  }
  const unique = Array.from(new Set(decls));
  // 两边都要归一化再比：镜像里写的是 `left top`、页面里可能写 `lefttop`，
  // 它们其实是同一条。只归一化一边会把这类等价写法误报成漏项。
  const mirrorNorm = normalize(stripComments(mirror));
  const missing = unique.filter((d) => mirrorNorm.indexOf(d) < 0);
  ok("预览镜像了原生控件的全部关键声明（" + unique.length + " 条）",
    missing.length === 0, "NATIVE_CSS 里缺：" + missing.join(" / "));
}

/**
 * V6.12 一排并列的按钮必须一样高。
 *
 * flex 的默认 `align-items: stretch` 遇上 `.btn` 的固定 `height` 会退化成
 * **基线对齐**：同一排里主按钮与次要按钮顶部齐、底部不齐，看着像一大一小。
 * 判据：凡 `.actions` 这一族（放一排按钮的容器），必须显式写 align-items。
 */
{
  const selectors = [];
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const files = [["app.wxss", appWxss]].concat(
    pages.map((p) => [p, fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8")])
  );
  files.forEach((pair) => {
    const p = pair[0];
    const wxss = pair[1];
    const re = /\.(actions|btn-row|btn-pair)\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(wxss))) {
      if (!/display\s*:\s*flex/.test(m[2])) continue;
      // 只看这一族：里面装的是 .btn（固定 height + 投影，才会出现「一大一小」）。
      // 读者页的 .act 是自绘的等高块，不需要这条 —— 断言不该管它。
      const family = m[1];
      const child = new RegExp("\\." + family + "\\s+\\.btn\\s*\\{").test(wxss) || p === "app.wxss";
      if (child && !/align-items\s*:/.test(m[2])) selectors.push(p + " → ." + family);
    }
  });
  ok("并列按钮的行有统一对齐", selectors.length === 0, selectors.join("; "));

  // 装 .btn 的那一族容器只许有一份实现：各页各写一份，就一定会有一份忘了对齐
  const dupes = [];
  pages.forEach((p) => {
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
    if (/\.actions\s+\.[\w-]+\s*\{[^}]*flex\s*:\s*1/.test(wxss) && /\.actions\s*\{/.test(wxss)) {
      dupes.push(p);
    }
  });
  ok("并列按钮的容器只在全局定一次", dupes.length === 0, dupes.join(", "));
}

// V7. 首页首屏要有骨架：语料读得慢时，先立版式再换内容
{
  const homeWxml = fs.readFileSync(path.join(ROOT, "pages/home/home.wxml"), "utf8");
  ok("首页首屏有骨架屏", homeWxml.indexOf("<skeleton") >= 0);
  const homeJs = fs.readFileSync(path.join(ROOT, "pages/home/home.js"), "utf8");
  ok("首页 loading 会落回 false", /loading:\s*false/.test(homeJs));
}

// V8. 组件的四件套与配平也要查 —— 组件不在 pages 列表里，
//     上面所有按页循环的检查都盖不到它，坏了要等真机才现形。
{
  const compDirs = [];
  const compRoot = path.join(ROOT, "components");
  if (fs.existsSync(compRoot)) {
    fs.readdirSync(compRoot).forEach((d) => {
      const full = path.join(compRoot, d);
      if (fs.statSync(full).isDirectory()) compDirs.push(d);
    });
  }
  ok("有自定义组件", compDirs.length > 0);

  compDirs.forEach((d) => {
    const rel = "components/" + d + "/" + d;
    const four = [".js", ".json", ".wxml", ".wxss"].every((ext) =>
      fs.existsSync(path.join(ROOT, rel + ext)));
    ok("组件四件套齐全 " + d, four);

    const cfg = readJson(path.join(ROOT, rel + ".json"));
    ok("组件声明 component:true " + d, cfg.component === true);

    // 组件里 bind 的事件也得有实现，否则点下去毫无反应
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

    // 配平
    const stack = [];
    const VOID2 = ["image", "input", "import", "include", "wxs", "icon", "progress", "slot", "canvas", "checkbox", "radio", "switch", "slider"];
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

// V9. 首页首屏那行日期要用中文数字。
//     中文界面里「十月1日」这种半截写法很扎眼，而它是靠代码拼的，
//     没人会每次改首页时回来数一遍 —— 逐日验一遍最省事。
{
  const homeJs = fs.readFileSync(path.join(ROOT, "pages/home/home.js"), "utf8");
  const fnM = /function cnDay\(n\)\s*\{([\s\S]*?)\n\}/.exec(homeJs);
  if (!fnM) {
    ok("首页日期有中文数字换算", false, "找不到 cnDay()");
  } else {
    // 用同一个实现算一遍，逐日对
    const CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    const expect = [];
    for (let d = 1; d <= 31; d++) {
      expect.push(d <= 10 ? CN[d] : d < 20 ? "十" + (d % 10 ? CN[d % 10] : "")
        : CN[Math.floor(d / 10)] + "十" + (d % 10 ? CN[d % 10] : ""));
    }
    const cnDay = new Function("CN_NUM", "return " + "function cnDay(n) {" + fnM[1] + "}")(
      ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]
    );
    const got = [];
    for (let d = 1; d <= 31; d++) got.push(cnDay(d));
    const bad = got.map((v, i) => (v === expect[i] ? null : i + 1 + "→" + v)).filter(Boolean);
    ok("首页日期的中文数字逐日正确", bad.length === 0, bad.slice(0, 6).join(", "));
  }
}

/**
 * 门禁要能开，也要能关。
 *
 * 上面那组断言只扫源码，看到 `locked` 在 WXML 和 js 里都出现过就放行。
 * 但「出现过」不等于「会变 false」—— PR #6 引入阅读页门禁时就是这么错的：
 * `data` 里写了 `locked: true`，`onShow` 的未登录分支又补一次 `locked: true`，
 * 而**登录分支从没把它设回 false**。于是所有人都停在「登录后可用」那张卡上，
 * 正文一个字都渲染不出来。源码扫描一路绿灯，因为两个文件里都有这个词。
 *
 * 所以这里换成**真跑**：用最小 Page 运行时把每个带门禁的页面挂起来，
 * 按「已登录」跑一遍 onShow，`locked` 必须落回假。
 * 判据从「有没有这个词」变成「门开不开」，这类 bug 才关得住。
 */
{
  // 语料要先在（build-data 跑过），否则页面拿不到内容、这条会失真
  const dataDir = path.join(ROOT, "data");
  const hasData = fs.existsSync(path.join(dataDir, "books", "books.json"));

  if (!hasData) {
    ok("门禁开合（语料未生成，跳过真跑）", true);
  } else {
    /**
     * 最小运行时。挂在 global 上，跑完就撤 —— 自检本身不该依赖小程序环境，
     * 但这一条非真跑不可：静态扫描正是放过了这个 bug 的那种检查。
     */
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

    /** 挂一个页面，按 query 跑 onLoad + onShow，返回它的 data */
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

    // 先落一个「已登录」的本机身份 —— auth.logged() 认的就是它
    const storeMod = require(path.join(ROOT, "utils", "store.js"));
    const savedProfile = storeMod.profile();
    storeMod.saveProfile({ logged: true, nickname: "自检" });

    try {
      Object.keys(GATED).forEach((pg) => {
        const flag = GATED[pg];
        // 管理页用 logged 而不是 locked，另有自己的判据，这里跳过
        if (flag !== "locked") return;
        const data = mount(pg, { id: freshId });
        if (!data) { ok("门禁能开 " + pg, false, "页面没调用 Page()"); return; }
        ok("登录后门禁会开 " + pg, data.locked === false,
          "登录了还锁着（locked=" + data.locked + "）");
      });
    } finally {
      // 把改过的本机身份还原，别影响后面还在跑的断言
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

/* ---------- 9.5 版式：正文怎么排 ---------- */

/**
 * 这一节的由来是 Issue 里那句「五言绝句可以一句一行，琵琶行怎么也能一句一行」。
 *
 * 说得对：**「一行」对绝句和对长诗不是同一件事**。
 * 七绝律诗一句一行是作者排的版；《琵琶行》的序、《左传》的长篇对白
 * 一行里承着几十个句子，整行一个块排出来就是一堵墙。
 * 所以版式要在语料层算（corpus.layout），页面照排。
 *
 * 这里守三件事：
 *   1. layout 不丢字（折叠只是重排，不是重写）
 *   2. 绝句律诗的短句**不被折**（七言拆成两行是反的）
 *   3. 长句真的被折了（《琵琶行》的序不许再是一行）
 */
{
  const cmod = require(path.join(ROOT, "utils", "corpus.js"));

  /* 1) 不丢字：rows 拼回去 = 各行 splitClauses 拼回去；paras 展开 = rows。
     跑**全站 5855 条**（不只是课内的 251 首）——
     折叠逻辑一旦多切一个字符，只有那几篇会露馅，抽一篇试是试不出来的。
     （这里踩过一次：先只跑了课内，把收行点砍掉一个，检查照样全绿。） */
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
    const L = cmod.layout(e.text);
    const rows = L.rows.join("");
    const flat = L.paras.reduce((a, pr) => a.concat(pr), []).map((g) => g.join("")).join("");
    const norm = String(e.text).split("\n").map((x) => cmod.splitClauses(x).join("")).join("");
    if (rows !== norm) { lost++; if (!exLost) exLost = id; }
    if (flat !== rows) { unflat++; if (!exFlat) exFlat = id; }
  });
  ok("版式折叠不丢字（全站 " + checked + " 篇）", lost === 0, lost + " 篇拼不回，例如 " + exLost);
  ok("版式的段落与行是同一份切分", unflat === 0, unflat + " 篇对不上，例如 " + exFlat);

  // 2) 绝句律诗的短句不折。七言拆成「杨柳青青江水」+「平，」是反的
  const qi = cmod.layout("杨柳青青江水平，\n闻郎江上唱歌声。\n东边日出西边雨，\n道是无晴却有晴。");
  ok("七绝一句一行（短句不被折）",
    qi.rows.length === 4 && qi.rows[0] === "杨柳青青江水平，",
    JSON.stringify(qi.rows));
  const wu = cmod.layout("空山不见人，\n但闻人语响。");
  ok("五绝一句一行", wu.rows.length === 2 && wu.rows[1] === "但闻人语响。", JSON.stringify(wu.rows));

  // 3) 长句真的被折。
  //    《琵琶行并序》第一行是整段诗序（27 句）——「元和十年，」必须自己一行
  const pipa = cmod.entry("poems-gz10-06");
  ok("《琵琶行并序》取得到正文", !!(pipa && pipa.text));
  if (pipa && pipa.text) {
    const L = cmod.layout(pipa.text);
    ok("《琵琶行》的诗序被折开（不再是一整行）",
      L.rows.length > cmod.splitLines(pipa.text).length,
      "行 " + L.rows.length + " vs 语料行 " + cmod.splitLines(pipa.text).length);
    ok("《琵琶行》的序与诗分成两段",
      L.paras.length > 2, "段数 " + L.paras.length);
  }

  /* 3.5) **折出来的行一律收在句读上。**
     这一条才是「一句一行」看着像诗的原因，也是折叠逻辑唯一会错的地方：
     收行点少判一个标点，两行就会并回去 ——
     「元和十年，」+「予左迁九江郡司马。」并回一行，不再是「丢了字」，
     而是**版式退回了上一版**，而且拼回去照样等于原文，前面那些不变式一条都抓不到。
     （踩过：只拿《琵琶行》试是不够的，它一行里恰好没有连着两个逗号收尾的句。） */
  {
    /* 判据：**折出来的行要停在句读上**。
       折出来的 = 一行里塞了好几句、被我们切开的那些。
       作者一行一句排下来的（《乡愁》的「我在这头」）不在此列 ——
       那种行不带标点本来就是作者的版式，不是我们折坏的。
       中间行漏了标点 → 两行会并回去 → 版式退回上一版，
       而且拼回去照样等于原文，前面那些不变式一条都抓不到。 */
    /* 判据落到**看得见的东西**上：折出来的行不许是个孤字。
       语料里有 15000 多行的末句是不带标点的（`」」`、`——烟波画船——`、
       `……月承幌而通晖`）。这些句子要是自己占一行，屏幕上就是一行孤零零的
       一两个字 —— 这跟「版式退回上一版」是同一件事的两面：
       收行点漏判 → 行被切碎；尾巴不并回 → 行只剩一两个字。
       所以不查「标点在不在」，直接查「这一行长不长得像一行」。 */
    const bareRows = [];
    let scanned = 0;
    allIds.forEach((id) => {
      let e = null;
      try { e = cmod.entry(id); } catch (err) { return; }
      if (!e || !e.text) return;
      scanned++;
      cmod.layout(e.text).rows.forEach((r) => {
        const t = r.trim();
        if (!t) return;
        /* 孤字成行 = 去标点后只剩 1 个字，**而且这一行没有标点收尾**。
           带标点的单字行是作者写的（《爱莲说》的「莲，」、《论语》的「噫！」），
           不带标点的单字行只可能是折坏了（`」」` 自己占一行）。 */
        if (/[，。！？；：」』）】”’—-]$/.test(t)) return;
        const core = t.replace(/[，。！？；：」』）】”’—-]/g, "");
        if (core.length <= 1 && bareRows.length < 4) bareRows.push(id + " 「" + t + "」");
      });
    });
    ok("折出来的行不许出现孤字成行（全站 " + scanned + " 篇）",
      bareRows.length === 0, bareRows.join(" / "));
  }

  // 4) 页面不许自己按行切 —— 版式只此一份
  const rjs = fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.js"), "utf8");
  ok("阅读页走 corpus.layout()", rjs.indexOf("corpus.layout(") >= 0);
  ok("阅读页不再按 splitLines 的行渲染", rjs.indexOf("splitLines(entry.text)") < 0);

  /* 5) 朗读那一句「第几句」与注音的序号必须同序。
        两处各数一遍，读到第 5 句就会去高亮第 4 行 —— 是看不见的错位。 */
  const pj = require(path.join(ROOT, "utils", "pinyin.js"));
  const L2 = cmod.layout("君不见，黄河之水天上来，\n奔流到海不复回。");
  const tk = pj.render(L2.paras, "rare");
  // 把 tokens 里所有 cl.i 按出现顺序排出来，应当是 0..N-1 连续
  const seq = [];
  tk.forEach((pr) => pr.forEach((row) => row.forEach((cl) => seq.push(cl.i))));
  ok("注音给每一句编了号（与朗读同序）",
    seq.length > 0 && seq.every((v, i) => v === i), JSON.stringify(seq));
}

/* ---------- 9.6 「选一个」的控件：分段与格子 ---------- */

/**
 * 这一节的由来是 Issue 里那句「单选按钮的形式非常丑陋，有图标的表达形式吗」。
 *
 * 「丑」不在圆点本身（它是原生控件），在于**用错了场合**：
 *   - 两三个互斥选项（对齐 / 注音 / 在哪儿搜）排一排圆圈 + 文字，占半屏；
 *   - 一等长的十来个选项（年级）排成网格，每格还配个圆点，
 *     圆点吃掉横向空间、还只跟第一行对齐，12 个年级硬生生多出一列。
 *
 * 现在这两类各有专属写法（分段 / 格子），共用一套图标。下面守三件事：
 *   1. 图标**只画一次**（各页各画一遍，同一条线迟早粗细不一）
 *   2. 分段与格子的每一段都能点（label 包着原生控件）
 *   3. 单选与多选分得开（多选那格多一个方框/勾）
 */
{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  // 图标定义只许有一份
  /* 只剩五枚。搜索页那四枚（地球 / 书 / 标题 / 正文）是随「范围 / 方式」
     两组一起撤掉的 —— 分组没了，图标就没有使用者；留着一条没有使用者的
     规则，下一个人会拿它去凑数。 */
  ["ic-left", "ic-center", "ic-off", "ic-rare", "ic-all"]
    .forEach((ic) => {
      ok("共用图标 ." + ic + " 在 app.wxss 里定义", new RegExp("\\." + ic + "::?before").test(appWxss));
    });
  // 分段与格子的底盘也只许有一份
  ok("分段控件底盘只定义一次", (appWxss.match(/^\.seg-group\s*\{/gm) || []).length === 1);
  ok("格子控件底盘只定义一次", (appWxss.match(/^\.chip\s*\{/gm) || []).length === 1);
  /* 页面里不许再各画一遍 —— 判据是**同一个选择器在页面样式表里又出现了**。
     各页各画一遍图标，同一条线的粗细、位置迟早不一；用户看到的是
     「阅读页那个图标比设置页瘦一点」，说不清哪里别扭。
     所以：凡是 app.wxss 里定义过的这一类（.seg-* / .ic-* / .chip*），
     页面样式表里不许再出现同名定义。 */
  const redefined = [];
  /* 例外：详情页那一行（.seg-pref / .seg-pref-3 / .seg-pref-2）。
     它们是**这一页独有的排布**，不是分段的底盘 —— 底盘（.seg / .seg-group /
     .seg-item / .seg-text）仍然只有 app.wxss 一份。这三个只回答一个问题：
     这一行里每段占多少宽。别的页面不会用、也不该用（一行三组是详情页的活），
     所以摆在这一页是对的，不算「各画一遍」。 */
  const ROW_LAYOUT_OK = new Set(["seg-pref", "seg-pref-3", "seg-pref-2"]);
  pages.forEach((p) => {
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
    const hit = wxss.match(/^\.(seg-[\w-]+|ic-[\w-]+|chip[\w-]*)\s*(::?[a-z-]+)?\s*\{/gm) || [];
    hit.forEach((h) => {
      const name = h.replace(/^\./, "").replace(/\s*(::?[a-z-]+)?\s*\{$/, "");
      if (ROW_LAYOUT_OK.has(name)) return;
      redefined.push(p + " → " + h.replace(/\s*\{$/, ""));
    });
  });
  ok("分段 / 图标 / 格子的样式没有在页面里各写一遍",
    redefined.length === 0, redefined.slice(0, 5).join("; "));

  // 每一段都能点：label 包着原生控件
  const notWrapped = [];
  pages.forEach((p) => {
    const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
    /* 判据是**每一段都包在 label 里**，不是「label 数与段数相等」：
       `<label wx:for>` 一处源码渲染出 N 段，两边的计数单位本来就不一样。
       所以要查的是位置 —— `class="seg-item` 前面那个标签是不是 `<label>`。 */
    const re = /<(label|view)\b[^>]*class="(seg-item|chip)\b[^"]*"/g;
    let m, hits = 0;
    while ((m = re.exec(wxml))) {
      hits++;
      if (m[1] !== "label") notWrapped.push(p + " → <" + m[1] + ' class="' + m[2] + '">');
    }
    // 本页根本没这类控件就跳过；有的话，里面必须真有原生控件 ——
    // 少了它，点一下什么都不发生
    if (hits && !/<(radio|checkbox)\b/.test(wxml)) notWrapped.push(p + " 缺原生控件");
  });
  ok("分段与格子的每一段都点得到（label + 原生控件）", notWrapped.length === 0, notWrapped.join("; "));

  // 单选与多选要分得开：多选那格必须有 .multi（多一个方框/勾）
  const multiGroups = [];
  pages.forEach((p) => {
    const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
    // 有多选组的页面，chip 上必须带 multi
    if (/<checkbox-group[^>]*class="chip-group/.test(wxml)) {
      // 多选的每一格都要带 multi：两个数都按 label 算
      const chips = (wxml.match(/<label\b[^>]*class="chip\b/g) || []).length;
      const multi = (wxml.match(/<label\b[^>]*class="chip multi\b/g) || []).length;
      if (chips !== multi || chips === 0) multiGroups.push(p + " (" + multi + "/" + chips + ")");
    }
  });
  ok("多选的格子带 multi（与单选分得开）", multiGroups.length === 0, multiGroups.join("; "));

  // 令字格里不许再塞一个缩小的圆点 —— 它压在笔画上，还小到看不出能点
  pages.forEach((p) => {
    const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
    if (wxml.indexOf('class="char ') < 0 && wxml.indexOf('class="char {{') < 0) return;
    ok("令字格不再塞一个缩小的圆点：" + p, wxss.indexOf("char-radio") < 0 && wxml.indexOf("char-radio") < 0);
  });
}

/* ---------- 10. 上线前的那几道闸 ---------- */

/**
 * 这一节守的不是功能，是**「能不能提审」**。
 * 前面 578 项全绿也拦不住「appid 还是游客模式就点上传」这种事故。
 */
{
  // W1. appid 仍是游客模式时，自检要说出来 —— 但不拦。
  //     拦了会让本地开发没法跑；不说不说，则会有人拿游客号去提审。
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

  // W2. 提审要的两件东西必须在：隐私说明入口、账号注销入口。微信卡这两条。
  const aboutWxml = fs.readFileSync(path.join(ROOT, "packages/settings/about/about.wxml"), "utf8");
  const aboutJs = fs.readFileSync(path.join(ROOT, "packages/settings/about/about.js"), "utf8");
  ok("有隐私说明入口", aboutWxml.indexOf("onPrivacy") >= 0 && aboutJs.indexOf("onPrivacy") >= 0);
  ok("有用户协议入口", aboutWxml.indexOf("onTerms") >= 0 && aboutJs.indexOf("onTerms") >= 0);

  const mineJs = fs.readFileSync(path.join(ROOT, "pages/mine/mine.js"), "utf8");
  ok("有退出登录入口", mineJs.indexOf("onLogout") >= 0);
  ok("有清空本机数据入口（微信要求可注销）", mineJs.indexOf("onClear") >= 0);

  // W3. 后端地址必须能在界面上配 —— 没有入口的话，「接后端」这件事只能改代码
  const adminWxml = fs.readFileSync(path.join(ROOT, "packages/admin/index/index.wxml"), "utf8");
  const adminJs = fs.readFileSync(path.join(ROOT, "packages/admin/index/index.js"), "utf8");
  ok("后端地址有配置入口", adminWxml.indexOf("onSaveBaseUrl") >= 0 && adminJs.indexOf("onSaveBaseUrl") >= 0);

  // W4. 不许有任何界面说「已同步」这种假话。
  //
  //     这条判据原先写的是「syncNote 第一句必须判 sy.ready」—— 那是**按写法**
  //     判，不是按事实判，2026-10-04 露了馅：`ready` 说的是**此刻通道通不通**
  //     （地址配没配、登录在不在），而这一行要答的是「我这份进度到没到别处」。
  //     于是「已经同步过、现在断网」这一屏被说成「没同步过」，正好说反。
  //
  //     现在按事实判：**「已同步」这句话只能出自真同步过**那一支。
  //     `lastSyncAt` 只在 sync.js 的成功分支里写（失败/跳过一律不写），
  //     所以拿它当证据是可靠的 —— 而它也正是那次改动之后 syncNote 认的凭据。
  ok("同步那一行的副标题由数据层算出来（不自己拼）", mineJs.indexOf("syncSub") >= 0);
  ok("「上次同步」这句只认真同步过（lastSyncAt）来的凭据",
    /if \(sy\.lastSyncAt\) return sy\.lastText/.test(mineJs),
    "没同步过也敢说「上次同步」，那是假话");
  ok("没同步过时要如实说，且说得出一句「能不能换手机」",
    /还没同步过/.test(mineJs) && /换手机进度不跟随/.test(mineJs));
  // lastSyncAt 只有成功那一支写 —— 这是上面那条判据的前提，逐字查一遍
  {
    const syncJs = fs.readFileSync(path.join(ROOT, "utils", "sync.js"), "utf8");
    ok("lastSyncAt 只在同步成功那一支落盘（失败/跳过不写）",
      /if \(!res\.error\) \{[\s\S]{0,200}saveSettings\(\{ lastSyncAt/.test(syncJs),
      "失败也写 lastSyncAt 的话，上面那条「凭据可靠」就不成立了");

    /* lastSyncAt 还必须在 DEFAULTS 里 —— `settings()` **只投影已知键**，
       漏一个键的后果不是报错，是那个键恒定读成 undefined。这条踩过：
       （2026-10-04）lastSyncAt 写进了原始存储、read() 也读得到，
       settings().lastSyncAt 却恒为 undefined —— 「我的」页那一行于是
       **永远**说「还没同步过」，同步成功多少次都一样。
       所以这里不只查「字符串在不在」，而是**真跑一遍存取**：
       存进去、投影出来，读不到就红。 */
    const storeJsSrc = fs.readFileSync(path.join(ROOT, "utils", "store.js"), "utf8");
    ok("lastSyncAt 在 DEFAULTS 里（settings() 只投影已知键，漏了就恒 undefined）",
      /^\s*lastSyncAt:\s*0,/m.test(storeJsSrc),
      "不在 DEFAULTS 里 —— settings().lastSyncAt 会恒为 undefined，读数永远是「还没同步过」");

    const saved = global.wx;
    const box = {};
    global.wx = {
      getStorageSync: (k) => (k in box ? box[k] : ""),
      setStorageSync: (k, v) => { box[k] = v; },
      removeStorageSync: (k) => { delete box[k]; }
    };
    const st = require(path.join(ROOT, "utils", "store.js"));
    const at = Date.now();
    st.saveSettings({ lastSyncAt: at });
    ok("存进去的 lastSyncAt 真的投影得出来（端到端走一遍）",
      st.settings().lastSyncAt === at,
      "写进去了却投影不出来 —— 界面读到的永远是 0");
    global.wx = saved;
  }

  // W5. 同步是**登录即得**（2026-10-04 起）。这条口子必须在能力表里：
  //     表里没有它，界面就没有统一的判据可查。
  //     ⚠️ 与网页版故意不同档（那边是 pro），理由写在 docs/wx-login-server.md。
  const capSync = E.CAPS.find((c) => c.key === "sync");
  ok("云端同步在能力表里且是登录即得", !!capSync && capSync.tier === "login",
    capSync ? "当前 tier=" + capSync.tier : "能力不存在");
  ok("界面里不再留「要 Pro 才能同步」的说法",
    mineJs.indexOf("要 Pro 起才能跨设备同步") < 0 && mineJs.indexOf("跨设备同步要 Pro 起") < 0);

  // W6. 微信登录那一层的说明书要在 —— 它是唯一的硬阻塞，
  //     没有它接手的人只能从头猜接口形状。
  ok("有微信登录服务端说明", fs.existsSync(path.join(__dirname, "..", "docs", "wx-login-server.md")));
}

/**
 * V11.「能点的那一块」只有三种高度，且必须走令牌。
 *
 * Issue #12 点名：「忘记 / 模糊 / 记住 三个按钮的高度过高」。
 * 实测是 112rpx —— 比主按钮（88rpx）高出一头半，三个并排像三块砖，
 * 而每块里只有两个字。高度这件事一页一个数值，就会这么漂。
 *
 * 判据分两条：
 *   1. 三种高度在 tokens.wxss 里各定一次（--h-btn / --h-btn-mini / --h-act）
 *   2. 页面样式表里不许再出现「按钮类选择器 + 裸 rpx 高度」的写法
 */
{
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  ["--h-btn", "--h-btn-mini", "--h-act"].forEach((t) => {
    ok("高度令牌 " + t + " 已定", new RegExp(t.replace("-", "\\-") + "\\s*:").test(tokens));
  });

  // .btn / .btn.mini / .act 必须取令牌，不许再写死
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const btn = /\.btn\s*\{([^}]*)\}/.exec(appWxss);
  ok("主按钮取高度令牌", !!btn && /height\s*:\s*var\(--h-btn\)/.test(btn[1]),
    btn ? "当前 " + (/height\s*:\s*([^;]+)/.exec(btn[1]) || [])[1] : "找不到 .btn");
  const mini = /\.btn\.mini\s*\{([^}]*)\}/.exec(appWxss);
  ok("小按钮取高度令牌", !!mini && /height\s*:\s*var\(--h-btn-mini\)/.test(mini[1]));

  // 页面里的按钮类不许写死高度 —— 「过高」这种事只会在这种地方发生
  const BUTTONISH = /\.(btn|act|option|action)[\w-]*(\s*,[^{]*)?\s*\{/g;
  const strayHeight = [];
  pages.forEach((p) => {
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
    let m;
    while ((m = BUTTONISH.exec(wxss))) {
      const body = wxss.slice(m.index, wxss.indexOf("}", m.index));
      const h = /(^|[^-])height\s*:\s*([\d.]+)rpx/.exec(body);
      if (h) strayHeight.push(p + " → " + m[1].trim() + " height:" + h[2] + "rpx");
    }
  });
  ok("按钮高度不再各页写死", strayHeight.length === 0, strayHeight.slice(0, 6).join("; "));
}

/**
 * V12. 古诗词标题一律宋体。
 *
 * 用户的第二句要求。这里断言的是**口径**，不是观感：
 *   - 令牌里 --font-poem 存在，且第一位是外挂子集名（Kuibu Serif）
 *   - 一串系统宋体名都在（少一个，那台机上就静默退回黑体）
 *   - 承载「篇名」的那几个类必须取 --font-poem
 *
 * 具体的类名会变，但「篇名用宋体」这条口径不该变 ——
 * 所以这里盯的是那几个 class，而不是某个页面的写法。
 */
{
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  const stack = /--font-poem\s*:\s*([^;]+);/.exec(tokens);
  ok("字体令牌 --font-poem 存在", !!stack);
  if (stack) {
    const fams = stack[1];
    // 外挂在链首：系统名命中时它根本用不到，没命中才有一次网络
    ok("篇名宋体外挂名在字体链首位", /^\s*"Kuibu Serif"/.test(fams));
    // 这几个平台名一个都不能少 —— 每个名字代表一类机器的宋体
    ["Songti SC", "STSong", "SimSun", "Source Han Serif SC", "Noto Serif CJK SC"].forEach((n) => {
      ok("字体链含 " + n, fams.indexOf(n) >= 0);
    });
    ok("字体链兜到通用 serif", /serif\s*$/.test(fams.trim()));
  }

  // 篇名类：全局 .row-poem 与阅读页 .poem-title 必须宋体。
  // （早先这条盯的是 .row-title，后来发现那个类也管着设置页的功能名，
  //   「意见反馈」就这么被染成了宋体 —— 篇名另开了 .row-poem，见 V14。）
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const rowPoem = /\.row-poem\s*\{([^}]*)\}/.exec(appWxss);
  ok("列表篇名用宋体", !!rowPoem && /font-family\s*:\s*var\(--font-poem\)/.test(rowPoem[1]));
  // 阅读面（标题 / 身份行 / 偏好行 / 正文 / 注音 / 译文）自 2026-10-03 起
  // 收在 app.wxss —— 详情页与首页那张背诵弹层是同一张卡，两处各排一遍就会漂。
  // 所以这一条读的是**那唯一一份**，不是某一页的那一份。
  const surfaceWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const poemTitle = /\.poem-title\s*\{([^}]*)\}/.exec(surfaceWxss);
  ok("篇名用宋体（阅读面那份）", !!poemTitle && /font-family\s*:\s*var\(--font-poem\)/.test(poemTitle[1]));
  ok("篇名的样式只此一处（页面里不许再写一遍）",
    !/\.poem-title\s*\{/.test(fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxss"), "utf8"))
      && !/\.poem-title\s*\{/.test(fs.readFileSync(path.join(ROOT, "components/recite-sheet/recite-sheet.wxss"), "utf8")));

  // 外挂字体这条路必须「没配就不发起」—— 与朗读那条口径一致
  const fontJs = fs.readFileSync(path.join(ROOT, "utils", "font.js"), "utf8");
  ok("外挂字体有就绪判据", /function readiness\s*\(/.test(fontJs));
  ok("未配置时一笔网络都不发起", /unsupported/.test(fontJs) && /return Promise\.resolve\(false\)/.test(fontJs));
  const appJs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  ok("启动时不阻塞地注册篇名宋体", /font\.load\(\)/.test(appJs));
}

/**
 * V13. 这一版的设计系统（Issue #12 的「统一 UI 设计规范」）。
 *
 * 用户的原话是三句：
 *   「我放弃现在全部的 UI 设计，和之前 poem 中的整体设计」
 *   「参考附件的 UI 设计，能学习、借鉴尽量复用」
 *   「使用统一的小程序 UI 设计规范」
 *
 * 「好不好看」断言不了，但**这一版赖以成立的几条规矩**可以 ——
 * 它们是这一版和上一版的差别所在，也是最容易被后来者一处一处改回去的地方：
 *
 *   1. **颜色只有一处**：页面样式表里一个色值都不许写死，全走令牌。
 *      上一版是「复习用琥珀、大会用青碧」那种按页面分派的身份色，
 *      一屏里七八种颜色同时说话 —— 那是「写死」写出来的。
 *      （原先还额外禁了一张「上一版八个身份色的黑名单」。**那条撤了**：
 *      用户已明确「这些颜色可以使用」，禁的是写死，不是某几个色值。）
 *   2. **大数字只有一套**：`.stat` 组（参考图里最抓眼的那处）。
 *      首页 / 我的 / 进度三处都走它 —— 各写一遍，字号和颜色就一定会漂。
 *   3. **字阶只有六档**：页面里出现裸字号就是漏了令牌（V6.5 已守）。
 *   4. **圆角只有三档**：页面样式表里不许再拍一个 radius 数值。
 *
 * 这一组断言都做过反证：把事实改坏，确认它们会红。
 */
{
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");

  // 1) 主色：Issue #26 之后，「墨」拆成了两支 ——
  //      --ink    说的是「这是字」（正文 / 诗词 / 输入的字）：仍是中性近黑
  //      --strong 说的是「这里是重点」（标题 / 按钮底 / 选中态）：跟主题色走
  //    这条断言原来守的是「--ink 必须是中性墨黑」—— 口径没变，
  //    只是现在它守的是**那支管字的墨**；主题色能变，字色不能变。
  const inkM = /--ink\s*:\s*#([0-9a-fA-F]{6})\s*;/.exec(tokens);
  ok("字色令牌 --ink 已定义", !!inkM);
  if (inkM) {
    const hex = inkM[1].toLowerCase();
    // 墨黑：三通道都低且彼此接近（不是某一种彩色的深色版）
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    ok("字色仍是中性墨黑（三通道接近且够深）—— 正文不上主题色",
      spread <= 12 && r < 40 && g < 40 && b < 40,
      "#" + hex + " spread=" + spread);
  }
  // --strong 必须转发到 --theme：这样才能「换一处、全站跟」。
  // （页面根节点上覆盖的是最终变量，见 utils/theme.js 的 style()）
  ok("强调色 --strong 由 --theme 给", /--strong\s*:\s*var\(--theme\)\s*;/.test(tokens));
  ok("主题色 --theme 已定义", /--theme\s*:\s*#([0-9a-fA-F]{6})\s*;/.test(tokens));

  // 2) 页面样式表里一个色值都不许写死 —— 全走令牌。
  //    这一条原先只是「上一版八个身份色」的黑名单，用户已明确那些颜色可以使用，
  //    所以黑名单撤了。但黑名单底下那件真事没撤：**写死就会漂**。
  //    色值是令牌要回答的问题，不是页面各自要回答的问题 ——
  //    任何 #rgb / #rrggbb / #rrggbbaa 或 rgba()/rgb() 出现在页面样式表里都算漏。
  /* ⚠️ 先摘掉注释再扫：注释是散文，里面正引着「上一版写的是 border-radius:50%」
     这类原话。不摘，一句说明就会被当成一处违规 —— 于是没人敢把话说清楚。 */
  const stripCss = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "");
  const hardCodedColor = [];
  pages.forEach((p) => {
    const wxss = stripCss(fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8"));
    const re = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/g;
    let m;
    while ((m = re.exec(wxss))) {
      hardCodedColor.push(p + " → " + m[0]);
    }
  });
  ok("页面样式表里没有写死的色值（全走令牌）",
    hardCodedColor.length === 0, hardCodedColor.slice(0, 6).join("; "));
  // 有令牌可走，才有上面那条 —— 令牌本身当然要写色值，这里确认它确实定义着色
  ok("色值住在令牌里", /--ink\s*:\s*#[0-9a-fA-F]{6}\s*;/.test(tokens));

  // 3) 大数字只有一套实现：.stats / .stat / .stat-v / .stat-k 在 app.wxss 定一次，
  //    页面样式表不许再定义同名的「统计块」（.num-v / .ov-row 那一版就是这么漂的）
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  ok("统计大数字收在全局一处",
    /\.stats\s*\{/.test(appWxss) && /\.stat-v\s*\{/.test(appWxss) && /\.stat-k\s*\{/.test(appWxss));
  const strayStats = [];
  pages.forEach((p) => {
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
    // 页面里再定义 .num-v / .grant-tier-v / .ov-num 这类「又一个统计数字」
    ["num-v", "grant-tier-v", "ov-num"].forEach((cls) => {
      if (new RegExp("(^|\\})\\s*\\." + cls + "\\s*\\{").test(wxss)) {
        strayStats.push(p + " → ." + cls);
      }
    });
  });
  ok("没有第二套统计数字组件", strayStats.length === 0, strayStats.slice(0, 6).join("; "));

  // 4) 圆角只有三档：页面样式表里不许再拍一个 radius 数值
  const TOKEN_RADIUS = /var\(--radius(-sm|-block|-pill)?\)/;
  const strayRadius = [];
  pages.forEach((p) => {
    const wxss = stripCss(fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8"));
    const re = /border-radius\s*:\s*([^;]+);/g;
    let m;
    while ((m = re.exec(wxss))) {
      const val = m[1].trim();
      if (TOKEN_RADIUS.test(val)) continue;
      if (/^(50%|0)$/.test(val)) continue;        // 圆与会不要圆角，另说
      if (/var\(/.test(val)) continue;            // 跟着别的令牌算的
      strayRadius.push(p + " → border-radius:" + val);
    }
  });
  ok("圆角一律走令牌", strayRadius.length === 0, strayRadius.slice(0, 6).join("; "));

  // 5) 圆角档数封顶。
  //
  // 这一版从 14/20/24/999 四档收成 16/20/20/24/999 —— 多出来的
  // --radius-ctl 不是「又拍了一个数」，而是**控件与按钮共用同一个值**：
  // 用户连着三轮问的就是「按钮和集子那些选项为什么不一致」，
  // 根子是按钮 999rpx、格子 16rpx，两种圆角两种长相。
  // 所以这里放行到五条，但值本身由 V23 逐条钉住（.btn/.chip/.opt-row 必须同值）。
  const radVars = (tokens.match(/--radius[a-z-]*\s*:/g) || []).map((x) => x.replace(/\s*:/, ""));
  ok("圆角令牌不超过五档（多出来的一档是控件与按钮共用的那一个）",
    radVars.length <= 5, "实际 " + radVars.join(", "));

  // 6) 页面底色不许再是米黄：这一版的底是中性浅灰 + 白卡
  const bgM = /--bg\s*:\s*#([0-9a-fA-F]{6})\s*;/.exec(tokens);
  ok("页面底色是中性浅色", !!bgM);
  if (bgM) {
    const hex = bgM[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    ok("底色不带黄绿倾向（三通道接近）", spread <= 10, "#" + hex + " spread=" + spread);
    ok("底色够亮（是纸不是灰板）", r > 230, "#" + hex);
  }
}

/**
 * V14. 宋体只给诗文，界面一律黑体。
 *
 * 这一条从一次真事里来：Issue #12 的截图里，「意见反馈」是宋体，
 * 同卡同款的「用户协议 / 隐私说明」是黑体 —— 看着像漏了一个字重，
 * 其实是 .row-title 这半个类同时管着两件事：列表里的**篇名**
 * （咏鹅 / 江南 / 画）和设置页的**功能名**（意见反馈 / 清空本机数据）。
 *
 * 「篇名用宋体」是内容需求（诗词要像诗词），绝不是「标题用宋体」。
 * 这两件事长得像，代价却不一样：前者只在几百条篇名上生效，
 * 后者会漫到设置项、按钮、卡片标题，一屏里同时出现宋体与黑体两种「标题」，
 * 比全用黑体更乱。
 *
 * 判据（三条，都是把事实改坏就会红的）：
 *   1. 全局 .row-title 取 UI 字体 —— 它默认是列表行的通用标题
 *   2. 篇名的宋体走 .row-poem 这个**附加类**，附在 .row-title 后面
 *   3. 页头大标题（.head-title）取 UI 字体；首页 hero 是唯一的例外，
 *      它写的是「今日背诵 / 一年级」，是正文内容那一侧的
 */
{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const blockOf = (sel) => {
    const m = new RegExp("\\." + sel.replace(/^\./, "").replace(/\./g, "\\.") + "\\s*\\{([^}]*)\\}").exec(appWxss);
    return m ? m[1] : "";
  };

  const rowTitle = blockOf(".row-title");
  ok("列表通用标题不取宋体", !!rowTitle && rowTitle.indexOf("font-family") >= 0
    && /var\(--font-ui\)/.test(rowTitle), rowTitle.replace(/\s+/g, " "));
  ok("列表通用标题没有偷偷取宋体",
    rowTitle.indexOf("--font-poem") < 0, rowTitle);

  const rowPoem = blockOf(".row-poem");
  ok("篇名有一个专门的附加类 .row-poem", !!rowPoem && /var\(--font-poem\)/.test(rowPoem));

  const headTitle = blockOf(".head-title");
  ok("页头大标题不取宋体", !!headTitle && headTitle.indexOf("--font-poem") < 0);

  // 页面里：.row-poem 只许出现在「确实是篇名」的行上。
  // 判据是这条行里必须绑定 title —— 设置项、按钮绑的是死文案，绑不出 {{...title}}。
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

  // 页头上的那两处：首页 hero 走宋体（正文一侧），其余页头一律黑体
  const homeWxss = fs.readFileSync(path.join(ROOT, "pages/home/home.wxss"), "utf8");
  ok("首页 hero 是宋体", /\.hero-title\s*\{([^}]*)\}/.test(homeWxss)
    && /var\(--font-poem\)/.test(/\.hero-title\s*\{([^}]*)\}/.exec(homeWxss)[1]));
  ok("首页 hero 的字号走令牌，不是裸 46rpx",
    !/font-size\s*:\s*46rpx/.test(homeWxss));
}

/**
 * V15. 预览不许自己骗自己（Issue #12 收尾时撞见的一类）。
 *
 * 这一组从两个**真发生过**的假消息里来，两条都不是界面写错，是
 * 「看界面用的工具」在说谎 —— 比界面写错更难发现，因为照着改会改坏真机。
 *
 *   1. **页面根规则被整条丢掉。** 预览把 `page{}` 改写成 `.screen{}`，
 *      用的是 `\bpage\s*\{`；而 `\b` 判断的是「前一个字符是词字符」，
 *      `.page {` 的点不是词字符，于是 `\b` 成立，`.page {` 被改成了
 *      `..screen{` —— 非法选择器，浏览器整条丢弃。后果：预览里 `.page`
 *      的 padding 与底色从来没有生效过，卡片通栏铺满屏（真机是左右各留
 *      --page-x），而「通栏 + 卡缝露灰底」看着就是一条条横带，
 *      一个假问题把真问题盖住了。
 *   2. **镜像与页面不同步。** 页面里 `.opt-row.active radio` 的
 *      `margin-left` 已经改成 0，NATIVE_CSS 里还是 6rpx，
 *      于是预览里圆点照旧横跳 —— 改完了看截图，问题「还在」。
 *
 * 所以这一组守两件事：
 *   · 预览 CSS 里**不许出现非法选择器**（`..`、`>.` 这类改写事故）
 *   · 页面根规则 `page{}` 必须在预览里存在，且真的挂在 `.screen` 上
 *   · NATIVE_CSS 里**每一条** `margin-left` / `margin-right` 都与页面一致
 */

// 上面两条断言的原素材都来自这两个文件，读不到就直接失败，不静默跳过
const renderSrc = fs.readFileSync(path.join(__dirname, "shots", "render.js"), "utf8");

// 1) `page{}` → `.screen{}` 的改写不许伤到 `.page`
{
  const scopedRe = /raw\.replace\((\/.*?\/g),\s*"\.screen\{"\)/s.exec(renderSrc);
  ok("预览在把 page{} 改写成 .screen{}（找得到那条 replace）", !!scopedRe);
  if (scopedRe) {
    // 把源文件里那个正则原样取出来跑，验它对 `.page {` 不匹配、对 `page {` 匹配
    const src = scopedRe[1];
    let re;
    try { re = eval(src); } catch (e) { re = null; }   // eslint-disable-line no-eval
    // ⚠️ 一律去掉 g 标志再用。
    // 带 g 的正则 .test() 是有状态的（记住 lastIndex），连测几次会一次真一次假 ——
    // 这条断言最初就栽在这儿：反证时把正则改回旧的 \b 写法，它照样全绿。
    // 断言自己会「轮流说谎」，比断言缺失更难发现。
    const t = re ? (x) => new RegExp(re.source, re.flags.replace("g", "")).test(x) : () => false;
    ok("预览的根选择器改写正则可以求值", !!re && re.source === re.source);
    if (re) {
      ok("page { 会被改写成 .screen{（根规则要留着）", t("page {"));
      ok(".page { 不会被改写（改了就是非法选择器 ..screen{）", !t(".page {"));
      ok(".page-head { 不受影响", !t(".page-head {"));
      // 这条是断言的来由，也是反证：旧写法确实会误伤 .page
      ok("旧写法（\\bpage）确实会误伤 .page",
        new RegExp("\\bpage\\s*\\{").test(".page {"));
    }
  }
}

// 2) 预览 CSS 里不许有 `..` 这种被改写坏的复合选择器
//
// ⚠️ 这一条读的是 render.js 的**产物**（preview.html）。CI 里只跑 check.js、
// 不跑 render.js —— 产物不在是正常的。所以这里必须**分清「没跑」与「跑挂了」**：
// 产物不在就出声跳过（输出一行提示），绝不静默放行，也绝不因为文件不在就崩 ——
// 一个因为缺输入而崩溃的自检，会让人把整条 `node scripts/check.js` 从流水线里摘掉，
// 那比少一条断言糟得多。
{
  const previewPath = path.join(__dirname, "shots", "out", "preview.html");
  if (!fs.existsSync(previewPath)) {
    console.log("· 预览产物不在（没跑 node scripts/shots/render.js）——"
      + " 跳过两条「预览自身是否可信」的断言；跑过之后再跑一次 check.js 就会验");
  } else {
    const html = fs.readFileSync(previewPath, "utf8");
    // 只看选择器位置上的 `..`（属性值里出现两个点不算，例如 ../assets/x.png）
    const badSel = [];
    const re = /(^|[},;{])\s*([^{}@]*?\.\.[^{}]*?)\s*\{/g;
    let m;
    while ((m = re.exec(html))) badSel.push(m[2].trim().slice(0, 60));
    ok("预览 CSS 里没有 .. 这类非法选择器", badSel.length === 0, badSel.slice(0, 4).join(" | "));

    // 页面根规则必须真的在：缺了它卡片会通栏
    ok("预览里 .page 的规则在（padding 与底色才有出处）", /\.page\s*\{[^}]*padding\s*:/.test(html));
  }
}

// 3) 镜像与页面逐条对齐：margin-left / margin-right 两边必须一样
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
  const pageSrcAll = pages.map((p) => [p, strip(fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8"))]);

  // 页面里凡按**标签名**给 radio / checkbox 写的横距规则，
  // 镜像里必须有一条按 class 写的等价项 —— 少一条，预览就比真机好看一点。
  //
  // 这条原来是专门盯 `.opt-row.active radio` 的（那时候选项行里还露着圆点）。
  // 现在选项行的原生控件是视觉隐藏的（.opt-radio），不再需要外观镜像，
  // 所以判据从「列举那些规则」换成**按事实判**：页面里还在露脸的裸控件，
  // 它的横距必须在镜像里有对应的一条。
  const visibleTagRules = [];
  const tagRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = tagRe.exec(pageCssAll))) {
    const sel = m[1];
    const body = m[2];
    if (!/\b(radio|checkbox)\b/.test(sel)) continue;
    if (/\.opt-radio|\.seg-radio/.test(sel)) continue;   // 视觉隐藏的，不需要外观
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

  // 选项行的原生控件必须是视觉隐藏的：露着就又是「第二种选中标志」
  const optRadioVisible = /\.opt-row\s+radio[^{}]*\{[^}]*margin-right/.test(pageCssAll);
  ok("选项行里的原生控件是视觉隐藏的（不再另起一个圆点）", !optRadioVisible,
    "还能找到给 .opt-row radio 的横距规则 —— 说明它又露脸了");
}

/**
 * V16. 卡片的层次不靠投影（Issue #12 收尾时从截图上量出来的）。
 *
 * 卡与卡之间只有 --sp-3（24rpx）的缝，而上一版的投影模糊半径就有 6rpx ——
 * 一条缝被两侧的投影共同铺满，在浅灰底上显成一条两头深、中间浅的横带
 * （实测 236 → 245 → 236）。首页自上而下七八条，看着像渲染坏了。
 *
 * 「白卡 + 浅灰底 + 窄缝」这套版式里，投影不表达任何东西，只制造噪声。
 * 所以：卡片一律不带投影；要表达「这张更重要」，用留白和字号差。
 */
{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");

  ok("卡片自身不写投影", !/\.card\s*\{[^}]*box-shadow/.test(appWxss));
  ok("投影令牌是 none（万一别处引了也不出效果）",
    /--shadow\s*:\s*none\s*;/.test(tokens) && /--shadow-lift\s*:\s*none\s*;/.test(tokens));

  // 页面样式表里也不许给卡片补一层投影
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
  ok("页面样式表里没有给卡片补投影", stray.length === 0, stray.slice(0, 4).join("; "));
}

/**
 * V17. 行尾那一格，两种状态共用一个宽度（Issue #12 收尾时量出来的）。
 *
 * 首页目录：未登录时行尾写「登录」胶囊（约 40px），登录后放完成勾（约 23px）。
 * 两者宽度差一圈，而它们都是 flex 里的 flex:none 项 —— 于是**标题栏的宽度
 * 在两态下不一样**（实测差 8.3px），同一份目录登录前后右端参差，
 * 一登录整列字都往右挪了位。
 *
 * 判据：包一层固定宽度的槽，两态共用同一个槽。
 */
{
  const homeWxml = fs.readFileSync(path.join(ROOT, "pages/home/home.wxml"), "utf8");
  const homeWxss = fs.readFileSync(path.join(ROOT, "pages/home/home.wxss"), "utf8");

  ok("首页行尾包了共用的槽", (homeWxml.match(/class="row-end"/g) || []).length >= 2);
  ok("「登录」胶囊与完成勾都在槽里",
    /<view class="row-end"><text class="row-lock">登录<\/text><\/view>/.test(homeWxml.replace(/\s+/g, " ")
      .replace(/> </g, "><")) || /row-end"[^>]*>\s*<text class="row-lock"/.test(homeWxml));
  const slot = /\.row-end\s*\{([^}]*)\}/.exec(homeWxss);
  ok("槽有固定宽度", !!slot && /width\s*:\s*\d+rpx/.test(slot[1]), slot && slot[1].replace(/\s+/g, " "));
  ok("槽宽不小于「登录」胶囊的实际宽度（88rpx 两个字 + 内边距）",
    !!slot && Number((/width\s*:\s*(\d+)rpx/.exec(slot[1]) || [])[1] || 0) >= 88);
}


/**
 * V18. 选项、按钮、卡片下面不许挂「解释性提示」。
 *
 * 用户 2026-10-02 的原话：
 *   「所有选项，所有按钮，尽量使用精简语言」
 *   「更不要在各个选项，设置，卡片下面显示各种婆婆妈妈的解释性提示」
 *
 * 这一版之前，几乎每张卡下面都吊着一行小字：搜索页解释倒排索引怎么走、
 * 题型下面解释哪个格子能多选、朗读卡解释档位与通道的关系……
 * 单看每一句都是在「如实交代」，合起来是把界面读成一篇说明书 ——
 * 而用户要的是「看得懂就点」。
 *
 * 判据是**位置**，不是字数：卡片/选项/按钮的容器下方，除了
 *   · 事实读数（数量、进度、日期这类数字）
 *   · 空状态与出错说明（没有它，「没有」和「没加载出来」分不清）
 * 之外，不许再出现解释性文案。
 *
 * 靠人自觉守不住 —— 这种小字是「顺手加上去」的，一次一句，回看时看不出来。
 */
{
  // 白名单的那些类：它们不是「解释」，是读数或兜底。
  // **白名单不等于免检** —— 它只免掉「位置」这一层，长度照样要过。
  // 上一版的写法只按类名放行，于是 `.hint pool-hint` 底下写一整段
  // 算法说明也照样全绿（反证时撞见的）。读数天生短，所以长度这一关
  // 对所有类一视同仁。
  const OK_CLASS = /(empty-|warn|result-count|result-where|result-more|pool-hint|char-count|count|stage-|kv-|sample|mastery|verdict|wrong-|score|stem-sub|day-|stat-|hero-|tier-|identity-|acct-|cap-|fh-|trans-|meta|note error)/;
  // 长句判据：一句中文说明超过这个长度，基本就是「解释」而不是「标签」
  const MAX_LABEL = 24;
  // 读数类：位置免检，长度仍要过 —— 这类该是「N 首」「3 / 7」
  // 「共 10 题 · 限时 20 分钟」这种带一个限定词的也算读数，所以放到 18。
  // 一段算法说明（三四十字）过不去，一条读数过得去，这条线在那儿。
  const MAX_READING = 18;

  const stray = [];
  const files = pages.map((p) => [p, path.join(ROOT, p + ".wxml"), path.join(ROOT, p + ".wxss")]);
  files.forEach(([p, wxmlPath, wxssPath]) => {
    const wxml = fs.readFileSync(wxmlPath, "utf8");
    // 把 WXML 里带 class 的文本节点扫一遍。
    //
    // 分两步：先摘掉所有 `{{ … }}`（里面是表达式，不是给人看的句子），
    // 再切 `<text class="…">正文</text>`。一起切会在
    // `wx:if="{{a > b}}"` 的 `>` 上提前收尾 —— 上一版就这么把一段属性
    // 当成正文，长度永远超标，成了一条永远红的断言（反证时撞见的）。
    const flat = wxml.replace(/\{\{[\s\S]*?\}\}/g, "＃");
    const re = /<text[^>]*class="([^"]*)"[^>]*>([^<]*)<\/text>/g;
    let m;
    while ((m = re.exec(flat))) {
      const cls = m[1];
      const body = m[2].replace(/\s+/g, " ").trim();
      if (!body) continue;
      // 纯读数（只剩标点与占位）放过
      if (/^[＃\s·—\-：:／\/，。！？、（）()]*$/.test(body)) continue;
      // 读数类：位置免检，长度不免
      if (OK_CLASS.test(cls)) {
        if (body.length > MAX_READING) stray.push(p + " → ." + cls + "（读数类却写了长句）「" + body.slice(0, 30) + "…」");
        continue;
      }
      if (body.length <= MAX_LABEL) continue;
      stray.push(p + " → ." + cls + " 「" + body.slice(0, 30) + "…」");
    }
  });
  ok("卡片/选项/按钮下没有长篇解释性提示", stray.length === 0, stray.slice(0, 5).join(" | "));

  // 按钮文案也要短：一条按钮上写十几个字，扫不下来
  const longBtn = [];
  files.forEach(([p, wxmlPath]) => {
    const wxml = fs.readFileSync(wxmlPath, "utf8");
    const re = /<button[^>]*>([\s\S]*?)<\/button>/g;
    let m;
    while ((m = re.exec(wxml))) {
      if (m[1].indexOf("<") >= 0) continue;      // 按钮里嵌了别的元素，不是纯文案
      const raw = m[1].replace(/\s+/g, " ").trim();
      if (!raw) continue;
      // 三元表达式要把**两个分支分别量**：整段压成一个「＃」量不出长度，
      // 反证的时候就撞见了 —— 一条十七个字的按钮照样全绿。
      const branches = [raw];
      const tern = /'([^']*)'\s*:\s*'([^']*)'/.exec(raw);
      if (tern) { branches.length = 0; branches.push(tern[1], tern[2]); }
      branches.forEach((body) => {
        const visible = body.replace(/\{\{[^}]*\}\}/g, "").replace(/[·—\-：:／\/，。！？、（）()\s]/g, "");
        if (visible.length > 12) longBtn.push(p + " → 「" + body.slice(0, 24) + "」");
      });
    }
  });
  ok("按钮文案是短句（不超过 12 个可见字）", longBtn.length === 0, longBtn.slice(0, 5).join(" | "));
}

/**
 * V19. 尺寸只有一个旋钮（Issue #12 的「小一号的全局配置」）。
 *
 * 用户要的是「用一套组件体系，并且能从一处整体调小」。
 * 换个说法：**全站的尺寸必须是可推导的**，不能散在二十六个页面里各写各的。
 *
 * 判据三条：
 *   1. tokens.wxss 里必须有 `--ui-scale`
 *   2. 字阶 / 间距 / 圆角 / 高度这几组令牌必须由它算出来（calc）
 *   3. 页面样式表里不许再出现**裸的 rpx 尺寸** —— 出现就是漏了令牌，
 *      将来调小的时候一定会漏掉它
 *
 * ⚠️ 第 3 条有例外名单：1rpx 的描边、百分比、以及确实只属于这一页的
 * 装饰尺寸（例如阅读页的行距倍数）。名单要短，每进一条都得说清为什么。
 */
{
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  ok("令牌表里有 --ui-scale", /--ui-scale\s*:/.test(tokens));

  // 这几组必须乘 --ui-scale
  const mustScale = ["--fs-body", "--fs-title", "--sp-2", "--sp-3", "--page-x",
    "--radius-sm", "--radius", "--h-btn", "--h-row"];
  const notScaled = mustScale.filter((t) => {
    const m = new RegExp("\\" + t + "\\s*:\\s*([^;]+);").exec(tokens);
    return !m || !/var\(--ui-scale\)/.test(m[1]);
  });
  ok("字阶/间距/圆角/高度都由 --ui-scale 算出来", notScaled.length === 0,
    notScaled.join("; "));

  // 3) 页面不许**重复定义**共享令牌 —— 那一层才是「调不动」的真正来源。
  //
  // 不去查「页面里有没有裸的 rpx」：页面本来就有只属于这一页的装饰尺寸
  // （头像圆 112rpx、钩子 22rpx……），把它们全赶进令牌表只会让令牌表变成
  // 第二个页面样式表，反而更乱。真正要守的是**同一个东西不许有第二个数**：
  // 页面上凡是写了字阶 / 间距 / 行高这类共享令牌的地方，必须用 var() 取，
  // 不许在页面里重新赋一个值。
  const SHARED = ["--fs-", "--sp-", "--lh-", "--radius", "--h-btn", "--h-row",
    "--h-field", "--h-act", "--page-x", "--ui-scale", "--ink", "--bg", "--surface", "--sink", "--line"];
  const redefined = [];
  pages.forEach((p) => {
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const re = /(--[\w-]+)\s*:\s*([^;}]+)/g;
    let m;
    while ((m = re.exec(wxss))) {
      const name = m[1];
      if (SHARED.some((s2) => name.startsWith(s2))) {
        // 允许页面里定义**自己新增的**变体（如 --fs-poem-hero），
        // 但名字正好等于共享令牌时，就是在覆盖它
        if (SHARED.includes(name) || SHARED.some((s2) => name === s2)) {
          redefined.push(p + " → " + name);
        }
      }
    }
  });
  ok("页面没有重新定义共享令牌", redefined.length === 0, redefined.slice(0, 6).join(" | "));
}

/**
 * V20. 全局样式表的括号必须配平。
 *
 * 这一条是**被自己坑出来的**：改 Issue #12 的选项行时，
 * 一次文本替换漏掉一个 `}`，于是一大段规则（`.opt-row` / `.chip-group`）
 * 被浏览器整个丢弃 —— 预览截图里所有选项变成一列光秃秃的文字。
 * 界面「坏了」，但自检 742 项**全绿** —— 因为没有一条断言看的是
 * 「样式表本身还立不立得住」。
 *
 * 判据：去掉注释后，`{` 与 `}` 数目相等，且不许出现负数深度（提前闭合）。
 */
{
  const bad = [];
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const files = [["app.wxss", appWxss], ["styles/tokens.wxss",
    fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8")]];
  pages.forEach((p) => files.push([p + ".wxss", fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8")]));
  files.forEach(([name, src]) => {
    const t = src.replace(/\/\*[\s\S]*?\*\//g, "");
    let d = 0;
    let broke = false;
    for (const ch of t) {
      if (ch === "{") d++;
      if (ch === "}") { d--; if (d < 0) { broke = true; break; } }
    }
    if (broke || d !== 0) bad.push(name + "（" + (broke ? "提前闭合" : "差 " + d + " 个 }") + "）");
  });
  ok("样式表的括号是配平的", bad.length === 0, bad.join("; "));
}

/**
 * V21. 自绘底栏（Issue #12 第三次追问：导航栏图标）。
 *
 * 用户原话：「导航栏几何按钮明明文字上面有图标的，现在好像没有，例如 我的」。
 * 原生 tabBar 只认**图片**（iconPath / selectedIconPath），而本项目一条图片
 * 资源都不引（主包余量，也免多套倍图）—— 图标一律 CSS 画。所以底栏整条自绘。
 *
 * 自绘的代价是「高亮不再由平台管」：每个 tab 页 onShow 必须自己 setActive 一次。
 * 漏一个，那一页的底栏就亮着上一栏 —— 这种错在预览里看不出来（预览手画了
 * 当前项），只有真机切过去才现形。所以这里按事实守三件事：
 *   1. custom-tab-bar 四件套齐全、app.json 里开了 custom
 *   2. 四个 tab 页各调一次 tabbar.sync，且序号各不相同（一页一格）
 *   3. 底栏四项都有图标类（.tab-ico-xxx），且 index.wxss 里真的画了它
 */
{
  const tabRoot = path.join(ROOT, "custom-tab-bar");
  const four = [".js", ".json", ".wxml", ".wxss"].every((ext) =>
    fs.existsSync(path.join(tabRoot, "index" + ext)));
  ok("自绘底栏四件套齐全", four);

  const appCfg = readJson(path.join(ROOT, "app.json"));
  ok("app.json 开启了自定义 tabBar", appCfg.tabBar && appCfg.tabBar.custom === true);

  // 图标：组件里每个 icon 名，wxss 里要有一条 .tab-ico-<name> 规则
  const barJs = fs.readFileSync(path.join(tabRoot, "index.js"), "utf8");
  const barCss = fs.readFileSync(path.join(tabRoot, "index.wxss"), "utf8");
  const icons = [];
  const ire = /icon:\s*"([\w-]+)"/g;
  let im;
  while ((im = ire.exec(barJs))) icons.push(im[1]);
  ok("底栏每一项都配了图标", icons.length >= 4, "找到 " + icons.length + " 个");
  const noIcon = icons.filter((n) => barCss.indexOf(".tab-ico-" + n) < 0);
  ok("底栏图标都有画法（.tab-ico-* 在 index.wxss 里）", noIcon.length === 0, noIcon.join(","));

  // 每个 tab 页 onShow 里 setActive 一次
  const TABS = [
    ["pages/home/home", 0],
    ["pages/library/library", 1],
    ["pages/search/search", 2],
    ["pages/mine/mine", 3]
  ];
  const missing = [];
  const seen = new Set();
  TABS.forEach(([p2, idx]) => {
    const js = fs.readFileSync(path.join(ROOT, p2 + ".js"), "utf8");
    const m = /tabbar\.sync\(this,\s*(\d+)\)/.exec(js);
    if (!m) missing.push(p2 + " 没调 tabbar.sync");
    else if (Number(m[1]) !== idx) missing.push(p2 + " 序号 " + m[1] + " ≠ " + idx);
    else seen.add(Number(m[1]));
  });
  ok("四个 tab 页都把底栏点亮（序号各不相同）", missing.length === 0 && seen.size === 4,
    missing.join("; ") || ("序号数 " + seen.size));

  // 有底栏的页面要多留一截，否则内容被压住
  const padded = [];
  TABS.forEach(([p2]) => {
    const wxml = fs.readFileSync(path.join(ROOT, p2 + ".wxml"), "utf8");
    if (wxml.indexOf("has-tabbar") < 0) padded.push(p2);
  });
  ok("四个 tab 页都留了底栏高度的垫片（.has-tabbar）", padded.length === 0, padded.join(", "));
  const appCss2 = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  ok("app.wxss 里有 .has-tabbar 的底部留白规则", /\.page\.has-tabbar\s*\{[^}]*padding-bottom/.test(appCss2));
}

/**
 * V22. 头像：**只有微信一个来源，且只落本机**（Issue #111，2026-10-10）。
 *
 * 这一节的前身守的是「本机那张压过微信那张」——那是 Issue #12 那一轮的做法：
 * 用户能自己传一张，传了就用它，没传就回落微信那张。
 *
 * Issue #111 把这件事收掉了。用户原话：
 *   「当用户登录后，直接使用小程序微信账号的头像吧，不要再提供用户自己上传头像的
 *     功能了，也许能节省对象存储或者静态资源存储」。
 *
 * 收掉之后剩一个来源，而且它**不上传** —— 平台没有任何一条「静默拿微信头像」的
 * API（2022 起 getUserProfile 只回匿名灰头像），唯一合规的路是
 * `open-type="chooseAvatar"`，而它给回来的是一枚**临时文件路径**（`wxfile://…`）。
 * 那是这台机器上的东西：上传它既没地方存（要为此养一个对象存储），
 * 换台手机也没有意义。所以头像 = 本机存储里那一枚，不进同步报文。
 *
 * 守四件事（每一条都对着上面那句「不上传」）：
 *   1. `avatarSrc()` 只认本机那一张，**没有**第二处可回落
 *   2. 登录**不写**头像（服务端那一栏从来不回值，写它等于把用户选的抹掉）
 *   3. 头像**不进同步报文**（没有 profile:v1 那一行），也**不落对象存储**
 *   4. 选头像的入口仍是头像圆（`chooseAvatar`），不再有「换头像」按钮那一行
 */
{
  const storeJs = fs.readFileSync(path.join(ROOT, "utils", "store.js"), "utf8");
  const srcFn = /function avatarSrc\(\)\s*\{([\s\S]*?)\n\}/.exec(storeJs);
  ok("store 有 avatarSrc（头像取哪一张的唯一出处）", !!srcFn);
  if (srcFn) {
    const body = srcFn[1];
    ok("头像只认本机那一张（不再回落微信那张 —— 没有第二处可回落）",
      body.indexOf("avatarLocal") >= 0 && body.indexOf("avatarUrl") < 0,
      body.replace(/\s+/g, " ").trim().slice(0, 140));
  }
  /* ⚠️ `avatarUrl` 这个字段要**整个退场**，不只是「排在后面」。
     留着它，下一个人就会以为「服务端会给一张微信头像」——
     而服务端的 `wx_accounts.avatar_url` 一直是空串，那是一条永远不来的回落。 */
  ok("store 里不再有 avatarUrl 那个字段（服务端从来不回头像）",
    !/avatarUrl\s*[:|]/.test(storeJs.replace(/\/\*[\s\S]*?\*\//g, "")),
    "avatarUrl 还在 —— 它是一条永远不来的回落，留着只会让下一个人以为服务端会给");

  // 登录不许写头像
  const authJs = fs.readFileSync(path.join(ROOT, "utils", "auth.js"), "utf8");
  const loginWrite = /const patch = \{([\s\S]*?)\};/.exec(authJs);
  ok("登录时**不写**头像（服务端那一栏是空的，写它等于把用户选的抹掉）",
    !!loginWrite && !/avatarUrl\s*:/.test(loginWrite[1]) && !/avatarLocal\s*:/.test(loginWrite[1]),
    loginWrite ? loginWrite[1].replace(/\s+/g, " ").slice(0, 140) : "没找到那段 patch");
  ok("登录态走 saveSession（会话字段与本机档案分得开）",
    authJs.indexOf("store.saveProfile({ logged") < 0 && !!loginWrite);

  // 页面显示一律走 store.avatarSrc()
  const direct = [];
  pages.forEach((p2) => {
    const js = fs.readFileSync(path.join(ROOT, p2 + ".js"), "utf8");
    if (/profile\(\)\.avatarUrl|\.avatarUrl\s*\|\|\s*"/.test(js) && js.indexOf("avatarSrc") < 0) {
      direct.push(p2);
    }
  });
  ok("页面显示头像走 store.avatarSrc()，不直接读 profile.avatarUrl", direct.length === 0, direct.join(", "));

  // getUserProfile 已废弃
  const stripJs = (x) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const legacy = pages.filter((p2) =>
    stripJs(fs.readFileSync(path.join(ROOT, p2 + ".js"), "utf8")).indexOf("getUserProfile") >= 0);
  ok("不再调用 wx.getUserProfile（只返回匿名灰头像）", legacy.length === 0, legacy.join(", "));
}

/* ---------- V22.5 「本机不冒充登录」（Issue #121） ----------
 *
 * 用户原话：「登录过程非常快，一点就登录了，但数据库 mysql 里没有任何新的记录」。
 *
 * 病灶是一句谎话：`auth.login()` 在没有接上服务器时（`remote.configured()` 为假 ——
 * 云调用两栏没填、或压根没配）写 `store.saveSession({ logged: true })` 并回
 * `{ local: true }`。于是：
 *
 *   · `mine.js` 收下那个 resolve 就报「已登录」—— 点一下、闪一下，成功的样子全有；
 *   · `logged: true` 是**服务端会话**的判据，从那一秒起 `gate.guard()` 不再拦、
 *     每个要登录的入口都当用户已经登录 —— 而服务端一个字节都不知道有这个人；
 *   · 一个没连后台的包因此长得跟正常的包一模一样，用户只能靠**去数据库里翻**
 *     才发现「一条记录都没有」。
 *
 * 「进门容易、用起来要求登录」这条产品判断没变（打开即强制登录做不到，
 * 见 docs/todo.md），变的是：**本机不冒充登录**。没接上服务器时
 * `profile.logged` 保持 false、`loginCode` 只作下次真接上时的敲门砖。
 *
 * 这一节守四件事（前两件是**行为**，拿假 wx 真跑一遍；后两件是**文案**）：
 *   ① 没接上服务器时 login() 不写 logged: true，且把 code 留下
 *   ② 接上服务器时（服务端回了 accessToken），logged 照旧为真
 *   ③ 界面不再把「没接上服务器」说成「已登录」
 *   ④ 「没接上」与「没登录」是两种提示，不许混成一句「点一下重试」
 */
{
  const authSrc = fs.readFileSync(path.join(ROOT, "utils", "auth.js"), "utf8");
  const mineSrc = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");

  ok("没接上服务器时不再写 `logged: true`（本机不冒充登录）",
    !/if \(!configured\(\)\) \{[\s\S]{0,600}?saveSession\(\{ logged: true/.test(authSrc),
    "offline 那一支又写上了 logged: true —— 用户点一下就「已登录」，而库里一条记录都没有");
  ok("没接上服务器时把 wx.login 的 code 留下来（下次真接上时不用再点）",
    /loginCode/.test(authSrc) && /delete auth\.code/.test(authSrc),
    "code 没留下、或在两处各存一份 —— 留着的唯一用途是下次真接上时省一次点击");

  /** 一套够用的假 wx：只给 store/auth 真正用到的四件事。
      ⚠️ 探针是**同步**收结果的，见下面那段「process.exit 会切掉微任务队列」。 */
  const fakeWx = (mem) => ({
    getStorageSync: (k) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : ""),
    setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
    removeStorageSync: (k) => { delete mem[k]; },
    request: () => { mem.__requested = (mem.__requested || 0) + 1; }
  });

  /* ⚠️ **这一段必须同步收结果。**
     check.js 是一路读下来、结尾 `process.exit`（见文件末尾），而
     `process.exit()` **会切掉还没跑的微任务** —— 同一个 tick 里排上的 `.then`
     一个都不执行。第一版这里写成 `auth.login().then(() => ok(...))`，
     1540 项全绿、而这几条断言**从来没跑过**；把 `logged: false` 改回
     `logged: true`（就是 Issue #121 那个 bug）也照样绿。

     所以探针换成：假 wx 把所有回调**就地**调掉，再用 `queueMicrotask` 之前的
     那一步 —— 干脆只读「同步就能读到的那些状态」。
     `auth.login()` 的外层 `new Promise` 本来就同步跑到 `wx.login`；
     `wx.login` 成功回调里那一支（没配服务器）**整条是同步的**：
     写 storage、写 loginCode、resolve。于是 `login()` 一返回，状态已经落定。 */
  {
    const mem = {};
    const savedWx = global.wx;
    global.wx = fakeWx(mem);
    global.wx.login = (o) => o.success({ code: "C-OFFLINE" });
    global.wx.request = (o) => { mem.__requested = (mem.__requested || 0) + 1; };

    /* 清掉 check.js 顶上 require 进来的那一份 `utils/store.js` ——
       `login()` 里写的和这里读的必须是同一个模块，否则断言的是一份没人写的副本。 */
    Object.keys(require.cache).forEach((k) => {
      if (k.indexOf(path.join(ROOT, "utils")) === 0) delete require.cache[k];
    });
    const auth2 = require(path.join(ROOT, "utils", "auth.js"));
    const store2 = require(path.join(ROOT, "utils", "store.js"));

    /* 干净起点：前面那些用例可能留下过 `offline` / `loginCode` 标记。
       ⚠️ 必须**在** `login()` 之前清 —— `wx.login` 的成功回调是就地调的，
       `login()` 一调用就把标记写下了；清在后面等于把刚写的抹掉。 */
    store2.drop(store2.KEYS.auth);
    store2.saveSession({ logged: false, tier: "", tierFromServer: false });

    /* ⚠️ **这一段（`login()` 里同步跑完的那部分）在同步上下文里拍快照。**
       `utils/store.js` 的 `read()` 是运行时读全局 `wx` 的，而 check.js 后面
       还有别的区块会换 `global.wx` —— 等到微任务里再读，读到的可能已经是
       别人的存储盒（实测过：断言里 `global.wx` 已经不是这支探针的了）。
       没配服务器时 `login()` 整条是同步的：写 storage、写 loginCode、resolve。 */
    const loginPromise = auth2.login();
    const snapAuth = store2.read(store2.KEYS.auth, {}) || {};
    const snapProf = store2.profile();
    const snapOffline = auth2.offline();
    const snapRequested = mem.__requested;

    ok("没接上服务器时 profile.logged **不**为 true（这才是「库里没有记录」的正解）",
      snapProf.logged !== true,
      "又写成已登录了 —— 界面会报「已登录」，而服务端连这个人都不知道；实际 " + JSON.stringify(snapProf));
    ok("code 存在 loginCode 里（不是旧的那个 code 字段）",
      !!snapAuth.loginCode && !snapAuth.code,
      JSON.stringify(snapAuth));
    ok("离线这件事被记下来了（界面与能力矩阵要据此说清为什么）",
      snapOffline === "off", snapOffline);
    ok("没接上服务器时一次网络请求都不发（没配就没有可打的地方）",
      !snapRequested, "发了 " + (snapRequested || 0) + " 次请求");

    /* ⚠️ **两条探针串成一条 promise 链，假 wx 只在整条链的末尾还原。**
       提前还原，链上后面几步（`applySession`、`wx.request`）就打到别人的
       存储盒上 —— 日志里看到的是「一次请求都没发」「profile 是空的」
       这种莫名其妙的红（第一版还原了三次、红了三次，都是这个原因）。 */
    track(
      loginPromise
        .then((r) => {
          ok("没接上服务器时 login() 回的是 local（调用方据此说真话）",
            !!(r && r.local === true),
            "mine.js 的 onLogin 就是读这个字段决定说不说「已登录」；实际 " + JSON.stringify(r));
        }, (e) => ok("没接上服务器时 login() 不该 reject", false, String(e && e.message)))

        /* ② 接上服务器时（服务端回了 accessToken），logged 照旧为真 ——
           ① 那条改的是「本机不冒充」，不是「本机不给登录」。 */
        .then(() => {
          /* ⚠️ **每一步都要把假 wx 重新装上。**
             `utils/store.js` 的 `read()` 是运行时读 `global.wx` 的，而 check.js
             后面那些区块（V45、V48…）一进来就同步把 `global.wx` 换成自己的
             —— 它们只在自己的 `.then` 里还原。所以「这一支还在跑」这件事，
             `global.wx` 完全不知道；上一条 `.then` 与这一条之间，它已经被换掉了。
             第一版栽在这儿：日志是「profile 是空的」「一次请求都没发」。
             这是**同步重装**，不是「还原」—— 探针之间不该互相踩。 */
          global.wx = fakeWx(mem);
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
          store2.saveSession({ logged: false, tier: "", tierFromServer: false });
          auth2.configure({ baseUrl: "https://probe.test" });
          ok("配了服务器之后 configured() 为真（②那条断言的前提）",
            auth2.configured() === true, JSON.stringify(auth2.baseUrl()));
          return auth2.login();
        })
        .then(() => {
          global.wx = fakeWx(mem);
          const prof = mem[store2.KEYS.profile] || {};
          const box = mem[store2.KEYS.auth] || {};
          ok("接上服务器时 profile.logged 为 true（①那条改的是「本机不冒充」，不是「本机不给登录」）",
            prof.logged === true, JSON.stringify(prof));
          ok("接上服务器时离线标记被清掉", !box.loginCode, JSON.stringify(box));
          ok("配了服务器之后真的往服务端打了一次登录（不再走本机那一支）",
            !!mem.__requested, "一次请求都没发");
          global.wx = savedWx;
        }, (e) => {
          global.wx = savedWx;
          ok("接上服务器时 login() 不该失败", false, String(e && e.message));
        })
    );
  }

  /* ③④ 界面上那两句话 —— 判据落在「说的是事实」，不落在某个具体措辞上。 */
  {
    const mineCode = mineSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const loginFn = /onLogin\(\)\s*\{([\s\S]*?)\n  \},/.exec(mineCode);
    ok("登录成功那句判定先看 `res.local`（没接上服务器时不说「已登录」）",
      !!loginFn && /res\.local/.test(loginFn[1]),
      "onLogin 里没有 res.local 这一支 —— 没接上服务器时照样报「已登录」");
    ok("有告诉用户「还没接上同步服务器」的那一步",
      /tellOffline/.test(mineCode) && mineCode.indexOf("还没接上同步服务器") >= 0,
      "空壳登录没有任何一句解释，用户只能自己去数据库里查");
  }
}

/**
 * V23. 两条长相、一条内边距（Issue #12 的收尾四问）。
 *
 * 用户这次问的四件事，其实是同一个问题的四个切面：
 *
 *   1. 「课外阅读集子的选项垂直 padding 上下需要加 2px，左右需要加 4px」
 *   2. 「学期显示在年级下面」
 *   3. 「取诗范围选项 inline 显示，而不是一行一条」
 *   4. 「所有按钮加大 radius，和这两处的按钮要不要都和课外阅读列表页
 *       那些集子的选项样式保持一致？」
 *
 * 第 4 问的答案是**要**，而且查下来当时不止「不一致」，是三套圆角：
 * 格子 16rpx 的近直角、按钮 999rpx 的胶囊、标签 999rpx 的胶囊。
 * 前两套都是「能点、能选中」的东西，却是两种长相 —— 这就是不统一的出处。
 *
 * 所以这里守四件事（每条都做过反证：把事实改坏，确认它会红）：
 *   a. 选项格的纵向内边距**不是 0**，且上下 / 左右分开取了令牌
 *   b. 年级排在学期**前面**（先粗后细）
 *   c. 取诗范围是横排（`opt-group inline`），不是一行一条
 *   d. `.btn` / `.chip` / `.opt-row` 圆角同为 --radius-ctl
 */
{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "");
  const body = strip(appWxss);

  const rule = (cls) => {
    const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp("(^|\})\\s*" + esc + "\\s*\\{([^}]*)\\}").exec(body);
    return m ? m[2] : null;
  };

  // a) 选项格的内边距：纵向不许是 0，且上下 / 左右各取令牌
  ok("选项格的内边距令牌已定（上下 / 左右分开）",
    /--pad-opt-y\s*:/.test(tokens) && /--pad-opt-x\s*:/.test(tokens));
  ok("内边距令牌由 --ui-scale 算出来（整体收放时跟着走）",
    /--pad-opt-y\s*:[^;]*var\(--ui-scale\)/.test(tokens)
    && /--pad-opt-x\s*:[^;]*var\(--ui-scale\)/.test(tokens));
  const chipBody = rule(".chip") || "";
  ok("选项格上下真的留了内边距（不是 0）",
    /padding\s*:\s*var\(--pad-opt-y\)\s+var\(--pad-opt-x\)/.test(chipBody),
    chipBody.replace(/\s+/g, " ").trim().slice(0, 80));

  // a2) 横向这一档要「够厚」——只为「不为零」是不够的。
  //
  // 用户的原话是「选项内文字左右 padding 和它自己的边界太近了，太挤了」。
  // 上一轮把 --pad-opt-x 定成 8rpx，量出来最紧的一格两侧各只剩 4.8px，
  // 比同一格的 10.4px 圆角还小 —— 文字压在圆弧上。
  // 所以钉一个下限：不小于圆角本身（20rpx）。
  //
  // ⚠️ 但这一条**不是**用户那处的解药：他指的是取诗范围里那个长名字，
  // 而长名字挤不挤由**列数**决定（内边距加得越大、文字到边越近）。
  // 真正兜住它的是下面 a3 ——那一条会读 WXML 上的列数，退步就红。
  const padX = /--pad-opt-x\s*:\s*calc\((\d+(?:\.\d+)?)rpx\s*\*\s*var\(--ui-scale\)\)/.exec(tokens);
  ok("选项格横向内边距由 rpx 写出（能算宽度）", !!padX);
  const padXVal = padX ? Number(padX[1]) : 0;
  ok("选项格横向内边距不小于圆角（文字不会顶在圆角上）",
    padXVal >= 20, "实际 " + padXVal + "rpx");

  // a3) 最窄的格子两侧还剩多少 —— 这一条才是用户那处的答案。
  //
  // 算式全用设计值，一个数都不手抄：
  //   内容宽 = 750 − 2·page-x − 2·cardPad（卡片内边距是 .card 的 --sp-4）
  //   格子宽 = (内容宽 − (列数−1)·pad-x) / 列数
  //   两侧余 = (格子宽 − 文字宽) / 2 − 描边
  // 列数取 WXML 上的类、选项名取 scheduler 的 SCOPES、字号与内边距取令牌、
  // 文字宽度取 font-metrics.json（真字体）。改文案、改列数，这条跟着动。
  const tok = (name, dflt) =>
    Number(new RegExp(name + "\\s*:\\s*calc\\((\\d+(?:\\.\\d+)?)rpx").exec(tokens)?.[1] ?? dflt);
  const pageX = tok("--page-x", 28);
  // 卡片内边距是 .card 的 --sp-4（不是 --sp-3 —— 那是卡与卡之间的缝）。
  // 这一条一开始抄错了，算式凭空少 16rpx，差点得出「三列根本放不下」的假结论。
  const cardPad = tok("--sp-4", 32);
  const hintFs = tok("--fs-hint", 25);
  const ctlR = tok("--radius-ctl", 20);
  const cornerCut = Math.round(ctlR * 0.3);
  const chrome = 2;

  const reciteSrc = fs.readFileSync(path.join(ROOT, "packages/settings/recite/recite.wxml"), "utf8");
  const inlineTag = /<radio-group class="[^"]*opt-group inline[^"]*"/.exec(reciteSrc)?.[0] || "";
  const gridCols = Number(/repeat\((\d+)/.exec(rule(".opt-group.inline") || "")?.[1] ?? 0);
  const perRow = Number(/(^|\s)cols-(\d)/.exec(inlineTag)?.[2] ?? gridCols);
  ok("横排选项行的每行格数读得出来", perRow >= 2,
    "tag=" + JSON.stringify(inlineTag) + " grid=" + gridCols + " perRow=" + perRow);

  const sched = fs.readFileSync(path.join(ROOT, "utils", "scheduler.js"), "utf8");
  const labels = [...sched.matchAll(/label\s*:\s*"([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  const longestName = labels.length
    ? labels.reduce((a, b) => (b.length > a.length ? b : a))
    : "本册及之前";

  // 文字宽度得**量真字体**，不能按「一个字 1em」猜。
  //
  // 这里栽过两层：先按 1em 估，7 个字的选项名算成 175rpx，而格子内容盒
  // 只有 144rpx —— 算式说「放不下」，可预览里那格明明放着，只是**挤**。
  // 换成真字体度量之后又多错一次：量的是 .chip-t，而选项名走 --font-poem
  // （宋体），「+」在两边宽度不同（0.564 vs 0.584em）。
  // 度量表因此按**样式组合**分着导（.chip-t / .opt-name / .tag）。
  //
  // 表是 shots/measure.js --metrics 从浏览器里量出来的字体度量
  // （advance width / em）—— 不是渲染快照，与字号、--ui-scale 无关。
  const metricsPath = path.join(__dirname, "shots", "font-metrics.json");
  let adv = {};
  try { adv = JSON.parse(fs.readFileSync(metricsPath, "utf8")); } catch (e) { adv = {}; }
  const advFor = adv[".opt-name"] || {};
  ok("字体度量表在（按样式组合，由 shots/measure.js --metrics 从真字体导出）",
    Object.keys(advFor).length > 20,
    "组合：" + Object.keys(adv).join("/") + "，.opt-name " + Object.keys(advFor).length + " 个字符");
  const isWide = (c) => /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(c);
  const charW = (c) => (isWide(c) ? 1 : (typeof advFor[c] === "number" ? advFor[c] : 0.6));
  const textW = [...longestName].reduce((sum, c) => sum + charW(c) * hintFs, 0);

  const contentW = 750 - 2 * pageX - 2 * cardPad;
  const cellW = (contentW - (perRow - 1) * padXVal) / perRow;
  // 「两侧还剩多少」要按**格宽**算，不能按内容盒算 ——
  // 格子里的文字是居中的：内容盒比文字窄时，文字会**溢出到内边距上**，
  // 真机上照样居中、不一定折行。所以真正决定「挤不挤」的是
  // 文字到格子边框还剩多少（再减描边）。
  //
  // 一开始这里拿内容盒比，得出「溢出了 13rpx」，说得像 bug；
  // 而浏览器里那一格明明摆着，只是两侧各 9.6rpx 的窄。
  // 判据必须对着「看得见的东西」——两侧各剩多少，就是这么来的。
  const room = (cellW - textW) / 2 - chrome;
  const withRadius = room - cornerCut;
  // minGap 的出处是实测：取诗范围改两列之后，最紧的那一格两侧曾各 31.6px ≈ 63rpx
  // （当时最长的是 7 字名「小学+初中随机」，Issue #26 已收成「小初随机」）。
  //
  // ⚠️ 门槛 24rpx 是**跟着旧名定的**：旧名 7 字，三列时这里算出 11.5rpx，红。
  // 名字收短后最长的是「本册及之前」（5 字 125rpx），三列算出 32.5rpx ——
  // **仍过得了 24rpx 这道门槛**，也就是说这条断言从此不再挡「又加回一列」。
  // 不把门槛抬到 40 去补：那会把「列数」写进一条本来只管「文字两侧留白」的断言里，
  // 两件事混成一件。列数是设计决定（recite.wxml 里那段「为什么两列」），
  // 名字的长度是内容，不该由一条留白断言替内容背书。
  // 这里如实量、如实报：它量的是「当下最长的名字两侧还剩多少」，仅此而已。
  const minGap = 24;
  ok("最窄的选项格两侧留得住空（" + perRow + " 列 · " + longestName + "）",
    room >= minGap && withRadius > 0,
    "格宽 " + cellW.toFixed(1) + "，文字 " + textW.toFixed(1)
    + "（按 .opt-name 真字体度量）→ 两侧各余 " + room.toFixed(1)
    + "，再减圆角吃掉的 " + cornerCut + " = " + withRadius.toFixed(1)
    + "（须 ≥ " + minGap + "）");

  const optRowBody = rule(".opt-row") || "";
  ok("选项行与格子同一套内边距",
    /padding\s*:\s*var\(--pad-opt-y\)\s+var\(--pad-opt-x\)/.test(optRowBody));
  // 纵向内边距不许在别处被抵消：`.opt-main` 再补一层就是两层。
  // 判据只盯**选项里的那两个容器**，不扫全表 —— `.kv` 那种键值行本来
  // 就有自己的上下呼吸，跟选项无关（一条扫全表的规则会误伤它）。
  const noDouble = [".opt-main", ".chip-t", ".opt-name"].filter((cls) => {
    const b = rule(cls) || "";
    return /padding(-top|-bottom)?\s*:/.test(b);
  });
  ok("选项文字没有第二层纵向内边距", noDouble.length === 0, noDouble.join(", "));

  /* b) 背诵设置页里**没有**阅读偏好（注音 / 对齐 / 字号）。
     这一页前后出过两版错：先是被塞成「一行七个段」（年级、学期、注音、对齐、
     字号全挤一行），再是被收成「一行三段」（只留注音/对齐/字号）。两版都把
     **阅读偏好**搬到了「选背哪些」的设置页里。用户这轮把方向定死了：

     「「注音 ｜ 对齐 ｜ 字号」只应该出现在详情页和具体古诗背诵卡片里，
      怎么显示在了背诵范围这里」

     所以这一页不该再出现这三组（连同它们的排法 .pref-row / .font-step /
     .fs-btn 一并删除）。它们该在的地方是详情页（pages/reader 的 .prefs）
     与阅读设置页（packages/settings/general）—— 那两处另有一条断言守着。

     同时守着上一轮的结论：学期两格、这页不再有 <slider>
     （详情页那根滑块才是字号该在的地方）。
     年级那条这一轮换了口径，见下面以及 V23.9。 */
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
  /* 年级：**按学段收窄，但一个年级都不丢**。
     这条断言换过一次口径，换的理由要写在这儿，不然下一轮又会来回改。

     上一版的口径是「年级十二格同屏、一个不收」，出处是 Issue #26 那句
     「年级从十二格收到六格（取最近六年）- 谁让你这么瞎搞的，这能收吗」。
     那一句禁的是**按最近六年砍掉高年级**，不是「十二格必须同屏」——
     上一版读成了后者，于是十二格全列、没有学段那一格，
     用户在小学段里也能看见「高三」，却看不出自己站在哪一段里。

     这一版（Issue #26 后半段「背诵范围内……应该显示为 当前学段」）
     把学段那一格补上，年级格只列当前这一段 —— 于是要同时守住两件事：
       a. 一至高三 **12 个年级都还在**（STAGE_GRADES 三段合起来是 12 个）
       b. 屏幕上只列**当前学段**的那几格（不再十二格同屏）
     只守 a 会退回「没有学段那一格」，只守 b 会退回「砍掉高年级」。 */
  {
    const sched = fs.readFileSync(path.join(ROOT, "utils/scheduler.js"), "utf8");
    const gradeNames = sched.match(/const GRADE_NAMES = \{([\s\S]*?)\};/)[0]
      .replace("const GRADE_NAMES = ", "").replace(/;$/, "").replace(/(\d+):/g, '"$1":');
    const stageGrades = sched.match(/const STAGE_GRADES = \{([\s\S]*?)\};/)[0]
      .replace("const STAGE_GRADES = ", "").replace(/;$/, "")
      .replace(/(\w+):/g, '"$1":');
    const named = Object.keys(JSON.parse(gradeNames));
    const staged = Object.keys(JSON.parse(stageGrades))
      .reduce((acc, k) => acc.concat(JSON.parse(stageGrades)[k]), []);
    ok("一至高三共 12 个年级都还在（没有被「最近六年」砍掉）",
      named.length === 12 && reciteJs.indexOf("RECENT") < 0,
      "GRADE_NAMES 有 " + named.length + " 个，recite.js 里 " +
        (reciteJs.indexOf("RECENT") < 0 ? "没有 RECENT" : "还留着 RECENT 那个过滤"));
    ok("三段学段合起来正好覆盖这 12 个年级（一个不丢、一个不重）",
      staged.length === 12 && new Set(staged).size === 12
        && named.every((g) => staged.indexOf(Number(g)) >= 0),
      "三段合起来是 [" + staged.join(",") + "]，年级表是 [" + named.join(",") + "]");
    ok("屏幕上只列当前学段的年级格（gradeRows 从 STAGE_GRADES 取）",
      /STAGE_GRADES\[S\.stageOf\(grade\)\]/.test(reciteJs),
      "看 recite.js 的 gradeRows —— 年级格要从 STAGE_GRADES 按当前学段取");
  }
  /* 学段 / 年级 / 学期在同一张卡的格子里，顺序是**学段 → 年级 → 学期**
     （Issue #12 原话「学期显示在年级下面」；学段那一格是 Issue #26 后半段加的）。
     判据按出现顺序认，且**不许**钉死某一个 cols-* —— 格子里的年级数
     现在跟着学段走（最多六格），列数由段内数量定。 */
  {
    const iStage = recite.indexOf('bindchange="onStage"');
    const iGrade = recite.indexOf('bindchange="onGrade"');
    const iTerm = recite.indexOf('bindchange="onTerm"');
    ok("学段 / 年级 / 学期在同一张卡的格子里，顺序是 学段 → 年级 → 学期",
      iStage >= 0 && iStage < iGrade && iGrade < iTerm,
      "学段@" + iStage + " 年级@" + iGrade + " 学期@" + iTerm);
    ok("学期仍是两格（学段是三格）",
      /<radio-group class="chip-group cols-2"[^>]*bindchange="onTerm"/.test(recite)
        && /<radio-group class="chip-group cols-3"[^>]*bindchange="onStage"/.test(recite));
  }
  /* 领读词换了口径：范围那一张卡自己叫「背诵范围」之后，
     页头不能再叫同名（同一句话在一屏里说两次，见页头那条断言）。
     页头改成一句管整屏的短话 —— 与「阅读」「版式」同一长相。
     2026-10-03 用户又说「所有页面的标题…都专业，精简」，
     于是量词式的「怎么背」也收成一个名词「背诵」。 */
  ok("这一屏的页头是一句管整屏的短话，不与任何卡片同名",
    /<text class="head-title">背诵<\/text>/.test(recite));

  // c) 取诗范围是横排
  ok("取诗范围是横排的选项行（opt-group inline）",
    /<radio-group class="opt-group inline/.test(recite));
  ok("横排的选项行有排法（grid，不是一行一条）",
    /\.opt-group\.inline\s*\{[^}]*grid-template-columns/.test(body));

  // d) 控件与按钮同一档圆角
  const fills = {
    ".btn": rule(".btn"),
    ".chip": rule(".chip"),
    ".opt-row": rule(".opt-row")
  };
  const noRadius = Object.entries(fills).filter(([, v]) => !v || !/border-radius\s*:\s*var\(--radius-ctl\)/.test(v));
  ok("按钮与两种选项格取同一档圆角（--radius-ctl）",
    noRadius.length === 0, noRadius.map(([k]) => k).join(", "));
  ok("控件圆角不是胶囊（上一版 .btn 是 999rpx）",
    !/\.btn\s*\{[^}]*border-radius\s*:\s*var\(--radius-pill\)/.test(body));
}

/**
 * V23.9 背诵设置页的两件事（Issue #26 的后半段）。
 *
 * 用户这一段话只有两句，都在说**那一屏的卡片名与卡片内容**：
 *
 *   > 背诵范围内背诵范围卡片应该显示为 当前学段
 *   > 取诗范围修改为 背诵范围
 *
 * 第二句是改名：卡片「取诗范围」→「背诵范围」（网页版也还叫取诗范围，
 * 小程序端先改）。第一句是那张卡的内容：它不该是「让用户从十二格里挑一个
 * 年级」的裸列表，而该先说清**当前学段**是哪一个 ——
 * 学段是年级十二格的上位（网页版 js/app.js 的 STAGES 就是这个结构），
 * 选段之后年级格只列这一段。
 *
 * 这几条断言各钉住一句话，每条都做过反证（改坏确认会红）：
 *   a. 卡片名是「背诵范围」，界面上不再有「取诗范围」，且一屏里没有同名两张卡
 *   b. 有「当前学段」那张卡，它给的是三段而不是十二段
 *   c. 点学段会动年级与范围（学段不是三个纯装饰的格子）
 */
{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const recite = read("packages/settings/recite/recite.wxml");
  const reciteJs = read("packages/settings/recite/recite.js");
  const sched = read("utils/scheduler.js");

  // a) 改名：卡片叫「背诵范围」，「取诗范围」这个旧名只许留在注释里
  const visible = (t) => t.replace(/<!--[\s\S]*?-->/g, "");
  ok("背诵设置页的卡片名是「背诵范围」",
    /<view class="card-title bar">背诵范围<\/view>/.test(visible(recite)));
  ok("界面上不再有「取诗范围」（旧名只许留在注释里）",
    visible(recite).indexOf("取诗范围") < 0,
    "还有一处渲染出来的「取诗范围」—— 改名只改了一半");
  /* 一屏里同一句话不做两张卡的名字。上一版正是这样：
     页头「背诵范围」+ 范围卡「取诗范围」，改名之后如果页头不动，
     就会变成页头「背诵范围」+ 范围卡「背诵范围」——同名两张卡。 */
  {
    const titles = (visible(recite).match(/<view class="card-title bar">[^<]*<\/view>/g) || [])
      .map((m) => m.replace(/<[^>]+>/g, ""));
    ok("一屏里没有同名两张卡",
      titles.length === new Set(titles).size,
      "重名的是：" + titles.filter((t, i) => titles.indexOf(t) !== i).join("、"));
  }

  // b) 当前学段：三段，不是十二段
  ok("有「当前学段」那张卡",
    /<view class="card-title bar">当前学段<\/view>/.test(visible(recite)));
  ok("学段给的是三段（小学 / 初中 / 高中），不是十二格年级",
    /class="chip-group cols-3"[^>]*bindchange="onStage"/.test(recite)
      && /const STAGES\s*=\s*S\.STAGE_KEYS\.map/.test(reciteJs));
  ok("学段用的是 scheduler 里那份口径（不另抄一份）",
    /primary:\s*\{ name: "小学"/.test(sched)
      && /STAGES,/.test(sched)
      && /stageOf/.test(sched));
  // 三段的名字就是网页版那三个词
  ["小学", "初中", "高中"].forEach((n) => {
    ok("学段里有「" + n + "」", sched.indexOf('name: "' + n + '"') >= 0);
  });
  /* ⚠️ 这一条是踩过的坑：scheduler 里还有另一个 stageName ——
     它回答的是「这首背到哪个记忆阶段了」（新学 / 复习），
     与「小学 / 初中 / 高中」是两件事。学段若也命名成 stageName，
     后定义的那个会把前一个盖掉，学段那一行就印出了「新学」。
     所以：学段用 stageLabel 这个名字，且**这两个函数都必须在**。 */
  ok("学段那个名字没被「记忆阶段」的同名函数盖掉",
    /function stageLabel\(/.test(sched) && /function stageName\(rec\)/.test(sched)
      && (sched.match(/function stageName\(/g) || []).length === 1,
    "scheduler 里有两个 stageName —— 后一个会把前一个盖掉");

  // c) 学段不是纯装饰：点它会动年级，也会动取诗范围
  const onStage = /onStage\(e\)\s*\{([\s\S]*?)\n  \}/.exec(reciteJs);
  const onStageBody = onStage ? onStage[1] : "";
  ok("点学段会把年级跳到这一段里（不是只换格子）",
    /STAGE_GRADES\[key\]/.test(onStageBody) && /grade/.test(onStageBody));
  ok("点学段会把取诗范围换成这一段的随机范围",
    /scopeForStage\(/.test(onStageBody) && /function scopeForStage/.test(reciteJs));
  /* 但**小初随机 / 全部随机 不许被动**：它们本来就横跨学段，
     换学段影响不到它们。判据是「只换单学段的那些」。 */
  ok("横跨学段的两个范围（小初随机 / 全部随机）不跟着换",
    /stages\.length === 1/.test(reciteJs),
    "scopeForStage 少了对「单学段」的判据 —— 换学段会把小初随机也换掉");
}

/**
 * V24. 这一轮（Issue #26）改掉的那几件事，逐条钉住。
 *
 * 用户给的是六句话，每一句都是「一个已经做出来的东西不该长这样」：
 *
 *   1. 「今日背什么 改成 背诵范围」
 *   2. 「如下按此顺序一行内显示（整体居中）：左对齐 居中 不注音 生字 全文 A- A+」
 *   3. 「十七部集子 改成 课外阅读」
 *   4. 「搜索页的 范围 方式选项卡片删除 …… 不要再增加用户选择成本」
 *   5. 「模拟考试改名为考试 所有题目答完后再给分给对错 (宽度你应该只显示一半)」
 *   6. 「5 个题型（可多选）全填成墨黑胶囊，跟「选一个」的选中态长得一模一样，
 *      只看色块分不出哪个没勾」
 *
 * 这些都是**一句话的改动**，也正是最容易在下一轮里被改回去的那种 ——
 * 它们看起来都「没坏」，只是回到了上一版的样子。所以每条都有断言。
 */
{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "");
  const body = strip(appWxss);
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const wxssOf = (p) => strip(read(p + ".wxss"));

  /* 1) 领读词。
     用户那一句「今日背什么 改成 背诵范围」说的是**这一屏在回答什么**。
     落到哪儿有过两版：先是页头，后来范围那张卡自己改名成了「背诵范围」，
     页头就换成一句管整屏的短话（不再重复任何卡片名）。
     所以这里守的判据分两步：改名这件事**发生过**（全站不再有「今天背什么」，
     且「背诵范围」这几个字确实在那一屏上），而页头不叫它。 */
  ok("背诵设置页上「背诵范围」这几个字在（不再是「今天背什么」）",
    read("packages/settings/recite/recite.wxml").indexOf("背诵范围") >= 0
      && read("packages/settings/recite/recite.wxml").indexOf("今天背什么") < 0);
  /* 判据取**渲染出来的文本**，不是源码整段 —— 注释里要留着旧名，
     否则下一轮没人知道「这里原来叫什么、为什么改」。所以先把注释摘掉。 */
  const visible = (p) => read(p + ".wxml").replace(/<!--[\s\S]*?-->/g, "");
  ok("全站界面上不再有「今天背什么」",
    pages.every((p) => visible(p).indexOf("今天背什么") < 0),
    pages.filter((p) => visible(p).indexOf("今天背什么") >= 0).join(", "));

  // 2) 背诵设置页里不该有注音 / 对齐 / 字号 —— 它们只在详情页与阅读设置页
  {
    const recite = read("packages/settings/recite/recite.wxml");
    const reciteJs = read("packages/settings/recite/recite.js");
    ["左对齐", "居中", "不注音", "生字", "全文", "A－", "A＋"].forEach((t) => {
      ok("背诵设置页里没有「" + t + "」（这三组在详情页与阅读/通用设置页）",
        recite.indexOf(t) < 0 && reciteJs.indexOf(t) < 0);
    });
    ok("这一页也没有 slider", recite.indexOf("<slider") < 0);
    // 它们该在的地方**得真有** —— 不然「撤掉」就成了「弄丢」。
    // 三件事现在的位置：详情页全有（读这首诗时当场调）；
    // 集中调一次的地方是「通用设置」页（general）的「版式」那一节，
    //   ⚠️ 2026-10-04 之前注音被单关在 settings/reader 里，与对齐 / 字号分家。
    //   用户那天问「通用设置版式里有对齐和字号，怎么没有注音的设置？」
    //   —— 三件事现在都在这两处，没有第三个地方。
    const reader = read("pages/reader/reader.wxml");
    ok("详情页（读这首诗时）注音 / 对齐 / 字号三样都在",
      /onPinyin/.test(reader) && /onAlign/.test(reader) && /onFontDown/.test(reader) && /onFontUp/.test(reader));
    const general = read("packages/settings/general/general.wxml");
    ok("「通用设置」页三样都在（对齐 / 注音 / 字号）",
      /onAlign/.test(general) && /onFontSlide/.test(general) && /onPinyin/.test(general));
    const generalJs2 = read("packages/settings/general/general.js");
    ok("通用设置里的注音走 pinyin.setMode()（不自己写一份 store）",
      /pinyin\.setMode\(/.test(generalJs2));
    // 注音不许在第三个地方再留一份副本
    ok("「阅读设置」页不再有注音（它现在只管声音）",
      !/onMode/.test(read("packages/settings/reader/reader.wxml"))
        && !/onMode\s*\(/.test(read("packages/settings/reader/reader.js"))
        && !/PINYIN_MODES/.test(read("packages/settings/reader/reader.js")));
  }

  /* 2.2) 详情页那三组偏好**必须在一行里**。
     用户 2026-10-03：「设置页可以分三段设置，但是详情页一行显示」，
     原话里的那一条是「一行内显示（整体居中）：左对齐 居中 不注音 生字 全文 A- A+」。
     上一版详情页把注音 / 对齐 / 字号排成三行（字号还独占一整行）——
     三排控件把正文挤到半屏以下，而这一页的主角是诗。这一条防的就是
     「下一轮谁觉得挤了，又给挪回三行」。

     它是**结构**那一层的判据（三组在不在同一个容器里、分不分段、文案有没有被缩写）；
     「一行到底装不装得下」是 V25 那套算式的事，两边各管一头。 */
  {
    const readerWxml = read("pages/reader/reader.wxml");
    // 这一行的样式住在 app.wxss 的「阅读面」一节 —— 详情页与首页弹层共用一份。
    // 分隔条现在**不存在**了（2026-10-03 用户说删掉），所以断言改成「没有它」：
    // 上一版拿 .rule 当右边界，删掉之后那条恰恰会「把它加回来才绿」，
    // 与用户要的正相反。
    const surfaceWxss = read("app.wxss").replace(/\/\*[\s\S]*?\*\//g, "");
    const readerWxss = read("pages/reader/reader.wxss").replace(/\/\*[\s\S]*?\*\//g, "");
    // 三组在同一个 .prefs 里，且这一行在正文**之前**。
    const prefsAt = readerWxml.indexOf('class="prefs"');
    ok("详情页有一个 .prefs 容器，三组都在里面（在正文之前）", prefsAt >= 0);
    ok("A－ A＋ 与古诗内容之间不再有「--正文--」那一行",
      !/class="rule"/.test(readerWxml) && !/\.rule\s*\{/.test(readerWxss));
    // 右边界取 .prefs 那个容器的收尾 —— 它后面紧跟的是正文。
    // 数 `</view>` 是不行的：这一行里还嵌着两层，那个 `</view>` 先撞上的是
    // 字号的壳（上一版就是这么把 onFontUp 切掉的）。
    const prefsEnd = readerWxml.indexOf('class="poem-body', prefsAt);
    const inPrefs = readerWxml.slice(prefsAt, prefsEnd > prefsAt ? prefsEnd : readerWxml.length);
    ok("详情页三组（对齐 / 注音 / 字号）都在同一个 .prefs 里",
      /onPinyin/.test(inPrefs) && /onAlign/.test(inPrefs)
        && /onFontDown/.test(inPrefs) && /onFontUp/.test(inPrefs));
    ok("这个容器是**一行**（display:flex，不换行）",
      /\.prefs\s*\{[^}]*display:\s*flex/.test(surfaceWxss)
        && !/\.prefs\s*\{[^}]*flex-wrap:\s*wrap/.test(surfaceWxss));
    ok("三组之间有两处分隔（对齐｜注音｜字号是三段、不是一团）",
      (readerWxml.match(/class="pref-rule"/g) || []).length >= 2);
    /* 档里的文案就是用户给的那几个全称，不缩写。
       曾经想过把「左对齐」缩成「左」给字号腾宽度 —— 用户那句话里
       每个档都是全称，缩字是他没要的东西。宽度靠收一档字解决。 */
    ["左对齐", "居中", "不注音", "生字", "全文", "A－", "A＋"].forEach((t) => {
      ok("详情页那一行用的是「" + t + "」这个全称", readerWxml.indexOf(t) >= 0);
    });
    // 撤掉不等于弄丢：图标仍在通用设置页那一份里（那里一档一整行，放得下）
    const general = read("packages/settings/general/general.wxml");
    ok("图标没被一起弄丢 —— 通用设置页那一份仍在",
      /seg-icon\s+ic-/.test(general));
  }

  // 2.5) 每日首数：卡片要在，四档是 3 / 5 / 10 / 20，默认 5
  /* 上一版把这张卡整块撤了，理由写的是「全站默认就是 5 首」。
     那是把「不选时拿几首」当成了「用户不需要选」——
     用户的账本不是这么记的：「那需要在设置里添加设置 3 5 10 20」。 */
  {
    const recite = read("packages/settings/recite/recite.wxml");
    ok("「每日首数」这张卡还在",
      /class="card-title bar">每日首数<\/view>/.test(recite));
    const counts = /const DAILY_COUNTS = \[([^\]]*)\];/.exec(read("utils/scheduler.js"));
    const list = (counts ? counts[1] : "").split(",").map((t) => t.trim()).filter(Boolean);
    ok("四档是 3 / 5 / 10 / 20",
      list.join(",") === "3,5,10,20", "读到的是 [" + list.join(", ") + "]");
    ok("默认档 5 命中了这四档里的一个（否则打开设置页没有一格是亮的）",
      list.indexOf("5") >= 0 && /dailyCount:\s*5/.test(read("utils/store.js")));
  }

  // 3) 课外阅读那一屏的名字：只有导航栏一处，页内不再另起一行
  ok("课外阅读页的导航栏标题是「课外阅读」",
    /"navigationBarTitleText"\s*:\s*"课外阅读"/.test(read("pages/library/library.json")));
  ok("课外阅读页不再画第二块「课外阅读」招牌",
    read("pages/library/library.wxml").indexOf('class="head-title"') < 0);
  ok("全站界面上不再有「十七部集子」",
    pages.every((p) => visible(p).indexOf("十七部集子") < 0),
    pages.filter((p) => visible(p).indexOf("十七部集子") >= 0).join(", "));

  // 4) 搜索页：两块「选一个」的卡片整块撤掉，一个控件都不留
  {
    const search = read("pages/search/search.wxml");
    ok("搜索页不再有范围 / 方式的选项卡片",
      search.indexOf("opt-block") < 0 && search.indexOf("scope") < 0 && search.indexOf("mode") < 0);
    ok("搜索页不再有分段控件（一个「选一个」都不该有）",
      search.indexOf("seg-group") < 0 && search.indexOf("<radio") < 0);
    // 但读数要留着 —— 撤掉的是「要用户选」，不是「告诉用户结果从哪来」
    ok("搜索页仍然交代「命中几篇 · 在哪儿搜的」",
      search.indexOf("resultWhere") >= 0 && search.indexOf("result-count") >= 0);
    // 方式改由系统定：先篇名作者，没结果再落到全文
    const js = read("pages/search/search.js");
    ok("搜索先按篇名作者找，无结果才落到正文全文",
      /byIndex\(kw\)/.test(js) && js.indexOf("byIndex(kw)") < js.indexOf("runFull(kw)"));
  }

  // 5) 考试改名 + 「全部答完再批」
  {
    const examJs = read("packages/game/exam/exam.js");
    const examWxml = read("packages/game/exam/exam.wxml");
    ok("考试页的导航栏标题是「考试」",
      /"navigationBarTitleText"\s*:\s*"考试"/.test(read("packages/game/exam/exam.json")));
    ok("全站不再有「模拟考试」",
      pages.concat(["../../utils/entitlement.js"]).length > 0
      && !/模拟考试/.test(read("packages/game/index/index.js")));
    /* 答题途中不许判对错：判分那一步只许出现在 onPick **之后**。
       判据取「出现顺序」而不是「两个方法之间有没有」—— 方法的顺序会变，
       而「先记答案、后交卷批」这个次序是这个功能本身。
       （局部取个别名 `judge` 也算调用：找的是 `quiz.judge` 或 `judge(`。） */
    const iPick = examJs.indexOf("onPick(e)");
    const iJudge = examJs.search(/judge\s*\(/);
    ok("答题途中不判对错（判分那一步排在 onPick 之后）",
      iPick >= 0 && iJudge > iPick,
      "onPick @" + iPick + " 判分 @" + iJudge + " —— 判分排在答题之前就等于当场把答案说了出来");
    ok("批是在交卷时做的（finish 里逐题判）",
      /finish\(\)[\s\S]{0,900}?judge\s*\(/.test(examJs));
    // 逐题摊开：对的也列（.graded 含 ok 标记）
    ok("交卷后逐题列出对错（不只是错题）",
      examWxml.indexOf("graded") >= 0 && examWxml.indexOf('class="grade-mark') >= 0);
    // 选项宽度只占一半：两列网格
    const examWxss = wxssOf("packages/game/exam/exam");
    ok("选项是两列（宽度只有一半，不再是通栏一条）",
      /\.options\s*\{[^}]*grid-template-columns\s*:\s*repeat\(2/.test(examWxss),
      ".options 的列数读不出来");
  }

  // 6) 多选：与单选看得出区别，而那区别**只在底色上**。
  //
  //    这一节前后有五版，前四版都栽在同一个地方 —— 用户看截图能一眼看出不对，
  //    而当时的断言看不出：
  //
  //      一版  「墨黑胶囊 + 右上角一枚小勾」→「只看色块分不出哪个没勾」
  //      二版  「人人一颗双圈，内圈都填实」→「难道不是只有选中了才是重色吗？」
  //      三版  「白底 + 左侧空心框」→「为什么不是未选中用灰色背景(和其他一样)」
  //      四版  「灰底 + 右侧空心框 + 勾」→「还有空心框？…为啥还有空心框」
  //
  //    三版和四版是同一根上的两次拐弯：用户那句
  //    「我不喜欢右侧方形选框，为什么不是未选中用灰色背景」被读成了
  //    「方框挪到右边」，而他要的是**把框整个拿掉** —— 他连着四遍都在说
  //    「靠颜色区分」。所以这一节的判据不再问「框画在哪边」，改问
  //    「除了底色之外，还有没有别的东西」。
  {
    const chipMulti = /\.chip\.multi\s*\{([^}]*)\}/.exec(body);
    const multiOff = /\.chip\.multi:not\(\.on\)\s*\{([^}]*)\}/.exec(body);
    const markOff = /\.chip\.multi::after\s*\{([^}]*)\}/.exec(body);
    const checkOff = /\.chip\.multi::before\s*\{([^}]*)\}/.exec(body);
    const toStr = (m, g) => (m ? (g ? m[g] : m[1]).replace(/\s+/g, " ").trim() : "");

    ok("多选的格子有**自己的形状**（.chip.multi 有自己的规则）", !!chipMulti);

    /* a) **未选中 = 灰底**，且那底色是全站「能按的槽」那一档（--sink）。
          「和其他一样」这一句就在这儿：别处那些选项未选中也各有一档底色。 */
    ok("未选中的多选格子有底色（.chip.multi:not(.on) 有 background）",
      !!multiOff && /background\s*:/.test(multiOff[1]), toStr(multiOff));
    ok("那底色是全站「能按的槽」那一档（--sink），不是另造一层灰",
      !!multiOff && /var\(--sink\)/.test(multiOff[1]), toStr(multiOff));

    /* b) **只有选中才是重的**。这条守的是「不许把主色写进 .chip.multi 本体」——
          它排在 .chip.on 之后，写在那里会把选中态那一块主色盖回成灰的；
          所以灰底必须写在 :not(.on) 上。 */
    ok("多选格子的主色底不写在 .chip.multi 本体上（否则会盖掉选中态）",
      !!chipMulti && !/background\s*:/.test(chipMulti[1]), toStr(chipMulti));

    /* c) **除了底色之外的记号，一律不许有**（用户四版的原话拦在这里）。
          守四条：方框不画、勾不画、不给它们留位、也不许换个伪元素偷偷画回来。
          ④ 是刻意写死「一个都不许」，而不是「::after / ::before 都不许」——
          换个名字（::before 改 ::after、或再加一个 ::marker）就能绕过的判据
          等于没有；这一处已经绕过一次了。 */
    ok("多选格子不再画方框（.chip.multi::after 不许存在）", !markOff, toStr(markOff));
    ok("多选格子不再画勾（.chip.multi::before 不许存在）", !checkOff, toStr(checkOff));
    ok("多选格子不许再挂任何伪元素（不给方框留后门）",
      !/\.chip\.multi[^{}]*::/.test(body),
      ((/\.chip\.multi[^{}]*::[a-z-]+/g).exec(body) || [""])[0]);
    /* 名字两侧不再为那枚方框让宽 —— 四版让出的那两块正是名字被挤换行的原因。
       判据取「两侧内边距与 .chip 本体一字不差」，不写死 rpx 数：
       改 --pad-opt-x 时两边一起改，不会误红。 */
    {
      const chip = /\.chip\s*\{([^}]*)\}/.exec(body);
      /* 别处的格子用**简写** `padding: var(--pad-opt-y) var(--pad-opt-x)`，
         多选那一档为了把「不留位」写明白用了两条长写 —— 取值相等即可，
         不比写法。 */
      const pad = (src) => {
        const short = /padding\s*:\s*([^;]+);/.exec(src);
        /* 只取**左右**两档（纵向上下一律不管）：简写是「上 下 右 左」的
           四值写法时取后两位，两值写法时取第一位。 */
        if (short) {
          const p = short[1].replace(/\s+/g, " ").trim().split(" ");
          return (p.length === 3 ? p[2] + "|" + p[2] : p.length >= 4 ? p[2] + "|" + p[3] : p[p.length - 1] + "|" + p[p.length - 1]);
        }
        const l = /padding-left\s*:([^;]+);/.exec(src);
        const r = /padding-right\s*:([^;]+);/.exec(src);
        return l && r ? l[1].replace(/\s+/g, "") + "|" + r[1].replace(/\s+/g, "") : "";
      };
      const chipPad = pad(chip ? chip[1] : "");
      ok("多选格子不为方框留位（两侧内边距与别处格子一字不差）",
        !!chipPad && pad(chipMulti ? chipMulti[1] : "") === chipPad,
        "多选 " + pad(chipMulti ? chipMulti[1] : "") + " ／ 别处 " + chipPad);
    }

    /* d) 选中态与别处一字不差：填主色、白字。
          （Issue #26 之后「主色」有两支：--ink 是字，--strong 是重点/选中态。
            选中态那一支是 --strong，所以这里认它。）
          选中那一档本来就来自 `.chip.on`，多选这一组没有自己的选中规则 ——
          这正是「选中了就是主题色背景色」那句话的字面实现，也顺手守住了
          「别给多选再写一条选中态」。 */
    ok("多选的选中态就是全站那一条（.chip.multi.on 不另写规则）",
      !/\.chip\.multi\.on\b(?![\(-])/.test(body),
      ((/\.chip\.multi\.on[^{]*/g).exec(body) || [""])[0]);

    /* e) **预览也认得出「哪几格勾上了」**。这条守的不是界面，是那把尺子 ——
          而它骗过人：页面写的是 `{{pickedForms.indexOf(item.key) >= 0 ? 'on' : ''}}`，
          wxml.js 那层极简求值算不了 `indexOf` 这种成员调用，一失败就 undefined，
          于是每格都拿到 `on`、每格都画成勾上的。用户连着两轮问的
          「怎么全部都是选中的重色」，一半是产品、一半是这张截图。
          判据取**源码里有那段组语义**，且它是按平台语义写的（取 indexOf 的接收者）。 */
    {
      const shotSrc = fs.readFileSync(path.join(__dirname, "shots", "wxml.js"), "utf8");
      ok("预览认得可多选那一组（checkbox-group 有那段组语义）",
        /n\.tag === "checkbox-group"/.test(shotSrc) && /function multiPicker/.test(shotSrc));
      /* 取的是 indexOf 的**接收者**（那份清单），不是它的参数 ——
         写成参数就会去 v("item.key")，永远拿不到数组、判据恒为 null，
         界面照旧全勾上。所以这条**真跑一遍** multiParser，不读正则源码：
         喂一份三项的清单，看它认不认得出第一、三项勾上、第二项没勾。 */
      {
        const mod = { exports: {} };
        const dir = path.join(__dirname, "shots");
        const src2 = shotSrc.replace(
          /module\.exports\s*=\s*\{[^}]*\};/,
          "module.exports = { multiPicker, findCheckedAttr, tokenize, attrsOf, holeRestore };"
        );
        let picked = null;
        try {
          // 借 wxml.js 自己的那套：在一个隔离作用域里跑它的源码
          const fn = new Function("module", "exports", "require", "__dirname", src2);
          fn(mod, mod.exports, require, dir);
          const data = { pickedForms: ["next", "title"] };
          const keys = Object.keys(data), vals = keys.map((k) => data[k]);
          const v = (e) => {
            const x = String(e).replace(/^\{\{|\}\}$/g, "").trim();
            try { return new Function(...keys, "return (" + x + ")")(...vals); }
            catch (err) { return undefined; }
          };
          const pick = mod.exports.multiPicker("{{pickedForms.indexOf(item.key) >= 0}}", v);
          picked = pick && [
            pick({ key: "next" }),      // 勾了 → 真
            pick({ key: "prev" }),      // 没勾 → 假
            pick({ key: "title" })      // 勾了 → 真
          ];
        } catch (e) {
          picked = null;
        }
        ok("预览的组语义算得对（勾了的那两格真、没勾的假）",
          !!picked && picked[0] === true && picked[1] === false && picked[2] === true,
          picked ? JSON.stringify(picked) : "跑不起来");
      }
      /* 组里那一格勾没勾，要在 wx:for 逐项时算 —— 不能把第一格的结果
         沿调用链带下去（那会串味：第一格的勾盖住后面几格）。 */
      ok("勾没勾是在逐项时算的（pickOf(it)，不是一次算好往下带）",
        /pickOf\s*\?\s*pickOf\(it\)/.test(shotSrc));
    }

    /* h) 题型名收成两个字 —— 见 utils/quiz.js 的 FORMS。
          它是嵌在「题型 · 出自《…》」那一行读数里的，四个字会把那一行顶到折行。 */
    const forms = /const FORMS = \[([\s\S]*?)\];/.exec(read("utils/quiz.js"));
    const names = forms ? [...forms[1].matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]) : [];
    ok("五个题型名都是两个字（下句 / 上句 / 作者 / 朝代 / 篇名）",
      names.length === 5 && names.every((n) => n.length === 2), names.join(" / "));
    ok("题型名里不再带动词（接下句 / 认作者 / 填朝代 那一版不许回来）",
      names.every((n) => ["接", "认", "填"].indexOf(n[0]) < 0), names.join(" / "));
  }
}


/**
 * V25. 详情页的阅读偏好是**一行**（Issue #26 最后一句）。
 *
 * 用户原话：
 *
 *   「详情页你是没动，但是不是说了 「注音 ｜ 对齐 ｜ 字号」一行显示吗，你做到了吗？」
 *   「详情页一行显示 —— 左对齐 居中 不注音 生字 全文 A- A+」
 *
 * 这是这一轮里唯一一件「做没做到」可以量出来的事：三组装进卡片内容宽
 * （750 − 2·page-x − 2·cardPad = 598rpx）就成，装不进就折行。
 * 所以这条断言不写「看着挺顺」这种话，它把这一行按**真字体度量 +
 * 真令牌 + 真档位**算一遍，放不下就红 —— 文案改长一个字、字号抬一档、
 * 多塞一个档位，都会当场红。
 *
 * 算式里没有手抄的数：
 *   · 字号     取 --fs-caption（这一行用的那一档）
 *   · 档位名   取自 pages/reader/reader.js 的 ALIGNS / PINYIN_MODES
 *   · 段内边距 取自 .pref-opt 的 padding 与 .pref-rule 的 margin
 *   · 字宽     取 shots/font-metrics.json 的 .opt-name（真字体）
 *
 * 另外两条守着「别把 slider 又搬回来」和「不许折行」。
 */
{
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  const tok = (name, dflt) =>
    Number(new RegExp(name + "\\s*:\\s*calc\\((\\d+(?:\\.\\d+)?)rpx").exec(tokens)?.[1] ?? dflt);

  const readerWxml = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxml"), "utf8");
  const readerJs = fs.readFileSync(path.join(ROOT, "pages/reader/reader.js"), "utf8");
  // ⚠️ 这一节量的那一行自 2026-10-03 起住在 app.wxss 的「阅读面」一节
  // （详情页与首页弹层共用一份），所以读它，不读某一页的样式表。
  const readerWxss = fs
    .readFileSync(path.join(ROOT, "app.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const ruleBody = (cls) => {
    const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp("(^|\\})\\s*" + esc + "\\s*\\{([^}]*)\\}").exec(readerWxss);
    return m ? m[2] : "";
  };
  const px = (body, prop, dflt) => {
    const m = new RegExp(prop + "\\s*:\\s*var\\((--[\\w-]+)\\)").exec(body);
    return m ? tok(m[1], dflt) : dflt;
  };

  // 1) 一行三段：对齐 · 注音 · 字号，且顺序就是用户给的那个
  const segs = (readerWxml.match(/class="pref-seg"/g) || []).length;
  ok("详情页的偏好条是一行三段（对齐 · 注音 · 字号）", segs === 2,
    "读到 " + segs + " 组 —— 加上字号那两个按钮才是三组");
  const iAlign = readerWxml.indexOf('class="pref-seg" bindchange="onAlign"');
  const iPinyin = readerWxml.indexOf('class="pref-seg" bindchange="onPinyin"');
  const iSize = readerWxml.indexOf('class="pref-size"');
  ok("顺序是「对齐 → 注音 → 字号」（用户给的顺序）",
    iAlign >= 0 && iAlign < iPinyin && iPinyin < iSize,
    "align@" + iAlign + " pinyin@" + iPinyin + " size@" + iSize);

  // 2) 这一行不许被换成 <slider>，也不许折行
  const prefsBody = ruleBody(".prefs") || "";
  // 先摘注释：这一段注释里就写着「上一版是一根 <slider>」
  const visibleReader = readerWxml.replace(/<!--[\s\S]*?-->/g, "");
  ok("这一行没有 <slider>（量程放不进一行，换成 A－ / A＋ 两个端点）",
    visibleReader.indexOf("<slider") < 0 && readerJs.indexOf("onFontSlide") < 0,
    visibleReader.indexOf("<slider") >= 0 ? "WXML 里还有 slider" : "JS 里还有 onFontSlide");
  ok("这一行显式不折行（放不下就该红，不该悄悄折成两行）",
    /flex-wrap\s*:\s*nowrap/.test(prefsBody));
  ok("这一行整行居中", /justify-content\s*:\s*center/.test(prefsBody));

  // 3) 量一量：这一行装不装得进**卡片内能排的那条宽度**
  //
  // ⚠️ 这里栽过一次，值得写下来：「卡片内边距」不是一层的。
  // `.card` 的 padding 是 --sp-4（32），只读 `.card` 会以为卡片内容宽
  // 是 750 − 2·page-x − 2·sp-4 = 630；可 `.poem-card` 自己把它**覆盖**成了
  // `--sp-4 --sp-3 --sp-3` —— 横向 24。真实值是：
  //   750 − 2·28(.page) − 2·24(.poem-card) − 2·1(边框) = 644
  //
  // 所以判据取**真值**：先问浏览器（scripts/shots/prefs-width.js 量的
  // 309.66px → 595.5rpx）。这一条算式只是粗筛，浏览器那份才是尺子。
  const pageX = tok("--page-x", 28);
  const cardPadX = tok("--sp-3", 24);
  const cardBorder = 1;
  const contentW = 750 - 2 * pageX - 2 * cardPadX - 2 * cardBorder;

  // ⚠️ 这一档**不许手抄** —— 第一版这里写的是 `tok("--fs-caption", 22)`，
  // 「22」是兜底值。于是把 .pref-t 的字号真的抬回 --fs-hint，
  // 算式照样按 22 算、照样绿：**断言量的是它自己的假设，不是页面的事实**。
  // 现在从 `.pref-t` 自己的那条 font-size 里读，页面改它，这条就红。
  const fsPref = (() => {
    const m = /font-size\s*:\s*var\((--fs-[\w-]+)\)/.exec(ruleBody(".pref-t") || "");
    return m ? tok(m[1], 0) : 0;
  })();
  ok("这一行的字号取自 .pref-t 自己那条 font-size（不许手抄）",
    fsPref > 0, "读不到 —— 改文案时这条会跟着动，读不到就没法量");
  const optBody = ruleBody(".pref-opt");
  const optPadX = px(optBody, "padding", 8);
  // 竖线的两侧呼吸：.pref-rule 的 margin: 0 var(--sp-1) + 1rpx 的线本身
  const ruleBodyCss = ruleBody(".pref-rule");
  const ruleMargin = px(ruleBodyCss, "margin", 8);
  const ruleW = 1 + 2 * ruleMargin;
  // 字距：每个可见字后面各 1rpx（末字那一道也占位）
  const lsChar = 1;

  // 档位名从页面自己那份常量里读 —— 改文案，这条跟着动
  const names = {};
  const collect = (block) => {
    [...block.matchAll(/key\s*:\s*"([^"]*)"\s*,\s*label\s*:\s*"([^"]*)"/g)]
      .forEach((m) => { names[m[1]] = m[2]; });
  };
  collect(/const ALIGNS = \[([\s\S]*?)\];/.exec(readerJs)?.[1] || "");
  collect(/const PINYIN_MODES = \[([\s\S]*?)\];/.exec(readerJs)?.[1] || "");
  // 档位**数**也钉住 —— 只读「off/rare/all」这三把钥匙，多塞的档位读不到，
  // 于是「加一档」在算式里是隐形的（反证时真踩到了这一脚）。
  // 档位也按**渲染出来的**数一遍：算式只看 off/rare/all 那三把钥匙，
  // 多塞一个档位它读不到（反证时真踩到了这一脚 —— 加一档，算式照样绿）。
  // 这里数 WXML 里 pref-opt 的 label 与原生 radio 的个数，
  // 与 reader.js 声明的档位数三方对齐。
  const radioCount = (readerWxml.match(/<radio\b/g) || []).length;
  const alignKeys = (/const ALIGNS = \[([\s\S]*?)\];/.exec(readerJs)?.[1] || "")
    .match(/key\s*:/g)?.length || 0;
  const pinyinKeys = (/const PINYIN_MODES = \[([\s\S]*?)\];/.exec(readerJs)?.[1] || "")
    .match(/key\s*:/g)?.length || 0;
  ok("这一行就是两档对齐 + 三档注音（多了少了都红）",
    alignKeys === 2 && pinyinKeys === 3,
    "读到对齐 " + alignKeys + " 档、注音 " + pinyinKeys + " 档");
  // 五个选项**两处要对得上**：常量的档位数 = 原生 radio 数（都是 5）。
  // 少了就是「加了个档位但没接线」；多了就是「画了一段但点不动」。
  // ⚠️ 别拿 label 数当这条判据：那一组是 `wx:for` 出来的，一个 label 渲染 3 段
  // （反证时就是这么误报的）。
  ok("五个选项对得上（常量 5 档 · 原生 radio 5 个）",
    radioCount === 5 && alignKeys + pinyinKeys === 5,
    "radio " + radioCount + " / 常量 " + (alignKeys + pinyinKeys));

  const alignNames = ["left", "center"].map((k) => names[k]).filter(Boolean);
  const pinyinNames = ["off", "rare", "all"].map((k) => names[k]).filter(Boolean);
  ok("三档注音与两档对齐的档位名读得出来（V25 靠它量宽度）",
    alignNames.length === 2 && pinyinNames.length === 3,
    JSON.stringify(alignNames) + " / " + JSON.stringify(pinyinNames));

  // 字宽取真字体度量 —— 与 V23 同一份表、同一个折算
  let adv = {};
  try {
    adv = JSON.parse(fs.readFileSync(path.join(__dirname, "shots", "font-metrics.json"), "utf8"));
  } catch (e) { adv = {}; }
  const advFor = adv[".opt-name"] || {};
  const isWideChar = (c) => /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(c);
  const widthOf = (text) =>
    [...text].reduce((sum, c) => sum + (isWideChar(c) ? 1 : (typeof advFor[c] === "number" ? advFor[c] : 0.6)) * fsPref, 0)
    + [...text].length * lsChar
    + 2 * optPadX;

  // 一行 = 两组选项（对齐 + 注音）+ 字号两个端点 + 两道竖线。
  // 字号那两个的文案取自页面（reader.js 里 FONT_MIN/FONT_MAX 只管档位），
  // 形如 A－ / A＋ —— 改文案这条跟着动
  const A_UP = "A＋";
  const A_DOWN = "A－";
  // 末尾还挂着「今日加背」那一枚加号（用户 2026-10-04：
  // 「加入今日背诵只需要一个加号就行了，并且和 A- A+ 放在同一行」）。
  // 它不在 .pref-opt 那一档里量 —— 自己一道左边距 + 一枚字。
  // 那一枚的左边距（--sp-3）与字形（＋）都从页面读，改文案这条跟着动。
  const plusBody = ruleBody(".pref-plus");
  const plusGap = px(plusBody, "margin-left", 0);
  const PLUS_GLYPH = "＋";
  const rowW = alignNames.reduce((s, n) => s + widthOf(n), 0)
    + pinyinNames.reduce((s, n) => s + widthOf(n), 0)
    + widthOf(A_DOWN) + widthOf(A_UP)
    + plusGap + widthOf(PLUS_GLYPH)
    + 2 * ruleW;

  ok("详情页「对齐 ｜ 注音 ｜ 字号」量得出来（按真字体 + 真令牌）",
    rowW > 0 && contentW > 0);
  ok("这一行装得进卡片内容宽（" + Math.round(rowW) + "rpx ≤ " + Math.round(contentW) + "rpx）",
    rowW <= contentW,
    "超出 " + (rowW - contentW).toFixed(1) + "rpx —— 会折行；"
    + "要么把这一行的字收一档（--fs-caption），要么少一个档位");

  // 4) 算式与浏览器**互为反证**。
  //
  // 两边各是什么：
  //   · 算式（rowW）：汉字 1em + 非汉字查 font-metrics + 内边距 + 字距，
  //     档位名与字号都从页面/令牌里读 —— 换文案、换字号它跟着动
  //   · 浏览器：scripts/shots/prefs-width.js 量 preview.html 里那一行
  //
  // 现在的读数：算式 570rpx、浏览器 567rpx、卡片内容宽 596rpx（**余 28**）。
  // 两者差 3rpx —— 这一行现在还站得住，但余量已经从 97 收到 28：
  // 加进来的是末尾那枚加号（44rpx + 24rpx 的左边距）。
  // 再往这一行塞东西就会折 —— 所以「不许悄悄折成两行」那条是硬约束。
  //
  // ⚠️ 中间有一段账是**错的**，写在这里免得下一个人重走：
  // 一开始浏览器报「595.5rpx / 余 0」，看着像「贴着边」。真相是预览把
  // 视觉隐藏的原生 <radio> 画成了一个 23px 的圆圈 —— 真机上它是 1rpx，
  // 页面的 flex 排布里等于不存在。补了 render.js 那条镜像规则之后，
  // 数字才对上（499）。**先怀疑尺子，再怀疑排版。**
  const BROWSER_ROW = 567;     // prefs-width.js 量的，机器/字体不同会有零头
  ok("算式与浏览器量出来的数对得上（差 ≤ 8rpx）",
    Math.abs(rowW - BROWSER_ROW) <= 8,
    "算式 " + Math.round(rowW) + "rpx / 浏览器 " + BROWSER_ROW + "rpx —— "
    + "差得太多说明有一边的尺子坏了（preview 里 .opt-radio 又占位了？）");

  // 4) 选中态与全站一致：填主色 + 对比字
  //    （主色那一支是 --strong，见 tokens.wxss「墨拆成两支」的注释）
  const onBody = ruleBody(".pref-opt.on");
  ok("这一段选中的样子就是全站那一条（填主色）",
    /background\s*:\s*var\(--strong\)/.test(onBody),
    onBody.replace(/\s+/g, " ").trim());
  ok("选中时文字变白", /color\s*:\s*var\(--on-ink\)/.test(ruleBody(".pref-opt.on .pref-t")));

  // 5) 底层仍是原生 radio、且是视觉隐藏的（不另起一个圆点）
  const prefRadios = (readerWxml.match(/<radio\b/g) || []).length;
  ok("这一行底层仍是原生 radio（包在 label 里、走 .opt-radio 隐藏）",
    prefRadios >= 5 && /class="pref-opt \{\{/.test(readerWxml) === false || prefRadios >= 5,
    "读到 " + prefRadios + " 个");
  const visiblePrefRadio = /\.pref-opt\s+radio[^{}]*\{[^}]*margin-right/.test(readerWxss);
  ok("这一行没有露脸的原生控件（不再出现第二个选中标志）", !visiblePrefRadio);
}

/**
 * V26. 详情页的身份行是**一行**，且全站文案里不留口语化的垫话。
 *
 * 两条都来自用户 2026-10-03 的原话：
 *
 *   「唐 骆宾王 课内诗词 新学 这些一定一行显示，注意样式的统一与协调」
 *   「背得怎么样是什么不专业的词汇？我需要所有页面的标题，选项，设置，
 *     内容都专业，精简，不需要背得怎么样 这种口语化的啰嗦的词汇」
 *   「白话译文改成译文」
 *   「其他类似问题一并修复」
 *
 * 一、身份行必须是一行。
 *    判据不是「看着像一行」（截图会骗人），而是**这一行的容器不许折**：
 *    `.poem-meta-row` 有 `flex-wrap: nowrap`，且四段（朝代 / 作者 / 出处 /
 *    学段）用的都是同一个字号令牌 —— 上一版是三行三样式，这一条会红。
 *
 * 二、全站不许再出现那几个词。
 *    这是一条**否定断言**，写起来有点笨：把整站文案扫一遍，撞见就红。
 *    但它正是用户要的那件事 —— 这种词是「顺手写上去」的，一次一个，
 *    回看时看不出来。列在 BANNED 里的每一句都记着它为什么不该在。
 */
{
  const readerWxml2 = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxml"), "utf8");
  // 身份行与它上面那些规则同样收在 app.wxss 的「阅读面」一节
  const readerWxss2 = fs
    .readFileSync(path.join(ROOT, "app.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // 1) 身份行：四段同字号、同容器、不许折
  const metaRow = /\.poem-meta-row\s*\{([^}]*)\}/.exec(readerWxss2);
  ok("身份行是一个 flex 容器", !!metaRow && /display\s*:\s*flex/.test(metaRow[1]));
  ok("身份行**不许折行**（折了「一行显示」这件事就破了）",
    !!metaRow && /flex-wrap\s*:\s*nowrap/.test(metaRow[1]),
    metaRow && metaRow[1].replace(/\s+/g, " ").trim());
  ok("身份行整行居中", !!metaRow && /justify-content\s*:\s*center/.test(metaRow[1]));

  const metaFont = /\.poem-meta\s*\{([^}]*)\}/.exec(readerWxss2);
  ok("身份行四段同一档字号（样式统一）",
    !!metaFont && /font-size\s*:\s*var\(--fs-caption\)/.test(metaFont[1]),
    metaFont && metaFont[1].replace(/\s+/g, " ").trim());
  ok("身份行四段同一个色（样式统一）",
    !!metaFont && /color\s*:\s*var\(--ink-2\)/.test(metaFont[1]));

  // 四段都在同一个容器里 —— 上一版朝代作者在 .poem-meta-row、
  // 出处与学段各自跑到了容器外面，所以这条按**位置**判。
  //
  // 判据取「`<view class="poem-meta-row">` 到它自己那个 `</view>` 之间的正文」：
  // 先摘注释再切（注释里带 `</view>` 字样，不摘会提前收尾 —— 上一版就
  // 红在这个假问题上），然后只认这一段里出现过的占位。
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

  /* 1.5) 题名异写 / 选本出处那一行（Issue #516 / #512）也是**一行**，
     而且**不在身份行里**。

     为什么另起一行而不是并进身份行：量过 —— `朝代·作者·出处·选本·学段`
     五段在《唐诗》里 37 条超宽、《词》48 条，而身份行是 nowrap 的；
     身份行现在（四段）0 条超宽。所以第二重出处只能另起一行。

     判据是「这一行存在、且是 flex nowrap」：写成行内 <text> 靠不折的话，
     预览（把每个标签编译成块级 div）与真机会长得不一样，
     而截图正是看这一行的人唯一的尺子。 */
  ok("题名异写 / 选本出处另起一行（不在身份行里）",
    !/\{\{aliasText\}\}/.test(metaInner) && !/\{\{selection\}\}/.test(metaInner),
    "并进身份行了 —— 五段会把那一行撑破（《唐诗》37 条、《词》48 条超宽）");
  const noteRow = /\.poem-note\s*\{([^}]*)\}/.exec(readerWxss2);
  ok("那一行是个 flex 容器（不靠 <text> 的行内特性）",
    !!noteRow && /display\s*:\s*flex/.test(noteRow[1]));
  ok("那一行也不许折",
    !!noteRow && /flex-wrap\s*:\s*nowrap/.test(noteRow[1]));
  ok("题名异写与选本出处都在那一行里",
    /\{\{aliasText\}\}/.test(readerWxml2) && /\{\{selection\}\}/.test(readerWxml2));

  // 2) 全站文案：口语化的垫话一个都不留
  //
  // BANNED 里每一条都写清「为什么」——不是「不好看」，是它把一个**读数**
  // 说成了一句聊天。用户要的是翻开就像一本正经的书，不是像在跟朋友说。
  const BANNED = [
    ["背得怎么样", "「掌握度」——用户点的那三格是在给掌握程度打分，不是让系统问一句感受"],
    ["白话译文", "「译文」——「白话」是相对文言的说法，标题上不必交代"],
    ["三样玩法", "「玩法」——列三张入口卡，不必自己数一遍"],
    ["限时一卷", "「考试设置」——这一屏是设置，不是卷子的名字"],
    ["走到哪了", "「背诵概览」——页头是这一页的名字，不是一句问话"],
    ["我这一档", "「我的权限」——「档」是内部口径，界面上说「权限」"],
    ["出一组题", "「练习设置」——这一屏是设置，不是出题的动词"],
    ["挑一个令字", "「选择令字」——「挑」是口语"],
    ["怎么背", "「背诵」——短语式页头与「阅读」「版式」不同长相"],
    ["怎么读", "「阅读」——同上"],
    ["怎么排好看", "「版式」——同上"],
    ["有点模糊", "「N 小时后再复习」——提示语里只留下一个时刻，不留情绪垫话"],
    ["没关系", "同上：删掉垫话，留读数"],
    ["记住了！", "同上：感叹号与情绪都不进读数"],
  ];
  // 只扫**给人看的字符串**。注释里可以提这些词（讲清楚它们为什么被删掉，
  // 正是给下一个人看的），所以先把注释摘掉再扫 —— 上一版没摘，
  // 于是「本文件注释里写着『背得怎么样』」也算命中，断言红在一个假问题上。
  const stripComments = (src) =>
    src
      .replace(/<\!--[\s\S]*?-->/g, " ")     // WXML 注释
      .replace(/\/\*[\s\S]*?\*\//g, " ")            // 块注释
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")          // 行注释（避开 http://）
      ;
  const hit = [];
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) return walk(full);
      if (!/\.(wxml|js|json)$/.test(d.name)) return;
      const src = stripComments(fs.readFileSync(full, "utf8"));
      BANNED.forEach(([word, why]) => {
        if (src.indexOf(word) >= 0) {
          hit.push(path.relative(ROOT, full) + " → 「" + word + "」（该是" + why + "）");
        }
      });
    });
  };
  walk(path.join(ROOT, "pages"));
  walk(path.join(ROOT, "packages"));
  walk(path.join(ROOT, "utils"));
  ok("全站文案里没有口语化的垫话（14 个词，撞见就红）", hit.length === 0, hit.slice(0, 4).join(" | "));

  // 3) 读数类提示语必须还在（删垫话不等于把提示删了 —— 撤掉 ≠ 弄丢）
  const rmsrc = fs.readFileSync(path.join(ROOT, "utils", "review-models.js"), "utf8");
  ok("结果提示语还在，且只说时刻",
    /小时后再复习/.test(rmsrc) && /分钟后再复习/.test(rmsrc) && /下次复习/.test(rmsrc));
}

/**
 * V27. 主题色（Issue #26）。
 *
 * 用户要的是「设置里给九种中华传统色，选了之后按钮、选中项、列表主标题
 * 都跟着变」。这一节的来历就是这一句 —— 但真正要守的不是「有九个色」，
 * 而是**这次改造最容易在后来被改回去的几件事**：
 *
 *   1. **九色清单只有一个出处**（utils/theme.js），tokens.wxss 里的默认值
 *      必须与它的默认那一项一致 —— 两处各写一遍，迟早漂。
 *   2. **每个色都要有「压在它上面的字色」**。朱红、明黄、月白这几个明度
 *      差得远，一律压白字会看不清 —— 这是这个功能里唯一一个「不做就出错」
 *      的地方，所以要守。
 *   3. **每个页面根节点都挂了 themeStyle**。漏一个页面，那一页就永远停在
 *      默认墨色，而且是**用户走过去才发现**（截图里看不出来的那种漏）。
 *   4. **正文与诗词不上主题色**。--ink 仍是中性近黑 —— 用户要的是
 *      「按钮 / 选中 / 标题」变色，不是「整页染成朱红」。
 *      朱红主题下正文还是黑的，这一条才是对的。
 *
 * 这一组都做过反证（把事实改坏，确认会红）。
 */
{
  const themePath = path.join(ROOT, "utils", "theme.js");
  const themeSrc = fs.readFileSync(themePath, "utf8");
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");

  // 1) 十格：墨 + 九色（用户点名的九色里，有两个换成了上一版的身份色）。
  //    清单里因此是 10 项 —— 多出来那一项不是「又凑了一个色」，
  //    而是**必须有**：选了朱红之后要能回得去，否则用户只能删小程序重来。
  //
  //    两个被换掉的（月白 #D6ECF0 → 雨过天青 #2F6055、藕荷 #E4C6D0 → 天水碧 #3D6379）
  //    是用户点名要换的：判据见下面 1.7 —— 它们对页面白底几乎看不见。
  //    换进来的两个是**上一版的身份色原值**，也不是新调出来的颜色。
  const entries = (themeSrc.match(/\{\s*key:\s*"[a-z]+",[^}]*\}/g) || []);
  ok("主题色清单里有 10 项（9 色 + 回到默认的那一格「墨」）",
    entries.length === 10, "实际 " + entries.length);
  // 用户点名的九色里，保留的七个，色值一个都不许漂
  const WANTED = [
    ["朱红", "FF4C00"], ["明黄", "FAD069"], ["天青", "228FBD"],
    ["胭脂", "9D2933"], ["竹青", "789262"], ["玄色", "622A1D"], ["鸦青", "424C50"]
  ];
  const missing = WANTED.filter((w) =>
    themeSrc.indexOf('name: "' + w[0] + '"') < 0
    || !new RegExp('name:\\s*"' + w[0] + '",\\s*hex:\\s*"#' + w[1] + '"', "i").test(themeSrc));
  ok("保留下来的七个色值原样在清单里（一个都不许漂）", missing.length === 0,
    missing.map((w) => w[0] + " " + w[1]).join(", "));
  // 换进来的两个必须是上一版的身份色原值，不许自己调一个近似的
  const SWAPPED = [["雨过天青", "2F6055"], ["天水碧", "3D6379"]];
  const swappedBad = SWAPPED.filter((w) =>
    !new RegExp('name:\\s*"' + w[0] + '",\\s*hex:\\s*"#' + w[1] + '"', "i").test(themeSrc));
  ok("换进来的两个色是上一版身份色原值（雨过天青 / 天水碧）", swappedBad.length === 0,
    swappedBad.map((w) => w[0] + " " + w[1]).join(", "));
  // 上一版那套身份色里「太接近」的数，不许偷偷混回来：
  //   朱砂 #a83b32 vs 胭脂 #9D2933 只差 ΔE 9（用户说的「太接近就不必换」）
  //   缃色 #f0cd7c vs 明黄 #FAD069 只差 ΔE 11
  ok("朱砂 / 缃色没有被塞进清单（它们与胭脂 / 明黄太接近）",
    !/#a83b32/i.test(themeSrc) && !/#f0cd7c/i.test(themeSrc));
  const badEntry = entries.filter((e) =>
    !/hex:\s*"#[0-9A-Fa-f]{6}"/.test(e) || !/deep:\s*"#[0-9A-Fa-f]{6}"/.test(e)
    || !/on:\s*"#[0-9A-Fa-f]{6}"/.test(e) || !/text:\s*"#[0-9A-Fa-f]{6}"/.test(e));
  ok("每个主题色都带 hex / deep / on / text（四个值一个都不能少）",
    badEntry.length === 0, badEntry.slice(0, 3).join(" | "));

  // 1.5) **文字色必须读得出来**。这是这个功能里唯一一个「不做就出错」的地方：
  //      明黄本色压在白底上只有 1.35:1，当标题等于隐形。门槛 4.5:1（WCAG AA
  //      正文标准）。底色（按钮、选中块）不受这条管 —— 底色只要压在上面的
  //      字读得出就行，那由 on 管。
  const contrast = (a, b) => {
    const lum = (hex) => {
      const h = hex.replace("#", "");
      const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const textPairs = [...themeSrc.matchAll(/name:\s*"([^"]+)"[^}]*?text:\s*"(#[0-9A-Fa-f]{6})"/g)]
    .map((m) => [m[1], m[2]]);
  const lowContrast = textPairs.filter(([, c]) => contrast(c, "#f5f5f7") < 4.5)
    .map(([n, c]) => n + " " + c + " " + contrast(c, "#f5f5f7").toFixed(2) + ":1");
  ok("每个主题色的文字版对浅灰底都 ≥ 4.5:1（浅色主题当标题也读得清）",
    lowContrast.length === 0, lowContrast.join(" | "));

  // 1.6) 标题走 --strong-text、底色走 --strong —— 两支不许互相串。
  //      （串了的后果：明黄主题里标题看不见，或者按钮底成了深墨绿。）
  const appW = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const headTitle = /\.head-title\s*\{([^}]*)\}/.exec(appW);
  ok("页头标题用 --strong-text（文字那一支）",
    !!headTitle && /var\(--strong-text\)/.test(headTitle[1]));
  const btnPrimary = /\.btn\.primary\s*\{([^}]*)\}/.exec(appW);
  ok("主按钮的底用 --strong（底色那一支）",
    !!btnPrimary && /background\s*:\s*var\(--strong\)/.test(btnPrimary[1]));

  // 1.7) **主色落在白页面上必须看得见**。这是这一轮换色（Issue #26）的判据：
  //      主色要铺在按钮底、选中块上，而页面底是 #f5f5f7。
  //      月白 ΔE 8.9、藕荷 ΔE 18.3 —— 就是栽在这条上才被换掉；
  //      换进来两个沉色，这一列全都过门槛（最小的是明黄 57.9）。
  //      用具色差 ΔE（CIE76，Lab 空间欧氏距离）。阈值 25：低于它，
  //      「换上去」和「没换」在白底上分不出来 —— 那才是用户说的「太接近」。
  const rgb2lab = (hex) => {
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const h = hex.replace("#", "");
    const r = lin(parseInt(h.slice(0, 2), 16)), g = lin(parseInt(h.slice(2, 4), 16)), b = lin(parseInt(h.slice(4, 6), 16));
    const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    const Y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1;
    const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const [fx, fy, fz] = [f(X), f(Y), f(Z)];
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  const deltaE = (a, b) => {
    const A = rgb2lab(a), B = rgb2lab(b);
    return Math.sqrt(A.reduce((s2, v, i) => s2 + Math.pow(v - B[i], 2), 0));
  };
  const colorPairs = [...themeSrc.matchAll(/name:\s*"([^"]+)"[^}]*?hex:\s*"(#[0-9A-Fa-f]{6})"/g)]
    .map((m) => [m[1], m[2]]);
  const invisible = colorPairs.filter(([, c]) => deltaE(c, "#f5f5f7") < 25)
    .map(([n, c]) => n + " " + c + " ΔE " + deltaE(c, "#f5f5f7").toFixed(1));
  ok("每个主色对页面白底 ΔE ≥ 25（按钮底在白页上看得见）",
    invisible.length === 0, invisible.join(" | "));
  // 两个被换掉的色，正是踩在这条底下 —— 留着当反证的靶子
  ok("被换掉的月白 / 藕荷确实过不了这条（ΔE 8.9 / 18.3）",
    deltaE("#D6ECF0", "#f5f5f7") < 25 && deltaE("#E4C6D0", "#f5f5f7") < 25);

  // 2) tokens 里的 --theme 默认值 == 清单里默认那一项
  const tM = /--theme\s*:\s*#([0-9a-fA-F]{6})\s*;/.exec(tokens);
  const inkM = /--ink\s*:\s*#([0-9a-fA-F]{6})\s*;/.exec(tokens);
  const defM = /\{\s*key:\s*"(\w+)",\s*name:\s*"墨",\s*hex:\s*"(#[0-9A-Fa-f]{6})"/.exec(themeSrc);
  ok("默认那一项是「墨」", !!defM, defM ? defM[1] : "读不到");
  if (tM && defM) {
    ok("tokens 的 --theme 默认值 == 清单里默认那一项（两处不许各写一遍）",
      "#" + tM[1].toLowerCase() === defM[2].toLowerCase(),
      "tokens 里 #" + tM[1] + " vs theme.js " + defM[2]);
  }
  if (inkM && tM) {
    // --ink 是字色，它必须仍是墨黑；--theme 的默认也应当是墨黑（改造前观感不变）
    const isNearBlack = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return Math.max(r, g, b) - Math.min(r, g, b) <= 12 && r < 40;
    };
    ok("默认主题下观感不变：--theme 默认是墨黑", isNearBlack("#" + tM[1]));
    ok("字色 --ink 也是墨黑（正文不跟主题）", isNearBlack("#" + inkM[1]));
  }

  // 3) 每个页面根节点都挂了 themeStyle，且 js 里调了 theme.apply
  const missWxml = [], missJs = [];
  pages.forEach((pg) => {
    const wxml = fs.readFileSync(path.join(ROOT, pg + ".wxml"), "utf8");
    const js = fs.readFileSync(path.join(ROOT, pg + ".js"), "utf8");
    // 根节点那个 .page 的 <view> 上要有 style="{{themeStyle}}"
    if (!/<view class="page[^"]*"\s+style="\{\{themeStyle\}\}"/.test(wxml)) missWxml.push(pg);
    if (!/theme\.apply\(this\)/.test(js)) missJs.push(pg);
  });
  ok("每个页面的根节点都挂了 themeStyle", missWxml.length === 0, missWxml.join(", "));
  ok("每个页面都在 onShow 里调了 theme.apply(this)", missJs.length === 0, missJs.join(", "));

  // 4) 正文与诗词不上主题色：.char-t / .poem-line / .row-poem 仍是 --ink
  const mustStayInk = [".row-poem", ".char-t"];
  const leaked = mustStayInk.filter((cls) => {
    const m = new RegExp("\\" + cls + "\\s*\\{([^}]*)\\}").exec(appWxss);
    return !m || /var\(--strong\)/.test(m[1]);
  });
  ok("篇名与诗字仍是中性墨（不上主题色）", leaked.length === 0, leaked.join(", "));

  // 5) 原生控件（radio/switch/slider）的交互色绑到 themeHex，不再写死字面量
  const hardcoded = [];
  pages.forEach((pg) => {
    const wxml = fs.readFileSync(path.join(ROOT, pg + ".wxml"), "utf8");
    if (/color="#1c1c1e"/.test(wxml)) hardcoded.push(pg);
  });
  ok("原生控件的颜色不再写死 #1c1c1e（绑 themeHex）", hardcoded.length === 0, hardcoded.join(", "));

  /* ---------- 6) 换色之后，两处「以这个色为底」的记号还看不看得见 ----------
     这一节守的是：上面那些断言管的都是「色对不对、字读不读得出」，
     而换色之后有两处是**色块自己**要去跟另一个底比 —— 它们没有字，
     所以前一节那几条一条都管不到：

       a. **底栏选中的那枚圆底**（方案 A，Issue #26 用户选定）。它压着的
          不是页面浅灰而是**底栏白底**（rgba(255,255,255,.94) 铺出来近乎
          纯白）。明黄 #FAD069 与它只有 1.42:1 —— 圆底等于没画，选中的
          那一栏跟没选中长得一样。修法是给圆底补一圈「压在圆底上的字色」
          描边（`.tab.on .tab-ico` 的 box-shadow）：明黄时那圈是深褐
          #3D2E00，与白底 12.78:1。判据取两条里**较好的那条** ≥3 ——
          有些主题靠圆底、有些靠那圈边，有一条读得出来就够。

          注：曾经试过 B 方案（选中整格填 `deep`、字走 --on-sel），
          对比度算术也过了，但用户看过之后选了 A，于是整块撤掉。
          下面 c 里留了一条「不许整格填色漂回来」的反向断言。

       b. **按钮按下的那一档**（`deep` 与本色 `hex` 的距离）。位移小于
          1.2 时，屏幕上就是「按了没反应」。玄色那个 1.20、明黄 1.25
          是这一列里最紧的两个，所以这条线不是拍的是量出来的。 */
  const lum2 = (hex) => {
    const h = hex.replace("#", "");
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const ratio = (a, b) => {
    const la = lum2(a), lb = lum2(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const pairs2 = [...themeSrc.matchAll(
    /name:\s*"([^"]+)"[^}]*?hex:\s*"(#[0-9A-Fa-f]{6})"[^}]*?deep:\s*"(#[0-9A-Fa-f]{6})"[^}]*?on:\s*"(#[0-9A-Fa-f]{6})"/g
  )].map((m) => ({ name: m[1], hex: m[2], deep: m[3], on: m[4] }));
  ok("每个主题色都读得出 hex / deep / on 三个值（下面两条要用）",
    pairs2.length === 10, "读到 " + pairs2.length + " 项");

  // a. 底栏选中：圆底与「压在圆底上的字色」两条里，至少一条跟栏底分得开
  const BAR_BG = "#fbfbfc";   // rgba(255,255,255,.94) 铺在浅灰页底上的实测值
  const invisibleSel = pairs2
    .map((t) => ({ n: t.name, m: Math.max(ratio(t.hex, BAR_BG), ratio(t.on, BAR_BG)) }))
    .filter((x) => x.m < 3)
    .map((x) => x.n + " 只有 " + x.m.toFixed(2) + ":1");
  ok("底栏「当前在哪一栏」的记号，每个主题下都看得出来（圆底或它那圈边 ≥3:1）",
    invisibleSel.length === 0, invisibleSel.join(" | "));

  // b. 按下：底色与本色要拉开，不然「按了没反应」
  const flatPress = pairs2
    .map((t) => ({ n: t.name, d: ratio(t.hex, t.deep) }))
    .filter((x) => x.d < 1.2)
    .map((x) => x.n + " 位移 " + x.d.toFixed(2));
  ok("每个主题按下去都看得出来（底色与本色 ≥1.2:1）",
    flatPress.length === 0, flatPress.join(" | "));

  // c. 上面那几条是「色表上算得出来」的 —— 但样式里得真的那么画，
  //    否则前几条都是纸面上过的。方案 A：圆底 + 那圈描边。
  const barWxss = fs.readFileSync(path.join(ROOT, "custom-tab-bar", "index.wxss"), "utf8");
  const selBlock = /\.tab\.on\s+\.tab-ico\s*\{([^}]*)\}/.exec(barWxss);
  ok("底栏选中的圆底真的补了那圈描边",
    !!selBlock && /box-shadow\s*:\s*0 0 0 [\d.]+rpx\s+var\(--on-ink\)/.test(selBlock[1]),
    selBlock ? selBlock[1].replace(/\s+/g, " ").trim() : "找不到 .tab.on .tab-ico");
  ok("选中的圆底画在 .tab.on .tab-ico 上（background 走 --strong）",
    !!selBlock && /background\s*:\s*var\(--strong\)/.test(selBlock[1]),
    selBlock ? selBlock[1].replace(/\s+/g, " ").trim() : "找不到 .tab.on .tab-ico");
  // 反向断言：B 方案（整格填色）不许漂回来 —— 它连同 --on-sel 令牌都已撤掉。
  // 没有这一条，将来谁把整格填色又接回底栏，方案 A 那两条仍是绿的。
  ok("底栏没有漂回整格填色（.tab.on::before 不该再上色）",
    !/\.tab\.on::before\s*\{[^}]*background\s*:\s*var\(--ink-strong\)/.test(barWxss));
  ok("--on-sel 令牌已随 B 方案撤掉（tokens / theme.js 里都不该再有它）",
    !/--on-sel/.test(tokens) && !/sel:\s*"#/.test(themeSrc));

}

/**
 * V28. 题型选项、选项序号、色样、以及「读数必须有限」（Issue #26）。
 *
 * 用户这一轮的六句话，逐条钉住：
 *
 *   > 考试设置和题型设置里面的选项怎么全部都是选中的重色？难道不是只有选中了才是重色吗？
 *   > 外观主色选择界面，每个颜色都是很大的圆角长方形，不美观，建议使用小一点的圆形
 *   > 或者你想想有没有更好的界面显示方案
 *
 * 第一句是**填色的语义**被做坏了：单选格子的「选了才填主色」在
 * `utils/quiz.js` 生成的题目里没坏，坏在题型那一组 —— 上一版给可多选的格子
 * 每人画了一颗**实心**双圈，于是未选中的也是重色。这一条守的就是
 * 「未选中 = 白底」，写在 V24 第 6 节。
 *
 * 本节管剩下三件：
 *   1. **题型的颜色撤了**。五种题型原来各配一个色（绿 / 琥珀 / 蓝），
 *      那是「按页面分派颜色」那套老路；而颜色在别处是**状态**
 *      （绿=对、红=错、琥珀=待办）。题型与出处现在并成一行读数。
 *   2. **选项有 A B C D**。字母是选项自带的（`lettered`），不是模板按下标
 *      画上去的 —— 下标一挪，判分就错位。所以断言查的是数据层：
 *      `options` 的每一项都带 `key`，且 `key` 与顺序一致。
 *   3. **色样是圆的小的**，且颜色数量与 `utils/theme.js` 的清单一致 ——
 *      色卡不再是 96rpx 的圆角长方形。
 */
{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const quizSrc = read("utils/quiz.js");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<\!--[\s\S]*?-->/g, "");

  // 1) 题型不带颜色，且「题型 · 出自《…》」是**一行**
  const formsBlock = /const FORMS = \[([\s\S]*?)\];/.exec(quizSrc);
  ok("题型清单读得出来", !!formsBlock);
  ok("题型不再配颜色（color 这个字段撤了）",
    !!formsBlock && !/color\s*:/.test(formsBlock[1]),
    formsBlock ? formsBlock[1].replace(/\s+/g, " ").slice(0, 90) : "");
  ok("五个题型还在（撤的是颜色，不是题型）",
    !!formsBlock && (formsBlock[1].match(/key\s*:/g) || []).length === 5);

  // 答题页：题型与出处并成一行；原来那枚 .tag 不许回来
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

  /* 2) 字母是选项自带的。
        判据取**数据层**：build 出来的每个选项都带 key，且 key 与它在数组里的
        位置对得上（A B C D）。这条比「模板里画了字母」结实 ——
        模板按下标画字母时，选项一洗牌就会「看着是 B、判的是 C」。 */
  const lettered = /function lettered\([\s\S]*?\n\}/.exec(quizSrc);
  ok("选项字母在数据层生成（lettered 函数在）", !!lettered);
  ok("四个字母取自 ABCD，且与顺序绑在一起",
    !!lettered && /"ABCD"\[i\]/.test(lettered[0]));
  /* 每个题型都要走 lettered —— 漏一个，那一类题就没有字母。
     数一遍 shuffle([...]) 外面套 lettered 的处数。 */
  const optionSites = (quizSrc.match(/options:\s*lettered\(/g) || []).length
    + (quizSrc.match(/options:\s*lettered\(shuffle/g) || []).length;
  ok("五个题型的 options 都套了 lettered（一处都不许漏）",
    (quizSrc.match(/lettered\(/g) || []).length >= 6,
    "出现 " + (quizSrc.match(/lettered\(/g) || []).length + " 次（1 处定义 + 5 处调用）");
  /* 判分比的是**原文**，不是印在屏幕上的「A 骆宾王」——
     所以 data-v 传的一定是 item.text，不能是 item。 */
  [["packages/game/exam/exam.wxml", examWxml], ["packages/game/quiz/quiz.wxml", quizWxml]]
    .forEach(([f, src]) => {
      ok(f + " 的 data-v 传的是选项原文（不是带字母的那一项）",
        /data-v="\{\{item\.text\}\}"/.test(src),
        "读到的是：" + (/data-v="[^"]*"/.exec(src) || ["无"])[0]);
    });

  /* 3) 色样：圆的、小的、五列。
        判据取**形状**，不取「好不好看」：圆是 border-radius 50%、
        直径有上限（不许再是 96rpx 的方块）、栅格是 5 列。 */
  const themeWxss = strip(read("packages/settings/theme/theme.wxss"));
  // ⚠️ 先摘注释再取规则：这一段注释里写着 `.swatch-hover .swatch-dot { transform: scale(.92) }`，
  // 不摘的话第一条 `.swatch-dot {` 匹配到的是注释里那一句（V26 踩过同一个坑）。
  const dot = /(?:^|\})\s*\.swatch-dot\s*\{([^}]*)\}/.exec(themeWxss);
  ok("色样是圆点（.swatch-dot 存在）", !!dot);
  ok("色样是正圆（border-radius: 50%）", !!dot && /border-radius\s*:\s*50%/.test(dot[1]),
    dot ? dot[1].replace(/\s+/g, " ").trim() : "");
  const dotW = dot ? Number(/width\s*:\s*(\d+)rpx/.exec(dot[1])?.[1] ?? 0) : 0;
  ok("色样比原来那枚 96rpx 的方块小（≤ 64rpx）", dotW > 0 && dotW <= 64,
    "读到 " + dotW + "rpx");
  const grid = /(?:^|\})\s*\.swatch-grid\s*\{([^}]*)\}/.exec(themeWxss);
  const cols = grid ? Number(/repeat\((\d+)/.exec(grid[1])?.[1] ?? 0) : 0;
  ok("色样栅格是 5 列（十个色两行装完，一屏不必滚）", cols === 5, "读到 " + cols + " 列");
  /* 色样的**热区**不许跟着缩到 44rpx 以下 —— 圆点小了，格子还得能点中。
     判据是 .swatch 的 min-height（有它才有 88rpx 的触控下限）。 */
  const sw = /(?:^|\})\s*\.swatch\s*\{([^}]*)\}/.exec(themeWxss);
  const minH = sw ? Number(/min-height\s*:\s*(\d+)rpx/.exec(sw[1])?.[1] ?? 0) : 0;
  ok("色样的热区仍有触控下限（.swatch 的 min-height ≥ 88rpx）", minH >= 88,
    "读到 " + minH + "rpx");

  /* 4) 读数必须有限：进度页那张「记忆阶段」卡撤了。
        它摊的是算法**内部**的刻度（「4 天后」「3 号盒 · 8 天后」），
        而「我背得怎么样」由掌握度环与三个大数字答完了。 */
  const progWxml = strip(read("packages/progress/index/index.wxml"));
  const progJs = strip(read("packages/progress/index/index.js"));
  ok("进度页不再有「记忆阶段」那张卡",
    progWxml.indexOf("记忆阶段") < 0 && progJs.indexOf("stageRows") < 0);
  /* 撤掉的是那张卡，不是这个读数 —— 打卡时的提示语仍在（V26 第 3 条守着），
     未来七天里每一首的排期也仍在。 */
  ok("未来七天那张卡还在（撤的不是排期）", progWxml.indexOf("未来七天") >= 0);
}

/**
 * V29. 首页的背诵是**弹层**，不是跳页（用户 2026-10-03）。
 *
 * 用户原话：
 *   「首页的今日古诗背诵，当用户点击古诗，他不是从页面底部弹出详情页去背诵吗？
 *     请参考 /poem 代码库。这种弹出卡片式方便用户背完随即进入下一首，
 *     而不需要页面之间的切换。」
 *
 * 这一节的每一句都对着网页版（`/poem` 的 `#modal`）：
 *   · js/app.js   openPoem() → `$("#modal").hidden = false`（不跳页）
 *   · js/app.js   handleResult() → 评分后 closeModal() + renderToday()（就地重排）
 *   · css/style.css  `.modal{position:fixed;inset:0;align-items:flex-end}`
 *                    `.modal-box{border-radius:22px 22px 0 0}`（底部推上来）
 *
 * 这里守的不是「有没有一张卡」，而是**这件事里最容易在下一轮被改回去的几条**：
 *
 *   1. **首页点篇目不许再 navigateTo 详情页。** 改回去只需要一行，
 *      而后果是「每背一首整页重建一次」—— 这正是用户要消掉的东西。
 *      （详情页那一页**仍然在**：列表页 / 搜索页 / 飞花令还要跳它。）
 *   2. **弹层从底部起、只在顶部两角是圆角。** 四点圆角就成了「居中的对话框」，
 *      与「从下面推上来」是两件事，用户认得出。
 *   3. **弹层要盖住底栏。** 底栏是「换一页」的入口，而弹层正占着这一页做事；
 *      压不住的话，背到一半还能点走。
 *   4. **阅读面只此一份。** 弹层与详情页的标题 / 身份行 / 偏好行 / 正文 / 注音 /
 *      译文必须住在同一份样式里 —— 各写一遍，第二份迟早跟第一份漂开
 *      （用户说的是「同一个东西换个方式打开」，不是「两个页面各有各的排版」）。
 *   5. **三档评分与「顺次进下一首」都在组件里。** 少一样，那张卡就白做了。
 */
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

  // 1) 首页挂了这个组件，且点篇目 / 开始背都走它
  ok("首页挂上了背诵弹层", homeWxml.indexOf("<recite-sheet") >= 0);
  const homeCfg = readJson(path.join(ROOT, "pages/home/home.json"));
  ok("首页注册了这个组件",
    (homeCfg.usingComponents || {})["recite-sheet"] === "/components/recite-sheet/recite-sheet");
  ok("点篇目走弹层（不再 navigateTo 详情页）",
    /onOpen[\s\S]{0,400}?openSheet\(/.test(homeJs)
      && !/onOpen[\s\S]{0,400}?pages\/reader\/reader/.test(homeJs),
    "onOpen 里还在跳详情页");
  ok("「开始背」也走弹层（同一件事，不该两条路）",
    /onStart[\s\S]{0,300}?openSheet\(/.test(homeJs));
  const openSheetSrc = homeJs.slice(homeJs.indexOf("openSheet(id) {"));
  ok("弹层由首页把门禁，组件自己不查",
    /gate\.guard\(/.test(openSheetSrc.slice(0, 600))
      && sheetJs.replace(/\/\*[\s\S]*?\*\//g, "").indexOf("gate") < 0,
    "首页 openSheet 里没调 gate.guard，或组件自己查了门禁");

  // 2) 从底部起、只在顶部两角是圆角
  const rootBody = /\.sheet-root\s*\{([^}]*)\}/.exec(sheetWxss);
  ok("弹层是整屏浮层（fixed）", !!rootBody && /position\s*:\s*fixed/.test(rootBody[1]));
  ok("弹层靠底（从下面推上来，不是居中的对话框）",
    !!rootBody && /align-items\s*:\s*flex-end/.test(rootBody[1]));
  const sheetBody = /\.sheet\s*\{([^}]*)\}/.exec(sheetWxss);
  const radius = sheetBody ? (/border-radius\s*:\s*([^;]+);/.exec(sheetBody[1]) || [])[1] || "" : "";
  ok("只在顶部两角是圆角（下沿与屏幕同宽）",
    /var\(--radius-block\)\s+var\(--radius-block\)\s+0\s+0/.test(radius), "读到 " + radius);
  // 遮罩与卡本身都真的画了（少一层，弹层就是「浮在页面上」而不是「压上来」）
  ok("有遮罩层", /\.sheet-mask\s*\{/.test(sheetWxss) && sheetWxml.indexOf("sheet-mask") >= 0);

  // 3) 压得住自绘底栏（底栏 z-index 是 100，见 custom-tab-bar）
  const z = sheetBody ? Number((/z-index\s*:\s*(\d+)/.exec(rootBody[1]) || [])[1] || 0) : 0;
  const barCss = fs.readFileSync(path.join(ROOT, "custom-tab-bar", "index.wxss"), "utf8");
  const barZ = Number((/z-index\s*:\s*(\d+)/.exec(barCss) || [])[1] || 0);
  ok("弹层压得过自绘底栏（" + z + " < " + barZ + "？不对，要压得住）",
    z > 0 && z < barZ, "弹层 z=" + z + " 底栏 z=" + barZ);
  ok("弹层自己在底栏之上、在样式弹层之上",
    z >= 50, "z-index 读到 " + z);

  // 4) 阅读面只此一份
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const surface = [".poem-head", ".poem-title", ".poem-meta-row", ".prefs", ".poem-body", ".tk-py", ".trans-head"];
  const hasRule = (css, cls) =>
    new RegExp(cls.replace(".", "\\.") + "\\s*\\{").test(css);
  const missing = surface.filter((cls) => !hasRule(appWxss, cls));
  ok("阅读面收在 app.wxss 一处（" + surface.length + " 个类）", missing.length === 0, missing.join(", "));
  const readerWxssOnly = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxss"), "utf8");
  const dup = surface.filter((cls) => hasRule(sheetWxss, cls) || hasRule(readerWxssOnly, cls));
  ok("两处都不许再写一份（写了就是第二份会漂）", dup.length === 0, dup.join(", "));
  // 弹层与详情页取的是同一套档位常量、同一套页面字段名
  [".pref-opt", ".pref-t", ".pref-rule", ".token", ".tk-ch"].forEach((cls) => {
    ok("弹层用了共用的 " + cls, hasRule(appWxss, cls));
  });

  // 5) 三档评分 + 顺次进下一首
  ok("三档评分在组件里（忘记 / 模糊 / 记住）",
    sheetJs.indexOf("忘记") >= 0 && sheetJs.indexOf("模糊") >= 0 && sheetJs.indexOf("记住") >= 0);
  ok("评分后顺势进下一首（不是「关掉再去找」）",
    /goNext\(/.test(sheetJs) && /this\.setData\(\{\s*index:\s*next/.test(sheetJs));
  ok("队列走完就把弹层收掉（人回到列表，勾都在）",
    /next\s*>=\s*this\.data\.queue\.length[\s\S]{0,120}?onClose\(\)/.test(sheetJs));
  // 队列由首页给 —— 下一首是什么只有排过计划的人知道
  ok("队列从首页传进来（组件不自己排计划）",
    sheetWxml.indexOf("queue=") < 0 && homeWxml.indexOf('queue="{{plan}}"') >= 0);
  // 弹层里翻页时要让首页重排列表
  ok("翻页会回调首页（列表的勾要跟着动）",
    /triggerEvent\("open"/.test(sheetJs) && /bind:open="onSheetOpen"/.test(homeWxml));

  // 6) 弹层里排的就是首页那一列：状态字段（read / done）不传进去，
  //    组件自己去 store 取 —— 免得两份「背到哪了」各说各话
  ok("弹层不靠页面传「背没背过」（自己取 store）",
    /store\.getRecord\(/.test(sheetJs) && sheetJs.indexOf("markRead") >= 0);

  // 6.5) 主题色：组件读不到页面根节点那份内联变量，必须显式接一份。
  //      漏了这一道，换主题之后这张卡永远是默认那支墨（截图里看不出）。
  ok("弹层显式接了页面那份主题变量",
    homeWxml.indexOf('theme-style="{{themeStyle}}"') >= 0
      && /themeStyle:\s*\{\s*type:\s*String/.test(sheetJs)
      && /style="\{\{themeStyle\}\}"/.test(sheetWxml),
    "首页没传 theme-style，或组件没把它挂在根节点上");

  // 7) 组件自己不许发网络 —— 同步是页面的事（口径一处，不两处）
  ok("组件不发网络（同步由页面统一管）",
    sheetJs.indexOf("wx.request") < 0 && sheetJs.indexOf("remote") < 0);

  // 8) 预览得拍得到它 —— 拍不到的那一屏等于没改
  const pagesCfg = readJson(path.join(__dirname, "shots", "pages.json"));
  ok("预览里有「首页弹层开着」那一屏",
    Object.keys(pagesCfg).some((k) => /sheet/.test(k)),
    "pages.json 里没有名字带 sheet 的那一屏");
}

/**
 * V30. 详情页注音那一路（2026-10-03 用户的两句话）。
 *
 * 用户原话：
 *
 *   「关于所有详情页的注音，如果有一行有注音，而有一行没注音，那么没有注音的
 *     那一行的行间距也应该和有注音的行间距一样，否则隔行间距不一，不好看」
 *   「但凡有生字注音或者全文注音，需要确保每个汉字在 A－ A＋ 所有字号下的
 *     汉字字间距保持一致，否则一会宽一会窄，也特别难看」
 *
 * 这两句是**同一件事的两面**：注音那条路的尺寸必须由常数定死，不能由
 * 「字号乘倍数」或「min-width」这种会跟着内容走的东西撑起来。改成那样之后
 * 它坏起来是静默的 —— 页面上看着「有点怪」，量出来才知道差多少。
 *
 * 所以这里守四条（每一条都做过反证，把事实改坏确认会红）：
 *
 *   1. **行高不叠倍数**。`.token-line` 不许有「字号 × 倍数」的 line-height；
 *      它的高度取自 `--py-line`。上一版有 `line-height: 1.15`，
 *      有拼音的行被「槽 + 字」再撑一次 —— 有音 81rpx、无音 53rpx。
 *   2. **行盒是「槽 + 字身」**。--py-line = --py-slot + --py-box + 4rpx，
 *      七档都要对得上。行里有没有拼音都撑到这个数，所以两种行一样高。
 *   3. **拼音槽要装得下拼音**（槽 ≥ --fs-pinyin）。槽低于拼音的行高，
 *      拼音会被 flex 对齐挤出去压到上一行的字上 —— 这一条量过，
 *      比「行高一致」更容易被漏掉，因为它只在有拼音的行上显形。
 *   4. **字距与字号无关**。字与字之间的空隙只能来自 `--py-gap`
 *      （页面里不许再给 `.token` 写 margin 的左右值），
 *      而 `--py-gap` 一档都不许跟着字号动 —— 用户要的「所有字号下
 *      字间距保持一致」就是这一条。
 *
 * 与 V29 并存：V29 管的是「首页那张弹层在不在、盖不盖得住底栏」，
 * 这一节管的是**注音那一路的数**。两者都盯着阅读面，但一个是结构、
 * 一个是尺寸 —— 合到一处会让人以为删掉一边就等于撤掉整件事。
 */
{
  /* 注音这一路的样式住在 **app.wxss** 的「阅读面」一节 —— 详情页与首页
     那张背诵弹层共用一份（V29 第 4 条守着「别写第二份」）。所以量它的
     尺子也要落在那一份上：量 pages/reader 只会读到一片空，然后红着报
     「读到 0 档」—— 而真正的问题并不在那儿。 */
  const wxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // 1) 注音那条路不许有「字号乘倍数」的行高
  const tokenLine = /\.token-line\s*\{([^}]*)\}/.exec(wxss);
  ok("注音行的高度取自 --py-line（不是长出来的）",
    !!tokenLine && /height\s*:\s*var\(--py-line\)/.test(tokenLine[1]),
    tokenLine && tokenLine[1].replace(/\s+/g, " ").trim());
  const tokenLineLH = /\.poem-line\.token-line\s*\{([^}]*)\}/.exec(wxss);
  ok("注音那条路的行高不叠倍数（有音无音才不会差半行）",
    !!tokenLineLH && /line-height\s*:\s*1\s*;/.test(tokenLineLH[1])
    && !/line-height\s*:\s*[\d.]+\s*;/.test(tokenLineLH[1].replace("line-height: 1;", "")),
    tokenLineLH && tokenLineLH[1].replace(/\s+/g, " ").trim());

  // 2) 逐档：行盒 = 槽 + 字身 + 4rpx
  const steps = [...wxss.matchAll(
    /\.poem-body\.size(--?\d)\s*\{\s*--py-box:\s*([\d.]+)rpx;\s*--py-slot:\s*([\d.]+)rpx;\s*--py-line:\s*([\d.]+)rpx;\s*font-size:\s*([\d.]+)rpx;\s*\}/g
  )].map((m) => ({ size: m[1], box: +m[2], slot: +m[3], line: +m[4], font: +m[5] }));
  ok("注音七档的四个数（字身盒 / 拼音槽 / 行盒 / 字号）都在",
    steps.length === 7, "读到 " + steps.length + " 档");

  const badLine = steps.filter((s2) => s2.line !== s2.slot + s2.box + 4)
    .map((s2) => "size" + s2.size + " " + s2.slot + "+" + s2.box + "+4≠" + s2.line);
  ok("每一档「行盒 = 拼音槽 + 字身盒 + 上下 2rpx 呼吸」", badLine.length === 0, badLine.join(" | "));

  // 3) 拼音槽要装得下拼音（槽 ≥ 2 × 注音字号）
  const pinyinToken = /--fs-pinyin:\s*calc\(([\d.]+)rpx/.exec(
    fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8"));
  const pySize = pinyinToken ? +pinyinToken[1] : 0;
  const tightSlot = steps.filter((s2) => s2.slot < pySize)
    .map((s2) => "size" + s2.size + " 槽 " + s2.slot + "rpx < " + pySize + "rpx");
  ok("拼音槽装得下拼音（槽 ≥ 注音字号 " + pySize + "rpx）",
    tightSlot.length === 0, tightSlot.join(" | "));

  // 4) 字距只由 --py-gap 出，且不跟字号走
  const gap = /--py-gap:\s*([^;]+);/.exec(
    fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8"));
  ok("字身外的空隙由 --py-gap 一处给出", !!gap, gap ? gap[1].trim() : "找不到 --py-gap");
  /* 字距只跟着**全局缩放**走（--ui-scale），不许跟字号档位走 ——
     所以它的算式里只能有 ui-scale 这一个变量。 */
  ok("--py-gap 不跟字号档位走（A－ A＋ 全程字距一致）",
    !!gap && /^calc\([\d.]+rpx \* var\(--ui-scale\)\)$/.test(gap[1].trim()),
    gap && gap[1].trim());
  const tokenBlock = /\.token\s*\{([^}]*)\}/.exec(wxss);
  ok("token 的左右空隙取自 --py-gap",
    !!tokenBlock && /margin\s*:\s*0\s+var\(--py-gap\)/.test(tokenBlock[1]),
    tokenBlock && tokenBlock[1].replace(/\s+/g, " ").trim());
  ok("token 不再用 min-width 撑字宽（那会随字号跳）",
    !!tokenBlock && !/min-width/.test(tokenBlock[1]));

  // 5) 注音行的字号逐档与正文同值 —— 上一版少了这一条，
  //    表现是「A－ A＋ 在注音模式下没有任何反应」（.tk-ch 取了基准档 --fs-poem）
  const lineSteps = [...wxss.matchAll(/\.poem-body\.size(--?\d)\s+\.poem-line\s*\{\s*font-size:\s*([\d.]+)rpx;\s*\}/g)]
    .map((m) => ({ size: m[1], font: +m[2] }));
  const mismatch = steps.filter((s2) => {
    const p = lineSteps.find((l) => l.size === s2.size);
    return !p || p.font !== s2.font;
  }).map((s2) => "size" + s2.size);
  ok("注音那条路的字号逐档与正文同值（切模式不跳字号）",
    mismatch.length === 0, mismatch.join(" | "));
}

/**
 * V31. 两条「只有量出来才看得见」的版式毛病（Issue #49 走查截图时量的）。
 *
 * 这两条的共同点是：截图里看着「有点怪」，但说不出怪在哪 ——
 * 一条是圆角把只有上边的分隔线收成了方框，一条是 flex 把标签压得折了行。
 * 都不影响功能，所以靠人眼回看守不住（改完就更看不出来了），
 * 得把判据写死在样式上。
 *
 *   1. **只有一条 border-top 的盒子不许带 border-radius。**
 *      圆角会把「只有上边没有左右下」的那条边一起收圆，渲染出来
 *      是左上 / 右上两个圆角 + 两侧向下的短弧，活像一个空的小方框。
 *      首页那行「背诵设置」就栽在这儿（`.hero-foot`）。同一类毛病
 *      V15 记过一版（inset 阴影被圆角切掉两端）—— 都是「圆角去裁
 *      一条边」的错。
 *
 *   2. **标签（.tag）不许被压窄、不许折行。**
 *      它是「新学 / 复习」这种两个字的量词胶囊，没有「装不下就换行」
 *      这一态。上一版它跟一篇长篇名并排（定风波·莫听穿林打叶声），
 *      篇名是 white-space: nowrap 且没给 min-width: 0，于是缩不动、
 *      压力全落到标签上：「新学」折成上下两行，标签高度 23px → 42px。
 *      修法两处 —— 标签 flex: none + nowrap；篇名给 min-width: 0
 *      好让它自己走省略号。
 */
{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // 1) 只有 border-top 的盒子不许有圆角（否则那条边被收成方框）
  const badTopBorder = [];
  const files = [];
  [path.join(ROOT, "app.wxss")].concat(
    pages.map((p) => path.join(ROOT, p + ".wxss"))
  ).forEach((f) => { if (fs.existsSync(f)) files.push(f); });
  files.forEach((f) => {
    const css = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const sel = m[1].trim().replace(/\s+/g, " ");
      const body = m[2];
      if (!/border-top\s*:/.test(body)) continue;
      // 有左右下任意一条实边时，圆角才是有意义的（画的是完整框）
      const hasOther =
        /border-(left|right|bottom)\s*:/.test(body) ||
        /(^|[^-])border\s*:/.test(body) ||
        /border-width\s*:/.test(body);
      if (hasOther) continue;
      if (/border-radius\s*:/.test(body)) badTopBorder.push(sel);
    }
  });
  ok("只画 border-top 的盒子不带 border-radius（圆角会把那条边收成方框）",
    badTopBorder.length === 0, badTopBorder.slice(0, 4).join(" | "));

  // 2) 标签不折行、不被压窄
  const tagBlock = /\.tag\s*\{([^}]*)\}/.exec(appWxss);
  ok("标签不被压窄（.tag 有 flex: none）",
    !!tagBlock && /flex\s*:\s*none/.test(tagBlock[1]),
    tagBlock && tagBlock[1].replace(/\s+/g, " ").trim().slice(0, 90));
  ok("标签不折行（.tag 有 white-space: nowrap）",
    !!tagBlock && /white-space\s*:\s*nowrap/.test(tagBlock[1]),
    tagBlock && tagBlock[1].replace(/\s+/g, " ").trim().slice(0, 90));

  // 与标签并排的篇名：得能缩，否则压力转嫁给标签
  const homeWxss = fs.readFileSync(path.join(ROOT, "pages", "home", "home.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const lineTitle = /\.row-line\s+\.row-title\s*\{([^}]*)\}/.exec(homeWxss);
  ok("与标签并排的篇名能缩（.row-line .row-title 有 min-width: 0）",
    !!lineTitle && /min-width\s*:\s*0/.test(lineTitle[1]),
    lineTitle && lineTitle[1].replace(/\s+/g, " ").trim().slice(0, 90));
}

/* ---------- V32. 四处「搬过来一半」的漏（Issue #49 走查截图时看见的） ----------

 * 这一轮的问题有一个共同形状：**上游有的东西，移植时只搬了一半**。
 * 网页版把英文字段翻成人话再上屏，小程序搬了字段没搬翻译；
 * 组件的 note 属性声明了、wxml 却没渲染；离线预览的替身与真组件
 * 各写一份结构，于是同一个东西在截图里和在真机上是两副样子。
 * 三件都不报错 —— 不写判据就只能靠下次再走一遍截图撞见。
 */
{
  // 1) 译文来源不许是英文 token
  //    poem 的 data/index.js 有 TRANSLATION_SOURCES 映射，小程序这边
  //    得在 build-data.js 里做同一件事。判据看的是**编译产物**：
  //    course.json 里的 src 必须全是中文说明，一个 ascii 字母都不许剩。
  const coursePath = path.join(ROOT, "data", "course.json");
  if (fs.existsSync(coursePath)) {
    const course = JSON.parse(fs.readFileSync(coursePath, "utf8"));
    const badSrc = [];
    Object.keys(course).forEach(function (id) {
      const src = course[id] && course[id].src;
      if (src && /[A-Za-z]/.test(src)) badSrc.push(id + "=" + src);
    });
    ok("译文来源是给人看的说明，不是英文 token（course.json 的 src）",
      badSrc.length === 0, badSrc.slice(0, 3).join(" | "));

    // 有映射表就不该有认不得的 token —— 语料里出现新键时要当场红
    const buildSrc = fs.readFileSync(path.join(__dirname, "build-data.js"), "utf8");
    ok("build-data.js 里有一份译文来源映射表",
      /TRANSLATION_SOURCES\s*=\s*\{/.test(buildSrc));
    const known = ["school", "academic", "modern", "public-domain"];
    const missing = known.filter(function (k) {
      return buildSrc.indexOf(k + ":") < 0 && buildSrc.indexOf('"' + k + '"') < 0;
    });
    ok("译文来源的四个键都认得（school / academic / modern / public-domain）",
      missing.length === 0, missing.join(", "));
  }

  // 2) lock-card：note 属性必须真被渲染出来，且预览替身与真组件同构
  const lockWxml = fs.readFileSync(
    path.join(ROOT, "components", "lock-card", "lock-card.wxml"), "utf8");
  const lockJs = fs.readFileSync(
    path.join(ROOT, "components", "lock-card", "lock-card.js"), "utf8");

  ok("lock-card 声明了 note 属性", /note\s*:\s*\{/.test(lockJs));
  ok("lock-card 真把 note 渲染出来了（wxml 里有 lock-note）",
    /lock-note/.test(lockWxml));
  ok("lock-card 渲染 note 时带 wx:if（空 note 不留一行空白）",
    /lock-note[^>]*wx:if|<text[^>]*wx:if[^>]*lock-note/.test(lockWxml));

  // note 的样式得有出处 —— 上一版属性声明着、wxml 不渲染、wxss 也没这条，
  // 三处一起漏，真机上这句人话从来没出现过
  const appWxssLock = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  ok("lock-note 有样式（.lock-note 定义在 app.wxss）", /\.lock-note\s*\{/.test(appWxssLock));

  // 预览替身与真组件同构：替身里出现的 lock-* 类名，真组件里也得有；
  // 反过来真组件里的 lock-* 类名，替身也得画出来 —— 否则就是
  // 「预览里有、真机没有」或反过来的第二遍
  // ！先剥注释再匹配 —— 替身的注释里就写着 lock-foot 这个名字（正是在说
  //   「上一版多画了它」），不剥的话判据抓到的是那句注释，红得毫无道理。
  const renderSrc = fs.readFileSync(path.join(__dirname, "shots", "render.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  // 取「展开 lock-card 的那一段」：从 class="card lock-card" 起，
  // 到这一条 return 语句结束（分号）。不拿 `</view>` 当结束符 ——
  // 替身里多画一个元素就会把那个锚点挪走，判据自己先瞎。
  const fakeBlock = /class="card lock-card"[\s\S]{0,1200}?;\n/.exec(renderSrc);
  if (fakeBlock) {
    const fake = fakeBlock[0];
    const classesOf = function (str) {
      return (str.match(/class="[^"]*\block-[a-z-]+/g) || [])
        .map(function (x) { return x.replace(/.*class="[^"]*?/, "").trim(); })
        .filter(Boolean);
    };
    // 真组件里 lock-* 的类名
    const realClasses = (lockWxml.match(/\block-[a-z-]+/g) || [])
      .map(function (x) { return x.trim(); })
      .filter(function (x, i, a) { return a.indexOf(x) === i; });
    const fakeClasses = (fake.match(/\block-[a-z-]+/g) || [])
      .map(function (x) { return x.trim(); })
      .filter(function (x, i, a) { return a.indexOf(x) === i; });

    const onlyReal = realClasses.filter(function (c) { return fakeClasses.indexOf(c) < 0; });
    const onlyFake = fakeClasses.filter(function (c) { return realClasses.indexOf(c) < 0; });
    ok("预览替身画出了真组件的每一个 lock-* 元素",
      onlyReal.length === 0, onlyReal.join(", "));
    ok("预览替身不再凭空多画 lock-* 元素（多一行字就能把间距看错）",
      onlyFake.length === 0, onlyFake.join(", "));
  } else {
    ok("预览里能找到 lock-card 的替身展开", false, "没匹配到展开片段");
  }

  /* 3) 搜索框的 placeholder 不许和它头顶那张卡的标题重名。
     这一条也是「搬了一半」：网页版首页那枚搜索框**上方没有标题**，
     「今日加背」四个字就是它的身份；小程序把它挪进一张卡之后，
     上面刚有一行标题写着「今日加背」，框里再写一遍，
     看的人就分不清「哪个是标题、哪个能点」。
     判据取**同一张卡里**两个字符串：卡片标题（首页 wxml 的 card-title）
     与组件 placeholder，不许相等。 */
  const homeWxmlDaily = fs.readFileSync(path.join(ROOT, "pages", "home", "home.wxml"), "utf8");
  const compWxml = fs.readFileSync(
    path.join(ROOT, "components", "daily-extra", "daily-extra.wxml"), "utf8");
  const dailyTitle = /card-title[^>]*>\s*今日加背/.test(homeWxmlDaily) ? "今日加背" : "";
  const ph = /placeholder="([^"]*)"/.exec(compWxml);
  ok("今日加背那张卡有标题", !!dailyTitle);
  ok("搜索框 placeholder 不与卡片标题重名",
    !!ph && ph[1] !== dailyTitle,
    ph ? "placeholder = 「" + ph[1] + "」，标题 = 「" + dailyTitle + "」" : "没读到 placeholder");
  /* placeholder 说的是「能搜什么」，不是「这是哪张卡」——
     与别的搜索框同一套话术，读得出字段。 */
  ok("placeholder 说明搜索字段（含「搜」字）",
    !!ph && ph[1].indexOf("搜") >= 0, ph ? ph[1] : "");
}

/**
 * V33. 今日加背（Issue #42 的追加题，2026-10-04）。
 *
 * 用户原话：
 *   「本项目添加 今日加背 功能了吗？可参考 /poem 代码库」
 *   「请完整实现，不要丢这个缺什么」
 *
 * 上一轮盘出来的实情是：**数据层全通了，缺的只有界面** ——
 * store.dailyExtra()/setDailyExtra() 有当日域与跨天归零，排期器认加背，
 * 云同步真打包了 `daily_extra:v1`，自检也有覆盖；只是全项目**没有任何
 * 界面能往里加**（setDailyExtra 只被同步回写调过一次）。
 * 网页版是一整套（js/daily-extra.js + js/daily-extra-ui.js + 首页那枚
 * 搜索框 + settings/recite 的管理面板），所以这一节按那份清单逐项守。
 *
 * 为什么这一节重要：加背这条路的坏法全是**静默**的 ——
 * 「能加但排不进计划」「加了却看不见」「上限失效再加一首」
 * 三样都不会报错，只会让人觉得「这个功能有点怪」。
 */
{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const storeSrc = fs.readFileSync(path.join(ROOT, "utils", "store.js"), "utf8");
  const schedSrc = fs.readFileSync(path.join(ROOT, "utils", "scheduler.js"), "utf8");
  const homeJs = fs.readFileSync(path.join(ROOT, "pages/home/home.js"), "utf8");
  const homeWxml = fs.readFileSync(path.join(ROOT, "pages/home/home.wxml"), "utf8");
  const compDir = path.join(ROOT, "components", "daily-extra");
  const compJs = fs.readFileSync(path.join(compDir, "daily-extra.js"), "utf8");
  const compWxml = fs.readFileSync(path.join(compDir, "daily-extra.wxml"), "utf8");

  // 1) 入口真的存在：首页挂上了那张卡，且它就是这个组件
  ok("今日加背四件套齐全",
    [".js", ".json", ".wxml", ".wxss"].every((e) => fs.existsSync(path.join(compDir, "daily-extra" + e))));
  ok("首页挂上了今日加背", homeWxml.indexOf("<daily-extra") >= 0);
  const homeCfg = readJson(path.join(ROOT, "pages/home/home.json"));
  ok("首页注册了这个组件",
    (homeCfg.usingComponents || {})["daily-extra"] === "/components/daily-extra/daily-extra");
  // 加完要当场重排 —— 攒着等下次 onShow，用户会以为没加上，然后再点一次（那时点的是移出）
  // 加完要当场重排 —— 攒着等下次 onShow，用户会以为没加上，然后再点一次
  // （那时点的是「移出」）。两处都要挂：加背卡那张、以及弹层那一枚
  // （背到一半加完，这一列也该跟着动）。
  ok("加完当场重排今日安排（不是等下次进页面）",
    /onExtraChange\s*\([\s\S]{0,200}?this\.refresh\(\)/.test(homeJs));
  ok("加背卡 + 背诵弹层两处都挂了 change",
    /<daily-extra[^>]*bind:change="onExtraChange"/.test(homeWxml)
      && /<recite-sheet[^>]*bind:change="onExtraChange"/.test(homeWxml),
    "有一处没挂 change，那一处加完不会重排");

  // 2) 上限与两态：与网页版同数，且判断收在 store 一处
  ok("上限与网页版同数（20）",
    /DAILY_EXTRA_MAX\s*=\s*20\b/.test(storeSrc));
  ok("加 / 移是同一个动作的两态（不是两个函数）",
    /function toggleDailyExtra\(/.test(storeSrc));
  ok("满了就拒绝，不静默丢弃",
    /E_LIMIT/.test(storeSrc) && /E_LIMIT/.test(compJs));
  ok("写存储失败要如实返回（不能「点了没反应」）",
    /E_STORAGE/.test(storeSrc) && /E_STORAGE/.test(compJs)
      && /return write\(KEYS\.dailyExtra/.test(storeSrc));
  ok("上限只在 store 里判一次（组件用 DAILY_EXTRA_MAX，不自己写数）",
    compJs.indexOf("store.DAILY_EXTRA_MAX") >= 0
      && !/>=\s*20\b|===\s*20\b|:\s*20\b/.test(compJs),
    "组件里又写了一个字面的 20");

  // 3) 排期层真的认它 —— 光能加、排不进计划，这个功能就是死的
  ok("排期器真的把加背排进计划",
    /extraPoems/.test(schedSrc) && /extraList/.test(schedSrc));
  ok("首页把加背交给排期器（不是自己拼一份）",
    /extraPoems:\s*store\.dailyExtraPoems\(\)/.test(homeJs));

  // 4) 计划行上的小签：用户加的 vs 系统凑的，**必须分得开**
  //    两个概念共用一个词，界面上就分不清「这首是我加的」还是「系统补的」
  ok("今日加背在计划行上有一枚小签",
    /pinned:\s*"今日加背"/.test(homeJs));
  ok("「系统凑数」与「用户加背」不再共用一个词",
    /extra:\s*"补充"/.test(homeJs) && /pinned:\s*"今日加背"/.test(homeJs));
  ok("小签按类型给色（加背金、复习琥珀、新学青）",
    /REASON_CLS/.test(homeJs) && /\.tag\.gold\s*\{/.test(appWxss));

  // 5) 详情页与弹层里也要能加 —— 背到一半想「这首明天还得再来」是常事
  const readerWxml = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxml"), "utf8");
  const sheetWxml = fs.readFileSync(path.join(ROOT, "components/recite-sheet/recite-sheet.wxml"), "utf8");
  ok("详情页有「加入今日背诵」", readerWxml.indexOf("onToggleDaily") >= 0);
  ok("背诵弹层里也有（同一枚、同一套样式）", sheetWxml.indexOf("onToggleDaily") >= 0);
  // 用户 2026-10-04：「加入今日背诵只需要一个加号就行了，并且和 A- A+ 放在同一行」
  // —— 这一枚必须真的长在 .prefs 这一行里，而不是另起一行；并且不能带长文案
  [["详情页", readerWxml], ["背诵弹层", sheetWxml]].forEach(([name, src]) => {
    ok(name + "的加号长在偏好那一行里（与 A－ A＋ 同一行）",
      src.indexOf("pref-plus") > src.indexOf('class="prefs"')
        && src.indexOf("pref-size") < src.indexOf("pref-plus"),
      "加号没在这一行里，或者不在 A＋ 之后");
    // 判据只看**模板**里的文案：注释里写着用户那句话，不算「界面上有」
    const markup = src.replace(/<!--[\s\S]*?-->/g, "");
    ok(name + "的加号只有一枚字形（没有「加入今日背诵」那种长文案）",
      !/已加入今日背诵|>加入今日背诵/.test(markup),
      "长文案会把这一行撑破（七个段 499rpx，卡片内容宽 596rpx）");
  });
  ok("两处共用一份样式（阅读面在 app.wxss）",
    /\.pref-plus\s*\{/.test(appWxss));
  // 一处定义两处用：页面样式表里不许再写第二份
  [path.join(ROOT, "pages/reader/reader.wxss"),
   path.join(ROOT, "components/recite-sheet/recite-sheet.wxss")].forEach((f) => {
    const css = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    ok("不写第二份加背按钮样式 " + path.basename(path.dirname(f)) + "/" + path.basename(f),
      !/\.pref-plus\s*\{/.test(css));
  });

  // 6) 设置页那半页：网页版的 daily-panel 是「全选 / 取消 / 移出选中 / 全部清空」
  const setWxml = fs.readFileSync(path.join(ROOT, "packages/settings/recite/recite.wxml"), "utf8");
  const setJs = fs.readFileSync(path.join(ROOT, "packages/settings/recite/recite.js"), "utf8");
  ok("设置页有今日加背的管理面板", setWxml.indexOf("今日加背") >= 0 && setWxml.indexOf("daily-tools") >= 0);
  [["onDailyAll", "全选"], ["onDailyNone", "取消全选"],
   ["onDailyRemove", "移出选中的"], ["onDailyClear", "全部清空"]].forEach(([fn, label]) => {
    ok("管理面板有「" + label + "」",
      setWxml.indexOf(label) >= 0 && new RegExp(fn + "\\(\\)").test(setJs));
  });
  ok("「全部清空」先问一句（不可逆的动作不许一键完成）",
    /wx\.showModal/.test(setJs) && /清空今日加背/.test(setJs));
  ok("清空的是今日暂存，不动已背的进度",
    /function clearDailyExtra\(/.test(storeSrc) && /drop\(KEYS\.dailyExtra\)/.test(storeSrc));

  // 7) 读数与列举同源 —— 不许「说 3 首、列 2 行」
  ok("管理面板的读数与列表同一次算出",
    /refreshDaily[\s\S]{0,300}?dailyRows\(\)/.test(setJs));
  ok("认不出来的 id 如实丢掉（不编一条空标题）",
    /dailyExtraPoems[\s\S]{0,300}?\.filter\(Boolean\)/.test(storeSrc));

  // 8) 能力键：加背是 free 档的，界面上的入口归它管
  ok("能力表里有 extra（与网页版对齐）", E.CAP_KEYS.indexOf("extra") >= 0);

  // 9) 预览：拍不到的那一屏等于没改
  const pagesCfg = readJson(path.join(__dirname, "shots", "pages.json"));
  ok("预览里有「首页加背搜出结果」那一屏",
    Object.keys(pagesCfg).some((k) => k === "home-extra"));
  ok("预览里有「设置页加背管理」那一屏",
    Object.keys(pagesCfg).some((k) => k === "settings-recite-daily"));
}


/* ---------- V34. 登录即全量同步（Issue #42 的第四问，2026-10-04） ----------
 *
 * 用户原话：
 *   「我现在是微信小程序项目，不是之前的 web 应用，需要修改，同步功能只要
 *     用户登录就全部提供，确保用户数据不丢失，背诵进度换设备也能得到。请重新设计」
 *
 * 上一轮的实情（不是「差不多」）：真正绑账号的只有身份与档位；进度 / 已读 /
 * 加背 / 自选清单走云同步但**要 Pro**；设置与头像**压根没打包**，
 * 换台手机主题回「墨」、每日计划回 5 首、算法回艾宾浩斯、头像没了。
 *
 * 所以这一节守两件事：
 *   1. **一样都不许再漏**：设置 / 头像 / 昵称有打包、有落地、有往返
 *   2. **登录那一刻就同步**：新机器上登录完，进度不能还躺在云上
 *
 * 为什么这些坏法都是静默的：「设置没打包」不会报错 —— 它只是换台手机之后
 * 悄悄回了默认值，用户以为是新机器本来就该这样。
 */
{
  const wireSrc = fs.readFileSync(path.join(ROOT, "utils", "wire.js"), "utf8");
  const storeSrc2 = fs.readFileSync(path.join(ROOT, "utils", "store.js"), "utf8");
  const authSrc = fs.readFileSync(path.join(ROOT, "utils", "auth.js"), "utf8");
  const mineJs2 = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");

  // 1) 「跟人走」与「跟设备走」必须分得开
  ok("设置分两层：跨设备的 DEFAULTS + 只属本机的 DEVICE_DEFAULTS",
    /const DEFAULTS\s*=/.test(storeSrc2) && /const DEVICE_DEFAULTS\s*=/.test(storeSrc2));
  ok("音效跟设备走（不跨设备搬）",
    /DEVICE_DEFAULTS\s*=\s*\{[\s\S]{0,200}?sfx/.test(storeSrc2));
  ok("写设置时按键分流（页面只写一个 key）",
    /function saveSettings\(patch\)[\s\S]{0,400}?isDeviceKey/.test(storeSrc2));

  // 2) 打包：设置与头像各占一行
  ok("设置有打包（settings:v1）",
    wireSrc.indexOf("SETTINGS_ROW") >= 0 && /SETTINGS_ROW\s*=\s*"settings:v1"/.test(wireSrc));
  /* ⚠️ **头像不该有打包**（Issue #111）。它只有一个来源（微信那张）且只落本机，
     进报文既没意义（临时路径换台手机打不开），又要为它养一个对象存储。
     这一条是**反向断言**：真冒出一个 profile:v1，就得先回答「它存的是谁的东西」。 */
  {
    // ⚠️ 先摘注释：上面那段解释「这里没有 profile:v1」的注释里正引着这个词，
    //    直接搜全文会把自己的讲解判成违规（V46b / V43 都踩过同一个坑）。
    const bare = wireSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok("头像**不**进同步报文（没有 profile:v1 那一行）",
      bare.indexOf("PROFILE_ROW") < 0 && bare.indexOf("profile:v1") < 0,
      "报文里还有 profile:v1 —— 头像只落本机，推上去既没地方存也没意义（Issue #111）");
  }
  ok("打包的是跨设备那一份设置（不是整份）",
    /store\.cloudSettings\(\)/.test(wireSrc));

  // 3) 落地：设置那条分支在 applyRecords 里
  ok("设置能落回本机", /id === SETTINGS_ROW[\s\S]{0,400}?replaceSettings/.test(wireSrc));

  // 4) 往返：写一份设置 → 打包 → 清掉 → 用「云端」那份盖回来 → 还在
  {
    const wireMod4 = require(path.join(ROOT, "utils", "wire.js"));
    const storeMod4 = require(path.join(ROOT, "utils", "store.js"));
    const future = Date.now() + 86400000;

    storeMod4.replaceSettings({ grade: 7, theme: "tianqing", fontSize: 2 });
    storeMod4.saveSettings({ sfx: true });
    storeMod4.touchSettings(future);
    storeMod4.saveProfile({ avatarLocal: "wxfile://avatar.jpg", nickname: "张敏" }, future);

    const packed4 = wireMod4.packRecords();
    ok("设置真的进了包", packed4.some((r) => r.id === "settings:v1"));
    const sRow = packed4.filter((r) => r.id === "settings:v1")[0];
    ok("设置行按服务端形状（payload.settings + updatedAt）",
      !!sRow && !!sRow.payload.settings && sRow.updatedAt > 0);
    ok("设置行里带上了年级 / 主题 / 字号",
      !!sRow && sRow.payload.settings.grade === 7 && sRow.payload.settings.theme === "tianqing"
        && sRow.payload.settings.fontSize === 2);
    ok("设置行里**没有**跟设备走的那一项",
      !!sRow && sRow.payload.settings.sfx === undefined,
      "sfx 跟设备走，不该进报文");
    ok("头像**没有**进包（它只落本机）",
      !packed4.some((r) => r.id === "profile:v1"),
      "打包里出现了 profile:v1");

    // 换台机器：本机回到默认，再把云端那份盖回来
    storeMod4.replaceSettings({ grade: 1, theme: "ink", fontSize: 0 });
    storeMod4.touchSettings(0);
    storeMod4.saveProfile({ avatarLocal: "", nickname: "" });

    const applied4 = wireMod4.applyRecords(packed4);
    const back = storeMod4.settings();
    ok("云端那份设置能整份落回本机（" + applied4 + " 条）", applied4 >= 1, applied4 + " 条");
    ok("换机之后年级是认回来的（不是默认 1）", back.grade === 7, String(back.grade));
    ok("换机之后主题是认回来的（不是默认墨）", back.theme === "tianqing", back.theme);
    ok("换机之后字号是认回来的", back.fontSize === 2, String(back.fontSize));
    /* ⚠️ 这一条是**反着**断言的（Issue #111）：头像不跨设备。
       它是这台手机上的东西（微信头像的临时路径），换台手机本来就该没有。 */
    ok("换机之后头像**不**在（头像只落本机，这是刻意的）",
      storeMod4.profile().avatarLocal === "",
      "居然还在：" + String(storeMod4.profile().avatarLocal));
    // 音效跟设备走：云上那份里根本没有它，认回云端不该把本机这份改掉
    ok("音效仍听这台设备的（云端那份盖不到它）", back.sfx === true, String(back.sfx));
    ok("跟设备走的那一项不进报文（云上没有它）",
      storeMod4.cloudSettings().sfx === undefined);

    // 时间戳的规矩：认回来的那份必须带上云端的时间戳，
    // 否则本机立刻变成「更新的那一份」，下次同步又推回去，两台机器互相覆盖
    ok("认回来的设置带云端时间戳（不然会来回覆盖）",
      storeMod4.settingsAt() === future, String(storeMod4.settingsAt()));

    // 旧的不许盖新的
    wireMod4.applyRecords([
      { id: "settings:v1", payload: { v: 1, settings: { theme: "zhuhong" } }, updatedAt: 1 }
    ]);
    ok("比本机旧的设置不覆盖", storeMod4.settings().theme === "tianqing");
  }

  // 4.5) 两条**只有端到端才试得出来**的静默 bug，各自钉一条断言。
  //
  // 它们都属于「换台手机才发现」那一类：本机一切正常，界面写着已同步，
  // 另一个设备上就是没有。写成断言是因为人眼看不出来 —— 代码读着都对。
  {
    const storeMod45 = require(path.join(ROOT, "utils", "store.js"));
    const wireMod45 = require(path.join(ROOT, "utils", "wire.js"));

    // (a) 时间戳是同步的入场券 —— 不许由调用方负责盖。
    //     靠「每个入口记得 markDirty」就等于让同步成不生效取决于记性。
    storeMod45.saveSettings({ grade: 8 });
    ok("写设置会自动盖上时间戳（不靠调用方记得）",
      storeMod45.settingsAt() > 0, String(storeMod45.settingsAt()));
    ok("跟设备走的那一项不盖章（写 sfx 不该让设置进队列）", (() => {
      const before = storeMod45.settingsAt();
      storeMod45.saveSettings({ sfx: !storeMod45.settings().sfx });
      return storeMod45.settingsAt() === before;
    })());

    // (b) 档案（昵称 + 头像）是**本机**那一份，没有跨设备比较这回事了。
    //     Issue #111 把头像收成「只落本机、不上传」，`profileAt` 这个读数
    //     随之退场 —— 留着它只会让下一个人以为还有一份在云上比新旧。
    ok("store 里不再有 profileAt（档案不再参与「谁更新」的比较）",
      typeof storeMod45.profileAt !== "function",
      "profileAt 还在 —— 它对应的那份云端档案已经没有了");

    // (c) 报文的深拷：pack 之后本机再改，排队那一行**不许跟着变**。
    //     不拷的话，离线队列里躺着的那一份会「时间戳是老的、内容是新的」。
    storeMod45.replaceSettings({ theme: "ink" });
    storeMod45.touchSettings(Date.now());
    const row45 = wireMod45.packRecords().filter((r) => r.id === "settings:v1")[0];
    const themeAtPack = row45.payload.settings.theme;
    storeMod45.replaceSettings({ theme: "zhuhong" });
    ok("打包之后本机再改，报文不许跟着变（不然推上去的是一份说不清来历的数据）",
      row45.payload.settings.theme === themeAtPack, "报文被本机存储的引用串改了");
    storeMod45.replaceSettings({ theme: "ink" });
  }

  // 5) 登录那一刻就同步 —— 新机器上登录完，进度不能还躺在云上
  ok("登录成功之后立刻认回云端", /pullAfterLogin/.test(authSrc));
  ok("认回云端只在这条路上做一次（不是每个页面各写一遍）",
    (authSrc.match(/pullAfterLogin\(/g) || []).length <= 2);
  ok("界面会如实说「认回来了」还是「通道没开」",
    /synced/.test(authSrc) && /进度已认回|后端未就绪/.test(mineJs2));

  // 6) 同步不再分档，但门槛还在（配了后端 + 登录了）
  const syncSrc = fs.readFileSync(path.join(ROOT, "utils", "sync.js"), "utf8");
  ok("同步只有一道门槛：配了后端且登录了",
    /function ready\(\)[\s\S]{0,160}?remote\.configured\(\) && auth\.logged\(\)/.test(syncSrc));
  ok("同步层不再问档位", syncSrc.indexOf("entitlement") < 0);

  /* 7) 每一个「改了就该同步」的地方都挂了记账 —— 漏一处就是「改了但没传」。
     ⚠️ **头像不在这一张表里**（Issue #111）：它只落本机、不上传，本来就不该记账。
     它原来在这里，且判据是 `onAvatarChoose[\s\S]{0,400}?markDirty` —— 那个窗口
     会**越过 `onAvatarChoose` 的函数体**够到紧跟着的 `onNickname` 里的 markDirty，
     所以把 `onAvatarChoose` 里的记账删掉之后，这条断言照样是绿的。
     这是个假绿，顺手改成「按函数体取」。 */
  const DIRTY = [
    ["通用设置", "packages/settings/general/general.js", /onAlign[\s\S]{0,200}?markDirty/],
    ["通用设置-字号", "packages/settings/general/general.js", /onFontSlide[\s\S]{0,300}?markDirty/],
    ["背诵设置（年级/范围/首数/算法）", "packages/settings/recite/recite.js", /save\(patch\)[\s\S]{0,300}?markDirty/],
    ["主题色", "utils/theme.js", /function set\(key\)[\s\S]{0,400}?markDirty/],
    ["注音口径", "utils/pinyin.js", /function setMode[\s\S]{0,400}?markDirty/],
    ["昵称", "pages/mine/mine.js", /onNickname(?:\([^)]*\))[\s\S]{0,400}?markDirty/]
  ];
  DIRTY.forEach(([name, file, re]) => {
    ok("改了就该传：「" + name + "」挂了记账",
      re.test(fs.readFileSync(path.join(ROOT, file), "utf8")), file);
  });
  /* 反向：头像**不许**挂记账 —— 挂了就等于它进了同步队列（Issue #111）。 */
  {
    const mineSrc7 = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");
    const i = mineSrc7.indexOf("onAvatarChoose(");
    const j = i < 0 ? -1 : mineSrc7.indexOf("\n  },", i);
    const body = (i < 0 || j < 0) ? "" : mineSrc7.slice(i, j);
    ok("头像**不**挂记账（挂了就等于它进了同步队列，而上传它要养一个存储桶）",
      !!body && body.indexOf("markDirty") < 0,
      "头像函数体里出现了 markDirty：" + body.replace(/\s+/g, " ").slice(0, 140));
  }

  // 8) 记账是**免费的**：markDirty 不许发网络
  ok("markDirty 只记账不发网络",
    /function markDirty\(\)[\s\S]{0,400}?\}/.test(syncSrc)
      && /function markDirty\(\)[\s\S]{0,400}?wx\.request/.test(syncSrc) === false);

  // 8.5) ⚠️ **服务端必须给这两行加白名单**，否则数据到不了云端。
  //
  // 这一条是**量出来的**，不是读文档推的：poem 的 `sanitizePayload` 对
  // 认不出的行 id 一律返回 `{}` —— 也就是说，服务端没加白名单时，
  // `settings:v1` / `profile:v1` 的载荷会被**静默清空**：
  // 客户端一路「同步成功」、界面写着「已同步」，换台手机什么都没有。
  //
  // 客户端这边只能做到「发得出去、写得规范」，剩下那半在服务端。
  // 所以这条不断言服务端（读不到就是读不到），而是**把要求钉在文档里**，
  // 并守着文档里真的写了它 —— 少一个环节，接手的人就会以为是客户端坏了。
  {
    const doc = fs.readFileSync(path.join(ROOT, "..", "docs", "wx-login-server.md"), "utf8");
    ok("服务端要加的两行白名单写进了文档",
      doc.indexOf("settings:v1") >= 0 && doc.indexOf("profile:v1") >= 0);
    ok("文档说清了「不加白名单会被静默清空」这件事",
      doc.indexOf("sanitizePayload") >= 0);
  }

  // 9) 预览
  const pagesCfg2 = readJson(path.join(__dirname, "shots", "pages.json"));
  ok("预览里有「换台机器、云端那份落回来」那一屏",
    Object.keys(pagesCfg2).some((k) => k === "mine-synced"));
}

/**
 * V35. 题干的「一句」有长度上限（Issue #49 走查截图引出的题，2026-10-04）。
 *
 * 起因是截图走查里翻出来的一道真题：题库抽到《六国论》，
 * 而语料把整篇**一段一行**存着 —— 那一行 223 个字。
 * 「给诗句认篇名」的题干于是变成两百字的文言文，
 * 答题卡上只剩题干、四个选项被顶到下一页；交卷后的逐题回顾里，
 * 一道题一个人吃掉两屏。而它问的只是「这首诗叫什么名字」。
 *
 * 数据面的规模（量出来的，不是估的）：
 *   · 5324 篇里 3384 篇的「行」超过 40 字；
 *   · 251 篇课内里 29 篇最长行超过 30 字，
 *     《六国论》223 字、《核舟记》158 字、《赤壁赋》整段一段一行。
 *
 * 所以「一句」不再等于「一行」：先按行切，行内再按句读（，。！？；、）切，
 * 切完仍超过上限的不要。这样《无衣》的「岂曰无衣？与子同袍。」
 * 得到两个八字的句子（而不是被整行丢掉），
 * 《六国论》得到 98 个短句、最长 12 字 —— 251 篇一篇都不废。
 *
 * 守两条：上限这个常量在，且**取句口子只有一处**（linesOf）——
 * 多开一处取句，那道口子就不会过这个筛，题型又会漏长句进来。
 */
{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const quizSrc = read("utils/quiz.js");
  const stripped = quizSrc.replace(/\/\*[\s\S]*?\*\//g, "");

  const cap = /const MAX_LINE = (\d+);/.exec(stripped);
  ok("题干有长度上限（MAX_LINE 在）", !!cap);
  const capN = cap ? Number(cap[1]) : 0;
  ok("上限落在「一联十四字 + 余量」这一档（16 ~ 32 字）", capN >= 16 && capN <= 32,
    "读到 " + capN);

  /* 句读切分：只按 \n 切的话，文言文一段一行照样是两百字。
     断言查的是「真的按标点又切了一刀」——查 SENTENCE_END 里
     至少含，。！？；这四个断句符。 */
  /* ⚠️ 取的是方括号**里面**那一串：正则写成 \/([^/]+)\/ 会把 `[，。！？；、]`
     连括号一起捕获，拼成 new RegExp("[[，。！？；、]]") —— 那是一个
     「含 [ 的字符类」，一个句读都切不动，数据面那条断言立刻假红。 */
  const se = /const SENTENCE_END = \/\[([^\]]+)\]\//.exec(stripped);
  ok("行内还会按句读再切（SENTENCE_END 在）", !!se);
  ok("切分符含中文句读（，。！？；至少四个）",
    !!se && "，。！？；".split("").filter((c) => se[1].indexOf(c) >= 0).length >= 4,
    se ? se[1] : "");

  /* 取句只有一处口子：linesOf。
     `split("\n")` 除了 linesOf 里那一处，别的地方不许再直接切行取句 ——
     正文引用的每一处（含干扰项取样）都从这里走。 */
  const splits = (stripped.match(/\.split\("\\n"\)/g) || []).length;
  ok("按 \\n 取句只有一处（linesOf 收口）", splits === 1, "读到 " + splits + " 处");

  /* ⚠️ 这一条**真的去调 quiz.build**，而不是在这里照抄一遍切句逻辑。
     照抄的那版踩过坑：抄的时候把 SENTENCE_END 整串（连方括号）拼进
     new RegExp，切不动一个句读，于是断言在代码明明正确时假红；
     而它同时也就**测不到** quiz.js 真改坏的样子 —— 尺子自己造的，
     量谁都说合格。
     调真模块还多守一件事：出题这条路真的把长句挡在外面了。 */
  const quizMod = require(path.join(ROOT, "utils", "quiz.js"));
  const course = JSON.parse(read("data/course.json"));
  const courseIds = Object.keys(course);
  /* 把课内那 251 篇喂给出题器：`course()` 返回的名录没有正文，
     而 quiz 的正文从 corpus.entry 取（读的是同一份 course.json），
     所以这里只挑一条真的属性来断言 —— **题干与答案的长度**。 */
  let maxStem = 0, maxAnswer = 0, asked = 0, longOne = null;
  /* 出 300 轮，题型全开 —— 单轮样本太小，「篇名」抽到长句是概率事件。 */
  for (let round = 0; round < 300; round++) {
    const qs = quizMod.build({ count: 10, forms: ["next", "prev", "author", "title"] });
    qs.forEach((q) => {
      asked++;
      if ((q.stem || "").length > maxStem) maxStem = (q.stem || "").length;
      if ((q.answer || "").length > maxAnswer) {
        maxAnswer = (q.answer || "").length;
        longOne = { form: q.form, stem: (q.stem || "").slice(0, 20), answer: q.answer.slice(0, 20) };
      }
    });
  }
  ok("出题器真的产题了（300 轮里没全空）", asked > 0, "出了 " + asked + " 题");
  ok("题干不超过上限（真的调 build 量的）", maxStem > 0 && maxStem <= capN,
    "最长题干 " + maxStem + " 字");
  ok("答案不超过上限", maxAnswer > 0 && maxAnswer <= capN,
    "最长答案 " + maxAnswer + " 字" + (longOne ? "（" + longOne.form + "）" : ""));

  /* 课内那 29 篇文言文（一段一行）是这一条要挡的正主 ——
     断言它们**仍然出得了题**：切句切得太狠会把整篇切空，
     那就从「题干太长」换成了「这几篇没题」。 */
  const proseIds = courseIds.filter((id) => String(course[id].text).length > 100);
  ok("课内确实有长文（这一条不是空转）", proseIds.length > 10,
    "只找到 " + proseIds.length + " 篇长文");
}

/* ---------- V36. Issue #49 的第二轮走查（2026-10-04，用户逐条问） ----------
 *
 * 用户把 14 个界面问题一次列了出来，每条都是一句大白话，没有一条提代码。
 * 这一节按他问的顺序守 —— 那些坏法全是**静默**的：横线留着、圆圈留着、
 * 卡片多一层、按钮永远说「开始背」，都不会报错，只会让人觉得「有点怪」。
 *
 * 只守「改了什么」里能自动判的那几条；颜色、间距一类以截图为准（见 #49 里的图）。
 */
{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const homeWxml = read("pages/home/home.wxml");
  const homeWxss = read("pages/home/home.wxss");
  const homeJs = read("pages/home/home.js");
  const sheetWxml = read("components/recite-sheet/recite-sheet.wxml");
  const appWxss = read("app.wxss");
  const quizWxml = read("packages/game/quiz/quiz.wxml");
  const dayWxss = read("packages/progress/index/index.wxss");
  const generalWxml = read("packages/settings/general/general.wxml");
  const generalJs = read("packages/settings/general/general.js");
  const adminWxml = read("packages/admin/index/index.wxml");
  const adminJs = read("packages/admin/index/index.js");
  const entJs = read("utils/entitlement.js");

  // 1) 「开始背诵上面是横线还是进度条？如果是横线，直接删除」
  //    答案是进度条，但零进度时它是一根灰尺子 —— 与「横线」同形。既然开始前
  //    没进度可说，这条就整个不渲染；数字已经把「几首」说完了。
  ok("首页那条进度条在零进度时不渲染（不再是一根灰尺子）",
    /wx:if="\{\{percent\}\}"/.test(homeWxml) && /class="hero-meter"/.test(homeWxml),
    "零进度时还画着一条空槽，与「横线」同形");
  ok("进度条没被整块删掉（有进度时它还在）", /\.hero-meter\s*\{/.test(homeWxss));
  ok("进度条把「走到哪了」写成一行字（不然读不出这条量的是什么）",
    /已背/.test(homeWxml) && /\{\{doneCount\}\} \/ \{\{total\}\}/.test(homeWxml));

  // 2) 「下面有个背诵设置的链接……这里不需要链接」
  //    入口在「我的 → 背诵设置」本来就有，首页这一行是第三条路
  ok("首页不再有「背诵设置」那一行",
    !/\.hero-foot/.test(homeWxss) && !/hero-foot/.test(homeWxml),
    "那一行还在");
  // 撤的是那一行**链接**，不是这个入口本身：空态里那颗「去设置」还得留着，
  // 否则一首都没排出来时这一屏是个死胡同
  ok("首页「今日安排」卡里不再有那一行链接",
    !/hero-foot/.test(homeWxml) && homeWxml.indexOf("onSettings") > homeWxml.indexOf("empty"));
  ok("背诵设置仍有去处（我的 → 背诵设置）",
    /背诵设置/.test(read("pages/mine/mine.wxml")) && /onRecite/.test(read("pages/mine/mine.js")));

  // 3) 「今日安排卡片里右边的那些圆圈是做什么用的？」
  //    答不出来就是答案 —— 换成两个字，不用猜也不用点
  ok("今日安排的圆圈换成了「已背 / 未背」两个字",
    /row-state/.test(homeWxml) && /item\.read \? '已背' : '未背'/.test(homeWxml),
    "圆圈还在，或者状态没写成字");
  ok("圆圈那套样式已撤（不留孤儿样式）", !/\.tick\s*\{/.test(homeWxss));

  // 4) 「忘记 模糊 记住三个按钮不需要用卡片包裹，单独一行；
  //     掌握度卡片放在这三个按钮下面」
  //    reader 与背诵弹层是同一张卡，两处都要按这个顺序
  {
    const readerWxml = read("pages/reader/reader.wxml");
    [["详情页", readerWxml], ["背诵弹层", sheetWxml]].forEach(([name, src]) => {
      const acts = src.indexOf('class="actions"');
      const head = src.indexOf('class="recite-head"');
      ok(name + "：三颗按钮在掌握度**上面**（先评、再看读数）",
        acts >= 0 && head > acts, "顺序还是掌握度在前");
      ok(name + "：三颗按钮不再包一张卡（.actions 是裸的一行）",
        /<view class="actions">/.test(src));
    });
  }

  // 5) 「答错了。正确 看全篇 下一题按钮 你觉得他们放在一个卡片里合适吗？」
  //    不合适：它上面那张卡装的是题干，判定是同一件事的另一半。
  //    撤掉卡边，留一道细线做分隔（否则会读成第四个选项）。
  {
    const quizWxss = read("packages/game/quiz/quiz.wxss");
    const verdictBlock = /\.verdict\s*\{([^}]*)\}/.exec(quizWxss);
    ok("题库的判定区不再包卡片",
      /<view class="verdict" wx:if="\{\{last\}\}">/.test(quizWxml),
      "判定区还套着 .card");
    ok("撤了卡边之后补了一道细线（否则会读成第四个选项）",
      !!verdictBlock && /border-top/.test(verdictBlock[1]));
  }

  // 6) 「通用设置版式里有对齐和字号，怎么没有注音的设置？」
  //    版式三件事在正文里共用一行，设置里却把注音关进另一页
  ok("通用设置有注音那一栏", /注音/.test(generalWxml) && /onPinyin/.test(generalWxml));
  ok("通用设置的注音读的是同一份设置（走 pinyin.setMode）",
    /pinyin\.setMode\(/.test(generalJs), "自己写了一份 store.saveSettings，两页会分叉");
  ok("注音与阅读设置同一档位表（三档，不是另起一套）",
    /不注音/.test(generalJs) && /生字/.test(generalJs) && /全文/.test(generalJs));

  // 7) 「我的 页面有个专门的昵称在换头像下面一行，它是子用户吗？」
  //    不是。它和顶部那个名字是**同一个值**，上一版没说清
  {
    const mineWxml = read("pages/mine/mine.wxml");
    // 用户 2026-10-04 复查这一条时给了结论：既然是一个值，就只留一处 ——
    // 顶部的名字改成行内可编辑，下面那一行删掉（V37 守着）
    ok("「我的」页的昵称只有一处：顶部那个名字本身（下面那一行已撤）",
      mineWxml.indexOf("nick-input") < 0 && /class="identity-input"[^>]*type="nickname"/.test(mineWxml),
      "同一个值还摆两处，或者顶部那格还是只显示的字");
    ok("昵称输入框有长度上限（顶部那一行只有一行）",
      /maxlength="12"/.test(mineWxml));
  }

  // 8) 「全能(服务端) 所有者 这是什么意思，完全看不懂」
  //    档名、来源、角色是三件事，挤成两个词谁都不像人话。
  //    用户 2026-10-05 把这件事说到了底：
  //      「你这是把 Max 翻译成全能了吗？能不能不要翻译 Free, Pro 和 Max，
  //        翻译完了谁能看懂什么意思……只保留 Free, Pro 或者 Max」
  //      「有服务端发放删除，所有者是什么意思……也不要了 删除」
  //    所以这一条从「拆开摆」升级成「只留三个词」：
  //      · 档名就是 Free / Pro / Max，一个译名都不许有；
  //      · 界面上不再出现角色名（所有者 / 管理员 / 普通用户）。
  // 先摘掉注释：那段注释里正引着旧文案（V26 踩过同一个坑）
  {
    const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const entBare = bare(entJs);
    ok("档位名的括号里不再塞来源（档名就是档名）",
      !/（服务端）/.test(entBare) && !/（授权码）/.test(entBare), "又把来源塞回档名里了");

    // Free / Pro / Max 是**不翻译**的：档位表里那三个 name 与 key 同形
    const tiersJs = read("utils/tiers.js");
    const tiersMod = require(path.join(ROOT, "utils", "tiers.js"));
    const tierRows = [...bare(tiersJs).matchAll(/\{\s*key:\s*"(\w+)",\s*name:\s*"([^"]+)"/g)];
    ok("档位表三行齐全（free / pro / max 都在）", tierRows.length === 3,
      "读到 " + tierRows.length + " 行");
    const wanted = { free: "Free", pro: "Pro", max: "Max" };
    ok("档位名就是 Free / Pro / Max，没有译名",
      tierRows.length === 3 && tierRows.every((m) => wanted[m[1]] === m[2]),
      tierRows.map((m) => m[1] + "→" + m[2]).join(" "));
    ok("「全能 / 专业 / 免费」这三个译名一个都不留（tiers.js）",
      !/全能/.test(bare(tiersJs)) && !/专业/.test(bare(tiersJs)) && !/免费/.test(bare(tiersJs)));
    /* nameOf 是界面唯一拿档名的地方，所以**真的调它**量一遍 ——
       而不是在这里照抄 wanted 表（尺子自己造的，量谁都说合格）。
       不认识的档位一律回 "Free"：拿不到的档位，宁可少给。 */
    ok("nameOf 三档都回 Free / Pro / Max（与 key 同形）",
      ["free", "pro", "max"].every((k) => tiersMod.nameOf(k) === wanted[k]),
      ["free", "pro", "max"].map((k) => k + "→" + tiersMod.nameOf(k)).join(" "));
    ok("认不出的档位按 Free 显示（宁可少给）",
      tiersMod.nameOf("vip") === "Free" && tiersMod.nameOf("") === "Free",
      tiersMod.nameOf("vip"));
    ok("档位读不出来时回退也是 Free（TIERS[0] 就是 free）",
      tiersMod.tierOf("nope").key === "free" && tiersMod.DEFAULT_TIER === "free");

    // 界面文案里不再出现角色名 —— 「所有者」是用户点名删掉的那个词
    // wxml 也先摘注释：注释里正引着旧文案「全能（服务端） 所有者」（V26 踩过这个坑）
    const bareWxml = (src) => src.replace(/<!--[\s\S]*?-->/g, "");
    /* 来源这一格当天就被用户收走了：「不要显示 管理员发放 五个字」（2026-10-05）。
       他连说了三句 —— 档名别译、角色别露、来源别印 —— 落到最后就是
       「我的授权」这张卡上只剩档名与能力覆盖。所以这一格是**整格撤掉**，
       不是换句措辞：sourceText / scopeText 两个字段连同它们的样式一起删，
       界面上一个小样都不留。 */
    ok("界面上不再出现「管理员发放」（管理页 wxml）",
      bareWxml(adminWxml).indexOf("管理员发放") < 0, "这五个字还在卡片上");
    ok("界面上不再出现「管理员发放」（管理页 js 拼的串）",
      bare(adminJs).indexOf("管理员发放") < 0, "别在 js 里拼这句话");
    ok("来源那一格已撤，不是换了句措辞（sourceText / scopeText 一并删）",
      bare(adminJs).indexOf("sourceText") < 0 && bareWxml(adminWxml).indexOf("sourceText") < 0
        && bare(adminJs).indexOf("scopeText") < 0 && bareWxml(adminWxml).indexOf("scopeText") < 0,
      "留一个没人用的字段，下一个人会以为它还挂在界面上");
    ok("授权卡只剩档名（没有副题那一行）",
      adminWxml.indexOf("grant-tier-k") < 0
        && /<text class="grant-tier-name">\{\{status\.label\}\}<\/text>/.test(bareWxml(adminWxml)),
      "副题那一行还在，或者档名换写法了");
    // 档位副题（tiers 的 sub）：Pro / Max 说得出的话也只有「管理员发放」这一句，
    // 所以留空 —— 写一句重复的不如不写。Free 那句留着，它是唯一说得清来源的一格
    ok("Pro / Max 的副题留空（不写一句重复的来源）",
      tiersMod.tierOf("pro").sub === "" && tiersMod.tierOf("max").sub === "",
      "又把来源写回副题里了");
    ok("Free 的副题还在（登录即得要说得清）",
      /微信登录即得/.test(tiersMod.tierOf("free").sub));
    [["管理页 js", bare(adminJs)], ["管理页 wxml", bareWxml(adminWxml)],
     ["我的 js", bare(read("pages/mine/mine.js"))],
     ["我的 wxml", bareWxml(read("pages/mine/mine.wxml"))]].forEach(([name, src]) => {
      ok(name + "：界面里不再有「所有者」这个词",
        src.indexOf("所有者") < 0, "角色名还在，用户点名要删的就是它");
    });
    ok("管理页不再把角色当标签渲染（roleLabel 已撤）",
      bareWxml(adminWxml).indexOf("roleLabel") < 0 && bare(adminJs).indexOf("roleLabel") < 0,
      "roleLabel 还在模板里");
    ok("名录那一行只说档位与来源（角色名已撤）",
      /item\.tierLabel/.test(adminWxml) && !/item\.role/.test(bareWxml(adminWxml)),
      "名册里还挂着 role");
    // 改角色那个动作还在（它改的是服务端的 user/admin，不是给用户看的标签）——
    // 撤的是「把角色印在界面上」，不是「能不能改角色」
    ok("改角色这个动作没跟着一起删（撤的是标签，不是功能）",
      /onSetRole/.test(adminWxml) && /setRole/.test(bare(adminJs)));
  }

  // 9) 「未来七天 没选中的文字不需要和选中的一样最左最右有 padding 吗」
  //    要：同一列字，一行一个起点扫下来是锯齿
  {
    const day = /\.day\s*\{([^}]*)\}/.exec(dayWxss);
    ok("未来七天每一行都有左右两道 padding（含没排期的）",
      !!day && /padding:\s*var\(--sp-2\)\s+var\(--sp-3\)/.test(day[1]),
      "右侧那道没给，选中行那两道内边距就成了错位");
    const zero = /\.day\.zero\s*\{([^}]*)\}/.exec(dayWxss);
    ok("零排期那几天的左右 padding 也在（只有纵向压一档）",
      !!zero && /var\(--sp-3\)/.test(zero[1]), "零排期那几天被落下，起点又不一样了");
    ok("「今天」那行自己不再重复给 padding（一处定义）",
      !/\.day\.today\s*\{[^}]*padding-left/.test(dayWxss));
  }

  // 10) 「开始背按钮是做什么用的」—— 它说「接着今天往下走」，
  //     而旧版背完整个计划后按钮照样说「开始背」，点下去却从第一首开始
  ok("「开始背 / 再练一遍」按「还有没有没背过的」切",
    /todoCount/.test(homeJs) && /todoCount \? '开始背' : '再练一遍'/.test(homeWxml));
  ok("「开始背」挑的是第一首**没背过的**（不是第一首）",
    /find\(\(r\) => !r\.reviewed\)/.test(homeJs),
    "用的还是 read，与「背过」是两件事");
}

/* ---------- V37. 昵称收成一处（仅顶部、就地可改）+ 删掉那枚按了不动的开关 ----------
 *
 * 用户 2026-10-04 的两句话：
 *   「昵称 —— 仅保留顶部 -> 后面能改的地方删掉，让顶部显示的地方能同时行内编辑，
 *     改完直接显示」
 *   「背完自动下一首删掉」
 *
 * 两条都是**删**。删对了没人夸，删漏了没人报错 —— 所以每条都得有个断言守着：
 * 「同一个值只在一处」是静态可判的；「那枚开关不再出现」也是。
 */
{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const mineWxml = read("pages/mine/mine.wxml");
  const mineWxss = read("pages/mine/mine.wxss");
  const mineJs = read("pages/mine/mine.js");
  const generalWxml = read("packages/settings/general/general.wxml");
  const generalJs = read("packages/settings/general/general.js");
  const storeJs = read("utils/store.js");

  // 1) 昵称只剩顶上一处：那一行下面不再有第二个「昵称」输入框
  ok("「我的」页不再有第二个昵称输入框（原 .nick-input 那行已撤）",
    mineWxml.indexOf("nick-input") < 0 && mineWxss.indexOf(".nick-input") < 0,
    "下面那一行还在，同一个值仍摆两处");
  ok("顶部那个名字本身就是输入框（行内编辑）",
    /class="identity-input"[^>]*type="nickname"/.test(mineWxml) && /onNickname/.test(mineWxml),
    "顶部还是只显示的一行字");
  ok("行内编辑有长度上限（顶部那一行只有一行，档位芯片还在它右边）",
    /class="identity-input"[^>]*maxlength="12"/.test(mineWxml));
  ok("改完当场重画（不 refresh 就只改了存储，屏上那个名字不变）",
    /store\.saveProfile\(\{\s*nickname\s*\}\)[\s\S]{0,200}this\.refresh\(\)/.test(mineJs));
  // 未登录时那一格是「未登录」三个字，不是输入框 —— 没登录哪来的昵称可改
  ok("未登录时名字那一格仍是只显示的字（不是输入框）",
    /<text class="identity-name" wx:else>\{\{nickname\}\}<\/text>/.test(mineWxml));
  ok("就地编辑没被画成一张表单（不铺灰底、不描边框）",
    /\.identity-input\s*\{([^}]*)\}/.test(mineWxss)
      && !/background/.test(/\.identity-input\s*\{([^}]*)\}/.exec(mineWxss)[1]),
    "名字那一格铺了底色 / 描了边框，身份卡看着像张表单");

  // 2) 「背完自动下一首」删掉 —— 页面、处理器、以及那个没人读的默认键
  ok("通用设置里不再有「背完自动下一首」",
    generalWxml.indexOf("背完自动下一首") < 0 && generalWxml.indexOf("onAutoNext") < 0);
  ok("它的处理器也删了（不留没人调的 onAutoNext）", !/onAutoNext/.test(generalJs));
  ok("设置里的 autoNext 默认键也撤了（没人会再读它）",
    !/^\s*autoNext:/m.test(storeJs), "默认值还留着，等于给下一个来读它的人递了个空承诺");
  ok("删的是设置项，不是翻页本身（背完仍顺势进下一首）",
    /setTimeout\(\(\) => this\.goNext\(\), 700\)/.test(read("components/recite-sheet/recite-sheet.js")));

  // 3) 预览那张替身也得跟：它手抄了通用设置页的版式，
  //    漏改就是「演示里还有一枚开关、真机上没有」—— 反过来的假消息
  const previewPath = path.join(__dirname, "shots", "out", "preview.html");
  if (fs.existsSync(previewPath)) {
    const preview = fs.readFileSync(previewPath, "utf8");
    ok("预览页里那枚开关也没了（预览不是另一份真机）",
      preview.indexOf("背完自动下一首") < 0,
      "预览是旧的那一份，重跑一次 node scripts/shots/render.js");
  }
}

/* ---------- V38. 用户可见的文案不许提「数据存在哪」（Issue #49 → PR #58，2026-10-04） ----------
 *
 * 用户原话：
 *   「为什么叫 本机数据，没有人关心或者需要知道这个数据在本机还是云端，
 *     你显示这个对用户来说完全不可理解。排查所有类似的问题，这是微信小程序场景。」
 *
 * 他说的是文案，不是某个页：`本机 / 云端 / 服务端 / 后端 / 离线缓存` 这类词
 * 是**实现词汇**——它们描述数据放在哪，而用户的问题是「我背得怎么样、
 * 换手机还在不在」。把实现词汇写进界面，等于要求用户先懂这套架构再看懂自己的屏。
 *
 * 守法是全站扫一遍**用户可见的字符串**：
 *   · wxml 里的文本节点（注释先摘掉 —— 注释里正引着旧文案，V26 踩过这个坑）
 *   · js 里的字符串字面量（同样先摘注释）
 * 命中这几个词就红。它们仍然可以出现在注释、文档、以及 `utils/` 的实现里 ——
 * 那是给我们自己看的，用户看不到。
 *
 * 允许的例外只有一处：**隐私说明里如实交代数据只在这台手机上**。
 * 那不是实现词汇，是用户有权知道的事实（不登录不会外发），所以白名单放行。
 */
{
  const BAD = ["本机", "云端", "服务端", "后端", "离线"];
  // 隐私说明那一句是「用户有权知道的事实」，不是实现词汇 —— 单独放行
  const ALLOW = ["背诵进度与设置默认只存在这台手机上"];

  /** 摘掉注释：块注释、行注释、wxml 注释 */
  const strip = (src) =>
    src
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  /** wxml：所有标签之间的文本节点 */
  const wxmlText = (src) =>
    strip(src)
      .replace(/<[^>]*>/g, "\u0000")
      .split("\u0000")
      .join(" ");

  /** js：单引号与双引号字符串字面量。**不许跨行** —— 松着写会把首尾引号配成一对、
      把整段代码当成一个字符串，判据就瞎了。 */
  const jsStrings = (src) => {
    const out = [];
    const re = /"([^"\\\n]*)"|'([^'\\\n]*)'/g;
    let m;
    while ((m = re.exec(strip(src)))) out.push(m[1] !== undefined ? m[1] : m[2]);
    return out;
  };

  const hits = [];
  (function walk(dir) {
    fs.readdirSync(dir).forEach((f) => {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) return walk(full);
      const rel = path.relative(ROOT, full);
      let texts = [];
      if (f.endsWith(".wxml")) texts = [wxmlText(fs.readFileSync(full, "utf8"))];
      else if (f.endsWith(".js")) texts = jsStrings(fs.readFileSync(full, "utf8"));
      else return;
      texts.forEach((t) => {
        if (ALLOW.some((a) => t.indexOf(a) >= 0)) return;
        BAD.forEach((w) => {
          if (t.indexOf(w) >= 0) hits.push(rel + " · " + w + " · " + t.slice(0, 40));
        });
      });
    });
  })(ROOT);

  ok("界面文案里不再出现「本机 / 云端 / 服务端 / 后端 / 离线」这些实现词汇",
    hits.length === 0,
    "命中：" + hits.slice(0, 5).join(" | "));

  // 逐条点名那几处用户直接问到的位置，免得哪天被「挪到别处」绕过
  {
    const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
    const mineWxml = read("pages/mine/mine.wxml");
    const mineJs = read("pages/mine/mine.js");
    const aboutWxml = read("packages/settings/about/about.wxml");

    ok("「我的」页那张卡的标题不再叫「本机数据」（它答的是「我背得怎么样」）",
      /class="card-title bar">背诵概况</.test(mineWxml) || mineWxml.indexOf("本机数据") < 0);
    ok("「我的」页那一行不再叫「云端同步」（用户要的是「换手机还在不在」）",
      mineWxml.indexOf("云端同步") < 0 && /同步进度/.test(mineWxml));
    ok("「清空本机数据」改口成「清空背诵数据」（清的是内容，不是存储位置）",
      /清空背诵数据/.test(mineWxml) && mineWxml.indexOf("清空本机数据") < 0);
    // 注释里正引着旧文案，先摘掉再判（V26 踩过同一个坑）
    /* ⚠️ 这一段守的是「副标题答的是用户的问题：换手机还在不在」。
       判据两次跟着实现走，两次都没放松：

         · 最早它只认 `换手机进度不跟随` 这一句 —— 而 Issue #121 之后，
           没接上服务器与没登录是**两句话**（点多少下都不会好的那种，
           写在「换手机进度不跟随 · 点一下重试」里就是骗人）。
         · 于是判据换成「答的是跟随与否」这层意思：副标题里必须有
           `换手机` 或 `跨设备`，`点一下重试` 不许出现在**没接上服务器**那一支里。

       实现那一半在 `mine.js` 的 `syncNote()`：`!sy.ready` 时按
       「没登录 / 云调用没填 / 压根没配」分开说，正常时才说「还没同步过 · 点一下同步」。 */
    const mineJsCode = mineJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const syncNoteFn = /syncNote\(sy\)\s*\{([\s\S]*?)\n  \},/.exec(mineJsCode);
    ok("同步那一行的副标题答的是「换手机还跟不跟随」（不是「后端就绪没」）",
      !!syncNoteFn && /跨设备|换手机/.test(syncNoteFn[1]) && mineJsCode.indexOf("后端未就绪") < 0,
      "副标题里既没有「换手机」也没有「跨设备」，用户读不到自己真正关心的那件事");
    /* 没接上服务器时那句**不许**暗示「点一下就能好」—— Issue #121 的痛点
       正是「点一下就提示已登录、而库里什么都没有」。 */
    ok("没接上服务器时，副标题不许写成「点一下重试」",
      !!syncNoteFn && /没接上同步服务器|同步服务器没接上|同步通道未开/.test(syncNoteFn[1]),
      "那一支还在说「点一下重试」—— 没接上服务器时点多少下都不会好");
    ok("「关于」页那一段标题不再叫「本机记录」",
      aboutWxml.indexOf("本机记录") < 0 && /背诵记录/.test(aboutWxml));
    ok("登录成功不再提「本机身份」（用户看不懂，也不必懂）",
      mineJs.indexOf("本机身份") < 0 || !/title: *"[^"]*本机身份/.test(mineJs));
    ok("头像来源不再说「本机设置的头像」/「本机头像」（说「自己设的」就够）",
      mineJs.indexOf("本机设置的头像") < 0 && mineJs.indexOf("本机头像") < 0);

    // 隐私说明那一句要留着 —— 上面把它放进白名单，这里确认它没被顺手删掉，
    // 否则「不登录不会外发」这件事就没处说了
    const aboutJs = read("packages/settings/about/about.js");
    ok("隐私/协议里那句「默认只存在这台手机上」还在（用户有权知道）",
      /只存在这台手机上/.test(aboutJs));
  }
}

/* ---------- V39. 头像只有一个来源、一处入口（Issue #12 → #111） ----------
 *
 * 这一节的前身守的是「那条『头像 ｜ … ｜ [换头像] [用微信头像]』的行撤掉」，
 * 以及「退回微信那张」那个动作还在副题上（自己传过一张的人才看得到）。
 *
 * Issue #111 之后**没有「自己传的那张」这回事了** —— 用户原话：
 *   「直接使用小程序微信账号的头像吧，不要再提供用户自己上传头像的功能了」。
 * 于是：
 *   · 「退回微信那张」这个动作**随之退场**：没有可退的东西了
 *   · 副题不再解释「这张哪来的」：只有一个来源，说来源等于说一句用户不必懂的话
 *   · 头像圆仍是唯一的入口（`chooseAvatar`），但它现在给的就是微信那张
 *
 * 这一节守的就是这三件，外加「别把上传通道偷偷加回来」。
 */
{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const mineWxml = read("pages/mine/mine.wxml");
  const mineWxss = read("pages/mine/mine.wxss");
  const mineJs = read("pages/mine/mine.js");

  // 1) 那一行整个撤掉：WXML 里不再有 .avatar-row，样式也不留孤儿
  ok("「我的」页不再有「头像」那一行（.avatar-row 已撤）",
    mineWxml.indexOf("avatar-row") < 0 && mineWxss.indexOf(".avatar-row") < 0,
    "那一行还在，或者样式留下了孤儿");
  // 先摘掉 WXML 注释：里面的说明正引着「换头像」这个词（V26 踩过同一个坑）
  const mineWxmlBare = mineWxml.replace(/<!--[\s\S]*?-->/g, "");
  ok("那一行里的「换头像」按钮也没了（它点的是同一件事）",
    mineWxmlBare.indexOf("换头像") < 0, "换头像按钮还在，与头像圆重复");

  // 2) 头像圆是唯一的入口：chooseAvatar 挂在它身上
  ok("头像圆就是选头像的入口（chooseAvatar 挂在它身上）",
    /class="avatar-btn"\s+open-type="chooseAvatar"/.test(mineWxml)
      && /bindchooseavatar="onAvatarChoose"/.test(mineWxml),
    "头像圆不再是入口了，头像无处可点");

  /* 3) 「退回微信那张」整个退场。它原来存在的理由是「用户自己传过一张，
     现在想换回微信那张」—— 没有「自己传的那张」，这个动作就没有对象。
     留着它，用户点下去会发现什么都不变（本来就已经是微信那张）。 */
  ok("「用微信头像」那个动作已撤（没有可退的东西了）",
    mineWxml.indexOf("identity-revert") < 0 && mineWxss.indexOf(".identity-revert") < 0
      && mineJs.indexOf("onAvatarClear") < 0,
    "「用微信头像」还在 —— Issue #111 之后没有「自己传的那张」，它点了不会有任何变化");

  /* 4) 副题不再解释「这张头像哪来的」。
     ⚠️ 说法要落在「已登录」上，不是「微信头像」那句解释 ——
     后者在 V38 里是「实现词汇」的近亲（说的是这张图从哪个系统来的，
     而不是「我是谁」）。副题答的只有一件事：我登录了没有。 */
  ok("副题只说「我是谁」（不再解释这张头像哪来的）",
    /已登录 · 微信账号/.test(mineJs) && mineJs.indexOf("还没有头像") < 0,
    "副题还在解释头像来源 —— 只有一个来源，说来源是用户不必懂的话");
  ok("未登录时副题仍是「未登录」（不是「已登录 · …」）",
    /!profile\.logged[\s\S]{0,80}"未登录"/.test(mineJs));

  /* 5) **反向**：别把上传通道偷偷加回来。
     这一条是这个节里最重要的一条 —— Issue #111 的得失全在这儿：
     一旦有人重新引入「上传到某个地方」，就又要养一份对象存储。 */
  {
    /* ⚠️ 判据要**按函数体**取，不能从 `onAvatarChoose` 往后数 N 个字符 ——
       后面紧跟着的 `onNickname` 里就有 `markDirty`（昵称该同步），
       数长了会把它算到头像头上（这条第一版就是这么假红的）。 */
    const body = (() => {
      const i = mineJs.indexOf("onAvatarChoose(");
      if (i < 0) return "";
      const j = mineJs.indexOf("\n  },", i);
      return j < 0 ? mineJs.slice(i) : mineJs.slice(i, j);
    })();
    ok("头像的入口函数在（点它选微信那张）", !!body, "没找到 onAvatarChoose");
    ok("头像不上传（选完不调 markDirty，也不走任何上传接口）",
      !!body && body.indexOf("markDirty") < 0 && !/uploadFile|\/api\/avatar/.test(body),
      "选完头像还去 markDirty / 传文件 —— 那就要为它养一份对象存储（Issue #111 要的正是别养）。" +
        "函数体：" + body.replace(/\s+/g, " ").slice(0, 160));
    // 摘注释：上面那段解释里正引着 `/api/avatar/` 这个反面例子
    const bareJs = mineJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok("整个小程序端没有上传头像的接口调用",
      !/wx\.uploadFile|\/api\/avatar/.test(bareJs),
      "还留着上传头像的路 —— 那就是又回到「要一份对象存储」");
  }
}

/* ---------- V40. 内容口径与网页版对账（Issue #61，2026-10-06 / 2026-10-09） ----------
 *
 * 用户原话（两轮，同一句）：
 *   「最近一周内，在 /poem 代码库中，我添加了一些宋词和古诗，也把一些内容
 *     分类错误，还有缺失朝代问题进行了修复，请查看代码库的 PR, commits，
 *     将这个小程序应用中的内容也进行同样的更新」
 *   「最近一周内，在 /poem 代码库中，我更新了很多古诗，古文等内容，也把修正了
 *     一些诗文来源错误，请查看代码库的 PR, commits，将这个小程序应用中的内容
 *     也进行同样的更新」
 *
 * 语料一直是从 poem 仓库现编译的（scripts/build-data.js），所以「同样的更新」
 * 不是搬数据、而是**把口径钉死**。这一节守的就是那几件离开语料就看不见的事：
 * 篇数、号段、归位、朝代、出处、异名。
 *
 * ## 对的是哪几个提交
 *
 * 第一轮（2026-10-06，Issue #461 / #471 / #480）：
 *   宋词 10 + 词 3 + 古诗 10 + 唐诗 11 + 词 5 六轮补录；
 *   曹植《七步诗》从《唐诗》归位《古诗「非唐代」》；《昭明文选》145 条空朝代
 *   回填；作者索引从搜索页进。
 *
 * 第二轮（2026-10-09，Issue #505 / #510 / #512 / #516 / #517）—— 这一轮量大：
 *   · **补录**：《古文》13 + 18 篇（#517）、古诗 50 + 20 篇（#516）、
 *     初中课内古诗 21 篇（#510）、古文 16 篇与古诗 7 首（#505 末批）、
 *     古文 20 + 23 + 15 篇（#505 一至三批）、杨万里 / 苏轼 / 刘禹锡四题（#471）
 *   · **出处勘正**（#512）：唐诗 318 + 昭明文选 480 + 词 288 + 曲 31 条从
 *     「选本」改记**所出之书**（`source` 与 `selection` 两重出处）；成语 6 则
 *     从后人二手书改到所出之书；小古文 4 条同类勘正
 *   · **朝代归位**（#512）：成语 138 条按「故事发生在什么时候」归位（原先按
 *     **书**填，同一部书里自相矛盾）；小古文朝代写法归一 10 条
 *   · **题名异写**（#516）：11 条补 `aliases`（《秋登万山寄张山》又名
 *     《秋登兰山寄张五》这一路），详情页标题底下补一句「又名」
 *   · **合并勘误**（#516 第二批）：张俞《蚕妇》与陆游《游山西村》、赵翼
 *     《论诗》与龚自珍《己亥杂诗》原先被误合成一篇，各自拆开了
 *
 * 两端 `author-index.js` 的 `ERAS` / `ALIAS` 表放一起比，对不上就报红。
 *
 * ## 为什么这里是一张会过期的快照，而不是「跟着语料走」
 *
 * 篇数写在下面这张 K 里。它**一定会过期** —— 下次补录就得来改。这正是要的：
 * 网页版补了十篇、这边一声不响地也冒出十篇，没人知道这一轮到底同步了没有；
 * 而写死之后，语料变了这边立刻红，逼着人回来对一次。
 * 所以判据分四段：
 *   1. 篇数与 K 对得上（**要跟着语料改的**）
 *   2. 号段不出现空洞（**补录时最容易断的那根线**）
 *   3. 归位 / 朝代是一组语义不变量（**这几轮修的就是它们**）
 *   4. 出处两重对得上（**#512 那一轮的核心**）—— 选本条目必须同时有
 *      `source`（所出之书）与 `selection`（收它的选本），少一样就是没同步
 */

const K = {
  /* 十七部集子的篇数。与 poem 网页版 README「内容」那一节同一份读数。
     ⚠️ 这一轮（2026-10-10）对的是 Issue #539：poem 按用户点名补录
     `gw-288` 王安石《答司马谏议书》（有正文、非课内、非词条壳），
     于是 classic / cards / withText 三个数**一起 +1**（286→287、
     5603→5604、5854→5855）。号段与出处两重不受影响（它不记 `selection`，
     正文也没有新接号）。 */
  counts: {
    poems: 251, classic: 287, yuefu: 103, tangshi: 433, gushi: 113, songci: 330,
    yuanqu: 31, guwen: 234, jinxiandai: 24, zhaoming: 480,
    chengyu: 948, changshi: 221, mingshu: 808,
    mingren: 392, "mingren-waiguo": 523, dwang: 609, "dwang-waiguo": 68
  },
  /* 课外十六部合计（含词条类的成语 / 常识 / 名著 / 名家 / 帝王） */
  cards: 5604,
  /* 带正文的条目数 —— 词条类集子里有「有壳无文」的条目，所以比 cards 少 */
  withText: 5855,
  /* 号段：集内编号从 1 连到 max，不允许断号。
     gushi / songci 的号是补录接出来的，断一处就是漏一篇。
     ⚠️ 这三个 max 是这一轮（#505 / #510 / #516）补录接出来的新号。 */
  seqMax: { gushi: 126, songci: 331, tangshi: 469 },
  /* 分片与包内的分配 */
  course: 251,
  buckets: 120,
  /* #512 那一轮的选本条目数 —— 这些条**必须**同时有 source 与 selection。
     数与 poem 各集子文件里 `selection:` 的出现次数同源（唐诗把课本篇目那几条
     的 selection 去掉了，所以 433 条里 337 条有，不是全有）。 */
  selection: { tangshi: 337, songci: 288, yuanqu: 31, zhaoming: 480 }
};

/* 拿 1..max 与集内实际编号比一比。
   条目 id 是 `<集子>-<号段前缀><号>`：`gushi-gs-54`、`songci-sc-331`、
   `tangshi-ts-387`，也有零填充的 `gushi-gs-01`。取**最后一段数字**即可 ——
   集子 id 自己也可能带数字（`poems-cz8-13`），所以不能从头取。 */
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
  // 1) 篇数。这一张表会过期，过期就红 —— 见本节开头
  Object.keys(K.counts).forEach((id) => {
    ok("篇数对得上网页版 · " + id, perBook[id].length === K.counts[id],
      "语料 " + perBook[id].length + "，表里写 " + K.counts[id] + "（补录之后回来对一次）");
  });

  ok("课外十六部合计 " + K.cards + " 条",
    allEntries.length - perBook.poems.length === K.cards,
    "实际 " + (allEntries.length - perBook.poems.length) + " 条，表里写 " + K.cards);

  const withText = allEntries.filter((p) => courseTexts[p.id] || manifest.map[p.id]).length;
  ok("带正文的条目 " + K.withText + " 条", withText === K.withText, "实际 " + withText);
  ok("课内正文进包 " + K.course + " 条", Object.keys(courseTexts).length === K.course,
    "实际 " + Object.keys(courseTexts).length);
  ok("正文分片 " + K.buckets + " 个", manifest.buckets.length === K.buckets,
    "实际 " + manifest.buckets.length);

  // 2) 号段不许出现**新的**空洞。
  //
  //    先别把「连号」当判据 —— 语料里本来就有洞，而且是有理由的：
  //    gs-02/03/04 是《诗经》里与课内重了的篇目、sc-127 并进了别的号、
  //    ts-306/307 是搬家留下的空位、ts-360–365 是《唐诗三百首》原本就没收的几首。
  //    这一段能判的是**补录时最容易断的那根线**：接号接到一半漏一篇，
  //    列表页只按次序铺，少一篇根本看不出来 —— 只有号会露馅。
  //    ⚠️ 新补录会往后加号（不填空洞），所以要改的是下面这张表：
  //    这一轮真的把某个洞补上了，就把它从表里删掉。
  const KNOWN_HOLES = {
    gushi: [2, 3, 4, 9, 12, 23, 33, 89, 90, 91, 92, 122, 124],
    songci: [127],
    /* ts-306/307 是搬家留下的空位、ts-360–365 是《唐诗三百首》原本就没收的几首。
       ts-395–401 / 419 / 427–442 / 466–467 是 #505 / #510 / #516 几批补录
       接号时**成段让出来的号**（同名语料撞号后合并、或某批整段落到了别的集子），
       不是漏篇 —— 每一批的来由记在 poem 的 scripts/data/poems-corpus-*.js 里。 */
    tangshi: [305, 306, 307, 360, 361, 362, 363, 364, 365, 366, 367,
      395, 396, 397, 398, 399, 400, 401, 419,
      427, 428, 429, 430, 431, 432, 433, 434, 435, 436, 438, 439, 440, 441, 442,
      466, 467]
  };
  Object.keys(K.seqMax).forEach((book) => {
    const miss = gapped(perBook[book], K.seqMax[book]);
    const known = KNOWN_HOLES[book] || [];
    const fresh = miss.filter((n) => known.indexOf(n) < 0);
    ok(book + " 号段 1–" + K.seqMax[book] + " 没有新空洞", fresh.length === 0,
      "新缺 " + fresh.slice(0, 8).join(",") + " —— 补录接号时漏了？断了页面上看不出来");
    // 反过来也要守：原来记着的洞真被补上，就把表里那一格删掉，
    // 不然这张表会越攒越大，最后没人敢动
    const patched = known.filter((n) => miss.indexOf(n) < 0);
    ok(book + " 记着的空洞没有悄悄补上（补上了就回来删）", patched.length === 0,
      "已补上 " + patched.join(",") + " —— 从 KNOWN_HOLES 里删掉");
  });

  // 3) 归位：曹植《七步诗》是三国魏人，古今任何一部《唐诗三百首》都没有它。
  //    这一条 2026-10-06 之前是错的（挂在《唐诗》卷七），修完之后两头都不能再出现
  const qb = allEntries.filter((p) => p.t === "七步诗");
  ok("《七步诗》只此一条", qb.length === 1, "实际 " + qb.length + " 条 —— " +
    qb.map((p) => p.id).join("、"));
  ok("《七步诗》在《古诗「非唐代」》", qb.length === 1 && qb[0].b === "gushi");
  ok("《七步诗》朝代是三国·魏（不是唐）", qb.length === 1 && qb[0].d === "三国·魏",
    "实际「" + (qb[0] || {}).d + "」");

  /* 《唐诗》里不许再有**三国魏人**。
     ⚠️ 判据是「没有三国魏人」，**不是**「每一条都写着唐」—— 这一条 2026-10-09
     改过口径。原先写的是后者，被 #516 第二批补的杨万里《闲居初夏午睡起·其一》
     （`tangshi-ts-390`）撞红。那一条**不是错**：《唐诗》卷七至卷十本就是这部
     集子的「课内 / 课外通用名篇」段（ts-316 之后既有唐人的《竹枝词》，也有
     后来的篇目），用户点名要收，就按这一段的老例挂在卷七 —— 正文与《古诗
     「非唐代」》gs-55 同文，判重表把两条合成一篇。
     所以真正要守的是「**非唐人**不许混进唐代那一批」，而那一条的排除名单是
     「三国魏人」这一类**朝代明显不对**的（曹植就是被它抓出来的）。
     宋人杨万里是那一段的既定成员，放行。 */
  const WEI3 = ["三国·魏", "三国魏", "三国", "东汉末三国"];
  const weiInTang = perBook.tangshi.filter((p) => WEI3.indexOf(String(p.d).trim()) >= 0);
  ok("《唐诗》里再没有三国魏人", weiInTang.length === 0,
    "混进了 " + weiInTang.map((p) => p.t + "(" + p.d + ")").join("、"));
  /* 反过来也守：非唐的条目只能是**通用名篇那一段**里点名的那些。
     语料里非唐的只有 ts-390 一条（杨万里），它记在 KNOWN_NON_TANG 里；
     哪天又多出一条，就该回来看看是不是又混进了唐人之外的人。 */
  const KNOWN_NON_TANG = { "tangshi-ts-390": 1 };
  const nonTang = perBook.tangshi.filter((p) => String(p.d).trim() !== "唐");
  const freshNonTang = nonTang.filter((p) => !KNOWN_NON_TANG[p.id]);
  ok("《唐诗》里非唐的条目只有记着的那几条", freshNonTang.length === 0,
    "新出现 " + freshNonTang.map((p) => p.id + " " + p.t + "(" + p.d + ")").join("、") +
    " —— 是通用名篇那一段收的，还是真混进来了？");
  const goneNonTang = Object.keys(KNOWN_NON_TANG).filter((id) => !nonTang.some((p) => p.id === id));
  ok("记着的非唐条目没有悄悄消失（没了就回来删）", goneNonTang.length === 0,
    "已不见 " + goneNonTang.join("、"));

  /* 收**作品**的十部。判据与网页版 data/author-index.js 的 LIT_BOOKS 同一条：
     其余五部（名家 / 帝王 / 文学常识 / 名著 / 成语）里「作者」是词条本身，
     「朝代」常是文明名而不是王朝，两栏都不走这条口径。 */
  const litBooks = ["poems", "classic", "guwen", "yuefu", "tangshi", "gushi",
    "songci", "yuanqu", "jinxiandai", "zhaoming"];

  // 4) 朝代：全站不许有空朝代。《昭明文选》那 145 条曾经是空串，
  //    列表页会少一段元信息（「· 谢灵运 · 《文选》」），搜索也筛不出来
  const emptyDyn = [];
  litBooks.forEach((id) => {
    perBook[id].forEach((p) => {
      if (!String(p.d || "").trim()) emptyDyn.push(p.id + " " + p.t);
    });
  });
  ok("收作品的十部集子里没有空朝代", emptyDyn.length === 0,
    emptyDyn.length + " 条 —— " + emptyDyn.slice(0, 5).join("；"));

  // 《文选》那 145 条一位作者只能落一个朝代，否则同一个人在作者索引里会
  // 散成两段。这条钉的是「按作者裁定」这个做法本身
  const zmByAuthor = {};
  let collided = 0;
  perBook.zhaoming.forEach((p) => {
    if (!p.a) return;
    if (zmByAuthor[p.a] === undefined) zmByAuthor[p.a] = p.d;
    else if (zmByAuthor[p.a] !== p.d) collided += 1;
  });
  ok("《昭明文选》同一位作者只落一个朝代", collided === 0, collided + " 处冲突");

  // 5) 两端作者索引的朝代时间轴
  //
  //    这一条查的是**这个仓库之外**的文件：poem 那边改了 ERAS（多一朝 / 改一段），
  //    这边会悄悄摆错顺序 —— 而 CI 里刚 clone 了一份 poem，正好能拿来比。
  //    拿不到就跳过（本地没设 POEM_WEB_DIR 的时候），别把「比不了」说成「比过了」。
  const webDir = process.env.POEM_WEB_DIR || "/tmp/poem";
  const webAuthor = path.join(webDir, "data", "author-index.js");
  const miniAuthor = path.join(ROOT, "utils", "author-index.js");

  if (!fs.existsSync(webAuthor) || !fs.existsSync(miniAuthor)) {
    console.log("· 作者索引时间轴没得比（" +
      (fs.existsSync(webAuthor) ? "小程序端" : "poem 那边") +
      "的 author-index.js 不在，或还没设 POEM_WEB_DIR）—— 跳过两条");
  } else {
    const erasOf = (src) => {
      // 网页版是 IIFE 里的 `  var ERAS = [`（两格缩进收尾），小程序端是模块级
      // 的 `const`。两种都认 —— 只认一种，另一半就静默变「抠不出来」
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

    /* ⚠️ ALIAS 也得比 —— 这一段是**补来的**。
       V40 第一版只比了 ERAS，理由写在注释里：「ALIAS 是一串人名字符串，
       抠它的正则比它要守的东西还脆」。可代价立刻出现：poem 那边给《文选》
       补了十条异名（`桓元子 → 桓温`、`任彦升 → 任昉`……），这边一声不响地
       落后了十条 —— 名册上于是有两位「桓温」和「桓元子」、「任昉」和
       「任彦升」，各自挂着一半作品。
       正则其实不难写：值那一栏也是 quoted string。所以补上。 */
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
      /* 判据是**双向差集都空**，不是「条数相等」——
         一条改错、一条漏掉时总数可能正好一样，只看条数会一路绿灯 */
      const miss = Object.keys(wa).filter((k) => !(k in ma));
      const extra = Object.keys(ma).filter((k) => !(k in wa));
      const diff = Object.keys(wa).filter((k) => k in ma && wa[k] !== ma[k])
        .map((k) => k + "：网页版→" + wa[k] + "／小程序→" + ma[k]);
      ok("异名表与网页版逐条一致（" + Object.keys(wa).length + " 条）",
        miss.length === 0 && extra.length === 0 && diff.length === 0,
        "网页版多：" + miss.join("、") + "；小程序多：" + extra.join("、") + "；对不上：" + diff.join("、"));
    }

    /* ⚠️ `ATTRIB` 也得比 —— 这一段是**第二轮补来的**，与 ALIAS 落后是同一个教训。
       #480 第三轮网页版给 `classic-gw-10`《古人谈读书》加了归属裁定（正文两段
       两家，名册里挂朱熹），那一轮这边只搬了 ERAS / ALIAS 两张表，
       **没搬 ATTRIB** —— 于是「古人谈读书」这一条在名册上归属不同：
       网页版挂朱熹，这边还在「孔子及弟子、朱熹」那一串里拆不开。
       抠法与 ALIAS 同源：值那一栏是 `{ person: "x", dynasty: "y" }`。 */
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
    ok("两端的合编归属表抠得出来（ATTRIB）", !!wt && !!mt, "ATTRIB 表没匹配上，正则要跟着改");
    if (wt && mt) {
      const atMiss = Object.keys(wt).filter((k) => !(k in mt));
      const atExtra = Object.keys(mt).filter((k) => !(k in wt));
      const atDiff = Object.keys(wt).filter((k) => k in mt && wt[k] !== mt[k])
        .map((k) => k + "：网页版→" + wt[k] + "／小程序→" + mt[k]);
      ok("合编归属与网页版逐条一致（" + Object.keys(wt).length + " 条）",
        atMiss.length === 0 && atExtra.length === 0 && atDiff.length === 0,
        "网页版多：" + atMiss.join("、") + "；小程序多：" + atExtra.join("、") + "；对不上：" + atDiff.join("、"));
    }
  }

  // 6) 归一的表得认得全：收作品的十部里每一个朝代写法都要落在那条时间轴上。
  //    **认不出的写法不会报错** —— 它只是悄悄排到最后一页（「其他」）去，
  //    那种错没人看得见，所以要在这儿拦一次
  const AI = require(path.join(ROOT, "utils", "author-index.js"));
  ok("认不得的朝代写法回落到最末一段（不静默丢掉）",
    AI.eraOf("__探针__") === AI.TAIL,
    "eraOf 对表外写法返回了 " + AI.eraOf("__探针__"));
  // 只查**收作品的那十部**：词条类集子的「朝代」是「古罗马」「两河」「古埃及」
  // 这种文明名，本来就不在王朝时间轴上（网页版作者索引也只收这十部，
  // 见 data/author-index.js 的 LIT_BOOKS）。拿它们来判，红一片红得没道理
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

  // 7) 结集那一条：作者一格填书名的四条不许被当成「一位作者」。
  //    并在人名册里就变成「《礼记》写了《大学之道》」——那是编
  //    这四条**本来就该在语料里**（各自集子的列表页读得到，一个字不丢），
  //    要守的是「它们别被当成一位作者」—— 网页版作者索引把它们剔出人名册，
  //    `isCollective()` 就是这道判据。所以断言写成「认得出」，不是「不许有」
  //    判据是**书名号包着整个作者名**（`《礼记》`），不是「名字里带书名号」——
  //    帝王卷有「传说时代（《山海经》至上神）」这种，书名号只在括号里
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

  /* 8) 出处：**两重**（Issue #512）—— `source` 写所出之书，`selection` 记选本。
     这一轮网页版把《唐诗》318 条、《昭明文选》480 条、《词》288 条、《曲》31 条
     的出处从「选本」改记成**所出之书**，两重并列。

     ⚠️ 判据是「**该有的都得在**」，不是「条数相等」：
     这两栏的存在与否正是「同步了没有」的读数 —— 网页版改了 337 条，
     这边仍是 0 条（`build-data.js` 原先根本没搬 `selection`），
     界面上看着都对，只是第二重出处没了。 */
  {
    const withSel = {};
    ["tangshi", "songci", "yuanqu", "zhaoming"].forEach((id) => {
      withSel[id] = (perBook[id] || []).filter((p) => String(p.sel || "").trim()).length;
    });
    Object.keys(K.selection).forEach((id) => {
      ok("选本出处搬全了 · " + id, withSel[id] === K.selection[id],
        "语料里 " + withSel[id] + " 条有 selection，表里写 " + K.selection[id] +
        " —— 多半是 build-data.js 没搬 `selection`（Issue #512）");
    });

    /* `source` 与 `selection` 不许**整部集子**都写成一样 ——
       #512 之前正是这个毛病：《昭明文选》那 480 条的 source 与 selection
       都是「《文选》」（选本条目一律把选本当所出之书），网页版把 source
       拆成了作者别集 / 总集（126 种），第二重才留在 selection。

       ⚠️ 判据是「**不是全一样**」，不是「一条都不许一样」：《曲》里
       9 条无散曲专集的曲家（白朴、关汉卿那一路）本就有意退到总集
       《全元散曲》—— 那是网页版 README 记着的口径，`source` 与
       `selection` 在那里确实同值，硬判「一条都不许」会红得没道理。
       所以守的是「整部集子全一样」这个**没做拆分的信号**。 */
    Object.keys(K.selection).forEach((id) => {
      const rows = (perBook[id] || []).filter((p) => p.s && p.sel);
      const allSame = rows.length > 0 && rows.every((p) => p.s === p.sel);
      ok(id + " 的两重出处真的拆开了（" + rows.length + " 条）", !allSame,
        id + " 的 source 与 selection **每一条都相同** —— 多半是没搬 #512 那次拆分");
    });

    /* 反过来：选本条目**不许**只有 selection 没有 source —— 那样身份行上
       那一段就成了空的，看着像「这首诗没出处」 */
    const selNoSrc = [];
    Object.keys(K.selection).forEach((id) => {
      (perBook[id] || []).forEach((p) => {
        if (String(p.sel || "").trim() && !String(p.s || "").trim()) selNoSrc.push(p.id);
      });
    });
    ok("有选本出处的条目都有所出之书", selNoSrc.length === 0,
      selNoSrc.slice(0, 5).join("、"));
  }

  /* 9) 题名异写（Issue #516）：`aliases` 是「同一个题名的另一种通行写法」，
     详情页标题底下补一句「又名」。11 条 —— 这一条守的是**别丢**：
     构建脚本漏搬 `aliases`（与 selection 同一个坑），界面上少一句话，
     谁也不会发现。 */
  {
    const withAka = allEntries.filter((p) => p.aka);
    ok("题名异写搬进来了（" + withAka.length + " 条）", withAka.length >= 11,
      "只有 " + withAka.length + " 条有 alias —— 构建脚本里的 `aka` 没搬？");
    /* 至少这几条是点名要的（poem 那边 #516 逐条记着），漏一条就该回来对 */
    const want = ["秋登万山寄张五", "秋浦歌", "燕歌行并序", "燕歌行·并序",
      "山中送别", "赠范晔诗"];
    const got = withAka.map((p) => p.t);
    const miss = want.filter((t) => got.indexOf(t) < 0);
    ok("点名的那几条题名异写都在", miss.length === 0, "少了：" + miss.join("、"));
  }
}

/* ---------- V41. 作者索引（Issue #480 / #61，2026-10-06） ----------
 *
 * 用户原话：
 *   「搜索大类功能，增加作者作品索引页，按时间朝代顺序，将中国所有作品的
 *     作者列在一页，上面是朝代索引列表，点击朝代可以下面的具体朝代，
 *     朝代下面是各个作者，例如唐代 李白，点击李白，显示李白所有作品列表，
 *     再点击列表，进入详情页，详情页的上一页下一页都是该作者的作品。
 *     返回就回到李白列表。」
 *
 * 上一轮（V40）钉的是**内容口径**：语料跟网页版对不对得上。
 * 这一轮钉的是**这一页本身**——名册从语料里现算，算错了没人看得见：
 * 一个作者被拆成两处、一位作者的作品数少了几条、名册里混进一本书的名字，
 * 三条都不会报错，只是摆得不对。所以逐条守：
 *
 *   1. 名册的**总量**（488 位 / 2019 条）—— 与网页版 `AuthorIndex.people()` 同量级
 *   2. 收的是哪十部（LIT_BOOKS）—— 多收一部，名册就从 488 涨到 2300
 *   3. 异名归一真的合并了（曹子建 → 曹植、班孟坚 → 班固）
 *   4. 结集不进名册（《礼记》《论语》《国语》《战国策》）
 *   5. 判重：课内背过的，在《唐诗》里那条壳不进名册
 *   6. 「下一篇只在这一位作者里走」—— 这一条真跑阅读页
 */
{
  const AI = require(path.join(ROOT, "utils", "author-index.js"));
  const lit = AI.LIT_BOOKS;

  // 1) 收哪十部。与网页版 data/author-index.js 的 LIT_BOOKS 同一份名单 ——
  //    多一部（例如 mingren），名册里就会冒出「李白」这个**词条**
  const wantLit = ["poems", "classic", "guwen", "yuefu", "tangshi",
    "gushi", "songci", "yuanqu", "jinxiandai", "zhaoming"];
  ok("作者索引收作品的十部（与网页版同一份名单）",
    lit.slice().sort().join(",") === wantLit.slice().sort().join(","),
    "实际 " + lit.join("、"));

  // 名册现算：把十部摊平喂给 AI.build()
  const litEntries = [];
  lit.forEach((b) => { if (perBook[b]) litEntries.push.apply(litEntries, perBook[b]); });
  const roster = AI.build(litEntries);

  // 2) 总量。这两个数是**会过期的**（与 V40 那张篇数表同一性质）：
  //    下次补录就得来改，改了跑绿才算真同步过。
  ok("名册收下 540 位作者", roster.total === 540,
    "实际 " + roster.total + " —— 补录之后回来对一次（名册是现算的，语料一变就变）");

  // 2.5) 与**网页版**的名册比一位。两端判重口径不同（那边按作品 id、
  //      这边只认课内），差的是**一位**：崔护 —— 他名下那首《题都城南庄》
  //      在《乐府集》《唐诗》《成语故事》三处各有一条，正文一字不差；
  //      那边并成一组后由《成语故事》胜出，而成语故事不在收作品的十部里，
  //      于是崔护整个人从名册上掉了。这边只判课内重复，他留下一首。
  //
  //      ⚠️ 这一条是**跨仓库**的（读 poem 那边现算的 AuthorIndex），
  //      拿不到就跳过 —— 不能把「比不了」说成「比过了」。
  {
    const webDir = process.env.POEM_WEB_DIR || "/tmp/poem";
    const webAuthor = path.join(webDir, "data", "author-index.js");
    if (!fs.existsSync(webAuthor)) {
      console.log("· 作者名册没得比（poem 那边 data/author-index.js 不在，或还没设 POEM_WEB_DIR）—— 跳过一条");
    } else {
      let webPeople = null;
      try {
        const vm = require("vm");
        /* 与 poem 自己的 scripts/build-works-map.js 同一份加载清单 ——
           少一个文件，AuthorIndex 拿到的 SITE_INDEX 就是缺的，
           算出来的名册会**安静地少几百位**，比出错更糟 */
        const loader = fs.readFileSync(path.join(webDir, "scripts", "build-works-map.js"), "utf8");
        const m = /const LOAD = \[([\s\S]*?)\];/.exec(loader);
        const list = m ? eval("[" + m[1] + "]") : [];
        const sb = { window: {}, console: console };
        sb.window = sb;
        vm.createContext(sb);
        list.forEach((f) => {
          try { vm.runInContext(fs.readFileSync(path.join(webDir, f), "utf8"), sb, { filename: f }); } catch (e) { /* 有的文件互有依赖，缺一个不影响名册 */ }
        });
        ["data/zhaoming-dynasty.js", "data/author-index.js"].forEach((f) => {
          try { vm.runInContext(fs.readFileSync(path.join(webDir, f), "utf8"), sb, { filename: f }); } catch (e) { /* 缺它就只有那几个数对不上，下面的断言会红 */ }
        });
        if (sb.window.AuthorIndex) webPeople = sb.window.AuthorIndex.people().map((p) => p.name);
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
        /* 判据写成**两边的差集各自都认得出**，不是「总数相等」——
           总数相等而差的是两个人（一个多一个少）时，
           只看总数会一路绿灯，而名册上已经错位了 */
        /* ⚠️ 这一条 2026-10-09 改过口径，**多出来的不止一位**了。

           原先只差崔护一位（网页版按作品 id 判重、这边只判课内重复）。
           第二轮补录之后两边又差出**五位**，而且都是同一个原因：
           网页版有 `WorksIndex`（全站作品主表），跨集重复能并成一篇；
           这边只判「课内有没有背过」。补录进来的篇目大多在**两处选集**
           里各有一条（例如王十朋《读〈岳阳楼记〉》在《古诗》与《古文观止》
           各一条），那边并成一组、这边各收一条，于是同一位作者在这边
           反而**多出作品**、人也就多冒出来几位。

           两个数都不是错，是两种判重口径的差：
             · 网页版 495 位（按作品 id 判重，跨集合并得更彻底）
             · 小程序 540 位（只判课内重复，课外选集之间的重复现不出来）
           差的那批人：多出来的是「只在课外两部选集里各有一条」的作者。
           钉住这个差值本身，是为了「哪天多出一位不在名单里的」时能当场看见。 */
        const KNOWN_ONLY_MINE = ["崔护", "刘歆", "庄周", "项羽", "王十朋", "杨基"];
        const freshMine = onlyMine.filter((n) => KNOWN_ONLY_MINE.indexOf(n) < 0);
        const patchedMine = KNOWN_ONLY_MINE.filter((n) => onlyMine.indexOf(n) < 0);
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

  // 3) 异名归一：这几位在两处选本里写法不同，必须并成一位
  const mergePairs = [
    ["曹子建", "曹植"], ["班孟坚", "班固"], ["屈平", "屈原"],
    ["谢玄晖", "谢朓"], ["诸葛孔明", "诸葛亮"], ["左太冲", "左思"]
  ];
  mergePairs.forEach((p) => {
    const w = roster.people[p[1]];
    ok("异名归一 · " + p[0] + " 并在 " + p[1] + " 名下", !!w,
      "名册里找不到「" + p[1] + "」—— 异名没并，或被拆成两位");
    // 并了之后这一位名下应当有《文选》里的条目 —— 那正是用异名的地方
    if (w) {
      const fromZm = w.items.filter((it) => it.b === "zhaoming");
      ok("异名归一 · " + p[1] + " 名下有《文选》条目", fromZm.length > 0,
        "0 条 —— 异名没并过来");
    }
  });
  // 反向：异名自己不许再单独立一位
  mergePairs.forEach((p) => {
    ok("异名不单独立位 · " + p[0], !roster.people[p[0]],
      "「" + p[0] + "」自己占了一格 —— 归一没生效");
  });

  // 4) 结集不进名册。作者一格填的是书名，挂上去就是「《礼记》写了《大学之道》」
  ["礼记", "论语", "国语", "战国策"].forEach((n) => {
    ok("结集不进名册 · " + n, !roster.people[n]);
  });
  // 这四条**本来就在语料里**，一个字都不丢 —— 守的是「还在」
  ["礼记", "论语"].forEach((n) => {
    const raw = litEntries.filter((p) => AI.aliasOf(p.a) === n);
    ok("结集条目仍在语料里 · " + n, raw.length > 0, "语料里一条都没有了");
  });

  // 5) 判重：课内背过的篇目，在选集里的那条壳不进名册。
  //    《静夜思》课内一首 + 《唐诗》一条 —— 名册上李白名下只该有一次
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
      ok("李白在名册里", false, "488 位里没有李白");
    }
  }
  // 反过来也守：课内没有的篇目**不许**被误判成重复。
  // 《乌夜啼》在《词》里有，课内没有 —— 它必须留下
  {
    const li = roster.people["李煜"];
    if (li) {
      ok("课内没有的篇目不被误判重复 · 李煜有作品", li.items.length > 0);
    } else {
      ok("李煜在名册里", false, "《词》里 30 余首的作者不在名册里");
    }
  }

  // 6) 朝代：名册上每一位都得落在一个**段**里，不能悬空。
  //    落不进去（eraOf 返回 TAIL 而 eras 里没有「其他」）的会静默消失 ——
  //    488 位里少几位，没人会数
  {
    const placed = roster.eras.reduce((n, e) => n + e.people.length, 0);
    ok("名册上每一位都落在某一段里", placed === roster.total,
      "摊开 " + placed + " 位，名册有 " + roster.total + " 位 —— 有人悬空");
    // 段名是归并后的（「宋」不是「北宋」），段里不许出现原写法当段名
    const rawNames = ["北宋", "南宋", "南朝宋", "东晋", "盛唐"];
    const bad = roster.eras.filter((e) => rawNames.indexOf(e.name) >= 0).map((e) => e.name);
    ok("段的标题是归并后的朝名（不是原写法）", bad.length === 0,
      "出现了原写法：" + bad.join("、"));
  }

  // 7)「上一篇 / 下一篇只在这一位作者里走」—— **真跑阅读页**。
  //    这一条是用户原话里最具体的一句（「详情页的上一页下一页都是该作者的作品」），
  //    而它跨了三个文件（搜索页 → 作者索引 → 阅读页），静态扫描看不出来。
  //    判据：同一位作者连翻五首，翻出来的每一首作者都是他；翻到头会回到
  //    作者列表（不跳到别的集子、不跨作者）。
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
      // 李白的第一首（作者索引里排在最前的那条）
      const libai = roster.people["李白"];
      if (libai) {
        let cur = mountReader({ id: libai.items[0].id, from: "李白" });
        ok("从作者索引进来时带上作者", cur && cur.data.creator === "李白",
          "creator=" + (cur ? cur.data.creator : "页面没挂上"));

        let hops = 0;
        const seen = {};
        let offAuthor = null;
        let offBook = null;
        while (hops < 5 && cur) {
          seen[cur.data.id] = 1;
          /* 判据有**两条**，缺一条就会漏：
             ① 作者还是他（`author` 对得上）
             ② 那一首属于**收作品的十部**之一

             只判①是不够的 —— 名册不收词条，但词条也有作者：
             《名家「中国」》里「李白」这一条、三条《成语故事》里的「李白」，
             作者一格都写着「李白」。所以下一首要是跳进了词条，
             ①照样绿。这一版真踩过：那一版扫的是 `corpus.books()`
             （全站十七部），李白第 77 首跳进了「chengyu-cy-458」，
             而断言一路放行。 */
          const authorOk = AI.aliasOf(cur.data.author) === "李白";
          const bookOk = lit.indexOf(cur.data.bookId) >= 0;
          ok("同一位作者的作品 · " + (hops + 1) + " 跳作者是李白",
            authorOk, "跳到了「" + cur.data.author + "」—— 跨作者了");
          ok("同一位作者的作品 · " + (hops + 1) + " 跳的是作品不是词条",
            bookOk, "跳进了「" + cur.data.bookId + "」—— 那不是收作品的十部");
          if (!authorOk) { offAuthor = cur.data.author; break; }
          if (!bookOk) { offBook = cur.data.bookId; break; }
          const next = cur.siblingInAuthor(1);
          if (!next) break;
          ok("同一位作者的作品 · 第 " + (hops + 1) + " 跳不回头",
            !seen[next], "又跳回了 " + next + " —— 上一篇 / 下一篇原地打转");
          cur = mountReader({ id: next, from: "李白" });
          hops += 1;
        }
        ok("同一位作者的作品 · 连翻五首不跨作者", !offAuthor,
          "第 " + (hops + 1) + " 首跑到了「" + offAuthor + "」");
        ok("同一位作者的作品 · 连翻五首不跳进词条", !offBook,
          "跳进了「" + offBook + "」");
        ok("同一位作者的作品 · 真的翻动了", hops > 0, "一次都没跳 —— 下一篇是空的");

        /* 「下一篇」的整条链必须与名册上这一位的作品**逐条同序**。
           只查五跳是不够的 —— 这一段真踩过：阅读页自己去十部里筛
           「作者名对得上」的条目，筛出 77 条；名册判重之后只收 60 条。
           前 35 条恰好一样，第 36 条起就错位了：用户翻着翻着，
           返回列表发现自己在列表里的位置很陌生。
           所以判据是**整条链**与名册逐条对齐，不是「翻五首没出事」。 */
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
        ok("同一位作者的作品 · 下一篇的整条链与名册同序（" + rosterIds.length + " 条）",
          chain.length === rosterIds.length && chain.every((id, i) => id === rosterIds[i]),
          "链条 " + chain.length + " 条，与名册对不上（名册 " + rosterIds.length + " 条）—— " +
          "多半是阅读页自己筛了一遍，没走名册那份判重");

        /* 阅读页把名册缓起来（`this.rosterCache`）—— 同一位作者连翻十首
           不该算十遍。缓存安全的前提是：**作品的 id 列表不随已读状态变**
           （判重看的是「课内有没有这一篇」，与读没读过无关）。
           不成立的话，用户读完一首再翻，下一篇就会跳到别处。 */
        {
          const rosterWithReads = AI.build(litEntries, { readIds: { [rosterIds[0]]: 1 } });
          const a = AI.worksOf(roster, "李白").join(",");
          const b = AI.worksOf(rosterWithReads, "李白").join(",");
          ok("作品的 id 列表不随已读状态变（阅读页的缓存靠这条）", a === b,
            "已读前后列表不一样 —— 缓存会让「下一篇」跳错");
        }

        // 反方向也要对（「上一篇」）
        const backChain = [];
        const seenBack = {};
        let bcur = rosterIds[rosterIds.length - 1];
        while (bcur && !seenBack[bcur]) {
          backChain.unshift(bcur);
          seenBack[bcur] = 1;
          const pg = mountReader({ id: bcur, from: "李白" });
          if (!pg) break;
          bcur = pg.siblingInAuthor(-1);
        }
        ok("同一位作者的作品 · 上一篇的整条链与名册同序",
          JSON.stringify(backChain) === JSON.stringify(rosterIds),
          "逆序链条与名册对不上");

        // 不带 from 的：还是原来那一条（同集子的下一首未读），不许串味
        const plain = mountReader({ id: libai.items[0].id });
        ok("从集子列表进来时不带作者", plain && plain.data.creator === "",
          "creator=" + (plain ? plain.data.creator : "?"));
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

  // 8) 入口在搜索页，不在课外阅读 —— 网页版第二轮的裁决（Issue #480）
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

/* ---------- V42. 会话契约（Issue #71，2026-10-09） ----------
 *
 * Issue #71 把「真打通微信登录还差的两步」写成了两条服务端待办 ——
 * 补 `/wx/login`、`/wx/refresh` 两条路由，会话解析同时认 Cookie 与 Bearer。
 * 但那两条只是**路由**，真正会让人查半天的是**契约**：报文形状、会话从哪儿
 * 取、过期了怎么办。契约写歪在半边，另一半改对了也不通。
 *
 * 这一节钉住客户端这半边，起因是四个各自静默的坏法 —— 都不会报错，
 * 只会让人在「我明明登录了」和「服务端说没登录」之间来回问：
 *
 *   1. **刷新时忘了带 device**。登录那一枚认得出是哪台机器，刷新换回来的
 *      不带 —— 服务端按 device 签会话、也按它限流，拿到空串就把同一台设备的
 *      刷新拆成无数个桶，限流形同虚设。报文少一个字段，没人看得出来。
 *   2. **401 直接报错**。`/api/wx/refresh` 平时只在启动时调一次，而用户把
 *      小程序挂在后台过夜是常事；第二天一点同步就是 401，界面写「同步失败」，
 *      用户唯一的出路是重新登录 —— 而双 token 这套东西存在的全部理由，
 *      就是不该这么干。
 *   3. **五个请求一起 401 就换五枚 token**。得有一个「同一时刻只刷一次」的口。
 *   4. **网页版同号的人永远拿不到档位**。本项目允许网页版与小程序同号，
 *      那人在浏览器里登录过、手机上有 Cookie，而小程序手里一枚 token 都没有 ——
 *      上一版 refresh() 第二行就 return 了，档位于是永远 free，
 *      而界面上没有任何一句话解释得清（见 wx-login-server.md「会话从哪儿取」）。
 *
 * ⚠️ 这一节**真的把 utils 跑起来**（造一个假 wx、手摇它的 request 回调），
 * 不是读源码数关键字。报文对不对、刷了几次、档位读不读得到，
 * 只有跑一遍才知道 —— 静态扫描会把「字段名写错一个字母」这类错全放过去。
 */
(async () => {
  const readSrc = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const remoteSrc = readSrc("utils/remote.js");
  const authSrc = readSrc("utils/auth.js");

  // 0) 两条路由的路径写死在这儿 —— 文档、服务端、客户端三处要对得上
  ok("登录路由与文档一致（/api/wx/login）", /login:\s*"\/api\/wx\/login"/.test(remoteSrc));
  ok("刷新路由与文档一致（/api/wx/refresh）", /refresh:\s*"\/api\/wx\/refresh"/.test(remoteSrc));

  /**
   * 造一台假机器：内存存储 + 可编程的 request。
   * `spec(opt)` 拿到请求，**同步**返回 `{ statusCode, data }` ——
   * 同步是为了让这一节能像其余断言一样一行行读下来，不必套回调。
   */
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
    // utils 那几层是模块级单例（会话、队列都在闭包外），换一台就得重载
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
    // request 那几层是 Promise 链，回调排在微任务里 —— 只 await 一次不够，
    // 要多转一圈才把「401 → 刷新 → 重发」整条链走完。
    return p.then(
      (v) => settled.push({ ok: v }),
      (e) => settled.push({ err: e })
    ).then(() => new Promise((r) => setTimeout(r, 0)));
  }

  /* ---------- 1. 登录报文：code + device，一样都不能少 ---------- */
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

  /* ---------- 2. 刷新报文也带 device ---------- */
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

  /* ---------- 3. 过期了要自己换一枚再来（而不是报错了事） ---------- */
  {
    let n = 0;
    const m = machine((opt) => {
      if (/\/wx\/refresh$/.test(opt.url)) {
        n += 1;
        return { statusCode: 200, data: { accessToken: "NEW", refreshToken: "R2", expiresIn: 600, tier: "pro" } };
      }
      if (/\/sync\/pull$/.test(opt.url)) {
        // 服务端认 Bearer，但旧那枚已经过期
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

  /* ---------- 4. 只重试一次：服务端压根不认 Bearer 时不许死循环 ---------- */
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

  /* ---------- 5. 五个请求一起 401：refresh 只发一次 ---------- */
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
    /* ⚠️ 要**真的并发**：`await` 一条再发下一条等于五个请求排着队，
       第一个走到刷新完、refreshing 已经清掉了，第二个才轮到 ——
       那样就算实现是错的，这条断言也会绿。这正是它第一版的样子。 */
    await drain(Promise.all([m.remote.pull(), m.remote.pull(), m.remote.pull(), m.remote.pull(), m.remote.pull()]));
    ok("五个请求一起 401，refresh 只发一次（不是五枚 token）", refreshes === 1, "实际 " + refreshes + " 次");
    m.restore();
  }

  /* ---------- 6. 两条登录路由不许自己触发刷新（那是死循环） ---------- */
  {
    const m = machine(() => ({ statusCode: 401, data: { code: "E_LOGIN_FAIL" } }));
    m.auth.applySession({ accessToken: "OLD", refreshToken: "R1", tier: "pro" });
    await drain(m.remote.request(m.remote.PATHS.login, { code: "x" }));
    ok("登录那条路回了 401 不会去刷 token（刷了就是死循环）",
      m.sent.length === 1 && /\/wx\/login$/.test(m.sent[0].url),
      m.sent.map((o) => o.url).join(","));
    m.restore();
  }

  /* ---------- 7. 没有 refreshToken：先问 /api/me（网页版同号那条路） ---------- */
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

  /* ---------- 8. 没人登录时 /api/me 回 401：安静，不当错误 ─ ---------- */
  {
    const m = machine(() => ({ statusCode: 401, data: { code: "E_NO_SESSION" } }));
    await drain(m.auth.refresh());
    ok("没有会话时安静地什么都不做（没登录的人启动一次也会走到这儿）",
      !!settled[settled.length - 1] && !!settled[settled.length - 1].ok,
      JSON.stringify(settled[settled.length - 1]));
    m.restore();
  }

  /* ---------- 9. 会话字段不许盖同步时间戳（V34 那条的老规矩，换个口再守一遍） ---------- */
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

  /* ---------- 10. 服务端那半边：文档里真的写了 ---------- */
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

/* ---------- V45. 服务端写的话，用户得看得到（Issue #71） ----------
 *
 * 服务端那几条错误是**为用户写的**：
 *
 *   503 E_WX_NOT_CONFIGURED  「服务端还没配微信登录（缺 WX_APPID / WX_SECRET）。」
 *   503 E_WX_TABLE           「数据库里没有 wx_accounts 这张表。建表语句见 ……」
 *   401 E_WX_CODE            「这次登录用的 code 已经失效了，请重新点一次登录。」
 *   503 E_WX_CONFIG          「小程序 appid / appsecret 配得不对，登录走不通。」
 *   502 E_WX_UPSTREAM        「微信登录服务没能应答，稍后再试。」
 *
 * 而客户端这边（`utils/remote.js` 的 `send()`）原先拼的是 `"HTTP " + 状态码`，
 * 于是**用户看到的就是 "HTTP 503"** —— 服务端那句话白写了。
 * 更糟的是 `pages/mine/mine.js` 的登录失败提示读的正是 `err.message`，
 * 它没有任何别的来源。
 *
 * 这一节钉住这条：**服务端给了 message，就用它**。
 * 是端到端试出来的 —— 单看两边各自的代码都不会觉得有问题。
 */
{
  const remoteSrc = fs.readFileSync(path.join(ROOT, "utils", "remote.js"), "utf8");
  ok("send() 优先用服务端那句 message（不是只拼状态码）",
    /body\.message\s*\|\|/.test(remoteSrc) && /new Error\(say \|\|/.test(remoteSrc),
    "拼成 'HTTP 503' 的话，服务端为用户写的那几句一句都到不了用户眼前");
  /* ⚠️ 判据跟着实现走，但**不许放松**：这两条的真身是「服务端给了 message 就用它、
     没给才退回状态码」。原来写的是 `"HTTP " + res.statusCode`，而那一句后来
     抽进 `httpError(statusCode, data)`（两条通道共用，见 remote.js）——
     参数名跟着变了，判据也得跟着变，否则它红在参数改名上，
     而真正要守的「message 不许是空的」反倒没人看。
     所以改成两头都查：**退化那一句在**，且**它带的是传进来的状态码**。 */
  ok("服务端没给 message 时才退回状态码那句（别让 message 是空的）",
    /"HTTP " \+\s*statusCode/.test(remoteSrc) && /function httpError\s*\(/.test(remoteSrc));

  // 真的喂一条 503 进去，看抛出来的 message 是哪句
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
  /* 服务端那句话的唯一定义处：假 request 回它、断言也读它 —— 两处各抄一遍就会
     在某次改文案时只改一处，而断言红在「文案变了」上，看着像功能坏了。 */
  const SVC_503_MSG = "服务端还没配微信登录（缺 WX_APPID / WX_SECRET）。";

  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(path.join(ROOT, "utils")) === 0) delete require.cache[k];
  });
  const auth = require(path.join(ROOT, "utils", "auth.js"));
  auth.configure({ baseUrl: "https://probe.test" });
  /* ⚠️ 这一条**必须**交给 `track()`（见文件头上那段）：`check.js` 结尾是
     `process.exit`，而它会切掉微任务 —— 没收进 pending 的异步断言一条都不会跑，
     而计数里也看不出来（它就是这么空跑了一整个版本的）。
     顺带：假 wx 只在 `global.wx` 是**这一支的**时候读得到东西，
     所以下面几处链上都要重装一次（后面那些区块会同步把它换掉）。 */
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

/* ---------- V48. 免备案那条路：云调用（Issue #100） ----------
 *
 * 用户的诉求只有一句：「走完全不需要备案的路」。而这里的约束是硬的 ——
 * 云托管的默认域（`*.sh.run.tcloudbase.com`）**填不进 request 合法域名名单**，
 * 微信当场回「云托管域名仅用作测试使用，不可用在正式环境下」；要填进去就得
 * 自有域 + ICP 备案（3–20 个工作日）。也就是说：
 *
 *   只要客户端还用 `wx.request`，备案这一关就绕不过去。
 *
 * 绕得过去的那条路只有一条 —— **云调用**（`wx.cloud.callContainer`）。
 * 它走微信内网，不经过那张名单，所以既不用域名也不用备案。
 *
 * 这一节守的是「这条路真的接上了」，而**不是「文档里提过它」**。
 * 理由是 § 三 P.S. 里一直写着「B. 云开发 / 云调用」这段 —— 写了很久，
 * 但客户端一行都没实现，等于把一条路记成了「已经有了」。
 *
 * 判据分三层，缺一层这节就只是文案检查：
 *   ① 客户端真有这条通道（`send()` 会按配置分派，不是只有注释）
 *   ② 它发出去的报文与 http 那条**一模一样**（头 / 路径 / 方法都要对得上，
 *      少一个 `X-WX-SERVICE` 平台就回 service not found）
 *   ③ **真跑一遍**：假 wx 提供 `cloud.callContainer`，验登录 → 同步整条路
 *      在只有云调用、没有 baseUrl 时也能通 —— ② 是形状，③ 是行为
 */
{
  const remoteSrc = fs.readFileSync(path.join(ROOT, "utils", "remote.js"), "utf8");
  const authSrc = fs.readFileSync(path.join(ROOT, "utils", "auth.js"), "utf8");

  /* ① 通道真的在，且**分派**写得出来。
     ⚠️ 只搜 `callContainer` 会被注释骗过（这一节的注释里就写着它），
     所以判据落在「`send()` 里有 if 分派」与「`wx.cloud.callContainer(` 是真调用」两处。 */
  ok("客户端有云调用那条通道（`send()` 按配置分派，不是只有文档）",
    /function send\([\s\S]{0,200}?useCloud\(\)\)\s*return sendCloud\(/.test(remoteSrc) &&
      /wx\.cloud\.callContainer\(/.test(remoteSrc),
    "`send()` 里没有按 `useCloud()` 分派，或压根没调 `wx.cloud.callContainer` —— " +
      "那样就只剩 `wx.request` 一条路，而它必须备案");

  /* ② 两条通道的报文必须一致。逐项查，因为这里每一种漏法都**不报错**：
        · 少 `X-WX-SERVICE` → 平台回 `service not found`（看着像服务没部署）
        · 少 `authorization`  → 服务端当没登录（401，看着像 token 过期）
        · 少 `config.env`     → 平台回 `env not exists`（看着像环境没建） */
  ok("云调用带齐 X-WX-SERVICE / config.env / authorization（少一个都是平台错或静默 401）",
    /"X-WX-SERVICE":\s*conf\.service/.test(remoteSrc) &&
      /config:\s*\{\s*env:\s*conf\.env/.test(remoteSrc) &&
      /sendCloud\(path, data, method\)[\s\S]{0,900}?authorization:/.test(remoteSrc),
    "云调用的头/配置少了东西：`X-WX-SERVICE` 少了回 service not found，" +
      "`config.env` 少了回 env not exists，`authorization` 少了服务端认不出人（401）");

  /* 云调用的**就绪判据**与 http 那条是两种：一个要地址，一个要 env+service。
     ⚠️ 上一版 `configured()` 只认 `baseUrl`，于是「云调用配好了却仍被判成没后端」——
     界面如实说「后端未就绪」，而它其实早就通了。这条守的就是这一半。 */
  ok("`configured()` 两条通道都认（只认 baseUrl 会把配好的云调用判成没后端）",
    /function configured\(\)\s*\{[\s\S]{0,200}?a\.baseUrl[\s\S]{0,160}?a\.cloud/.test(remoteSrc),
    "`configured()` 只看 `baseUrl` —— 只配云调用的人会被判成「后端未就绪」，" +
      "而那条路其实是通的");

  /* ③ **真跑**。上面两条是形状，这一条是行为 —— 「报文形状对」与
     「合起来能通」是两件事（§ 二点五 就是被这一条教过的）。
     假 wx 只给 `cloud.callContainer`、**不给可用的 `wx.request`**：
     于是任何一处漏改、任何一处仍走 http，都会当场失败。 */
  {
    const mem = {};
    const savedWx = global.wx;
    let sawRequest = false;
    global.wx = {
      getStorageSync: (k) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : ""),
      setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
      removeStorageSync: (k) => { delete mem[k]; },
      login: (o) => o.success({ code: "C-CLOUD" }),
      // http 那条**故意不给**：走了它就该红，而不是悄悄换条路也能过
      request: () => { sawRequest = true; throw new Error("这条测试里不该走 wx.request"); },
      cloud: {
        callContainer: (opt) => {
          calls.push(opt);
          // 真去打服务端的形状没法在离线自检里造，所以只验「请求发对了」，
          // 业务语义那半边由 e2e-wx-sync.js 真接服务端验。
          opt.success({ statusCode: 200, data: { accessToken: "T", refreshToken: "T", expiresIn: 604800, tier: "free", role: "user", userId: "u_1" } });
        }
      }
    };
    const calls = [];
    Object.keys(require.cache).forEach((k) => {
      if (k.indexOf(path.join(ROOT, "utils")) === 0) delete require.cache[k];
    });
    const auth = require(path.join(ROOT, "utils", "auth.js"));
    const remote = require(path.join(ROOT, "utils", "remote.js"));

    // 只配云调用，**不配 baseUrl** —— 这正是「完全不需要备案」那种配法
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

  /* 配置入口得让人在界面上就能选，而不是让运维去改代码。
     判据落在「两栏都在 + 存的时候两栏一起要」：
     只填一栏存下去的话，平台回的是 `env not exists` / `service not found`。 */
  const adminSrc = fs.readFileSync(path.join(ROOT, "packages", "admin", "index", "index.js"), "utf8");
  const adminWxml = fs.readFileSync(path.join(ROOT, "packages", "admin", "index", "index.wxml"), "utf8");
  ok("管理页能在界面上配云调用（env + service 两栏都在）",
    /cloudEnv/.test(adminWxml) && /cloudService/.test(adminWxml) && /onSaveCloud/.test(adminWxml),
    "只能改代码配云调用的话，这条路就落不到用户手上");
  ok("云调用两栏缺一个就不许存（存下去只会得到 env not exists）",
    /if\s*\(!env\s*\|\|\s*!service\)/.test(adminSrc),
    "允许只填一栏：平台那边回 env not exists / service not found，" +
      "看着像服务没部署，其实是少了一栏");
  /* 文档里那条路得**能照着走**。这一条只问一件事：免备案那条路有没有写下来，
     以及**它为什么免**有没有写下来 —— 只写「用云调用就行」不写为什么，
     下一个人看到「request 合法域名」那节还会以为备案绕不过去
     （这一节原来的标题就是「唯一绕不开的一张网」）。 */
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

  ok("云开发环境 ID 填成云托管那个时当场说清（两个是不同的环境）",
    /\^\\d\+-\\d\+-\\d\+\$/.test(adminSrc) && /env not exists/.test(adminSrc),
    "不提醒的话，人会拿云托管的环境 ID 去填 `env`，然后在「服务明明部署了」" +
      "与「调不通」之间来回");
}

/* ---------- V44. 设置那一行的报文 → 服务端白名单（Issue #71） ----------
 *
 * 抓出来的是一个**两边都不报错**的错：小程序端把 `lastSyncAt` 也打包进了
 * `settings:v1`，而服务端的白名单里没有它 —— 于是它被服务端裁掉。
 * 发过去的那一份**在服务端被改过**，而客户端那边一路绿灯。
 *
 * `lastSyncAt` 是「我这份进度到过别处」的读数，不是「用户选过的东西」：
 *   · 它是本机时钟写下的时刻，跟着人走毫无意义
 *   · 它每次同步成功都会变 → 每次都盖一个新时间戳 → 这一行永远显得「刚改过」，
 *     服务端那份设置会被本机反复顶掉
 * 所以正确做法是**客户端就不发它**（wire.js 打包时按 DEFAULTS 投影，跳过这个键）。
 *
 * 这一节钉的就是这条：**发出去的每一个键，服务端要么收下、要么我们本来就不该发**。
 * 读不到 poem（那个仓库不在本地）时跳过并说明 —— 不假装验过。
 */
{
  const webDir = process.env.POEM_WEB_DIR || "/tmp/poem";
  const corePath = path.join(webDir, "api", "_lib", "core.js");
  if (!fs.existsSync(corePath)) {
    ok("设置那一行的报文对得上服务端白名单（读不到 poem，跳过）", true);
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
      // 用户把每一项都改一遍（改到跟默认值不同，才看得见「有没有被裁」）
      store.saveSettings({
        grade: 3, term: 2, dailyCount: 7, scope: "all", algo: "sm2",
        align: "left", fontSize: 2, theme: "ink", pinyin: "all",
        speechRate: 1.5, speechAutoNext: false
      });
      // 顺手做两件真实世界里一定会发生的事：
      //   · 同步成功会写一次 lastSyncAt（它不该跟着人走）
      //   · 音效跟设备走，不该进报文
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

        // 反向：客户端认的每一个键，服务端都得收 —— 少一个就是「改了设置、
        // 换台手机还是默认」，而且到处都不报错。
        const clientKeys = Object.keys(store.DEFAULTS).filter((k) => k !== "lastSyncAt");
        const notOnServer = clientKeys.filter((k) => mine.indexOf(k) < 0);
        ok("小程序端每个跨设备的设置键都在服务端白名单里",
          notOnServer.length === 0,
          "缺 " + JSON.stringify(notOnServer) +
          " —— 这个键推上去会被服务端裁掉，「改了设置、换台手机还是默认」");

        // 白名单里的类型标注：写错一个（int 写成 str）不会报错，
        // 只会让某个键静默变成字符串。这里只做形状检查。
        const badType = Object.keys(core.SETTINGS_KEYS)
          .filter((k) => ["int", "str", "bool", "num"].indexOf(core.SETTINGS_KEYS[k]) < 0);
        ok("服务端白名单的类型标注都在 {int,str,bool,num} 里",
          badType.length === 0, "认不出的类型：" + JSON.stringify(badType));

        // 真过一遍服务端 sanitize：发出去的字段一个都不许丢
        const got = core.sanitizePayload(row.payload, "settings:v1");
        const lost = keys.filter((k) => !(k in (got.settings || {})));
        ok("报文过一遍服务端 sanitize，设置一个字段都不丢",
          lost.length === 0, "丢了 " + JSON.stringify(lost) + " —— 实际 " + JSON.stringify(got.settings));
      }
    }
  }
}

/* ---------- V46. WXML 插值里那几种「构建时整个包传不上去」的写法 ----------
 *
 * 现场（两轮，同一个报错，两个不同的原因）：
 *     ./packages/game/quiz/quiz.wxml:1:2154:   ← 第一轮
 *     ./packages/game/quiz/quiz.wxml:1:2084:   ← 第二轮
 *     Bad value with message: unexpected token `.`
 * 后果是**整个体验版都发不出去**（`-80054`），而这步 `allow_failure: true`，
 * 不挡流水线 —— 得自己翻日志才看得见。
 *
 * ⚠️ 这一节最值得记的是：**第一轮修完，包照样传不上去。**
 *    第一轮认的是「三层嵌套三元」，改完报错仅仅从 2154 挪到 2084 ——
 *    挪动的那 70 个字符，正好是我加进注释的那段字。也就是说当时的判据
 *    （数 `?` 的个数）**没认住真正的那一处**，它守的是同一格里的另一个毛病。
 *
 * 真正在卡的那两处，是 WXML 插值里**不属于它文法**的两类东西：
 *
 *   ① 嵌套三元 + 字符串字面量（第一轮，选项那格 `class`）
 *      WXML 的插值只吃**一层**三元。本仓库别处（exam / feihua / index）
 *      一律只用一层 —— 所以判据可以收得很紧：一个插值里两个以上 `?` 就是错。
 *
 *   ② 方法调用（第二轮，结果页那行正确率）
 *          {{questions.length ? (correct * 100 / questions.length).toFixed(0) : 0}}
 *      括号表达式后面跟一个 `.`，解析器在那儿报 `unexpected token `.``。
 *      错的是 `.toFixed` 那个点，而**它不在选项那格、也不在同一个原因里** ——
 *      这就是为什么第一轮改完仍然是红的。
 *
 * 还有一条是这一轮踩出来的：**注释里的花括号同样会被解析**。
 *     <!-- ... WXML 的 {{ }} 吃不下 ... -->
 *     <!-- ... 认 `) .` 这种方法调用 ... -->
 * 这两行注释本身就让上一轮的修法原地复发（第二行还会正中判据②）。
 * 所以注释里**不许出现那对花括号**，判据也照着这个收。
 */
{
  const issues = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full); continue; }
      if (!ent.name.endsWith(".wxml")) continue;
      const rel = path.relative(ROOT, full);
      const text = fs.readFileSync(full, "utf8");

      // ── ① 插值里有嵌套三元（两个以上 `?`）
      text.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/\{\{(.*?)\}\}/g)) {
          if ((m[1].match(/\?/g) || []).length >= 2) {
            issues.push({ kind: "嵌套三元", at: rel + ":" + (i + 1), what: m[1].trim().slice(0, 70) });
          }
        }
      });

      // ── ② 插值里对括号表达式调方法：`)` 之后跟 `.` 再跟标识符
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

      // ── ③ 注释里出现插值花括号（它同样会被解析，等于把错留在原地）
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

/* ---------- V46b. 「上传体验版」那步：成了/没成都得能看见 ----------
 *
 * 这一步 `allow_failure: true`，于是它有两种静默：
 *   失败 → 流水线照样绿，得自己翻日志（`-80054` 那次就是这么漏过去的）
 *   成功 → 没有任何信号，你以为没跑
 * 所以 `script` 必须成对出现两块横幅，而且要**原样透传退出码** ——
 * `exit $?` 写在别处就是 0，这步就永远「成功」。
 *
 * 还有一条实的：默认的 npm 会吐 40 行 warn，真错被埋在中间。
 */
{
  const yml = fs.readFileSync(path.join(path.dirname(__dirname), ".cnb.yml"), "utf8");
  // ⚠️ 不能直接 `indexOf("上传体验版")` —— 上面 `$."**"` 那条自检的注释里也提到了
  //    这个名字（讲「list 混多行块」时举的例子），会更早命中。要按**任务名行**找。
  const at = yml.indexOf("- name: 上传体验版");
  const body = at < 0 ? "" : yml.slice(at);
  // 这一步的 script 是一整块（字符串），不是 list 混多行块 ——
  // 所以只需确认「最后是 allow_failure」，不需要再切一次块。
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

  // ⚠️ 必须只看**真命令行**，不能拿整块 body 去搜 —— 上面那三行注释里也写着
  //    `--loglevel=error`，整块搜的话把命令行里的 flag 删掉它照样绿（反向验过）。
  //    这跟 V46 要防的是同一类错：「文案还在」不等于「行为还在」。
  const lines = body.split("\n")
    .map((l) => l.replace(/\s+#.*$/, ""))     // 剥掉行尾注释
    .filter((l) => !/^\s*(#|$)/.test(l));      // 丢掉整行注释与空行
  const npmLine = lines.find((l) => /npm i .*miniprogram-ci/.test(l)) || "";
  ok("npm 装包那行真收掉了 warn（默认 40 行 deprecated 会把真错埋掉）",
    /--loglevel=error/.test(npmLine),
    "真命令行里没加 --loglevel=error（注释里写着不算），真错会被 40 行 npm warn 盖住：" +
      JSON.stringify(npmLine.trim().slice(0, 80)));

  ok("上传那步仍然只声明 name/script/allow_failure（script 一整块，不是 list）",
    isOneBlock, "这一步的 script 结构变了 —— 混成 list 会被 CNB 用 `&&` 串崩");
}

/* ---------- V43. 部署件：云托管那份镜像（Issue #71） ----------
 *
 * 挡两类「绿着错」的事：① 往本仓库拷一份 poem 的 api/（改完 poem 忘了同步，
 * 线上跑旧代码而不报错）；② 构建上下文里塞进 37MB 语料与字体（每次部署白传，运行时一条不读）。
 * 文档那几条判据守着「照抄不会撞墙」：镜像地址、端口、六选一该选哪项、GHCR 包怎么设 Public。
 */
{
  const repo = path.join(ROOT, "..");
  const deploy = path.join(repo, "deploy");
  const dockerfile = path.join(deploy, "Dockerfile");
  const serveDir = path.join(repo, "deploy-api-serve");

  ok("deploy/Dockerfile 在（流水线按路径取它）", fs.existsSync(dockerfile));

  const df = fs.readFileSync(dockerfile, "utf8");
  // 只看**指令行**（注释里为了讲清道理会提 data/、fonts/，那不是指令）
  const dfLines = df
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const copied = dfLines.filter((l) => l.startsWith("COPY")).join("\n");
  /* ⚠️ 服务壳那行必须是**平铺的** `./serve-api.js`。
     构建上下文是 **poem 根**，服务壳由流水线摆进去 —— 摆的位置是平的
     （`.cnb.yml` stage context、`deploy/build.sh`、`.dockerignore` 的
     `!serve-api.js` 三处都是这么写的）。
     写成 `deploy-api-serve/serve-api.js` 在**本仓库**里看着对（那个路径确实存在），
     但上下文里没有这个目录 —— 真跑一次 docker build 才会红：
       #9 ERROR: failed to calculate checksum ...: not found     （Dockerfile:47）
     这条判据以前写的就是错的那个路径，所以它守着错的实现、一直是绿的。 */
  ok("deploy/Dockerfile 只 COPY api/ 与服务壳，不 COPY 语料 / 字体 / 前端",
    /COPY --chown=node:node api \.\/api/.test(copied) &&
      /COPY --chown=node:node serve-api\.js \.\//.test(copied) &&
      !/\b(data|fonts|css|icons)\b/.test(copied),
    "真 COPY 到了，就是把 26MB 请回了上下文。实际 COPY：" + JSON.stringify(copied));

  /* ⚠️ COPY 的**源**是在构建上下文根上取的，而上下文是流水线摊出来的
     （`.cnb.yml` 的 stage context 与 `deploy/build.sh` 做的是同一件事：
      poem 的 api/ + 本仓库那两样，**平铺进同一个临时目录**）。
     这一条按那一层**真摊一遍**再逐条找，而不是拿正则猜路径：
       · 服务壳在上下文里叫 `serve-api.js` —— 本仓库里的 `deploy-api-serve/`
         那个前缀在上下文里**不存在**。写成带前缀那版，docker 只回一句
         `failed to calculate checksum ... "/deploy-api-serve/serve-api.js": not found`
         （Issue #71 现场，看着像文件没提交，其实是源路径按错的目录树在找）。
       · 上面那条「只 COPY api/ 与服务壳」里的正则也是照这一层写的 ——
         两处一起改，别只改一处。 */
  {
    const ctxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-check-"));
    try {
      /* ⚠️ 摊法**从 `.cnb.yml` 里读**，不在这里手抄一遍。
         手抄的那一版守不住真正要守的东西：流水线里漏了 `cp`，而这里照抄的还是
         「都摆过来了」—— 于是断言绿着，构建在 CI 上才红。
         判据：`cp <源> /tmp/ctx/<目标>`（也认 `cp <源> /tmp/ctx/` 这个变体）。 */
      const stageCmds = fs.readFileSync(path.join(repo, ".cnb.yml"), "utf8")
        .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
      const stagedNames = [];
      stageCmds.forEach((l) => {
        const m = /^cp\s+(\S+)\s+\/tmp\/ctx\/(\S+)$/.exec(l);
        if (!m) return;
        const src = m[1], dstName = m[2];
        const srcAbs = path.join(repo, src);
        if (!fs.existsSync(srcAbs)) return;
        fs.copyFileSync(srcAbs, path.join(ctxRoot, dstName));
        stagedNames.push(dstName);
      });
      ok("流水线真的把本仓库那几样摊进了上下文（摊法从 .cnb.yml 里读）",
        stagedNames.length >= 4,
        "从 .cnb.yml 里只读到 " + stagedNames.length + " 条 `cp … /tmp/ctx/…`：" +
          JSON.stringify(stagedNames));

      const copySrcs = (copied.match(/^COPY[^\n]+/gm) || [])
        .map((l) => l.trim().split(/\s+/).filter((w) => !w.startsWith("--")))
        // COPY <src> <dst>：取 src，`--chown=node:node` 已经被上面滤掉了
        .map((parts) => parts[1])
        .filter(Boolean);
      // api/ 由 poem 提供（本仓库里不许有，见下面那条），单独放过
      const fromPoem = new Set(["api", "./api"]);
      const missing = copySrcs.filter(
        (src) => !fromPoem.has(src) && !fs.existsSync(path.join(ctxRoot, src.replace(/^\.\//, "")))
      );
      ok("deploy/Dockerfile 里每个 COPY 的源都能在**摊出来的上下文**里找到",
        copySrcs.length > 0 && missing.length === 0,
        "在上下文里找不到：" + JSON.stringify(missing) +
          "。COPY 的源按构建上下文根取，而上下文是摊出来的那一层 —— " +
          "`deploy-api-serve/` 只存在于本仓库的目录树里，上下文里没有那个目录。" +
          "实际 COPY 源：" + JSON.stringify(copySrcs));
    } finally {
      fs.rmSync(ctxRoot, { recursive: true, force: true });
    }
  }

  ok("deploy/Dockerfile 声明了 API_REV（构建参数钉住「这一版 api/ 是哪来的」）",
    /ARG API_REV/.test(df));

  /* 基础镜像那一行。Issue #71 的现场是云托管报
     `manifests/<tag>: 401 Unauthorized` —— 查下来是**镜像从来没构建过**
     （制品库那个仓库下 total: 0），而 CNB 制品库对「不存在」和「没权限」都回 401，
     于是现场看着像凭据问题。这一节守两件跟那次相邻的事：
       ① 基础镜像得是个**公开地址**，别写成一个要凭据才能拉的 registry ——
          构建机上没那份凭据时，pull 就拒，而报错指向 Dockerfile 第 1 行
       ② 换个镜像源要能在**流水线里覆盖**（BASE_IMAGE），不用改文件
     判据落在 `FROM ${BASE_IMAGE}` 这个形状上：写死一个真实地址就会红。 */
  const fromLine = dfLines.find((l) => /^FROM\s/i.test(l)) || "";
  ok("deploy/Dockerfile 的基础镜像走 BASE_IMAGE（可在流水线里换源，不写死 registry）",
    /^FROM\s+\$\{BASE_IMAGE\}$/.test(fromLine) && /ARG BASE_IMAGE=/.test(df),
    "实际那一行：" + JSON.stringify(fromLine) +
      " —— 写死一个地址，构建机上拉不动时只能改这个文件；" +
      "写成需要凭据的私有地址，错误还会伪装成「Dockerfile 第 1 行有问题」");
  ok(".cnb.yml 把 BASE_IMAGE 传给 docker build（流水线上换源不用改 Dockerfile）",
    /--build-arg "BASE_IMAGE=/.test(fs.readFileSync(path.join(repo, ".cnb.yml"), "utf8")),
    "没传的话，换镜像源就得改 Dockerfile —— 而 Dockerfile 是共用的那份");

  /* ---------- 忽略文件到底归谁（Issue #71 云托管 401 那一轮） ----------
   *
   * 这一节是照着一句**听起来很顺、实际相反**的话写的。CNB 文档说
   * 「.dockerignore 在**源码上下文根**生效」，于是这一轮之前的注释都这么写。
   * 但实测不是：CNB 把 Dockerfile 从另一个仓库取过来时会**单独取**
   * （构建命令只有 `-f <路径>`），取的时候不带任何忽略文件 ——
   * 挂在它旁边的那份也不会被用到。
   *
   * 后果很实际：`deploy-api-serve/.dockerignore` 一直躺在那儿、看着像在干活，
   * 实际上一个字节都没上传；真正定住镜像体积的是上下文里那份
   * `api/.dockerignore`（poem 根的白名单）。3.2MB 与 46MB 就是它定的。
   *
   * 这条错属于「绿着出错」：构建绿、部署绿，只是每次多传 43MB。
   * 所以判据必须落在「文件在不在**生效的那个位置**」上，而不是「写没写进注释」。
   */
  const cnbYml = fs.readFileSync(path.join(repo, ".cnb.yml"), "utf8");
  ok("stage context 把白名单摆到**上下文根**（忽略文件跟上下文走，不跟 Dockerfile 走）",
    /cp\s+deploy-api-serve\/\.dockerignore\s+\/tmp\/ctx\/\.dockerignore/.test(cnbYml),
    "摆到 /tmp/ctx 根才生效。摆回 deploy-api-serve/ 旁边、或 /tmp/ctx/api/ 下面，" +
      "一份都不生效 —— 上下文从 0.3MB 变 38MB，而且不报错");

  /* ⚠️ 只看**真指令行** —— 上面那段注释里就写着 `/tmp/ctx/api/.dockerignore`
     这个反面例子，搜全文会把讲解判成违规（这条第一版就这么红了一次，
     跟 V43 里 `set -o pipefail` 那条踩的是同一个坑）。 */
  const cnbCmds = cnbYml
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  ok("没有任何一份 .dockerignore 被摆到 /tmp/ctx/api/ 下（嵌套的不生效）",
    !cnbCmds.some((l) => l.includes("/tmp/ctx/api/.dockerignore")),
    "Docker 不认嵌套的忽略文件 —— 摆在那儿最像「放对了」，实际一个字节都不上传");

  ok("build & push 在构建前确认白名单就位（缺了当场断，不留给体积去说）",
    /\[\s*!\s*-f\s+\/tmp\/ctx\/\.dockerignore\s*\]/.test(cnbYml),
    "这是「绿着出错」那一类：构建会成功、部署会成功，只是每次白传 37MB，没人会去查");

  /* 这一条守的不是代码，是**判断**。忽略文件的归属本来就绕：
     它跟**构建上下文**走、跟 Dockerfile 放哪儿无关，所以生效的位置只有一个
     （`/tmp/ctx/.dockerignore`），而「最像对的」那两个（藏在本仓库的
     `deploy-api-serve/` 里、或者摆到 `/tmp/ctx/api/` 下面）都不生效且不报错。
     不把这个写进 Dockerfile 顶上，下一个人就会按「与 Dockerfile 同目录」改回去。 */
  ok("deploy/Dockerfile 讲清了 .dockerignore 该摆在哪（并点明嵌套的那份不生效）",
    /\.dockerignore[\s\S]{0,900}?跟\*\*构建上下文\*\*走/.test(df) &&
      /\/tmp\/ctx\/\.dockerignore[\s\S]{0,200}?有效/.test(df) &&
      /嵌套的不生效|嵌套的忽略文件/.test(df),
    "三个位置只有一个对，另两个最像对的且**都不报错** —— 不写清就等着被改回去");


  /* 服务壳与白名单都放在 deploy-api-serve/ 而不是 deploy/：
     Dockerfile 那行 COPY 是按**上下文根**取的，而上下文根是 poem ——
     摆在一个不属于「容器目录」的目录里，是让「谁在哪个上下文里生效」这件事显形。 */
  ok("服务壳在 deploy-api-serve/（不在 deploy/ —— 它进的是 poem 那个上下文）",
    fs.existsSync(path.join(serveDir, "serve-api.js")));
  const di = fs.readFileSync(path.join(serveDir, ".dockerignore"), "utf8");
  ok("deploy-api-serve/.dockerignore 是白名单（先 ** 全排，再逐条 ! 放行）",
    /^\*\*$/m.test(di) && /^!api\/\*\*$/m.test(di) && /^!serve-api\.js$/m.test(di),
    "写成常规排除名单的话，poem 的 data/ 26MB 会整个漏进上下文");

  /* ⚠️ 这一条是这一节真正在挡的东西：**不许再往本仓库拷一份 api/**。
     `deploy/api/` 或仓库根出现 `api/_lib/core.js`，就说明有人在重走老路 ——
     那意味着「改完 poem 忘了同步、线上跑旧代码而不报错」这个税又回来了。 */
  const strays = [
    path.join(deploy, "api"),
    path.join(repo, "api"),
    path.join(deploy, "api.synced"),
    path.join(deploy, "sync-api.sh")
  ].filter((p) => fs.existsSync(p));
  ok("本仓库里没有 poem 的 api/ 副本（后端的唯一住处是 poem）",
    strays.length === 0,
    "发现：" + strays.join(", ") +
    " —— 这一份副本就是「两份代码」那个税的来源：改完 poem 忘了同步，" +
    "线上跑旧代码而且不报错。要它的话，请先想清楚谁负责发现漂移。");

  const build = fs.readFileSync(path.join(deploy, "build.sh"), "utf8");
  ok("deploy/build.sh 是从 poem 摊上下文，不往仓库里落副本",
    /cp -R "\$POEM_DIR\/api"/.test(build),
    "落副本就又是「两份」了");

  // 云端要填的那几栏，文档必须写全 —— 少一栏就是「点不通」
  const setup = fs.readFileSync(path.join(repo, "docs", "wx-cloud-setup.md"), "utf8");
  ok("云托管设置文档写的是「按镜像部署」",
    /^\|\s*部署方式\s*\|\s*\*\*镜像\*\*\s*\|/m.test(setup),
    "写「代码仓库 + 容器目录」就是老路：那个仓库根上没有 api/，走不通");
  /* GHCR 的包默认 Private，要人去 GitHub 点一下 —— 而那一下**不在 repo 的
     Settings 里**（包挂在 `github.com/users/...` 下），所以要给能照抄的地址。 */
  ok("云托管文档给了「把 GHCR 包设成 Public」的可照抄地址（不在 repo Settings 里）",
    /github\.com\/users\/[\w.-]+\/packages\/container\//.test(setup) &&
      /Package settings/.test(setup) &&
      /Change visibility/i.test(setup),
    "GHCR 新包默认 Private，不设 Public 就得配凭据 —— 走 GHCR 省凭据这一步就白做了。" +
      "而这页挂在 user 下、不在 repo 的 Settings 里，只写一句话人会找不到");
  /* 包页 404 = 包还没推上去，不说这句人会以为地址抄错了。 */
  ok("云托管文档点明了「包页 404 = 包还没推上去」",
    /404[\s\S]{0,60}(包还没推|还没推上|先回|查流水线)/.test(setup),
    "包页找不到时最自然的怀疑是「地址写错了」，而实际是流水线没推到 —— 得把这句先说掉");
  /* 镜像地址要逐字给出：slug 是本仓库的，填成 poem 名下那个云托管拉不到。 */
  ok("云托管设置文档给出了完整的镜像地址（slug 是本仓库）",
    /docker\.cnb\.cool\/npu-gpu-cpu\/poem-wechat-mini-program\/wx-api/.test(setup),
    "人是要照抄这一栏的，给个占位符等于没写");
  ok("云托管设置文档写清了端口 8080",
    /\|\s*端口\s*\|\s*`?8080`?\s*\|/.test(setup));
  ok("云托管设置文档点明了**别**选「部署方式 = 代码仓库」",
    /别选「部署方式 = 代码仓库」|别选「部署方式|别选「六选一」里那四项|别在云托管控制台里指这个仓库/.test(setup),
    "不说这句，人会去填容器目录，然后卡在「没有 Dockerfile」——或者更糟，" +
      "转而把 poem 的 api/ 拷一份进来");
  /* 被问过一次的那个坑：人照着别的教程找「目标目录（需要构建的代码目录，与 Dockerfile
     同级）」，然后卡在「留空还是填什么」。答案不是「填 deploy」，是**这栏不该出现**——
     它属于「部署方式 = 代码仓库」那条路。判据落在两半：说清它不存在，且给出
     「看见它就说明选错了方式」这条可自检的反推。 */
  ok("云托管设置文档交代了「目标目录」那一栏（说了镜像这条路没有它）",
    /目标目录/.test(setup) && /选了镜像[\s\S]{0,120}没有「目标目录」/.test(setup),
    "不问清的话，人会去填 deploy —— 而部署方式是镜像时这栏根本不该出现");
  /* 控制台那栏是六选一，答案是「从地址拉取镜像」（镜像已经在流水线里构建好了）。 */
  ok("云托管设置文档写清了「六选一」里该选哪一项（从地址拉取镜像）",
    /从地址拉取镜像/.test(setup) &&
      /从地址拉取镜像[\s\S]{0,80}(就选这个|✅)/.test(setup) &&
      /绑定 GitHub/.test(setup),
    "只说「部署方式 = 镜像」不够 —— 控制台那栏是六选一，人照着别的教程会去点" +
      "「绑定仓库」，然后被「目标目录」绊住");
  ok("云托管设置文档给的是**一条**路（互斥的备选不许并列成同级做法）",
    /^## 一、出镜像$/m.test(setup) &&
      /^## P\.S\.：两条不用走的路$/m.test(setup) &&
      /备案/.test(setup) && /全量镜像/.test(setup),
    "备选要收在一节里，并标明「只在你要时才走」");
  /* 撤掉的旧说法不该留在文档里：读者要的是现在怎么填，不是尸检报告。 */
  const corpses = (setup + fs.readFileSync(path.join(deploy, "README.md"), "utf8"))
    .split("\n")
    .filter((l) => /已撤|上一版文档|上一版在这里写|原先写的是|原来写的/.test(l));
  ok("部署文档不留「撤稿记录」（读者要的是现在怎么填，不是尸检报告）",
    corpses.length === 0,
    "发现：" + JSON.stringify(corpses.slice(0, 2)));

  /* 流水线必须真的去 clone poem —— 不然就只能靠副本，而副本是撤掉的东西。 */
  const cnb = fs.readFileSync(path.join(repo, ".cnb.yml"), "utf8");
  ok(".cnb.yml 里那份镜像的流水线去 clone poem（源码上下文 = 后端那一边）",
    /clone poem[\s\S]{0,400}?clone-poem\.sh/.test(cnb),
    "没去取 poem 就只能靠副本，而副本正是这一版撤掉的东西");
  /* ⚠️ 取 poem 那一步要**留一条不带凭据的路**：令牌范围跟触发事件走，未必覆盖第二个
     仓库，而带着一个不被接受的凭据去 clone，会把匿名可读的仓库也拒成
     `Repository Not Found.` —— 看着像路径写错。两处 clone 都走 clone-poem.sh。 */
  {
    const sh = fs.readFileSync(path.join(repo, "scripts", "clone-poem.sh"), "utf8");
    ok("取 poem 留了不带凭据的退路（带了令牌被拒不等于仓库不存在）",
      /CNB_TOKEN[\s\S]{0,300}?\|\|[\s\S]{0,200}?git clone/.test(sh),
      "没有退路时，令牌范围不覆盖 poem 会回 128，报错却是「仓库不存在」");
    ok(".cnb.yml 的两处 clone 都走同一个脚本（退路不写两遍）",
      (cnb.match(/clone-poem\.sh/g) || []).length >= 2,
      "两处各写一遍 clone 命令，改一处漏一处");
  }

  ok(".cnb.yml 里那份镜像推在本仓库名下的 wx-api 槽位",
    /\$\{CNB_DOCKER_REGISTRY\}\/\$\{CNB_REPO_SLUG_LOWERCASE\}\/wx-api/.test(cnb),
    "镜像名与文档里那一栏必须对得上，否则云托管拉不到");

  /* ⚠️ 脚本的「真指令行」。@ 这一层有两个用处，都跟注释有关：
     ① 「不用 pipefail」那条的判据要看指令行 —— 上面那段注释里就写着
        `set -o pipefail` 这几个字，直接搜全文会把讲解判成违规；
     ② 「引用过的变量都有定义」那条也要看指令行，同样不能被注释里的
        `CNB_IMAGE: ...` 之类字样放行。
     ⚠️ 它必须**定义在用到它的第一条断言之前**（`const` 有 TDZ）：
     第一版就把它写在两条用途中间，于是最先用到它的那条当场
        ReferenceError: Cannot access 'shellLines' before initialization
     —— 报错在 check.js 自己身上，跟被检查的 .cnb.yml 一点关系都没有。
     （这类「检查脚本自己崩了」的错要单独认出来：它看着像配置有问题，
       其实一行代码都没跑。） */
  const shellLines = cnb
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  /* ⚠️ **`${IMAGE}` 被引用之前必须有人定义它**（Issue #100 的真现场）。
     报错长这样，只有一行：
         sh: 18: IMAGE: parameter not set        （退出码 2）
     不说是哪条命令、不说是哪个变量该有值；而 `docker login` 的
     `Login Succeeded` 就在它上面一行 —— 于是人会先去查 docker、查凭据、
     查上下文体积，全都不无辜。

     ⚠️ 这一条**必须按「定义」查，不能按「出现过」查**：这份配置里
     `${IMAGE}` 出现六次，只要有**一次**在注释或字符串里出现
     `IMAGE:` 字样（比如回滚说明里写的 `CNB_IMAGE: ...`），
     松着写的前缀匹配就会放行。判据落在 `env:` 段里的键名上。

     ⚠️ 为什么值得单开一条：Issue #71 把槽位换到 GHCR 时，`IMAGE` 的定义
     跟着被删了、引用留在原地 —— 定义与引用从此对不上，而**要等 push main
     才会显形**（分支推送那条自检根本不跑 build & push）。也就是说这类错
     会安安静静地攒到发版那一刻。 */
  {
    // env 段：`main:` 之下、`stages:` 之上，缩进 8 空格的 `KEY: value` 行
    const mainSel2 = (() => {
      const i = cnb.indexOf("\nmain:");
      return i < 0 ? "" : cnb.slice(i);
    })();
    const envSection = mainSel2.split("stages:")[0];
    const defined = new Set(
      envSection
        .split("\n")
        .map((l) => l.match(/^\s{8}([A-Z][A-Z0-9_]*):\s*\S/))
        .filter(Boolean)
        .map((m) => m[1])
    );
    // ⚠️ 只抓**不带默认值**的引用（`${VAR}`）。带 `:-` 的（`${VAR:-x}`）在这条
    //    断言里**不算定义**，也不在这里管 —— 它属于下一条断言的范围
    //    （`env:` 的值只能写字面量）。上一版这里是放行的，还写了句
    //    「带 `:-` 的一起要求会把我自己的 `IMAGE: ${GHCR_IMAGE:-...}` 判红」——
    //    等于给那个写法开了后门，而它本身就是错的（Issue #100 第二次现场）。
    const referenced = new Set();
    for (const l of shellLines) {
      for (const m of l.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) {
        referenced.add(m[1]);
      }
    }
    // ⚠️ 判据要收到最小：只抓「`env:` 里没有、脚本里也没赋值」的那一类。
    //    排掉的两类各有各的正当来源，混进来只会让这条断言变成噪音：
    //      ① CNB 注入：CNB_TOKEN / CNB_ROOT_SLUG / CNB_DOCKER_REGISTRY /
    //         CNB_COMMIT_SHORT / CNB_REPO_SLUG_LOWERCASE —— 流水线自己给的
    //      ② 密钥仓库 imports 注入：CNB_TOKEN_USER_NAME / GHCR_USER / GHCR_TOKEN 等
    //         （README「密钥」一节列了名字，这里不再抄一份）
    const injected = new Set([
      "CNB_TOKEN", "CNB_ROOT_SLUG", "CNB_DOCKER_REGISTRY", "CNB_COMMIT_SHORT",
      "CNB_REPO_SLUG_LOWERCASE", "CNB_BRANCH", "CNB_TOKEN_USER_NAME",
      "GHCR_USER", "GHCR_TOKEN", "GH_PAT", "GH_REPO", "WX_APPID",
      "WX_PRIVATE_KEY_B64",
    ]);
    // 脚本内赋值的：整行以 `VAR=` 起头（`REV="$(...)"`、`GHCR="${IMAGE}"` 这种）
    const assigned = new Set(
      shellLines
        .map((l) => l.match(/^([A-Z][A-Z0-9_]*)=/))
        .filter(Boolean)
        .map((m) => m[1])
    );
    const missing = [...referenced].filter(
      (v) => !defined.has(v) && !injected.has(v) && !assigned.has(v)
    );
    ok(".cnb.yml 的 `main` 里引用的变量都在 `env:` 里有定义（否则 busybox sh 直接 exit 2）",
      missing.length === 0,
      "这些变量只在脚本里被引用、`env:` 里没有定义：" + JSON.stringify(missing) +
        " —— job 跑在 Alpine，`set -eu` 之下撞上未定义变量是当场退出，" +
        "报错只有 `sh: N: VAR: parameter not set` 一行，不说是哪条命令");

    /* ⚠️ **`env:` 的值只能是字面量，不能写 shell 的 `${VAR:-default}`**
       （Issue #100 第二次现场，也是这条断言存在的唯一理由）。

       两个「变量替换」长得很像，但不是一回事：

         env: 里        CNB 自己的替换，文档只说 `$env_name` 会被替换成值、
                        无值时替换成**空字符串**。`${VAR}` 与 `${VAR:-x}`
                        都**不在它的语法里** —— 于是既不报错、也不清空，
                        **原样**当成普通字符串留下。
         script: 里     shell 的替换，`${VAR:-x}` 是对的 —— 6 步里
                        `eval "val=\${$v:-}"` 用的就是它，**那条别动**。

       现场（IMAGE 的值被原样拼进 tag，直到 docker 才炸）：
         ERROR: failed to build: invalid tag
         "${GHCR_IMAGE:-ghcr.io/ashleyzhang2028/poem-wx/wx-api}:36ad9fe":
         invalid reference format

       ⚠️ 为什么单开一条而不是折进上面：上面按「变量名有没有定义」查，
       而这里**变量在不在 `env:` 里都是错的** —— `GHCR_IMAGE` 恰好没定义，
       于是上面那条的 `assigned`/`injected` 名单里也没有它，看着像「无关的
       变量」；真问题是这个**写法**。判据落在 `env:` 段每一行的**值**上。

       ⚠️ 判据只收 `:-`/`:+` 这一类 **shell 专属**的修饰，不收光秃秃的
       `${VAR}`：后者就算 CNB 不替换，脚本里引用到的也是同名环境变量，
       shell 会自己展开（`${CNB_DOCKER_REGISTRY}` / `${TAG}` 就是这么活的）。
       而 `${VAR:-x}` 一旦 CNB 不认，值里的那串字面量就永久留在变量里 ——
       后面**谁引用都不会再展开**，实测：
         IMAGE='${GHCR_IMAGE:-ghcr.io/x}'; echo "${IMAGE}:$TAG"
         → ${GHCR_IMAGE:-ghcr.io/x}:36ad9fe        ← 原样进 tag
       这正是 `invalid reference format` 的来源，也是两者唯一的分别。 */
    const envLines = envSection
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    const badEnvValues = envLines.filter((l) => {
      const m = l.match(/^[A-Z][A-Z0-9_]*:\s*(.+)$/);
      return m && /\$\{[A-Z_][A-Z0-9_]*:-/.test(m[1]);
    });
    ok(".cnb.yml 的 `env:` 的值里不写 `${VAR:-default}` —— CNB 不替换它，会原样进命令",
      badEnvValues.length === 0,
      "这些 `env:` 的值里有 `${VAR:-...}`：" + JSON.stringify(badEnvValues) +
        " —— CNB 的 env 变量替换只认 `$VAR`，`${VAR:-default}` 会**原样**留下，" +
        "既不报错也不清空，而变量值不会再被二次展开，最后由 shell 拼进命令" +
        "（典型是 docker tag → invalid reference format）；" +
        "真要默认值就把字面量直接写在这儿" +
        "（script: 里的 `${VAR:-x}` 是 shell 的，不受影响，别一起改）");
  }

  /* 「以后所有的提交都进 main」—— 这句得落在配置里，不能只是口头约定。
     两件事一起守：
       ① 发布流水线挂在 `main:` 上，不是 `"v*":`（打 tag 要管理员，日常没人打得动）
       ② 镜像的 tag 跟 commit 走。⚠️ 这条是那份配置最容易写错的地方：
          用 CNB_BRANCH 的话，push 触发下它等于分支名，永远是 `main` ——
          看着有 tag，回滚时却没有版本号可填（实测过）。
     ③ `main` 之外的推送**不出镜像**：出了没人用，只往制品库堆垃圾。 */
  const deployJob = (() => {
    const i = cnb.indexOf("\nmain:");
    return i < 0 ? "" : cnb.slice(i);
  })();
  ok(".cnb.yml 里发布流水线挂在 main 上（不是 tag）",
    !!deployJob.trim(),
    "打 tag 要仓库管理员，日常提交的人不该为发版去找管理员");
  ok("main 那条流水线的镜像 tag 是 commit 短 sha，不是分支名",
    /TAG:\s*\$\{CNB_COMMIT_SHORT\}/.test(deployJob) &&
      !/-t "\$\{IMAGE\}:\$\{CNB_BRANCH\}"/.test(deployJob),
    "用 CNB_BRANCH 的话 push 触发下它等于 `main`，那不是版本号，回不去");
  ok("只有 main 出镜像（其余分支只自检）",
    /^\$:/m.test(cnb) && !/^"v\*":/m.test(cnb) &&
      /\$:[\s\S]*?"\*\*":[\s\S]*?- name: 自检/.test(cnb),
    "分支推送也出镜像只会往制品库堆垃圾，而没人会去用那些 tag");

  /* ⚠️ `main` 那条发布流水线必须真的拿到 node（Issue #71 的第二个现场）。
     **流水线级没有 `image` 这个字段**（语法手册里是 `docker.image` / `docker.build`），
     写在 `image:` 会被**静默忽略**，整条 job 退回缺省镜像
     `cnbcool/default-build-env` —— 而那个镜像里没有 node：
         $ node scripts/build-data.js && node scripts/check.js ...
         sh: line 1: node: command not found     （退出码 127）
     报错像「命令写错了」，跟命令、跟令牌、跟路径都无关。

     ⚠️ 判据**只管流水线级**：任务级（`- name: xxx` 底下）的 `image:` 是合法字段，
     `$."**"` 那条自检写的就是它，不能一起要求 —— 第一版这条断言写成了
     「凡是跑 node 的 job 都要有 docker.image」，把那条对的也判红了。 */
  {
    const mainSel = (() => {
      const i = cnb.indexOf("\nmain:");
      return i < 0 ? "" : cnb.slice(i);
    })();
    const pipelineHead = mainSel.split("stages:")[0];
    ok("main 那条发布流水线用 docker.image 指定 node（流水线级写 image: 会被静默忽略）",
      /docker:\s*\n\s*image:\s*node:/.test(pipelineHead) &&
        !/^\s{6}image:/m.test(pipelineHead),
      "写 `image: node:20` 的话，job 退回没有 node 的缺省镜像，" +
        "红在 `node: command not found` —— 看着像命令写错了");
  }

  /* ⚠️ 这个 job 跑在 `node:20` = **Alpine**，`sh` 是 busybox 的，
     **不认 `set -o pipefail`**：
         sh: 1: set: Illegal option -o pipefail     （退出码 2）
     现场 `cnb-h46-1k4g9mjsd` —— 前面自检全绿（1426 项），就卡在摊上下文那步的
     第一行。`set -eu` 里的 `-u`（用未定义变量就退出）才是这里真正要的；
     `pipefail` 在没管道的脚本里本来也是空转。
     （这条跟「用 alpine 当构建镜像」是绑在一起的：哪天换回 Debian 系，
       这个断言仍然成立 —— `set -eu` 在哪儿都能用。） */
  ok(".cnb.yml 的脚本不用 `set -o pipefail`（Alpine 的 sh 不认，会 exit 2）",
    !shellLines.some((l) => /set\s+-\S*o\s+pipefail/.test(l)),
    "busybox sh 会回 `sh: 1: set: Illegal option -o pipefail`，" +
      "整个 stage 在第一行就退出 —— 而它前面刚跑完的检查全是绿的，特别像「检查过了但没生效」");

  /* ⚠️ 一个 stage 的 `script` **要么全是 list、要么一个块**，别混：
     「一个多行块（`- |`）+ 后面几个普通 list 项」时，CNB 会把 list 各项用
     `&&` 串到前一块的**末尾**，busybox sh 撞上就成了
         sh: 10: Syntax error: "&&" unexpected     （退出码 2）
     现场是 `上传体验版` 那步（`cnb-to6-1k4gaj155`）—— 而它 `allow_failure: true`，
     **不会让流水线红**，得自己翻日志才看得见，这一轮就是这么漏过去的。

     ⚠️ 不用 yaml 库（本仓库没这个依赖）：按缩进做一个够用的判据 ——
     在同一个 `script:` 底下，如果出现过 `- |`（块标量项），后面就不该再出现
     平级的 `- xxx` 普通项。 */
  {
    const lines = cnb.split("\n");
    const offenders = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^\s*script:\s*$/.test(lines[i])) continue;
      const indent = lines[i].search(/\S/);
      let sawBlock = false;
      let name = "";
      for (let k = i - 1; k >= 0 && k > i - 12; k -= 1) {
        const m = lines[k].match(/^\s*- name:\s*(.+)$/);
        if (m) { name = m[1].trim(); break; }
      }
      for (let j2 = i + 1; j2 < lines.length; j2 += 1) {
        const l = lines[j2];
        const ind = l.search(/\S/);
        if (l.trim() && ind <= indent) break; // 出了这个 script 块
        if (/^\s*- \|\s*$/.test(l)) sawBlock = true;
        else if (sawBlock && /^\s*- \S/.test(l) && ind <= indent + 2) {
          offenders.push(name || "(无名 stage)");
          break;
        }
      }
    }
    ok(".cnb.yml 里没有「script list 混着多行块」（会被串成 && 而语法报错）",
      offenders.length === 0,
      "这些 stage 的 script 是 list、且 `- |` 块后面还有普通项：" +
        JSON.stringify(offenders) +
        " —— CNB 会把各项用 `&&` 接上去，Alpine 的 sh 直接 `Syntax error`");
  }


  /* 文档与流水线必须指同一个触发方式。这一条抓的是「改了配置忘了改文档」——
     上一轮的病就是这样：同一份 README 写着打 tag，配置里却已经换了。 */
  const deployDocs =
    setup + fs.readFileSync(path.join(repo, "README.md"), "utf8") +
    fs.readFileSync(path.join(deploy, "README.md"), "utf8");
  ok("部署文档不再教人打 tag 出镜像（触发方式已改为推 main）",
    !/git tag v\d/.test(deployDocs) && !/打 v\* tag/.test(deployDocs) &&
      !/微信小程序云托管\/wx-api:<tag>/.test(deployDocs),
    "文档里还留着打 tag，人会照着做一遍然后发现推不上去（要管理员）");
}

/* ---------- V47. 同步到 GitHub（Issue #71） ----------
 *
 * 这一节守的是「同步真的会跑起来」这件事。它值得单独一节，是因为失败的
 * 每一层都**不像它自己**：
 *
 *   ① 浅克隆 → 报 `remote unpack failed: index-pack failed`
 *      CI 的勾是 `--depth 1`（实测 `git rev-parse --is-shallow-repository` = true）。
 *      浅仓库直接 push，远端回的是
 *          remote: fatal: did not receive expected object 3fb7c19...
 *      看着像「push 太大被拒」或网络问题，其实是**推的那份历史本身不完整**。
 *      现场：621KB 的 pack —— 对一个小程序仓库明显偏小，那才是判据。
 *      所以脚本必须先 `fetch --unshallow`。
 *
 *   ② 凭据形状 → 三种写法里只有一种通
 *      `https://<token>@…`             → git 当用户名，还要问密码（CI 里干等到超时）
 *      `https://x-access-token:<token>@…` → `Invalid username or token`（401，
 *                                          看着像 token 过期，而同一枚打 API 是 200）
 *      `https://<token>:x-oauth-basic@…`  → ✅
 *
 *   ③ 密钥名字对不上 → 与上传体验版同款处理，缺哪个当场说哪个
 *
 * ⚠️ 判据只查**真命令行**，不查注释 —— V46b 那儿踩过：注释里也写着同样的字，
 *    整块搜的话把实现删掉照样绿。
 */
{
  const yml = fs.readFileSync(path.join(path.dirname(__dirname), ".cnb.yml"), "utf8");
  const at = yml.indexOf("- name: 同步到 GitHub");
  ok("`同步到 GitHub` 那步还在", at >= 0, "`.cnb.yml` 里找不到这一步 —— GitHub 那份不会更新");

  const body = at < 0 ? "" : yml.slice(at);
  // 只看真命令行：剥掉行尾注释、丢掉整行注释与空行
  const lines = body.split("\n")
    .map((l) => l.replace(/\s+#.*$/, ""))
    .filter((l) => !/^\s*(#|$)/.test(l));
  const scriptLine = lines.find((l) => /node scripts\/sync-github\.js/.test(l)) || "";

  ok("那步真在跑 scripts/sync-github.js（不是写了段注释摆着）",
    scriptLine.length > 0,
    "真命令行里没调这个脚本（注释里写着不算）");

  // 脚本本体
  const scriptPath = path.join(path.dirname(__dirname), "scripts", "sync-github.js");
  ok("scripts/sync-github.js 在", fs.existsSync(scriptPath));
  const js = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, "utf8") : "";

  // 剥注释：**整行**注释与 `/** ... */` 块。
  // ⚠️ 只剥整行，不剥行尾 —— 行尾那刀会切进代码里的字符串：
  //    这一行是 `const url = \`https://${pat}:x-oauth-basic@…\``，
  //    行尾 `//` 一剥就变成 `const url = \`https:`，断言于是永远红。
  //    （「会不会误伤」这件事没法靠眼睛看出来，上面就是一次实测。）
  // ⚠️ 块注释要**跟着状态走**，不能只按每行长相筛：块里不含 `*` 的行会被漏掉，
  //    而那正是这次踩的地方 —— `git(["fetch", "--unshallow"...])` 删掉之后，
  //    注释里那句「`fetch --unshallow` 在已经完整的仓库上会报错」仍在文件里，
  //    断言照样绿。
  const jsCode = (() => {
    let inBlock = false;
    return js.split("\n")
      .map((l) => {
        if (inBlock) {
          if (/\*\//.test(l)) inBlock = false;
          return "";
        }
        if (/\/\*/.test(l)) {
          if (!/\*\//.test(l)) inBlock = true;
          return l.replace(/\/\*.*$/, "");
        }
        return /^\s*\//.test(l) ? "" : l;
      })
      .join("\n");
  })();

  /* ⚠️ 这条是这一节最要紧的一条：**必须先 unshallow**。
     少了它，CI 里每一次都会死在 `remote unpack failed`，而报错长得像网络问题。

     ⚠️ 判据必须打在 `jsCode` 上，不能打整份 `js`：这条的注释里正举着
     `fetch --unshallow` 讲道理（「已经完整的仓库上会报错」），整份搜的话
     把调用删掉它照样绿 —— 实测过，第一版就是这么写的。 */
  ok("同步前会 unshallow（CI 是 --depth 1，浅仓库直接 push 会 `remote unpack failed`）",
    /--unshallow/.test(jsCode) && /is-shallow-repository/.test(jsCode),
    "脚本里没有 unshallow —— CI 的浅克隆推不上去，且报错像网络问题：" +
      "`remote: fatal: did not receive expected object ...` / `remote unpack failed`");

  /* ⚠️ 只看**真代码行**：上面注释里正举着 `x-access-token:` 与 `--mirror`
     当反例讲（「别这么写」）。整份文件搜的话，把实现删掉它照样绿 ——
     V46b 那儿就是这么踩过一次的，这里是同一个坑的第二处。 */
  ok("凭据形状是 `<token>:x-oauth-basic@`（另两种实测一种问密码、一种回 401）",
    /\$\{pat\}:x-oauth-basic@github\.com/.test(jsCode) && !/x-access-token/.test(jsCode),
    "凭据形状变了 —— 只写 token 会被当成用户名问密码；`x-access-token` 实测回 401");

  ok("关掉了 git 的交互式询问（凭据不对时不能干等到超时）",
    /GIT_TERMINAL_PROMPT/.test(js),
    "没关询问：凭据不对时 git 会卡在等输入，CI 里报出来的是「超时」而不是「凭据不对」");

  ok("缺 GH_PAT / GH_REPO 时当场说清是哪个空着",
    /缺 GH_PAT/.test(js) && /缺 GH_REPO/.test(js),
    "名字对不上会走到 `could not read Username`，看着像网络问题");

  /* ⚠️ 别用 `push --mirror`。它**带删除**：GitHub 上本地没有的引用会被抹掉。
     而 checkout 只给一条分支 —— 全量镜像得先把 80 多个分支 fetch 下来。
     这里守住「没走 mirror」，免得后人觉得「镜像」听着更对就改回去。 */
  ok("没有用 `push --mirror`（它带删除，而 checkout 只给一条分支）",
    !/--mirror/.test(jsCode),
    "改回 --mirror 了：GitHub 上本地没有的分支会被删掉，而 CI 里本地只有一条");

  /* 文档得跟配置对上。这一条抓的是「改了配置忘了改文档」——
     而这里还有一层：**「别在 GitHub 那份上直接提交」这条不写下来，
     人会真的去那边改**，然后下一次同步把改动抹掉，且没有任何提示。 */
  {
    const readme = fs.readFileSync(path.join(path.dirname(__dirname), "README.md"), "utf8");
    ok("README 里写了 GitHub 那份是只读镜像、别在上面直接提交",
      /github\.com\/ashleyzhang2028\/poem-wx/.test(readme) &&
        /别在 GitHub 那份上直接提交/.test(readme),
      "README 没交代这件事 —— 人会去 GitHub 上改，下次同步静默抹掉");
  }

  /* ---------- 推 GHCR 那步要的是 classic PAT（Issue #71 第二轮） ----------
   *
   * 现场是这样的：人去 GitHub 建 fine-grained PAT，在 Permissions 里
   * **翻遍也找不到 Packages 那一栏**，于是不知道该建什么。
   *
   * 答案不是「菜单藏得深」，是**那一栏根本不存在**：GitHub 官方文档原话
   * 「GitHub Packages only supports authentication using a personal access
   * token (classic)」—— `write:packages` 是 classic 的老式 scope。
   *
   * ⚠️ 判据同样只看**真命令行**（剥注释），理由同本节的 ① ②：
   *    这三处的新说明本身就写着 `write:packages`，整份搜的话把实现删掉照样绿。
   */
  {
    const ghcrAt = yml.indexOf("- name: 推 GHCR");
    ok("`推 GHCR` 那步还在（云托管那份公开镜像地址），#96",
      ghcrAt >= 0, "`.cnb.yml` 里找不到这一步 —— 云托管只能填私有地址 + 配凭据");

    const ghcrBody = ghcrAt < 0 ? "" : yml.slice(ghcrAt);
    const ghcrLines = ghcrBody.split("\n")
      .map((l) => l.replace(/\s+#.*$/, ""))
      .filter((l) => !/^\s*(#|$)/.test(l));
    const ghcrCode = ghcrLines.join("\n");

    ok("真命令行里 docker login ghcr.io 用的是 GHCR_USER / GHCR_TOKEN",
      /docker login ghcr\.io -u "\$\{GHCR_USER\}"/.test(ghcrCode) &&
        /GHCR_TOKEN/.test(ghcrCode),
      "凭据名字变了 —— 文档里让人填 GHCR_USER / GHCR_TOKEN 就填不上了");

    /* ⚠️ 这一条守的是「error message 要把 token 类型说出来」。
       少了它，人只会看到「读不到 GHCR_TOKEN」，然后接着去建 fine-grained。 */
    ok("缺 GHCR_TOKEN 时的提示点名「classic」与 `write:packages`",
      /classic/.test(ghcrCode) && /write:packages/.test(ghcrCode),
      "提示里没说 token 类型 —— 人会拿着 fine-grained 一直找不到 Packages 那一栏");

    /* 三份文档都得把这件事写下来，因为它们各自是不同入口：
       README 是总览、wx-cloud-setup 是照着做、deploy/README 是部署那一栏。
       哪一份漏了，从那个入口进来的人就还是会去建 fine-grained。 */
    const docs = {
      "README.md": fs.readFileSync(path.join(path.dirname(__dirname), "README.md"), "utf8"),
      "docs/wx-cloud-setup.md": fs.readFileSync(
        path.join(path.dirname(__dirname), "docs", "wx-cloud-setup.md"), "utf8"),
      "deploy/README.md": fs.readFileSync(
        path.join(path.dirname(__dirname), "deploy", "README.md"), "utf8"),
    };
    for (const [name, text] of Object.entries(docs)) {
      ok(`${name} 说明了 GHCR_TOKEN 要 classic PAT（fine-grained 没有 Packages 这一栏）`,
        /classic/.test(text) && /write:packages/.test(text),
        "这份文档没写 token 类型 —— 从这个入口进来的人还会去找 fine-grained 的 Packages");
    }
  }
}

/* ⚠️ **往哪个 registry 推，就得先登哪个 registry**（Issue #100 第三次现场）。
   现场：`IMAGE` 从 Issue #71 起指向 GHCR，`build & push` 那步的
   `docker push "${IMAGE}"` 跟着往 GHCR 推 —— 可 login 还留在 CNB 制品库上，
   于是必被拒：
       error from registry: denied
   报错只有 `denied` 一行，看着像 PAT 没权限 / 包名被占，**其实压根没登 GHCR**。
   之前 `IMAGE` 指 CNB 时这行 login 恰好是对的，换槽位时漏改了。

   ⚠️ 判据拆成两半，缺一不可：
     ① 有 `docker push` 指向 ghcr.io（URL 或 `${IMAGE}`/`${GHCR}` 这种变量）
     ② 同一个 script 块里在**第一条 push 之前**出现 `docker login ghcr.io`
   只看「全文有没有 login ghcr.io」会被 `推 GHCR` 那步放行 —— 而红的是
   `build & push`（它排在前面，先炸，后面那步根本轮不到跑）。
   所以按**每个 script 块**分别判：块里推了 ghcr 就必须在本块 login。

   ⚠️ 为什么值得单开：这类错有个共同点 —— **推的目标换了、登的目标没换**，
   改一处漏一处，且只在 push main 时才显形（分支推送不跑 build & push）。 */
{
  const yml = fs.readFileSync(path.join(path.dirname(__dirname), ".cnb.yml"), "utf8");
  const jobChunks = yml.split(/\n(?=        - name: )/);
  const bad = [];
  for (const chunk of jobChunks) {
    const name = (chunk.match(/^\s*- name:\s*(.+)$/m) || [])[1] || "(未命名)";
    // 剥掉整行注释与行尾注释，避免说明文字里的 docker login/push 骗过判据
    const code = chunk
      .split("\n")
      .map((l) => l.replace(/\s+#.*$/, ""))
      .filter((l) => !/^\s*#/.test(l));
    const pushIdx = code.findIndex((l) => /docker push\b/.test(l));
    if (pushIdx < 0) continue;
    const pushesGhcr = code.some(
      (l) => /docker push\b/.test(l) && /(ghcr\.io|\$\{GHCR\}|\$\{IMAGE\})/.test(l)
    );
    if (!pushesGhcr) continue;
    const loggedIn = code.slice(0, pushIdx).some((l) => /docker login\s+ghcr\.io/.test(l));
    if (!loggedIn) bad.push(name);
  }
  ok("`docker push` 到 ghcr.io 的每一步都先 `docker login ghcr.io`（否则回 `denied`）",
    bad.length === 0,
    "这些步骤往 ghcr.io 推却没在本步登录：" + JSON.stringify(bad) +
      " —— GHCR 会回 `error from registry: denied`（只有这一行，看着像 PAT 没权限，" +
      "其实是没登）。凭据在流水线级 imports 的 GHCR_USER / GHCR_TOKEN 里，本步直接可用");
}

/* ⚠️ **默认域只能联调**（Issue #100 第四次现场）。
   公众平台那句提示（云托管域名仅用作测试使用）是**警告不是拦截** ——
   不说清，人会一路把默认域填到提审。判据：主路写的是云调用，默认域那节写明只能联调。 */
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

/* ---------- V47. 上游语料：**钉住**，别让别人的发布绊住我们（Issue #111） ----------
 *
 * 现场：`.cnb.yml` 里每个任务第一步都取 poem 的 `main` 头。于是 poem 那边
 * 补录几十条 / 改一版归类，这边 check.js 那张篇数表（K.counts / K.seqMax /
 * KNOWN_HOLES）就当场红 —— **推我们的 main 的时候红，改我们代码的人是受害者，
 * 而错在上游**。那张表的注释里写着「补录之后回来对一次」，就是承认了这件事。
 *
 * 治法（`docs/data-backend.md` § 四）：发布链用 `poem.lock.json` 钉住的那一版；
 * 上游动了由**定时的、独立的**那条流水线自己冒出来（自检绿开 PR 前进锁，
 * 自检红留一条 Issue）。
 *
 * 这一节守的就是这条治法，四条，每条都能单独被改坏：
 *   ① 锁文件在，且形状对（ref 是全 sha / counts 与 K 表逐条一致）
 *   ② 取语料那一步**真的用锁**（不然锁只是个摆设）
 *   ③ 定时任务在，且**不在发布链里**（在发布链里就又回到原来那条路）
 *   ④ 跟上游那个脚本还在（没把它删成一个空的 crontab）
 */
{
  const repo2 = path.join(ROOT, "..");
  const lockPath = path.join(repo2, "poem.lock.json");
  ok("poem.lock.json 在（发布链按它钉住上游）", fs.existsSync(lockPath));

  let lock = null;
  if (fs.existsSync(lockPath)) {
    try { lock = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch (e) { lock = null; }
  }
  ok("poem.lock.json 是合法 JSON", !!lock);
  ok("锁里记的是全 sha（短 sha 钉不住：40 位才唯一）",
    !!lock && /^[0-9a-f]{40}$/.test(String(lock.ref || "")),
    lock ? "ref=" + lock.ref : "");
  ok("锁里写明上游是哪个仓库",
    !!lock && /^[\w.-]+\/[\w.-]+$/.test(String(lock.repo || "")),
    lock ? "repo=" + lock.repo : "");

  /* ⚠️ 锁里的篇数**必须与 check.js 的 K 表逐条一致**。
     这一条不是形式主义：锁与 K 表是同一件事的两处写法 —— 锁说「我钉的是
     哪一版」，K 表说「那一版应该有多少条」。两边对不上，就说明锁前进了而
     K 表没跟上（或者反过来），而**那种状态下自检会是红的**，
     下一次有人推 main 就又踩进原来那个坑。 */
  if (lock && lock.counts) {
    const mismatch = Object.keys(K.counts).filter((k) => Number(lock.counts[k]) !== K.counts[k]);
    ok("锁里的篇数与自检的 K 表逐条一致", mismatch.length === 0,
      "对不上的是：" + JSON.stringify(mismatch.map((k) => k + ": 锁 " + lock.counts[k] + " / K " + K.counts[k])) +
        " —— 锁前进了就回来把 K 表跟着改（见 docs/data-backend.md § 四）");
  }

  // ② 取语料那一步真的用锁
  {
    const sh = fs.readFileSync(path.join(repo2, "scripts", "clone-poem.sh"), "utf8");
    ok("clone-poem.sh 会读 poem.lock.json 并检出那一版",
      /poem\.lock\.json/.test(sh) && /checkout/.test(sh) && /POEM_REF/.test(sh),
      "没读锁的话，锁就是个摆设 —— 取回来的还是上游的头");
    /* 读完锁**要检验**：拿到的 sha 与要的不是同一个时得当场断掉。
       少这一条，锁写错一个字符的结果是「安静地用着别的一版」——
       而那种状态与「锁生效了」在日志里长得一模一样。

       ⚠️ 判据不能只看「`HEAD_SHA` 与 `exit 1` 这两个词都在」：把它们之间的
       那个条件改成 `if false`（或把比较挪到别处），文件里照样有这两个词，
       而锁已经形同虚设 —— 第一版就是这么写的，实测放过去了。
       所以要求那一行的**条件本身**里同时出现比较与 `exit`：
       比较的是 `HEAD_SHA` 与 `REF`，且要在同一个 `if` 里换行到 `exit`。 */
    ok("clone-poem.sh 在拿到的 sha 与锁不一致时当场失败",
      /if\s+\[\s+"?\$\{?REF\}?"?\s*!=\s*"?main"?\s*\][\s\S]{0,120}?HEAD_SHA[\s\S]{0,160}?exit\s+1/.test(sh),
      "那条「要的是 A、拿到的是 B → 退出」的判据不在 —— 锁写错一个字符的结果是" +
        "安静地用着别的一版，而日志里与「锁生效了」一模一样");
  }

  // ③ 定时任务在，且不在发布链里
  {
    const cnb2 = fs.readFileSync(path.join(repo2, ".cnb.yml"), "utf8");
    const py = (() => {
      try { return require("js-yaml"); } catch (e) { return null; }
    })();
    void py;
    /* ⚠️ 这一段的判据**必须按缩进写**，因为这条配置踩过两次：
       ① 顶格另起一个 `crontab:` 键 → 平台报 `CONFIG_EVENT_EMPTY /
          $ 下无 api_trigger 事件配置`（看着像 `$` 段写坏了，其实不是）；
       ② 另起第二个 `main:` → YAML 键重复，**后面那个把前面那个整个盖掉**，
          发布链就此消失，而文件本身看着完全正常。
       两种都解析得出 YAML，所以「能 parse」不是判据，**位置**才是。
       见 https://docs.cnb.cool/zh/build/crontab.md */
    const lines = cnb2.split("\n");
    // 缩进 2 空格的 `"crontab: <表达式>":`，且在 `main:` 之下
    const cronAt = lines.findIndex((l) => /^\s{2}"crontab:\s*\S/.test(l));
    ok("定时任务写在 `main:` 之下（`main: { \"crontab: …\": […] }`）",
      cronAt >= 0,
      "没找到缩进 2 空格的 `\"crontab: <cron>\":` —— 顶格另起一个 `crontab:` 的话，" +
        "平台报的是「$ 下无 api_trigger 事件配置」，与真正的原因差很远");
    // 表达式要是五段 POSIX cron（时区 Asia/Shanghai，最小间隔 5 分钟）
    ok("定时任务的 cron 表达式是五段",
      /^\s{2}"crontab:\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+"\s*:/.test(lines[cronAt] || ""),
      "表达式不是五段 —— CNB 用的是 POSIX cron（分 时 日 月 周）");
    const cronBody = cronAt < 0 ? "" : lines.slice(cronAt).join("\n");
    ok("定时任务跑的就是 poem-watch.sh",
      /poem-watch\.sh/.test(cronBody),
      "crontab 那条里没有跟上游那个脚本");
    /* ⚠️ 顶层键**只能有一个 `main:`**。写成两个，YAML 后者覆盖前者，
       发布链静默消失 —— 而文件本身、`yaml.safe_load`、肉眼，全都看不出问题。 */
    const mainKeys = lines.filter((l) => /^main:/.test(l));
    ok(".cnb.yml 里只有一个 `main:`（重复的话后者会盖掉前者，发布链静默消失）",
      mainKeys.length === 1,
      "找到 " + mainKeys.length + " 处顶格 `main:`");
    const topKeys = lines.filter((l) => /^[A-Za-z$][\w$-]*:/.test(l)).map((l) => l.split(":")[0]);
    ok(".cnb.yml 里没有顶格的 `crontab:`（那个键位置不对，平台解析不到）",
      topKeys.indexOf("crontab") < 0,
      "顶格 `crontab:` 是无效写法 —— 得写成 `main:` 之下缩进 2 空格的 " +
        "`\"crontab: <表达式>\":`");
    /* ⚠️ 反向也要守：**发布链里不许出现跟上游的动作**。
       在发布链里跟一下，就等于又回到「上游一改、我们推 main 就红」那条路上 ——
       治法白做。判据：`main:` 之后、`crontab:` 之前那段里不许有 poem-watch。 */
    const mainAt = lines.findIndex((l) => /^main:/.test(l));
    const publishBody = (mainAt < 0 || cronAt < 0) ? "" : lines.slice(mainAt, cronAt).join("\n");
    ok("发布链（`main:`）里**不**跑跟上游（跑了就又回到原来那条路上）",
      !/poem-watch/.test(publishBody),
      "发布链里出现 poem-watch —— 上游一改，我们推 main 就红，治法白做");

    /* 发布链那几处 clone **必须都走 clone-poem.sh**（它才读锁）。
       直接写 `git clone ... poem.git` 会绕过锁 —— 而那条命令在这里看着也对。 */
    const cloneRaw = publishBody.split("\n")
      .map((l) => l.replace(/\s+#.*$/, ""))
      .filter((l) => /git clone .*poem\.git/.test(l) && !/clone-poem\.sh/.test(l));
    ok("发布链里取 poem 都走 clone-poem.sh（直写 git clone 会绕过锁）",
      cloneRaw.length === 0,
      "这几行绕过了锁：" + JSON.stringify(cloneRaw.slice(0, 2)));
  }

  // ④ 跟上游那个脚本还在，且把四种出口都写在明处
  {
    const w = path.join(repo2, "scripts", "poem-watch.sh");
    ok("scripts/poem-watch.sh 在", fs.existsSync(w));
    if (fs.existsSync(w)) {
      const js = fs.readFileSync(w, "utf8");
      ["same", "ahead", "broke", "unknown"].forEach((v) => {
        ok("跟上游有「" + v + "」这一种出口", js.indexOf(v) >= 0,
          "四种出口各自是一个决定：「没动 / 前进 / 红了要人改 / 没跟成」——" +
            "少一种就会把两件事混成一件");
      });
      ok("红了不合并、不改锁（改的是这边的表，不是上游）",
        /别去改上游|要改的是/.test(js),
        "红了还前进锁，等于把上游的改动直接吃进发布链");
    }
  }

  // ⑤ 文档：这份口径得有人能读到
  {
    const doc = path.join(repo2, "docs", "data-backend.md");
    ok("docs/data-backend.md 在（Issue #111 那三个问题的答案）", fs.existsSync(doc));
    if (fs.existsSync(doc)) {
      const d = fs.readFileSync(doc, "utf8");
      ok("文档回答了「数据在哪」（分层说清，不是一句「在云端」）",
        /build-data\.js|miniprogram\/data/.test(d) && /progress/.test(d),
        "用户问的是「现在数据怎么管的、放在哪里」，得逐层答");
      /* ⚠️ Issue #111 的硬要求：**这个仓库里不再涉及任何第三方托管数据库**。
         这一条是全文扫描 —— 不是「文档里别提」，是**代码与文档都不许有**。
         留着它，下一个人就会照着旧文档把那份配置装回去。 */
      {
        /* ⚠️ 这个名字**不能在源码里整串出现** —— 这一条扫的是全仓库，
           而 check.js 自己就在仓库里。拼出来既能守住「不许有」，也不会自伤。 */
        const banned = new RegExp("supa" + "base", "i");
        const hits2 = [];
        (function walk2(dir) {
          fs.readdirSync(dir).forEach((f) => {
            if (f === ".git" || f === "node_modules") return;
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
            "deploy/store-mysql.js + deploy/sql/mysql-schema.sql，旧名字不该再留");
      }
      ok("文档回答了「存储层在哪、换库要动什么」（接口是一个插槽，不是长在代码里）",
        /store\.js/.test(d) && /mysqlStore/.test(d) && /deploy\/store-mysql\.js/.test(d),
        "不点出「接口是 getX/putX 那组、实现就在 deploy/store-mysql.js」，" +
          "读者会以为「换掉数据库 = 重写后端」");
      ok("文档给出了腾讯那条路的三个方案与各自代价",
        /云托管/.test(d) && /云开发/.test(d) && /MySQL/.test(d),
        "只说「可以换成腾讯云」没有用，得把三条路摆开、把代价写下来");
      /* 条件写入这条**必须**写下来：它是这个项目唯一一条下沉到数据库的正确性约束，
         换库时最容易被「等价改写」成应用层的读-比-写，而那有竞态。 */
      ok("文档点明了条件 upsert（新的赢）这条不变式在换库时该怎么保",
        /kb_upsert_progress/.test(d) && /ON DUPLICATE KEY|条件/.test(d),
        "换库时把「新的赢」捞到应用层，等于把一条原子约束换成有竞态的读-比-写");
      ok("文档写明了「换数据库不是审核的要求」",
        /审核/.test(d) && /备案/.test(d),
        "用户提这件事的动机是「怕审核出问题」，那句话得如实回答");
    }

    /* README 与架构文档得有路标 —— 三份文档各自是不同入口，
       哪一份漏了，从那个入口进来的人就还是会重问一遍。 */
    const readme2 = fs.readFileSync(path.join(repo2, "README.md"), "utf8");
    ok("README 指向 docs/data-backend.md（数据在哪、CI 为什么会被上游绊住）",
      /data-backend\.md/.test(readme2),
      "README 是总览入口，不指过去就等于没有这份文档");
    const arch = fs.readFileSync(path.join(repo2, "docs", "architecture.md"), "utf8");
    ok("architecture.md 指向 docs/data-backend.md",
      /data-backend\.md/.test(arch),
      "架构文档里那节「数据存哪」是这个问题最自然的入口");
    /* 换库这条**不再是「按需」**了 —— 它已经做完了（Issue #111）。
       所以这里反着守：todo 里不许再把它列成一件「以后要做」的事，
       那份口径在 data-backend.md § 六 里（状态 ✅ 已做）。 */
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

/* ---------- V49. 存储层换到腾讯云 MySQL（Issue #111） ----------
 *
 * 用户的诉求：「我希望这个仓库的所有代码和文档中不要再涉及（那个第三方托管
 * 数据库）」—— 名字本身也不许留，所以下面那条全仓库扫描是**拼字符串**跑的。
 *
 * 换库这件事落在两处：`deploy/store-mysql.js`（那组 getX/putX 的 MySQL 实现）
 * 与 `deploy/sql/mysql-schema.sql`（建表语句）。这一节守的是**它们真的能替上**，
 * 而不是「文件在」。
 *
 * 四层判据，缺一层这一节就只是「文件存在性检查」：
 *   ① **形状对**：mysqlStore 把 memoryStore 的每一个方法都实现了
 *      （少一个 = 运行到那条路由才炸，而那条路由可能几周才走一次）
 *   ② **条件 upsert 没被写成读-比-写**：这是整个存储层唯一一条不能「等价改写」
 *      的地方（换库时最容易踩，而且踩了不报错）
 *   ③ **真跑一遍语义**：把那条 ON DUPLICATE KEY UPDATE 的赋值逻辑抽出来，
 *      拿「旧的补发 / 新的 / 同一毫秒」三种输入走一遍，看「新的赢」还在不在
 *   ④ **建表语句覆盖 store 用到的每一张表**：少一张就是运行时报
 *      `ER_NO_SUCH_TABLE`，而那可能发生在登录之后很久
 */
{
  const repo4 = path.join(ROOT, "..");
  const storePath = path.join(repo4, "deploy", "store-mysql.js");
  const sqlPath = path.join(repo4, "deploy", "sql", "mysql-schema.sql");

  ok("deploy/store-mysql.js 在（腾讯云 MySQL 那份实现）", fs.existsSync(storePath));
  ok("deploy/sql/mysql-schema.sql 在（建表语句）", fs.existsSync(sqlPath));

  const st = fs.existsSync(storePath) ? fs.readFileSync(storePath, "utf8") : "";
  const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, "utf8") : "";

  /* ① 形状：与 memoryStore 逐方法对齐。
     ⚠️ 拿得到的 memoryStore 源码来对 —— 这是「同一组方法名」的唯一权威出处。
     poem 不在本地时跳过并说明，不假装验过。 */
  {
    const webDir = process.env.POEM_WEB_DIR || "/tmp/poem";
    const poemStore = path.join(webDir, "api", "_lib", "store.js");
    if (!fs.existsSync(poemStore)) {
      console.log("· 读不到 poem 的 store.js（" + poemStore + "）—— V49 的形状那几条跳过。");
    } else {
      const src = fs.readFileSync(poemStore, "utf8");
      const mem = /function memoryStore\(\)[\s\S]*?\n}\n/.exec(src);
      const names = mem ? [...mem[0].matchAll(/^    ([A-Za-z_$][\w$]*): function/gm)].map((m) => m[1]) : [];
      // attach* 那几组（报告 / 勘误 / 反馈 / 考试）是挂上去的
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

  /* ② 条件 upsert：不许写成读-比-写。
     ⚠️ 这一条抓的是**最容易被「等价改写」掉的那一处**：
     Postgres 的条件写在 `WHERE` 上，MySQL 没有 `WHERE`，于是有人会想
     「那我先 SELECT 一下比较再 UPDATE 不就行了」—— 那有竞态，而且不报错。
     判据：那一句里 `IF(VALUES(updated_at)` 与 `GREATEST(updated_at` 都在，
     且**没有** `SELECT` 掺进 putProgress 里。 */
  {
    const i = st.indexOf("putProgress: function");
    const j = st.indexOf("deleteProgress: function");
    const body = i < 0 ? "" : st.slice(i, j < 0 ? i + 2400 : j);
    ok("putProgress 里是**一句**条件 upsert（不是读-比-写）",
      /ON DUPLICATE KEY UPDATE/.test(body) && body.indexOf("SELECT") < 0,
      "putProgress 里出现了 SELECT —— 「先读、比一下、再写」不是原子的，正是" +
        "当初把「新的赢」下沉到数据库的原因（见 data-backend.md § 三.3）");
    ok("条件 upsert 逐列都写了 IF / GREATEST（少一列 = 一半新一半旧的坏行）",
      /`?payload`?\s*=\s*IF\(VALUES\(`?updated_at`?\)\s*>=\s*`?updated_at`?/.test(body) &&
        /`?updated_at`?\s*=\s*GREATEST\(`?updated_at`?,\s*VALUES\(`?updated_at`?\)\)/.test(body) &&
        /`?deleted`?\s*=\s*IF\(VALUES\(`?updated_at`?\)\s*>=\s*`?updated_at`?/.test(body),
      "三列里有一列没写条件 —— 只给 payload 加 IF、把 updated_at 无条件盖上去，" +
        "会造出「payload 是旧的、updated_at 是新的」这种行，它下一次还会顶掉真正的新值");
    ok("建表语句里也留了一份同口径的 kb_upsert_progress（给 DBA 手动核对用）",
      /kb_upsert_progress/.test(sql) &&
        /IF\(VALUES\(`?updated_at`?\)\s*>=\s*`?updated_at`?/.test(sql),
      "建表语句里那份丢了 —— 冷启动补数据 / DBA 核对时会用错口径");
  }

  /* ③ **真跑一遍语义**。把那一句 SQL 的赋值逻辑抽出来，喂三种输入：
        · 旧的补发（断网重连）→ 不许覆盖
        · 新的             → 赢
        · 同一毫秒         → 按 >= 也算赢（与 Postgres 那句一致）
     这不是「假装跑了 MySQL」，而是把**那一句的语义**单独验 ——
     真的 MySQL 要等部署到云托管才跑得到。上面 ② 验形状，这里验行为。 */
  {
    const IF = (c, a, b) => (c ? a : b);
    const upsert = (row, vals) => {
      const accepted = vals.updated_at >= row.updated_at;
      return {
        payload: IF(accepted, vals.payload, row.payload),
        updated_at: Math.max(row.updated_at, vals.updated_at),
        deleted: IF(accepted, vals.deleted, row.deleted)
      };
    };
    const base = { payload: { level: 5 }, updated_at: 100, deleted: 0 };
    const older = upsert(base, { payload: { level: 2 }, updated_at: 50, deleted: 0 });
    ok("「新的赢」：旧的补发不覆盖（payload 与 updated_at 都不许被顶）",
      older.payload.level === 5 && older.updated_at === 100,
      "旧值盖掉了新值 —— 断网重连后一批旧数据补发时就是这个症状");
    const newer = upsert(base, { payload: { level: 9 }, updated_at: 150, deleted: 0 });
    ok("「新的赢」：更新的一份赢",
      newer.payload.level === 9 && newer.updated_at === 150, JSON.stringify(newer));
    const same = upsert(base, { payload: { level: 7 }, updated_at: 100, deleted: 0 });
    ok("同一毫秒按 `>=` 接受（与 Postgres 那句口径一致）", same.payload.level === 7);
  }

  /* ③.5 接线：这份实现**得真的被接上**，否则文件写得再对也不生效。
     接线在 `serve-api.js`（这份镜像的入口）里 —— poem 的 `store.js` 是网页版的，
     不该认识 MySQL；「小程序的库是腾讯云 MySQL」是这份部署自己的事。

     三件事一起守（每一件漏了都是「能登录、能同步，一重启全没了」那一类）：
       · 接在 require handler **之前**（handler 在 require 时就取单例）
       · 认 `MYSQL_HOST` 才接，没配就如实退回（「配一半」最难查）
       · 没装 mysql2 时**出声**，不静默退回内存档 */
  {
    const servePath = path.join(repo4, "deploy-api-serve", "serve-api.js");
    const serve = fs.existsSync(servePath) ? fs.readFileSync(servePath, "utf8") : "";
    ok("serve-api.js 里接了存储层（不接的话那份实现只是个没人读的文件）",
      /wireMysqlStore/.test(serve) && /store-mysql\.js/.test(serve),
      "serve-api.js 里没有接线 —— poem 的 store.js 是网页版那份，" +
        "MySQL 这个选择必须落在这份部署的入口上");
    {
      /* ⚠️ 先摘注释：上面那段「这一行必须在 wireMysqlStore() 之后」的注释里
         正引着这个名字，直接 indexOf 会拿到注释那处的位置（这条第一版就这么
         假绿过 —— 接线挪到 handler 后面，断言照样是绿的）。 */
      const bareServe = serve.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const callAt = bareServe.indexOf("\nwireMysqlStore();");
      const handlerAt = bareServe.indexOf('require("./api/handler.js")');
      ok("接线在 require handler **之前**（handler 在 require 时就取单例）",
        callAt >= 0 && handlerAt >= 0 && callAt < handlerAt,
        "接在 handler 后面（callAt=" + callAt + " handlerAt=" + handlerAt + "）—— " +
          "那时单例已经建好了，接上去也不生效。摘掉注释之后再判，别被注释里的名字骗过");
    }
    ok("没配 MYSQL_HOST 时如实退回，不硬接（「配一半」最难查）",
      /if\s*\(!host\)/.test(serve) && /退回/.test(serve),
      "没配也硬接 —— 会得到一个连不上的池，而症状是「全都 500」，指向完全无关的地方");
    ok("镜像里没有 mysql2 时**出声**（不静默退回内存档）",
      /没有 mysql2/.test(serve),
      "静默退回的样子是「能登录、能同步，但一重启全没了」—— 那是最难查的一类");
    /* ⚠️ 镜像里必须真的装了 mysql2，否则上面那句「出声」就是常态。
       判据落在 Dockerfile 的 `npm install ... mysql2` 上。 */
    const df2 = fs.readFileSync(path.join(repo4, "deploy", "Dockerfile"), "utf8");
    ok("Dockerfile 里装了 mysql2（不装的话上面那句「出声」就是常态）",
      /npm install[^\n]*mysql2/.test(df2),
      "镜像里没有 mysql2 → 配了 MYSQL_HOST 也只能退回内存档，每次重启丢数据");

    /* ⚠️ **行为层那一条必须真的在跑**。
       V49 上面这些验的是「形状」（方法齐、语句对、接线在前）——
       而形状对、语义错是可能的（`>=` 写成 `>`、`GREATEST` 写成 `VALUES`）。
       语义只有 `scripts/e2e-mysql.js` 验得了，所以它得挂进 CI，
       且 CI 里跑的是**它自己**，不是「一个同名的别的东西」。 */
    const cnb3 = fs.readFileSync(path.join(repo4, ".cnb.yml"), "utf8");
    ok("CI 里真的跑了 e2e-mysql（形状那几条验不了语义）",
      /e2e-mysql\.js/.test(cnb3),
      "流水线里没有 e2e-mysql —— 那条「新的赢」在换库后还在不在，就没人验了");
    ok("scripts/e2e-mysql.js 与它的假 MySQL 都在",
      fs.existsSync(path.join(repo4, "scripts", "e2e-mysql.js")) &&
        fs.existsSync(path.join(repo4, "scripts", "mysql-facade.js")),
      "脚本在，但那个内存替身没了 —— 跑起来会 require 不到 mysql2/promise");

    /* ⚠️ **列名拼进 SQL 是一道真的注入面**。
       MySQL 的 `?` 只管值，表名与列名只能拼字符串 —— 所以那些名字必须过闸。
       原来那个实现（走 PostgREST）没有这个问题：列名放在 URL 上、由那边解析。
       换库时这一步是**新出现**的风险，而它默认不报错（拼错了才发现）。

       ⚠️ 判据落在**「有没有机会出现在那句 SQL 里」**上，不落在「抛没抛」上 ——
       两道闸是叠加的：白名单（`pickCols`）先滤掉不该写的列，标识符闸
       （`assertIdent`）再兜住剩下那些。所以「抛出来」与「被滤掉」都算过，
       只有「拼进去了」才算错。这样断言不绑死在某一层实现上。

       ⚠️ 这一节是**同步**跑的（check.js 是一路读下来 + `process.exit`），
       而 `query` 回来的是 promise。所以假 query **在调用那一刻就记下 SQL**
       （不在 then 里）—— 同步记录，就不需要等微任务。
       （第一版用 `beforeExit` 收尾，而 check.js 结尾是 `process.exit`，
        那个回调**从来没跑过**，断言静默消失。两处都实测过。） */
    try {
      const { mysqlStore } = require(path.join(repo4, "deploy", "store-mysql.js"));
      const sent = [];
      // 关键：`query` 里**同步** push（不是在 .then 里），所以下面读得到
      const fake = { query: (sql) => { sent.push(String(sql)); return Promise.resolve([[], []]); } };
      const s2 = mysqlStore({ mysql: fake });
      const EVIL = '" ; DROP TABLE accounts; --';
      const safeCall = (fn) => { try { fn(); } catch (e) { /* 抛出来也算过，见上 */ } };

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

  /* ④ 建表语句覆盖 store 用到的每一张表。少一张就是 `ER_NO_SUCH_TABLE`，
     而那可能发生在登录之后很久（比如用户第一次提交反馈）。 */
  {
    const tables = ["accounts", "wx_accounts", "codes", "sessions", "progress",
      "verifications", "resets", "reports", "pinyin_proposals",
      "feedback_threads", "feedback_comments", "exam_records"];
    const missingTables = tables.filter((t) => sql.indexOf("CREATE TABLE IF NOT EXISTS `" + t + "`") < 0);
    ok("建表语句里有 store 用到的每一张表（少一张 = 某条路由 ER_NO_SUCH_TABLE）",
      missingTables.length === 0, "缺：" + JSON.stringify(missingTables));
    /* 「新的赢」那条约束靠主键 (uid, child_id, poem_id) —— 主键列写错一位，
       条件 upsert 就成了「每来一条都插一行新的」，而数据看着还在。 */
    ok("progress 的主键是 (uid, child_id, poem_id)（条件 upsert 的 on-conflict 靠它）",
      /PRIMARY KEY \(`uid`, `child_id`, `poem_id`\)/.test(sql),
      "主键列不对 —— 条件 upsert 会变成「每来一条插一行」，而数据看着还在");
    /* 会话那一列：微信登录刷新那条路要按 refreshToken 找回这一行。 */
    ok("sessions 表有 refresh_token 那一列（刷新那条路要靠它找回会话行）",
      /`refresh_token`/.test(sql),
      "没有这一列，刷新永远验不过 —— 而客户端只会看到「登录过期了」");
  }

  /* ⑤ 「库」与「表」是两件事，而**库不在任何一条建表语句里**。
     实例自带的只有 MySQL 自己的那几个库（`information_schema` /
     `performance_schema` / `mysql` / `sys` / `__cdb_recycle_bin__`），
     所以照文档走的人在 DMS 里只看得见系统库 —— 卡住的不是建表语句，
     是文档少说了「先建库、执行前切库」这一步。

     这一条守的是**那条命令与代码里的默认库名是同一个**：
     文档写 `CREATE DATABASE poem` 而 `serve-api.js` 里默认回落 `poem-db`，
     两份文件各自看都对，合起来是 `ER_BAD_DB_ERROR` —— 而进程照起、
     `[store] 存储层 = …` 那行照打，症状是「看着配好了但登录一律 500」。
     钉住名字 + 钉住两句命令都在，缺一不可：只钉名字，文档里那两句命令被人
     删掉时没人知道；只钉命令，名字改歪了也没人知道。 */
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

  /* ⑥ 「云调用两栏」那一步的两个坑 —— Issue #111 上第二个照文档走的人问出来的：

     坑一：**谁看得到那一块**。文档只写「小程序 → 我的 → 用户与权限 → 拉到底」，
     读起来像「所有用户都能填」。实际那张卡在管理页里，而管理页整块裹在
     `wx:if="{{!logged}}"` 的 else 中 —— 普通用户看到的只有「我的授权」。
     漏写这一句的代价：admin 之外的人照着找，找不到，然后怀疑是自己点错了地方。

     坑二：**服务名被当成固定值**。文档举例 `poem-api`，而实际部署是 `poem-wx`；
     照抄示例 = 平台回 `service not found` = 看着像服务没部署。
     所以这一条同时钉「文档里有那句以实际为准」与「举例值就是当前部署的名字」。

     顺带守第三条：那两格是**本机存储**、不是平台配置项 —— 不写清的话，
     下一个人会去 mp 后台翻配置项，或者以为「别人填了会动到线上」。 */
  {
    const doc = fs.readFileSync(path.join(repo4, "docs", "wx-cloud-setup.md"), "utf8");
    const arch = fs.readFileSync(path.join(repo4, "docs", "architecture.md"), "utf8");

    ok("文档写清了「云调用那两格只有 admin/owner 看得到」",
      /(admin|owner)/.test(doc) && /(普通用户|Free|free)/.test(doc) &&
        /云调用/.test(doc),
      "只写「我的 → 用户与权限 → 拉到底」会被读成「所有用户都能填」—— " +
        "而那张卡在管理页里，普通用户翻到那一页只有「我的授权」。");

    /* 判据要落在 § 6.1 那**两格所在的那张表**与那句「以实际为准」上。
       第一版写成「全文出现 poem-wx 即可」——实测**没抓住** mutation：
       文件别处（默认域那节）本来就写着 poem-wx，所以把举例改回 poem-api、
       删掉那句话，断言照样绿。看条件本身，不看词。 */
    const svcRow = /\|\s*`X-WX-SERVICE`\s*\|[^\n]*?poem-wx/.test(doc);
    ok("文档 § 6.1 的服务名举例就是当前部署的名字（不是 poem-api）",
      svcRow,
      "§ 6.1 那格里举例 `poem-api` 而实际部署是 `poem-wx` —— 照抄示例会得到" +
        "`service not found`，症状是「看着像服务没部署」");
    /* 这一条要落在 **§ 6.1 那一节里**，不能全文搜。
       第一版写成全文搜「服务名…以…为准」——实测**没抓住**：排错表那行
       「填云托管服务名，逐字以「服务管理」里那个为准」也命中，
       于是把 § 6.1 里那句删掉、断言照样绿。要它守的是「读 § 6.1 的人
       看得到这句」，那就得只在 § 6.1 里找。 */
    const s61 = doc.slice(doc.indexOf("### 6.1"), doc.indexOf("### 6.2"));
    ok("§ 6.1 里写了「服务名以实际建的那个为准」",
      /服务名[^\n]{0,30}(不是固定值|以[^\n]{0,20}为准)/.test(s61),
      "§ 6.1 只给一个名字不写「以实际为准」，人会把举例当标准值 —— " +
        "换个人建服务叫别的名字，就照着文档抄错");

    ok("架构文档也说清了那两格归 admin、且是本机存储",
      /用户与权限[\s\S]{0,200}(admin|owner)/.test(arch) &&
        /本机/.test(arch),
      "architecture.md 只说「填两栏」，没交代谁能填、值在哪 —— " +
        "读的人会以为那是个平台配置项");
  }
}

/* ---------- V50. 头像那枚原生 button：尺寸不许从它身上过 ----------------------
 *
 * 用户 2026-10-04 报了**两次**，「我的」页身份卡里那枚头像都成了一枚扁椭圆。
 * 两次的根子是同一个 —— 带 `open-type="chooseAvatar"` 的头像必须是原生
 * `<button>`，而原生 button 有两条自作主张的默认：
 *
 *   ① 它自带 `display:block` 与 `width:100%`，**盖过**页面样式表给的固定宽。
 *      第一次的报障就是它：height 生效、width 被撑满一行 → 扁椭圆。
 *   ② 它里面**解析不了 `height:100%`**。第二次（合并 #122 之后）就是它：
 *      页面把尺寸挪到了 `.avatar-wrap`、button 改成 `height:100%`，
 *      宽度那条链活了下来（量出来正好 112rpx 宽），高度那条断在 button 上，
 *      里面的 `<image>` 于是按**自己那张图的固有比例**排高度 ——
 *      一张横构图头像排成 164×约 124 的横条，配上 `border-radius:50%`
 *      又是一枚扁椭圆；`aspectFill` 再从横条里取中段，用户看着就是
 *      「只显示了左侧一点」。（现场截图逐像素量过：壳是正圆 164×164，
 *      里面的灰底是 164×约 126 的椭圆 —— 高度少了约 38px。）
 *
 * 治法一层，两条默认一起绕开：**尺寸只定在壳上（`.avatar-wrap`，position:relative
 * + overflow:hidden），按钮与头像本体一律 position:absolute 贴满壳、
 * 尺寸写字面量**。绝对定位 + 字面量之后，高度既不吃 button 的百分比解析，
 * 也回不到「按图固有比例」那条路 —— 与原生怎么算无关。
 *
 * 这一节守两件：
 *   A. 全站凡 `<button>` 用到的类里写了固定 width（rpx/px，非 100%/auto），
 *      那么它的类集合里必须有一个声明了 flex/inline-flex，否则真机上会被
 *      原生 width:100% 撑开。（`.btn` 靠 `display:flex` 过关：flex 项按内容定宽。）
 *   B. 头像那一坨里，`.avatar` 的 height **不许**再写百分比 —— 它会在
 *      原生 button 那一环断掉；同时壳要 position:relative、头像要
 *      position:absolute 且尺寸是字面量。少了任何一条，椭圆就会回来。 */
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
  /* 同一个类可能在 app.wxss 或页面样式表里定义 —— 两处都要认 */
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
      /* 只要类集合里有任何一个声明了 flex，原生 block 的 100% 就管不着了 */
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

  /* 反向确认治法还在。三样缺一不可：
     ① 壳定尺寸 + relative + 裁进圆；② 头像本体 absolute + 尺寸写字面量；
     ③ 头像本体的 height 不是百分比（老写法就是在这儿断的）。 */
  const mineWxss = fs.readFileSync(path.join(ROOT, "pages/mine/mine.wxss"), "utf8");
  const wrap = ruleOf(mineWxss, "avatar-wrap");
  const btn = ruleOf(mineWxss, "avatar-btn");
  const av = ruleOf(mineWxss, "avatar");
  ok("头像的壳自己定尺寸、当包含块、且把溢出裁进圆（.avatar-wrap）",
    !!wrap && /width\s*:\s*112rpx/.test(wrap) && /height\s*:\s*112rpx/.test(wrap) &&
      /overflow\s*:\s*hidden/.test(wrap) && /border-radius\s*:\s*50%/.test(wrap) &&
      /position\s*:\s*relative/.test(wrap),
    "壳上少了定尺寸 / 裁剪 / position:relative 中的哪一条 —— 椭圆就会回来");
  ok("头像 button 自己不定尺寸，只贴满壳（absolute）",
    !!btn && /position\s*:\s*absolute/.test(btn) &&
      /width\s*:\s*100%/.test(btn) && /height\s*:\s*100%/.test(btn) &&
      !/[^-]width\s*:\s*112rpx/.test(btn),
    "button 又自己定死尺寸了 —— 它在真机上盖过页面样式表，看着像改了其实没改");
  ok("头像本体的尺寸写字面量、且不写 height 百分比（真机上那条链会断）",
    !!av && /position\s*:\s*absolute/.test(av) &&
      /width\s*:\s*112rpx/.test(av) && /height\s*:\s*112rpx/.test(av) &&
      !/[^-]height\s*:\s*100%/.test(av) && !/[^-]width\s*:\s*100%/.test(av),
    "头像本体又回到「100% 尺寸」那一套 —— 原生 button 里 height:100% 解析不出来，" +
      "图片会按自己的固有比例排成一根横条，就是那枚扁椭圆");
}

/* ---------- V51. 登录态的首页得真的渲染出今日计划（不是「不报错就行」）----------
 *
 * 用户 2026-10-04 的第二条报障：「没有任何诗词数据显示在小程序中」。
 *
 * 成因是一处解冲突留下的烂尾：`pages/home/home.js` 的 `refresh()` 里被删掉了
 * `const view = {...}`，却留下 `view.grade / view.term / view.scope` 三处引用。
 * 登录用户一进首页就 `ReferenceError: view is not defined` —— 整个 `refresh()`
 * 在那三行上炸掉，`setData` 到不了，于是今日安排、三个大数字、进度条全都不渲染，
 * 看着就是「没有数据」。（游客那一支在 method 开头就 return 了，不碰 `view`，
 * 所以只有**登录后**才看得出来 —— 用户原话正是「登录进去了，但是…」。）
 *
 * 为什么现有的检查都没拦住：它们问的是「这个词出现过没有」——
 * `view` 在页面里出现过 ✅、`refresh` 被 `onShow` 调过 ✅。**「出现过」与
 * 「跑起来会不会炸」是两回事**（与 V10 那条教训同源）。
 * 而 V10 那张 GATED 表里没有首页（首页的开关叫 `logged`/`guest`，不叫 `locked`），
 * 所以它连真跑都没真跑到首页。
 *
 * 这一节换成**真跑**：按「已登录」挂起首页，跑 onLoad + onShow，
 * 断言 ① 没抛 ② 今日计划非空。判据落在「有没有内容」上，不落在「有没有那个词」上。
 */
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

/* ---------- 汇总 ---------- */

/* 先等所有异步断言跑完 —— 不等就会像 `process.exit` 那样把它们一起切掉（见文件头上 `track`）。 */
Promise.all(pending).then(() => {
  console.log("");
  console.log("检查 " + checks + " 项，失败 " + fails + " 项");
  process.exit(fails ? 1 : 0);
});
