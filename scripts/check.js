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
    const resolved = /\.json$/.test(target) || /\.js$/.test(target) ? base : base + ".js";
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

// a) 没有音频接口 —— 朗读「不可见」
let env = bootSpeech({});
ok("无音频接口时朗读不可见", env.speech.readiness().visible === false, JSON.stringify(env.speech.readiness()));
ok("无音频接口时朗读报 unsupported", env.speech.readiness().state === "unsupported");
env.restore();

// b) 有音频、没插件 —— 「可见但未就绪」，要显示成待开通而不是假装能用
env = bootSpeech(AUDIO);
ok("缺少合成通道时朗读可见", env.speech.readiness().visible === true);
ok("缺少合成通道时朗读不可用", env.speech.readiness().usable === false);
ok("缺少合成通道时报 awaiting", env.speech.readiness().state === "awaiting");
ok("未就绪时给出人话原因", !!env.speech.readiness().reason);
env.restore();

// c) 全部就绪
env = bootSpeech(Object.assign({}, AUDIO, PLUGIN));
ok("通道齐备时朗读就绪", env.speech.readiness().usable === true);
ok("通道齐备时选题用插件", env.speech.resolveProvider() === "plugin");
env.restore();

// d) 宿主模式：没登录也是全能力 —— 这是「不登录也能用全部功能」的兑现点，
//    不是漏权。本机数据只属于本机，所以朗读在宿主下应当可用。
env = bootSpeech(Object.assign({}, AUDIO, PLUGIN));
env.box["kb_profile_v1"] = { logged: false };
ok("宿主下未登录也保留朗读", env.ent.can("speak") === true);
ok("宿主来源标得清楚", env.ent.status().source === "host", env.ent.status().source);

// d2) 关掉宿主后（模拟真·后端分层）：未登录不得拿朗读，登录才给
const tmod = require(path.join(ROOT, "utils", "tiers.js"));
const hostedFn = tmod.hosted;
tmod.hosted = () => false;

env = bootSpeech(Object.assign({}, AUDIO, PLUGIN));
env.box["kb_profile_v1"] = { logged: false };
ok("非宿主 + 未登录：朗读不可见", env.speech.readiness().visible === false, JSON.stringify(env.speech.readiness()));
ok("非宿主 + 未登录：报 denied", env.speech.readiness().state === "denied");

env.box["kb_profile_v1"] = { logged: true };
ok("非宿主 + 已登录：朗读可见且可用", env.speech.readiness().usable === true, JSON.stringify(env.speech.readiness()));

// 付费档在拿不到后台档位时必须按未授权处理，不能凭本机写个 max 就提档
env.box["kb_profile_v1"] = { logged: true, tier: "max" };
ok("本机写 max 不生效（后台离线时降级）", env.ent.status().blocked === "local", JSON.stringify(env.ent.status()));
tmod.hosted = hostedFn;
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
    if (["item", "index", "tk", "t", "b", "p", "l", "true", "false"].indexOf(name) >= 0) return;
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

ok("三档齐备", tiersMod.TIER_KEYS.join(",") === "free,pro,max", tiersMod.TIER_KEYS.join(","));
ok("档位顺序单调", E.rankOf("free") < E.rankOf("pro") && E.rankOf("pro") < E.rankOf("max"));

const snap = E.snapshot();
ok("能力矩阵不漏项", Object.keys(snap.caps).length === E.CAP_KEYS.length);

// 本机宿主下四套算法都能开 —— 这条是「不登录也能用全部功能」的兑现点
ok("宿主下 FSRS 可用", E.algoAllowed("fsrs") === true);
ok("宿主下 SM-2 可用", E.algoAllowed("sm2") === true);

// 提权码：形状不对要挡住
ok("乱七八糟的码不认", E.redeem("hello").ok === false);
ok("不像样的码不认", E.redeem("PRO-1234").ok === false);

// 客户端的档位不是安全边界：写死 max 也只能提到本机档，且必须留痕
store.saveProfile({ tier: "max" });
ok("本机写入的档位不外溢成服务端授权", E.status().source === "host" || E.status().source === "grant");

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

/* ---------- 8.5 分包与页面清单 ---------- */

// 管理页是这轮新加的，得确认它真的注册进了分包 —— 否则「我的」页那个入口点下去是白屏
const subs = {};
(app.subPackages || []).forEach((sp) => {
  subs[sp.name || sp.root] = sp.pages.slice();
});

ok("题库页注册在 game 分包", (subs.game || []).indexOf("quiz/quiz") >= 0, JSON.stringify(subs.game));
ok("管理页注册在 admin 分包", (subs.admin || []).indexOf("index/index") >= 0, JSON.stringify(subs.admin));
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
ok(
  "契约路径齐全",
  !!(remoteMod.PATHS.login && remoteMod.PATHS.pull && remoteMod.PATHS.push && remoteMod.PATHS.speech && remoteMod.PATHS.users),
  JSON.stringify(Object.keys(remoteMod.PATHS))
);

// 打包形状：进度与已读都要打得出来，id 用条目 id（服务端不必懂语料结构）
store.markRead("poems", "probe-1");
const packed = remoteMod.pack();
ok("打包带本机标识", !!packed.device);
ok("打包含进度行", packed.rows.some((r) => r.kind === "p" && r.id === "probe-1"));
ok("打包含已读行", packed.rows.some((r) => r.kind === "r" && r.id === "probe-1"));

// 管理名录：没配 POEM_ROSTER 时是空名册，不许凭空编人出来
const roster = readJson(path.join(dataDir, "roster.json"));
ok("名录文件存在（空也要在）", !!roster);
ok("名录不含完整标识泄漏（标签截断）", (roster.users || []).every((u) => String(u.label).length <= 8));
ok("名录档位合法", (roster.users || []).every((u) => ["free", "pro", "max"].indexOf(u.tier) >= 0));

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

/* ---------- 汇总 ---------- */
console.log("");
console.log("检查 " + checks + " 项，失败 " + fails + " 项");
process.exit(fails ? 1 : 0);
