const store = require("./store");

const KEY = "toneColor";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function pad(v) {
  const s = clamp(Math.round(v), 0, 255).toString(16);
  return s.length < 2 ? "0" + s : s;
}

function hex(rgb) {
  return "#" + pad(rgb[0]) + pad(rgb[1]) + pad(rgb[2]);
}

function parseHex(text) {
  const raw = String(text == null ? "" : text).trim().replace(/^[#＃]/, "");
  if (!/^[0-9a-fA-F]{3}$/.test(raw) && !/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ];
}

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l - c / 2;
  const i = Math.floor(hue / 60) % 6;
  const pair = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][i];
  return pair.map((v) => Math.round((v + m) * 255));
}

function rgbToHsl(rgb) {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l: l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: clamp(s, 0, 1), l: l };
}

function pick(text) {
  const rgb = parseHex(text);
  if (!rgb) return null;
  const tone = rgbToHsl(rgb);
  return {
    hex: hex(rgb),
    hue: Math.round(tone.h),
    light: Math.round(tone.l * 100),
    saturation: Math.round(tone.s * 100)
  };
}

function current() {
  const v = store.settings()[KEY];
  const rgb = parseHex(v);
  return rgb ? hex(rgb) : "";
}

function set(text) {
  const rgb = parseHex(text);
  if (!rgb) return false;
  store.saveSettings({ [KEY]: hex(rgb) });
  return true;
}

function clear() {
  store.saveSettings({ [KEY]: "" });
}

module.exports = { KEY, parseHex, hex, hslToRgb, rgbToHsl, pick, current, set, clear };
