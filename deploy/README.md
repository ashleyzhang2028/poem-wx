# 云托管后端：只跑 API 的那一份

> Issue #71。**这里放的是部署描述，不是后端代码。** 后端一行都不在这个仓库里 ——
> 它在 [`npu-gpu-cpu/poem`](https://cnb.cool/npu-gpu-cpu/poem) 的 `api/`。

## 这里有什么

| 文件 | 干什么 |
|---|---|
| `Dockerfile` | 只拷 `api/` 的运行时镜像，端口 8080 |
| `build.sh` | 本机构建 + 报体积（**部署链上不跑它**，见下） |
| `../deploy-api-serve/` | 只挂 `/api/*` 的服务壳（构建时摆进上下文） |

## 云托管怎么填

**别在控制台里指这个仓库。** 那儿的「容器目录」是按**被部署仓库的根**取的，
而这个仓库根上没有 `api/` —— 小程序前端不是后端。按控制台那条路，就只剩
「把 `poem/api/` 拷一份进来」这一个选择，而那正是这一版要撤掉的东西。

正路是**镜像**：让 CNB 流水线构建、推镜像，云托管按镜像部署。

⚠️ **顺序**：先打一个 `v*` tag 触发流水线把镜像构建出来（否则下面那栏没得填），
再去控制台建服务。

| 字段 | 填什么 |
|---|---|
| 部署方式 | **镜像** |
| 镜像地址 | `docker.cnb.cool/npu-gpu-cpu/poem-wechat-mini-program/wx-api:<tag>`（见下） |
| 端口 | `8080` |
| 环境变量 | `SESSION_SECRET` / `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `WX_APPID` / `WX_SECRET` |

探活打 `/healthz`（回 `ok`）—— 这份镜像**没有静态站**，`/` 就是 404，
别拿它当判据。

**要人做的动作不止这几栏**（建 `wx_accounts` 表、配环境变量、加 request 域名……），
整份清单在 [`../docs/wx-cloud-setup.md`](../docs/wx-cloud-setup.md) 的
「§ 一点五 运维动作清单」。

⚠️ 镜像槽位的路径是按**这个仓库**的 slug 给的，即使源码来自 `poem` ——
流水线在这个仓库里跑，镜像就推在这个仓库名下。所以云托管那边填的是
`poem-wechat-mini-program/wx-api`，不是 `poem/xxx`。

### 流水线怎么构建（关键形状）

CNB 允许**源码上下文**与**Dockerfile 来源**不是同一处的组合。真实的
`.cnb.yml`（「构建云托管镜像（源码 = poem）」那一节）分三步：

1. **clone `poem`** —— 取后端源码（唯一一份）
2. **摊构建上下文** —— `poem/api/` + 本仓库的 `deploy/Dockerfile` 与
   `deploy-api-serve/serve-api.js`、`deploy-api-serve/.dockerignore`，
   平铺进同一个临时目录（Dockerfile 是按 `./api` 与 `./serve-api.js` 拷的）
3. **`docker build` + push** —— 推两个 tag：`<tag 名>` 与 `latest`

镜像名按**本仓库**的 slug 展开，不是 `poem` 的：

```
docker.cnb.cool/npu-gpu-cpu/poem-wechat-mini-program/wx-api:<tag>
```

⚠️ **别把它写成 `${CNB_ROOT_SLUG}`** —— 那个变量在流水线里指 `poem`
（被 clone 的源码仓库），而镜像要推在**跑流水线的这个仓库**名下。
真实 `.cnb.yml` 用的是 `${CNB_REPO_SLUG_LOWERCASE}`（本仓库）。
这一处写反了，云托管那栏就拉不到镜像。

⚠️ 具体的 CI 语法以 CNB 文档为准（`cnb-docs` 技能 / 平台文档）。
这一节写的是**形状**：后端代码只有 `poem` 一处，镜像的构建上下文也直接取它，
中间不再落一份副本。

## 为什么是「瘦身」而不是「第二份后端」

云托管要跑的是 `poem` 那个进程 —— 账号、进度、会话、`code2Session` 全在它的
`api/_lib/` 里。抄一份出来等于同一份进度走两条入库逻辑（`miniprogram/utils/remote.js`
顶上那段注释写的正是这件事）。所以这里**只改部署形状**：同一份 `api/`，一份不同的 Dockerfile。

省掉的只是**每次部署都要上传、而运行时一次都不读**的东西：

| 挡在构建上下文外 | 体积 | 谁在用 |
|---|---|---|
| `data/` | 26 MB | 只有 `/api/game/*`、`/api/exam/*` —— 小程序一条都不打 |
| `fonts/` | 11 MB | 网页版的宋体子集字体 |
| `js/`、各页面目录、`css/`、`icons/` | ~2.5 MB | 浏览器 |
| `.git` | 22 MB | 谁都不用 |

**构建上下文 ≈ 300KB**（`api/` 加服务壳）。

## ⚠️ 真代价，放最显眼处

**① `/api/game/answer`、`/api/exam/records` 会回 500**（`E_INTERNAL`）。
不是「语料没读到」这种带说明的错 —— 是 `api/_lib/game.js` 里
`require(ROOT + "/js/quiz.js")` 加载不到，被 handler 的兜底 catch 接住。
小程序端两条都不打（`miniprogram/utils/remote.js` 的 `PATHS` 里没有），所以默认这样。

要语料就别用这份：上面那两条要 `data/` **和** `js/quiz.js`、`js/exam.js`，
`data/` 26MB + `js/` 1MB 一起加回来就只剩「省个字体」了 ——
真有这需求，用 `poem` 仓库根那份 `Dockerfile` 更省事，它本来就带着全部资源。

**② 镜像槽位**：这份镜像推在**本仓库**名下（流水线在这儿跑），
而 `poem` 自己那份部署也在用它自己的槽位。两个仓库各占一个，
这是「后端只有一份代码」换来的唯一额外成本。

## 本机怎么构建

```bash
git clone --depth 1 https://cnb.cool/npu-gpu-cpu/poem.git /tmp/poem
POEM_DIR=/tmp/poem bash deploy/build.sh            # 构建并报体积
POEM_DIR=/tmp/poem bash deploy/build.sh --dry-run  # 只看上下文，不构建
```

`build.sh` 在**本机**摊上下文（把 `serve-api.js` 与 `.dockerignore` 摆进去），
跑真 `docker build`。部署链上不走它 —— 那边是流水线按上面的形状直接构建。
