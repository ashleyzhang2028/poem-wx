const tone = require("./color-tone");

const HUE_STEP = 6;

const SAT = [100, 92, 84, 76, 68, 60, 52, 44, 36, 28, 20, 12, 6, 0];

const LIGHT = [100, 96, 91, 85, 79, 73, 67, 61, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0];

const GRAY = 0;

const MID = 50;

function range(step, from, to) {
  const out = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
}

function hueAt(hue) {
  return at(hue, 100, MID);
}

function hueBand() {
  return {
    hue: range(HUE_STEP, 0, 330).map(hueAt),
    sat: range(10, 0, 100).map((v) => at(GRAY, v, MID)),
    light: range(10, 0, 100).map((l) => at(GRAY, 0, l))
  };
}

function satTrack(hue) {
  return SAT.map((s) => at(hue, s, MID));
}

function lightTrack(hue, sat) {
  return LIGHT.map((l) => at(hue, sat, l));
}

function nearest(list, pick) {
  const at = list.indexOf(pick);
  if (at >= 0) return at;
  return list.reduce((best, v, i) => (
    Math.abs(v - pick) < Math.abs(list[best] - pick) ? i : best
  ), 0);
}

function plane(hue) {
  return LIGHT.map((l) => SAT.map((s) => at(hue, s, l)));
}

function pick(hex) {
  const rgb = tone.parseHex(hex);
  if (!rgb) return null;
  const hsl = tone.rgbToHsl(rgb);
  return {
    hex: tone.hex(rgb),
    hue: Math.round(hsl.h) % 360,
    sat: Math.round(hsl.s * 100),
    light: Math.round(hsl.l * 100)
  };
}

function at(hue, sat, light) {
  return tone.hex(tone.hslToRgb(Number(hue) || 0, (Number(sat) || 0) / 100, (Number(light) || 0) / 100));
}

function read(hex) {
  const at0 = pick(hex);
  const now = at0 || { hue: 0, sat: 42, light: 37 };
  const rgb = at0 ? tone.parseHex(at0.hex) : null;
  return {
    on: !!at0,
    hex: at0 ? at0.hex : "",
    rgba: rgb ? "rgba(" + rgb.join(", ") + ", 1)" : "",
    soft: rgb ? "rgba(" + rgb.join(", ") + ", 0.05)" : "",
    read: at0 ? now.hue + "° · " + now.sat + "% · " + now.light + "%" : "",
    bands: hueBand(),
    hueAt: nearest(range(HUE_STEP, 0, 330), now.hue),
    satAt: nearest(SAT, now.sat),
    lightAt: nearest(LIGHT, now.light),
    satTrack: satTrack(now.hue),
    lightTrack: lightTrack(now.hue, now.sat),
    plane: plane(now.hue)
  };
}

module.exports = { HUE_STEP, SAT, LIGHT, hueBand, satTrack, lightTrack, plane, pick, at, read };
