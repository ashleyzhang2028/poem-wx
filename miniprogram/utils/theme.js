const store = require("./store");
const font = require("./font");
const tiers = require("./tiers");
const entitlement = require("./entitlement");
const custom = require("./custom-banner");
const tone = require("./color-tone");
const picker = require("./color-picker");
const appearance = require("./appearance");

const CITY_BANNER = appearance.BANNER_BASE;

const TRADITION = appearance.GROUP.tradition;

const LANDSCAPE = appearance.GROUP.landscape;

const OWN = "own";

const OWN_KEY = "own";

const DEFAULT = "daiqing";

const BANNER = appearance.bannerUrl(appearance.DEFAULT_BANNER);

const WASH = 0.05;

const MARK = [56, 56, 58];

const MARK_MIN = 3;

const DEEP_STEP = 0.04;

const CACHE_KEY = "kb_appearance_v1";

const CACHE_MS = 6 * 3600 * 1000;

const ROWS = { theme: [], font: [] };

function cached() {
  let raw = null;
  try {
    raw = typeof wx !== "undefined" ? wx.getStorageSync(CACHE_KEY) : null;
  } catch (e) {
    raw = null;
  }
  if (!raw || typeof raw !== "object") return null;
  return { at: Number(raw.at) || 0, themes: raw.themes, fonts: raw.fonts };
}

function adopt(saved) {
  const box = saved || cached();
  return load(box);
}

function remember(hit) {
  try {
    wx.setStorageSync(CACHE_KEY, hit);
  } catch (e) {
    return;
  }
}

function pulled() {
  let remote = null;
  try {
    remote = require("./remote");
  } catch (e) {
    return Promise.resolve(ROWS);
  }
  if (!remote.configured()) return Promise.resolve(ROWS);
  return remote.request(remote.PATHS.appearance, {}, "GET").then((body) => {
    const hit = { at: Date.now(), themes: body && body.themes, fonts: body && body.fonts };
    const next = load(hit);
    if (next.theme.length) remember(hit);
    return next;
  }).catch(() => ROWS);
}

function rgba(rgb, alpha) {
  return "rgba(" + rgb[0] + ", " + rgb[1] + ", " + rgb[2] + ", " + alpha + ")";
}

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const AA = 4.5;

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relative(rgb) {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrast(a, b) {
  const x = relative(a), y = relative(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function inkOn(rgb) {
  const c = contrast(rgb, BLACK) <= contrast(rgb, WHITE) ? BLACK : WHITE;
  return contrast(rgb, c) >= AA ? c : (c === BLACK ? WHITE : BLACK);
}

function mix(a, b, p) {
  return [0, 1, 2].map((i) => Math.round(a[i] * (1 - p) + b[i] * p));
}

function deepOf(rgb) {
  const ink = inkOn(rgb);
  let p = 1;
  while (p > 0 && contrast(mix(rgb, ink, p), ink) < AA) p -= DEEP_STEP;
  return mix(rgb, ink, Math.max(p, 0));
}

function dress(row) {
  const t = Object.assign({}, row);
  t.banner = /^https?:\/\//.test(String(t.banner || "")) ? t.banner : appearance.bannerUrl(t.banner);
  t.rgba = rgba(t.rgb, 1);
  t.soft = rgba(t.rgb, WASH);
  t.on = rgba(WHITE, 1);
  t.depth = deepOf(t.rgb);
  t.mark = rgba(MARK, 1);
  return t;
}

function build(rows) {
  const byKey = {};
  rows.forEach((t) => { byKey[t.key] = dress(t); });
  byKey[OWN_THEME.key] = OWN_THEME;
  return byKey;
}

const OWN_THEME = {
  key: OWN_KEY,
  name: "自定义题图",
  rgb: [8, 8, 10],
  group: OWN
};

const VAR_OF = {};
appearance.SEED_THEMES.forEach((t) => {
  VAR_OF[t.key] = "--c-" + t.key;
});
VAR_OF[OWN_THEME.key] = "--c-" + OWN_THEME.key;

function palette() {
  return all().map((t) => ({
    key: t.key,
    name: t.name,
    group: t.group,
    rgb: t.rgba,
    soft: t.soft,
    on: t.on,
    mark: t.mark,
    depth: rgba(t.depth, 1),
    banner: t.banner,
    varName: VAR_OF[t.key]
  }));
}

const GROUPS = [
  { key: TRADITION, title: "中国传统", tier: "free" },
  { key: LANDSCAPE, title: "大好河山", tier: "pro", cap: "sights" },
  { key: OWN, title: "自定义题图", tier: "max", cap: "ownbanner" }
];

function groupOpen(group) {
  if (tiers.rank(group.tier) <= tiers.rank("free")) return true;
  return entitlement.can(group.cap);
}

function itemsOf(groupKey) {
  return groupKey === OWN ? [ownSwatch()] : palette().filter((s) => s.group === groupKey);
}

function groups() {
  return GROUPS.map((g) => {
    const open = groupOpen(g);
    return {
      key: g.key,
      title: g.title,
      tier: g.tier,
      locked: !open,
      items: itemsOf(g.key).map((s) => Object.assign({}, s, { locked: !open }))
    };
  });
}

function load(saved) {
  ROWS.theme = appearance.themes(saved && saved.themes);
  ROWS.font = appearance.fonts(saved && saved.fonts);
  font.sync(ROWS.font);
  return ROWS;
}

function sync(saved) {
  adopt(saved);
  return pulled();
}

function fresh() {
  const box = cached();
  if (!box) return false;
  if (Date.now() - box.at > CACHE_MS) return false;
  return Array.isArray(box.themes) && box.themes.length > 0;
}

function ownSwatch() {
  const t = OWN_THEME;
  const banner = custom.src();
  const rgb = parseHex(tone.current());
  return {
    key: t.key,
    name: t.name,
    group: t.group,
    rgb: banner ? t.rgba : "",
    soft: banner ? toneSoft(rgb) : "",
    on: t.on,
    mark: t.mark,
    depth: rgba(t.depth, 1),
    banner: banner,
    set: !!banner,
    varName: VAR_OF[t.key]
  };
}

function parseHex(v) {
  return tone.parseHex(v);
}

function toneData() {
  const view = picker.read(tone.current());
  return {
    toneOn: view.on,
    toneHex: view.hex.toUpperCase(),
    toneRgba: view.rgba,
    toneSoft: view.soft,
    toneOnInk: view.on ? rgba(WHITE, 1) : "",
    toneHue: view.hue,
    toneSat: view.sat,
    toneLight: view.light,
    toneHueAt: view.hueAt,
    toneSatAt: view.satAt,
    toneLightAt: view.lightAt,
    toneHueRead: view.hueRead,
    toneSatRead: view.satRead,
    toneLightRead: view.lightRead,
    toneRead: view.read
  };
}

function variables() {
  const owned = tint(OWN_THEME);
  const own = {
    rgba: owned.rgba, soft: owned.soft, on: owned.on, depth: owned.depth
  };
  return all().concat([OWN_THEME]).map((t) => {
    const v = t.key === OWN_KEY ? own : t;
    return VAR_OF[t.key] + ":" + v.rgba
      + ";" + VAR_OF[t.key] + "-soft:" + v.soft
      + ";" + VAR_OF[t.key] + "-on:" + v.on
      + ";" + VAR_OF[t.key] + "-depth:" + rgba(v.depth, 1);
  });
}

function toneSoft(rgb) {
  return rgba(rgb || OWN_THEME.rgb, WASH);
}

OWN_THEME.rgba = rgba(OWN_THEME.rgb, 1);
OWN_THEME.soft = rgba(OWN_THEME.rgb, WASH);
OWN_THEME.on = rgba(WHITE, 1);
OWN_THEME.depth = deepOf(OWN_THEME.rgb);
OWN_THEME.mark = rgba(MARK, 1);
VAR_OF[OWN_THEME.key] = "--c-" + OWN_THEME.key;

const UI_STACK = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", '
  + '"Microsoft YaHei", sans-serif';

const NUM_STACK = '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

function byKey() {
  return build(all());
}

function all() {
  return (ROWS.theme.length ? ROWS.theme : appearance.themes()).map(dress);
}

function ownUsable() {
  return groupOpen(GROUPS.filter((g) => g.key === OWN)[0]) && !!custom.src();
}

function get(key) {
  const map = byKey();
  return map[key] || map[DEFAULT];
}

function reachable(key) {
  const t = byKey()[key];
  if (!t) return false;
  const g = GROUPS.filter((x) => x.key === t.group)[0];
  return !g || groupOpen(g);
}

function current() {
  const key = store.settings().theme;
  if (key === OWN_KEY) return ownUsable() ? OWN_KEY : DEFAULT;
  if (!byKey()[key]) return DEFAULT;
  if (!reachable(key)) return DEFAULT;
  return key;
}

function currentTheme() {
  return get(current());
}

function toneOf() {
  if (!groupOpen(GROUPS.filter((g) => g.key === OWN)[0])) return null;
  return tone.parseHex(store.settings().toneColor);
}

function tint(theme) {
  const rgb = toneOf();
  if (!rgb) return theme;
  return {
    rgba: rgba(rgb, 1),
    soft: toneSoft(rgb),
    on: rgba(WHITE, 1),
    mark: rgba(rgb, 1),
    depth: deepOf(rgb)
  };
}

function style(key, fontKey) {
  const t = tint(key ? get(key) : currentTheme());
  const lit = toneOf();

  const ui = font.uiStack(fontKey);
  return variables().join(";") + ";--font-poem:" + font.stack(fontKey) + ";--font-ui:" + (ui || UI_STACK) + ";--font-num:" + (ui || NUM_STACK) +
    ";--theme:" + (lit ? rgba(lit, 1) : t.rgba) +
    ";--theme-deep:" + (lit ? rgba(lit, 1) : t.rgba) +
    ";--on-theme:" + t.on + ";--on-theme-soft:" + t.on.replace(/,\s*1\)$/, ",.7)") +
    ";--strong:" + t.rgba + ";--strong-soft:" + t.soft + ";--strong-text:" + t.rgba +
    ";--ink-strong:" + t.rgba + ";--on-ink:" + t.on + ";--on-ink-soft:"
    + t.on.replace(/,\s*1\)$/, ",.7)")
    + ";--mark:" + t.mark + ";--depth:" + rgba(t.depth, 1);
}

function set(key) {
  if (key === OWN_KEY) {
    if (!ownUsable()) return currentTheme();
    store.saveSettings({ theme: OWN_KEY });
    markDirty();
    return OWN_THEME;
  }
  if (!byKey()[key]) return currentTheme();
  if (!reachable(key)) return currentTheme();
  store.saveSettings({ theme: key });
  markDirty();
  return get(key);
}

function markDirty() {
  try {
    require("./sync").markDirty();
  } catch (e) {

  }
}

const TIER_CLASS = { pro: "theme-pro", max: "theme-max" };

function tierClass() {
  const tier = entitlement.status().tier;
  return TIER_CLASS[tier] || "";
}

function name() {
  return tierClass();
}

function apply(page) {
  const key = current();

  page.setData({ theme: key, themeStyle: style(key), name: tierClass() });
  return key;
}

function bannerOf(key) {
  if (key === OWN_KEY) return custom.src() || BANNER;
  return get(key).banner;
}

function bannerSrc() {
  return bannerOf(current());
}

function ownSwatchData() {
  return ownSwatch();
}

function clearOwn() {
  if (store.settings().theme === OWN_KEY) set(DEFAULT);
  custom.clear();
  return currentTheme();
}

module.exports = {
  GROUPS, DEFAULT, WASH, BANNER, VAR_OF, MARK, MARK_MIN,
  TRADITION, LANDSCAPE, OWN, OWN_KEY, OWN_THEME,
  all, palette, groups, groupOpen, reachable, ownUsable, ownSwatchData,
  variables, bannerOf, bannerSrc, get, current, currentTheme, style, set, apply, name,
  clearOwn, toneData, load, sync, adopt, fresh
};
