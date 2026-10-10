#!/usr/bin/env bash
# 上游语料的「锁」——读它、写它、验它。
#
# 这个脚本只做三件事，每件都能单独跑：
#   bash scripts/poem-lock.sh                  # 打印锁里钉的是哪一版
#   bash scripts/poem-lock.sh --ref            # 只打印 sha（给流水线拼命令用）
#   bash scripts/poem-lock.sh --verdict <sha>  # 比：锁里的 sha 与给定 sha 是什么关系
#                                              #   回 same / ahead / behind / unknown
#   bash scripts/poem-lock.sh --write <sha> [日期]   # 把锁前进到某个 sha
#
# 「键」的口径与 poem.lock.json 里那段 note 一致：见 docs/data-backend.md § 四。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK="$ROOT/poem.lock.json"

read_ref() {
  node -e 'try{process.stdout.write(String(require(process.argv[1]).ref||""))}catch(e){process.stdout.write("")}' "$LOCK"
}

case "${1:-}" in
  "" )
    REF="$(read_ref)"
    if [ -z "$REF" ]; then
      echo "锁里没有 ref —— poem.lock.json 坏了，或者还没钉过。"
      exit 1
    fi
    node -e '
      const l = require(process.argv[1]);
      console.log("上游   " + l.repo);
      console.log("钉住   " + l.ref + "  (" + (l.short || l.ref.slice(0, 8)) + ")");
      console.log("同步于 " + (l.syncedAt || "未记"));
      const c = l.counts || {};
      console.log("篇数   " + Object.keys(c).map(function (k) { return k + ":" + c[k]; }).join(" "));
    ' "$LOCK"
    ;;

  --ref )
    read_ref
    ;;

  --verdict )
    WANT="${2:-}"
    HAVE="$(read_ref)"
    if [ -z "$WANT" ] || [ -z "$HAVE" ]; then
      echo "unknown"
      exit 0
    fi
    if [ "$WANT" = "$HAVE" ]; then echo "same"; exit 0; fi
    # 谁在谁前面，得看历史，光比 sha 看不出来。取不到历史就如实回 unknown，
    # 不猜 —— 猜错的后果是「锁往后退」（把语料退回旧的一版还当成前进）。
    if git -C "$ROOT" cat-file -e "$WANT" 2>/dev/null; then
      if git -C "$ROOT" merge-base --is-ancestor "$HAVE" "$WANT" 2>/dev/null; then
        echo "ahead"    # 上游比锁新
      else
        echo "behind"   # 锁比上游新（或分了叉）
      fi
    else
      echo "unknown"
    fi
    ;;

  --write )
    SHA="${2:-}"
    DAY="${3:-$(date -u +%Y-%m-%d)}"
    if [ -z "$SHA" ]; then
      echo "用法：poem-lock.sh --write <sha> [日期]" >&2
      exit 2
    fi
    node -e '
      var fs = require("fs");
      var p = process.argv[1], sha = process.argv[2], day = process.argv[3];
      var l = JSON.parse(fs.readFileSync(p, "utf8"));
      l.ref = sha;
      l.short = sha.slice(0, 8);
      l.syncedAt = day;
      fs.writeFileSync(p, JSON.stringify(l, null, 2) + "\n");
      console.log("锁前进到 " + sha.slice(0, 8) + "（" + day + "）");
    ' "$LOCK" "$SHA" "$DAY"
    ;;

  * )
    echo "未知参数：$1（用法见本文件头）" >&2
    exit 2
    ;;
esac
