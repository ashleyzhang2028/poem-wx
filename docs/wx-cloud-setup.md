# 云托管：部署步骤

后端代码在 [`poem`](https://cnb.cool/npu-gpu-cpu/poem) 的 `api/` 里，**不在本仓库**。
本仓库只有部署描述（`deploy/`），镜像由 CNB 流水线构建（源码取 `poem`）。

```
把代码合进 main（自动构建镜像，同时推一份到 GHCR）
  → 云托管按镜像部署（地址填 ghcr.io 那份）
  → 云托管：配拉取凭据（备用地址才需要）
  → 配环境变量 → 建 wx_accounts 表 → 接上后端 → 验
```
「接上后端」有两条路，**分别只在要不要备案**：云调用（免）与 request 合法域名（要）。见 § 6。

镜像有两份，同一棵树，只有「能不能匿名拉」的差别：

| 地址 | 云托管能直接拉吗 |
|---|---|
| `ghcr.io/ashleyzhang2028/poem-wx/wx-api:<poem 短 sha>` | ✅ 公开包，**不用凭据**（要手动设 Public，见 § 1） |
| `docker.cnb.cool/npu-gpu-cpu/poem-wechat-mini-program/wx-api:<本仓库短 sha>` | ⚠️ 私有，**必须配凭据**（见 § 2.5） |

**主路走 ghcr.io，§ 2.5 整节可跳过。**

---

## 一、部署

### 1. 合 `main`，构建镜像

```bash
git checkout main && git pull
```

推 `main` 触发 `.cnb.yml` 的「发布（自检 → 镜像 → GHCR → 体验版）」，跑完出两份镜像：

```
ghcr.io/ashleyzhang2028/poem-wx/wx-api:<上游 poem 短 sha>          # 云托管填这份
docker.cnb.cool/npu-gpu-cpu/poem-wechat-mini-program/wx-api:<本仓库短 sha>   # 备用
```

两个 tag 不是同一个 sha：GHCR 那份记的是「这版后端来自 poem 的哪次提交」（见 `deploy/README.md` 的 REV）。

**确认镜像真的出来了**（这步漏了，下一步填什么都是白填）：

1. 仓库「流水线」页：`main` 的发布流水线是绿的
2. 制品库页：`wx-api` 槽位下有那个短 sha
3. **GitHub 包页：把包设成 Public** —— 见下

#### 1.1 把 GHCR 包设成 Public（第一次必做）

GHCR 新包默认 Private。不设成 Public，云托管拉它照样要凭据，走 GHCR 省凭据这一步就白做了。

```
https://github.com/users/ashleyzhang2028/packages/container/poem-wx%2Fwx-api/settings
```

或点着走：

1. GitHub 个人主页 → **Packages** 标签页
2. 找到容器包 `poem-wx/wx-api` → 进包页
3. 包页**右下角** `Package settings` → 拉到最下面 `Danger Zone` → `Change visibility`
4. 选 **Public**，手打一遍包名确认

注意：

- **不是** repo 的 Settings，那里面没有这个开关；包在 `github.com/users/...` 下，不在仓库目录下
- 包页 404 = 包还没推上去，先回上面查流水线
- 只做一次，之后不用管

#### 1.2 推 GHCR 要的两个密钥（首次配置）

| 用途 | 密钥名 | token 类型 | 权限 |
|---|---|---|---|
| 推 `ghcr.io` | `GHCR_USER` / `GHCR_TOKEN` | **classic** | `write:packages` |
| 同步代码到 `poem-wx` | `GH_PAT` / `GH_REPO` | fine-grained | `Contents: Read and write` |

- `GHCR_TOKEN` **必须是 classic PAT**。GitHub 官方原话：*GitHub Packages only supports authentication using a personal access token (classic)* —— 所以 fine-grained 的 Permissions 里**没有** Packages 那一栏。建 classic：[这个链接](https://github.com/settings/tokens/new?scopes=write:packages)（UI 手勾会把过宽的 `repo` 一起勾上）
- 两组是两种 token，不能互相顶替（`contents` 与 `packages` 在两个体系里分开）
- 密钥写进密钥仓库 `poem-wechat-mini-program-secrets` 的 `wechat-ci.yml`，不进代码、不进 `.cnb.yml`

### 2. 建服务，按镜像部署

[cloud.weixin.qq.com](https://cloud.weixin.qq.com) → **云托管 → 服务管理 → 新建服务**。

| 字段 | 填什么 |
|---|---|
| 归属环境 | 没有就新建（地域就近，如上海） |
| 服务名称 | 如 `poem-api` |
| 部署方式 | **镜像** |
| 镜像地址 | `ghcr.io/ashleyzhang2028/poem-wx/wx-api:<poem 短 sha>` |
| 端口 | `8080` |

控制台有一栏是**六选一**：绑定 GitHub / GitLab / Gitee 仓库、手动上传代码包、
从镜像仓库拉取镜像、**从地址拉取镜像**。

**选「从地址拉取镜像」✅** —— 镜像已经在 CNB 流水线里构建好了，填地址即可。

| 那一栏选 | 会怎样 |
|---|---|
| 绑定 GitHub / GitLab / Gitee 仓库 | 不行，三个平台上都没有这份后端代码 |
| 手动上传代码包 | 不行，传上去的是小程序前端 |
| **从地址拉取镜像** | ✅ **就选这个** |
| 从镜像仓库拉取镜像 | 要配凭据，还要选制品库类型；按「从地址拉取」填更省事 |

其余几点：

- 「从地址拉取镜像」**只有「镜像地址」和「端口」两栏，没有「目标目录」** ——
  目标目录 / 容器目录只在**部署方式 = 代码仓库**那条路上才出现（那条路要 clone
  代码、按目录找 Dockerfile 现构建）。选了镜像，代码已经构建完，那栏连显示都不会有。
  **别选「部署方式 = 代码仓库」**：本仓库根上既没有 `Dockerfile`（在 `deploy/`）
  也没有 `api/`（后端不在这个仓库里），填了也构建不出来。真在控制台翻到「目标目录」，
  说明部署方式不是镜像 —— 回去改掉，别琢磨那栏填什么
- 镜像地址填**具体版本号**，别填 `latest`（回滚时才知道填回哪个）
- 「镜像地址」那栏 UI 写着「仅支持拉取公开镜像」—— 它说的是「地址得是公开镜像仓库」，GHCR 那份满足；不是让你去公开代码仓库

首次进入若看到 Express / Spring Boot 那排模板，那是脚手架页，**不要选**，走「新建服务」。

### 2.5 拉镜像的凭据（只走 CNB 备用地址时需要）

⚠️ 走 § 2 的 ghcr.io 地址，这节整节跳过。

CNB 制品库的 `wx-api` 是私有的（跟着代码仓库走），云托管要拉得配凭据。

配在**控制台 → 服务设置 → 部署配置 → 镜像仓库凭据**：

| 字段 | 填什么 |
|---|---|
| 仓库地址 | `docker.cnb.cool`（**只有域名**，不带路径、不带 `https://`） |
| 用户名 | `cnb` |
| 密码 | 一枚 CNB 访问令牌 |

- **用户名是固定的 `cnb`，不是你的 CNB 账号名**（官方原话：访问代码仓库和制品库，用户名为 `cnb`，密码为访问令牌）
- 令牌：[cnb.cool/profile/token](https://cnb.cool/profile/token) → 添加访问令牌 → 「使用范围」选「指定仓库」→ `npu-gpu-cpu/poem-wechat-mini-program` → **当场复制**
- 凭据**不是环境变量**。环境变量（§ 3）是给容器进程用的，拉取凭据是平台拉镜像用的，两处别混
- 只给云托管用，别写进仓库、别写进 `.cnb.yml`

### 3. 配环境变量

云托管 → 服务设置 → **环境变量**：

```
SESSION_SECRET=<openssl rand -hex 32>        # 缺了 /api/* 一律 503 E_NOT_CONFIGURED
SUPABASE_URL=https://xxxx.supabase.co        # 缺了降级内存存储，重启即丢
SUPABASE_SERVICE_KEY=<service_role key>      # 要 service_role，不是 anon
WX_APPID=wx200a0c667fc67fcb                  # 缺了登录回 503 E_WX_NOT_CONFIGURED
WX_SECRET=<小程序 appsecret>
```

键的完整定义在 `poem` 的 `api/_lib/config.js`。

### 4. 建 `wx_accounts` 表

Supabase 控制台 → SQL Editor → 跑建表语句（在 [`wx-login-server.md`](wx-login-server.md#要用到的那张表)）。

这张表**不在 `poem` 的 `api/_lib/schema.sql` 里**（那份是网页版的），要单独建一次。

### 5. 探活

```
https://<服务名>-<环境id>.<appid>.sh.run.tcloudbase.com/healthz   →   回 ok
```

- 别拿 `/` 当判据：这份镜像没有静态站，`/` 就是 404
- 「公网访问」默认可能是关的（服务设置 → 基础信息），关着是域名解析不到，先去打开
- 域名以控制台「公网访问」那一栏显示的为准 —— 默认域有过两种形态
  （带 `-<环境id>.<appid>` 后缀的老式、带随机串的新式），别照抄别处的
- 地域段是 `sh.run`，不是 `ap-shanghai.run` —— 后者是看不懂 Host 头时回的
  `INVALID_HOST`，别误读成服务没了

### 6. 接上后端：**两条路，选一条**

这两条路的分别只有一件事 —— **要不要备案**：

| | 走哪条 | 要域名吗 | 要备案吗 | 谁能调 |
|---|---|---|---|---|
| **A. 云调用（推荐，免备案）** | `wx.cloud.callContainer` | 不要 | **不要** | 只有小程序 |
| **B. request 合法域名** | `wx.request` + 域名 | 要 | **要**（ICP，3–20 个工作日） | 小程序 + 网页版 |

**只有 B 才涉及备案**，而 A 是唯一能完全绕开它的路。想上线又不想等备案，就走 A。

#### A. 云调用：不填域名，也不备案

**为什么它能免掉备案**：云调用走微信内网，请求压根不经过「request 合法域名」
那张名单 —— 而名单制正是备案要求的来源（名单只收已备案的域名）。
所以这条路既不用买域名、也不用配证书、更不用等那 3–20 个工作日。

要做两件事：

**A1. 把云开发环境与云托管服务对起来**（一次性）

云调用要两个标识符，**它们是两个不同的环境**，不能互相顶替：

| 填在哪 | 是什么 | 从哪儿拿 |
|---|---|---|
| `config.env` | **云开发**环境 ID，形如 `poem-d9g1bqeq978682c58` | 微信开发者工具 → 云开发控制台 → 设置 → 环境 ID |
| `X-WX-SERVICE` | 云托管的**服务名**，如 `poem-api` | 云托管控制台 → 服务管理 → 服务名 |

⚠️ 把云托管那个**数字**环境 ID（`326045-4-1502724481` 这种）填进 `config.env`
是最常见的一种错 —— 两个环境 ID 长得完全不一样，填错了平台回
`env not exists`，看着像环境没建。

**A2. 在小程序里配**

小程序 → **我的 → 管理** → 「云调用」那两栏，填上 A1 的两个值，存。

存完不用改代码、也不用动「request 合法域名」。**上面那条 `baseUrl` 留空即可** ——
两个都填时以 `baseUrl` 为准。

#### B. request 合法域名

走这条就得有个**已备案**的域名。云托管那个默认域（`*.sh.run.tcloudbase.com`）
**填不进去**：

```
mp.weixin.qq.com → 开发 → 开发管理 → 开发设置 → 服务器域名
→ request 合法域名 → 加 https://<你的已备案域名>
```

- 填默认域时微信会提示「云托管域名仅用作测试使用，不可用在正式环境下，请修改」——
  它是**警告不是拦截**，域能存下来、真机也能通，于是很容易一路填到提审才回来。
  判据是「微信认不认这个后端归你」：那个域底下所有用户共用同一张泛域名证书，
  微信没法从域名本身认出归属
- 域名要**自有且已备案**（ICP，3–20 个工作日，个人也能备）
- 不是纯 IP、不带端口，只填 `https://api.你的域名.com` 这一种形状
- 每月修改次数有上限，域名一次想清楚
- 云托管那侧还要绑自定义域（服务设置 → 自定义域名），顺序是
  **先备案 → 再绑域 → 最后改名单**；反了会把默认域换掉、名单里留个打不通的新域

### 7. 也看这一眼：域名只跟「你用没用 `wx.request`」有关

「request 合法域名」那张名单看的是**域名**，不是后端是谁 —— 所以：

- 走 A（云调用）：那张名单**一直空着也没关系**
- 走 B：名单里必须有一条，且它得是已备案的域

两条路都不影响 `PATHS` / 报文 / 重试逻辑，客户端只换「怎么把请求送出去」这一层。

### 8. 验

```bash
# ① 会话认得出来 —— 回 E_NO_SESSION 就是服务端的 tokenOf() 没上
curl -s -X POST https://<域>/api/sync/pull \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'content-type: application/json' -d '{"deviceId":"d1","since":0}'

# ② 两条新行真落库
# select poem_id, payload from progress where poem_id in ('settings:v1','profile:v1');
```

③ 换台手机登同一个微信，进度 / 设置 / 头像都认回来 → 真通了。

判据是**查库**，不是界面写「已同步」。

### 9. 发档位

第一个管理员直接在库里把 `accounts.role` 改成 `owner` —— 小程序端没有这个口，也不该有。其余人由这个 owner 在管理页发。

---

## 二、出问题了先看这里

### 「昨天还好，今天就打不开」

| # | 原因 | 处理 |
|---|---|---|
| 0 | 流水线第 1 步 `git clone poem` 断了 | 镜像槽位一直不新增。带 `${CNB_TOKEN}` 去 clone 会回 `Repository Not Found.`（128），去掉凭据即可（`poem` 匿名可读） |
| 1 | 免费档缩容到 0 实例 | 冷启动期间访问全失败，控制台还写「运行中」。给个定时探活打 `/healthz`，5 分钟以上一次 |
| 2 | 「公网访问」被关回去了 | 重建服务 / 换环境会关掉它。关着是解析不到，不是 404 |
| 3 | 域名没进 request 合法域名（只影响走 B 的人） | curl 通、真机不通就是这条。走云调用的人不该撞到它 —— 撞到了说明配置里还留着 `baseUrl`，而它优先于云调用 |
| 4 | 云调用的 `config.env` / `X-WX-SERVICE` 填错栏 | 平台回 `env not exists` / `service not found`，看着像服务没部署。见 § 6 A1 |

**一句话区分**：curl 也不通 → 1 或 2；curl 通、真机不通 → 3。

### 云托管拉镜像报 401 Unauthorized

两种成因，报的是同一句话，别只看一种：

1. **tag 根本没构建出来** —— CNB 制品库对匿名请求一律回 401，不区分「没权限」和「不存在」。先查 tag 在不在：

```bash
cnb registries list-package-tags --slug <org>/<repo> --type docker --name <repo>/wx-api
```

没有 → 回 § 1 查流水线，此时配凭据是白配。在、还是 401 → 第 2 种。

2. **tag 在，但槽位私有、没配凭据** → 见 § 2.5。
   旁证：流水线日志里 `[auth] ... DONE` 说明匿名令牌那步是通的，那就是凭据问题，不是 tag 问题。

### 流水线红在 `build & push`，报 `invalid reference format`

报错里那串 tag 原样带着 `${...:-...}` 就是这条（Issue #100）：

```
ERROR: failed to build: invalid tag
"${GHCR_IMAGE:-ghcr.io/ashleyzhang2028/poem-wx/wx-api}:36ad9fe": invalid reference format
```

根子在 `.cnb.yml` 的 `env:`：CNB 的环境变量替换**只认 `$VAR`**，`${VAR}` / `${VAR:-default}` 都不在语法里，不认的形态原样留下当字符串。药方是 `env:` 的值只写字面量，想换槽位就改那一行。

⚠️ 这和 `script:` 里的 `${VAR:-x}` 不是一回事（那是 shell 的，是对的）—— 同一写法两处含义相反，别一起改。自检里有一条专门守这个。

### 流水线红在 `clone poem`，报 `Repository Not Found.`

不是路径错，是**凭据不被接受**。带一个不被接受的凭据去 clone，连匿名可读的仓库也会被拒成「不存在」。判据：同一个地址去掉凭据能 clone 下来，就是这个原因。

`.cnb.yml` 里已按这个写死了退路：带令牌试一次，不成就不带凭据再来。

### 登录通但同步一律 401

服务端没认 `Authorization: Bearer`，见 [`wx-login-server.md`](wx-login-server.md)。

---

## 三、P.S.：一条不用走的路

**全量镜像**（容器里连静态站一起跑）：云托管指 `poem` 仓库、用它根上的 `Dockerfile`。代价是每次部署多传 37MB（26MB 语料 + 11MB 字体），小程序一条都不读。账号 / 进度 / 会话上没有区别。

---

### 云调用的三条边界（走了 A 就要知道）

1. **只有小程序能调**。调用方身份由微信在平台侧注入，浏览器拿不到 ——
   所以网页版那条路仍是 `wx.request` + 域名，两条通道并存，不是替换
2. **不省登录**。平台只保证「这个请求来自本小程序」，不告诉后端「这是谁」。
   我们的 access token 照旧装在 `authorization` 头里，服务端认的还是同一枚会话
3. **服务名与环境 ID 是两个环境**。`X-WX-SERVICE` 认云托管服务名，
   `config.env` 认云开发环境；填错栏报 `env not exists` / `service not found`，
   都看着像「服务没部署」
