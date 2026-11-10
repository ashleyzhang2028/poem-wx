const store = require("./store");
const entitlement = require("./entitlement");
const pageStack = require("./page-stack");
const appearance = require("./appearance");

const SAMPLE = "烟花三月下扬州";

const DEFAULT = "zhuque";

const BASE = appearance.FONT_BASE;

const SUBSETS = ["woff2", "woff"];

function files(base, size) {
  return SUBSETS.map((ext) => base + size + "." + ext);
}

const PREVIEW = "7";

let rows = [];

function dress(f) {
  return {
    key: f.key,
    name: f.name,
    note: f.note,
    dir: f.dir,
    family: "Kuibu Poem " + f.key,
    previewFamily: "Kuibu Preview " + f.key,
    preview: files(f.base, PREVIEW),
    free: files(f.base, "free"),
    pro: files(f.base, "pro"),
    max: files(f.base, "max")
  };
}

function faces() {
  return appearance.fonts(rows).map(dress);
}

function sync(saved) {
  rows = Array.isArray(saved) ? saved : [];
  settled = "";
  return rows;
}

function faceByKey() {
  const map = {};
  faces().forEach((f) => { map[f.key] = f; });
  return map;
}

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
  if (!faceByKey()[key]) return DEFAULT;
  if (!pickable() && key !== DEFAULT) return DEFAULT;
  return key;
}

function face(key) {
  const map = faceByKey();
  return map[key || current()] || map[DEFAULT] || dress(appearance.SEED_FONTS[0]);
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
  return faces().map((f) => ({ key: f.key, name: f.name }));
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
  return faces().filter((f) => wanted(f.key))
    .map((f) => register(f.previewFamily, f.preview).then((ok) => (ok ? f.key : "")));
}

function preview() {
  const list = previewing();
  if (!list.length) return Promise.resolve(false);
  return Promise.all(list).then((keys) => keys.filter(Boolean).length > 0);
}

function previewed(key) {
  return !!faceByKey()[key] && wanted(key);
}

function previewOf(key) {
  const f = faceByKey()[key];
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
  const f = faceByKey()[key];
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
  DEFAULT, BASE, SAMPLE, PREVIEW, SUBSETS, STACK,
  faces, sync,
  readiness, options,
  paid, pickable, tier, current, face, familyOf, stack, groupOf, shelf,
  addresses, configured, load, preview, previewed, previewOf, set, refresh,
  globalOn, uiStack, setGlobal, scope, registerHere, restore, bind
};
