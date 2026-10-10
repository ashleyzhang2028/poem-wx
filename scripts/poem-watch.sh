#!/usr/bin/env bash
# 跟一次上游：poem 的 main 头 vs poem.lock.json 里钉的那一版。
#
# 这是**定时任务**跑的那一步（.cnb.yml 的 poem-watch），不是发布链上的一步 ——
# 发布链用锁定版，上游动了**不许**影响任何人的发布。口径见 docs/data-backend.md § 四。
#
# 四种出口，各自都有明确的意思：
#
#   same      上游没动。退出 0，什么都不做。
#   ahead     上游动了，且**我们的自检在那一版上也是绿的** → 开 PR，只改 poem.lock.json。
#   broke     上游动了，但自检在那一版上**红** → 不合并、不改锁，把自检那几句话开成 Issue 评论。
#             （这才是「上游改数据集把我们绊住」那条痛点的正面处理：它变成一条待办，
#               不再拦别人的发布。）
#   unknown   拿不到上游的头（网络 / 权限）。退出 0 但要出声 —— 「没跟成」不是「跟过了」。
#
# 依赖：git、node（build-data/check 与发布链同一条）、cnb（CNB 容器里现成有）。
# 环境变量（都在 CNB 里现成有）：
#   CNB_ROOT_SLUG   上游所属 slug（缺省 npu-gpu-cpu）
#   CNB_REPO_SLUG   本仓库（开 PR / 留评论要它）
#   POEM_WATCH_ISSUE  红的时候把结论留在哪个 Issue（缺省 111，就是这份口径的出处）
#   WATCH_DRY=1     只判断、不开 PR、不写文件（本机干跑用）
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY="${WATCH_DRY:-0}"
REPO_SLUG="${CNB_REPO_SLUG:-}"
ISSUE_NO="${POEM_WATCH_ISSUE:-111}"

# 把一段话贴到 Issue 上。没有 cnb / 没有 slug 时**出声跳过** ——
# 「没贴上去」和「贴过了」是两件事，静默跳过会让下一个人以为上游没人跟。
post_issue_comment() {
  body="$1"
  if [ -z "$REPO_SLUG" ]; then
    echo "⚠ 没有 CNB_REPO_SLUG，结论只留在本地：$body" >&2
    sed -n '1,40p' "$body" >&2 || true
    return 0
  fi
  if ! command -v cnb >/dev/null 2>&1; then
    echo "⚠ 这个环境里没有 cnb，结论没能贴到 Issue（本机干跑正是这样）" >&2
    return 0
  fi
  cnb issues post-issue-comment --repo "$REPO_SLUG" --number "$ISSUE_NO" --body-file "$body" >/dev/null \
    && echo "✓ 结论已贴到 ${REPO_SLUG}#${ISSUE_NO}" \
    || echo "✗ 贴到 Issue 失败（令牌范围不够？）—— 结论在上面的输出里"
}

# 开一个只动 poem.lock.json 的 PR。
# ⚠️ 分支名带 sha，同一个上游版本重复跑不会互相撞车；已经存在的分支会被
#    `git push` 拒掉，这里换个名字再推一次（`-<epoch>` 后缀）。
open_lock_pr() {
  body="$1"
  [ "$DRY" = "1" ] && { echo "（WATCH_DRY=1：不开 PR）报告在 $body"; return 0; }
  if [ -z "$REPO_SLUG" ] || ! command -v cnb >/dev/null 2>&1; then
    echo "⚠ 没能开 PR（缺 CNB_REPO_SLUG 或没有 cnb）—— 锁已经写在工作区里了，报告在 $body"
    return 0
  fi
  BR="auto/poem-lock-$(echo "$head_sha" | cut -c1-8)"
  git -C "$ROOT" checkout -q -B "$BR" >/dev/null 2>&1 || true
  git -C "$ROOT" add poem.lock.json
  git -C "$ROOT" -c user.name=cnb -c user.email=cnb@cnb.cool \
    commit -q -m "chore(poem): 锁前进到上游 $(echo "$head_sha" | cut -c1-8)" || true
  if ! git -C "$ROOT" push -q -u origin "$BR" 2>/dev/null; then
    BR="$BR-$(date +%s)"
    git -C "$ROOT" push -q -u origin "HEAD:$BR" 2>/dev/null || {
      echo "⚠ 推不动 $BR（令牌范围？）—— 锁在工作区里，报告在 $body"
      return 0
    }
  fi
  cnb pulls post-pull --repo "$REPO_SLUG" --base main --head "$BR" \
    --title "chore(poem): 锁前进到上游 $(echo "$head_sha" | cut -c1-8)" \
    --body-file "$body" >/dev/null \
    && echo "✓ PR 开了：$BR" \
    || echo "✗ 开 PR 失败（分支推上去了，报告在 $body）"
}

SLUG="${CNB_ROOT_SLUG:-npu-gpu-cpu}"
TMP="${TMPDIR:-/tmp}/poem-watch-$$"
trap 'rm -rf "$TMP"' EXIT

have_lock="$(bash "$ROOT/scripts/poem-lock.sh" --ref)"
echo "锁：${have_lock:-（无）}"

# 上游的头。带令牌试一次、不成就不带凭据再来（同 clone-poem.sh 那条道理：
# 带着一个不被接受的凭据，连匿名可读的仓库也会被拒）。两次都拿不到就 unknown。
head_sha=""
if upstream_out="$(git ls-remote "https://${CNB_TOKEN:-x}@cnb.cool/${SLUG}/poem.git" refs/heads/main 2>/dev/null)" \
   && [ -n "$upstream_out" ]; then
  head_sha="$(printf '%s' "$upstream_out" | awk '{print $1}' | head -1)"
fi
if [ -z "$head_sha" ]; then
  if upstream_out="$(git ls-remote "https://cnb.cool/${SLUG}/poem.git" refs/heads/main 2>/dev/null)" \
     && [ -n "$upstream_out" ]; then
    head_sha="$(printf '%s' "$upstream_out" | awk '{print $1}' | head -1)"
  fi
fi

if [ -z "$head_sha" ]; then
  echo "unknown：拿不到上游 poem 的 main（网络或权限）。这一轮没跟成。"
  exit 0
fi
echo "上游：$head_sha"

if [ "$head_sha" = "$have_lock" ]; then
  echo "same：上游没动（$(echo "$head_sha" | cut -c1-8)）"
  exit 0
fi

echo "ahead？上游动了：$(echo "$have_lock" | cut -c1-8) → $(echo "$head_sha" | cut -c1-8)"
echo "用上游这一版跑一次语料 + 自检，看锁能不能安全前进……"

# 拿上游那一版：整棵 clone 到临时目录（别动工作区 —— 这一步可能会红）
mkdir -p "$TMP"
POEM_REF="$head_sha" bash "$ROOT/scripts/clone-poem.sh" "$TMP/poem" || {
  echo "unknown：上游那一版取不下来，这一轮没跟成。"
  exit 0
}

# 在**临时工作区**里跑，不污染当前工作区：语料是构建产物，红的时候要能干净地丢掉
mkdir -p "$TMP/work"
( cd "$ROOT" && git archive HEAD ) | tar -x -C "$TMP/work"
( cd "$TMP/work" && ln -s "$TMP/poem" poem ) 2>/dev/null || true

set +e
( cd "$TMP/work" \
  && POEM_WEB_DIR="$TMP/poem" node scripts/build-data.js > "$TMP/build.log" 2>&1 \
  && node scripts/check.js > "$TMP/check.log" 2>&1 )
rc=$?
set -e

if [ "$rc" -ne 0 ]; then
  echo "broke：上游这一版**过不了这边的自检**。锁不动。"
  echo "--- check.js 的结论（最后 25 行）---"
  tail -25 "$TMP/check.log" 2>/dev/null || tail -25 "$TMP/build.log" 2>/dev/null || true
  echo "--------------------------------------"
  echo "下一步：要改的是 check.js 里那张篇数表（K.counts / seqMax / KNOWN_HOLES），"
  echo "照 docs/data-backend.md § 四 那三步来 —— 别去改上游。"
  if [ "$DRY" = "1" ]; then
    echo "（WATCH_DRY=1：不写文件、不开 Issue）"
  else
    cat > "$TMP/verdict.txt" <<VERDICT
上游 poem 的 main 动了，但这一版过不了小程序端的自检。

- 锁在：$(echo "$have_lock" | cut -c1-8)
- 上游：$(echo "$head_sha" | cut -c1-8)

这说明上游改了语料（补录 / 勘正 / 归位），而这边 check.js 里的篇数表还对着旧的那一版。
**要改的是这边的表，不是上游**：K.counts / K.seqMax / KNOWN_HOLES 三处，
照 docs/data-backend.md § 四 那三步做，改完把 poem.lock.json 前进到 $(echo "$head_sha" | cut -c1-8)。

自检原话：

\`\`\`
VERDICT
    tail -25 "$TMP/check.log" 2>/dev/null >> "$TMP/verdict.txt" || true
    echo '```' >> "$TMP/verdict.txt"
    post_issue_comment "$TMP/verdict.txt"
  fi
  exit 0
fi

echo "自检绿：锁可以前进。"
tail -4 "$TMP/check.log" 2>/dev/null || true

if [ "$DRY" = "1" ]; then
  echo "（WATCH_DRY=1：不写文件、不开 PR）"
  exit 0
fi

bash "$ROOT/scripts/poem-lock.sh" --write "$head_sha" "$(date -u +%Y-%m-%d)"
cat > "$TMP/verdict.txt" <<VERDICT
上游 poem 的 main 动了，这一版**过得了**小程序端的自检，锁可以前进。

- 锁从：$(echo "$have_lock" | cut -c1-8)
- 锁到：$(echo "$head_sha" | cut -c1-8)

这个 PR **只动 poem.lock.json 一个文件** —— 语料是构建产物，不进库；
推 main 时按锁里这一版编译。口径见 \`docs/data-backend.md\` § 四。

自检在这一版上通过了，语料读数（\`build-data.js\`）：

\`\`\`
VERDICT
grep -E "索引 |课内正文 |正文分片 |读音表 |全文倒排" "$TMP/build.log" >> "$TMP/verdict.txt" 2>/dev/null || true
echo '```' >> "$TMP/verdict.txt"
open_lock_pr "$TMP/verdict.txt"
