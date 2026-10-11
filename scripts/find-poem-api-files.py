"""检查上下文里的 api/ 有没有 poem 运行时真的要的那些文件。

用法：python3 scripts/find-poem-api-files.py <上下文里的 api/ 目录>

清单只有两个来源：入口 `handler.js` 静态 require 到的那几个，加上
`api/_lib/routes.js` 那张 ROUTES 表里逐条指向的 `api/_routes/…`。
`_routes/` 里每条自己的依赖都落在 `_lib/`，入口那一遍已经覆盖 ——
语料 / 字体 / 前端一样不要。

⚠️ 判据不能是「扫一遍上下文里有什么」：漏文件时它只会少列几个名字，
照样报「都在」—— 那正是 Issue #134 那个形态（构建绿、部署绿、容器起来才炸）。
所以清单从 poem 的代码里读，不从这里有什么读。
"""

import os
import re
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ctx/api"

REQUIRE = re.compile(r'require\(\s*["\'](\.[^"\']+)["\']\s*\)')
ROUTE_REF = re.compile(r'"(\.[^"]+\.js)"')


def norm(base_rel):
    return base_rel.replace(os.sep, "/").lstrip("./")


def main():
    entry = os.path.join(ROOT, "handler.js")
    if not os.path.isfile(entry):
        sys.stderr.write("✗ %s 里没有 handler.js —— 入口都不在，别往下走\n" % ROOT)
        return 1

    routes_file = os.path.join(ROOT, "_lib", "routes.js")
    if not os.path.isfile(routes_file):
        sys.stderr.write("✗ %s 里没有 _lib/routes.js —— 路由表就是清单本身，读不到就判不了\n" % ROOT)
        return 1

    need = set(["handler.js", "_lib/routes.js", "_lib/http.js"])

    routes_src = open(routes_file, encoding="utf-8").read()
    for rel in ROUTE_REF.findall(routes_src):
        need.add(norm(os.path.normpath(os.path.join("_lib", rel))))

    for rel in REQUIRE.findall(open(entry, encoding="utf-8").read()):
        need.add(norm(os.path.normpath(rel)))

    missing = sorted(p for p in need if not os.path.isfile(os.path.join(ROOT, p)))
    if missing:
        sys.stderr.write(
            "✗ 上下文里的 api/ 缺这几样：" + repr(missing) + "\n"
            "  镜像里就会缺它们，容器一被调到就是 MODULE_NOT_FOUND ——\n"
            "  而构建与部署都是绿的（Issue #134）。改 deploy-api-serve/.dockerignore 的 api/ 那几条。\n")
        return 1

    print("  api/ 下清单里的 %d 个文件都在上下文里" % len(need))
    return 0


if __name__ == "__main__":
    sys.exit(main())
