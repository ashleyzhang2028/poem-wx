#!/usr/bin/env bash
# 把 poem 的 api/ 同步进 deploy/（Issue #71 B 方案的固定动作）。
#
# 为什么需要它：云托管按**本仓库**取容器目录，而后端代码在**另一个仓库**（poem）
# 里。云托管不会给构建容器凭据去 clone 别人的仓库 —— 所以 API 代码必须是
# 「已经躺在部署上下文里」的。这个脚本负责把它躺进去。
#
# 用法：
#   bash deploy/sync-api.sh                       # 从 CNB clone 最新的 poem
#   POEM_DIR=/path/to/poem bash deploy/sync-api.sh # 用本地已 clone 的
#   bash deploy/sync-api.sh --check               # 只对账，不改文件（CI 用）
#
# ⚠️ 这是**唯一**一处「同一份代码存在两份」的地方，也是这份方案的税前代价：
#    poem 里改了 api/ 而不跑这个脚本，线上就是旧代码。所以 --check 会拿
#    poem 的 HEAD 与 deploy/api.synced 里记的那个 sha 对，对不上就红。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$HERE/api.synced"
CHECK=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    *) echo "不认识的参数：$arg" >&2; exit 2 ;;
  esac
done

POEM_DIR="${POEM_DIR:-}"
CLEANUP=0
if [ -z "$POEM_DIR" ]; then
  POEM_DIR="$(mktemp -d)"
  CLEANUP=1
  trap 'rm -rf "$POEM_DIR"' EXIT
  git clone --depth 1 -q https://cnb.cool/npu-gpu-cpu/poem.git "$POEM_DIR"
fi

[ -f "$POEM_DIR/api/handler.js" ] || { echo "✗ $POEM_DIR 里没有 api/handler.js —— 这看着不像 poem 源码" >&2; exit 2; }

SHA="$(git -C "$POEM_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
WHEN="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ "$CHECK" = "1" ]; then
  if [ ! -f "$STAMP" ]; then
    echo "✗ 没有 deploy/api.synced —— 从没同步过 api/。跑一次：bash deploy/sync-api.sh" >&2
    exit 1
  fi
  OLD="$(grep -E '^commit=' "$STAMP" | cut -d= -f2- || true)"
  if [ "$OLD" != "$SHA" ]; then
    echo "✗ deploy/api/ 落后了：" >&2
    echo "    deploy/api.synced 记的是 $OLD" >&2
    echo "    poem 现在的 HEAD 是     $SHA" >&2
    echo "  跑一次：bash deploy/sync-api.sh" >&2
    exit 1
  fi
  echo "✓ deploy/api/ 与 poem $SHA 同步"
  exit 0
fi

rm -rf "$HERE/api"
cp -R "$POEM_DIR/api" "$HERE/api"
# 记下来源：Dockerfile 的 build-arg 与 CI 的对账都读它
cat > "$STAMP" <<EOF
# 这一份是给 deploy/Dockerfile 用的构建上下文，由 sync-api.sh 生成，**别手改**。
# 改后端的唯一入口是 poem 仓库；这里只跟着走。
commit=$SHA
synced_at=$WHEN
source=https://cnb.cool/npu-gpu-cpu/poem.git
EOF

echo "✓ api/ 已同步到 deploy/api"
echo "  commit   $SHA"
echo "  时间     $WHEN"
echo "  体积     $(du -sh "$HERE/api" | cut -f1)（$(find "$HERE/api" -type f | wc -l | tr -d ' ') 个文件）"
EOF
chmod +x deploy/sync-api.sh && echo ok
