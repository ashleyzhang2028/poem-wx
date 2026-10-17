const store = require("./store");

const THEMES = [
  { key: "daiqing", name: "黛青",     rgb: [2, 54, 51] },
  { key: "ink",     name: "墨色",     rgb: [8, 8, 10] },
  { key: "qinglv",  name: "青绿",     rgb: [46, 106, 103] },
  { key: "muse",    name: "暮色",     rgb: [79, 96, 114] },
  { key: "nuahui",  name: "暖灰",     rgb: [164, 86, 104] },
  { key: "qingwa",  name: "青瓦",     rgb: [74, 100, 96] },
  { key: "mich",    name: "米褐",     rgb: [126, 101, 84] },
  { key: "shilv",   name: "石绿",     rgb: [108, 127, 79] },
  { key: "mohong",  name: "墨红",     rgb: [140, 47, 45] },
  { key: "wulan",   name: "雾蓝",     rgb: [96, 126, 149] },
  { key: "yanzhi",  name: "胭脂",     rgb: [157, 41, 51] },
  { key: "yuqing",  name: "雨过天青", rgb: [47, 96, 85] }
];

const DEFAULT = "daiqing";

const WASH = 0.05;

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

THEMES.forEach((t) => {
  t.rgba = rgba(t.rgb, 1);
  t.soft = rgba(t.rgb, WASH);
  t.on = rgba(inkOn(t.rgb), 1);
});

const VAR_OF = {};
["qinglv", "muse", "nuahui", "qingwa", "mich", "shilv", "mohong", "wulan"].forEach((k) => {
  VAR_OF[k] = "--c-" + k;
});
VAR_OF.daiqing = "--c-daiqing";
VAR_OF.ink = "--c-ink";
VAR_OF.yanzhi = "--c-yanzhi";
VAR_OF.yuqing = "--c-yuqing";

function palette() {
  return THEMES.map((t) => ({
    key: t.key,
    name: t.name,
    rgb: t.rgba,
    soft: t.soft,
    on: t.on,
    varName: VAR_OF[t.key]
  }));
}

function variables() {
  return THEMES.map((t) => VAR_OF[t.key] + ":" + t.rgba + ";" + VAR_OF[t.key] + "-soft:" + t.soft);
}

const BY_KEY = {};
THEMES.forEach((t) => { BY_KEY[t.key] = t; });

function all() {
  return THEMES;
}

function get(key) {
  return BY_KEY[key] || BY_KEY[DEFAULT];
}

function current() {
  const key = store.settings().theme;
  return BY_KEY[key] ? key : DEFAULT;
}

function currentTheme() {
  return get(current());
}

function style(key) {
  const t = get(key || current());

  return variables().join(";") +
    ";--theme:" + t.rgba + ";--theme-deep:" + t.rgba +
    ";--on-theme:" + t.on + ";--on-theme-soft:" + t.on.replace(/,\s*1\)$/, ",.7)") +
    ";--strong:" + t.rgba + ";--strong-soft:" + t.soft + ";--strong-text:" + t.rgba +
    ";--ink-strong:" + t.rgba + ";--on-ink:" + t.on + ";--on-ink-soft:"
    + t.on.replace(/,\s*1\)$/, ",.7)");
}

function set(key) {
  if (!BY_KEY[key]) return currentTheme();
  store.saveSettings({ theme: key });

  try {
    require("./sync").markDirty();
  } catch (e) {

  }
  return get(key);
}

function apply(page) {
  const key = current();

  page.setData({ theme: key, themeStyle: style(key) });
  return key;
}

module.exports = {
  THEMES, DEFAULT, WASH, VAR_OF,
  all, palette, variables, get, current, currentTheme, style, set, apply
};
