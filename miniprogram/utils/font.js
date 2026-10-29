const store = require("./store");
const entitlement = require("./entitlement");

const FONTS = [
  { key: "zhuque", name: "朱雀仿宋", note: "仿宋 · 清瘦利落", dir: "zhuquefangsong-regular" },
  { key: "huiwen", name: "汇文明朝", note: "明朝 · 横细竖粗", dir: "huiwenmincho-improved" },
  { key: "chillkai", name: "寒蝉正楷", note: "正楷 · 端正写意", dir: "chillkai" },
  { key: "cooper", name: "汇迹正楷", note: "正楷 · 刚劲挺括", dir: "cooperzhengkai" },
  { key: "wenkai", name: "霞鹜文楷", note: "楷体 · 温润随和", dir: "lxgwwenkai-regular" },
  { key: "oldsong", name: "京华老宋", note: "老宋 · 旧籍纸墨", dir: "kinghwa_oldsong_v3" },
  { key: "jinshu", name: "寒蝉锦书宋", note: "宋体 · 锦纹细密", dir: "chilljinshusongpro_regular" },
  { key: "yozai", name: "悠哉", note: "圆体 · 闲散绵软", dir: "yozai-regular" },
  { key: "longcang", name: "寒蝉龙藏楷", note: "楷体 · 藏锋有力", dir: "chilllongcangkai_regular" }
];

const SAMPLE = "烟花三月下扬州";

const DEFAULT = "zhuque";

const UI_STACK = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", '
  + '"Microsoft YaHei", sans-serif';

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
  return BY_KEY[key] || FREE_FACE;
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

function globalOn() {
  return paid() && store.settings().fontGlobal === true;
}

function uiStack(key) {
  if (!globalOn()) return "";
  return stack(key);
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
let scoped = {};

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
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  const top = pages && pages[pages.length - 1];
  return scopeEpoch + "@" + (top ? String(top.route) : "");
}

function registerPage(family, list) {
  const key = mark(family, list);
  if (scoped[key] === scopeMark()) return Promise.resolve(true);
  return sequence(family, list).then((ok) => {
    if (ok) scoped[key] = scopeMark();
    else delete scoped[key];
    return ok;
  });
}

function registerHere() {
  if (!globalOn() || !previewsReady()) return Promise.resolve("");
  const f = face();
  return registerPage(f.family, configured()).then((ok) => (ok ? f.family : ""));
}

function rooted() {
  return typeof getApp === "function" && !!getApp();
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

function repaint() {
  if (!rooted()) return;
  const app = getApp();
  if (typeof app.repaintFont !== "function") return;
  app.repaintFont(scopeEpoch);
}

function announce() {
  republish();
  repaint();
}

function restore() {
  const app = typeof getApp === "function" ? getApp() : null;
  const g = (app && app.globalData) || {};
  const stale = g.fontScope !== scopeEpoch;
  const page = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  const top = page && page[page.length - 1];
  if (!stale && top && typeof top.applyFont === "function") top.applyFont();
  announce();
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
  scoped = {};
  announce();
  return { ok: true, changed: true };
}

function bind(style) {
  return { page: { themeStyle: style } };
}

function load() {
  const f = face();
  const list = configured();

  if (!list.length || typeof wx.loadFontFace !== "function") return Promise.resolve(false);
  return register(f.family, list);
}

function previewing() {
  if (!previewsReady()) return [];
  return FACES.map((f) => register(f.previewFamily, f.preview).then((ok) => (ok ? f.key : "")));
}

function preview() {
  const list = previewing();
  if (!list.length) return Promise.resolve(false);
  return Promise.all(list).then((keys) => keys.filter(Boolean).length > 0);
}

function familyOf(key) {
  return face(key || current()).family;
}

function loadAll() {
  if (!previewsReady() || typeof wx.loadFontFace !== "function") return;
  const chosen = face().key;
  FACES.filter((f) => f.key !== chosen)
    .forEach((f) => {
      register(f.family, f[shelf()].slice()).catch(() => {});
      register(f.previewFamily, f.preview).catch(() => {});
    });
}

function previewsReady() {
  return configured().length > 0 && typeof wx.loadFontFace === "function";
}

function refresh() {
  load().catch(() => {});
  preview().catch(() => {});
  loadAll();
  announce();
}

function set(key) {
  const f = BY_KEY[key];
  if (!f) return { ok: false, reason: "unknown" };
  if (!pickable()) return { ok: false, reason: "tier" };
  if (key === current()) return { ok: true, changed: false };
  store.saveSettings({ font: key });
  scopeEpoch += 1;
  scoped = {};

  try {
    require("./sync").markDirty();
  } catch (e) {

  }
  refresh();
  return { ok: true, changed: true, font: key };
}

module.exports = {
  FONTS, FACES, DEFAULT, BASE, SAMPLE, PREVIEW, SUBSETS, UI_STACK,
  readiness, options,
  paid, pickable, tier, current, face, familyOf, stack, groupOf, shelf,
  addresses, configured, load, loadAll, preview, set, refresh,
  globalOn, uiStack, setGlobal, scope, registerHere, restore, bind
};
