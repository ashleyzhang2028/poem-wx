#!/usr/bin/env node
/**
 * 只同步 main 到 GitHub（只读镜像）。分支不同步，想让某个分支上去先合回 main。
 *
 *   GH_PAT    fine-grained PAT，对目标仓库有 Contents: Read and write
 *   GH_REPO   目标仓库，如 ashleyzhang2028/poem-wx（不带协议、不带 .git）
 */
"use strict";

const { execFileSync } = require("child_process");

const pat = process.env.GH_PAT || "";
const repo = process.env.GH_REPO || "";

function die(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

// 缺哪个当场说哪个：空着往下走，git 抛的是「读不到用户名」，看着像网络问题。
if (!pat) die("缺 GH_PAT —— 见 .cnb.yml 的 imports 与密钥仓库 wechat-ci.yml");
if (!repo) die("缺 GH_REPO（形如 owner/repo）");
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) die("GH_REPO 形状不对，应是 owner/repo：" + repo);

// 凭据只走 URL，不走 remote（remote 会把 token 落进 .git/config）。
// ⚠️ 形状只有 `${token}:x-oauth-basic@` 一种：只写 token@ 会被当用户名去问密码，
//    `x-access-token:token@` 回 `Invalid username or token`。
const url = `https://${pat}:x-oauth-basic@github.com/${repo}.git`;

// 关掉交互式询问：不然凭据不对时 git 会卡住等输入，CI 里报的是「超时」。
const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

function shortHead() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { env, encoding: "utf8" }).trim();
  } catch (e) {
    return "?";
  }
}

// ⚠️ 必须先 unshallow：CI 里是浅克隆，浅仓库直接 push 会报
//    `remote: fatal: did not receive expected object ...` / unpack failed，
//    看着像「push 太大被拒」，其实是缺祖先对象。
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
    // --unshallow 在完整的仓库上会直接报错，所以只在浅的时候走。
    git(["fetch", "--unshallow", "origin"]);
  }

  // --force：本仓库历史被改写过几次，不带就一律 non-fast-forward 而红。
  // GitHub 那份是只读镜像，覆盖它不算丢东西。
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
