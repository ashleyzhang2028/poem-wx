#!/usr/bin/env bash
# 取 poem 源码到 $1（默认 /tmp/poem）。
#
# 带令牌试一次、不成就不带凭据再来：流水线里的令牌范围跟触发事件走，未必覆盖第二个
# 仓库；而带着一个不被接受的凭据去 clone，连匿名可读的仓库也会被拒成
# `Repository Not Found.`（看着像路径写错）。
set -eu
DEST="${1:-/tmp/poem}"
git clone --depth 1 "https://${CNB_TOKEN}@cnb.cool/${CNB_ROOT_SLUG}/poem.git" "$DEST" 2>/dev/null \
  || git clone --depth 1 "https://cnb.cool/${CNB_ROOT_SLUG}/poem.git" "$DEST"
