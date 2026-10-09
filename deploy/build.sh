#!/usr/bin/env bash
# 构建「只跑 /api/*」的云托管镜像（Issue #71 的 B 方案）。
#
# 用法：
#   bash deploy/build.sh                 # 就地构建 deploy/（先确保 api/ 是新的）
#   POEM_DIR=/tmp/poem bash deploy/build.sh   # 先从 poem 同步 api/，再构建
#   bash deploy/build.sh --with-corpus   # 把 data/ 也带上（见文末的代价）
#   bash deploy/build.sh --dry-run       # 只报体积，不构建
#
# ⚠️ 云托管那边不会跑这个脚本 —— 它读 deploy/Dockerfile + 容器目录 deploy/，
#    用的是**已经躺在 deploy/api 里的**那份代码。所以这个脚本在部署链上的作用
#    只有一个：确认 api/ 是新的（--check），别把旧代码推上去。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
POEM_DIR="${POEM_DIR:-}"
IMAGE="${IMAGE:-poem-api}"
WITH_CORPUS=0
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --with-corpus) WITH_CORPUS=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "不认识的参数：$arg" >&2; exit 2 ;;
  esac
done

# 有 POEM_DIR 就先同步一次，保证「构建的就是 poem 最新的 api/」
if [ -n "$POEM_DIR" ]; then
  POEM_DIR="$POEM_DIR" bash "$HERE/sync-api.sh"
elif [ ! -f "$HERE/api/handler.js" ]; then
  echo "✗ deploy/api/ 不存在。先跑一次：bash deploy/sync-api.sh" >&2
  exit 2
fi

REV="unknown"
[ -f "$HERE/api.synced" ] && REV="$(grep -E '^commit=' "$HERE/api.synced" | cut -d= -f2- || echo unknown)"
WHEN="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "构建上下文： $HERE"
echo "  api/       $(du -sh "$HERE/api" | cut -f1)   ← poem $REV"

if [ "$WITH_CORPUS" = "1" ]; then
  echo ""
  echo "⚠️ --with-corpus 现在**不支援**：语料在 poem 的 data/ 里，而这份部署上下文"
  echo "   只放 api/。要语料就把语料的**来源仓库**换掉（用 poem 根那份 Dockerfile），"
  echo "   或在 deploy/ 下另建一份带 data/ 的上下文。别在这儿用通配符糊过去 ——"
  echo "   那会变成「文件看着在、COPY 没拷进去」。"
  exit 2
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "  serve-api.js + Dockerfile + .dockerignore"
  echo ""
  echo "（--dry-run：到此为止）"
  exit 0
fi

docker build \
  --build-arg "API_REV=$REV" \
  --build-arg "API_SYNCED_AT=$WHEN" \
  --build-arg "API_SOURCE=https://cnb.cool/npu-gpu-cpu/poem.git" \
  -t "$IMAGE" "$HERE"

echo ""
echo "构建完成：$IMAGE（api/ 来自 poem $REV）"
echo "试跑：docker run -p 8080:8080 \\"
echo "        -e SESSION_SECRET=\$(openssl rand -hex 32) \\"
echo "        -e SUPABASE_URL=... -e SUPABASE_SERVICE_KEY=... \\"
echo "        $IMAGE"
