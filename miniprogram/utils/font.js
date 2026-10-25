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

const PREVIEW = "烟花三月下扬州";

const DEFAULT = "zhuque";

const BASE = "https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/fonts/";

const SUBSETS = ["woff2", "woff"];

function files(dir, size) {
  return SUBSETS.map((ext) => BASE + dir + "/" + dir + "-" + size + "." + ext);
}

const FACES = FONTS.map((f) => ({
  key: f.key,
  name: f.name,
  note: f.note,
  family: "Kuibu Poem " + f.key,
  previewFamily: "Kuibu Preview " + f.key,
  free: files(f.dir, "free"),
  pro: files(f.dir, "pro"),
  max: files(f.dir, "max"),
  preview: files(f.dir, "7")
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
  const first = face(key || current()).family;
  return [first].concat(FAMILIES.filter((f) => f !== first)).map((f) => '"' + f + '"').join(", ")
    + ", " + STACK;
}

function shelf() {
  const tier0 = entitlement.status().tier;
  if (tier0 === "max") return "max";
  if (tier0 === "pro") return "pro";
  return "free";
}

function addresses(key) {
  return face(key)[shelf()].slice();
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
  return FACES.map((f) => ({ key: f.key, name: f.name }));
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

const loaded = {};

function faceOf(source) {
  return FACES.filter((f) => f.free.concat(f.pro, f.max).indexOf(source) >= 0)[0] || null;
}

function load() {
  const f = face();
  const list = configured();

  if (!list.length || typeof wx.loadFontFace !== "function") return Promise.resolve(false);

  const key = f.key + " " + shelf() + " " + list.join(" ");
  if (loaded[key]) return loaded[key];

  loaded[key] = sequence(f, list).then((ok) => {
    if (!ok) delete loaded[key];
    return ok;
  });
  return loaded[key];
}

const previews = {};

function preview(key) {
  const f = BY_KEY[key];
  if (!f || !previewsReady()) return Promise.resolve(false);
  if (previews[f.key]) return previews[f.key];

  previews[f.key] = sequence({ family: f.previewFamily }, f.preview).then((ok) => {
    if (!ok) delete previews[f.key];
    return ok;
  });
  return previews[f.key];
}

function sourcesOf(f) {
  return configured().map((s) => {
    const from = faceOf(s);
    return from ? s.replace(from.family, f.family).replace(from.dir, f.dir) : s;
  });
}

function loadAll() {
  if (!previewsReady()) return;
  FACES.filter((f) => f.key !== face().key)
    .forEach((f) => { sequence(f, sourcesOf(f)).catch(() => {}); });
}

function previewsReady() {
  return configured().length > 0 && typeof wx.loadFontFace === "function";
}

function refresh() {
  load().catch(() => {});
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
  FONTS, FACES, DEFAULT, BASE, PREVIEW, readiness, options,
  paid, pickable, tier, current, face, stack, shelf,
  addresses, configured, load, loadAll, preview, set, refresh
};
