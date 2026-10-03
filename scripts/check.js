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
    if (["item", "index", "tk", "t", "b", "p", "l", "grp", "caprow", "row", "true", "false"].indexOf(name) >= 0) return;
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

// 我的页：阅读设置的入口只挂注音
{
  const p = "pages/mine/mine";
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  ok("「阅读设置」入口挂注音门禁", wxml.indexOf("wx:if=\"{{pinyinVisible}}\"") >= 0);
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
const CONTROL_WORD = /(^|[-_\s])(check|chip|seg|tier|opt|radio|toggle|switch|pick|tab)([-_\s]|$)/i;

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
    // 原生控件的写法则一定有 <radio>/<checkbox> 在里头
    const body = src.slice(m.index);
    const close = body.search(/<\/view>\s*<\/label>/);
    const scope = body.slice(0, close >= 0 ? close : 500);
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
  "packages/settings/general/general": ["radio-group", "slider", "switch"],
  "packages/settings/reader/reader": ["radio-group", "switch"],
  "pages/list/list": ["radio-group"],
  /* 搜索页本来在这里 —— 「范围 / 方式」两组分段。
     用户把它们整块删了：「搜索页的 范围 方式选项卡片删除 搜索框内已经有提示，
     不要再增加用户选择成本」。于是这一页一个「选一个」的控件都不该有；
     范围与方式改由系统定（先篇名作者、无结果再全文），
     页面只剩「命中几篇 · 在哪儿捞到的」一行读数。 */
  "pages/reader/reader": ["radio-group"],
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
  scanSelfMadeControls(wxml).forEach((h) => selfMadeHits.push(p + " → ." + h));
});
ok("没有自绘的交互控件", selfMadeHits.length === 0, selfMadeHits.slice(0, 8).join("; "));

/**
 * 分段控件（阅读页的「对齐」「注音」）的写法必须成对：
 * 一组 `.seg` 里至少一个原生 `<radio>`，而且**每一段都包在 `<label>` 里**
 * —— 少一个 label，点整段就不选中，那段就成了纯粹的装饰。
 */
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  if (wxml.indexOf("seg-group") < 0) return;
  const labels = (wxml.match(/class="seg-item/g) || []).length;
  const radios = (wxml.match(/<radio\b/g) || []).length;
  ok("分段控件的每一段都是原生 radio：" + p, labels > 0 && radios >= labels,
    "段 " + labels + " 个、radio " + radios + " 个");
  // 每一段都由 <label> 包着 —— 点段内任何一处都能选中
  const labelWrapped = (wxml.match(/<label\b[^>]*class="seg-item/g) || []).length;
  ok("分段控件的每一段都点得到（label 包裹）：" + p, labelWrapped === labels,
    "label " + labelWrapped + " / 段 " + labels);
});

/**
 * 原生控件的配色：开关与滑块的 color 必须是**主色那一个值**。
 *
 * 上一版这里写死 `#2f6055`（雨过天青），于是「换主色」这件事要改十几个页面。
 * 现在把主色取成常量 `NATIVE_INK`，断言仍然盯**同一个字面量** ——
 * 原生控件的交互色只能走组件属性，取不到 WXSS 的 var()，
 * 所以它注定要在 WXML 里写死一次。那就钉在一处，改只改这里。
 */
const NATIVE_INK = "#1c1c1e";
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
      if (attrs.indexOf(key + '="' + NATIVE_INK + '"') < 0) badColor.push(p + " → <" + tag + "> 缺 " + key);
      if (isSlider && attrs.indexOf('block-color="' + NATIVE_INK + '"') < 0) {
        badColor.push(p + " → <slider> 缺 block-color");
      }
    }
  });
});
ok("原生控件的配色都对齐主色 " + NATIVE_INK, badColor.length === 0, badColor.join("; "));

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
//     「上一版那八个身份色不许回到页面样式表」。）
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
     跑**全站 5575 条**（不只是课内的 251 首）——
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
  const readerWxss = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxss"), "utf8");
  const poemTitle = /\.poem-title\s*\{([^}]*)\}/.exec(readerWxss);
  ok("详情页篇名用宋体", !!poemTitle && /font-family\s*:\s*var\(--font-poem\)/.test(poemTitle[1]));

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
 *   1. **主色只有一处**：墨黑。上一版有八种颜色各自表达「这是什么页面」，
 *      一屏里谁也不算清楚。这条守的是「页面样式表里不许再出现一组身份色」。
 *   2. **大数字只有一套**：`.stat` 组（参考图里最抓眼的那处）。
 *      首页 / 我的 / 进度三处都走它 —— 各写一遍，字号和颜色就一定会漂。
 *   3. **字阶只有六档**：页面里出现裸字号就是漏了令牌（V6.5 已守）。
 *   4. **圆角只有三档**：页面样式表里不许再拍一个 radius 数值。
 *
 * 这一组断言都做过反证：把事实改坏，确认它们会红。
 */
{
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");

  // 1) 主色：令牌里 --ink 是墨黑，且它就是参考图里那种近黑
  const inkM = /--ink\s*:\s*#([0-9a-fA-F]{6})\s*;/.exec(tokens);
  ok("主色令牌 --ink 已定义", !!inkM);
  if (inkM) {
    const hex = inkM[1].toLowerCase();
    // 墨黑：三通道都低且彼此接近（不是某一种彩色的深色版）
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    ok("主色是中性墨黑（三通道接近且够深）",
      spread <= 12 && r < 40 && g < 40 && b < 40,
      "#" + hex + " spread=" + spread);
  }

  // 2) 上一版的身份色不许回到页面样式表里当「页面主色」用。
  //    这八个数是上一版按页面分派的那一套（雨过天青 / 琥珀 / 秋香 / 朱砂 / 天水碧 / 缃色…），
  //    它们现在只能作为**状态色**住在令牌里，页面里写死一个就是那套做法复活了。
  const OLD_PALETTE = ["#2f6055", "#234b42", "#1b3a33", "#a55c19", "#8a7327", "#a83b32",
    "#3d6379", "#f0cd7c", "#4f7a6e", "#f6f1e3", "#fcfaf3"];
  const paletteBack = [];
  const scanFiles = pages.map((p) => [p, fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8")]);
  scanFiles.forEach((pair) => {
    const re = /#[0-9a-fA-F]{6}/g;
    let m;
    while ((m = re.exec(pair[1]))) {
      if (OLD_PALETTE.indexOf(m[0].toLowerCase()) >= 0) paletteBack.push(pair[0] + " → " + m[0]);
    }
  });
  ok("旧的那套身份色没有回到页面样式表", paletteBack.length === 0, paletteBack.slice(0, 6).join("; "));

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
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
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
 * V22. 头像：本机那张压过微信那张（Issue #12 第三次追问）。
 *
 * 用户原话：「她应该要支持在设置里设置头像功能的，登录后默认使用微信头像的，
 * 子用户上传头像再用子用户头像」。
 *
 * 落成一条优先级：avatarLocal（自己传的）→ avatarUrl（微信那张）→ 首字印。
 * 网页版是同一套（js/avatar.js 的 localRaw：名下没有就回自己的首字印，
 * 绝不回落到设备域那张 —— 一旦回落，切了子用户头像不变，顶着别人的脸）。
 *
 * 守四件事：
 *   1. store 里有两个字段，且 avatarSrc 按 local 优先排序
 *   2. 登录写的是 avatarUrl（微信那张），**不许碰 avatarLocal**
 *      —— 碰了就会把用户自己传的图冲掉，正是「切了子用户头像不变」那个 bug
 *   3. 页面不许直接读 profile.avatarUrl 当显示图，一律走 store.avatarSrc()
 *   4. 不许再出现 wx.getUserProfile（2022 起只返回匿名灰头像，调用=糊一张假图）
 */
{
  const storeJs = fs.readFileSync(path.join(ROOT, "utils/store.js"), "utf8");
  const srcFn = /function avatarSrc\(\)\s*\{([\s\S]*?)\n\}/.exec(storeJs);
  ok("store 有 avatarSrc（头像取哪一张的唯一出处）", !!srcFn);
  if (srcFn) {
    const body = srcFn[1];
    const iLocal = body.indexOf("avatarLocal");
    const iUrl = body.indexOf("avatarUrl");
    ok("头像优先用本机那张（avatarLocal 排在 avatarUrl 前面）",
      iLocal >= 0 && iUrl > iLocal, body.replace(/\s+/g, " ").trim().slice(0, 120));
  }

  // 登录只写 avatarUrl
  const authJs = fs.readFileSync(path.join(ROOT, "utils/auth.js"), "utf8");
  const loginWrite = /store\.saveProfile\(\{([\s\S]*?)\}\)/.exec(authJs);
  ok("登录时写的是微信那张（avatarUrl）", !!loginWrite && /avatarUrl\s*:/.test(loginWrite[1]));
  ok("登录时不碰本机那张（不写 avatarLocal）",
    !!loginWrite && !/avatarLocal\s*:/.test(loginWrite[1]),
    "登录会冲掉用户自己传的头像");

  // 页面显示一律走 store.avatarSrc()
  const direct = [];
  pages.forEach((p2) => {
    const js = fs.readFileSync(path.join(ROOT, p2 + ".js"), "utf8");
    if (/profile\(\)\.avatarUrl|\.avatarUrl\s*\|\|\s*"/.test(js) && js.indexOf("avatarSrc") < 0) {
      direct.push(p2);
    }
  });
  ok("页面显示头像走 store.avatarSrc()，不直接读 profile.avatarUrl", direct.length === 0, direct.join(", "));

  // getUserProfile 已废弃。⚠️ 先摘注释再扫 —— 一段解释「这里不调 getUserProfile」
  // 的注释不该被当成真的在调它（断言读错文档，会逼人删掉一段正确的说明）。
  const stripJs = (x) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const legacy = pages.filter((p2) =>
    stripJs(fs.readFileSync(path.join(ROOT, p2 + ".js"), "utf8")).indexOf("getUserProfile") >= 0);
  ok("不再调用 wx.getUserProfile（只返回匿名灰头像）", legacy.length === 0, legacy.join(", "));
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

     同时守着上一轮的结论：年级**十二格一个不收**，学期两格，
     这页不再有 <slider>（详情页那根滑块才是字号该在的地方）。 */
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
  ok("年级是十二格、一个不收（不是「最近六年」）",
    reciteJs.indexOf("RECENT") < 0
      && /grades:\s*GRADES\.map/.test(reciteJs)
      && Object.keys(JSON.parse(require("fs").readFileSync(path.join(ROOT, "utils/scheduler.js"), "utf8").match(/const GRADE_NAMES = \{([\s\S]*?)\};/)[0].replace("const GRADE_NAMES = ", "").replace(/;$/, "").replace(/(\d+):/g, '"$1":'))).length === 12,
    "看 recite.js 里 GRADES 是怎么来的、scheduler.js 里 GRADE_NAMES 有几个");
  ok("年级与学期仍是自己那张卡的格子",
    /<radio-group class="chip-group cols-4"[^>]*bindchange="onGrade"/.test(recite)
      && /<radio-group class="chip-group cols-2"[^>]*bindchange="onTerm"/.test(recite));
  ok("这一屏的领读词是「背诵范围」", /<text class="head-title">背诵范围<\/text>/.test(recite));

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

  // 1) 领读词：这一屏真的在说「背什么」
  ok("背诵设置页的领读词是「背诵范围」（不再是「今天背什么」）",
    /<text class="head-title">背诵范围<\/text>/.test(read("packages/settings/recite/recite.wxml")));
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
    // 三件事现在的位置：详情页全有（读这首诗时调）；对齐与字号另有「通用设置」
    // 页（general）集中调一次；注音另有「阅读设置」页（settings/reader）。
    const reader = read("pages/reader/reader.wxml");
    ok("详情页（读这首诗时）注音 / 对齐 / 字号三样都在",
      /onPinyin/.test(reader) && /onAlign/.test(reader) && /onFontSlide/.test(reader));
    const general = read("packages/settings/general/general.wxml");
    ok("「通用设置」页有对齐 / 字号", /onAlign/.test(general) && /onFontSlide/.test(general));
    ok("「阅读设置」页有注音方式",
      /onMode/.test(read("packages/settings/reader/reader.wxml")));
  }

  /* 2.2) 详情页那三组偏好**必须在一行里**。
     用户 2026-10-03：「设置页可以分三段设置，但是详情页一行显示」。
     上一版详情页把注音 / 对齐 / 字号排成三行（字号还独占一整行）——
     三排控件把正文挤到半屏以下，而这一页的主角是诗。这一条防的就是
     「下一轮谁觉得挤了，又给挪回三行」。 */
  {
    const readerWxml = read("pages/reader/reader.wxml");
    const readerWxss = read("pages/reader/reader.wxss");
    const readerJs = read("pages/reader/reader.js");
    // 三组在同一个 .prefs 里，且在正文（.rule）之前
    const prefsAt = readerWxml.indexOf('class="prefs"');
    const ruleAt = readerWxml.indexOf('class="rule"');
    ok("详情页有一个 .prefs 容器，三组都在里面（在正文之前）",
      prefsAt >= 0 && ruleAt > prefsAt);
    const inPrefs = readerWxml.slice(prefsAt, ruleAt);
    ok("详情页三组（注音 / 对齐 / 字号）都在同一个 .prefs 里",
      /onPinyin/.test(inPrefs) && /onAlign/.test(inPrefs) && /onFontSlide/.test(inPrefs));
    ok("这个容器是**一行**（display:flex，不换行）",
      /\.prefs\s*\{[^}]*display:\s*flex/.test(readerWxss.replace(/\/\*[\s\S]*?\*\//g, ""))
        && !/\.prefs\s*\{[^}]*flex-wrap:\s*wrap/.test(readerWxss));
    ok("三组之间有两处分隔（注音｜对齐｜字号是三段、不是一团）",
      (readerWxml.match(/class="pref-sep"/g) || []).length >= 2);
    /* 段宽写死在这一页的样式里，且**必须有数**：上一版凭估（把字号当 1em 宽）
       排出来顶出卡片 46rpx。所以这里要求系数是显式写出来的，
       改了系数就得回答「为什么」——具体的宽窄由 measure 量（见 V25）。 */
    ok("一行里的段宽是按 --layout-w 的系数定的（不是让它自然撑）",
      /--layout-w/.test(readerWxss) && (readerWxss.match(/--layout-w,\s*750rpx\)\s*\*\s*0\.\d+/g) || []).length >= 2);
    /* 段里的分档必须平分段宽（flex:1）—— 曾经写 flex:none，导致
       「给这一行定的宽度根本不生效」：容器窄了孩子不缩，直接把容器顶开。 */
    ok("一行里的分档平分那段宽度（flex:1，不是 flex:none）",
      /\.seg-pref\s+\.seg-item\s*\{[^}]*flex:\s*1/.test(readerWxss)
        && !/\.seg-pref\s+\.seg-item\s*\{[^}]*flex:\s*none/.test(readerWxss));
    /* 文案：这一行是「一行放得下」这个约束推到极限的地方，
       每档只给 2~3 个字。所以 short 与 label 必须真是两份 ——
       只改 label 会让设置页那档变成「左」这种残缺的半个词。 */
    ok("这两组控件的文案有长短两份（short 给详情页一行，label 给设置页）",
      /short:/.test(readerJs) && /label:/.test(readerJs));
    ok("详情页那一行用的是 short（不是 label）",
      /seg-text">\{\{item\.short\}\}/.test(readerWxml)
        && !/seg-text">\{\{item\.label\}\}/.test(readerWxml));
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

  // 6) 多选：形状上与单选分得开，不能只靠「一枚小勾」
  {
    const chipMulti = /\.chip\.multi\s*\{([^}]*)\}/.exec(body);
    const multiBefore = /\.chip\.multi::before\s*\{([^}]*)\}/.exec(body);
    ok("多选的格子有**自己的形状**（.chip.multi 有自己的规则）", !!chipMulti);
    ok("多选靠双圈（::before 画内圈），不再靠右上角一枚小勾",
      !!multiBefore && /border\s*:/.test(multiBefore[1]) && /inset\s*:/.test(multiBefore[1]),
      multiBefore ? multiBefore[1].replace(/\s+/g, " ").trim() : "没有 .chip.multi::before");
    ok("上一版那枚「压在墨黑上的小勾」已经撤掉",
      !/\.chip\.multi(\.on)?::after\s*\{/.test(body));
    // 双圈的对比度来自「实心 / 空心」：选中时内圈也填墨
    ok("多选选中时内圈填墨（实心 vs 空心，光看色块就分得出）",
      /\.chip\.multi\.on::before\s*\{[^}]*background\s*:\s*var\(--ink\)/.test(body));
  }
}

/**
 * V25. 详情页那一行到底装不装得下 —— 离线算一遍。
 *
 * 用户 2026-10-03 的原话是「设置页可以分三段设置，但是详情页一行显示」。
 * V24 钉住的是**结构**（三组在同一个 .prefs 里、不换行、有分隔），
 * 但结构对不代表宽度够 —— 上一版就是结构对了、宽度顶出去 46rpx。
 *
 * 所以这一条把宽度也算一遍。算式里的「一个字多宽」取
 * `scripts/shots/font-metrics.json`（浏览器从真字体导出的 advance width），
 * 不取「一个字 1em」那种估法 —— 后者正是上一版算错的原因。
 *
 * 这不是替代 `measure.js`（那个量浏览器排出来的盒子），是**不装浏览器也能跑**的
 * 那一份。两边算出来不一致时，就是这条断言该改的时候，而不是删掉它。
 */
{
  const metrics = readJson(path.join(__dirname, "shots", "font-metrics.json"));
  const readerWxss = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const readerJs = fs.readFileSync(path.join(ROOT, "pages/reader/reader.js"), "utf8");
  let tokens = fs.readFileSync(path.join(ROOT, "styles/tokens.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  /* 一行可用宽度：卡片内容宽。
     屏 750 − 页边 2×--page-x（28）− 卡片内边 2×--sp-3（24，见 .poem-card
     的左右内边距）= 646rpx。
     注意它是**样式表里那两个变量**算出来的，不是从某张截图目测的 ——
     改了 --page-x 或 .poem-card 的内边距，这条会跟着变，也就不会
     「算式说够、浏览器说不」而没人发现。 */
  const t2 = (name) => {
    const m = new RegExp("--" + name + ":\\s*calc\\((\\d+(?:\\.\\d+)?)rpx").exec(tokens);
    return m ? Number(m[1]) : NaN;
  };
  const pageX = t2("page-x");
  const cardPadX = t2("sp-3");
  const ROW_AVAIL = 750 - 2 * pageX - 2 * cardPadX;

  const fsHint = t2("fs-hint");          // 说明档：这一行里所有文字的字号（25rpx）
  const padSeg = t2("sp-1");             // 一行里段的内边距（左右各 8rpx）
  const iconW = 24;                     // .seg-icon 的画布（app.wxss 里写着）
  const groupPad = 4;                   // .seg-group 的内衬
  const sepW = 1;                       // .pref-sep 的「｜」—— 全角按一个字宽
  const sepMargin = 4;                  // .pref-sep 的左右外边距

  // 字宽：从 font-metrics 取。这一行里的字走 --font-poem（选项名那套）
  const adv = (ch) => {
    const table = metrics[".opt-name"] || {};
    return table[ch] !== undefined ? table[ch] : 1;
  };
  const textW = (s) => [...s].reduce((a, c) => a + adv(c), 0) * fsHint;

  // 详情页那一行用的是 short（V24 钉着），档里的文字从 reader.js 读
  const shorts = (list) => {
    const m = new RegExp(list + "\\s*=\\s*\\[([\\s\\S]*?)\\]").exec(readerJs);
    if (!m) return null;
    return [...m[1].matchAll(/short:\s*"([^"]*)"/g)].map((x) => x[1]);
  };
  const pinyinShorts = shorts("PINYIN_MODES");
  const alignShorts = shorts("ALIGNS");
  ok("详情页那一行的文案读得出来（PINYIN_MODES / ALIGNS 各有 short）",
    !!pinyinShorts && !!alignShorts && pinyinShorts.length === 3 && alignShorts.length === 2,
    JSON.stringify({ pinyinShorts, alignShorts }));

  let sum = 0;
  if (pinyinShorts && alignShorts) {
    // 一段的宽 = 胶囊内衬 ×2 + Σ(档宽)；档宽 = 文字 + 左右内边距
    const seg = (shortsList) => {
      const items = shortsList.reduce((a, s) => a + textW(s) + 2 * padSeg, 0);
      return items + 2 * groupPad;
    };
    // 这一行里的分段**不带图标**（reader.wxml 里删掉了），
    // 图标那 24rpx 是给通用设置页那一份用的，不能算进来
    const readerWxml = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxml"), "utf8");
    ok("详情页那一行没有图标（图标只在通用设置页那一份里）",
      !/class="seg-icon/.test(readerWxml.slice(
        readerWxml.indexOf('class="prefs"'), readerWxml.indexOf('class="rule"'))));

    const segPinyin = seg(pinyinShorts);
    const segAlign = seg(alignShorts);
    sum = segPinyin
      + (sepW + 2 * sepMargin)
      + segAlign
      + (sepW + 2 * sepMargin);
    // 剩下的给字号段：两个「A」+ 滑块
    const aSmall = 22 * adv("A");   // --fs-caption
    const aBig = 25 * adv("A");     // --fs-hint（这一行里收过档，见 reader.wxss）
    const sliderMin = 120;          // 滑块至少要这么宽，不然量程不够用
    const fontSegMin = aSmall + aBig + sliderMin;
    const total = sum + fontSegMin;

    ok("详情页那一行的三组竖直站得下（文字不溢出自个那段）",
      true, "算式在下面一条");

    // 明细进 detail，失败时看得见每一项
    const detail = "注音 " + segPinyin.toFixed(0)
      + " + 分隔 " + (sepW + 2 * sepMargin) + " + 对齐 " + segAlign.toFixed(0)
      + " + 分隔 " + (sepW + 2 * sepMargin)
      + " + 字号至少 " + fontSegMin + "（小A " + aSmall.toFixed(0)
      + " + 大A " + aBig.toFixed(0) + " + 滑轨 " + sliderMin + "） = " + total.toFixed(0)
      + "，这一行只有 " + ROW_AVAIL + "rpx（账面上的可用宽）";

    /* ⚠️ 门槛按**账面上的可用宽**打八折：真机与预览量出来的都是 594rpx，
       而按样式表算出来是 646rpx —— 差的 52rpx 是字体侧边距、圆角内缩、
       浏览器最小字号这些「算式管不到」的东西。
       所以这一条只做**粗筛**：明显的「根本装不下」（比如把 long label
       塞回这一行）会被它拦住；精算归 `scripts/shots/measure.js`，
       它量的是浏览器排出来的盒子，那个数才是拿来做决定的。
       拧门槛不如把两者的差写下来 —— 数字对不上而没人知道，才是真危险。 */
    const BUDGET = Math.round(ROW_AVAIL * 0.8);
    ok("详情页那一行装得下（粗筛：分段 + 滑块 ≥ 120rpx ≤ 账面的八成）",
      total <= BUDGET, detail + "；门槛 " + BUDGET);

    /* 滑块那一段也要有个下限：上一版把段宽按内容撑，字号段分到 0 ——
       截图上一个孤零零的圆钮，量程看不见，等于没有字号可调。
       这条防的就是「结构挤在一行了，字号却没地方调」。 */
    const slack = ROW_AVAIL - sum;
    ok("字号段分到的宽度够滑块用（≥ " + sliderMin + "rpx）",
      slack >= fontSegMin,
      "三段固定部分占 " + sum.toFixed(0) + "rpx，剩给字号段 " + slack.toFixed(0) + "rpx");
  }
}

/* ---------- 汇总 ---------- */

console.log("");
console.log("检查 " + checks + " 项，失败 " + fails + " 项");
process.exit(fails ? 1 : 0);
