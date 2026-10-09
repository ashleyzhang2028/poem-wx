# 云托管后端：只跑 API 的那一份

> Issue #71 选定 **B 方案**在代码上的落点。放的是**部署描述**，不是后端代码本体。

## 这里有什么

| 文件 | 干什么 |
|---|---|
| `Dockerfile.api` | 只 COPY `api/` 的运行时镜像，端口 8080 |
| `serve-api.js` | 只挂 `/api/*` 的薄壳（不伺服静态站） |
| `dockerignore.api` | 构建上下文**白名单**：只放 `api/` 进去 |
| `build.sh` | 从 `poem` 拉一份源码，把上面两件放进去，`docker build` |

## 为什么是「瘦身」而不是「第二份后端」

云托管要跑的是 `poem` 那个进程 —— 账号、进度、会话、`code2Session` 全在它的
`api/_lib/` 里。抄一份出来等于同一份进度走两条入库逻辑（`miniprogram/utils/remote.js`
顶上那段注释写的正是这件事）。所以这里**只改部署形状**：同一份 `api/`，一份不同的 Dockerfile。

省掉的是**每次部署都要上传、而运行时一次都不读**的东西（实测，见下）：

| 挡在构建上下文外 | 体积 | 谁在用 |
|---|---|---|
| `data/` | 26 MB | 只有 `/api/game/*`、`/api/exam/*` —— 小程序一条都不打 |
| `fonts/` | 11 MB | 网页版的宋体子集字体 |
| `scripts/data/` | 11 MB | 语料生成脚本的数据 |
| `.git` | 22 MB | 谁都不用 |
| `test/` `docs/` 各页面目录 | ~2 MB | CI 与浏览器 |

`poem` 源码（不含 `.git`）**52MB → 构建上下文 456KB**。

### ⚠️ 砍掉 `data/` 与 `js/` 的真实代价

`/api/game/answer`、`/api/exam/records` 这两条**会回 500**（`E_INTERNAL`）——
不是「语料没读到」这种带说明的错，是 `js/quiz.js` 加载不到、被 handler 的兜底
catch 接住。**这是实测的，不是推的**（2026-10-09，见 PR 描述里的复现命令）。

小程序端两条都不调（`miniprogram/utils/remote.js` 的 `PATHS` 里没有），
所以默认这样；要补就在构建命令里加 `--with-corpus`，那会把 `data/` 放回去。
`js/` 不跟着放 —— 那是网页版前端，放了会再把 1MB 带回来，而
`quiz.js`/`exam.js` 只是那两条路由要的东西。

## 怎么构建

```bash
git clone --depth 1 https://cnb.cool/npu-gpu-cpu/poem.git /tmp/poem

POEM_DIR=/tmp/poem bash deploy/build.sh                 # 瘦身（默认）
POEM_DIR=/tmp/poem bash deploy/build.sh --with-corpus   # 带上 data/
POEM_DIR=/tmp/poem bash deploy/build.sh --dry-run       # 只报体积
```

试跑：

```bash
docker run -p 8080:8080 \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e SUPABASE_URL=... -e SUPABASE_SERVICE_KEY=... \
  poem-api
```

## 云托管怎么填

- 部署方式：**代码仓库** → `https://cnb.cool/npu-gpu-cpu/poem.git`（实测匿名可读）
- Dockerfile：`deploy/Dockerfile.api`；构建上下文 `deploy/`
- 环境变量：`SESSION_SECRET` / `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` /
  `WX_APPID` / `WX_SECRET`，见 [`../docs/wx-login-server.md`](../docs/wx-login-server.md)
- 端口 8080（容器全程非 root，监听不了 80）

⚠️ 云托管能不能「只指 `deploy/` 这个子目录」取决于它的构建配置，**本机这一套是验过的**。
若只能指仓库根，就把 `Dockerfile.api`、`serve-api.js` 放到 `poem` 根，
`dockerignore.api` 改名 `.dockerignore`，`build.sh` 里那几步照旧 —— 效果一样。
