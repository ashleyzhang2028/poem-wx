# 云托管后端：只跑 API 的那一份

部署描述。**后端代码不在这个仓库里** —— 它在
[`npu-gpu-cpu/poem`](https://cnb.cool/npu-gpu-cpu/poem) 的 `api/`。

| 文件 | 干什么 |
|---|---|
| `Dockerfile` | 只拷 `api/` 的运行时镜像，端口 8080 |
| `build.sh` | 本机构建 + 报体积（**部署链上不跑它**） |
| `../deploy-api-serve/` | 只挂 `/api/*` 的服务壳 + 白名单（构建时摆进上下文） |

## 云托管那几栏

推一版 `main` 触发流水线把镜像构建出来（CNB + GHCR 各一份），再去控制台建服务。

| 字段 | 填什么 |
|---|---|
| 部署方式 | **镜像** |
| 镜像地址 | `ghcr.io/ashleyzhang2028/poem-wx/wx-api:<poem 短 sha>`（**公开包，不用凭据**；CNB 槽位是备用，见下） |
| 端口 | `8080` |
| 环境变量 | `SESSION_SECRET` / `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `WX_APPID` / `WX_SECRET` |
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

镜像名用 `${CNB_REPO_SLUG_LOWERCASE}`（本仓库）。**别写成 `${CNB_ROOT_SLUG}`** ——
那个变量在流水线里指被 clone 的 `poem`。

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
