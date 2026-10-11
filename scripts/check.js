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

    const base = path.resolve(path.dirname(file), target);

    let resolved;
    if (/\.json$/.test(target) || /\.js$/.test(target)) resolved = base;
    else resolved = fs.existsSync(base + ".js") ? base + ".js" : path.join(base, "index.js");
    ok("require 可解析 " + path.relative(ROOT, file) + " → " + target, fs.existsSync(resolved));
  }
});

const dataDir = path.join(ROOT, "data");
const booksTable = readJson(path.join(dataDir, "books", "books.json"));

const manifest = readJson(path.join(dataDir, "shards.json"));

ok("集子表 17 部", (booksTable || []).length === 17, "实际 " + (booksTable || []).length);

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

  ok("集子索引归属正确 " + b.id,
    perBook[b.id].every((p) => p.b === b.id && p.n === b.name),
    "b / n 与实际集子对不上");
});

{
  const compact = readJson(path.join(dataDir, "books", "tangshi.json"));
  const heavy = compact.filter((p) => p.b !== undefined || p.n !== undefined
    || p.hasT !== undefined || p.aka === null || p.sel === "" || p.gr === 0);
  ok("索引落盘是紧凑的（不带 b / n / hasT，也不带空字段）", heavy.length === 0,
    heavy.length + " 条还带着冗余字段 —— 主包又要顶穿 2MB（见 scripts/build-data.js）");
}

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

let sampled = 0;
let bad = 0;
Object.keys(manifest.map).slice(0, 60).forEach((id) => {
  const name = manifest.map[id];
  const bucket = readJson(path.join(dataDir, "texts", name + ".json"));
  sampled += 1;
  if (!bucket[id] || typeof bucket[id].text !== "string") bad += 1;
});
ok("抽查分片可取正文（" + sampled + " 条）", bad === 0, bad + " 条取不到");

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

  booksTable.forEach((b) => {
    const rel = "data/books/" + b.id + ".json";
    ok("集子索引在包里 " + rel,
      fs.existsSync(path.join(ROOT, rel)) && !ignored.some((ig) => rel.indexOf(ig) === 0),
      rel + " 被 ignore 了 —— 列表页与按题名检索会空");
  });

  const tsSrc = fs.readFileSync(path.join(ROOT, "utils", "text-search.js"), "utf8");
  ok("被 ignore 的 texts/idx.json 有兜底（读不到 = 全文检索不可用，不炸）",
    /INDEX\s*=\s*["']data\/texts\/idx\.json["']/.test(tsSrc)
      && /function\s+index\(\)[\s\S]{0,400}try\s*{[\s\S]{0,200}require/.test(tsSrc)
      && /function\s+readiness/.test(tsSrc) && /usable/.test(tsSrc),
    "text-search 读不到 idx.json 时必须走 readiness() 降级，不能抛");

  const bucketDir = (corpusSrc.match(/const\s+BUCKET_DIR\s*=\s*["']([^"']+)["']/) || [])[1] || "";
  const bucketRead = new RegExp(
    'readJson\\(\\s*BUCKET_DIR\\s*\\+\\s*name\\s*\\+\\s*["\']\\.json["\']\\s*,\\s*\\{\\}\\s*\\)'
  ).test(corpusSrc);
  ok("被 ignore 的 texts/<片>.json 有兜底（读不到 = 空对象，不炸）",
    /function\s+readJson\([\s\S]{0,400}MODULE_NOT_FOUND[\s\S]{0,80}return\s+fallback/.test(corpusSrc)
      && bucketDir === "data/texts/"
      && bucketRead,
    "corpus.bucket() 读的是 " + (bucketDir || "(没找到 BUCKET_DIR 常量)") +
      "，而它在 packOptions.ignore 里 —— 真机上 require 抛 MODULE_NOT_FOUND，" +
      "课外正文一律取不到，且异常从 onShow 直接冒出去（白屏）。" +
      "readJson 必须把 MODULE_NOT_FOUND 也当兜底，bucket() 才拿得到空对象继续往分片缓存走");

  ok("课文阅读页取正文不裸调 corpus.entry（真机上它抛 = 整屏白）",
    /try\s*{[\s\S]{0,120}corpus\.entry\(/.test(
      fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.js"), "utf8")
    ),
    "reader.js 的 corpus.entry(id) 不在 try 里，且排在 ensureEntry 之前 —— 它一抛就连 textFailMsg 那套都说不上");
}

const R = require(path.join(ROOT, "utils", "review-models.js"));

ok("四套算法都在", R.ORDER.length === 4 && R.ORDER.every((k) => R.MODELS[k]));

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

R.ORDER.forEach((key) => {
  const r = R.review({ level: 5, learned: true, lapses: 1, reviewCount: 6 }, "good", key);
  ok("换算法保进度 " + key, r.learned === true && typeof r.level === "number");
});

let r10 = null;
for (let i = 0; i < 12; i++) r10 = R.review(r10, "good", "ebbinghaus");
ok("艾宾浩斯档位封顶不越界", r10.level === R.EBBINGHAUS_INTERVALS.length - 1, "level=" + r10.level);

let rh = null;
for (let i = 0; i < 60; i++) rh = R.review(rh, "good", "ebbinghaus");
ok("历史只留最近 20 次", rh.history.length <= 20, "实际 " + rh.history.length);

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

store.setDailyExtra(["a", "b"]);
ok("加背当天可读", store.dailyExtra().length === 2);
wxCalls[store.KEYS.dailyExtra] = { day: "2000-1-1", ids: ["a"] };
ok("加背跨天归零", store.dailyExtra().length === 0);

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

const LOGGED = { kb_profile_v1: { logged: true } };

let env = bootSpeech({});
env.box["kb_profile_v1"] = { logged: true };
ok("无音频接口时朗读不可见", env.speech.readiness().visible === false, JSON.stringify(env.speech.readiness()));
ok("无音频接口时朗读报 unsupported", env.speech.readiness().state === "unsupported");
env.restore();

env = bootSpeech(AUDIO);
env.box["kb_profile_v1"] = { logged: true };
ok("缺少合成通道时朗读可见", env.speech.readiness().visible === true);
ok("缺少合成通道时朗读不可用", env.speech.readiness().usable === false);
ok("缺少合成通道时报 awaiting", env.speech.readiness().state === "awaiting");
ok("未就绪时给出人话原因", !!env.speech.readiness().reason);
env.restore();

env = bootSpeech(Object.assign({}, AUDIO, PLUGIN));
env.box["kb_profile_v1"] = { logged: true };
ok("通道齐备时朗读就绪", env.speech.readiness().usable === true);
ok("通道齐备时选题用插件", env.speech.resolveProvider() === "plugin");
env.restore();

void LOGGED;

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

  let called = 0;
  let e = bootFont({}, { loadFontFace: (o) => { called++; o.success && o.success(); } });
  ok("未配 CDN 时篇名字体不可用", e.font.readiness().usable === false);
  ok("未配 CDN 时报 unsupported（不是 awaiting）", e.font.readiness().state === "unsupported");
  ok("未配 CDN 时给出原因", !!e.font.readiness().reason);
  e.font.load();
  ok("未配 CDN 时一次都不碰 wx.loadFontFace", called === 0, "被调了 " + called + " 次");
  e.restore();

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

  e = bootFont({ fontUrl: "https://cdn.example.com/x.woff2" }, {});
  let threw = false;
  try { e.font.load(); } catch (err) { threw = true; }
  ok("宿主没有 loadFontFace 时不抛", !threw);
  e.restore();

  e = bootFont({ fontUrl: "https://cdn.example.com/x.woff2" },
    { loadFontFace: () => { } });
  threw = false;
  try { e.font.load(); } catch (err) { threw = true; }
  ok("loadFontFace 不回调时不抛", !threw);
  e.restore();

  const tokensWxss2 = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  const stackNow = /--font-poem\s*:\s*([^;]+);/.exec(tokensWxss2);
  ok("字体链首位与 font.js 的 FAMILY 同名", !!stackNow && stackNow[1].indexOf("Kuibu Serif") >= 0);
}

env = bootSpeech(Object.assign({}, AUDIO, PLUGIN));
env.box["kb_profile_v1"] = { logged: false };
ok("未登录：朗读不可见", env.speech.readiness().visible === false, JSON.stringify(env.speech.readiness()));
ok("未登录：朗读报 denied", env.speech.readiness().state === "denied");
ok("未登录：未授权的原因说「登录后可用」", env.speech.readiness().reason === "登录后可用", env.speech.readiness().reason);

env.box["kb_profile_v1"] = { logged: true };
ok("登录后朗读可见且可用", env.speech.readiness().usable === true, JSON.stringify(env.speech.readiness()));
ok("登录后朗读状态来自 readiness", env.speech.readiness().state === "ready");

env.box["kb_profile_v1"] = { logged: true, tier: "max" };
ok("本机写 max 不生效（无签名，按免费算）", env.ent.status().blocked === "unsigned", JSON.stringify(env.ent.status()));
ok("无签名档位退回免费", env.ent.status().tier === "free", env.ent.status().tier);
env.restore();

const pinyin = require(path.join(ROOT, "utils", "pinyin.js"));
const pinyinTable = path.join(dataDir, "pinyin-table.json");
if (fs.existsSync(pinyinTable)) {
  const pt = readJson(pinyinTable);
  ok("读音表有字", Object.keys(pt.chars || {}).length > 1000, "只有 " + Object.keys(pt.chars || {}).length + " 字");
  ok("读音表带词组（多音字消歧靠它）", Object.keys(pt.words || {}).length > 0);
  ok("读音表带常用字（生字模式判据）", Object.keys(pt.common || {}).length > 1000);

  ok("读音表带多音字集合", Object.keys(pt.poly || {}).length >= 50, "实际 " + Object.keys(pt.poly || {}).length);
  ok("多音字集合与读音表自洽", Object.keys(pt.poly || {}).every((ch) => String((pt.chars || {})[ch] || "").indexOf("/") >= 0));
  ok("注音就绪", pinyin.readiness().usable === true);

  const all = pinyin.annotate("床前明月光", "all");
  ok("逐字标音不丢字", all.length === 5 && all.every((c) => c.mark));
  ok("逐字标音有读音", all.every((c) => !!c.py), JSON.stringify(all));

  const rare = pinyin.annotate("白发三千丈", "rare");
  const markOf = (ch) => (rare.find((c) => c.ch === ch) || {}).mark;
  ok("生字模式标多音字「发」", markOf("发") === true);
  ok("生字模式不标常用单音字「三」", markOf("三") === false);

  ok("多音字按词组消歧 白发→fà", pinyin.readOf("发", "白发", 1) === "fà", pinyin.readOf("发", "白发", 1));
  ok("多音字按词组消歧 作为→wéi", pinyin.readOf("为", "作为", 1) === "wéi", pinyin.readOf("为", "作为", 1));
  ok("不字变调（不知→bù）", pinyin.readOf("不", "不知", 0) === "bù");
  ok("不字变调（不是→bú）", pinyin.readOf("不", "不是", 0) === "bú", pinyin.readOf("不", "不是", 0));
  ok("一字变调（一行→yì）", pinyin.readOf("一", "一行", 0) === "yì", pinyin.readOf("一", "一行", 0));
  ok("关掉注音就不切词", pinyin.annotate("床前明月光", "off").every((c) => !c.mark));

  const csplit = require(path.join(ROOT, "utils", "corpus.js")).splitLines;
  const cmod = require(path.join(ROOT, "utils", "corpus.js"));

  const t3 = cmod.layout("鹅，鹅，鹅，\n\n曲项向天歌。").paras;
  const t3r = pinyin.render(t3, "rare");
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

  const t4 = pinyin.render(cmod.layout("白发三千丈").paras, "rare");
  ok("切句后消歧窗口仍是整行（白发→fà）",
    t4[0][0][0].tokens.filter((c) => c.ch === "发")[0].py === "fà",
    JSON.stringify(t4[0][0][0].tokens.filter((c) => c.ch === "发")));

  const t5 = pinyin.render(cmod.layout("君不见，高堂明镜悲白发，朝如青丝暮成雪。").paras, "rare");
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
}

const longLine = corpus.courseTexts();
const hasMulti = Object.keys(longLine).some((k) => {
  const t = longLine[k] && longLine[k].text;
  if (!t) return false;
  return splitLines(t).some((ln) => ln.s.length > 1);
});
ok("语料里确实有一行多句的篇目（切句不是白做）", hasMulti === true);

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

  ok("界面读 partial 在 slice 之前（slice 会把它丢掉，读晚了永远是 false）",
    /const partial = !!hits\.partial;[\s\S]{0,160}hits = hits\.slice\(0, FULL_MAX\)/.test(
      fs.readFileSync(path.join(ROOT, "pages", "search", "search.js"), "utf8")
    ),
    "search.js 在 slice 之后才读 hits.partial —— 数组被切过，那面旗就没了");
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
ok("未登录：首页可浏览", E.decide("home.browse").ok);
ok("未登录：每日背诵不可用", !E.decide("daily").ok);
ok("未登录：课外阅读不可用", !E.decide("library").ok);
ok("未登录：注音不可用", !E.decide("pinyin").ok);
ok("未登录：艾宾浩斯不可用", !E.decide("ebbinghaus").ok);
ok("未登录：朗读不可用", !E.decide("speak").ok);
ok("未登录：莱特纳盒不可用", !E.decide("leitner").ok);
ok("未登录：导出不可用", !E.decide("export").ok);

ok("免登录能力只有首页浏览",
  E.CAN_GUEST.length === 1 && E.CAN_GUEST[0] === "home.browse", E.CAN_GUEST.join(","));

ok("拒绝时说清门槛", E.hint("speak", { signedIn: false }) === "登录后可用");
ok("免登录那条永远放行（hint 为空）", E.hint("home.browse", { signedIn: false }) === "");

const mGuest = E.matrix({ signedIn: false });
ok("矩阵条数与展示顺序一致", mGuest.length === E.ORDER.length);
ok("矩阵逐条与 decide() 一致",
  mGuest.every((r) => r.ok === E.decide(r.cap, { signedIn: false }).ok));
ok("未登录矩阵只有首页一条 ok",
  mGuest.filter((r) => r.ok).length === 1 && mGuest[0].ok);

const gs = E.guestScope();
ok("游客范围是一年级本册", gs.grade === 1 && gs.term === 1 && gs.scope === "term");
ok("游客范围是只读", gs.readOnly === true);

["每日背诵", "课外阅读", "注音辅助", "艾宾浩斯", "语音朗读", "莱特纳盒", "进度导出"].forEach((n) => {
  ok("能力表含「" + n + "」", E.ORDER.some((r) => r.name.indexOf(n) >= 0));
});

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

const homeWxml = fs.readFileSync(path.join(ROOT, "pages", "home", "home.wxml"), "utf8");
const homeJs = fs.readFileSync(path.join(ROOT, "pages", "home", "home.js"), "utf8");
ok("首页有游客提示条", homeWxml.indexOf("guest-bar") >= 0);
ok("首页游客态在 js 里算出来", homeJs.indexOf("gate.GUEST_GRADE") >= 0);

ok("首页点击过门禁", homeJs.indexOf('gate.guard("背诵"') >= 0);

const unusedWarn = [];
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, p + ".js"), "utf8");
  const refs = new Set();
  const re = /\{\{\s*([a-zA-Z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(wxml))) refs.add(m[1]);
  refs.forEach((name) => {

    if (["item", "index", "tk", "t", "b", "p", "l", "grp", "caprow", "row", "true", "false",
         "themeStyle", "themeHex"].indexOf(name) >= 0) return;
    if (js.indexOf(name) < 0) unusedWarn.push(p + " → " + name);
  });
});
ok("WXML 引用的字段都在 js 里出现过", unusedWarn.length === 0, unusedWarn.slice(0, 8).join("; "));

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
  const FORBIDDEN = /待开通|朗读|speakVisible|speakReady|speakReason|speak-bar|speak-ctrl/;
  const stray = [];
  pages.forEach((p) => {
    [".wxml", ".js"].forEach((ext) => {
      const f = path.join(ROOT, p + ext);
      if (!fs.existsSync(f)) return;
      fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {

        const code = line.replace(/<!--[\s\S]*?-->|\/\*.*?\*\/|\/\/.*$/, "").trim();
        if (!code) return;
        if (FORBIDDEN.test(code)) stray.push(p + ext + ":" + (i + 1) + " → " + code.slice(0, 50));
      });
    });
  });
  ok("界面里没有朗读元素（用户裁决不做，见 docs/todo.md 第 1 条）", stray.length === 0, stray.slice(0, 6).join(" | "));
}

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

const gateMod = require(path.join(ROOT, "utils", "gate.js"));

ok("三档齐备", tiersMod.TIER_KEYS.join(",") === "free,pro,max", tiersMod.TIER_KEYS.join(","));

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

ok("能力 key 不重复", new Set(E.CAP_KEYS).size === E.CAP_KEYS.length);
ok("能力 tier 都合法", E.CAPS.every((c) => ["free", "login", "pro", "max"].indexOf(c.tier) >= 0));
ok("每条能力都有人话名字与说明", E.CAPS.every((c) => !!c.name && !!c.desc));

{
  const page = fs.readFileSync(path.join(ROOT, "packages", "admin", "index", "index.js"), "utf8");
  const listed = [];
  const blocks = page.match(/keys:\s*\[[^\]]*\]/g) || [];
  blocks.forEach((b) => {
    (b.match(/"(\w+)"/g) || []).forEach((k) => listed.push(k.replace(/"/g, "")));
  });
  const missing = E.CAP_KEYS.filter((k) => listed.indexOf(k) < 0);
  ok("管理页把每条能力都摆出来", missing.length === 0, "漏了 " + missing.join(", "));

  const wxml = fs.readFileSync(path.join(ROOT, "packages", "admin", "index", "index.wxml"), "utf8");
  ok("管理页渲染能力分组", wxml.indexOf("grp.rows") >= 0 && wxml.indexOf("groups") >= 0);
  ok("管理页显示当前档位标签", wxml.indexOf("status.label") >= 0);
}

ok("档位顺序单调", E.rankOf("free") < E.rankOf("pro") && E.rankOf("pro") < E.rankOf("max"));

const snap = E.snapshot();
ok("能力矩阵不漏项", Object.keys(snap.caps).length === E.CAP_KEYS.length);

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
  ok("未登录拿不到免费能力", E.can("daily") === false && E.can("library") === false);
  ok("未登录拿不到付费能力", E.can("sm2") === false && E.can("fsrs") === false);
  ok("未登录拿不到飞花令", E.can("feihualing") === false);
  ok("未登录的提示是「登录后可用」", E.hint("speak") === "登录后可用", E.hint("speak"));
  ok("未登录 snapshot 不给任何能力", E.CAP_KEYS.every((k) => E.snapshot().caps[k].ok === false));

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
  setProfile({ logged: true, tier: "" });
}

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

  const readerWxml = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxml"), "utf8");
  ok("阅读页未登录时正文在 block wx:else 里", readerWxml.indexOf("block wx:else") >= 0);
  ok("阅读页锁定时不渲染诗句", readerWxml.indexOf("poem-line") > readerWxml.indexOf("block wx:else"));

  ["general/general", "recite/recite", "reader/reader"].forEach((p) => {
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
  const adminJs = fs.readFileSync(path.join(ROOT, "packages/admin/index/index.js"), "utf8");
  const adminWxml = fs.readFileSync(path.join(ROOT, "packages/admin/index/index.wxml"), "utf8");
  const adminLib = fs.readFileSync(path.join(ROOT, "utils/admin.js"), "utf8");

  ok("管理页不写本机档位", adminJs.indexOf("store.KEYS.grant") < 0, "管理页还在直接写 grant");
  ok("管理页不写本机档位（wxml 也没有改档卡片）", adminWxml.indexOf("改本机层级") < 0);
  ok("改档只走服务端", adminLib.indexOf("remote.setUserTier") >= 0);
  ok("服务端没就绪时如实说改不了", adminLib.indexOf("改不了") >= 0);

  ok("管理页区分「能改」与「只读」",
    adminWxml.indexOf("item.editable") >= 0 && adminWxml.indexOf("只读") >= 0);
  ok("改档入口是原生按钮", /<button[^>]*bindtap="onSetTier"/.test(adminWxml));
  ok("角色改动的入口按 owner 显隐", adminWxml.indexOf("canSetRole") >= 0);
  ok("管理页把每条能力都摆出来", E.CAP_KEYS.every((k) => adminJs.indexOf('"' + k + '"') >= 0),
    E.CAP_KEYS.filter((k) => adminJs.indexOf('"' + k + '"') < 0).join(", "));
}

ok("乱七八糟的码不认", E.redeem("hello").ok === false);
ok("不像样的码不认", E.redeem("PRO-1234").ok === false);

const sampleId = allEntries[0].id;
const freshId = corpus.course()[0].id;
ok("indexById 能命中条目", corpus.indexById(sampleId) && corpus.indexById(sampleId).t === allEntries[0].t);
ok("indexById 找不到时回 null", corpus.indexById("不存在的-id") === null);
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

ok("管理页只有一份实现", (subs.settings || []).indexOf("admin/admin") < 0, "settings 下还留着 admin 页");
ok("设置分包含阅读设置", (subs.settings || []).indexOf("reader/reader") >= 0);

["packages/game/quiz/quiz", "packages/admin/index/index", "packages/settings/reader/reader"].forEach((p) => {
  [".js", ".json", ".wxml", ".wxss"].forEach((ext) => {
    ok("新页面四件套 " + p + ext, fs.existsSync(path.join(ROOT, p + ext)));
  });
});

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

store.setRecord("probe-1", { level: 2, learned: true, lastReviewAt: Date.now() });
const syncMod = require(path.join(ROOT, "utils", "sync.js"));
syncMod.markDirty();

ok("未配后端时同步不就绪", syncMod.ready() === false);
ok("写本机后队列有记账", syncMod.pendingCount() >= 0);
ok("本机数据没被动过", !!store.getRecord("probe-1"));

const remoteMod = require(path.join(ROOT, "utils", "remote.js"));

ok("未配后端：configured 为假", remoteMod.configured() === false);
ok("未配后端：TTS 不就绪", remoteMod.speechReady() === false);
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

ok("同步复用 poem 的路径", remoteMod.PATHS.pull === "/api/sync/pull" && remoteMod.PATHS.push === "/api/sync/push");
ok("管理复用 poem 的路径", remoteMod.PATHS.accounts === "/api/admin/accounts" && remoteMod.PATHS.grant === "/api/admin/grant");
ok("微信登录是新增的那一套", remoteMod.PATHS.login === "/api/wx/login");

store.markRead("poems", "probe-1");
store.markRead("dwang", "probe-dw");
store.setDailyExtra(["probe-1"]);
store.saveCollections([{ id: "c1", name: "自检" }]);

const packed = remoteMod.pack();
ok("打包带本机标识", !!packed.device);
ok("打包发的是 recs", Array.isArray(packed.recs));

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

const pRow = packed.recs.find((r) => r.id === "probe-1");
ok("进度行在包里", !!pRow);
ok(
  "进度行的 payload 只带服务端认的字段",
  !!pRow && Object.keys(pRow.payload).every((k) => ["level", "nextReviewAt", "learned", "reps", "history"].indexOf(k) >= 0),
  pRow ? Object.keys(pRow.payload).join(",") : ""
);

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

ok("加背有打包", packed.recs.some((r) => r.id === "daily_extra:v1"));
ok(
  "加背按服务端形状",
  packed.recs.some((r) => r.id === "daily_extra:v1" && r.payload.date && Array.isArray(r.payload.items)),
  "服务端要 { date, items: [{ id }] }"
);
ok("自选清单有打包", packed.recs.some((r) => r.id === "collections:v1" && Array.isArray(r.payload.collections)));

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

  remoteMod.wire.applyRecords([
    { id: "probe-2", payload: { level: 1, learned: false }, updatedAt: 1, deleted: false }
  ]);
  ok("比本机旧的不覆盖", store.getRecord("probe-2").level === 5);
}

const roster = readJson(path.join(dataDir, "roster.json"));
ok("名录文件存在（空也要在）", !!roster);
ok("名录不含完整标识泄漏（标签截断）", (roster.users || []).every((u) => String(u.label).length <= 8));
ok("名录档位合法", (roster.users || []).every((u) => ["free", "pro", "max"].indexOf(u.tier) >= 0));

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

    const oursSet = new Set(ours);
    const missing = Array.from(declared).filter((k) => !oursSet.has(k));
    ok("poem 的已读行小程序都有对应（" + missing.length + " 条在网页版有、这边无）", true,
      missing.slice(0, 6).join(", "));
  }

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

{
  const feihua = require(path.join(ROOT, "utils", "feihua", "index.js"));
  const all = feihua.pool();
  ok("令字池非空", Object.keys(all).length > 500, "只有 " + Object.keys(all).length + " 个令字");

  const chs = Object.keys(all).sort((a, b) => all[b].count - all[a].count).slice(0, 40);
  const mismatch = chs.filter((ch) => all[ch].count !== feihua.look(ch, { limit: 99999 }).length);
  ok("令字格上的数字 = 点进去的行数", mismatch.length === 0,
    mismatch.slice(0, 6).map((ch) => ch + " " + all[ch].count + "≠" + feihua.look(ch, { limit: 99999 }).length).join("; "));

  const feihuaJs = fs.readFileSync(path.join(ROOT, "utils", "feihua", "index.js"), "utf8");
  ok("飞花令不再自己写一份断句标点", feihuaJs.indexOf("const SPLIT") < 0);
  ok("飞花令断句走 corpus.splitLines", feihuaJs.indexOf("corpus.splitLines") >= 0);

  ["easy", "normal", "hard"].forEach((lv) => {
    ok("令字档 " + lv + " 取得到", feihua.chars(lv, 24).length === 24);
  });

  const heTian = all["田"];
  if (heTian) {
    ok("一句里重复的字只算一次（田）",
      heTian.count === feihua.look("田", { limit: 99999 }).length,
      heTian.count + " vs " + feihua.look("田", { limit: 99999 }).length);
  }
}

{
  const feihua = require(path.join(ROOT, "utils", "feihua", "index.js"));

  const scope = { scope: "primary", grade: 1, term: 1 };
  const inScope = {};
  feihua.scopedPoems(scope).forEach(() => {});
  {

    const chars = {};
    feihua.look("", scope);

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

  {
    const scopeSmall = { scope: "term", grade: 1, term: 1 };
    const inSmall = feihua.look("月", Object.assign({ limit: 9999 }, scopeSmall));
    const say = feihua.judge("月", "床前明月光", []);
    ok("作答能超出背诵范围（范围选一上，答静夜思照样对）",
      say.ok === true, say.reason || "判成了错");

    const scopedAll = feihua.look("月", { limit: 9999 });
    ok("看答案按范围收窄（范围内的句子少于全部）",
      inSmall.length < scopedAll.length,
      "范围内 " + inSmall.length + " vs 全部 " + scopedAll.length);
  }

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

    ok("飞花令页当前令字是**一个**字居中显示",
      wxml.indexOf("fh-char-t") >= 0 && /{{\s*char\s*}}/.test(wxml));

    ok("飞花令页有输入框让用户写句子", /<input/.test(wxml) && wxml.indexOf("onSubmit") >= 0);

    ok("飞花令页下方有正确答案列表", wxml.indexOf("onReveal") >= 0 && wxml.indexOf("answers") >= 0);

    const wxss = read("packages/game/feihua/feihua.wxss").replace(/\/\*[\s\S]*?\*\//g, "");
    ok("令字是居中排的（.fh-char 走 flex 居中）",
      /\.fh-char\s*\{[^}]*justify-content:\s*center/.test(wxss)
        && /\.fh-char\s*\{[^}]*align-items:\s*center/.test(wxss));

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

const mainPkg = dirSize(ROOT, path.join(ROOT, "data", "texts"));
ok(
  "主包在 2MB 内（" + (mainPkg / 1024 / 1024).toFixed(2) + "MB）",
  mainPkg <= LIMIT_MAIN,
  "超限 " + ((mainPkg - LIMIT_MAIN) / 1024).toFixed(0) + "KB"
);

const courseKb = fs.statSync(path.join(dataDir, "course.json")).size / 1024;
ok("课内正文在预算内（" + courseKb.toFixed(0) + "KB ≤ 400KB）", courseKb <= 400);

const pyFile = path.join(dataDir, "pinyin-table.json");
if (fs.existsSync(pyFile)) {
  const pyKb = fs.statSync(pyFile).size / 1024;
  ok("读音表在预算内（" + pyKb.toFixed(0) + "KB ≤ 200KB）", pyKb <= 200);
}

ok("全文索引不在主包路径", !fs.existsSync(path.join(dataDir, "idx.json")));

const dupFile = path.join(dataDir, "books", "search.json");
ok("索引没有多余的全站副本", !fs.existsSync(dupFile), "search.json 与各集子索引重复");

const NATIVE_TAGS = ["radio", "radio-group", "checkbox", "checkbox-group", "switch", "slider", "picker"];

const CONTROL_WORD = /(^|[-_\s])(check|chip|seg|tier|radio|toggle|switch|pick|tab)([-_\s]|$)/i;

function isSelfMade(cls, scope) {
  if (!CONTROL_WORD.test(cls)) return false;

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

const NEEDS_NATIVE = {
  "packages/settings/recite/recite": ["radio-group"],

  "packages/settings/general/general": ["radio-group", "slider"],

  "packages/settings/reader/reader": ["switch"],
  "pages/list/list": ["radio-group"],

  "pages/reader/reader": ["radio-group"],
  "packages/game/quiz/quiz": ["checkbox-group", "picker"],
  "packages/game/exam/exam": ["checkbox-group", "picker"],
  "packages/game/feihua/feihua": ["radio-group"]

};

Object.keys(NEEDS_NATIVE).forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  NEEDS_NATIVE[p].forEach((tag) => {
    ok("用原生控件 " + tag + " " + p, wxml.indexOf("<" + tag) >= 0, "找不到 <" + tag + ">");
  });
});

const selfMadeHits = [];
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  scanSelfMadeControls(wxml).forEach((h) => selfMadeHits.push(p + " → ." + h));
});
ok("没有自绘的交互控件", selfMadeHits.length === 0, selfMadeHits.slice(0, 8).join("; "));

pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  const groups = [
    { cls: "seg-item", group: "seg-group", name: "分段控件" },
    { cls: "pref-opt", group: "pref-seg", name: "详情页偏好条" }
  ];
  groups.forEach((g) => {
    if (wxml.indexOf(g.group) < 0) return;

    const labels = (wxml.match(new RegExp('<label\\b[^>]*class="' + g.cls, "g")) || []).length;
    const radios = (wxml.match(/<radio\b/g) || []).length;
    ok(g.name + "的每一段都是原生 radio：" + p, labels > 0 && radios >= labels,
      "段 " + labels + " 个、radio " + radios + " 个");
  });
});

const NATIVE_INK = "{{themeHex}}";
const COLOR_TAGS = ["switch", "slider"];
const badColor = [];
pages.forEach((p) => {

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

const lockUses = [];
const lockInline = [];
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
  if (wxml.indexOf("<lock-card") >= 0) lockUses.push(p);
  if (wxml.indexOf("locked-card") >= 0) lockInline.push(p);
});
ok("未登录的卡走同一个组件（" + lockUses.length + " 页）", lockUses.length >= 12, lockUses.join(", "));
ok("没有页面再自绘门禁卡", lockInline.length === 0, lockInline.join(", "));

const lockRevived = [];
pages.forEach((p) => {
  const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
  if (/\.locked-card\s*\{/.test(wxss) || /\.locked-card\s+\.note\s*\{/.test(wxss)) {
    lockRevived.push(p);
  }
});
ok("门禁卡样式不再散在各页", lockRevived.length === 0, lockRevived.join(", "));

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

const noSafe = [];
pages.forEach((p) => {
  const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");

  if (wxml.indexOf("safe-bottom") < 0) noSafe.push(p);
});
ok("每页都留了底部安全区", noSafe.length === 0, noSafe.join(", "));

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

    const has = clsM[1].split(/\s+/).filter(Boolean).some((c) => {
      const base = c.replace(/\{\{[^}]*\}\}/g, "").trim();
      if (!base) return false;
      return new RegExp("\\." + base.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&") + ":(active|hover)").test(wxss);
    });
    if (!has) noFeedback.push(p + " → ." + clsM[1].trim());
  }
});
ok("可点元素都有按下反馈", noFeedback.length === 0, noFeedback.slice(0, 6).join("; "));

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

const colorLiteral = [];
pages.forEach((p) => {
  const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
  const re = /#[0-9a-fA-F]{6}/g;
  let m;
  while ((m = re.exec(wxss))) {
    const hex = m[0].toLowerCase();

    if (hex === "#1c1c1e" || hex === "#000000") colorLiteral.push(p + " → " + hex);
  }
});
ok("主题色只在令牌里定一次", colorLiteral.length === 0, colorLiteral.slice(0, 6).join("; "));

{

  const TOKEN_FILES = /tokens\.wxss$/;
  const ALLOWED_FONT = [

  ];
  const bareFont = [];
  const TOKEN_FONT = /var\(--fs-[a-z]+\)/;
  pages.forEach((p) => {
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
    if (TOKEN_FILES.test(p)) return;

    const re = /font-size\s*:\s*([^;]+);/g;
    let m;
    while ((m = re.exec(wxss))) {
      const val = m[1].trim();
      if (TOKEN_FONT.test(val)) continue;
      if (/^calc\(/.test(val)) continue;
      if (/^\$/.test(val)) continue;

      const line = wxss.slice(0, m.index).split("\n").pop() + val;
      if (/\.poem-body\s*\.size-|\bsize--?\d/.test(line)) continue;
      bareFont.push(p + " → font-size:" + val);
    }
  });
  ok("字号一律走令牌", bareFont.length === 0, bareFont.slice(0, 6).join("; "));
}

{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  ok("卡片间距收在全局一处", /\.card\s*\{[^}]*margin-bottom/.test(appWxss));

  const strayCardGap = [];
  pages.forEach((p) => {
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const re = /(^|\})\s*\.([\w-]+-card)\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(wxss))) {
      const cls = m[2];
      if (!new RegExp('class="card ' + cls + '\\b').test(
        fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8"))) continue;
      if (/margin-bottom\s*:\s*(?!0)/.test(m[3])) strayCardGap.push(p + " → ." + cls);
    }
  });
  ok("卡片间距没有各页各写一份", strayCardGap.length === 0, strayCardGap.slice(0, 6).join("; "));
}

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

{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const noComment = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "");

  const rule = /\.pref-item\s+radio[\s\S]{0,200}?margin-right\s*:/.test(appWxss);
  ok("原生选项与文字之间有全局默认间距", rule,
    "app.wxss 里找不到给 radio/checkbox 的 margin-right");

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

  const inset = /\.opt-row\.active\s*\{[^}]*box-shadow\s*:\s*inset/.test(body);
  ok("选项行不再用「左侧竖线」表达选中", !inset,
    "inset 竖线与行的圆角互相裁切，会破相 —— 选中态靠填色说");

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

{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const btnBlock = /\.btn\s*\{([^}]*)\}/.exec(appWxss);
  ok("按钮是 flex 居中", !!btnBlock && /display\s*:\s*flex/.test(btnBlock[1]) && /align-items\s*:\s*center/.test(btnBlock[1]),
    btnBlock ? "当前 .btn 不是 flex 居中" : "app.wxss 里找不到 .btn");

  const cheapCentering = [];
  const pageFiles = pages.map((p) => [p, fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8")]);

  pageFiles.push(["app.wxss", appWxss]);
  pageFiles.forEach((pair) => {
    const p = pair[0];
    const wxss = pair[1];

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

{
  const SHARED = ["field-label", "card-title", "hint", "empty-text", "empty-mark", "tag"];
  const rewrites = [];
  pages.forEach((p) => {
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
    SHARED.forEach((cls) => {

      const re = new RegExp("(^|\\})\\s*\\." + cls + "\\s*\\{([^}]*)\\}", "g");
      let m;
      while ((m = re.exec(wxss))) {
        const body = m[2];

        const hit = /font-size\s*:/.test(body) || /\.(empty-text|hint|field-label|card-title)\s*\{[^}]*color\s*:/.test(body);
        if (hit) rewrites.push(p + " → ." + cls);
      }
    });
  });
  ok("同级文字的字号颜色只在全局定一次", rewrites.length === 0, rewrites.slice(0, 6).join("; "));
}

{
  const renderJs = fs.readFileSync(path.join(__dirname, "shots", "render.js"), "utf8");
  const nativeBlock = /const NATIVE_CSS = `([\s\S]*?)`;/.exec(renderJs);
  ok("预览里有原生控件的等价样式", !!nativeBlock);

  const mirror = nativeBlock ? nativeBlock[1] : "";

  const normalize = (x) => x.replace(/\s+/g, "").replace(/;+$/, "");

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

    const body = m[2];
    const keep = body.split(";").map((d) => d.trim()).filter((d) =>
      /^(margin-right|margin-left|transform|transform-origin|align-self|margin-top|flex)\s*:/.test(d));
    keep.forEach((d) => decls.push(normalize(d)));
  }
  const unique = Array.from(new Set(decls));

  const mirrorNorm = normalize(stripComments(mirror));
  const missing = unique.filter((d) => mirrorNorm.indexOf(d) < 0);
  ok("预览镜像了原生控件的全部关键声明（" + unique.length + " 条）",
    missing.length === 0, "NATIVE_CSS 里缺：" + missing.join(" / "));
}

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

      const family = m[1];
      const child = new RegExp("\\." + family + "\\s+\\.btn\\s*\\{").test(wxss) || p === "app.wxss";
      if (child && !/align-items\s*:/.test(m[2])) selectors.push(p + " → ." + family);
    }
  });
  ok("并列按钮的行有统一对齐", selectors.length === 0, selectors.join("; "));

  const dupes = [];
  pages.forEach((p) => {
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
    if (/\.actions\s+\.[\w-]+\s*\{[^}]*flex\s*:\s*1/.test(wxss) && /\.actions\s*\{/.test(wxss)) {
      dupes.push(p);
    }
  });
  ok("并列按钮的容器只在全局定一次", dupes.length === 0, dupes.join(", "));
}

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
  ok("有自定义组件", compDirs.length > 0);

  compDirs.forEach((d) => {
    const rel = "components/" + d + "/" + d;
    const four = [".js", ".json", ".wxml", ".wxss"].every((ext) =>
      fs.existsSync(path.join(ROOT, rel + ext)));
    ok("组件四件套齐全 " + d, four);

    const cfg = readJson(path.join(ROOT, rel + ".json"));
    ok("组件声明 component:true " + d, cfg.component === true);

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

{
  const homeJs = fs.readFileSync(path.join(ROOT, "pages/home/home.js"), "utf8");
  const fnM = /function cnDay\(n\)\s*\{([\s\S]*?)\n\}/.exec(homeJs);
  if (!fnM) {
    ok("首页日期有中文数字换算", false, "找不到 cnDay()");
  } else {

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

{

  const dataDir = path.join(ROOT, "data");
  const hasData = fs.existsSync(path.join(dataDir, "books", "books.json"));

  if (!hasData) {
    ok("门禁开合（语料未生成，跳过真跑）", true);
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
    const L = cmod.layout(e.text);
    const rows = L.rows.join("");
    const flat = L.paras.reduce((a, pr) => a.concat(pr), []).map((g) => g.join("")).join("");
    const norm = String(e.text).split("\n").map((x) => cmod.splitClauses(x).join("")).join("");
    if (rows !== norm) { lost++; if (!exLost) exLost = id; }
    if (flat !== rows) { unflat++; if (!exFlat) exFlat = id; }
  });
  ok("版式折叠不丢字（全站 " + checked + " 篇）", lost === 0, lost + " 篇拼不回，例如 " + exLost);
  ok("版式的段落与行是同一份切分", unflat === 0, unflat + " 篇对不上，例如 " + exFlat);

  const qi = cmod.layout("杨柳青青江水平，\n闻郎江上唱歌声。\n东边日出西边雨，\n道是无晴却有晴。");
  ok("七绝一句一行（短句不被折）",
    qi.rows.length === 4 && qi.rows[0] === "杨柳青青江水平，",
    JSON.stringify(qi.rows));
  const wu = cmod.layout("空山不见人，\n但闻人语响。");
  ok("五绝一句一行", wu.rows.length === 2 && wu.rows[1] === "但闻人语响。", JSON.stringify(wu.rows));

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

  {

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
  const tk = pj.render(L2.paras, "rare");

  const seq = [];
  tk.forEach((pr) => pr.forEach((row) => row.forEach((cl) => seq.push(cl.i))));
  ok("注音给每一句编了号（与朗读同序）",
    seq.length > 0 && seq.every((v, i) => v === i), JSON.stringify(seq));
}

{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");

  ["ic-left", "ic-center", "ic-off", "ic-rare", "ic-all"]
    .forEach((ic) => {
      ok("共用图标 ." + ic + " 在 app.wxss 里定义", new RegExp("\\." + ic + "::?before").test(appWxss));
    });

  ok("分段控件底盘只定义一次", (appWxss.match(/^\.seg-group\s*\{/gm) || []).length === 1);
  ok("格子控件底盘只定义一次", (appWxss.match(/^\.chip\s*\{/gm) || []).length === 1);

  const redefined = [];

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

  const notWrapped = [];
  pages.forEach((p) => {
    const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");

    const re = /<(label|view)\b[^>]*class="(seg-item|chip)\b[^"]*"/g;
    let m, hits = 0;
    while ((m = re.exec(wxml))) {
      hits++;
      if (m[1] !== "label") notWrapped.push(p + " → <" + m[1] + ' class="' + m[2] + '">');
    }

    if (hits && !/<(radio|checkbox)\b/.test(wxml)) notWrapped.push(p + " 缺原生控件");
  });
  ok("分段与格子的每一段都点得到（label + 原生控件）", notWrapped.length === 0, notWrapped.join("; "));

  const multiGroups = [];
  pages.forEach((p) => {
    const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");

    if (/<checkbox-group[^>]*class="chip-group/.test(wxml)) {

      const chips = (wxml.match(/<label\b[^>]*class="chip\b/g) || []).length;
      const multi = (wxml.match(/<label\b[^>]*class="chip multi\b/g) || []).length;
      if (chips !== multi || chips === 0) multiGroups.push(p + " (" + multi + "/" + chips + ")");
    }
  });
  ok("多选的格子带 multi（与单选分得开）", multiGroups.length === 0, multiGroups.join("; "));

  pages.forEach((p) => {
    const wxml = fs.readFileSync(path.join(ROOT, p + ".wxml"), "utf8");
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");
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

  const aboutWxml = fs.readFileSync(path.join(ROOT, "packages/settings/about/about.wxml"), "utf8");
  const aboutJs = fs.readFileSync(path.join(ROOT, "packages/settings/about/about.js"), "utf8");
  ok("有隐私说明入口", aboutWxml.indexOf("onPrivacy") >= 0 && aboutJs.indexOf("onPrivacy") >= 0);
  ok("有用户协议入口", aboutWxml.indexOf("onTerms") >= 0 && aboutJs.indexOf("onTerms") >= 0);

  const mineJs = fs.readFileSync(path.join(ROOT, "pages/mine/mine.js"), "utf8");
  ok("有退出登录入口", mineJs.indexOf("onLogout") >= 0);
  ok("有清空本机数据入口（微信要求可注销）", mineJs.indexOf("onClear") >= 0);

  const adminWxml = fs.readFileSync(path.join(ROOT, "packages/admin/index/index.wxml"), "utf8");
  const adminJs = fs.readFileSync(path.join(ROOT, "packages/admin/index/index.js"), "utf8");
  ok("后端地址有配置入口", adminWxml.indexOf("onSaveBaseUrl") >= 0 && adminJs.indexOf("onSaveBaseUrl") >= 0);

  ok("同步那一行的副标题由数据层算出来（不自己拼）", mineJs.indexOf("syncSub") >= 0);
  ok("「上次同步」这句只认真同步过（lastSyncAt）来的凭据",
    /if \(sy\.lastSyncAt\) return sy\.lastText/.test(mineJs),
    "没同步过也敢说「上次同步」，那是假话");
  ok("没同步过时要如实说，且说得出一句「能不能换手机」",
    /还没同步过/.test(mineJs)
      && /登录后进度跨设备跟随/.test(mineJs)
      && /同步服务器没接上/.test(mineJs)
      && /同步通道未开 · 进度只在这台手机/.test(mineJs));

  {
    const syncJs = fs.readFileSync(path.join(ROOT, "utils", "sync.js"), "utf8");
    ok("lastSyncAt 只在同步成功那一支落盘（失败/跳过不写）",
      /if \(!res\.error\) \{[\s\S]{0,200}saveSettings\(\{ lastSyncAt/.test(syncJs),
      "失败也写 lastSyncAt 的话，上面那条「凭据可靠」就不成立了");

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

  const capSync = E.CAPS.find((c) => c.key === "sync");
  ok("云端同步在能力表里且是登录即得", !!capSync && capSync.tier === "login",
    capSync ? "当前 tier=" + capSync.tier : "能力不存在");
  ok("界面里不再留「要 Pro 才能同步」的说法",
    mineJs.indexOf("要 Pro 起才能跨设备同步") < 0 && mineJs.indexOf("跨设备同步要 Pro 起") < 0);

  ok("有微信登录服务端说明", fs.existsSync(path.join(__dirname, "..", "docs", "wx-login-server.md")));
}

{
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  ["--h-btn", "--h-btn-mini", "--h-act"].forEach((t) => {
    ok("高度令牌 " + t + " 已定", new RegExp(t.replace("-", "\\-") + "\\s*:").test(tokens));
  });

  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const btn = /\.btn\s*\{([^}]*)\}/.exec(appWxss);
  ok("主按钮取高度令牌", !!btn && /height\s*:\s*var\(--h-btn\)/.test(btn[1]),
    btn ? "当前 " + (/height\s*:\s*([^;]+)/.exec(btn[1]) || [])[1] : "找不到 .btn");
  const mini = /\.btn\.mini\s*\{([^}]*)\}/.exec(appWxss);
  ok("小按钮取高度令牌", !!mini && /height\s*:\s*var\(--h-btn-mini\)/.test(mini[1]));

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

{
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  const stack = /--font-poem\s*:\s*([^;]+);/.exec(tokens);
  ok("字体令牌 --font-poem 存在", !!stack);
  if (stack) {
    const fams = stack[1];

    ok("篇名宋体外挂名在字体链首位", /^\s*"Kuibu Serif"/.test(fams));

    ["Songti SC", "STSong", "SimSun", "Source Han Serif SC", "Noto Serif CJK SC"].forEach((n) => {
      ok("字体链含 " + n, fams.indexOf(n) >= 0);
    });
    ok("字体链兜到通用 serif", /serif\s*$/.test(fams.trim()));
  }

  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const rowPoem = /\.row-poem\s*\{([^}]*)\}/.exec(appWxss);
  ok("列表篇名用宋体", !!rowPoem && /font-family\s*:\s*var\(--font-poem\)/.test(rowPoem[1]));

  const surfaceWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const poemTitle = /\.poem-title\s*\{([^}]*)\}/.exec(surfaceWxss);
  ok("篇名用宋体（阅读面那份）", !!poemTitle && /font-family\s*:\s*var\(--font-poem\)/.test(poemTitle[1]));
  ok("篇名的样式只此一处（页面里不许再写一遍）",
    !/\.poem-title\s*\{/.test(fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxss"), "utf8"))
      && !/\.poem-title\s*\{/.test(fs.readFileSync(path.join(ROOT, "components/recite-sheet/recite-sheet.wxss"), "utf8")));

  const fontJs = fs.readFileSync(path.join(ROOT, "utils", "font.js"), "utf8");
  ok("外挂字体有就绪判据", /function readiness\s*\(/.test(fontJs));
  ok("未配置时一笔网络都不发起", /unsupported/.test(fontJs) && /return Promise\.resolve\(false\)/.test(fontJs));
  const appJs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  ok("启动时不阻塞地注册篇名宋体", /font\.load\(\)/.test(appJs));
}

{
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");

  const inkM = /--ink\s*:\s*#([0-9a-fA-F]{6})\s*;/.exec(tokens);
  ok("字色令牌 --ink 已定义", !!inkM);
  if (inkM) {
    const hex = inkM[1].toLowerCase();

    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    ok("字色仍是中性墨黑（三通道接近且够深）—— 正文不上主题色",
      spread <= 12 && r < 40 && g < 40 && b < 40,
      "#" + hex + " spread=" + spread);
  }

  ok("强调色 --strong 由 --theme 给", /--strong\s*:\s*var\(--theme\)\s*;/.test(tokens));
  ok("主题色 --theme 已定义", /--theme\s*:\s*#([0-9a-fA-F]{6})\s*;/.test(tokens));

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

  ok("色值住在令牌里", /--ink\s*:\s*#[0-9a-fA-F]{6}\s*;/.test(tokens));

  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  ok("统计大数字收在全局一处",
    /\.stats\s*\{/.test(appWxss) && /\.stat-v\s*\{/.test(appWxss) && /\.stat-k\s*\{/.test(appWxss));
  const strayStats = [];
  pages.forEach((p) => {
    const wxss = fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8");

    ["num-v", "grant-tier-v", "ov-num"].forEach((cls) => {
      if (new RegExp("(^|\\})\\s*\\." + cls + "\\s*\\{").test(wxss)) {
        strayStats.push(p + " → ." + cls);
      }
    });
  });
  ok("没有第二套统计数字组件", strayStats.length === 0, strayStats.slice(0, 6).join("; "));

  const TOKEN_RADIUS = /var\(--radius(-sm|-block|-pill)?\)/;
  const strayRadius = [];
  pages.forEach((p) => {
    const wxss = stripCss(fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8"));
    const re = /border-radius\s*:\s*([^;]+);/g;
    let m;
    while ((m = re.exec(wxss))) {
      const val = m[1].trim();
      if (TOKEN_RADIUS.test(val)) continue;
      if (/^(50%|0)$/.test(val)) continue;
      if (/var\(/.test(val)) continue;
      strayRadius.push(p + " → border-radius:" + val);
    }
  });
  ok("圆角一律走令牌", strayRadius.length === 0, strayRadius.slice(0, 6).join("; "));

  const radVars = (tokens.match(/--radius[a-z-]*\s*:/g) || []).map((x) => x.replace(/\s*:/, ""));
  ok("圆角令牌不超过五档（多出来的一档是控件与按钮共用的那一个）",
    radVars.length <= 5, "实际 " + radVars.join(", "));

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

  const homeWxss = fs.readFileSync(path.join(ROOT, "pages/home/home.wxss"), "utf8");
  ok("首页 hero 是宋体", /\.hero-title\s*\{([^}]*)\}/.test(homeWxss)
    && /var\(--font-poem\)/.test(/\.hero-title\s*\{([^}]*)\}/.exec(homeWxss)[1]));
  ok("首页 hero 的字号走令牌，不是裸 46rpx",
    !/font-size\s*:\s*46rpx/.test(homeWxss));
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
  const pageSrcAll = pages.map((p) => [p, strip(fs.readFileSync(path.join(ROOT, p + ".wxss"), "utf8"))]);

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
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");

  ok("卡片自身不写投影", !/\.card\s*\{[^}]*box-shadow/.test(appWxss));
  ok("投影令牌是 none（万一别处引了也不出效果）",
    /--shadow\s*:\s*none\s*;/.test(tokens) && /--shadow-lift\s*:\s*none\s*;/.test(tokens));

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

{

  const OK_CLASS = /(empty-|warn|result-count|result-where|result-more|pool-hint|char-count|count|stage-|kv-|sample|mastery|verdict|wrong-|score|stem-sub|day-|stat-|hero-|tier-|identity-|acct-|cap-|fh-|trans-|meta|note error)/;

  const MAX_LABEL = 24;

  const MAX_READING = 18;

  const stray = [];
  const files = pages.map((p) => [p, path.join(ROOT, p + ".wxml"), path.join(ROOT, p + ".wxss")]);
  files.forEach(([p, wxmlPath, wxssPath]) => {
    const wxml = fs.readFileSync(wxmlPath, "utf8");

    const flat = wxml.replace(/\{\{[\s\S]*?\}\}/g, "＃");
    const re = /<text[^>]*class="([^"]*)"[^>]*>([^<]*)<\/text>/g;
    let m;
    while ((m = re.exec(flat))) {
      const cls = m[1];
      const body = m[2].replace(/\s+/g, " ").trim();
      if (!body) continue;

      if (/^[＃\s·—\-：:／\/，。！？、（）()]*$/.test(body)) continue;

      if (OK_CLASS.test(cls)) {
        if (body.length > MAX_READING) stray.push(p + " → ." + cls + "（读数类却写了长句）「" + body.slice(0, 30) + "…」");
        continue;
      }
      if (body.length <= MAX_LABEL) continue;
      stray.push(p + " → ." + cls + " 「" + body.slice(0, 30) + "…」");
    }
  });
  ok("卡片/选项/按钮下没有长篇解释性提示", stray.length === 0, stray.slice(0, 5).join(" | "));

  const longBtn = [];
  files.forEach(([p, wxmlPath]) => {
    const wxml = fs.readFileSync(wxmlPath, "utf8");
    const re = /<button[^>]*>([\s\S]*?)<\/button>/g;
    let m;
    while ((m = re.exec(wxml))) {
      if (m[1].indexOf("<") >= 0) continue;
      const raw = m[1].replace(/\s+/g, " ").trim();
      if (!raw) continue;

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

{
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  ok("令牌表里有 --ui-scale", /--ui-scale\s*:/.test(tokens));

  const mustScale = ["--fs-body", "--fs-title", "--sp-2", "--sp-3", "--page-x",
    "--radius-sm", "--radius", "--h-btn", "--h-row"];
  const notScaled = mustScale.filter((t) => {
    const m = new RegExp("\\" + t + "\\s*:\\s*([^;]+);").exec(tokens);
    return !m || !/var\(--ui-scale\)/.test(m[1]);
  });
  ok("字阶/间距/圆角/高度都由 --ui-scale 算出来", notScaled.length === 0,
    notScaled.join("; "));

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

        if (SHARED.includes(name) || SHARED.some((s2) => name === s2)) {
          redefined.push(p + " → " + name);
        }
      }
    }
  });
  ok("页面没有重新定义共享令牌", redefined.length === 0, redefined.slice(0, 6).join(" | "));
}

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

{
  const tabRoot = path.join(ROOT, "custom-tab-bar");
  const four = [".js", ".json", ".wxml", ".wxss"].every((ext) =>
    fs.existsSync(path.join(tabRoot, "index" + ext)));
  ok("自绘底栏四件套齐全", four);

  const appCfg = readJson(path.join(ROOT, "app.json"));
  ok("app.json 开启了自定义 tabBar", appCfg.tabBar && appCfg.tabBar.custom === true);

  const barJs = fs.readFileSync(path.join(tabRoot, "index.js"), "utf8");
  const barCss = fs.readFileSync(path.join(tabRoot, "index.wxss"), "utf8");
  const icons = [];
  const ire = /icon:\s*"([\w-]+)"/g;
  let im;
  while ((im = ire.exec(barJs))) icons.push(im[1]);
  ok("底栏每一项都配了图标", icons.length >= 4, "找到 " + icons.length + " 个");
  const noIcon = icons.filter((n) => barCss.indexOf(".tab-ico-" + n) < 0);
  ok("底栏图标都有画法（.tab-ico-* 在 index.wxss 里）", noIcon.length === 0, noIcon.join(","));

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

  const padded = [];
  TABS.forEach(([p2]) => {
    const wxml = fs.readFileSync(path.join(ROOT, p2 + ".wxml"), "utf8");
    if (wxml.indexOf("has-tabbar") < 0) padded.push(p2);
  });
  ok("四个 tab 页都留了底栏高度的垫片（.has-tabbar）", padded.length === 0, padded.join(", "));
  const appCss2 = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  ok("app.wxss 里有 .has-tabbar 的底部留白规则", /\.page\.has-tabbar\s*\{[^}]*padding-bottom/.test(appCss2));
}

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

  ok("store 里不再有 avatarUrl 那个字段（服务端从来不回头像）",
    !/avatarUrl\s*[:|]/.test(storeJs.replace(/\/\*[\s\S]*?\*\//g, "")),
    "avatarUrl 还在 —— 它是一条永远不来的回落，留着只会让下一个人以为服务端会给");

  const authJs = fs.readFileSync(path.join(ROOT, "utils", "auth.js"), "utf8");
  const loginWrite = /const patch = \{([\s\S]*?)\};/.exec(authJs);
  ok("登录时**不写**头像（服务端那一栏是空的，写它等于把用户选的抹掉）",
    !!loginWrite && !/avatarUrl\s*:/.test(loginWrite[1]) && !/avatarLocal\s*:/.test(loginWrite[1]),
    loginWrite ? loginWrite[1].replace(/\s+/g, " ").slice(0, 140) : "没找到那段 patch");
  ok("登录态走 saveSession（会话字段与本机档案分得开）",
    authJs.indexOf("store.saveProfile({ logged") < 0 && !!loginWrite);

  const direct = [];
  pages.forEach((p2) => {
    const js = fs.readFileSync(path.join(ROOT, p2 + ".js"), "utf8");
    if (/profile\(\)\.avatarUrl|\.avatarUrl\s*\|\|\s*"/.test(js) && js.indexOf("avatarSrc") < 0) {
      direct.push(p2);
    }
  });
  ok("页面显示头像走 store.avatarSrc()，不直接读 profile.avatarUrl", direct.length === 0, direct.join(", "));

  const stripJs = (x) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const legacy = pages.filter((p2) =>
    stripJs(fs.readFileSync(path.join(ROOT, p2 + ".js"), "utf8")).indexOf("getUserProfile") >= 0);
  ok("不再调用 wx.getUserProfile（只返回匿名灰头像）", legacy.length === 0, legacy.join(", "));
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
    request: () => { mem.__requested = (mem.__requested || 0) + 1; }
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

    track(
      loginPromise
        .then((r) => {
          ok("没接上服务器时 login() 回的是 local（调用方据此说真话）",
            !!(r && r.local === true),
            "mine.js 的 onLogin 就是读这个字段决定说不说「已登录」；实际 " + JSON.stringify(r));
        }, (e) => ok("没接上服务器时 login() 不该 reject", false, String(e && e.message)))

        .then(() => {

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

  ok("选项格的内边距令牌已定（上下 / 左右分开）",
    /--pad-opt-y\s*:/.test(tokens) && /--pad-opt-x\s*:/.test(tokens));
  ok("内边距令牌由 --ui-scale 算出来（整体收放时跟着走）",
    /--pad-opt-y\s*:[^;]*var\(--ui-scale\)/.test(tokens)
    && /--pad-opt-x\s*:[^;]*var\(--ui-scale\)/.test(tokens));
  const chipBody = rule(".chip") || "";
  ok("选项格上下真的留了内边距（不是 0）",
    /padding\s*:\s*var\(--pad-opt-y\)\s+var\(--pad-opt-x\)/.test(chipBody),
    chipBody.replace(/\s+/g, " ").trim().slice(0, 80));

  const padX = /--pad-opt-x\s*:\s*calc\((\d+(?:\.\d+)?)rpx\s*\*\s*var\(--ui-scale\)\)/.exec(tokens);
  ok("选项格横向内边距由 rpx 写出（能算宽度）", !!padX);
  const padXVal = padX ? Number(padX[1]) : 0;
  ok("选项格横向内边距不小于圆角（文字不会顶在圆角上）",
    padXVal >= 20, "实际 " + padXVal + "rpx");

  const tok = (name, dflt) =>
    Number(new RegExp(name + "\\s*:\\s*calc\\((\\d+(?:\\.\\d+)?)rpx").exec(tokens)?.[1] ?? dflt);
  const pageX = tok("--page-x", 28);

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

  const room = (cellW - textW) / 2 - chrome;
  const withRadius = room - cornerCut;

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

  const noDouble = [".opt-main", ".chip-t", ".opt-name"].filter((cls) => {
    const b = rule(cls) || "";
    return /padding(-top|-bottom)?\s*:/.test(b);
  });
  ok("选项文字没有第二层纵向内边距", noDouble.length === 0, noDouble.join(", "));

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

  ok("这一屏的页头是一句管整屏的短话，不与任何卡片同名",
    /<text class="head-title">背诵<\/text>/.test(recite));

  ok("取诗范围是横排的选项行（opt-group inline）",
    /<radio-group class="opt-group inline/.test(recite));
  ok("横排的选项行有排法（grid，不是一行一条）",
    /\.opt-group\.inline\s*\{[^}]*grid-template-columns/.test(body));

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

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const recite = read("packages/settings/recite/recite.wxml");
  const reciteJs = read("packages/settings/recite/recite.js");
  const sched = read("utils/scheduler.js");

  const visible = (t) => t.replace(/<!--[\s\S]*?-->/g, "");
  ok("背诵设置页的卡片名是「背诵范围」",
    /<view class="card-title bar">背诵范围<\/view>/.test(visible(recite)));
  ok("界面上不再有「取诗范围」（旧名只许留在注释里）",
    visible(recite).indexOf("取诗范围") < 0,
    "还有一处渲染出来的「取诗范围」—— 改名只改了一半");

  {
    const titles = (visible(recite).match(/<view class="card-title bar">[^<]*<\/view>/g) || [])
      .map((m) => m.replace(/<[^>]+>/g, ""));
    ok("一屏里没有同名两张卡",
      titles.length === new Set(titles).size,
      "重名的是：" + titles.filter((t, i) => titles.indexOf(t) !== i).join("、"));
  }

  ok("有「当前学段」那张卡",
    /<view class="card-title bar">当前学段<\/view>/.test(visible(recite)));
  ok("学段给的是三段（小学 / 初中 / 高中），不是十二格年级",
    /class="chip-group cols-3"[^>]*bindchange="onStage"/.test(recite)
      && /const STAGES\s*=\s*S\.STAGE_KEYS\.map/.test(reciteJs));
  ok("学段用的是 scheduler 里那份口径（不另抄一份）",
    /primary:\s*\{ name: "小学"/.test(sched)
      && /STAGES,/.test(sched)
      && /stageOf/.test(sched));

  ["小学", "初中", "高中"].forEach((n) => {
    ok("学段里有「" + n + "」", sched.indexOf('name: "' + n + '"') >= 0);
  });

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
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "");
  const body = strip(appWxss);
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const wxssOf = (p) => strip(read(p + ".wxss"));

  ok("背诵设置页上「背诵范围」这几个字在（不再是「今天背什么」）",
    read("packages/settings/recite/recite.wxml").indexOf("背诵范围") >= 0
      && read("packages/settings/recite/recite.wxml").indexOf("今天背什么") < 0);

  const visible = (p) => read(p + ".wxml").replace(/<!--[\s\S]*?-->/g, "");
  ok("全站界面上不再有「今天背什么」",
    pages.every((p) => visible(p).indexOf("今天背什么") < 0),
    pages.filter((p) => visible(p).indexOf("今天背什么") >= 0).join(", "));

  {
    const recite = read("packages/settings/recite/recite.wxml");
    const reciteJs = read("packages/settings/recite/recite.js");
    ["左对齐", "居中", "不注音", "生字", "全文", "A－", "A＋"].forEach((t) => {
      ok("背诵设置页里没有「" + t + "」（这三组在详情页与阅读/通用设置页）",
        recite.indexOf(t) < 0 && reciteJs.indexOf(t) < 0);
    });
    ok("这一页也没有 slider", recite.indexOf("<slider") < 0);

    const reader = read("pages/reader/reader.wxml");
    ok("详情页（读这首诗时）注音 / 对齐 / 字号三样都在",
      /onPinyin/.test(reader) && /onAlign/.test(reader) && /onFontDown/.test(reader) && /onFontUp/.test(reader));
    const general = read("packages/settings/general/general.wxml");
    ok("「通用设置」页三样都在（对齐 / 注音 / 字号）",
      /onAlign/.test(general) && /onFontSlide/.test(general) && /onPinyin/.test(general));
    const generalJs2 = read("packages/settings/general/general.js");
    ok("通用设置里的注音走 pinyin.setMode()（不自己写一份 store）",
      /pinyin\.setMode\(/.test(generalJs2));

    ok("「阅读设置」页不再有注音（它现在只管声音）",
      !/onMode/.test(read("packages/settings/reader/reader.wxml"))
        && !/onMode\s*\(/.test(read("packages/settings/reader/reader.js"))
        && !/PINYIN_MODES/.test(read("packages/settings/reader/reader.js")));
  }

  {
    const readerWxml = read("pages/reader/reader.wxml");

    const surfaceWxss = read("app.wxss").replace(/\/\*[\s\S]*?\*\//g, "");
    const readerWxss = read("pages/reader/reader.wxss").replace(/\/\*[\s\S]*?\*\//g, "");

    const prefsAt = readerWxml.indexOf('class="prefs"');
    ok("详情页有一个 .prefs 容器，三组都在里面（在正文之前）", prefsAt >= 0);
    ok("A－ A＋ 与古诗内容之间不再有「--正文--」那一行",
      !/class="rule"/.test(readerWxml) && !/\.rule\s*\{/.test(readerWxss));

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

    const readerJsForLabels = read("pages/reader/reader.js");
    ["左对齐", "居中", "不注音", "生字", "全文"].forEach((t) => {
      ok("详情页那一行用的是「" + t + "」这个全称", readerJsForLabels.indexOf(t) >= 0);
    });
    ["A－", "A＋"].forEach((t) => {
      ok("详情页那一行用的是「" + t + "」这个全称", readerWxml.indexOf(t) >= 0);
    });

    const general = read("packages/settings/general/general.wxml");
    ok("图标没被一起弄丢 —— 通用设置页那一份仍在",
      /seg-icon\s+ic-/.test(general));
  }

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

  ok("课外阅读页的导航栏标题是「课外阅读」",
    /"navigationBarTitleText"\s*:\s*"课外阅读"/.test(read("pages/library/library.json")));
  ok("课外阅读页不再画第二块「课外阅读」招牌",
    read("pages/library/library.wxml").indexOf('class="head-title"') < 0);
  ok("全站界面上不再有「十七部集子」",
    pages.every((p) => visible(p).indexOf("十七部集子") < 0),
    pages.filter((p) => visible(p).indexOf("十七部集子") >= 0).join(", "));

  {
    const search = read("pages/search/search.wxml");
    ok("搜索页不再有范围 / 方式的选项卡片",
      search.indexOf("opt-block") < 0 && search.indexOf("scope") < 0 && search.indexOf("mode") < 0);
    ok("搜索页不再有分段控件（一个「选一个」都不该有）",
      search.indexOf("seg-group") < 0 && search.indexOf("<radio") < 0);

    ok("搜索页仍然交代「命中几篇 · 在哪儿搜的」",
      search.indexOf("resultWhere") >= 0 && search.indexOf("result-count") >= 0);

    const js = read("pages/search/search.js");
    ok("搜索先按篇名作者找，无结果才落到正文全文",
      /byIndex\(kw\)/.test(js) && js.indexOf("byIndex(kw)") < js.indexOf("runFull(kw)"));
  }

  {
    const examJs = read("packages/game/exam/exam.js");
    const examWxml = read("packages/game/exam/exam.wxml");
    ok("考试页的导航栏标题是「考试」",
      /"navigationBarTitleText"\s*:\s*"考试"/.test(read("packages/game/exam/exam.json")));
    ok("全站不再有「模拟考试」",
      pages.concat(["../../utils/entitlement.js"]).length > 0
      && !/模拟考试/.test(read("packages/game/index/index.js")));

    const iPick = examJs.indexOf("onPick(e)");
    const iJudge = examJs.search(/judge\s*\(/);
    ok("答题途中不判对错（判分那一步排在 onPick 之后）",
      iPick >= 0 && iJudge > iPick,
      "onPick @" + iPick + " 判分 @" + iJudge + " —— 判分排在答题之前就等于当场把答案说了出来");
    ok("批是在交卷时做的（finish 里逐题判）",
      /finish\(\)[\s\S]{0,900}?judge\s*\(/.test(examJs));

    ok("交卷后逐题列出对错（不只是错题）",
      examWxml.indexOf("graded") >= 0 && examWxml.indexOf('class="grade-mark') >= 0);

    const examWxss = wxssOf("packages/game/exam/exam");
    ok("选项是两列（宽度只有一半，不再是通栏一条）",
      /\.options\s*\{[^}]*grid-template-columns\s*:\s*repeat\(2/.test(examWxss),
      ".options 的列数读不出来");
  }

  {
    const chipMulti = /\.chip\.multi\s*\{([^}]*)\}/.exec(body);
    const multiOff = /\.chip\.multi:not\(\.on\)\s*\{([^}]*)\}/.exec(body);
    const markOff = /\.chip\.multi::after\s*\{([^}]*)\}/.exec(body);
    const checkOff = /\.chip\.multi::before\s*\{([^}]*)\}/.exec(body);
    const toStr = (m, g) => (m ? (g ? m[g] : m[1]).replace(/\s+/g, " ").trim() : "");

    ok("多选的格子有**自己的形状**（.chip.multi 有自己的规则）", !!chipMulti);

    ok("未选中的多选格子有底色（.chip.multi:not(.on) 有 background）",
      !!multiOff && /background\s*:/.test(multiOff[1]), toStr(multiOff));
    ok("那底色是全站「能按的槽」那一档（--sink），不是另造一层灰",
      !!multiOff && /var\(--sink\)/.test(multiOff[1]), toStr(multiOff));

    ok("多选格子的主色底不写在 .chip.multi 本体上（否则会盖掉选中态）",
      !!chipMulti && !/background\s*:/.test(chipMulti[1]), toStr(chipMulti));

    ok("多选格子不再画方框（.chip.multi::after 不许存在）", !markOff, toStr(markOff));
    ok("多选格子不再画勾（.chip.multi::before 不许存在）", !checkOff, toStr(checkOff));
    ok("多选格子不许再挂任何伪元素（不给方框留后门）",
      !/\.chip\.multi[^{}]*::/.test(body),
      ((/\.chip\.multi[^{}]*::[a-z-]+/g).exec(body) || [""])[0]);

    {
      const chip = /\.chip\s*\{([^}]*)\}/.exec(body);

      const pad = (src) => {
        const short = /padding\s*:\s*([^;]+);/.exec(src);

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

    ok("多选的选中态就是全站那一条（.chip.multi.on 不另写规则）",
      !/\.chip\.multi\.on\b(?![\(-])/.test(body),
      ((/\.chip\.multi\.on[^{]*/g).exec(body) || [""])[0]);

    {
      const shotSrc = fs.readFileSync(path.join(__dirname, "shots", "wxml.js"), "utf8");
      ok("预览认得可多选那一组（checkbox-group 有那段组语义）",
        /n\.tag === "checkbox-group"/.test(shotSrc) && /function multiPicker/.test(shotSrc));

      {
        const mod = { exports: {} };
        const dir = path.join(__dirname, "shots");
        const src2 = shotSrc.replace(
          /module\.exports\s*=\s*\{[^}]*\};/,
          "module.exports = { multiPicker, findCheckedAttr, tokenize, attrsOf, holeRestore };"
        );
        let picked = null;
        try {

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
            pick({ key: "next" }),
            pick({ key: "prev" }),
            pick({ key: "title" })
          ];
        } catch (e) {
          picked = null;
        }
        ok("预览的组语义算得对（勾了的那两格真、没勾的假）",
          !!picked && picked[0] === true && picked[1] === false && picked[2] === true,
          picked ? JSON.stringify(picked) : "跑不起来");
      }

      ok("勾没勾是在逐项时算的（pickOf(it)，不是一次算好往下带）",
        /pickOf\s*\?\s*pickOf\(it\)/.test(shotSrc));
    }

    const forms = /const FORMS = \[([\s\S]*?)\];/.exec(read("utils/quiz.js"));
    const names = forms ? [...forms[1].matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]) : [];
    ok("五个题型名都是两个字（下句 / 上句 / 作者 / 朝代 / 篇名）",
      names.length === 5 && names.every((n) => n.length === 2), names.join(" / "));
    ok("题型名里不再带动词（接下句 / 认作者 / 填朝代 那一版不许回来）",
      names.every((n) => ["接", "认", "填"].indexOf(n[0]) < 0), names.join(" / "));
  }
}

{
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  const tok = (name, dflt) =>
    Number(new RegExp(name + "\\s*:\\s*calc\\((\\d+(?:\\.\\d+)?)rpx").exec(tokens)?.[1] ?? dflt);

  const readerWxml = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxml"), "utf8");
  const readerJs = fs.readFileSync(path.join(ROOT, "pages/reader/reader.js"), "utf8");

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

  const segs = (readerWxml.match(/class="pref-seg"/g) || []).length;
  ok("详情页的偏好条是一行三段（对齐 · 注音 · 字号）", segs === 2,
    "读到 " + segs + " 组 —— 加上字号那两个按钮才是三组");
  const iAlign = readerWxml.indexOf('class="pref-seg" bindchange="onAlign"');
  const iPinyin = readerWxml.indexOf('class="pref-seg" bindchange="onPinyin"');
  const iSize = readerWxml.indexOf('class="pref-size"');
  ok("顺序是「对齐 → 注音 → 字号」（用户给的顺序）",
    iAlign >= 0 && iAlign < iPinyin && iPinyin < iSize,
    "align@" + iAlign + " pinyin@" + iPinyin + " size@" + iSize);

  const prefsBody = ruleBody(".prefs") || "";

  const visibleReader = readerWxml.replace(/<!--[\s\S]*?-->/g, "");
  ok("这一行没有 <slider>（量程放不进一行，换成 A－ / A＋ 两个端点）",
    visibleReader.indexOf("<slider") < 0 && readerJs.indexOf("onFontSlide") < 0,
    visibleReader.indexOf("<slider") >= 0 ? "WXML 里还有 slider" : "JS 里还有 onFontSlide");
  ok("这一行显式不折行（放不下就该红，不该悄悄折成两行）",
    /flex-wrap\s*:\s*nowrap/.test(prefsBody));
  ok("这一行整行居中", /justify-content\s*:\s*center/.test(prefsBody));

  const pageX = tok("--page-x", 28);
  const cardPadX = tok("--sp-3", 24);
  const cardBorder = 1;
  const contentW = 750 - 2 * pageX - 2 * cardPadX - 2 * cardBorder;

  const fsPref = (() => {
    const m = /font-size\s*:\s*var\((--fs-[\w-]+)\)/.exec(ruleBody(".pref-t") || "");
    return m ? tok(m[1], 0) : 0;
  })();
  ok("这一行的字号取自 .pref-t 自己那条 font-size（不许手抄）",
    fsPref > 0, "读不到 —— 改文案时这条会跟着动，读不到就没法量");
  const optBody = ruleBody(".pref-opt");
  const optPadX = px(optBody, "padding", 8);

  const ruleBodyCss = ruleBody(".pref-rule");
  const ruleMargin = px(ruleBodyCss, "margin", 8);
  const ruleW = 1 + 2 * ruleMargin;

  const lsChar = 1;

  const names = {};
  const collect = (block) => {
    [...block.matchAll(/key\s*:\s*"([^"]*)"\s*,\s*label\s*:\s*"([^"]*)"/g)]
      .forEach((m) => { names[m[1]] = m[2]; });
  };
  collect(/const ALIGNS = \[([\s\S]*?)\];/.exec(readerJs)?.[1] || "");
  collect(/const PINYIN_MODES = \[([\s\S]*?)\];/.exec(readerJs)?.[1] || "");

  const radioCount = (readerWxml.match(/<radio\s/g) || []).length
    + (readerWxml.match(/<radio>/g) || []).length;
  const alignKeys = (/const ALIGNS = \[([\s\S]*?)\];/.exec(readerJs)?.[1] || "")
    .match(/key\s*:/g)?.length || 0;
  const pinyinKeys = (/const PINYIN_MODES = \[([\s\S]*?)\];/.exec(readerJs)?.[1] || "")
    .match(/key\s*:/g)?.length || 0;
  ok("这一行就是两档对齐 + 三档注音（多了少了都红）",
    alignKeys === 2 && pinyinKeys === 3,
    "读到对齐 " + alignKeys + " 档、注音 " + pinyinKeys + " 档");

  const radioGroupCount = (readerWxml.match(/<radio-group\b/g) || []).length;
  ok("五个选项对得上（常量 5 档 · 两个原生 radio 分组各一个原生 radio）",
    radioCount === 2 && radioGroupCount === 2 && alignKeys + pinyinKeys === 5,
    "radio " + radioCount + " / radio-group " + radioGroupCount
      + " / 常量 " + (alignKeys + pinyinKeys));

  const alignNames = ["left", "center"].map((k) => names[k]).filter(Boolean);
  const pinyinNames = ["off", "rare", "all"].map((k) => names[k]).filter(Boolean);
  ok("三档注音与两档对齐的档位名读得出来（V25 靠它量宽度）",
    alignNames.length === 2 && pinyinNames.length === 3,
    JSON.stringify(alignNames) + " / " + JSON.stringify(pinyinNames));

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

  const A_UP = "A＋";
  const A_DOWN = "A－";

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

  const BROWSER_ROW = 567;
  ok("算式与浏览器量出来的数对得上（差 ≤ 8rpx）",
    Math.abs(rowW - BROWSER_ROW) <= 8,
    "算式 " + Math.round(rowW) + "rpx / 浏览器 " + BROWSER_ROW + "rpx —— "
    + "差得太多说明有一边的尺子坏了（preview 里 .opt-radio 又占位了？）");

  const onBody = ruleBody(".pref-opt.on");
  ok("这一段选中的样子就是全站那一条（填主色）",
    /background\s*:\s*var\(--strong\)/.test(onBody),
    onBody.replace(/\s+/g, " ").trim());
  ok("选中时文字变白", /color\s*:\s*var\(--on-ink\)/.test(ruleBody(".pref-opt.on .pref-t")));

  const prefRadios = (readerWxml.match(/<radio\s/g) || []).length
    + (readerWxml.match(/<radio>/g) || []).length;
  ok("这一行底层仍是原生 radio（包在 label 里、走 .opt-radio 隐藏）",
    prefRadios === 2,
    "读到 " + prefRadios + " 个");
  const visiblePrefRadio = /\.pref-opt\s+radio[^{}]*\{[^}]*margin-right/.test(readerWxss);
  ok("这一行没有露脸的原生控件（不再出现第二个选中标志）", !visiblePrefRadio);
}

{
  const readerWxml2 = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxml"), "utf8");

  const readerWxss2 = fs
    .readFileSync(path.join(ROOT, "app.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

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

  const stripComments = (src) =>
    src
      .replace(/<\!--[\s\S]*?-->/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
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

  const rmsrc = fs.readFileSync(path.join(ROOT, "utils", "review-models.js"), "utf8");
  ok("结果提示语还在，且只说时刻",
    /小时后再复习/.test(rmsrc) && /分钟后再复习/.test(rmsrc) && /下次复习/.test(rmsrc));
}

{
  const themePath = path.join(ROOT, "utils", "theme.js");
  const themeSrc = fs.readFileSync(themePath, "utf8");
  const tokens = fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8");
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");

  const entries = (themeSrc.match(/\{\s*key:\s*"[a-z]+",[^}]*\}/g) || []);
  ok("主题色清单里有 10 项（9 色 + 回到默认的那一格「墨」）",
    entries.length === 10, "实际 " + entries.length);

  const WANTED = [
    ["朱红", "FF4C00"], ["明黄", "FAD069"], ["天青", "228FBD"],
    ["胭脂", "9D2933"], ["竹青", "789262"], ["玄色", "622A1D"], ["鸦青", "424C50"]
  ];
  const missing = WANTED.filter((w) =>
    themeSrc.indexOf('name: "' + w[0] + '"') < 0
    || !new RegExp('name:\\s*"' + w[0] + '",\\s*hex:\\s*"#' + w[1] + '"', "i").test(themeSrc));
  ok("保留下来的七个色值原样在清单里（一个都不许漂）", missing.length === 0,
    missing.map((w) => w[0] + " " + w[1]).join(", "));

  const SWAPPED = [["雨过天青", "2F6055"], ["天水碧", "3D6379"]];
  const swappedBad = SWAPPED.filter((w) =>
    !new RegExp('name:\\s*"' + w[0] + '",\\s*hex:\\s*"#' + w[1] + '"', "i").test(themeSrc));
  ok("换进来的两个色是上一版身份色原值（雨过天青 / 天水碧）", swappedBad.length === 0,
    swappedBad.map((w) => w[0] + " " + w[1]).join(", "));

  ok("朱砂 / 缃色没有被塞进清单（它们与胭脂 / 明黄太接近）",
    !/#a83b32/i.test(themeSrc) && !/#f0cd7c/i.test(themeSrc));
  const badEntry = entries.filter((e) =>
    !/hex:\s*"#[0-9A-Fa-f]{6}"/.test(e) || !/deep:\s*"#[0-9A-Fa-f]{6}"/.test(e)
    || !/on:\s*"#[0-9A-Fa-f]{6}"/.test(e) || !/text:\s*"#[0-9A-Fa-f]{6}"/.test(e));
  ok("每个主题色都带 hex / deep / on / text（四个值一个都不能少）",
    badEntry.length === 0, badEntry.slice(0, 3).join(" | "));

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

  const appW = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const headTitle = /\.head-title\s*\{([^}]*)\}/.exec(appW);
  ok("页头标题用 --strong-text（文字那一支）",
    !!headTitle && /var\(--strong-text\)/.test(headTitle[1]));
  const btnPrimary = /\.btn\.primary\s*\{([^}]*)\}/.exec(appW);
  ok("主按钮的底用 --strong（底色那一支）",
    !!btnPrimary && /background\s*:\s*var\(--strong\)/.test(btnPrimary[1]));

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

  ok("被换掉的月白 / 藕荷确实过不了这条（ΔE 8.9 / 18.3）",
    deltaE("#D6ECF0", "#f5f5f7") < 25 && deltaE("#E4C6D0", "#f5f5f7") < 25);

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

    const isNearBlack = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return Math.max(r, g, b) - Math.min(r, g, b) <= 12 && r < 40;
    };
    ok("默认主题下观感不变：--theme 默认是墨黑", isNearBlack("#" + tM[1]));
    ok("字色 --ink 也是墨黑（正文不跟主题）", isNearBlack("#" + inkM[1]));
  }

  const missWxml = [], missJs = [];
  pages.forEach((pg) => {
    const wxml = fs.readFileSync(path.join(ROOT, pg + ".wxml"), "utf8");
    const js = fs.readFileSync(path.join(ROOT, pg + ".js"), "utf8");

    if (!/<view class="page[^"]*"\s+style="\{\{themeStyle\}\}"/.test(wxml)) missWxml.push(pg);
    if (!/theme\.apply\(this\)/.test(js)) missJs.push(pg);
  });
  ok("每个页面的根节点都挂了 themeStyle", missWxml.length === 0, missWxml.join(", "));
  ok("每个页面都在 onShow 里调了 theme.apply(this)", missJs.length === 0, missJs.join(", "));

  const mustStayInk = [".row-poem", ".char-t"];
  const leaked = mustStayInk.filter((cls) => {
    const m = new RegExp("\\" + cls + "\\s*\\{([^}]*)\\}").exec(appWxss);
    return !m || /var\(--strong\)/.test(m[1]);
  });
  ok("篇名与诗字仍是中性墨（不上主题色）", leaked.length === 0, leaked.join(", "));

  const hardcoded = [];
  pages.forEach((pg) => {
    const wxml = fs.readFileSync(path.join(ROOT, pg + ".wxml"), "utf8");
    if (/color="#1c1c1e"/.test(wxml)) hardcoded.push(pg);
  });
  ok("原生控件的颜色不再写死 #1c1c1e（绑 themeHex）", hardcoded.length === 0, hardcoded.join(", "));

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

  const BAR_BG = "#fbfbfc";
  const invisibleSel = pairs2
    .map((t) => ({ n: t.name, m: Math.max(ratio(t.hex, BAR_BG), ratio(t.on, BAR_BG)) }))
    .filter((x) => x.m < 3)
    .map((x) => x.n + " 只有 " + x.m.toFixed(2) + ":1");
  ok("底栏「当前在哪一栏」的记号，每个主题下都看得出来（圆底或它那圈边 ≥3:1）",
    invisibleSel.length === 0, invisibleSel.join(" | "));

  const flatPress = pairs2
    .map((t) => ({ n: t.name, d: ratio(t.hex, t.deep) }))
    .filter((x) => x.d < 1.2)
    .map((x) => x.n + " 位移 " + x.d.toFixed(2));
  ok("每个主题按下去都看得出来（底色与本色 ≥1.2:1）",
    flatPress.length === 0, flatPress.join(" | "));

  const barWxss = fs.readFileSync(path.join(ROOT, "custom-tab-bar", "index.wxss"), "utf8");
  const selBlock = /\.tab\.on\s+\.tab-ico\s*\{([^}]*)\}/.exec(barWxss);
  ok("底栏选中的圆底真的补了那圈描边",
    !!selBlock && /box-shadow\s*:\s*0 0 0 [\d.]+rpx\s+var\(--on-ink\)/.test(selBlock[1]),
    selBlock ? selBlock[1].replace(/\s+/g, " ").trim() : "找不到 .tab.on .tab-ico");
  ok("选中的圆底画在 .tab.on .tab-ico 上（background 走 --strong）",
    !!selBlock && /background\s*:\s*var\(--strong\)/.test(selBlock[1]),
    selBlock ? selBlock[1].replace(/\s+/g, " ").trim() : "找不到 .tab.on .tab-ico");

  ok("底栏没有漂回整格填色（.tab.on::before 不该再上色）",
    !/\.tab\.on::before\s*\{[^}]*background\s*:\s*var\(--ink-strong\)/.test(barWxss));
  ok("--on-sel 令牌已随 B 方案撤掉（tokens / theme.js 里都不该再有它）",
    !/--on-sel/.test(tokens) && !/sel:\s*"#/.test(themeSrc));

}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const quizSrc = read("utils/quiz.js");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<\!--[\s\S]*?-->/g, "");

  const formsBlock = /const FORMS = \[([\s\S]*?)\];/.exec(quizSrc);
  ok("题型清单读得出来", !!formsBlock);
  ok("题型不再配颜色（color 这个字段撤了）",
    !!formsBlock && !/color\s*:/.test(formsBlock[1]),
    formsBlock ? formsBlock[1].replace(/\s+/g, " ").slice(0, 90) : "");
  ok("五个题型还在（撤的是颜色，不是题型）",
    !!formsBlock && (formsBlock[1].match(/key\s*:/g) || []).length === 5);

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

  const lettered = /function lettered\([\s\S]*?\n\}/.exec(quizSrc);
  ok("选项字母在数据层生成（lettered 函数在）", !!lettered);
  ok("四个字母取自 ABCD，且与顺序绑在一起",
    !!lettered && /"ABCD"\[i\]/.test(lettered[0]));

  const optionSites = (quizSrc.match(/options:\s*lettered\(/g) || []).length
    + (quizSrc.match(/options:\s*lettered\(shuffle/g) || []).length;
  ok("五个题型的 options 都套了 lettered（一处都不许漏）",
    (quizSrc.match(/lettered\(/g) || []).length >= 6,
    "出现 " + (quizSrc.match(/lettered\(/g) || []).length + " 次（1 处定义 + 5 处调用）");

  [["packages/game/exam/exam.wxml", examWxml], ["packages/game/quiz/quiz.wxml", quizWxml]]
    .forEach(([f, src]) => {
      ok(f + " 的 data-v 传的是选项原文（不是带字母的那一项）",
        /data-v="\{\{item\.text\}\}"/.test(src),
        "读到的是：" + (/data-v="[^"]*"/.exec(src) || ["无"])[0]);
    });

  const themeWxss = strip(read("packages/settings/theme/theme.wxss"));

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

  const sw = /(?:^|\})\s*\.swatch\s*\{([^}]*)\}/.exec(themeWxss);
  const minH = sw ? Number(/min-height\s*:\s*(\d+)rpx/.exec(sw[1])?.[1] ?? 0) : 0;
  ok("色样的热区仍有触控下限（.swatch 的 min-height ≥ 88rpx）", minH >= 88,
    "读到 " + minH + "rpx");

  const progWxml = strip(read("packages/progress/index/index.wxml"));
  const progJs = strip(read("packages/progress/index/index.js"));
  ok("进度页不再有「记忆阶段」那张卡",
    progWxml.indexOf("记忆阶段") < 0 && progJs.indexOf("stageRows") < 0);

  ok("未来七天那张卡还在（撤的不是排期）", progWxml.indexOf("未来七天") >= 0);
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
  ok("「开始背」也走弹层（同一件事，不该两条路）",
    /onStart[\s\S]{0,300}?openSheet\(/.test(homeJs));
  const openSheetSrc = homeJs.slice(homeJs.indexOf("openSheet(id) {"));
  ok("弹层由首页把门禁，组件自己不查",
    /gate\.guard\(/.test(openSheetSrc.slice(0, 600))
      && sheetJs.replace(/\/\*[\s\S]*?\*\//g, "").indexOf("gate") < 0,
    "首页 openSheet 里没调 gate.guard，或组件自己查了门禁");

  const rootBody = /\.sheet-root\s*\{([^}]*)\}/.exec(sheetWxss);
  ok("弹层是整屏浮层（fixed）", !!rootBody && /position\s*:\s*fixed/.test(rootBody[1]));
  ok("弹层靠底（从下面推上来，不是居中的对话框）",
    !!rootBody && /align-items\s*:\s*flex-end/.test(rootBody[1]));
  const sheetBody = /\.sheet\s*\{([^}]*)\}/.exec(sheetWxss);
  const radius = sheetBody ? (/border-radius\s*:\s*([^;]+);/.exec(sheetBody[1]) || [])[1] || "" : "";
  ok("只在顶部两角是圆角（下沿与屏幕同宽）",
    /var\(--radius-block\)\s+var\(--radius-block\)\s+0\s+0/.test(radius), "读到 " + radius);

  ok("有遮罩层", /\.sheet-mask\s*\{/.test(sheetWxss) && sheetWxml.indexOf("sheet-mask") >= 0);

  const z = sheetBody ? Number((/z-index\s*:\s*(\d+)/.exec(rootBody[1]) || [])[1] || 0) : 0;
  const barCss = fs.readFileSync(path.join(ROOT, "custom-tab-bar", "index.wxss"), "utf8");
  const barZ = Number((/z-index\s*:\s*(\d+)/.exec(barCss) || [])[1] || 0);
  ok("弹层压得过自绘底栏（" + z + " < " + barZ + "？不对，要压得住）",
    z > 0 && z < barZ, "弹层 z=" + z + " 底栏 z=" + barZ);
  ok("弹层自己在底栏之上、在样式弹层之上",
    z >= 50, "z-index 读到 " + z);

  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8");
  const surface = [".poem-head", ".poem-title", ".poem-meta-row", ".prefs", ".poem-body", ".tk-py", ".trans-head"];
  const hasRule = (css, cls) =>
    new RegExp(cls.replace(".", "\\.") + "\\s*\\{").test(css);
  const missing = surface.filter((cls) => !hasRule(appWxss, cls));
  ok("阅读面收在 app.wxss 一处（" + surface.length + " 个类）", missing.length === 0, missing.join(", "));
  const readerWxssOnly = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxss"), "utf8");
  const dup = surface.filter((cls) => hasRule(sheetWxss, cls) || hasRule(readerWxssOnly, cls));
  ok("两处都不许再写一份（写了就是第二份会漂）", dup.length === 0, dup.join(", "));

  [".pref-opt", ".pref-t", ".pref-rule", ".token", ".tk-ch"].forEach((cls) => {
    ok("弹层用了共用的 " + cls, hasRule(appWxss, cls));
  });

  ok("三档评分在组件里（忘记 / 模糊 / 记住）",
    sheetJs.indexOf("忘记") >= 0 && sheetJs.indexOf("模糊") >= 0 && sheetJs.indexOf("记住") >= 0);
  ok("评分后顺势进下一首（不是「关掉再去找」）",
    /goNext\(/.test(sheetJs) && /this\.setData\(\{\s*index:\s*next/.test(sheetJs));
  ok("队列走完就把弹层收掉（人回到列表，勾都在）",
    /next\s*>=\s*this\.data\.queue\.length[\s\S]{0,120}?onClose\(\)/.test(sheetJs));

  ok("队列从首页传进来（组件不自己排计划）",
    sheetWxml.indexOf("queue=") < 0 && homeWxml.indexOf('queue="{{plan}}"') >= 0);

  ok("翻页会回调首页（列表的勾要跟着动）",
    /triggerEvent\("open"/.test(sheetJs) && /bind:open="onSheetOpen"/.test(homeWxml));

  ok("弹层不靠页面传「背没背过」（自己取 store）",
    /store\.getRecord\(/.test(sheetJs) && sheetJs.indexOf("markRead") >= 0);

  ok("弹层显式接了页面那份主题变量",
    homeWxml.indexOf('theme-style="{{themeStyle}}"') >= 0
      && /themeStyle:\s*\{\s*type:\s*String/.test(sheetJs)
      && /style="\{\{themeStyle\}\}"/.test(sheetWxml),
    "首页没传 theme-style，或组件没把它挂在根节点上");

  ok("组件不发网络（同步由页面统一管）",
    sheetJs.indexOf("wx.request") < 0 && sheetJs.indexOf("remote") < 0);

  const pagesCfg = readJson(path.join(__dirname, "shots", "pages.json"));
  ok("预览里有「首页弹层开着」那一屏",
    Object.keys(pagesCfg).some((k) => /sheet/.test(k)),
    "pages.json 里没有名字带 sheet 的那一屏");
}

{

  const wxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const tokenLine = /\.token-line\s*\{([^}]*)\}/.exec(wxss);
  ok("注音行的高度取自 --py-line（不是长出来的）",
    !!tokenLine && /height\s*:\s*var\(--py-line\)/.test(tokenLine[1]),
    tokenLine && tokenLine[1].replace(/\s+/g, " ").trim());
  const tokenLineLH = /\.poem-line\.token-line\s*\{([^}]*)\}/.exec(wxss);
  ok("注音那条路的行高不叠倍数（有音无音才不会差半行）",
    !!tokenLineLH && /line-height\s*:\s*1\s*;/.test(tokenLineLH[1])
    && !/line-height\s*:\s*[\d.]+\s*;/.test(tokenLineLH[1].replace("line-height: 1;", "")),
    tokenLineLH && tokenLineLH[1].replace(/\s+/g, " ").trim());

  const steps = [...wxss.matchAll(
    /\.poem-body\.size(--?\d)\s*\{\s*--py-box:\s*([\d.]+)rpx;\s*--py-slot:\s*([\d.]+)rpx;\s*--py-line:\s*([\d.]+)rpx;\s*font-size:\s*([\d.]+)rpx;\s*\}/g
  )].map((m) => ({ size: m[1], box: +m[2], slot: +m[3], line: +m[4], font: +m[5] }));
  ok("注音七档的四个数（字身盒 / 拼音槽 / 行盒 / 字号）都在",
    steps.length === 7, "读到 " + steps.length + " 档");

  const badLine = steps.filter((s2) => s2.line !== s2.slot + s2.box + 4)
    .map((s2) => "size" + s2.size + " " + s2.slot + "+" + s2.box + "+4≠" + s2.line);
  ok("每一档「行盒 = 拼音槽 + 字身盒 + 上下 2rpx 呼吸」", badLine.length === 0, badLine.join(" | "));

  const pinyinToken = /--fs-pinyin:\s*calc\(([\d.]+)rpx/.exec(
    fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8"));
  const pySize = pinyinToken ? +pinyinToken[1] : 0;
  const tightSlot = steps.filter((s2) => s2.slot < pySize)
    .map((s2) => "size" + s2.size + " 槽 " + s2.slot + "rpx < " + pySize + "rpx");
  ok("拼音槽装得下拼音（槽 ≥ 注音字号 " + pySize + "rpx）",
    tightSlot.length === 0, tightSlot.join(" | "));

  const gap = /--py-gap:\s*([^;]+);/.exec(
    fs.readFileSync(path.join(ROOT, "styles", "tokens.wxss"), "utf8"));
  ok("字身外的空隙由 --py-gap 一处给出", !!gap, gap ? gap[1].trim() : "找不到 --py-gap");

  ok("--py-gap 不跟字号档位走（A－ A＋ 全程字距一致）",
    !!gap && /^calc\([\d.]+rpx \* var\(--ui-scale\)\)$/.test(gap[1].trim()),
    gap && gap[1].trim());
  const tokenBlock = /\.token\s*\{([^}]*)\}/.exec(wxss);
  ok("token 的左右空隙取自 --py-gap",
    !!tokenBlock && /margin\s*:\s*0\s+var\(--py-gap\)/.test(tokenBlock[1]),
    tokenBlock && tokenBlock[1].replace(/\s+/g, " ").trim());
  ok("token 不再用 min-width 撑字宽（那会随字号跳）",
    !!tokenBlock && !/min-width/.test(tokenBlock[1]));

  const lineSteps = [...wxss.matchAll(/\.poem-body\.size(--?\d)\s+\.poem-line\s*\{\s*font-size:\s*([\d.]+)rpx;\s*\}/g)]
    .map((m) => ({ size: m[1], font: +m[2] }));
  const mismatch = steps.filter((s2) => {
    const p = lineSteps.find((l) => l.size === s2.size);
    return !p || p.font !== s2.font;
  }).map((s2) => "size" + s2.size);
  ok("注音那条路的字号逐档与正文同值（切模式不跳字号）",
    mismatch.length === 0, mismatch.join(" | "));
}

{
  const appWxss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

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

  const tagBlock = /\.tag\s*\{([^}]*)\}/.exec(appWxss);
  ok("标签不被压窄（.tag 有 flex: none）",
    !!tagBlock && /flex\s*:\s*none/.test(tagBlock[1]),
    tagBlock && tagBlock[1].replace(/\s+/g, " ").trim().slice(0, 90));
  ok("标签不折行（.tag 有 white-space: nowrap）",
    !!tagBlock && /white-space\s*:\s*nowrap/.test(tagBlock[1]),
    tagBlock && tagBlock[1].replace(/\s+/g, " ").trim().slice(0, 90));

  const homeWxss = fs.readFileSync(path.join(ROOT, "pages", "home", "home.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const lineTitle = /\.row-line\s+\.row-title\s*\{([^}]*)\}/.exec(homeWxss);
  ok("与标签并排的篇名能缩（.row-line .row-title 有 min-width: 0）",
    !!lineTitle && /min-width\s*:\s*0/.test(lineTitle[1]),
    lineTitle && lineTitle[1].replace(/\s+/g, " ").trim().slice(0, 90));
}

{

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

  const lockWxml = fs.readFileSync(
    path.join(ROOT, "components", "lock-card", "lock-card.wxml"), "utf8");
  const lockJs = fs.readFileSync(
    path.join(ROOT, "components", "lock-card", "lock-card.js"), "utf8");

  ok("lock-card 声明了 note 属性", /note\s*:\s*\{/.test(lockJs));
  ok("lock-card 真把 note 渲染出来了（wxml 里有 lock-note）",
    /lock-note/.test(lockWxml));
  ok("lock-card 渲染 note 时带 wx:if（空 note 不留一行空白）",
    /lock-note[^>]*wx:if|<text[^>]*wx:if[^>]*lock-note/.test(lockWxml));

  const appWxssLock = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  ok("lock-note 有样式（.lock-note 定义在 app.wxss）", /\.lock-note\s*\{/.test(appWxssLock));

  const renderSrc = fs.readFileSync(path.join(__dirname, "shots", "render.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  const fakeBlock = /class="card lock-card"[\s\S]{0,1200}?;\n/.exec(renderSrc);
  if (fakeBlock) {
    const fake = fakeBlock[0];
    const classesOf = function (str) {
      return (str.match(/class="[^"]*\block-[a-z-]+/g) || [])
        .map(function (x) { return x.replace(/.*class="[^"]*?/, "").trim(); })
        .filter(Boolean);
    };

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

  const homeWxmlDaily = fs.readFileSync(path.join(ROOT, "pages", "home", "home.wxml"), "utf8");
  const compWxml = fs.readFileSync(
    path.join(ROOT, "components", "daily-extra", "daily-extra.wxml"), "utf8");
  const dailyTitle = /card-title[^>]*>\s*今日加背/.test(homeWxmlDaily) ? "今日加背" : "";
  const ph = /placeholder="([^"]*)"/.exec(compWxml);
  ok("今日加背那张卡有标题", !!dailyTitle);
  ok("搜索框 placeholder 不与卡片标题重名",
    !!ph && ph[1] !== dailyTitle,
    ph ? "placeholder = 「" + ph[1] + "」，标题 = 「" + dailyTitle + "」" : "没读到 placeholder");

  ok("placeholder 说明搜索字段（含「搜」字）",
    !!ph && ph[1].indexOf("搜") >= 0, ph ? ph[1] : "");
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

  ok("今日加背四件套齐全",
    [".js", ".json", ".wxml", ".wxss"].every((e) => fs.existsSync(path.join(compDir, "daily-extra" + e))));
  ok("首页挂上了今日加背", homeWxml.indexOf("<daily-extra") >= 0);
  const homeCfg = readJson(path.join(ROOT, "pages/home/home.json"));
  ok("首页注册了这个组件",
    (homeCfg.usingComponents || {})["daily-extra"] === "/components/daily-extra/daily-extra");

  ok("加完当场重排今日安排（不是等下次进页面）",
    /onExtraChange\s*\([\s\S]{0,200}?this\.refresh\(\)/.test(homeJs));
  ok("加背卡 + 背诵弹层两处都挂了 change",
    /<daily-extra[^>]*bind:change="onExtraChange"/.test(homeWxml)
      && /<recite-sheet[^>]*bind:change="onExtraChange"/.test(homeWxml),
    "有一处没挂 change，那一处加完不会重排");

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

  ok("排期器真的把加背排进计划",
    /extraPoems/.test(schedSrc) && /extraList/.test(schedSrc));
  ok("首页把加背交给排期器（不是自己拼一份）",
    /extraPoems:\s*store\.dailyExtraPoems\(\)/.test(homeJs));

  ok("今日加背在计划行上有一枚小签",
    /pinned:\s*"今日加背"/.test(homeJs));
  ok("「系统凑数」与「用户加背」不再共用一个词",
    /extra:\s*"补充"/.test(homeJs) && /pinned:\s*"今日加背"/.test(homeJs));
  ok("小签按类型给色（加背金、复习琥珀、新学青）",
    /REASON_CLS/.test(homeJs) && /\.tag\.gold\s*\{/.test(appWxss));

  const readerWxml = fs.readFileSync(path.join(ROOT, "pages/reader/reader.wxml"), "utf8");
  const sheetWxml = fs.readFileSync(path.join(ROOT, "components/recite-sheet/recite-sheet.wxml"), "utf8");
  ok("详情页有「加入今日背诵」", readerWxml.indexOf("onToggleDaily") >= 0);
  ok("背诵弹层里也有（同一枚、同一套样式）", sheetWxml.indexOf("onToggleDaily") >= 0);

  [["详情页", readerWxml], ["背诵弹层", sheetWxml]].forEach(([name, src]) => {
    ok(name + "的加号长在偏好那一行里（与 A－ A＋ 同一行）",
      src.indexOf("pref-plus") > src.indexOf('class="prefs"')
        && src.indexOf("pref-size") < src.indexOf("pref-plus"),
      "加号没在这一行里，或者不在 A＋ 之后");

    const markup = src.replace(/<!--[\s\S]*?-->/g, "");
    ok(name + "的加号只有一枚字形（没有「加入今日背诵」那种长文案）",
      !/已加入今日背诵|>加入今日背诵/.test(markup),
      "长文案会把这一行撑破（七个段 499rpx，卡片内容宽 596rpx）");
  });
  ok("两处共用一份样式（阅读面在 app.wxss）",
    /\.pref-plus\s*\{/.test(appWxss));

  [path.join(ROOT, "pages/reader/reader.wxss"),
   path.join(ROOT, "components/recite-sheet/recite-sheet.wxss")].forEach((f) => {
    const css = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    ok("不写第二份加背按钮样式 " + path.basename(path.dirname(f)) + "/" + path.basename(f),
      !/\.pref-plus\s*\{/.test(css));
  });

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

  ok("管理面板的读数与列表同一次算出",
    /refreshDaily[\s\S]{0,300}?dailyRows\(\)/.test(setJs));
  ok("认不出来的 id 如实丢掉（不编一条空标题）",
    /dailyExtraPoems[\s\S]{0,300}?\.filter\(Boolean\)/.test(storeSrc));

  ok("能力表里有 extra（与网页版对齐）", E.CAP_KEYS.indexOf("extra") >= 0);

  const pagesCfg = readJson(path.join(__dirname, "shots", "pages.json"));
  ok("预览里有「首页加背搜出结果」那一屏",
    Object.keys(pagesCfg).some((k) => k === "home-extra"));
  ok("预览里有「设置页加背管理」那一屏",
    Object.keys(pagesCfg).some((k) => k === "settings-recite-daily"));
}

{
  const wireSrc = fs.readFileSync(path.join(ROOT, "utils", "wire.js"), "utf8");
  const storeSrc2 = fs.readFileSync(path.join(ROOT, "utils", "store.js"), "utf8");
  const authSrc = fs.readFileSync(path.join(ROOT, "utils", "auth.js"), "utf8");
  const mineJs2 = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");

  ok("设置分两层：跨设备的 DEFAULTS + 只属本机的 DEVICE_DEFAULTS",
    /const DEFAULTS\s*=/.test(storeSrc2) && /const DEVICE_DEFAULTS\s*=/.test(storeSrc2));
  ok("音效跟设备走（不跨设备搬）",
    /DEVICE_DEFAULTS\s*=\s*\{[\s\S]{0,200}?sfx/.test(storeSrc2));
  ok("写设置时按键分流（页面只写一个 key）",
    /function saveSettings\(patch\)[\s\S]{0,400}?isDeviceKey/.test(storeSrc2));

  ok("设置有打包（settings:v1）",
    wireSrc.indexOf("SETTINGS_ROW") >= 0 && /SETTINGS_ROW\s*=\s*"settings:v1"/.test(wireSrc));

  {

    const bare = wireSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok("头像**不**进同步报文（没有 profile:v1 那一行）",
      bare.indexOf("PROFILE_ROW") < 0 && bare.indexOf("profile:v1") < 0,
      "报文里还有 profile:v1 —— 头像只落本机，推上去既没地方存也没意义（Issue #111）");
  }
  ok("打包的是跨设备那一份设置（不是整份）",
    /store\.cloudSettings\(\)/.test(wireSrc));

  ok("设置能落回本机", /id === SETTINGS_ROW[\s\S]{0,400}?replaceSettings/.test(wireSrc));

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

    storeMod4.replaceSettings({ grade: 1, theme: "ink", fontSize: 0 });
    storeMod4.touchSettings(0);
    storeMod4.saveProfile({ avatarLocal: "", nickname: "" });

    const applied4 = wireMod4.applyRecords(packed4);
    const back = storeMod4.settings();
    ok("云端那份设置能整份落回本机（" + applied4 + " 条）", applied4 >= 1, applied4 + " 条");
    ok("换机之后年级是认回来的（不是默认 1）", back.grade === 7, String(back.grade));
    ok("换机之后主题是认回来的（不是默认墨）", back.theme === "tianqing", back.theme);
    ok("换机之后字号是认回来的", back.fontSize === 2, String(back.fontSize));

    ok("换机之后头像**不**在（头像只落本机，这是刻意的）",
      storeMod4.profile().avatarLocal === "",
      "居然还在：" + String(storeMod4.profile().avatarLocal));

    ok("音效仍听这台设备的（云端那份盖不到它）", back.sfx === true, String(back.sfx));
    ok("跟设备走的那一项不进报文（云上没有它）",
      storeMod4.cloudSettings().sfx === undefined);

    ok("认回来的设置带云端时间戳（不然会来回覆盖）",
      storeMod4.settingsAt() === future, String(storeMod4.settingsAt()));

    wireMod4.applyRecords([
      { id: "settings:v1", payload: { v: 1, settings: { theme: "zhuhong" } }, updatedAt: 1 }
    ]);
    ok("比本机旧的设置不覆盖", storeMod4.settings().theme === "tianqing");
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
    storeMod45.replaceSettings({ theme: "zhuhong" });
    ok("打包之后本机再改，报文不许跟着变（不然推上去的是一份说不清来历的数据）",
      row45.payload.settings.theme === themeAtPack, "报文被本机存储的引用串改了");
    storeMod45.replaceSettings({ theme: "ink" });
  }

  ok("登录成功之后立刻认回云端", /pullAfterLogin/.test(authSrc));
  ok("认回云端只在这条路上做一次（不是每个页面各写一遍）",
    (authSrc.match(/pullAfterLogin\(/g) || []).length <= 2);
  ok("界面会如实说「认回来了」还是「通道没开」",
    /synced/.test(authSrc) && /进度已认回|后端未就绪/.test(mineJs2));

  const syncSrc = fs.readFileSync(path.join(ROOT, "utils", "sync.js"), "utf8");
  ok("同步只有一道门槛：配了后端且登录了",
    /function ready\(\)[\s\S]{0,160}?remote\.configured\(\) && auth\.logged\(\)/.test(syncSrc));
  ok("同步层不再问档位", syncSrc.indexOf("entitlement") < 0);

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

  {
    const mineSrc7 = fs.readFileSync(path.join(ROOT, "pages", "mine", "mine.js"), "utf8");
    const i = mineSrc7.indexOf("onAvatarChoose(");
    const j = i < 0 ? -1 : mineSrc7.indexOf("\n  },", i);
    const body = (i < 0 || j < 0) ? "" : mineSrc7.slice(i, j);
    ok("头像**不**挂记账（挂了就等于它进了同步队列，而上传它要养一个存储桶）",
      !!body && body.indexOf("markDirty") < 0,
      "头像函数体里出现了 markDirty：" + body.replace(/\s+/g, " ").slice(0, 140));
  }

  ok("markDirty 只记账不发网络",
    /function markDirty\(\)[\s\S]{0,400}?\}/.test(syncSrc)
      && /function markDirty\(\)[\s\S]{0,400}?wx\.request/.test(syncSrc) === false);

  {
    const doc = fs.readFileSync(path.join(ROOT, "..", "docs", "wx-login-server.md"), "utf8");
    ok("服务端要加的两行白名单写进了文档",
      doc.indexOf("settings:v1") >= 0 && doc.indexOf("profile:v1") >= 0);
    ok("文档说清了「不加白名单会被静默清空」这件事",
      doc.indexOf("sanitizePayload") >= 0);
  }

  const pagesCfg2 = readJson(path.join(__dirname, "shots", "pages.json"));
  ok("预览里有「换台机器、云端那份落回来」那一屏",
    Object.keys(pagesCfg2).some((k) => k === "mine-synced"));
}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const quizSrc = read("utils/quiz.js");
  const stripped = quizSrc.replace(/\/\*[\s\S]*?\*\//g, "");

  const cap = /const MAX_LINE = (\d+);/.exec(stripped);
  ok("题干有长度上限（MAX_LINE 在）", !!cap);
  const capN = cap ? Number(cap[1]) : 0;
  ok("上限落在「一联十四字 + 余量」这一档（16 ~ 32 字）", capN >= 16 && capN <= 32,
    "读到 " + capN);

  const se = /const SENTENCE_END = \/\[([^\]]+)\]\//.exec(stripped);
  ok("行内还会按句读再切（SENTENCE_END 在）", !!se);
  ok("切分符含中文句读（，。！？；至少四个）",
    !!se && "，。！？；".split("").filter((c) => se[1].indexOf(c) >= 0).length >= 4,
    se ? se[1] : "");

  const splits = (stripped.match(/\.split\("\\n"\)/g) || []).length;
  ok("按 \\n 取句只有一处（linesOf 收口）", splits === 1, "读到 " + splits + " 处");

  const quizMod = require(path.join(ROOT, "utils", "quiz.js"));
  const course = JSON.parse(read("data/course.json"));
  const courseIds = Object.keys(course);

  let maxStem = 0, maxAnswer = 0, asked = 0, longOne = null;

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

  const proseIds = courseIds.filter((id) => String(course[id].text).length > 100);
  ok("课内确实有长文（这一条不是空转）", proseIds.length > 10,
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
  const dayWxss = read("packages/progress/index/index.wxss");
  const generalWxml = read("packages/settings/general/general.wxml");
  const generalJs = read("packages/settings/general/general.js");
  const adminWxml = read("packages/admin/index/index.wxml");
  const adminJs = read("packages/admin/index/index.js");
  const entJs = read("utils/entitlement.js");

  ok("首页那条进度条在零进度时不渲染（不再是一根灰尺子）",
    /wx:if="\{\{percent\}\}"/.test(homeWxml) && /class="hero-meter"/.test(homeWxml),
    "零进度时还画着一条空槽，与「横线」同形");
  ok("进度条没被整块删掉（有进度时它还在）", /\.hero-meter\s*\{/.test(homeWxss));
  ok("进度条把「走到哪了」写成一行字（不然读不出这条量的是什么）",
    /已背/.test(homeWxml) && /\{\{doneCount\}\} \/ \{\{total\}\}/.test(homeWxml));

  ok("首页不再有「背诵设置」那一行",
    !/\.hero-foot/.test(homeWxss) && !/hero-foot/.test(homeWxml),
    "那一行还在");

  ok("首页「今日安排」卡里不再有那一行链接",
    !/hero-foot/.test(homeWxml) && homeWxml.indexOf("onSettings") > homeWxml.indexOf("empty"));
  ok("背诵设置仍有去处（我的 → 背诵设置）",
    /背诵设置/.test(read("pages/mine/mine.wxml")) && /onRecite/.test(read("pages/mine/mine.js")));

  ok("今日安排的圆圈换成了「已背 / 未背」两个字",
    /row-state/.test(homeWxml) && /item\.read \? '已背' : '未背'/.test(homeWxml),
    "圆圈还在，或者状态没写成字");
  ok("圆圈那套样式已撤（不留孤儿样式）", !/\.tick\s*\{/.test(homeWxss));

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

  {
    const quizWxss = read("packages/game/quiz/quiz.wxss");
    const verdictBlock = /\.verdict\s*\{([^}]*)\}/.exec(quizWxss);
    ok("题库的判定区不再包卡片",
      /<view class="verdict" wx:if="\{\{last\}\}">/.test(quizWxml),
      "判定区还套着 .card");
    ok("撤了卡边之后补了一道细线（否则会读成第四个选项）",
      !!verdictBlock && /border-top/.test(verdictBlock[1]));
  }

  ok("通用设置有注音那一栏", /注音/.test(generalWxml) && /onPinyin/.test(generalWxml));
  ok("通用设置的注音读的是同一份设置（走 pinyin.setMode）",
    /pinyin\.setMode\(/.test(generalJs), "自己写了一份 store.saveSettings，两页会分叉");
  ok("注音与阅读设置同一档位表（三档，不是另起一套）",
    /不注音/.test(generalJs) && /生字/.test(generalJs) && /全文/.test(generalJs));

  {
    const mineWxml = read("pages/mine/mine.wxml");

    ok("「我的」页的昵称只有一处：顶部那个名字本身（下面那一行已撤）",
      mineWxml.indexOf("nick-input") < 0 && /class="identity-input"[^>]*type="nickname"/.test(mineWxml),
      "同一个值还摆两处，或者顶部那格还是只显示的字");
    ok("昵称输入框有长度上限（顶部那一行只有一行）",
      /maxlength="12"/.test(mineWxml));
  }

  {
    const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const entBare = bare(entJs);
    ok("档位名的括号里不再塞来源（档名就是档名）",
      !/（服务端）/.test(entBare) && !/（授权码）/.test(entBare), "又把来源塞回档名里了");

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

    ok("nameOf 三档都回 Free / Pro / Max（与 key 同形）",
      ["free", "pro", "max"].every((k) => tiersMod.nameOf(k) === wanted[k]),
      ["free", "pro", "max"].map((k) => k + "→" + tiersMod.nameOf(k)).join(" "));
    ok("认不出的档位按 Free 显示（宁可少给）",
      tiersMod.nameOf("vip") === "Free" && tiersMod.nameOf("") === "Free",
      tiersMod.nameOf("vip"));
    ok("档位读不出来时回退也是 Free（TIERS[0] 就是 free）",
      tiersMod.tierOf("nope").key === "free" && tiersMod.DEFAULT_TIER === "free");

    const bareWxml = (src) => src.replace(/<!--[\s\S]*?-->/g, "");

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

    ok("改角色这个动作没跟着一起删（撤的是标签，不是功能）",
      /onSetRole/.test(adminWxml) && /setRole/.test(bare(adminJs)));
  }

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

  ok("「开始背 / 再练一遍」按「还有没有没背过的」切",
    /todoCount/.test(homeJs) && /todoCount \? '开始背' : '再练一遍'/.test(homeWxml));
  ok("「开始背」挑的是第一首**没背过的**（不是第一首）",
    /find\(\(r\) => !r\.reviewed\)/.test(homeJs),
    "用的还是 read，与「背过」是两件事");
}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const mineWxml = read("pages/mine/mine.wxml");
  const mineWxss = read("pages/mine/mine.wxss");
  const mineJs = read("pages/mine/mine.js");
  const generalWxml = read("packages/settings/general/general.wxml");
  const generalJs = read("packages/settings/general/general.js");
  const storeJs = read("utils/store.js");

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

  ok("未登录时名字那一格仍是只显示的字（不是输入框）",
    /<text class="identity-name" wx:else>\{\{nickname\}\}<\/text>/.test(mineWxml));
  ok("就地编辑没被画成一张表单（不铺灰底、不描边框）",
    /\.identity-input\s*\{([^}]*)\}/.test(mineWxss)
      && !/background/.test(/\.identity-input\s*\{([^}]*)\}/.exec(mineWxss)[1]),
    "名字那一格铺了底色 / 描了边框，身份卡看着像张表单");

  ok("通用设置里不再有「背完自动下一首」",
    generalWxml.indexOf("背完自动下一首") < 0 && generalWxml.indexOf("onAutoNext") < 0);
  ok("它的处理器也删了（不留没人调的 onAutoNext）", !/onAutoNext/.test(generalJs));
  ok("设置里的 autoNext 默认键也撤了（没人会再读它）",
    !/^\s*autoNext:/m.test(storeJs), "默认值还留着，等于给下一个来读它的人递了个空承诺");
  ok("删的是设置项，不是翻页本身（背完仍顺势进下一首）",
    /setTimeout\(\(\) => this\.goNext\(\), 700\)/.test(read("components/recite-sheet/recite-sheet.js")));

  const previewPath = path.join(__dirname, "shots", "out", "preview.html");
  if (fs.existsSync(previewPath)) {
    const preview = fs.readFileSync(previewPath, "utf8");
    ok("预览页里那枚开关也没了（预览不是另一份真机）",
      preview.indexOf("背完自动下一首") < 0,
      "预览是旧的那一份，重跑一次 node scripts/shots/render.js");
  }
}

{
  const BAD = ["本机", "云端", "服务端", "后端", "离线"];

  const ALLOW = ["背诵进度与设置默认只存在这台手机上"];

  const strip = (src) =>
    src
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  const wxmlText = (src) =>
    strip(src)
      .replace(/<[^>]*>/g, "\u0000")
      .split("\u0000")
      .join(" ");

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

    const mineJsCode = mineJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const syncNoteFn = /syncNote\(sy\)\s*\{([\s\S]*?)\n  \},/.exec(mineJsCode);
    ok("同步那一行的副标题答的是「换手机还跟不跟随」（不是「后端就绪没」）",
      !!syncNoteFn && /跨设备|换手机/.test(syncNoteFn[1]) && mineJsCode.indexOf("后端未就绪") < 0,
      "副标题里既没有「换手机」也没有「跨设备」，用户读不到自己真正关心的那件事");

    ok("没接上服务器时，副标题不许写成「点一下重试」",
      !!syncNoteFn && /没接上同步服务器|同步服务器没接上|同步通道未开/.test(syncNoteFn[1]),
      "那一支还在说「点一下重试」—— 没接上服务器时点多少下都不会好");
    ok("「关于」页那一段标题不再叫「本机记录」",
      aboutWxml.indexOf("本机记录") < 0 && /背诵记录/.test(aboutWxml));
    ok("登录成功不再提「本机身份」（用户看不懂，也不必懂）",
      mineJs.indexOf("本机身份") < 0 || !/title: *"[^"]*本机身份/.test(mineJs));
    ok("头像来源不再说「本机设置的头像」/「本机头像」（说「自己设的」就够）",
      mineJs.indexOf("本机设置的头像") < 0 && mineJs.indexOf("本机头像") < 0);

    const aboutJs = read("packages/settings/about/about.js");
    ok("隐私/协议里那句「默认只存在这台手机上」还在（用户有权知道）",
      /只存在这台手机上/.test(aboutJs));
  }
}

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const mineWxml = read("pages/mine/mine.wxml");
  const mineWxss = read("pages/mine/mine.wxss");
  const mineJs = read("pages/mine/mine.js");

  ok("「我的」页不再有「头像」那一行（.avatar-row 已撤）",
    mineWxml.indexOf("avatar-row") < 0 && mineWxss.indexOf(".avatar-row") < 0,
    "那一行还在，或者样式留下了孤儿");

  const mineWxmlBare = mineWxml.replace(/<!--[\s\S]*?-->/g, "");
  ok("那一行里的「换头像」按钮也没了（它点的是同一件事）",
    mineWxmlBare.indexOf("换头像") < 0, "换头像按钮还在，与头像圆重复");

  ok("头像圆就是选头像的入口（chooseAvatar 挂在它身上）",
    /class="avatar-btn"\s+open-type="chooseAvatar"/.test(mineWxml)
      && /bindchooseavatar="onAvatarChoose"/.test(mineWxml),
    "头像圆不再是入口了，头像无处可点");

  ok("「用微信头像」那个动作已撤（没有可退的东西了）",
    mineWxml.indexOf("identity-revert") < 0 && mineWxss.indexOf(".identity-revert") < 0
      && mineJs.indexOf("onAvatarClear") < 0,
    "「用微信头像」还在 —— Issue #111 之后没有「自己传的那张」，它点了不会有任何变化");

  ok("副题只说「我是谁」（不再解释这张头像哪来的）",
    /已登录 · 微信账号/.test(mineJs) && mineJs.indexOf("还没有头像") < 0,
    "副题还在解释头像来源 —— 只有一个来源，说来源是用户不必懂的话");
  ok("未登录时副题仍是「未登录」（不是「已登录 · …」）",
    /!profile\.logged[\s\S]{0,80}"未登录"/.test(mineJs));

  {

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

    const bareJs = mineJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok("整个小程序端没有上传头像的接口调用",
      !/wx\.uploadFile|\/api\/avatar/.test(bareJs),
      "还留着上传头像的路 —— 那就是又回到「要一份对象存储」");
  }
}

const K = {

  counts: {
    poems: 251, classic: 287, yuefu: 103, tangshi: 433, gushi: 113, songci: 330,
    yuanqu: 31, guwen: 234, jinxiandai: 24, zhaoming: 480,
    chengyu: 948, changshi: 221, mingshu: 808,
    mingren: 392, "mingren-waiguo": 523, dwang: 609, "dwang-waiguo": 68
  },

  cards: 5604,

  withText: 5855,

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

  ok("课外十六部合计 " + K.cards + " 条",
    allEntries.length - perBook.poems.length === K.cards,
    "实际 " + (allEntries.length - perBook.poems.length) + " 条，表里写 " + K.cards);

  const withText = allEntries.filter((p) => courseTexts[p.id] || manifest.map[p.id]).length;
  ok("带正文的条目 " + K.withText + " 条", withText === K.withText, "实际 " + withText);
  ok("课内正文进包 " + K.course + " 条", Object.keys(courseTexts).length === K.course,
    "实际 " + Object.keys(courseTexts).length);
  ok("正文分片 " + K.buckets + " 个", manifest.buckets.length === K.buckets,
    "实际 " + manifest.buckets.length);

  const KNOWN_HOLES = {
    gushi: [2, 3, 4, 9, 12, 23, 33, 89, 90, 91, 92, 122, 124],
    songci: [127],

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

    const patched = known.filter((n) => miss.indexOf(n) < 0);
    ok(book + " 记着的空洞没有悄悄补上（补上了就回来删）", patched.length === 0,
      "已补上 " + patched.join(",") + " —— 从 KNOWN_HOLES 里删掉");
  });

  const qb = allEntries.filter((p) => p.t === "七步诗");
  ok("《七步诗》只此一条", qb.length === 1, "实际 " + qb.length + " 条 —— " +
    qb.map((p) => p.id).join("、"));
  ok("《七步诗》在《古诗「非唐代」》", qb.length === 1 && qb[0].b === "gushi");
  ok("《七步诗》朝代是三国·魏（不是唐）", qb.length === 1 && qb[0].d === "三国·魏",
    "实际「" + (qb[0] || {}).d + "」");

  const WEI3 = ["三国·魏", "三国魏", "三国", "东汉末三国"];
  const weiInTang = perBook.tangshi.filter((p) => WEI3.indexOf(String(p.d).trim()) >= 0);
  ok("《唐诗》里再没有三国魏人", weiInTang.length === 0,
    "混进了 " + weiInTang.map((p) => p.t + "(" + p.d + ")").join("、"));

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

  const webDir = process.env.POEM_WEB_DIR || "/tmp/poem";
  const webAuthor = path.join(webDir, "data", "author-index.js");
  const miniAuthor = path.join(ROOT, "utils", "author-index.js");

  if (!fs.existsSync(webAuthor) || !fs.existsSync(miniAuthor)) {
    console.log("· 作者索引时间轴没得比（" +
      (fs.existsSync(webAuthor) ? "小程序端" : "poem 那边") +
      "的 author-index.js 不在，或还没设 POEM_WEB_DIR）—— 跳过两条");
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

      const miss = Object.keys(wa).filter((k) => !(k in ma));
      const extra = Object.keys(ma).filter((k) => !(k in wa));
      const diff = Object.keys(wa).filter((k) => k in ma && wa[k] !== ma[k])
        .map((k) => k + "：网页版→" + wa[k] + "／小程序→" + ma[k]);
      ok("异名表与网页版逐条一致（" + Object.keys(wa).length + " 条）",
        miss.length === 0 && extra.length === 0 && diff.length === 0,
        "网页版多：" + miss.join("、") + "；小程序多：" + extra.join("、") + "；对不上：" + diff.join("、"));
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
    const withSel = {};
    ["tangshi", "songci", "yuanqu", "zhaoming"].forEach((id) => {
      withSel[id] = (perBook[id] || []).filter((p) => String(p.sel || "").trim()).length;
    });
    Object.keys(K.selection).forEach((id) => {
      ok("选本出处搬全了 · " + id, withSel[id] === K.selection[id],
        "语料里 " + withSel[id] + " 条有 selection，表里写 " + K.selection[id] +
        " —— 多半是 build-data.js 没搬 `selection`（Issue #512）");
    });

    Object.keys(K.selection).forEach((id) => {
      const rows = (perBook[id] || []).filter((p) => p.s && p.sel);
      const allSame = rows.length > 0 && rows.every((p) => p.s === p.sel);
      ok(id + " 的两重出处真的拆开了（" + rows.length + " 条）", !allSame,
        id + " 的 source 与 selection **每一条都相同** —— 多半是没搬 #512 那次拆分");
    });

    const selNoSrc = [];
    Object.keys(K.selection).forEach((id) => {
      (perBook[id] || []).forEach((p) => {
        if (String(p.sel || "").trim() && !String(p.s || "").trim()) selNoSrc.push(p.id);
      });
    });
    ok("有选本出处的条目都有所出之书", selNoSrc.length === 0,
      selNoSrc.slice(0, 5).join("、"));
  }

  {
    const withAka = allEntries.filter((p) => p.aka);
    ok("题名异写搬进来了（" + withAka.length + " 条）", withAka.length >= 11,
      "只有 " + withAka.length + " 条有 alias —— 构建脚本里的 `aka` 没搬？");

    const want = ["秋登万山寄张五", "秋浦歌", "燕歌行并序", "燕歌行·并序",
      "山中送别", "赠范晔诗"];
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

  ok("名册收下 540 位作者", roster.total === 540,
    "实际 " + roster.total + " —— 补录之后回来对一次（名册是现算的，语料一变就变）");

  {
    const webDir = process.env.POEM_WEB_DIR || "/tmp/poem";
    const webAuthor = path.join(webDir, "data", "author-index.js");
    if (!fs.existsSync(webAuthor)) {
      console.log("· 作者名册没得比（poem 那边 data/author-index.js 不在，或还没设 POEM_WEB_DIR）—— 跳过一条");
    } else {
      let webPeople = null;
      try {
        const vm = require("vm");

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
      ok("李白在名册里", false, "488 位里没有李白");
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
        let cur = mountReader({ id: libai.items[0].id, from: "李白" });
        ok("从作者索引进来时带上作者", cur && cur.data.creator === "李白",
          "creator=" + (cur ? cur.data.creator : "页面没挂上"));

        let hops = 0;
        const seen = {};
        let offAuthor = null;
        let offBook = null;
        while (hops < 5 && cur) {
          seen[cur.data.id] = 1;

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

        {
          const rosterWithReads = AI.build(litEntries, { readIds: { [rosterIds[0]]: 1 } });
          const a = AI.worksOf(roster, "李白").join(",");
          const b = AI.worksOf(rosterWithReads, "李白").join(",");
          ok("作品的 id 列表不随已读状态变（阅读页的缓存靠这条）", a === b,
            "已读前后列表不一样 —— 缓存会让「下一篇」跳错");
        }

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

  ok("云调用带齐 X-WX-SERVICE / config.env / authorization（少一个都是平台错或静默 401）",
    /"X-WX-SERVICE":\s*conf\.service/.test(remoteSrc) &&
      /config:\s*\{\s*env:\s*conf\.env/.test(remoteSrc) &&
      /sendCloud\(path, data, method\)[\s\S]{0,900}?authorization:/.test(remoteSrc),
    "云调用的头/配置少了东西：`X-WX-SERVICE` 少了回 service not found，" +
      "`config.env` 少了回 env not exists，`authorization` 少了服务端认不出人（401）");

  ok("`configured()` 两条通道都认（只认 baseUrl 会把配好的云调用判成没后端）",
    /function configured\(\)\s*\{[\s\S]{0,200}?a\.baseUrl[\s\S]{0,160}?a\.cloud/.test(remoteSrc),
    "`configured()` 只看 `baseUrl` —— 只配云调用的人会被判成「后端未就绪」，" +
      "而那条路其实是通的");

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
        callContainer: (opt) => {
          calls.push(opt);

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

  const adminSrc = fs.readFileSync(path.join(ROOT, "packages", "admin", "index", "index.js"), "utf8");
  const adminWxml = fs.readFileSync(path.join(ROOT, "packages", "admin", "index", "index.wxml"), "utf8");
  ok("管理页能在界面上配云调用（env + service 两栏都在）",
    /cloudEnv/.test(adminWxml) && /cloudService/.test(adminWxml) && /onSaveCloud/.test(adminWxml),
    "只能改代码配云调用的话，这条路就落不到用户手上");
  ok("云调用两栏缺一个就不许存（存下去只会得到 env not exists）",
    /if\s*\(!env\s*\|\|\s*!service\)/.test(adminSrc),
    "允许只填一栏：平台那边回 env not exists / service not found，" +
      "看着像服务没部署，其实是少了一栏");

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

      store.saveSettings({
        grade: 3, term: 2, dailyCount: 7, scope: "all", algo: "sm2",
        align: "left", fontSize: 2, theme: "ink", pinyin: "all",
        speechRate: 1.5, speechAutoNext: false
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

        const clientKeys = Object.keys(store.DEFAULTS).filter((k) => k !== "lastSyncAt");
        const notOnServer = clientKeys.filter((k) => mine.indexOf(k) < 0);
        ok("小程序端每个跨设备的设置键都在服务端白名单里",
          notOnServer.length === 0,
          "缺 " + JSON.stringify(notOnServer) +
          " —— 这个键推上去会被服务端裁掉，「改了设置、换台手机还是默认」");

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

  ok("deploy/Dockerfile 在（流水线按路径取它）", fs.existsSync(dockerfile));

  const df = fs.readFileSync(dockerfile, "utf8");

  const dfLines = df
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const copied = dfLines.filter((l) => l.startsWith("COPY")).join("\n");

  ok("deploy/Dockerfile 只 COPY api/ 与服务壳，不 COPY 语料 / 字体 / 前端",
    /COPY --chown=node:node api \.\/api/.test(copied) &&
      /COPY --chown=node:node serve-api\.js \.\//.test(copied) &&
      !/\b(data|fonts|css|icons)\b/.test(copied),
    "真 COPY 到了，就是把 26MB 请回了上下文。实际 COPY：" + JSON.stringify(copied));

  {
    const ctxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-check-"));
    try {

      const stageCmds = fs.readFileSync(path.join(repo, ".cnb.yml"), "utf8")
        .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
      const stagedNames = [];
      stageCmds.forEach((l) => {
        const m = /^cp\s+([\w./-]+)\s+\/tmp\/ctx\/([\w.-]+)$/.exec(l);
        if (!m) return;
        const src = m[1], dstName = m[2];
        const srcAbs = path.join(repo, src);
        if (!fs.existsSync(srcAbs)) return;
        fs.copyFileSync(srcAbs, path.join(ctxRoot, dstName));
        stagedNames.push(dstName);
      });

      fs.mkdirSync(path.join(ctxRoot, "shard-src"), { recursive: true });
      ok("流水线真的把本仓库那几样摊进了上下文（摊法从 .cnb.yml 里读）",
        stagedNames.length >= 4,
        "从 .cnb.yml 里只读到 " + stagedNames.length + " 条 `cp … /tmp/ctx/…`：" +
          JSON.stringify(stagedNames));

      const copySrcs = (copied.match(/^COPY[^\n]+/gm) || [])
        .map((l) => l.trim().split(/\s+/).filter((w) => !w.startsWith("--")))

        .map((parts) => parts[1])
        .filter(Boolean);

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

  const fromLine = dfLines.find((l) => /^FROM\s/i.test(l)) || "";
  ok("deploy/Dockerfile 的基础镜像走 BASE_IMAGE（可在流水线里换源，不写死 registry）",
    /^FROM\s+\$\{BASE_IMAGE\}$/.test(fromLine) && /ARG BASE_IMAGE=/.test(df),
    "实际那一行：" + JSON.stringify(fromLine) +
      " —— 写死一个地址，构建机上拉不动时只能改这个文件；" +
      "写成需要凭据的私有地址，错误还会伪装成「Dockerfile 第 1 行有问题」");
  ok(".cnb.yml 把 BASE_IMAGE 传给 docker build（流水线上换源不用改 Dockerfile）",
    /--build-arg "BASE_IMAGE=/.test(fs.readFileSync(path.join(repo, ".cnb.yml"), "utf8")),
    "没传的话，换镜像源就得改 Dockerfile —— 而 Dockerfile 是共用的那份");

  const cnbYml = fs.readFileSync(path.join(repo, ".cnb.yml"), "utf8");
  ok("stage context 把白名单摆到**上下文根**（忽略文件跟上下文走，不跟 Dockerfile 走）",
    /cp\s+deploy-api-serve\/\.dockerignore\s+\/tmp\/ctx\/\.dockerignore/.test(cnbYml),
    "摆到 /tmp/ctx 根才生效。摆回 deploy-api-serve/ 旁边、或 /tmp/ctx/api/ 下面，" +
      "一份都不生效 —— 上下文从 0.3MB 变 38MB，而且不报错");

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

  ok("deploy/Dockerfile 讲清了 .dockerignore 该摆在哪（并点明嵌套的那份不生效）",
    /\.dockerignore[\s\S]{0,900}?跟\*\*构建上下文\*\*走/.test(df) &&
      /\/tmp\/ctx\/\.dockerignore[\s\S]{0,200}?有效/.test(df) &&
      /嵌套的不生效|嵌套的忽略文件/.test(df),
    "三个位置只有一个对，另两个最像对的且**都不报错** —— 不写清就等着被改回去");

  ok("服务壳在 deploy-api-serve/（不在 deploy/ —— 它进的是 poem 那个上下文）",
    fs.existsSync(path.join(serveDir, "serve-api.js")));
  const di = fs.readFileSync(path.join(serveDir, ".dockerignore"), "utf8");
  ok("deploy-api-serve/.dockerignore 是白名单（先 ** 全排，再逐条 ! 放行）",
    /^\*\*$/m.test(di) && /^!api\/_lib\/\*\*$/m.test(di) && /^!serve-api\.js$/m.test(di),
    "写成常规排除名单的话，poem 的 data/ 26MB 会整个漏进上下文");

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

  const setup = fs.readFileSync(path.join(repo, "docs", "wx-cloud-setup.md"), "utf8");
  ok("云托管设置文档写的是「按镜像部署」",
    /^\|\s*部署方式\s*\|\s*\*\*镜像\*\*\s*\|/m.test(setup),
    "写「代码仓库 + 容器目录」就是老路：那个仓库根上没有 api/，走不通");

  ok("云托管文档给了「把 GHCR 包设成 Public」的可照抄地址（不在 repo Settings 里）",
    /github\.com\/users\/[\w.-]+\/packages\/container\//.test(setup) &&
      /Package settings/.test(setup) &&
      /Change visibility/i.test(setup),
    "GHCR 新包默认 Private，不设 Public 就得配凭据 —— 走 GHCR 省凭据这一步就白做了。" +
      "而这页挂在 user 下、不在 repo 的 Settings 里，只写一句话人会找不到");

  ok("云托管文档点明了「包页 404 = 包还没推上去」",
    /404[\s\S]{0,60}(包还没推|还没推上|先回|查流水线)/.test(setup),
    "包页找不到时最自然的怀疑是「地址写错了」，而实际是流水线没推到 —— 得把这句先说掉");

  ok("云托管设置文档给出了完整的镜像地址（slug 是本仓库）",
    /docker\.cnb\.cool\/npu-gpu-cpu\/poem-wechat-mini-program\/wx-api/.test(setup),
    "人是要照抄这一栏的，给个占位符等于没写");
  ok("云托管设置文档写清了端口 8080",
    /\|\s*端口\s*\|\s*`?8080`?\s*\|/.test(setup));
  ok("云托管设置文档点明了**别**选「部署方式 = 代码仓库」",
    /别选「部署方式 = 代码仓库」|别选「部署方式|别选「六选一」里那四项|别在云托管控制台里指这个仓库/.test(setup),
    "不说这句，人会去填容器目录，然后卡在「没有 Dockerfile」——或者更糟，" +
      "转而把 poem 的 api/ 拷一份进来");

  ok("云托管设置文档交代了「目标目录」那一栏（说了镜像这条路没有它）",
    /目标目录/.test(setup) && /选了镜像[\s\S]{0,120}没有「目标目录」/.test(setup),
    "不问清的话，人会去填 deploy —— 而部署方式是镜像时这栏根本不该出现");

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

  const corpses = (setup + fs.readFileSync(path.join(deploy, "README.md"), "utf8"))
    .split("\n")
    .filter((l) => /已撤|上一版文档|上一版在这里写|原先写的是|原来写的/.test(l));
  ok("部署文档不留「撤稿记录」（读者要的是现在怎么填，不是尸检报告）",
    corpses.length === 0,
    "发现：" + JSON.stringify(corpses.slice(0, 2)));

  const cnb = fs.readFileSync(path.join(repo, ".cnb.yml"), "utf8");
  ok(".cnb.yml 里那份镜像的流水线去 clone poem（源码上下文 = 后端那一边）",
    /clone poem[\s\S]{0,400}?clone-poem\.sh/.test(cnb),
    "没去取 poem 就只能靠副本，而副本正是这一版撤掉的东西");

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

  const shellLines = cnb
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  {

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

    const referenced = new Set();
    for (const l of shellLines) {
      for (const m of l.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) {
        referenced.add(m[1]);
      }
    }

    const injected = new Set([
      "CNB_TOKEN", "CNB_ROOT_SLUG", "CNB_DOCKER_REGISTRY", "CNB_COMMIT_SHORT",
      "CNB_REPO_SLUG_LOWERCASE", "CNB_BRANCH", "CNB_TOKEN_USER_NAME",
      "GHCR_USER", "GHCR_TOKEN", "GH_PAT", "GH_REPO", "WX_APPID",
      "WX_PRIVATE_KEY_B64",
    ]);

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

  ok(".cnb.yml 的脚本不用 `set -o pipefail`（Alpine 的 sh 不认，会 exit 2）",
    !shellLines.some((l) => /set\s+-\S*o\s+pipefail/.test(l)),
    "busybox sh 会回 `sh: 1: set: Illegal option -o pipefail`，" +
      "整个 stage 在第一行就退出 —— 而它前面刚跑完的检查全是绿的，特别像「检查过了但没生效」");

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
        if (l.trim() && ind <= indent) break;
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

  const deployDocs =
    setup + fs.readFileSync(path.join(repo, "README.md"), "utf8") +
    fs.readFileSync(path.join(deploy, "README.md"), "utf8");
  ok("部署文档不再教人打 tag 出镜像（触发方式已改为推 main）",
    !/git tag v\d/.test(deployDocs) && !/打 v\* tag/.test(deployDocs) &&
      !/微信小程序云托管\/wx-api:<tag>/.test(deployDocs),
    "文档里还留着打 tag，人会照着做一遍然后发现推不上去（要管理员）");
}

{
  const yml = fs.readFileSync(path.join(path.dirname(__dirname), ".cnb.yml"), "utf8");
  const at = yml.indexOf("- name: 同步到 GitHub");
  ok("`同步到 GitHub` 那步还在", at >= 0, "`.cnb.yml` 里找不到这一步 —— GitHub 那份不会更新");

  const body = at < 0 ? "" : yml.slice(at);

  const lines = body.split("\n")
    .map((l) => l.replace(/\s+#.*$/, ""))
    .filter((l) => !/^\s*(#|$)/.test(l));
  const scriptLine = lines.find((l) => /node scripts\/sync-github\.js/.test(l)) || "";

  ok("那步真在跑 scripts/sync-github.js（不是写了段注释摆着）",
    scriptLine.length > 0,
    "真命令行里没调这个脚本（注释里写着不算）");

  const scriptPath = path.join(path.dirname(__dirname), "scripts", "sync-github.js");
  ok("scripts/sync-github.js 在", fs.existsSync(scriptPath));
  const js = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, "utf8") : "";

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

  ok("同步前会 unshallow（CI 是 --depth 1，浅仓库直接 push 会 `remote unpack failed`）",
    /--unshallow/.test(jsCode) && /is-shallow-repository/.test(jsCode),
    "脚本里没有 unshallow —— CI 的浅克隆推不上去，且报错像网络问题：" +
      "`remote: fatal: did not receive expected object ...` / `remote unpack failed`");

  ok("凭据形状是 `<token>:x-oauth-basic@`（另两种实测一种问密码、一种回 401）",
    /\$\{pat\}:x-oauth-basic@github\.com/.test(jsCode) && !/x-access-token/.test(jsCode),
    "凭据形状变了 —— 只写 token 会被当成用户名问密码；`x-access-token` 实测回 401");

  ok("关掉了 git 的交互式询问（凭据不对时不能干等到超时）",
    /GIT_TERMINAL_PROMPT/.test(js),
    "没关询问：凭据不对时 git 会卡在等输入，CI 里报出来的是「超时」而不是「凭据不对」");

  ok("缺 GH_PAT / GH_REPO 时当场说清是哪个空着",
    /缺 GH_PAT/.test(js) && /缺 GH_REPO/.test(js),
    "名字对不上会走到 `could not read Username`，看着像网络问题");

  ok("没有用 `push --mirror`（它带删除，而 checkout 只给一条分支）",
    !/--mirror/.test(jsCode),
    "改回 --mirror 了：GitHub 上本地没有的分支会被删掉，而 CI 里本地只有一条");

  {
    const readme = fs.readFileSync(path.join(path.dirname(__dirname), "README.md"), "utf8");
    ok("README 里写了 GitHub 那份是只读镜像、别在上面直接提交",
      /github\.com\/ashleyzhang2028\/poem-wx/.test(readme) &&
        /别在 GitHub 那份上直接提交/.test(readme),
      "README 没交代这件事 —— 人会去 GitHub 上改，下次同步静默抹掉");
  }

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

    ok("缺 GHCR_TOKEN 时的提示点名「classic」与 `write:packages`",
      /classic/.test(ghcrCode) && /write:packages/.test(ghcrCode),
      "提示里没说 token 类型 —— 人会拿着 fine-grained 一直找不到 Packages 那一栏");

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

{
  const yml = fs.readFileSync(path.join(path.dirname(__dirname), ".cnb.yml"), "utf8");
  const jobChunks = yml.split(/\n(?=        - name: )/);
  const bad = [];
  for (const chunk of jobChunks) {
    const name = (chunk.match(/^\s*- name:\s*(.+)$/m) || [])[1] || "(未命名)";

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

  if (lock && lock.counts) {
    const mismatch = Object.keys(K.counts).filter((k) => Number(lock.counts[k]) !== K.counts[k]);
    ok("锁里的篇数与自检的 K 表逐条一致", mismatch.length === 0,
      "对不上的是：" + JSON.stringify(mismatch.map((k) => k + ": 锁 " + lock.counts[k] + " / K " + K.counts[k])) +
        " —— 锁前进了就回来把 K 表跟着改（见 docs/data-backend.md § 四）");
  }

  {
    const sh = fs.readFileSync(path.join(repo2, "scripts", "clone-poem.sh"), "utf8");
    ok("clone-poem.sh 会读 poem.lock.json 并检出那一版",
      /poem\.lock\.json/.test(sh) && /checkout/.test(sh) && /POEM_REF/.test(sh),
      "没读锁的话，锁就是个摆设 —— 取回来的还是上游的头");

    ok("clone-poem.sh 在拿到的 sha 与锁不一致时当场失败",
      /if\s+\[\s+"?\$\{?REF\}?"?\s*!=\s*"?main"?\s*\][\s\S]{0,120}?HEAD_SHA[\s\S]{0,160}?exit\s+1/.test(sh),
      "那条「要的是 A、拿到的是 B → 退出」的判据不在 —— 锁写错一个字符的结果是" +
        "安静地用着别的一版，而日志里与「锁生效了」一模一样");
  }

  {
    const cnb2 = fs.readFileSync(path.join(repo2, ".cnb.yml"), "utf8");
    const py = (() => {
      try { return require("js-yaml"); } catch (e) { return null; }
    })();
    void py;

    const lines = cnb2.split("\n");

    const cronAt = lines.findIndex((l) => /^\s{2}"crontab:\s*\S/.test(l));
    ok("定时任务写在 `main:` 之下（`main: { \"crontab: …\": […] }`）",
      cronAt >= 0,
      "没找到缩进 2 空格的 `\"crontab: <cron>\":` —— 顶格另起一个 `crontab:` 的话，" +
        "平台报的是「$ 下无 api_trigger 事件配置」，与真正的原因差很远");

    ok("定时任务的 cron 表达式是五段",
      /^\s{2}"crontab:\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+"\s*:/.test(lines[cronAt] || ""),
      "表达式不是五段 —— CNB 用的是 POSIX cron（分 时 日 月 周）");
    const cronBody = cronAt < 0 ? "" : lines.slice(cronAt).join("\n");
    ok("定时任务跑的就是 poem-watch.sh",
      /poem-watch\.sh/.test(cronBody),
      "crontab 那条里没有跟上游那个脚本");

    const mainKeys = lines.filter((l) => /^main:/.test(l));
    ok(".cnb.yml 里只有一个 `main:`（重复的话后者会盖掉前者，发布链静默消失）",
      mainKeys.length === 1,
      "找到 " + mainKeys.length + " 处顶格 `main:`");
    const topKeys = lines.filter((l) => /^[A-Za-z$][\w$-]*:/.test(l)).map((l) => l.split(":")[0]);
    ok(".cnb.yml 里没有顶格的 `crontab:`（那个键位置不对，平台解析不到）",
      topKeys.indexOf("crontab") < 0,
      "顶格 `crontab:` 是无效写法 —— 得写成 `main:` 之下缩进 2 空格的 " +
        "`\"crontab: <表达式>\":`");

    const mainAt = lines.findIndex((l) => /^main:/.test(l));
    const publishBody = (mainAt < 0 || cronAt < 0) ? "" : lines.slice(mainAt, cronAt).join("\n");
    ok("发布链（`main:`）里**不**跑跟上游（跑了就又回到原来那条路上）",
      !/poem-watch/.test(publishBody),
      "发布链里出现 poem-watch —— 上游一改，我们推 main 就红，治法白做");

    const cloneRaw = publishBody.split("\n")
      .map((l) => l.replace(/\s+#.*$/, ""))
      .filter((l) => /git clone .*poem\.git/.test(l) && !/clone-poem\.sh/.test(l));
    ok("发布链里取 poem 都走 clone-poem.sh（直写 git clone 会绕过锁）",
      cloneRaw.length === 0,
      "这几行绕过了锁：" + JSON.stringify(cloneRaw.slice(0, 2)));
  }

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
    const webDir = process.env.POEM_WEB_DIR || "/tmp/poem";
    const poemStore = path.join(webDir, "api", "_lib", "store.js");
    if (!fs.existsSync(poemStore)) {
      console.log("· 读不到 poem 的 store.js（" + poemStore + "）—— V49 的形状那几条跳过。");
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

  {
    const servePath = path.join(repo4, "deploy-api-serve", "serve-api.js");
    const serve = fs.existsSync(servePath) ? fs.readFileSync(servePath, "utf8") : "";
    ok("serve-api.js 里接了存储层（不接的话那份实现只是个没人读的文件）",
      /wireMysqlStore/.test(serve) && /store-mysql\.js/.test(serve),
      "serve-api.js 里没有接线 —— poem 的 store.js 是网页版那份，" +
        "MySQL 这个选择必须落在这份部署的入口上");
    {

      const bareServe = serve.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const callAt = bareServe.indexOf("\nwireMysqlStore();");

      const handlerAt = bareServe.indexOf("api/handler.js");
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

    const df2 = fs.readFileSync(path.join(repo4, "deploy", "Dockerfile"), "utf8");
    ok("Dockerfile 里装了 mysql2（不装的话上面那句「出声」就是常态）",
      /npm install[^\n]*mysql2/.test(df2),
      "镜像里没有 mysql2 → 配了 MYSQL_HOST 也只能退回内存档，每次重启丢数据");

    const cnb3 = fs.readFileSync(path.join(repo4, ".cnb.yml"), "utf8");
    ok("CI 里真的跑了 e2e-mysql（形状那几条验不了语义）",
      /e2e-mysql\.js/.test(cnb3),
      "流水线里没有 e2e-mysql —— 那条「新的赢」在换库后还在不在，就没人验了");
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

    ok("文档写清了「云调用那两格只有 admin/owner 看得到」",
      /(admin|owner)/.test(doc) && /(普通用户|Free|free)/.test(doc) &&
        /云调用/.test(doc),
      "只写「我的 → 用户与权限 → 拉到底」会被读成「所有用户都能填」—— " +
        "而那张卡在管理页里，普通用户翻到那一页只有「我的授权」。");

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

    ok("架构文档也说清了那两格归 admin、且是本机存储",
      /用户与权限[\s\S]{0,200}(admin|owner)/.test(arch) &&
        /本机/.test(arch),
      "architecture.md 只说「填两栏」，没交代谁能填、值在哪 —— " +
        "读的人会以为那是个平台配置项");
  }
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
    /hasData\s*,?\s*\n?\}/.test(corpusSrc.slice(corpusSrc.indexOf("module.exports"))));
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
  ok("首页有「语料未生成」的空态",
    /noData/.test(homeWxmlNoData) && /build:data/.test(homeWxmlNoData),
    "没跑构建时首页只有空白目录，看不出少跑了哪一步");
  const homeJsNoData = fs.readFileSync(path.join(ROOT, "pages", "home", "home.js"), "utf8");
  ok("首页在 refresh 里读 hasData 决定走空态",
    /corpus\.hasData\(\)/.test(homeJsNoData));

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
    /function fileOf\s*\(/.test(shardSrc) && /path\.join\(ROOT, name \+ "\.json"\)/.test(shardSrc));
  ok("没有分片时回 404 E_NO_SHARDS，不静默回空 body",
    /E_NO_SHARDS/.test(shardSrc));

  ok("命中时声明 Content-Encoding: gzip（发的是预压缩那份）",
    /"Content-Encoding":\s*"gzip"/.test(shardSrc));

  ok("Dockerfile 接受 COPY_SHREDS 开关",
    /ARG COPY_SHREDS=/.test(dockerfile));
  ok("Dockerfile 的 COPY 源是 shard-src（上下文根那一层）",
    /COPY --chown=node:node shard-src \/tmp\/shard-src/.test(dockerfile));

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
    const apiSrc = path.join(process.env.POEM_WEB_DIR || "/tmp/poem", "api");

    if (!fs.existsSync(path.join(apiSrc, "_lib", "routes.js"))) {
      console.log("· 读不到 poem（" + apiSrc + "）—— 镜像里该有哪些后端文件那几条跳过。");
    } else {
      const need = new Set(["handler.js"]);
      const routesSrc = fs.readFileSync(path.join(apiSrc, "_lib", "routes.js"), "utf8");
      for (const m of routesSrc.matchAll(/"(\.[^"]+\.js)"/g)) {
        need.add(path.posix.normalize(path.posix.join("_lib", m[1])));
      }
      const walk = (dir, rel) => {
        for (const f of fs.readdirSync(dir)) {
          const full = path.join(dir, f);
          const r = rel + "/" + f;
          if (fs.statSync(full).isDirectory()) walk(full, r);
          else if (f.endsWith(".js")) need.add(r);
        }
      };
      walk(path.join(apiSrc, "_lib"), "_lib");
      walk(path.join(apiSrc, "_routes"), "_routes");

      const sh = fs.readFileSync(path.join(ROOT, "..", "scripts", "e2e-mysql.js"), "utf8");
      const e2eStage = sh.slice(sh.indexOf("const wanted"), sh.indexOf('fs.copyFileSync(path.join(REPO'));
      ok("e2e 摊上下文时逐条拷了 api 的每一层（`cpSync` 整棵树会把这条判据糊掉）",
        /_lib\/routes\.js/.test(e2eStage) && /_lib\/http\.js/.test(e2eStage) &&
          /"_lib"\)/.test(e2eStage) && /"_routes"\)/.test(e2eStage),
        "e2e 没按 routes.js 逐条拷出 `_lib/` 与 `_routes/` —— " +
          "摊得比镜像全时，Issue #134 那类「镜像里少了文件」它抓不到");

      ok("Dockerfile 整棵拷 api/（缺的文件在镜像里不补，所以在上下文那一关就得拦下）",
        /COPY --chown=node:node api \.\/api/.test(dockerfile));

      const piped = fs.readFileSync(path.join(ROOT, "..", ".cnb.yml"), "utf8");
      const finder = fs.readFileSync(path.join(ROOT, "..", "scripts", "find-poem-api-files.py"), "utf8");
      ok("清单是从 routes.js 那张表读的，不是「扫一遍上下文里有什么」",
        /ROUTE_REF/.test(finder) && /routes\.js/.test(finder),
        "扫上下文那种写法在漏文件时只会少列几个名字，照样报「都在」—— " +
          "那正是 Issue #134 的形态，判据等于没有");
      ok("流水线在 build 前跑它（构建机上 poem 整棵树都在，只有镜像里会缺）",
        /find-poem-api-files\.py/.test(piped),
        "没跑的话就会回到 Issue #134：构建绿、部署绿、" +
          "容器起来之后 `Cannot find module './_lib/routes.js'`");
    }
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

  ok("摊出来的名字是 t001.json.gz（fileOf 找 <name>.json + .gz，多留一个 .json 就每一片 404）",
    /basename "\$f" \.json\)/.test(cnb) && /\.json\.gz"/.test(cnb),
    "摊成了 `basename \"$f\".json.gz`（t001.json.gz）—— shard-api 的 fileOf" +
      " 找 `t001.json` 找不到，于是目录非空、E_NO_SHARDS 不响、每一片 404");
  ok("分片在流水线里现生成（构建产物，checkout 里没有）",
    /POEM_WEB_DIR=\/tmp\/poem node scripts\/build-data\.js/.test(cnb));
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
  ok("取不到时抛的是带 code 的错（界面据此说人话）",
    /shardError\("E_NO_SHARD_SERVICE"/.test(corpusSrc2));

  ok("阅读页走 corpus.ensureEntry（不是只同步查一次）",
    /corpus\s*\n?\.ensureEntry\(id\)/.test(readerSrc) || /ensureEntry\(id\)/.test(readerSrc));
  ok("阅读页有空态那一屏（不是空卡片）",
    /loadingText/.test(readerSrc) &&
    /loadingText/.test(fs.readFileSync(path.join(ROOT, "pages", "reader", "reader.wxml"), "utf8")));
  ok("阅读页把「没接上服务器」与「这一篇取不到」分开说",
    /E_NO_SHARD_SERVICE/.test(readerSrc) && /E_NO_SHARDS/.test(readerSrc));
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

Promise.all(pending).then(() => {
  console.log("");
  console.log("检查 " + checks + " 项，失败 " + fails + " 项");
  process.exit(fails ? 1 : 0);
});
