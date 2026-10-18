"use strict";

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", "miniprogram", "icons");
const OUT_FILE = path.join(__dirname, "..", "miniprogram", "utils", "icons.js");

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

const NAMES = [
  ["home", "home.svg"],
  ["library", "library.svg"],
  ["conference", "conference.svg"],
  ["mine", "mine.svg"],
  ["yes", "yes.svg"],
  ["no", "no.svg"],
  ["search", "search.svg"],
  ["smile", "smile.svg"],
  ["meh", "meh.svg"],
  ["frown", "frown.svg"]
];

function flatten(svg) {
  return svg
    .replace(HEX, "currentColor")
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/>\s+</g, "><")
    .trim();
}

function dataUri(svg) {
  return "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
}

function tint(uri, color) {
  const head = "data:image/svg+xml;base64,";
  if (uri.indexOf(head) !== 0) return uri;
  const svg = Buffer.from(uri.slice(head.length), "base64").toString("utf8");
  return dataUri(svg.replace(/currentColor/g, color));
}

function escapeJs(uri) {
  return uri.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "");
}

const missing = NAMES.filter((n) => !fs.existsSync(path.join(SRC_DIR, n[1])));
if (missing.length) {
  console.error("缺图标源文件：" + missing.map((n) => n[1]).join(", "));
  process.exit(1);
}

const ICON_URI = {};
const LINES = [];

NAMES.forEach((n) => {
  const svg = flatten(fs.readFileSync(path.join(SRC_DIR, n[1]), "utf8"));
  if (svg.indexOf("currentColor") < 0) {
    console.error(n[1] + " 里没有可换色的 fill / stroke —— 它会是死色");
    process.exit(1);
  }
  ICON_URI[n[0]] = dataUri(svg);
  LINES.push("  " + n[0] + ": '" + escapeJs(ICON_URI[n[0]]) + "'");
});

["yes", "no"].forEach((name) => {
  LINES.push("  " + name + "Ink: '" + escapeJs(tint(ICON_URI[name], "#1c1c1e")) + "'");
});

fs.writeFileSync(OUT_FILE,
  "\"use strict\";\n\nmodule.exports = {\n" + LINES.join(",\n") + "\n};\n");

const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
console.log(NAMES.length + " 枚图标 → miniprogram/utils/icons.js（" + kb + "KB）");
