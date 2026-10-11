# 云托管后端：只跑 API 的那一份

部署描述。**后端代码不在这个仓库里** —— 它在
[`npu-gpu-cpu/poem`](https://cnb.cool/npu-gpu-cpu/poem) 的 `api/`。

| 文件 | 干什么 |
|---|---|
| `Dockerfile` | 只拷 `api/` 的运行时镜像，端口 8080；里面装一个 `mysql2`；默认再拷一份正文分片（`COPY_SHREDS=0` 才不拷） |
| `store-mysql.js` | **服务端存储层的 MySQL 实现**（Issue #111）：那组 `getX/putX` 的另一种落地 |
| `sql/mysql-schema.sql` | 建表语句（全部表，幂等）。⚠️ 它建的是**表**，落点那个**库要自己建**（`CREATE DATABASE \`poem\``），且执行前要 `USE \`poem\`;` —— 见 [`../docs/wx-cloud-setup.md`](../docs/wx-cloud-setup.md) § 3.1 / § 四 |
| `build.sh` | 本机构建 + 报体积（**部署链上不跑它**） |
| `../deploy-api-serve/` | 只挂 `/api/*` 的服务壳 + 白名单（构建时摆进上下文） |
| `../scripts/find-poem-api-files.py` | 按 `api/_lib/routes.js` 那张表核一遍上下文里的 `api/`（**部署链上跑，拦在 build 之前**） |

## 存储层：为什么这份实现放在这儿

后端代码在 `poem`，但「用哪台数据库」是**这份部署**的选择 ——
`poem` 同时伺服网页版（跑在 Vercel 上、用它自己的那台库），
小程序这份镜像只是同一套 `api/` 的另一个部署。两边分开，`poem` 一行都不用动。

接线在 `serve-api.js`（这份镜像的入口）：它在 require poem 的 handler **之前**
把 `store.getStore()` 换成「认 `MYSQL_HOST` 就用 MySQL，否则退回原样」。
poem 的 `store.js` 是模块级单例，所以替换之后要 `_reset()` 一次 —— 这两步
（先接、后 require）的顺序写在自检里（V49），挪了会红。

换库要动的地方、那条「新的赢」不变式为什么必须留在数据库层，
见 [`../docs/data-backend.md`](../docs/data-backend.md) § 二、§ 三。

## 云托管那几栏

推一版 `main` 触发流水线把镜像构建出来（CNB + GHCR 各一份），再去控制台建服务。

| 字段 | 填什么 |
|---|---|
| 部署方式 | **镜像** |
| 镜像地址 | `ghcr.io/ashleyzhang2028/poem-wx/wx-api:<poem 短 sha>`（**公开包，不用凭据**；CNB 槽位是备用，见下） |
| 端口 | `8080` |
| 环境变量 | `SESSION_SECRET` / `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` / `WX_APPID` / `WX_SECRET` |
| 镜像拉取凭据 | 填 ghcr.io 那份就不用配。走 CNB 槽位才要：用户名 `cnb`、密码一枚 CNB 访问令牌 |

镜像拉取凭据填在**镜像地址那一屏**，不是环境变量 —— 环境变量给容器里的进程用，
凭据给平台拉镜像用。见 [`../docs/wx-cloud-setup.md`](../docs/wx-cloud-setup.md) § 2.5。

探活打 `/healthz`（回 `ok`）—— 这份镜像没有静态站，`/` 就是 404。

**别选「部署方式 = 代码仓库」**：它按被部署仓库的根找 Dockerfile，而本仓库根上没有 `api/`。
要人做的全部动作见 [`../docs/wx-cloud-setup.md`](../docs/wx-cloud-setup.md)。

镜像槽位按**本仓库**的 slug，即使源码来自 `poem` —— 流水线在这儿跑。
写成 `poem/xxx` 云托管就拉不到。

## 两份镜像地址（Issue #71）

流水线一次出**两份**，同一棵树，功能没差别，差别在「谁拉得动」与「tag 是谁的 sha」：

| | 地址 | 可见性 | tag |
|---|---|---|---|
| GHCR（**云托管填这份**） | `ghcr.io/ashleyzhang2028/poem-wx/wx-api` | 公开包 | 上游 **poem** 的短 sha |
| CNB 制品库（备用 / 回滚） | `docker.cnb.cool/npu-gpu-cpu/poem-wechat-mini-program/wx-api` | 私有 | **本仓库**的短 sha |

为什么要有 GHCR 那份：CNB 的 Docker 制品库可见性**跟着代码仓库走**，
本仓库是 Private → 制品私有 → 云托管「从地址拉镜像」那一栏拉不动，
要么配凭据（§ 2.5），要么把整个仓库改 public。
多推一份到 GHCR 是第三条路：公开包，不用凭据，也不用公开代码仓库。

⚠️ **`GHCR_TOKEN` 必须是 classic PAT，fine-grained 建不出来。** GitHub 官方文档原话：
*GitHub Packages only supports authentication using a personal access token (classic)*。
所以 fine-grained token 的 Permissions 里**根本没有 Packages 那一栏** ——
`write:packages` 只存在于 classic 的老式 scope。

| 用途 | 密钥名 | 该用哪种 token | 该有的权限 |
|---|---|---|---|
| 推 `ghcr.io` 镜像 | `GHCR_USER` / `GHCR_TOKEN` | **classic** | `write:packages`（[直接建这个 scope](https://github.com/settings/tokens/new?scopes=write:packages)） |
| 同步代码到 `poem-wx` | `GH_PAT` | fine-grained | `Contents: Read and write` |

推 GHCR 时**用户名是 GitHub 账号名**（CNB 那边写死是 `cnb`）。两个 token 别互相顶替：
`contents` 与 `packages` 在两个体系里分开。

## 流水线怎么构建

`poem` 的 `api/` + 本仓库的 `deploy/Dockerfile` 与 `deploy-api-serve/`，
平铺进同一层临时目录再 `docker build`（Dockerfile 按 `./api` 与 `./serve-api.js` 拷）。
见 `.cnb.yml` 的「发布（自检 → 镜像 → 体验版）」—— 推 `main` 触发，镜像 tag 是
本仓库这一版的短 sha（`${CNB_COMMIT_SHORT}`），不是分支名。

⚠️ **`api/` 是整棵拷的，但只剩白名单放行的那几条。** 白名单写错时「构建绿、部署绿、
容器起来才报 `Cannot find module`」（Issue #134）—— 所以 build & push 那步在
`docker build` **之前**先跑 `scripts/find-poem-api-files.py`：清单从 `api/_lib/routes.js`
的 ROUTES 表里读（不是扫一遍上下文里有什么 —— 那种写法在漏文件时照样报「都在」），
缺一个当场退出。

镜像名用 `${CNB_REPO_SLUG_LOWERCASE}`（本仓库）。**别写成 `${CNB_ROOT_SLUG}`** ——
那个变量在流水线里指被 clone 的 `poem`。

## 正文分片（Issue #121 方案 A）

分片跟主包一起走这个容器下发 —— **仍然免备案**。开关是构建参数 `COPY_SHREDS`：

| | 不写（**默认**） | `COPY_SHREDS=0` |
|---|---|---|
| 上下文里 | `shard-src/*.json.gz`（**只摊压缩后那份**，5.6MB） | 空目录（`shard-src/` 本身仍在，见下） |
| 镜像里 | `/app/shards/`（5.6MB） | 没有 `/app/shards/` |
| `/api/shard/*` | 200 + `Content-Encoding: gzip`（每片约 44KB） | `404 E_NO_SHARDS` |

⚠️ **默认是「有」。** 正式版要发的就是课外正文，不带分片的镜像是给本地调试的。
两档的语义要分清：`COPY_SHREDS` **没定义** → 走默认；`COPY_SHREDS: "0"` → 显式关。
写成空串（`""`）是第三档，别用 —— 那既不是「没定义」也不是「明确不要」。

四件事一起改才算接上，缺一样都是**不报错地坏**：

1. `deploy-api-serve/shard-api.js` —— 路由本体（名字白名单 + gzip 下发）
2. `deploy/Dockerfile` 里 `COPY --chown=node:node shard-api.js ./` —— 把它从
   上下文根拷进 `/app`。**放行 ≠ 进镜像**：少了这条 COPY 时上下文里有它、
   构建与部署都是绿的，容器起来才 `Cannot find module './shard-api.js'`
   （Issue #134）。它是 `serve-api.js` 启动期 require 的，与 `store-mysql.js`
   一样得有一条自己的 COPY —— 另两句 COPY 不会顺手把它带上。
3. `.cnb.yml` 的 stage context 里 `cp deploy-api-serve/shard-api.js /tmp/ctx/`，
   以及 `if [ "${COPY_SHREDS:-1}" != "0" ]` 那段摊分片（**默认就摊**）
4. `deploy-api-serve/.dockerignore` 放行 `!shard-api.js` 与 `!shard-src/**`
   —— 白名单那一行少了，构建与部署照样绿，而容器起不来（Issue #115）。

`.cnb.yml` 的 build & push 在 build 前逐条断上面 2 / 3 / 4（缺了当场退出）；
`scripts/check.js` V53 逐条守着上面四点 + 客户端那一半；
`scripts/e2e-mysql.js` 也摊一遍上下文（它曾经因为少摊 `shard-api.js` 而炸过）。

**为什么分片只摊 gzip 那份**：上下文里 5.6MB vs 25MB。容器发的就是这些字节，
一个都不用解 —— 见 `shard-api.js` 的 `gzipped()`。

**为什么默认不摊**：绝大多数调试构建用不到分片，带上只会让每次部署多传 5.6MB。
不用做任何事就是带分片的。要瘦镜像才在 `.cnb.yml` 的 `env:` 加 `COPY_SHREDS: "0"`（字面量，别写 `${…:-…}`）。

账（体积 / 流量 / 实例 / 与 CDN 的对比）见 [`../docs/shard-delivery.md`](../docs/shard-delivery.md)。

## 瘦身省了什么

构建上下文 ≈300KB。挡在外面的是「每次部署都要上传、运行时一次都不读」的东西：

| 挡在构建上下文外 | 体积 | 谁在用 |
|---|---|---|
| `data/` | 26 MB | 只有 `/api/game/*`、`/api/exam/*` —— 小程序一条都不打 |
| `fonts/` | 11 MB | 网页版字体 |
| `js/`、页面目录、`css/`、`icons/` | ~2.5 MB | 浏览器 |
| `.git` | 22 MB | 谁都不用 |

⚠️ 代价一条：砍掉 `data/` 与 `js/` 之后，`/api/game/answer`、`/api/exam/records`
会回 500（`api/_lib/game.js` 里 `require(ROOT + "/js/quiz.js")` 加载不到）。
小程序两条都不打，所以默认这样。真要语料，用 `poem` 仓库根那份全量 `Dockerfile` 更省事。

## 本机怎么构建

```bash
git clone --depth 1 https://cnb.cool/npu-gpu-cpu/poem.git /tmp/poem
POEM_DIR=/tmp/poem bash deploy/build.sh            # 构建并报体积
POEM_DIR=/tmp/poem bash deploy/build.sh --dry-run  # 只看上下文，不构建
```
