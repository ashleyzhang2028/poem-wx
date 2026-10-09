# 云托管后端：只跑 API 的那一份

> Issue #71 选定 **B 方案**在代码上的落点。放的是**部署描述**，不是后端代码本体。
> 后端本体在 [`npu-gpu-cpu/poem`](https://cnb.cool/npu-gpu-cpu/poem) 里。

## 这里有什么

| 文件 | 干什么 |
|---|---|
| `Dockerfile` | 只 COPY `api/` 的运行时镜像，端口 8080 |
| `serve-api.js` | 只挂 `/api/*` 的薄壳（不伺服静态站） |
| `.dockerignore` | 构建上下文**白名单**：只放 `api/` 与 `serve-api.js` |
| `sync-api.sh` | 从 `poem` 同步 `api/` 过来 / `--check` 对账 |
| `api/` | ← 同步产物，**别手改**；改后端去 `poem` |
| `api.synced` | 记着这份 `api/` 来自 poem 的哪个 commit |
| `build.sh` | 本机构建 + 报体积（云托管那边不跑它） |

## 云托管怎么填

| 字段 | 填什么 |
|---|---|
| 部署方式 | **代码仓库** |
| 代码仓库 | `https://cnb.cool/npu-gpu-cpu/poem-wechat-mini-program.git` |
| 分支 | 你要上线的那条（如 `feat/wechat-mini-program-893d`） |
| **容器目录** | **`deploy`** |
| **Dockerfile** | **`Dockerfile`**（就是本目录这份；不填时默认也是文件名 `Dockerfile`） |
| 端口 | `8080` |
| 环境变量 | `SESSION_SECRET` / `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `WX_APPID` / `WX_SECRET`，见 [`../docs/wx-login-server.md`](../docs/wx-login-server.md) |

⚠️ **「容器目录」这一栏是这件事的全部机关。** 云托管是按**上面那个仓库的根**去取
这个目录的，取不到就退回仓库根。所以：

- 填 `deploy` → 上下文是 `deploy/`，Dockerfile 用 `deploy/Dockerfile` ✅ 本文这条路
- 留空（或填仓库根）→ 云托管的构建就只看见小程序前端，**没有 Dockerfile 可构建** ❌
  （那个仓库里没有后端代码 —— 这也是早先「新建一个仓库」那个直觉真正的落点）
- 想不填容器目录直接用 poem？**做不到**：`poem` 是另一个仓库，云托管不会去那儿找。

## 为什么是「瘦身」而不是「第二份后端」

云托管要跑的是 `poem` 那个进程 —— 账号、进度、会话、`code2Session` 全在它的
`api/_lib/` 里。抄一份出来等于同一份进度走两条入库逻辑（`miniprogram/utils/remote.js`
顶上那段注释写的正是这件事）。所以这里**只改部署形状**：同一份 `api/`，一份不同的 Dockerfile。

省掉的是**每次部署都要上传、而运行时一次都不读**的东西：

| 挡在构建上下文外 | 体积 | 谁在用 |
|---|---|---|
| `data/` | 26 MB | 只有 `/api/game/*`、`/api/exam/*` —— 小程序一条都不打 |
| `fonts/` | 11 MB | 网页版的宋体子集字体 |
| `js/` | 1 MB | 网页版前端（但 `/api/game/*` 要它，见下） |
| `.git` | 22 MB | 谁都不用 |
| 各页面目录 / `css/` / `icons/` | ~1.5 MB | 浏览器 |

**构建上下文 = `deploy/` 只有 436KB**（47 个文件，全是 `api/`）。
`poem` 整仓（含 `.git`）是 50.5MB，仓库根那份 `.dockerignore` 挡完还剩 49MB。

## ⚠️ 真代价，放最显眼处

**① `deploy/api/` 是 `poem/api/` 的一份副本。** 这不是笔误，是这份方案的形状：
云托管不会去 clone 另一个仓库，代码必须已经在上下文里。所以：

- 改后端的唯一入口是 `poem`。在 `poem` 合并之后，跑一次 `bash deploy/sync-api.sh`，
  这边跟着走。**不跑，线上就是旧代码** —— 而且不报错，只是「怎么改都没反应」。
- 防这条的自检在 `.cnb.yml`：`sync-api.sh --check` 会拿 `poem` 的 HEAD 与
  `api.synced` 里的 sha 对，对不上就**红**。红的意思是「回来同步一次」，不是坏了。
  （同款先例：`scripts/build-data.js` 那边也是「poem 改了这边就红，由人对一次」。）

**② `/api/game/answer`、`/api/exam/records` 会回 500**（`E_INTERNAL`）。
不是「语料没读到」这种带说明的错 —— 是 `api/_lib/game.js` 第 78 行
`require(ROOT + "/js/quiz.js")` 加载不到，被 handler 的兜底 catch 接住。
小程序端两条都不打（`miniprogram/utils/remote.js` 的 `PATHS` 里没有），所以默认这样。

**③ 要语料就别用这份。** 上面那两条要 `data/` **和** `js/quiz.js`、`js/exam.js`：
`data/` 26MB，`js/` 1MB，一起加回来就只剩「省个字体」了。真有这需求，用 `poem`
仓库根那份 `Dockerfile` 更省事 —— 它本来就带着全部资源。（旧版 `--with-corpus`
只把 `data/` 放回来，那是个**不通**的组合：`quiz.js` 仍旧加载不到。所以这个参数
已经改成如实拒绝，不再假装支持。）

## 本机怎么构建

```bash
bash deploy/sync-api.sh          # 从 CNB 拉 poem，把 api/ 同步进来
bash deploy/build.sh             # 就地构建 deploy/
bash deploy/build.sh --dry-run   # 只报体积
```

`POEM_DIR=/path/to/poem` 可以指本地已有的 poem 源码。构建时会把来源 commit
写进镜像标签（`org.opencontainers.image.revision`），上线后能对出「这一版是哪来的」。

试跑：

```bash
docker run -p 8080:8080 \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e SUPABASE_URL=... -e SUPABASE_SERVICE_KEY=... \
  poem-api
curl -s localhost:8080/healthz
```

## 会话还没通的那一半

这份镜像只是**部署形状**。`poem` 侧的 `withSession()` 目前只认 Cookie，
而小程序发的是 `Authorization: Bearer` —— 不补这半边，现象是
「`/wx/login` 一路绿灯、`/api/sync/*` 一律 401」。逐条在
[`../docs/wx-login-server.md`](../docs/wx-login-server.md)。
