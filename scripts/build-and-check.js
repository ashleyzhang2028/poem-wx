"use strict";

const { execFileSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const STEPS = [
  ["编译语料", "build-data.js"],
  ["离线自检", "check.js"],
  ["与网页版能力表对照", "parity.js"],
  ["登录 / 同步端到端", "e2e-wx-sync.js"],
  ["MySQL 存储层端到端", "e2e-mysql.js"]
];

let failed = null;

for (const [name, file] of STEPS) {
  console.log("→ " + name + "（" + file + "）");
  try {
    execFileSync(process.execPath, [path.join(__dirname, file)], { stdio: "inherit", cwd: ROOT });
  } catch (e) {
    failed = { name, file, code: e.status === undefined ? 1 : e.status };
    break;
  }
}

if (failed) {
  console.error("");
  console.error("✗ " + failed.name + " 没过（" + failed.file + "，退出码 " + failed.code + "）");
  console.error("  这四条自检钉住的都是口径，不是可以顺手放宽的障碍：" +
    "要改先说明是哪条口径变了（见 AGENTS.md）。");
  process.exit(failed.code);
}

console.log("");
console.log("四条自检全绿（语料已编译进 miniprogram/data/）");
