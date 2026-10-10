const store = require("./store");

const THEMES = [

  { key: "ink",    name: "墨",   hex: "#1C1C1E", deep: "#000000", on: "#FFFFFF", text: "#1C1C1E" },
  { key: "zhuhong", name: "朱红", hex: "#FF4C00", deep: "#D63F00", on: "#FFFFFF", text: "#C93A00" },
  { key: "minghuang", name: "明黄", hex: "#FAD069", deep: "#E8B93F", on: "#3D2E00", text: "#8A6B00" },
  { key: "tianqing", name: "天青", hex: "#228FBD", deep: "#1B769C", on: "#FFFFFF", text: "#1A7397" },
  { key: "yuguotianqing", name: "雨过天青", hex: "#2F6055", deep: "#264F46", on: "#FFFFFF", text: "#2F6055" },
  { key: "yanzhi", name: "胭脂", hex: "#9D2933", deep: "#82212A", on: "#FFFFFF", text: "#9D2933" },
  { key: "zhuqing", name: "竹青", hex: "#789262", deep: "#637A51", on: "#FFFFFF", text: "#5E7649" },
  { key: "xuanse", name: "玄色", hex: "#622A1D", deep: "#4E2117", on: "#FFFFFF", text: "#622A1D" },
  { key: "yaqing", name: "鸦青", hex: "#424C50", deep: "#333B3E", on: "#FFFFFF", text: "#424C50" },
  { key: "tianshuibi", name: "天水碧", hex: "#3D6379", deep: "#325266", on: "#FFFFFF", text: "#3D6379" }
];

const DEFAULT = "ink";

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

  const on = t.on.replace("#", "");
  const soft = "rgba(" + parseInt(on.slice(0, 2), 16) + "," +
    parseInt(on.slice(2, 4), 16) + "," + parseInt(on.slice(4, 6), 16) + ",.7)";

  return "--theme:" + t.hex + ";--theme-deep:" + t.deep +
    ";--on-theme:" + t.on + ";--on-theme-soft:" + soft +
    ";--strong:" + t.hex + ";--strong-text:" + t.text + ";--ink-strong:" + t.deep +
    ";--on-ink:" + t.on + ";--on-ink-soft:" + soft;
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

  page.setData({ theme: key, themeStyle: style(key), themeHex: get(key).hex });
  return key;
}

module.exports = { THEMES, DEFAULT, all, get, current, currentTheme, style, set, apply };
