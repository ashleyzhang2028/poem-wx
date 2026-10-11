"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const WEB_DIR = process.env.POEM_WEB_DIR || "/tmp/poem";
const SRC = process.env.FONT_SRC || path.join(WEB_DIR, "fonts", "NotoSerifSC-600.woff2");
const OUT = process.env.OUT || path.join(__dirname, "..", "dist", "fonts", "kuibu-title-serif.woff2");

function collectChars() {
  const dir = path.join(__dirname, "..", "miniprogram", "data", "books");
  const chars = new Set();
  fs.readdirSync(dir).forEach((f) => {
    JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).forEach((it) => {
      String(it.t || "").split("").forEach((c) => chars.add(c));
      String(it.a || "").split("").forEach((c) => chars.add(c));
    });
  });
  "0123456789·—、。《》（）〈〉「」…".split("").forEach((c) => chars.add(c));
  return [...chars].join("");
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.log("跳过：源字体不在 " + SRC + "（设 FONT_SRC 指过去）");
    return;
  }
  const text = collectChars();
  const textFile = path.join(require("os").tmpdir(), "kuibu-title-chars.txt");
  fs.writeFileSync(textFile, text);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  execFileSync("pyftsubset", [
    SRC,
    "--text-file=" + textFile,
    "--flavor=woff2",
    "--layout-features=*",
    "--output-file=" + OUT
  ], { stdio: "inherit" });

  const kb = fs.statSync(OUT).size / 1024;
  console.log("篇名宋体子集：" + text.length + " 字 → " + OUT + "（" + kb.toFixed(0) + "KB）");
  console.log("传上去之后，把地址填进 auth.fontUrl（或等后端下发），见 utils/font.js");
}

main();
