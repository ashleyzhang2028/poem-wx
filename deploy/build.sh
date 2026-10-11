#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
POEM_DIR="${POEM_DIR:-}"
IMAGE="${IMAGE:-poem-api}"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "不认识的参数：$arg" >&2; exit 2 ;;
  esac
done

if [ -z "$POEM_DIR" ]; then
  POEM_DIR="$(mktemp -d)"
  trap 'rm -rf "$POEM_DIR"' EXIT
  git clone --depth 1 -q https://cnb.cool/npu-gpu-cpu/poem.git "$POEM_DIR"
fi
[ -f "$POEM_DIR/api/handler.js" ] || { echo "✗ $POEM_DIR 里没有 api/handler.js —— 这看着不像 poem 源码" >&2; exit 2; }

REV="$(git -C "$POEM_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
CTX="$(mktemp -d)"
trap 'rm -rf "$CTX"' EXIT

mkdir -p "$CTX"
cp -R "$POEM_DIR/api" "$CTX/api"
cp "$HERE/Dockerfile" "$CTX/Dockerfile"
cp "$REPO/deploy-api-serve/serve-api.js" "$CTX/serve-api.js"
cp "$REPO/deploy/store-mysql.js" "$CTX/store-mysql.js"

mkdir -p "$CTX/shard-src"
if [ "${COPY_SHREDS:-1}" != "0" ]; then
  if [ -d "$REPO/miniprogram/data/texts" ]; then

    for f in "$REPO"/miniprogram/data/texts/*.json; do
      [ -e "$f" ] || continue
      gzip -9 -c "$f" > "$CTX/shard-src/$(basename "$f" .json).json.gz"
    done
    echo "  分片已摊进上下文：$(ls "$CTX/shard-src" | wc -l) 个文件（COPY_SHREDS=${COPY_SHREDS:-1}）"
  else
    echo "· 本机没有 miniprogram/data/texts/ —— 分片那层留空（先 npm run build:data）"
    echo "  这一步**不影响**建镜像：镜像里的 /app/shards/ 会是空的，"
    echo "  /api/shard/* 回 404 E_NO_SHARDS，与线上那份正式镜像不是一回事"
  fi
else
  echo "  跳过分片（COPY_SHREDS=0）—— 这个镜像里不会有 /app/shards/"
fi

cp "$REPO/deploy-api-serve/.dockerignore" "$CTX/.dockerignore"

echo "构建上下文： $CTX"
echo "  api/          $(du -sh "$CTX/api" | cut -f1)   ← poem $REV"
echo "  serve-api.js  $(du -sh "$CTX/serve-api.js" | cut -f1)"
echo "  合计          $(du -sh --exclude=.dockerignore "$CTX" 2>/dev/null | cut -f1 || du -sh "$CTX" | cut -f1)"
echo "  （poem 仓库根 $(du -sh --exclude=.git "$POEM_DIR" 2>/dev/null | cut -f1 || echo '?')，其中 data/ 26MB、fonts/ 11MB 不进上下文）"

if [ "$DRY_RUN" = "1" ]; then
  echo ""
  echo "（--dry-run：到此为止）"
  exit 0
fi

docker build \
  --build-arg "COPY_SHREDS=${COPY_SHREDS:-1}" \
  --build-arg "API_REV=$REV" \
  --build-arg "API_SYNCED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg "API_SOURCE=https://cnb.cool/npu-gpu-cpu/poem.git" \
  -t "$IMAGE" "$CTX"

echo ""
echo "构建完成：$IMAGE（api/ 来自 poem $REV）"
echo "试跑：docker run -p 8080:8080 \\"
echo "        -e SESSION_SECRET=\$(openssl rand -hex 32) \\"
echo "        -e MYSQL_HOST=... -e MYSQL_USER=... -e MYSQL_PASSWORD=... -e MYSQL_DATABASE=poem \\"
echo "        -e WX_APPID=... -e WX_SECRET=... $IMAGE"
