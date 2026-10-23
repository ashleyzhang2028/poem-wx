const tone = require("./color-tone");

const STOPS = 24;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function pctOf(value, max) {
  return Math.round(clamp(value / max, 0, 1) * 1000) / 10;
}

function at(hue, sat, light) {
  return tone.hex(tone.hslToRgb(hue, sat / 100, light / 100));
}

function band(of) {
  const hexes = [];
  for (let i = 0; i < STOPS; i++) hexes.push(at.apply(null, of(i / (STOPS - 1))));
  return {
    stops: hexes.map((hex, i) => hex + " " + pctOf(i, STOPS - 1) + "%").join(", "),
    cells: hexes
  };
}

function hueBand(sat, light) {
  return band((t) => [t * 360, sat * 100, light * 100]);
}

function satBand(hue, light) {
  return band((t) => [hue, t * 100, light * 100]);
}

function lightBand(hue, sat) {
  return band((t) => [hue, sat * 100, t * 100]);
}

function pick(hex) {
  const rgb = tone.parseHex(hex);
  if (!rgb) return null;
  const hsl = tone.rgbToHsl(rgb);
  return {
    hex: tone.hex(rgb),
    hue: Math.round(hsl.h),
    sat: Math.round(hsl.s * 100),
    light: Math.round(hsl.l * 100)
  };
}

function read(hex) {
  const found = pick(hex);
  const now = found || { hue: 0, sat: 40, light: 40 };
  const rgb = found ? tone.parseHex(found.hex) : null;
  const hue = hueBand(now.sat / 100, now.light / 100);
  const sat = satBand(now.hue, now.light / 100);
  const light = lightBand(now.hue, now.sat / 100);
  return {
    on: !!found,
    hex: found ? found.hex : "",
    rgba: rgb ? "rgba(" + rgb.join(", ") + ", 1)" : "",
    soft: rgb ? "rgba(" + rgb.join(", ") + ", 0.05)" : "",
    read: found ? now.hue + "° · " + now.sat + "% · " + now.light + "%" : "",
    hue: hue.stops,
    sat: sat.stops,
    light: light.stops,
    hueCells: hue.cells,
    satCells: sat.cells,
    lightCells: light.cells,
    hueRead: now.hue + "°",
    satRead: now.sat + "%",
    lightRead: now.light + "%",
    hueAt: pctOf(now.hue, 360),
    satAt: now.sat,
    lightAt: now.light
  };
}

const AXES = { hue: "色相", sat: "饱和", light: "明度" };

function fromAxis(axis, ratio, hex) {
  const found = pick(hex);
  const now = found || { hue: 0, sat: 40, light: 40 };
  const t = Math.round(clamp(ratio, 0, 1) * 100);
  if (axis === "sat") return pick(at(now.hue, t, now.light)).hex;
  if (axis === "light") return pick(at(now.hue, now.sat, t)).hex;
  return pick(at(Math.round(ratio * 360), now.sat, now.light)).hex;
}

module.exports = { STOPS, AXES, at, pick, read, fromAxis };
