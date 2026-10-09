#!/usr/bin/env node
/**
 * 把本仓库同步到 GitHub（只同步 main）。
 *
 * 只推 main，不做全量镜像 —— 这个仓库有 80 多个分支，大半是合完就没用的
 * `auto/*`。全量镜像得先在 CI 里把 88 个分支全 fetch 下来（checkout 只给一条），
 * 而 `--mirror` 又**带删除**：GitHub 上本地没有的分支会被抹掉。对「让人上
 * GitHub 看代码」这件事来说，代价换不来好处 —— 要的只是那条主干。
 *
 * 代价说清楚：**分支不会跟着同步**。想让某个分支也上去，进 GitHub 之前
 * 先合回 main。
 *
 * 需要的环境变量（放密钥仓库，别落明文、别写进 .cnb.yml）：
 *   GH_PAT    fine-grained PAT，对目标仓库有 Contents: Read and write
 *   GH_REPO   目标仓库，如 ashleyzhang2028/poem-wx（不带协议、不带 .git）
 *
 * 用法：
 *   GH_PAT=... GH_REPO=owner/repo node scripts/sync-github.js
 */
"use strict";

const { execFileSync } = require("child_process");

const pat = process.env.GH_PAT || "";
const repo = process.env.GH_REPO || "";

function die(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

// 名字对不上时当场说清是哪个空着 —— 空着往下走的话，git 抛的是
// `could not read Username for 'https://github.com'`，看着像网络问题，
// 真正的问题只是密钥仓库里少写了一个键（与 `.cnb.yml` 上传那步同款处理）。
if (!pat) die("缺 GH_PAT —— 见 .cnb.yml 的 imports 与密钥仓库 wechat-ci.yml");
if (!repo) die("缺 GH_REPO（形如 owner/repo）");
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) die("GH_REPO 形状不对，应是 owner/repo：" + repo);

// 凭据只走 URL，不走 `git remote`：remote 会把 token 落进 `.git/config`。
// CI 的工作区不打包 `.git`，但本机跑一次就留在那儿了，没必要。
//
// ⚠️ 形状是 `${token}:x-oauth-basic@`，两头都不能省。
//    - 只写 `https://${token}@…` → git 把它当**用户名**、还要问密码，
//      CI 里就是 `could not read Password for 'https://github.com'`（等输入超时）
//    - 写 `x-access-token:${token}@…`（老文档那种）→ 实测回
//      `Invalid username or token`。那是 401，看着像 token 过期，
//      而同一枚 token 打 API 是 200 —— 判据在这儿。
//    `x-oauth-basic` 那半是占位口令，GitHub 只认 token 那半。
const url = `https://${pat}:x-oauth-basic@github.com/${repo}.git`;

// 关掉交互式询问：凭据不对时 git 会**卡住等输入**，CI 里就是干等到超时，
// 报出来的是「超时」而不是「凭据不对」。
const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

function shortHead() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { env, encoding: "utf8" }).trim();
  } catch (e) {
    return "?";
  }
}

// ⚠️ **必须先 unshallow**。CI 那头在沙箱里跑的勾是**浅克隆**（`--depth 1`），
//    只有一条提交、没有父对象。浅仓库直接 push 会这样死：
//
//      POST git-receive-pack (621126 bytes)
//      remote: fatal: did not receive expected object 3fb7c19...
//      error: remote unpack failed: index-pack failed
//
//    621KB 对一个小程序仓库明显偏小 —— 那条 `did not receive expected object`
//    才是判据：**缺祖先对象**，不是网络、不是权限。看着像「push 太大被拒」，
//    其实是被推的那份历史本身不完整。
//    `git rev-parse --is-shallow-repository` 判据是 `true` 就一定会踩。
//
//    所以先补全：`fetch --unshallow`（已经完整的仓库上跑是无害的，
//    它认出不是浅的就不动）。这一步要拉完整历史，比 push 本身还慢 ——
//    但省不掉，push 要的就是那段历史。
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
    // `--unshallow` 在**已经完整**的仓库上会直接报错（「--unshallow on a
    // complete repository does not make sense」），所以只在浅的时候走这条；
    // 判据上面已经取过了。
    git(["fetch", "--unshallow", "origin"]);
  }

  // `--force`：本仓库的历史会被重写（merge / rebase 进来过几次），
  // 不带的话那种情况一律回 non-fast-forward 而红 —— 而这里要的就是「跟住 main」。
  // GitHub 那份是只读镜像，不该有人直接提交，所以覆盖它不算丢东西。
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
