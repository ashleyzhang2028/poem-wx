#!/usr/bin/env node
/**
 * 生成「篇名子集」宋体：把全站篇名 + 作者名里出现过的字抽出来，
 * 从源字体（Noto Serif SC，与网页版同一套）切一份 woff2。
 *
 * 为什么要子集
 * -----------
 * 一整套中文宋体 woff2 有 3MB，主包只剩不到 400KB，塞不下。
 * 而篇名与作者名去重之后只有 3064 个字，切出来约 1.2MB ——
 * 仍然不进包，走 CDN；子集只是让这一次下载**别下载整个字库**。
 *
 * 输入：POEM_WEB_DIR（默认 /tmp/poem）下的 fonts/NotoSerifSC-600.woff2
 * 输出：dist/fonts/kuibu-title-serif.woff2（默认，可用 OUT 覆盖）
 *
 * 依赖 pyftsubset（pip install fonttools brotli）。CI 里没装就跳过，
 * 不判失败 —— 字体是观感增强，不该挡住构建。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const WEB_DIR = process.env.POEM_WEB_DIR || "/tmp/poem";
const SRC = process.env.FONT_SRC || path.join(WEB_DIR, "fonts", "NotoSerifSC-600.woff2");
const OUT = process.env.OUT || path.join(__dirname, "..", "dist", "fonts", "kuibu-title-serif.woff2");

/** 篇名与作者名里出现过的全部字，外加界面会用到的标点与数字 */
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
