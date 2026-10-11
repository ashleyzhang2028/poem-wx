#!/usr/bin/env bash
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
