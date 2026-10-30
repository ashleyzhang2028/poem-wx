"use strict";

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", "miniprogram", "icons");
const OUT_FILE = path.join(__dirname, "..", "miniprogram", "utils", "icons.js");

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

const NAMES = [
  ["home", "CilBadge.svg"],
  ["library", "CilLibraryBuilding.svg"],
  ["conference", "CilDiamond.svg"],
  ["mine", "CilUser.svg"],
  ["search", "CilSearch.svg"],
  ["clear", "CilXCircle.svg"],
  ["yes", "CilCheckCircle.svg"],
  ["no", "CilXCircle.svg"],
  ["moonFull", "MoonFull.svg"],
  ["moonHalf", "MoonHalf.svg"],
  ["moonNew", "MoonNew.svg"],
  ["add", "CilPlus.svg"],
  ["added", "CilCheckAlt.svg"],
  ["playlist", "CilPlaylistAdd.svg"],
  ["bookmark", "CilBookmark.svg"],
  ["bookmarked", "CilBookmarkFill.svg"],
  ["left", "CilJustifyLeft.svg"],
  ["center", "CilJustifyCenter.svg"],
  ["off", "CilText.svg"],
  ["all", "CilTextSize.svg"],
  ["zoomOut", "CilZoomOut.svg"],
  ["zoomIn", "CilZoomIn.svg"],
  ["refresh", "CilLoop.svg"],
  ["chart", "CilChartBar.svg"],
  ["trend", "CilChartLine.svg"],
  ["tomorrow", "CilCalendarTomorrow.svg"],
  ["month", "CilCalendarMonth.svg"],
  ["crest", "TangBaoxiang.svg"],
  ["settings", "CilCog.svg"],
  ["lineUp", "CilLineUp.svg"],
  ["lineDown", "CilLineDown.svg"]
];

function flatten(svg) {
  return svg
    .replace(HEX, "currentColor")
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/>\s+</g, "><")
    .replace(/<svg(?![^>]*\swidth=)/, '<svg width="1em" height="1em"')
    .trim();
}

function dataUri(svg) {
  return "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
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

fs.writeFileSync(OUT_FILE,
  "\"use strict\";\n\nmodule.exports = {\n" + LINES.join(",\n") + "\n};\n");

const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
console.log(NAMES.length + " 枚图标 → miniprogram/utils/icons.js（" + kb + "KB）");
