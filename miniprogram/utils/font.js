const store = require("./store");
const entitlement = require("./entitlement");
const pageStack = require("./page-stack");

const FONTS = [
  { key: "zhuque", name: "朱雀仿宋", note: "仿宋 · 清瘦利落", dir: "zhuquefangsong-regular" },
  { key: "oldsong", name: "京华老宋", note: "老宋 · 旧籍纸墨", dir: "kinghwa_oldsong_v3" },
  { key: "jinshu", name: "寒蝉锦书宋", note: "宋体 · 锦纹细密", dir: "chilljinshusongpro_regular" },
  { key: "zhenhei", name: "思源真黑", note: "黑体 · 笔画匀净", dir: "siyuan-zhenhei" },
  { key: "huiwen", name: "汇文明朝", note: "明朝 · 横细竖粗", dir: "huiwenmincho-improved" },
  { key: "hanamina", name: "花园明朝", note: "明朝 · 平实端正", dir: "hanamina" },
  { key: "chillkai", name: "寒蝉正楷", note: "正楷 · 端正写意", dir: "chillkai" },
  { key: "cooper", name: "汇迹正楷", note: "正楷 · 刚劲挺括", dir: "cooperzhengkai" },
  { key: "longcang", name: "寒蝉龙藏楷", note: "楷体 · 藏锋有力", dir: "chilllongcangkai_regular" },
  { key: "wenkai", name: "霞鹜文楷", note: "楷体 · 温润随和", dir: "lxgwwenkai-regular" },
  { key: "yozai", name: "悠哉", note: "圆体 · 闲散绵软", dir: "yozai-regular" },
  { key: "qiji", name: "黄令东齐伋", note: "宋体 · 古本筋骨", dir: "qiji" },
  { key: "zhushi", name: "杨任东竹石", note: "行书 · 竹石清劲", dir: "yangrendong-zhushiti" },
  { key: "qingyan", name: "乐米清砚方墨", note: "方墨 · 棱角分明", dir: "lemi-qingyanfangmo" },
  { key: "linhai", name: "临海隶书", note: "隶书 · 蚕头燕尾", dir: "linhai-lishu" }
];

const SAMPLE = "烟花三月下扬州";

const DEFAULT = "zhuque";

const BASE = "https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/fonts/";

const SUBSETS = ["woff2", "woff"];

function files(dir, size) {
  return SUBSETS.map((ext) => BASE + dir + "/" + size + "." + ext);
}

const PREVIEW = "7";

const FACES = FONTS.map((f) => ({
  key: f.key,
  name: f.name,
  note: f.note,
  dir: f.dir,
  family: "Kuibu Poem " + f.key,
  previewFamily: "Kuibu Preview " + f.key,
  preview: files(f.dir, PREVIEW),
  free: files(f.dir, "free"),
  pro: files(f.dir, "pro"),
  max: files(f.dir, "max")
}));

const BY_KEY = {};
FACES.forEach((f) => { BY_KEY[f.key] = f; });

const FREE_FACE = FACES[0];

function paid() {
  return entitlement.rankOf(entitlement.status().tier) >= entitlement.rankOf("pro");
}

function pickable() {
  return paid();
}

function tier() {
  return "pro";
}

function current() {
  const key = store.settings().font;
  if (!BY_KEY[key]) return DEFAULT;
  if (!pickable() && key !== DEFAULT) return DEFAULT;
  return key;
}

function face(key) {
  return BY_KEY[key || current()] || FREE_FACE;
}

const STACK = '"Songti SC", "STSong", "STZhongsong", "Source Han Serif SC", "Source Han Serif CN", '
  + '"Noto Serif CJK SC", "Noto Serif SC", "SimSun", "SimSun-ExtB", "FangSong", serif';

function stack(key) {
  return '"' + familyOf(key) + '", ' + STACK;
}

function groupOf(family) {
  return '"' + family + '", ' + STACK;
}

function shelf() {
  const tier0 = entitlement.status().tier;
  if (tier0 === "max") return "max";
  if (tier0 === "pro") return "pro";
  return "free";
}

function addresses(key) {
  return face(key || current())[shelf()].slice();
}

function configured(key) {
  const auth = store.read(store.KEYS.auth, {}) || {};
  if (auth.fontUrl === undefined) return addresses(key);
  const list = Array.isArray(auth.fontUrl) ? auth.fontUrl : [auth.fontUrl];
  return list.map((it) => String(it || "")).filter(Boolean);
}

function readiness() {
  if (!configured().length) {
    return { visible: false, usable: false, state: "unsupported", reason: "未配置诗词子集" };
  }
  return { visible: true, usable: true, state: "ready", reason: "" };
}

function options() {
  return FACES.map((f) => ({ key: f.key, name: f.name }));
}

let scopeEpoch = 0;

function scope() {
  return scopeEpoch;
}

function attempt(family, source) {
  return new Promise((resolve) => {
    wx.loadFontFace({
      global: true,
      scopes: globalOn() ? ["webview", "native"] : ["webview"],
      family,
      source,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

function sequence(family, list) {
  return list.reduce(
    (prev, source) => prev.then((done) => (done ? true : attempt(family, source))),
    Promise.resolve(false)
  );
}

const loaded = {};
const previewSeen = {};
const scoped = {};

function mark(family, list) {
  return family + " " + shelf() + " " + globalOn() + " " + list.join(" ");
}

function register(family, list) {
  const key = mark(family, list);
  if (loaded[key]) return loaded[key];
  loaded[key] = sequence(family, list).then((ok) => {
    if (!ok) delete loaded[key];
    return ok;
  });
  return loaded[key];
}

function scopeMark() {
  return scopeEpoch + "@" + pageStack.route();
}

function registerPage(family, list) {
  const key = mark(family, list);
  if (scoped[key] === scopeMark()) return Promise.resolve(true);
  if (scoped[key]) return Promise.resolve(true);
  return sequence(family, list).then((ok) => {
    if (ok) scoped[key] = scopeMark();
    else delete scoped[key];
    return ok;
  });
}

function load() {
  const f = face();
  const list = configured();

  if (!list.length || typeof wx.loadFontFace !== "function") return Promise.resolve(false);
  return register(f.family, list);
}

function wanted(key) {
  return key === current() || previewSeen[key] === true;
}

function previewing() {
  if (!previewsReady()) return [];
  return FACES.filter((f) => wanted(f.key))
    .map((f) => register(f.previewFamily, f.preview).then((ok) => (ok ? f.key : "")));
}

function preview() {
  const list = previewing();
  if (!list.length) return Promise.resolve(false);
  return Promise.all(list).then((keys) => keys.filter(Boolean).length > 0);
}

function previewed(key) {
  return !!BY_KEY[key] && wanted(key);
}

function previewOf(key) {
  const f = BY_KEY[key];
  if (!f || !previewsReady()) return Promise.resolve(false);
  previewSeen[key] = true;
  return register(f.previewFamily, f.preview);
}

function familyOf(key) {
  return face(key || current()).family;
}

function globalOn() {
  return paid() && store.settings().fontGlobal === true;
}

function uiStack(key) {
  if (!globalOn()) return "";
  return stack(key);
}

function setGlobal(on) {
  if (on && !paid()) return { ok: false, reason: "tier" };
  const next = !!on;
  if (next === globalOn()) return { ok: true, changed: false };
  store.saveSettings({ fontGlobal: next });
  try {
    require("./sync").markDirty();
  } catch (e) {

  }
  scopeEpoch += 1;
  announce();
  return { ok: true, changed: true };
}

function rooted() {
  return typeof getApp === "function" && !!getApp();
}

function registerHere() {
  if (!globalOn() || !previewsReady()) return Promise.resolve("");
  const f = face();
  const list = configured();
  return registerPage(f.family, list).then((ok) => (ok ? f.family : ""));
}

function publish(family) {
  if (!rooted() || !family) return family;
  const app = getApp();
  app.globalData = app.globalData || {};
  app.globalData.fontGroup = family + " " + scopeEpoch;
  return family;
}

function republish() {
  if (!rooted()) return;
  const app = getApp();
  app.globalData = app.globalData || {};
  app.globalData.fontScope = scopeEpoch;
}

let settled = "";

let repaintQueued = false;

function repaint() {
  if (!rooted() || repaintQueued) return;
  repaintQueued = true;
  Promise.resolve().then(() => {
    repaintQueued = false;
    if (!rooted()) return;
    const app = getApp();
    if (typeof app.repaintFont !== "function") return;
    app.repaintFont(scopeEpoch);
  });
}

function announce() {
  republish();
  repaint();
}

function restore() {
  const app = typeof getApp === "function" ? getApp() : null;
  const g = (app && app.globalData) || {};
  const stale = g.fontScope !== scopeEpoch;
  const top = pageStack.top();
  if (!stale && top && typeof top.applyFont === "function") top.applyFont();
  announce();
}

function previewsReady() {
  return configured().length > 0 && typeof wx.loadFontFace === "function";
}

function refresh() {
  load().then((ok) => {
    const key = mark(face().family, configured());
    if (!ok || settled === key) return;
    settled = key;
    announce();
  }).catch(() => {});
  preview().catch(() => {});
  announce();
}

function set(key) {
  const f = BY_KEY[key];
  if (!f) return { ok: false, reason: "unknown" };
  if (!pickable()) return { ok: false, reason: "tier" };
  if (key === current()) return { ok: true, changed: false };
  store.saveSettings({ font: key });
  scopeEpoch += 1;

  try {
    require("./sync").markDirty();
  } catch (e) {

  }
  refresh();
  return { ok: true, changed: true, font: key };
}

function bind(style) {
  return { page: { themeStyle: style } };
}

module.exports = {
  FONTS, FACES, DEFAULT, BASE, SAMPLE, PREVIEW, SUBSETS, STACK,
  readiness, options,
  paid, pickable, tier, current, face, familyOf, stack, groupOf, shelf,
  addresses, configured, load, preview, previewed, previewOf, set, refresh,
  globalOn, uiStack, setGlobal, scope, registerHere, restore, bind
};
