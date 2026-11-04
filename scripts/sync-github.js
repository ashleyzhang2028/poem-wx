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
const UPSTREAM = "refs/remotes/upstream/main";

const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

function git(args, opts) {
  return execFileSync("git", args, Object.assign({ env, encoding: "utf8" }, opts)).trim();
}

function run(args) {
  execFileSync("git", args, { stdio: "inherit", env });
}

function remoteHead() {
  const out = execFileSync("git", ["ls-remote", url, "refs/heads/main"], {
    env,
    encoding: "utf8"
  }).trim();
  return out ? out.split(/\s+/)[0] : "";
}

function isAncestor(sha) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { env });
    return true;
  } catch (e) {
    return false;
  }
}

function adoptRemoteMain() {
  const remote = remoteHead();
  if (!remote || isAncestor(remote)) return;

  console.error("→ 远端 main 头 " + remote.slice(0, 7) + " 不在本仓历史里，先收进来");
  run(["fetch", "--no-tags", url, `refs/heads/main:${UPSTREAM}`]);

  const adopted = git([
    "commit-tree", git(["rev-parse", "HEAD^{tree}"]),
    "-p", "HEAD",
    "-p", git(["rev-parse", UPSTREAM + "^{commit}"]),
    "-m", "sync: 合并 " + repo + " main@" + remote.slice(0, 7)
  ]);
  run(["reset", "--soft", adopted]);
  console.error("→ 远端头 " + remote.slice(0, 7) + " 已成为本地 main 的祖先，两边不再分叉");
}

try {
  const shallow = git(["rev-parse", "--is-shallow-repository"]);
  if (shallow === "true") {
    console.error("→ 工作区是浅克隆，先补全历史");
    run(["fetch", "--unshallow", "origin"]);
  }

  adoptRemoteMain();

  run(["push", `--force-with-lease=refs/heads/main:${remoteHead()}`, url, "HEAD:refs/heads/main"]);
  console.error("✓ 已同步到 https://github.com/" + repo + "（main ← " + git(["rev-parse", "--short", "HEAD"]) + "）");
} catch (e) {
  console.error("");
  console.error("✗✗✗ 同步到 GitHub 失败 ✗✗✗");
  console.error("  " + repo + " —— 常见原因，按这个顺序查：");
  console.error("  1. GH_PAT 过期 / 被撤销 → GitHub 回 403");
  console.error("  2. GH_PAT 的 Repository access 没勾上 " + repo + " → 404，看着像仓库不存在");
  console.error("  3. 权限没给 Contents: Read and write → 403");
  console.error("  4. 远端 main 的当前头与推送前读到的不一致 → stale info，重跑一次");
  process.exit(1);
}
