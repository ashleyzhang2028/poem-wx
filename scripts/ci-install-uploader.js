"use strict";

const { execFileSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PKG = "miniprogram-ci";
const ATTEMPTS = 5;

function installed() {
  try {
    return require(`${PKG}/package.json`).version;
  } catch (e) {
    return "";
  }
}

function npmInstall() {
  execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["i", "-D", PKG, "--no-audit", "--no-fund", "--loglevel=error"],
    { cwd: ROOT, stdio: "inherit" }
  );
}

for (let round = 1; round <= ATTEMPTS; round += 1) {
  try {
    npmInstall();
    const v = installed();
    if (!v) throw new Error(`${PKG} 装完仍 require 不到`);
    console.log(`✓ ${PKG}@${v}（第 ${round} 次装上）`);
    process.exit(0);
  } catch (e) {
    const first = String((e && e.message) || "").split("\n")[0];
    if (round === ATTEMPTS) {
      console.error(`✗ 连续 ${ATTEMPTS} 次装不上 ${PKG}：${first}`);
      console.error(`✗ 上游刚发的传递依赖在 registry 上取不到（404）时会这样，隔几分钟重跑即可`);
      process.exit(1);
    }
    console.error(`✗ 第 ${round} 次装 ${PKG} 没成（${first}），${15 * round}s 后重试`);
    execFileSync("sleep", [String(15 * round)], { stdio: "ignore" });
  }
}
