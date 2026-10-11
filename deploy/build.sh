#!/usr/bin/env bash
# 本机构建「只跑 /api/*」的云托管镜像（Issue #71）。
#
# 用法：
#   POEM_DIR=/tmp/poem bash deploy/build.sh              # 摊上下文 + 真构建
#   POEM_DIR=/tmp/poem bash deploy/build.sh --dry-run    # 只报上下文与体积，不构建
#   IMAGE=my/api bash deploy/build.sh                    # 换镜像名
#
# ⚠️ **部署链上不跑这个脚本。** 线上是 CNB 流水线按 `deploy/Dockerfile` 直接
#    构建（源码上下文 = poem 仓库，见 README「流水线怎么构建」）。这一份是给
#    本机看一眼用的：摊出上下文、量一量体积、确认 COPY 落得到文件。
#
# ⚠️ 它**不复制 api/**。上下文就是从 poem 那边摊的 —— 中间落一份副本，
#    就是「改完 poem 忘了同步」那个税的来源。
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

# 摊上下文：poem 的 api/ + 本仓库的 Dockerfile、服务壳、存储层实现。
# 几样都必须落在**平铺的一层**里，因为 Dockerfile 是按 ./api、./serve-api.js、
# ./store-mysql.js 拷的。
mkdir -p "$CTX"
cp -R "$POEM_DIR/api" "$CTX/api"
cp "$HERE/Dockerfile" "$CTX/Dockerfile"
cp "$REPO/deploy-api-serve/serve-api.js" "$CTX/serve-api.js"
cp "$REPO/deploy/store-mysql.js" "$CTX/store-mysql.js"
# ⚠️ shard-src/ **每次都摊**（内容按 COPY_SHREDS 决定）。Dockerfile 那句
#    `COPY shard-src /tmp/shard-src` 是无条件的，上下文里没有这一层就红在 COPY 上
#    （Issue #115：`failed to calculate checksum ... "/shard-src": not found`）。
#    空目录是 COPY 的合法来源，所以这里先 mkdir，再多一层判断：
#      · 默认（没设 COPY_SHREDS）→ **摊**：拿 miniprogram/data/texts/*.json 现压 gz
#      · COPY_SHREDS=0            → 空着，本地得到一个不带分片的瘦镜像
#    默认摊而不是默认空，理由与流水线那份一样：线上正式版要发的就是课外正文
#    （见 deploy/README.md）。本机没有语料时就跳过并说明，不假装摊过了。
mkdir -p "$CTX/shard-src"
if [ "${COPY_SHREDS:-1}" != "0" ]; then
  if [ -d "$REPO/miniprogram/data/texts" ]; then
    # 只摊 gz、且名字是 t001.json.gz —— shard-api.js 发预压缩那份时找的正是它
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
# .dockerignore 放到上下文根（那是它生效的位置）
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
