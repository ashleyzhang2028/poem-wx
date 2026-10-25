# 云托管后端：只跑 API 的那一份

部署描述。后端代码在**本仓库根的 `api/`**（登录 / 同步 / 管理那几条路由）。

| 文件 | 干什么 |
|---|---|
| `Dockerfile` | 只拷 `api/` 的运行时镜像，端口 8080；里面装一个 `mysql2` |
| `store-mysql.js` | **服务端存储层的 MySQL 实现**（Issue #111）：那组 `getX/putX` 的另一种落地 |
| `sql/mysql-schema.sql` | 建表语句（全部表，幂等）。⚠️ 它建的是**表**，落点那个**库要自己建**（`CREATE DATABASE \`poem\``），且执行前要 `USE \`poem\`;` —— 见 [`../docs/wx-cloud-setup.md`](../docs/wx-cloud-setup.md) § 3.1 / § 四 |
| `build.sh` | 本机构建 + 报体积（**部署链上不跑它**） |
| `../deploy-api-serve/` | 只挂 `/api/*` 的服务壳 + 白名单（构建时摆进上下文） |
| `../api/` | 后端运行时契约（本仓库根的 `api/`，构建时整棵拷进上下文） |

## 存储层：为什么这份实现放在这儿

`api/_lib/store.js` 是一组 `getX / putX` 的**契约**，两种落地：内存档与 MySQL 档。
线上要的是 MySQL，而接线不该长在路由里 —— 所以放在这份部署的入口上。

接线在 `serve-api.js`（这份镜像的入口）：它在 require `api/handler.js` **之前**
把 `store.getStore()` 换成「认 `MYSQL_HOST` 就用 MySQL，否则退回原样」。
`store.js` 是模块级单例，所以替换之后要 `_reset()` 一次 —— 这两步
（先接、后 require）的顺序写在自检里（V49），挪了会红。

换库要动的地方、那条「新的赢」不变式为什么必须留在数据库层，
见 [`../docs/data-backend.md`](../docs/data-backend.md) § 二、§ 三。

## 云托管那几栏

推一版 `main` 触发流水线把镜像构建出来（CNB + GHCR 各一份），再去控制台建服务。

| 字段 | 填什么 |
|---|---|
| 部署方式 | **镜像** |
| 镜像地址 | `ghcr.io/ashleyzhang2028/poem-wx/wx-api:<本仓库短 sha>`（**公开包，不用凭据**；CNB 槽位是备用，见下） |
| 端口 | `8080` |
| 环境变量 | `SESSION_SECRET` / `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` / `WX_APPID` / `WX_SECRET` |
| 镜像拉取凭据 | 填 ghcr.io 那份就不用配。走 CNB 槽位才要：用户名 `cnb`、密码一枚 CNB 访问令牌 |

镜像拉取凭据填在**镜像地址那一屏**，不是环境变量 —— 环境变量给容器里的进程用，
凭据给平台拉镜像用。见 [`../docs/wx-cloud-setup.md`](../docs/wx-cloud-setup.md) § 2.5。

探活打 `/healthz`（回 `ok`）—— 这份镜像没有静态站，`/` 就是 404。

`/healthz` 只判进程活着。要看**这一版镜像里有哪些接口**，打 `GET /api/count`：
回 `ok` 加一张 `/…` 开头的清单（就是 `api/_lib/routes.js` 上 ROUTES 表那几条）。
同名路径在控制台模板里也有一个（回 `{"E_404":"没有这个接口。"}`），
那个是模板的占位接口 —— 认清单不认名字。

**别选「部署方式 = 代码仓库」**：那份镜像不是按 `Dockerfile` 在原地构建的，
它是流水线摊好的上下文构建出来的（白名单只放行启动期要的那几样）。
要人做的全部动作见 [`../docs/wx-cloud-setup.md`](../docs/wx-cloud-setup.md)。

镜像槽位按**本仓库**的 slug。

## 两份镜像地址（Issue #71）

流水线一次出**两份**，同一棵树，功能没差别，差别在「谁拉得动」与「tag 是谁的 sha」：

| | 地址 | 可见性 | tag |
|---|---|---|---|
| GHCR（**云托管填这份**） | `ghcr.io/ashleyzhang2028/poem-wx/wx-api` | 公开包 | **本仓库**的短 sha |
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

本仓库根的 `api/` + `deploy/Dockerfile` 与 `deploy-api-serve/`，
平铺进同一层临时目录再 `docker build`（Dockerfile 按 `./api` 与 `./serve-api.js` 拷）。
见 `.cnb.yml` 的「发布（自检 → 镜像 → 体验版）」—— 推 `main` 触发，镜像 tag 是
本仓库这一版的短 sha（`${CNB_COMMIT_SHORT}`），不是分支名。

**另一个入口是 `main` 分支详情页上那个「发布」按钮**（`.cnb/web_trigger.yml` →
`web_trigger_release`）—— 链与推 `main` 那份逐字相同，只是不挂 `ifModify`：
手动要的正是「无论这次改了什么，都按当前代码重出一遍」。两个入口的脚本
由 `scripts/check.js` 逐行比着，只改一处就红。

⚠️ **`api/` 是整棵拷的，但只剩白名单放行的那几条。** 白名单写错时「构建绿、部署绿、
容器起来才报 `Cannot find module`」（Issue #134）。白名单逐条放行 `api/**` 与
`_routes/**`，逐个目录都在 `.dockerignore` 里列着 —— 改它时对着
`api/_lib/routes.js` 的 ROUTES 表核一遍。

镜像名用 `${CNB_REPO_SLUG_LOWERCASE}`（本仓库）。**别写成 `${CNB_ROOT_SLUG}`**。

## 镜像里没有语料

这份镜像只跑 `/api/*`。课内正文随小程序包下发，课外那部分语料连同正文分片、
分片路由、语料版本一并删除（Issue #723），所以：

- 构建上下文只有 `api/` 与两个服务壳文件（约 0.3MB），没有 `shard-src/` 那一层
- 没有 `COPY_SHREDS` 这面旗，也没有 `/app/shards/`
- 没有 `/api/shard/*` 这条路由；`GET /api/config` 只回 `turnstile` 与 `mail`

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
小程序两条都不打，所以默认这样。真要那两条，把 `scripts/corpus/js/quiz.js` 一起摊进
上下文的白名单里就行。

## 本机怎么构建

```bash
bash deploy/build.sh            # 构建并报体积
bash deploy/build.sh --dry-run  # 只看上下文，不构建
```
