const store = require("./store");
const entitlement = require("./entitlement");

const FONTS = [
  { key: "zhuque", name: "朱雀仿宋", note: "仿宋 · 清瘦利落", stem: "zhuquefangsong-regular/zhuquefangsong-regular-" },
  { key: "huiwen", name: "汇文明朝", note: "明朝 · 横细竖粗", stem: "huiwenmincho-improved/huiwenmincho-improved-" },
  { key: "chillkai", name: "寒蝉正楷", note: "正楷 · 端正写意", stem: "chillkai/chillkai-" }
];

const DEFAULT = "zhuque";

const BASE = "https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/fonts/";

const FACES = FONTS.map((f) => ({
  key: f.key,
  name: f.name,
  note: f.note,
  family: "Kuibu Poem " + f.key,
  free: [BASE + f.stem + "free.woff2", BASE + f.stem + "free.woff"],
  pro: [BASE + f.stem + "pro.woff2", BASE + f.stem + "pro.woff"]
}));

const FAMILIES = FACES.map((f) => f.family);

const BY_KEY = {};
FACES.forEach((f) => { BY_KEY[f.key] = f; });

const FREE_FACE = FACES[0];

function paid() {
  return entitlement.rankOf(entitlement.status().tier) >= entitlement.rankOf("pro");
}

function pickable() {
  return paid();
}

function lockedName() {
  return entitlement.status().tier === "free" ? "Pro" : "Free";
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
  const first = face(key || current()).family;
  return [first].concat(FAMILIES.filter((f) => f !== first)).map((f) => '"' + f + '"').join(", ")
    + ", " + STACK;
}

function addresses(key) {
  const f = BY_KEY[key] || FREE_FACE;
  return pickable() ? f.pro.slice() : f.free.slice();
}

function configured() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  if (auth.fontUrl === undefined) return addresses(current());
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
  return FACES.map((f) => ({ key: f.key, name: f.name, note: f.note }));
}

function attempt(face0, source) {
  return new Promise((resolve) => {
    wx.loadFontFace({
      global: true,
      scopes: ["webview"],
      family: face0.family,
      source,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

function sequence(face0, list) {
  return list.reduce(
    (prev, source) => prev.then((done) => (done ? true : attempt(face0, source))),
    Promise.resolve(false)
  );
}

let loaded = {};

function familyOf(source) {
  const hit = FACES.filter((f) => f.pro.concat(f.free).indexOf(source) >= 0)[0];
  return hit ? hit.family : "";
}

function load() {
  const f = face();
  const list = configured();

  if (!list.length || typeof wx.loadFontFace !== "function") return Promise.resolve(false);

  const key = f.key + " " + list.join(" ");
  if (loaded[key]) return loaded[key];

  loaded[key] = sequence(f, list).then((ok) => {
    if (!ok) delete loaded[key];
    return ok;
  });
  return loaded[key];
}

function sourcesOf(f) {
  return configured().map((s) => (familyOf(s) ? s.replace(familyOf(s), f.family) : s));
}

function loadAll() {
  if (!configured().length || typeof wx.loadFontFace !== "function") return;
  FACES.filter((f) => f.key !== face().key)
    .forEach((f) => { sequence(f, sourcesOf(f)).catch(() => {}); });
}

function set(key) {
  const f = BY_KEY[key];
  if (!f) return { ok: false, reason: "unknown" };
  if (!pickable()) return { ok: false, reason: "tier" };
  if (key === current()) return { ok: true, changed: false };
  store.saveSettings({ font: key });

  try {
    require("./sync").markDirty();
  } catch (e) {

  }
  return { ok: true, changed: true, font: key };
}

module.exports = {
  FONTS, FACES, DEFAULT, BASE, readiness, options,
  paid, pickable, lockedName, current, face, stack,
  addresses, configured, load, loadAll, set
};
