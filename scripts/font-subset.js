"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const OUT_DIR = process.env.OUT || path.join(__dirname, "..", "dist", "fonts");

const PUNCT = "0123456789·—、。，？！：；（）《》〈〉「」…";

function corpusWindow() {
  const dir = path.join(__dirname, "corpus", "data");
  const sandbox = { window: {}, console: console };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  fs.readdirSync(dir)
    .filter((f) => /^poems-.*\.js$|^text-master\.js$/.test(f))
    .sort()
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), "utf8"), sandbox, { filename: f }));
  return sandbox.window;
}

function collectChars() {
  const W = corpusWindow();
  const head = new Set();
  const text = new Set();
  PUNCT.split("").forEach((c) => { head.add(c); text.add(c); });

  Object.keys(W).forEach((k) => {
    if (!/^POEMS/.test(k)) return;
    W[k].forEach((it) => {
      String(it.title || "").split("").forEach((c) => head.add(c));
      String(it.author || "").split("").forEach((c) => head.add(c));
      String(it.text || "").split("").forEach((c) => text.add(c));
    });
  });

  return { head: [...head].join(""), text: [...text].join("") };
}

function subset(source, chars, out) {
  const textFile = path.join(require("os").tmpdir(), "kuibu-" + path.basename(out) + ".txt");
  fs.writeFileSync(textFile, chars);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  require("child_process").execFileSync("pyftsubset", [
    source,
    "--text-file=" + textFile,
    "--flavor=woff2",
    "--layout-features=*",
    "--output-file=" + out
  ], { stdio: "inherit" });
  return fs.statSync(out).size / 1024;
}

function main() {
  const chars = collectChars();
  const src = process.env.FONT_SRC;

  if (!src) {
    console.log("跳过：未给 FONT_SRC（一份完整的中文宋体源，如 NotoSerifSC-600.woff2）");
    return;
  }

  if (!fs.existsSync(src)) {
    console.log("跳过：源字体不在 " + src);
    return;
  }

  const kb = subset(src, chars.head + chars.text, path.join(OUT_DIR, "kuibu-serif.woff2"));

  console.log("诗词宋体子集：" + (chars.head + chars.text).length + " 字 → kuibu-serif.woff2（" + kb.toFixed(0) + "KB）");
  console.log("地址填进 auth.fontUrl，见 utils/font.js");
}

main();
