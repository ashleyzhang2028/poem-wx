const tone = require("./color-tone");

const HUE_STEP = 6;

const SAT = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

const LIGHT = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

function range(step, from, to) {
  const out = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
}

function hueTrack(sat, light) {
  return range(HUE_STEP, 0, 354).map((h) => at(h, sat, light));
}

function satTrack(hue, light) {
  return SAT.map((s) => at(hue, s, light));
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

function pick(hex) {
  const rgb = tone.parseHex(hex);
  if (!rgb) return null;
  const hsl = tone.rgbToHsl(rgb);
  return {
    hex: tone.hex(rgb),
    hue: snap(range(HUE_STEP, 0, 354), Math.round(hsl.h) % 360),
    sat: snap(SAT, Math.round(hsl.s * 100)),
    light: snap(LIGHT, Math.round(hsl.l * 100))
  };
}

function pct(index, count) {
  return Math.round((index + 0.5) * 1000 / Math.max(1, count)) / 10 + "%";
}

function snap(list, pick) {
  return list[nearest(list, pick)];
}

function at(hue, sat, light) {
  return tone.hex(tone.hslToRgb(Number(hue) || 0, (Number(sat) || 0) / 100, (Number(light) || 0) / 100));
}

function read(hex) {
  const at0 = pick(hex);
  const now = at0 || { hue: 0, sat: 40, light: 40 };
  const rgb = at0 ? tone.parseHex(at0.hex) : null;
  const hue = range(HUE_STEP, 0, 354);
  return {
    on: !!at0,
    hex: at0 ? at0.hex : "",
    rgba: rgb ? "rgba(" + rgb.join(", ") + ", 1)" : "",
    soft: rgb ? "rgba(" + rgb.join(", ") + ", 0.05)" : "",
    read: at0 ? now.hue + "° · " + now.sat + "% · " + now.light + "%" : "",
    hue: hueTrack(now.sat, now.light),
    sat: satTrack(now.hue, now.light),
    light: lightTrack(now.hue, now.sat),
    hueAt: pct(nearest(hue, now.hue), hue.length),
    satAt: pct(nearest(SAT, now.sat), SAT.length),
    lightAt: pct(nearest(LIGHT, now.light), LIGHT.length)
  };
}

module.exports = { HUE_STEP, SAT, LIGHT, hueTrack, satTrack, lightTrack, pick, at, read };
