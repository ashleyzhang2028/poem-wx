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

const BASE = "https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/fonts/";

const SUBSETS = ["woff2", "woff"];

function files(dir, size) {
  return SUBSETS.map((ext) => BASE + dir + "/" + size + "." + ext);
}

const PREVIEW_DIR = "lxgwwenkai-regular";

const PREVIEW_FAMILY = "Kuibu Preview";

const PREVIEW_FILES = files(PREVIEW_DIR, "7");

const FACES = FONTS.map((f) => ({
  key: f.key,
  name: f.name,
  note: f.note,
  dir: f.dir,
  family: "Kuibu Poem " + f.key,
  free: files(f.dir, "free"),
  pro: files(f.dir, "pro"),
  max: files(f.dir, "max"),
  glyphs: {}
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

function attempt(family, source) {
  return new Promise((resolve) => {
    wx.loadFontFace({
      global: true,
      scopes: ["webview"],
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

function register(f, list) {
  const key = f.key + " " + shelf() + " " + list.join(" ");
  if (loaded[key]) return loaded[key];
  loaded[key] = sequence(f.family, list).then((ok) => {
    if (!ok) delete loaded[key];
    return ok;
  });
  return loaded[key];
}

function load() {
  const f = face();
  const list = configured();

  if (!list.length || typeof wx.loadFontFace !== "function") return Promise.resolve(false);
  return register(f, list);
}

const previews = {};

function preview() {
  if (!previewsReady()) return Promise.resolve(false);
  if (previews.face) return previews.face;

  previews.face = sequence(PREVIEW_FAMILY, PREVIEW_FILES).then((ok) => {
    if (!ok) delete previews.face;
    return ok;
  });
  return previews.face;
}

function glyphs(f, list) {
  if (!f.glyphs[list.join(" ")]) f.glyphs[list.join(" ")] = sequence(f.family, list);
  return f.glyphs[list.join(" ")];
}

function paint(f, list) {
  const box = wx.createOffscreenCanvas ? wx.createOffscreenCanvas({ type: "2d", width: 64, height: 64 }) : null;
  const ctx = box && box.getContext ? box.getContext("2d") : null;
  if (!ctx) return true;
  ctx.font = '40px "' + f.family + '", monospace';
  return SAMPLE.split("").every((c) => ctx.measureText(c).width !== 0);
}

function ready(key) {
  const f = face(key);
  const list = configured(f.key);
  if (!list.length || typeof wx.loadFontFace !== "function") return Promise.resolve(false);
  if (!glyphsReady()) return load();
  return glyphs(f, list).then((ok) => (ok ? paint(f, list) : false)).then((ok) => {
    if (ok) return true;
    delete loaded[f.key + " " + shelf() + " " + list.join(" ")];
    return load();
  });
}

function glyphsReady() {
  return typeof wx.createOffscreenCanvas === "function";
}

function familyOf(key) {
  return face(key || current()).family;
}

function loadAll() {
  if (!previewsReady() || typeof wx.loadFontFace !== "function") return;
  const chosen = face().key;
  FACES.filter((f) => f.key !== chosen)
    .forEach((f) => { register(f, f[shelf()].slice()).catch(() => {}); });
}

function previewsReady() {
  return configured().length > 0 && typeof wx.loadFontFace === "function";
}

function refresh() {
  load().catch(() => {});
  preview().catch(() => {});
  loadAll();
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
  refresh();
  return { ok: true, changed: true, font: key };
}

module.exports = {
  FONTS, FACES, DEFAULT, BASE, SAMPLE, PREVIEW_FAMILY, PREVIEW_DIR, PREVIEW_FILES, SUBSETS,
  readiness, options,
  paid, pickable, tier, current, face, familyOf, stack, shelf,
  addresses, configured, load, loadAll, preview, ready, set, refresh
};
