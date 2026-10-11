"use strict";

const { execFileSync } = require("child_process");

const pat = process.env.GH_PAT || "";
const repo = process.env.GH_REPO || "";

function die(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

if (!pat) die("缺 GH_PAT —— 见 .cnb.yml 的 imports 与密钥仓库 wechat-ci.yml");
if (!repo) die("缺 GH_REPO（形如 owner/repo）");
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) die("GH_REPO 形状不对，应是 owner/repo：" + repo);

const url = `https://${pat}:x-oauth-basic@github.com/${repo}.git`;

const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

function shortHead() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { env, encoding: "utf8" }).trim();
  } catch (e) {
    return "?";
  }
}

function git(args) {
  execFileSync("git", args, { stdio: "inherit", env });
}

try {
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
    env,
    encoding: "utf8"
  }).trim();
  if (shallow === "true") {
    console.error("→ 工作区是浅克隆，先补全历史");

    git(["fetch", "--unshallow", "origin"]);
  }

  git(["push", "--force", url, "HEAD:refs/heads/main"]);
  console.error("✓ 已同步到 https://github.com/" + repo + "（main ← " + shortHead() + "）");
} catch (e) {
  console.error("");
  console.error("✗✗✗ 同步到 GitHub 失败 ✗✗✗");
  console.error("  " + repo + " —— 常见原因，按这个顺序查：");
  console.error("  1. GH_PAT 过期 / 被撤销 → GitHub 回 403");
  console.error("  2. GH_PAT 的 Repository access 没勾上 " + repo + " → 404，看着像仓库不存在");
  console.error("  3. 权限没给 Contents: Read and write → 403");
  process.exit(1);
}
