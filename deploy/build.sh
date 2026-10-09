#!/usr/bin/env bash
# 从 poem 源码构建「只跑 /api/」的云托管镜像（Issue #71 的 B 方案）。
#
# 用法：
#   POEM_DIR=/path/to/poem bash deploy/build.sh                 # 瘦身（默认）
#   POEM_DIR=/path/to/poem bash deploy/build.sh --with-corpus   # 带上 data/ 语料
#   POEM_DIR=/path/to/poem bash deploy/build.sh --dry-run       # 只报体积，不构建
#
# 做三件事：在 poem 源码里摊开一份构建上下文 → 报体积 → docker build。
#
# ⚠️ 为什么要摊开而不是在 poem 仓库里就地构建：`.dockerignore` 是**按构建上下文
#    根**生效的，而这里的白名单要挡掉 poem 自己的 data/ 与 fonts/ —— 就地构建
#    得往用户仓库根塞一个 .dockerignore，那是改人家的仓库形状。
#    所以拷到临时目录里再build，poem 源码一个字节都不动。
set -euo pipefail

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

if [ -z "$POEM_DIR" ]; then
  echo "要指 poem 源码：POEM_DIR=/path/to/poem bash deploy/build.sh" >&2
  echo "（本机没有就 git clone --depth 1 https://cnb.cool/npu-gpu-cpu/poem.git /tmp/poem）" >&2
  exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"

for f in api/handler.js api/_lib/core.js api/_lib/routes.js package.json; do
  [ -f "$POEM_DIR/$f" ] || { echo "✗ $POEM_DIR 里没有 $f —— 这看着不像 poem 源码" >&2; exit 2; }
done

CTX="$HERE/.build"
rm -rf "$CTX"
mkdir -p "$CTX"
# 只在真构建后清掉；--dry-run 留着，因为「看一眼上下文里到底有什么」正是它的用处
if [ "$DRY_RUN" != "1" ]; then
  trap 'rm -rf "$CTX"' EXIT
fi

cp "$POEM_DIR/package.json" "$POEM_DIR/package-lock.json" "$CTX/"
cp -R "$POEM_DIR/api" "$CTX/api"
cp "$HERE/serve-api.js" "$CTX/serve-api.js"
cp "$HERE/Dockerfile.api" "$CTX/Dockerfile"
cp "$HERE/dockerignore.api" "$CTX/.dockerignore"

if [ "$WITH_CORPUS" = "1" ]; then
  # 只有 /api/game/* 与 /api/exam/* 需要它（网页版的游戏与考试）。
  # 小程序端两条都不打，所以默认不带 —— 带上就是 26MB 语料每次部署传一遍。
  #
  # ⚠️ 给数据放行要**同时**改两处，少一处就是「文件在上下文里但 COPY 没拷进去」
  #    或反过来（COPY 了但白名单挡着，构建时报 no source files）：
  #      1) 白名单：把 `!data` 与 `!data/**` 加进 .dockerignore
  #      2) Dockerfile：加一行 `COPY data ./data`
  cp -R "$POEM_DIR/data" "$CTX/data"
  printf '\n# --with-corpus：语料也放行\n!data\n!data/**\n' >> "$CTX/.dockerignore"
  printf 'COPY --chown=node:node data ./data\n' >> "$CTX/Dockerfile"
fi

REAL="$(cd "$POEM_DIR" && du -sh --exclude=.git . | cut -f1)"
SLIM="$(du -sh "$CTX" | cut -f1)"
echo "poem 源码（不含 .git）： $REAL"
echo "本次构建上下文：        $SLIM"
echo "  ├─ api/        $(du -sh "$CTX/api" | cut -f1)"
if [ "$WITH_CORPUS" = "1" ]; then
  echo "  ├─ data/       $(du -sh "$CTX/data" | cut -f1)   ← --with-corpus"
fi
echo "  └─ 其余        依赖清单 + serve-api.js + Dockerfile"

if [ "$DRY_RUN" = "1" ]; then
  echo ""
  echo "（--dry-run：到此为止。上下文留在 $CTX，可以进去看；"
  echo "  真构建（去掉 --dry-run）之后它会被自动清掉）"
  exit 0
fi

echo ""
docker build -t "$IMAGE" "$CTX"
echo ""
echo "构建完成：$IMAGE"
echo "试跑：docker run -p 8080:8080 \\"
echo "        -e SESSION_SECRET=\$(openssl rand -hex 32) \\"
echo "        -e SUPABASE_URL=... -e SUPABASE_SERVICE_KEY=... \\"
echo "        $IMAGE"
