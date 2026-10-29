const store = require("./store");
const font = require("./font");
const tiers = require("./tiers");
const entitlement = require("./entitlement");
const custom = require("./custom-banner");
const tone = require("./color-tone");
const picker = require("./color-picker");

const CITY_BANNER = "https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/themes/city/";

const TRADITION = "tradition";

const LANDSCAPE = "landscape";

const OWN = "own";

const OWN_KEY = "own";

const THEMES = [
  { key: "daiqing", name: "黛青", rgb: [2, 54, 51], banner: "/icons/hero.png", group: TRADITION },
  { key: "ink", name: "墨色", rgb: [8, 8, 10], group: TRADITION },
  { key: "muse", name: "暮色", rgb: [79, 96, 114], group: TRADITION },
  { key: "nuahui", name: "暖灰", rgb: [164, 86, 104], group: TRADITION },
  { key: "mich", name: "米褐", rgb: [126, 101, 84], group: TRADITION },
  { key: "shilv", name: "石绿", rgb: [108, 127, 79], group: TRADITION },
  { key: "yanzhi", name: "胭脂", rgb: [157, 41, 51], group: TRADITION },
  { key: "yuqing", name: "雨过天青", rgb: [47, 96, 85], group: TRADITION },
  { key: "datongxuankongsi", name: "大同悬空寺", rgb: [203, 142, 79], banner: CITY_BANNER + "datong_xuankongsi.png", group: LANDSCAPE },
  { key: "eergunashidi", name: "额尔古纳", rgb: [205, 83, 63], banner: CITY_BANNER + "eerguna_shidi.png", group: LANDSCAPE },
  { key: "hulunbeiershiwei", name: "呼伦贝尔室韦", rgb: [53, 131, 166], banner: CITY_BANNER + "hulunbeier_shiwei.png", group: LANDSCAPE },
  { key: "dandongyalujiang", name: "丹东鸭绿江", rgb: [16, 50, 59], banner: CITY_BANNER + "dandong_yalujiang.png", group: LANDSCAPE },
  { key: "benxiguanmenshan", name: "本溪关门山", rgb: [205, 20, 11], banner: CITY_BANNER + "benxi_guanmenshan.png", group: LANDSCAPE },
  { key: "changchunnanling", name: "长春南岭", rgb: [243, 61, 104], banner: CITY_BANNER + "changchun_nanling.png", group: LANDSCAPE },
  { key: "baishanchangbaishan", name: "白山长白山", rgb: [11, 41, 74], banner: CITY_BANNER + "baishan_changbaishan.png", group: LANDSCAPE },
  { key: "yangzhoushxihu", name: "扬州瘦西湖", rgb: [145, 207, 8], banner: CITY_BANNER + "yangzhou.png", group: LANDSCAPE },
  { key: "fuyangfuchunjiang", name: "富阳富春江", rgb: [26, 37, 35], banner: CITY_BANNER + "fuyang_fuchunjiang.png", group: LANDSCAPE },
  { key: "wenzhouyandangshan", name: "温州雁荡山", rgb: [22, 53, 46], banner: CITY_BANNER + "wenzhou_yandangshan.png", group: LANDSCAPE },
  { key: "nanpingwuyishan", name: "南平武夷山", rgb: [14, 133, 118], banner: CITY_BANNER + "nanping_wuyishan.png", group: LANDSCAPE },
  { key: "qingdaolaoshan", name: "青岛崂山", rgb: [33, 56, 63], banner: CITY_BANNER + "qingdao_laoshan.png", group: LANDSCAPE },
  { key: "qingmingshanghetu", name: "开封上河图", rgb: [107, 153, 7], banner: CITY_BANNER + "kaifeng.png", group: LANDSCAPE },
  { key: "ganziyading", name: "甘孜亚丁", rgb: [236, 158, 1], banner: CITY_BANNER + "ganzhi_yading.png", group: LANDSCAPE },
  { key: "lijianghutiaoxia", name: "丽江虎跳峡", rgb: [44, 62, 62], banner: CITY_BANNER + "yunnan_hutiaoxia.png", group: LANDSCAPE },
  { key: "lijiangluguhu", name: "丽江泸沽湖", rgb: [25, 91, 108], banner: CITY_BANNER + "lijiang_luguhu.png", group: LANDSCAPE },
  { key: "jiayuguan", name: "嘉峪关", rgb: [249, 139, 57], banner: CITY_BANNER + "jiayuguan.png", group: LANDSCAPE },
  { key: "dunhuangmogaoku", name: "敦煌莫高窟", rgb: [91, 54, 41], banner: CITY_BANNER + "dunhuang_mogaoku.png", group: LANDSCAPE },
  { key: "aletailhemu", name: "阿勒泰禾木", rgb: [35, 60, 75], banner: CITY_BANNER + "aletai_hemu.png", group: LANDSCAPE }
];

const OWN_THEME = {
  key: OWN_KEY,
  name: "自定义题图",
  rgb: [8, 8, 10],
  group: OWN
};

const DEFAULT = "daiqing";

const BANNER = "/icons/hero.png";

const WASH = 0.05;

const MARK = [56, 56, 58];

const MARK_MIN = 3;

const DEEP_STEP = 0.04;

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

THEMES.forEach((t) => {
  t.rgba = rgba(t.rgb, 1);
  t.soft = rgba(t.rgb, WASH);
  t.on = rgba(WHITE, 1);
  t.depth = deepOf(t.rgb);
  t.mark = rgba(MARK, 1);
  t.banner = t.banner || BANNER;
});

const VAR_OF = {};
THEMES.forEach((t) => {
  VAR_OF[t.key] = "--c-" + t.key;
});

function palette() {
  return THEMES.map((t) => ({
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
  return THEMES.concat([OWN_THEME]).map((t) => {
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

const BY_KEY = {};
THEMES.forEach((t) => { BY_KEY[t.key] = t; });
BY_KEY[OWN_THEME.key] = OWN_THEME;

const VAR_DECLS = variables().join(";");

const UI_STACK = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", '
  + '"Microsoft YaHei", sans-serif';

const NUM_STACK = '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

function all() {
  return THEMES;
}

function ownUsable() {
  return groupOpen(GROUPS.filter((g) => g.key === OWN)[0]) && !!custom.src();
}

function get(key) {
  return BY_KEY[key] || BY_KEY[DEFAULT];
}

function reachable(key) {
  const t = BY_KEY[key];
  if (!t) return false;
  const g = GROUPS.filter((x) => x.key === t.group)[0];
  return !g || groupOpen(g);
}

function current() {
  const key = store.settings().theme;
  if (key === OWN_KEY) return ownUsable() ? OWN_KEY : DEFAULT;
  if (!BY_KEY[key]) return DEFAULT;
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
  return VAR_DECLS + ";--font-poem:" + font.stack(fontKey) + ";--font-ui:" + (ui || UI_STACK) + ";--font-num:" + (ui || NUM_STACK) +
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
  if (!BY_KEY[key]) return currentTheme();
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
  THEMES, GROUPS, DEFAULT, WASH, BANNER, VAR_OF, MARK, MARK_MIN,
  OWN, OWN_KEY, OWN_THEME,
  all, palette, groups, groupOpen, reachable, ownUsable, ownSwatchData,
  variables, bannerOf, bannerSrc, get, current, currentTheme, style, set, apply, name,
  clearOwn, toneData
};
