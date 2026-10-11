#!/usr/bin/env bash
set -eu

DEST="${1:-/tmp/poem}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK="$ROOT/poem.lock.json"

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

git clone --single-branch --branch main "https://${CNB_TOKEN}@cnb.cool/${SLUG}/poem.git" "$DEST" 2>/dev/null \
  || git clone --single-branch --branch main "https://cnb.cool/${SLUG}/poem.git" "$DEST"

if [ "$REF" != "main" ]; then

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
