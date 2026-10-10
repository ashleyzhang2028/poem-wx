#!/usr/bin/env bash
# 取 poem 源码到 $1（默认 /tmp/poem），并**检出 poem.lock.json 里钉的那一版**。
#
# 两件事：
#   1. clone（带令牌试一次、不成就不带凭据再来）—— 流水线里的令牌范围跟触发事件走，
#      未必覆盖第二个仓库；而带着一个不被接受的凭据去 clone，连匿名可读的仓库也会
#      被拒成 `Repository Not Found.`（看着像路径写错）。
#   2. **检出锁定的 commit** —— 不钉住上游，`build-data.js` 打出来的篇数就会跟着
#      poem 的 main 漂，而这边 check.js 的篇数表是死的，于是「上游补录一条 →
#      我们推 main 时自检红」。根因与治法见 docs/data-backend.md § 四。
#
# 用法：
#   bash scripts/clone-poem.sh [DEST]              # 用 poem.lock.json 里那一版
#   POEM_REF=<sha> bash scripts/clone-poem.sh [DEST]   # 用人给的这一版（跟踪上游时用）
#   POEM_REF=main  bash scripts/clone-poem.sh [DEST]   # 跟上游的头（只给看门狗用，别在发布链上）
set -eu

DEST="${1:-/tmp/poem}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK="$ROOT/poem.lock.json"

# 锁定值：环境变量优先，其次读锁文件。读不到就退回 main —— 但那一步要出声，
# 「没钉住」和「钉住了」是两件事，不许静默。
if [ -n "${POEM_REF:-}" ]; then
  REF="$POEM_REF"
else
  REF="$(node -e 'try{process.stdout.write(String(require(process.argv[1]).ref||""))}catch(e){}' "$LOCK" 2>/dev/null || true)"
  if [ -z "$REF" ]; then
    REF="main"
    echo "⚠ 读不到 poem.lock.json 里的 ref，退回 poem 的 main —— 这一次构建没钉住上游" >&2
  fi
fi

SLUG="${CNB_ROOT_SLUG:-npu-gpu-cpu}"

# 全量 clone 而不是 --depth 1：锁定的是一个**可能不在 main 头上**的 commit，
# 浅克隆下来那个对象可能压根没有，checkout 会回 `reference is not a tree`。
# 这个仓库不大（语料 26MB + 字体 11MB），全量比「出这种错再改回来」便宜。
# 只取那一个分支，别把 80 多个分支一起拖下来。
git clone --single-branch --branch main "https://${CNB_TOKEN}@cnb.cool/${SLUG}/poem.git" "$DEST" 2>/dev/null \
  || git clone --single-branch --branch main "https://cnb.cool/${SLUG}/poem.git" "$DEST"

if [ "$REF" != "main" ]; then
  # 锁里那个 commit 可能是**上游 main 上更早的一版**（我们落后了），
  # 也可能是**比 main 还新的**（只在我们本地试过）。两种都得能取到：
  # 先试着直接 checkout；不行就把 main 的历史拉全了再试一次。
  if ! git -C "$DEST" checkout --quiet "$REF" 2>/dev/null; then
    git -C "$DEST" fetch --quiet origin main || true
    git -C "$DEST" checkout --quiet "$REF" 2>/dev/null || {
      echo "✗ poem 里没有 ${REF} 这一版（网络不通，或者 sha 写错了）" >&2
      exit 1
    }
  fi
fi

HEAD_SHA="$(git -C "$DEST" rev-parse HEAD)"
echo "poem $(git -C "$DEST" log -1 --format='%h %s' | cut -c1-72)"
if [ "$REF" != "main" ] && [ "$HEAD_SHA" != "$REF" ]; then
  echo "⚠ 要的是 ${REF:0:8}，拿到的却是 ${HEAD_SHA:0:8} —— 锁没生效，别继续跑" >&2
  exit 1
fi
