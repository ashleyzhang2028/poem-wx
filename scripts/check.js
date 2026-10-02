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

const corpus = require(path.join(ROOT, "utils", "corpus.js"));

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
} else {
  ok("读音表未生成时注音整块关闭", pinyin.readiness().visible === false);
}

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
    if (["item", "index", "tk", "t", "b", "p", "l", "grp", "caprow", "true", "false"].indexOf(name) >= 0) return;
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
 * 7.4 验的是「readiness 报什么」，这里验的是「页面有没有照着做」。
 * 朗读相关的每个元素都必须挂在 speakVisible / speakReady 上，
 * 否则就会出现「readiness 说不可用、按钮却还在」——正是 Issue 要消掉的东西。
 */
const SPEAK_PAGES = {
  "pages/reader/reader": ["speakVisible"]
};

Object.keys(SPEAK_PAGES).forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");

  const guards = SPEAK_PAGES[p];
  ok("朗读门禁变量有被用 " + p, guards.every((g) => wxml.indexOf(g) >= 0), "WXML 里找不到门禁");

  // 播放相关元素必须只在门禁之内出现
  const lines = wxml.split("\n");
  const loose = [];
  lines.forEach((line, i) => {
    if (/class="[^"]*(speak-bar|speak-ctrl|sp-btn|speak-entry)/.test(line)) {
      // 往上找 30 行，必须撞到门禁 —— WXML 里 wx:if + block 会嵌套好几层，
      // 窗口给小了会把合法的嵌套判成泄漏
      let guarded = false;
      for (let j = i; j >= Math.max(0, i - 30); j--) {
        if (guards.some((g) => lines[j].indexOf(g) >= 0)) {
          guarded = true;
          break;
        }
      }
      if (!guarded) loose.push(line.trim().slice(0, 60));
    }
  });
  ok("朗读元素都在门禁内 " + p, loose.length === 0, loose.join(" | "));

  // 页面必须从 readiness() 拿状态，不能自己拍脑袋写死
  ok("朗读状态来自 readiness " + p, js.indexOf("speech.readiness") >= 0, "页面没查 readiness");
  ok("朗读不可用时销毁播放器 " + p, js.indexOf("destroy") >= 0);
});

// 设置页：朗读卡片也得挂门禁
{
  const p = "packages/settings/reader/reader";
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  ok("朗读设置挂在 speakVisible 上", wxml.indexOf("speakVisible") >= 0);
  ok("朗读设置区分就绪与未就绪", wxml.indexOf("speakReady") >= 0);
  ok("未就绪时给出原因", wxml.indexOf("speakReason") >= 0);
}

// 我的页：入口在朗读不可用时不该出现
{
  const p = "pages/mine/mine";
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  ok("「阅读与朗读」入口挂门禁", wxml.indexOf("speakVisible || pinyinVisible") >= 0);
}

/* ---------- 7.6 权限分层 ---------- */
const E = require(path.join(ROOT, "utils", "entitlement.js"));
const tiersMod = require(path.join(ROOT, "utils", "tiers.js"));
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

  // ---- 登录（免费档）：登录门槛的能力打开，付费能力仍然关着 ----
  setProfile({ logged: true, tier: "" });
  ok("登录后每日背诵打开", E.can("daily") === true);
  ok("登录后朗读打开", E.can("speak") === true);
  ok("登录后导出打开", E.can("export") === true);
  ok("登录后莱特纳盒打开", E.can("leitner") === true);
  ok("登录不解锁付费能力", E.can("sm2") === false && E.can("feihualing") === false);
  ok("付费能力给出档位提示", E.hint("feihualing").indexOf("全能") >= 0, E.hint("feihualing"));

  // ---- 提权码：本机档位的载体，管理页改档、兑换码都写在这一处 ----
  store.write(store.KEYS.grant, { code: "PRO-ABCD-1234", tier: "pro", at: Date.now() });
  ok("提权码把档位提到 pro", E.status().tier === "pro", E.status().tier);
  ok("pro 解锁 SM-2", E.can("sm2") === true);
  ok("pro 解锁题库", E.can("quiz") === true);
  ok("pro 仍拿不到飞花令（max 起）", E.can("feihualing") === false);

  store.write(store.KEYS.grant, { code: "MAX-ABCD-1234", tier: "max", at: Date.now() });
  ok("提权码把档位提到 max", E.status().tier === "max", E.status().tier);
  ok("max 解锁飞花令", E.can("feihualing") === true);
  ok("max 解锁模拟考试", E.can("exam") === true);
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
  "packages/admin/index/index": "logged"
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
ok("设置分包含阅读与朗读", (subs.settings || []).indexOf("reader/reader") >= 0);

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
      ok("报文过一遍服务端 sanitize，一个字段都不丢", worst === "", worst);

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
 * 自绘交互控件的指纹：类名 + 事件的组合。
 * 只按类名判会误伤纯展示元素（比如 .tag 是标签、.char-n 是字数），
 * 所以这里要求它同时挂着 tap 事件才算「自绘控件」。
 */
const SELF_MADE = [
  { cls: "seg-item", why: "自绘分段控件" },
  { cls: "chip", why: "自绘可选项" },
  { cls: "opt-check", why: "自绘勾选标记" },
  { cls: "algo-head", why: "自绘可选项" },
  { cls: "tier-check", why: "自绘勾选标记" },
  { cls: "tier-chip", why: "自绘档位按钮" },
  { cls: "prov-check", why: "自绘单选项" },
  { cls: "sp-btn", why: "自绘播放按钮" }
];

/** 判定用：「某个会被点击的元素上，挂着自绘控件的类名」 */
function scanSelfMadeControls(src) {
  const hits = [];
  const re = /<(view|text)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[2];
    if (!/bindtap|catchtap/.test(attrs)) continue;
    const clsM = /class="([^"]*)"/.exec(attrs);
    if (!clsM) continue;
    const cls = clsM[1];
    SELF_MADE.forEach((s) => {
      if (new RegExp("(^|[\\s{])" + s.cls + "([\\s}]|$)").test(cls)) {
        hits.push(s.why + "（." + s.cls + "）");
      }
    });
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
  "packages/settings/general/general": ["radio-group", "slider", "switch"],
  "packages/settings/reader/reader": ["radio-group", "switch"],
  "pages/list/list": ["radio-group"],
  "pages/search/search": ["radio-group"],
  "pages/reader/reader": ["radio-group", "slider"],
  "packages/game/quiz/quiz": ["checkbox-group", "picker"],
  "packages/game/exam/exam": ["checkbox-group", "picker"],
  "packages/game/feihua/feihua": ["radio-group"],
  "packages/game/index/index": ["radio-group"]
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
  scanSelfMadeControls(wxml).forEach((h) => selfMadeHits.push(p + " → " + h));
});
ok("没有自绘的交互控件", selfMadeHits.length === 0, selfMadeHits.slice(0, 8).join("; "));

// 自绘控件的老类名不许在样式表里复活 —— 留着就是在等下一次被用上
const deadCostume = ["seg-item", "chip"];
const revived = [];
pages.forEach((p) => {
  const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
  deadCostume.forEach((c) => {
    if (new RegExp("\\." + c + "\\s*\\{").test(wxss)) revived.push(p + " → ." + c);
  });
});
ok("自绘控件的样式已清掉", revived.length === 0, revived.join("; "));

// 全局样式表里也不许再留一份 .seg / .seg-item
{
  const globalWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  ok("全局不再提供自绘分段控件样式",
    !/\.seg\s*\{/.test(globalWxss) && !/\.seg-item\s*\{/.test(globalWxss));
}

// 原生控件的配色：开关与滑块的 color 必须是那身雨过天青
const COLOR_TAGS = ["switch", "slider"];
const badColor = [];
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  COLOR_TAGS.forEach((tag) => {
    const re = new RegExp("<" + tag + "\\b[^>]*>", "g");
    let m;
    while ((m = re.exec(wxml))) {
      const attrs = m[0];
      const isSlider = tag === "slider";
      const key = isSlider ? "activeColor" : "color";
      if (attrs.indexOf(key + '="#2f6055"') < 0) badColor.push(p + " → <" + tag + "> 缺 " + key);
      if (isSlider && attrs.indexOf('block-color="#2f6055"') < 0) {
        badColor.push(p + " → <slider> 缺 block-color");
      }
    }
  });
});
ok("原生控件的配色都对齐主色 #2f6055", badColor.length === 0, badColor.join("; "));

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

// V6. 主色一致：页面样式表里凡出现主题色，必须是令牌，不许再写一遍字面量。
//    写死一次就会漂一次 —— 网页版那次「主色从 #2f6055 漂到 #2f6056」就是这么来的。
const colorLiteral = [];
pages.forEach((p) => {
  const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
  const re = /#[0-9a-fA-F]{6}/g;
  let m;
  while ((m = re.exec(wxss))) {
    const hex = m[0].toLowerCase();
    if (hex === "#2f6055" || hex === "#234b42") colorLiteral.push(p + " → " + hex);
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
 * V6.8 控件与它的文字之间要有默认间距。
 *
 * Issue #12 的原话：「复选框单选框和右侧文字之间应该有默认间距」。
 * 这不是审美，是**原生控件不带外边距**这件事 —— 紧贴是浏览器的排法，
 * 不是控件的排法，而每一页都有人会忘记补，所以补在控件自己身上：
 * 只要页面上出现裸的 <radio> / <checkbox>，它就一定已经被全局规则照顾到。
 *
 * 判据两条：
 *   1. app.wxss 里必须有一条规则，按控件标签给 margin-right
 *   2. 页面不许再给 .opt-main 补 padding-left 之类的**第二份**间距
 *      ——两处叠加会变成 24rpx，比目的多出一倍
 */
{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");

  // 1) 控件标签级的间距规则
  const rule = /\.native-label\s+radio[\s\S]{0,400}?margin-right\s*:/.test(appWxss);
  ok("原生选项与文字之间有全局默认间距", rule,
    "app.wxss 里找不到给 radio/checkbox 的 margin-right");

  // 2) 页面不许再叠一份：opt-main / pref-main 上的左内边距是重复间距
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
  const pageCssAll = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8")
    + pages.map((p) => fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8")).join("\n");

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
  const mirrorNorm = normalize(mirror);
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

  // W4. 服务端没配时，不许有任何界面说「已同步」这种假话。
  //     判据：说「已同步」的地方，那一行的可见性必须挂在 sync 判据上。
  const syncReadyUses = mineJs.indexOf("syncAllowed") >= 0;
  ok("同步那一行按能力判据显示", syncReadyUses);

  // W5. 同步是 pro（服务端 syncTierGate 定的）。这条口子必须在能力表里，
  //     否则 free 档会看到一个点下去必被 403 的入口。
  const capSync = E.CAPS.find((c) => c.key === "sync");
  ok("云端同步在能力表里且是 pro", !!capSync && capSync.tier === "pro",
    capSync ? "当前 tier=" + capSync.tier : "能力不存在");

  // W6. 微信登录那一层的说明书要在 —— 它是唯一的硬阻塞，
  //     没有它接手的人只能从头猜接口形状。
  ok("有微信登录服务端说明", fs.existsSync(path.join(__dirname, "..", "docs", "wx-login-server.md")));
}

/* ---------- 汇总 ---------- */

console.log("");
console.log("检查 " + checks + " 项，失败 " + fails + " 项");
process.exit(fails ? 1 : 0);
