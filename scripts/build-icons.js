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
  ["mine", "\u200cmine.svg"],
  ["yes", "yes.svg"],
  ["no", "no.svg"],
  ["search", "search.svg"]
];

function flatten(svg) {
  return svg
    .replace(HEX, "currentColor")
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/>\s+</g, "><")
    .trim();
}

function dataUri(svg) {
  return "data:image/svg+xml," + encodeURIComponent(svg)
    .replace(/%20/g, " ")
    .replace(/%3D/g, "=")
    .replace(/%3A/g, ":")
    .replace(/%2F/g, "/")
    .replace(/%22/g, "'");
}

function tint(uri, color) {
  return uri.replace(/currentColor/g, encodeURIComponent(color));
}

function escapeJs(uri) {
  return uri.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "");
}

const missing = NAMES.filter((n) => !fs.existsSync(path.join(SRC_DIR, n[1])));
if (missing.length) {
  console.error("缺图标源文件：" + missing.map((n) => n[1]).join(", "));
  process.exit(1);
}

const LINES = [];

NAMES.forEach((n) => {
  const svg = flatten(fs.readFileSync(path.join(SRC_DIR, n[1]), "utf8"));
  if (svg.indexOf("currentColor") < 0) {
    console.error(n[1] + " 里没有可换色的 fill / stroke —— 它会是死色");
    process.exit(1);
  }
  LINES.push("  " + n[0] + ": '" + escapeJs(dataUri(svg)) + "'");
});

const ICON_URI = {};
NAMES.forEach((n) => {
  ICON_URI[n[0]] = dataUri(flatten(fs.readFileSync(path.join(SRC_DIR, n[1]), "utf8")));
});

["yes", "no"].forEach((name) => {
  LINES.push("  " + name + "Ink: '" + escapeJs(tint(ICON_URI[name], "#1c1c1e")) + "'");
});

fs.writeFileSync(OUT_FILE,
  "\"use strict\";\n\nmodule.exports = {\n" + LINES.join(",\n") + "\n};\n");

const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
console.log(NAMES.length + " 枚图标 → miniprogram/utils/icons.js（" + kb + "KB）");
