# 后端部署：云调用（免域名、免备案）

后端代码在 [`poem`](https://cnb.cool/npu-gpu-cpu/poem) 的 `api/`，**不在本仓库**。
本仓库只有部署描述（`deploy/`），镜像由 CNB 流水线构建。

主路走**云调用**（`wx.cloud.callContainer`）：走微信内网，不经过 request 合法域名名单，
**不用买域名、不用备案、不用配证书**。代价只有一条：只有小程序能调。

```
推 main（自动构建镜像）
  → 云托管按镜像建服务
  → 配环境变量
  → 建 wx_accounts 表
  → 小程序「我的 → 管理」填云调用两栏
  → 验
```

---

## 一、出镜像

```bash
git checkout main && git pull     # 推 main 触发发布流水线
```

流水线跑完出两份镜像（同一棵树）：

| 地址 | 云托管能直接拉吗 |
|---|---|
| `ghcr.io/ashleyzhang2028/poem-wx/wx-api:<poem 短 sha>` | ✅ 公开包，**不用凭据** |
| `docker.cnb.cool/npu-gpu-cpu/poem-wechat-mini-program/wx-api:<本仓库短 sha>` | ⚠️ 私有，要配凭据 |

**主路填 ghcr.io 那份。**

确认镜像出来了：

1. 仓库「流水线」页：`main` 的发布流水线是绿的
2. 制品库页：`wx-api` 槽位下有那个短 sha
3. GitHub 包页把包设成 Public —— 见下

### 1.1 把 GHCR 包设成 Public（第一次必做）

GHCR 新包默认 Private，不设就拉不动。

```
https://github.com/users/ashleyzhang2028/packages/container/poem-wx%2Fwx-api/settings
```

或者：GitHub 个人主页 → **Packages** → 包 `poem-wx/wx-api` → 右下角 `Package settings`
→ `Danger Zone` → `Change visibility` → **Public**。

- **不是** repo 的 Settings，包挂在 `github.com/users/...` 下
- 包页 404 = 包还没推上去，先回上面查流水线
- 只做一次

### 1.2 推 GHCR 要的两个密钥（首次配置）

写在密钥仓库 `poem-wechat-mini-program-secrets` 的 `wechat-ci.yml`，不进代码。

| 用途 | 密钥名 | token 类型 | 权限 |
|---|---|---|---|
| 推 `ghcr.io` | `GHCR_USER` / `GHCR_TOKEN` | **classic** | `write:packages` |
| 同步代码到 `poem-wx` | `GH_PAT` / `GH_REPO` | fine-grained | `Contents: Read and write` |

- `GHCR_USER` 填 GitHub 账号名，不是邮箱
- `GHCR_TOKEN` **必须是 classic PAT**：GitHub Packages 只认 classic token，
  fine-grained 的 Permissions 里**没有 Packages 那一栏**。
  建 classic：[这个链接](https://github.com/settings/tokens/new?scopes=write:packages)
- 两组 token 不能互相顶替（`contents` 与 `packages` 在两个体系里分开）

## 二、建服务

[cloud.weixin.qq.com](https://cloud.weixin.qq.com) → **云托管 → 服务管理 → 新建服务**。

| 字段 | 填什么 |
|---|---|
| 归属环境 | 没有就新建（地域就近） |
| 服务名称 | 如 `poem-api` |
| 部署方式 | **镜像** |
| 镜像地址 | `ghcr.io/ashleyzhang2028/poem-wx/wx-api:<poem 短 sha>` |
| 端口 | `8080` |

控制台那一栏是**六选一**（绑定 GitHub / GitLab / Gitee 仓库、手动上传代码包、
从镜像仓库拉取镜像、**从地址拉取镜像**）—— 选 **「从地址拉取镜像」✅**。

几处容易绊住的地方：

- 镜像地址填**具体版本号**，别填 `latest`
- 选了镜像**没有「目标目录」那一栏**，那是「部署方式 = 代码仓库」才出现的
- **别选「部署方式 = 代码仓库」**：本仓库根上没有 `Dockerfile`（在 `deploy/`），
  也没有 `api/`（后端不在这个仓库）
- 首次进入若看到 Express / Spring Boot 那排模板，走「新建服务」，别选模板

### 2.5 拉镜像的凭据（只走 CNB 备用地址时需要）

⚠️ 用 ghcr.io 地址，这节整节跳过。

配在**控制台 → 服务设置 → 部署配置 → 镜像仓库凭据**：

| 字段 | 填什么 |
|---|---|
| 仓库地址 | `docker.cnb.cool`（只有域名，不带路径、不带 `https://`） |
| 用户名 | `cnb` |
| 密码 | 一枚 CNB 访问令牌 |

- **用户名固定是 `cnb`**，不是你的 CNB 账号名
- 令牌：[cnb.cool/profile/token](https://cnb.cool/profile/token)，范围选指定仓库
  `npu-gpu-cpu/poem-wechat-mini-program`，当场复制
- 凭据不是环境变量，别和 § 3 混

## 三、配环境变量

云托管 → 服务设置 → **环境变量**：

```
SESSION_SECRET=<openssl rand -hex 32>        # 缺了 /api/* 一律 503 E_NOT_CONFIGURED
MYSQL_HOST=<MySQL 内网地址>                   # 与云托管在同一个 VPC
MYSQL_PORT=3306
MYSQL_USER=poem
MYSQL_PASSWORD=<口令>
MYSQL_DATABASE=poem                           # 缺了降级内存存储，重启即丢
WX_APPID=wx200a0c667fc67fcb                  # 缺了登录回 503 E_WX_NOT_CONFIGURED
WX_SECRET=<小程序 appsecret>
```

`SESSION_SECRET` / `WX_*` 的完整定义在 `poem` 的 `api/_lib/config.js`；
`MYSQL_*` 那几项由这份部署自己读（`deploy-api-serve/serve-api.js`），
`poem` 那边**不认识**它们 —— 后端代码在那儿，而「用哪台数据库」是这份部署的选择。

### 3.1 MySQL 怎么建、地址从哪儿来

云托管控制台 → **服务所属环境** → 左侧「MySQL」→ 建实例（或选一个已有的）。
建好之后在「数据库连接」里能看到**内网地址**：

| 那一栏 | 填进哪个环境变量 |
|---|---|
| 内网地址 | `MYSQL_HOST` |
| 端口（一般 3306） | `MYSQL_PORT` |
| 用户名 / 密码 | `MYSQL_USER` / `MYSQL_PASSWORD` |
| 已建的库名（没有就先建一个 `poem`） | `MYSQL_DATABASE` |

⚠️ **填内网地址，不填公网地址。** 云托管与 MySQL 在同一个 VPC 里，
走内网既不用开公网访问、也不用配白名单与 TLS。填公网地址能通，
但那是把数据库挂到了公网上 —— 没必要。

⚠️ **`MYSQL_HOST` 不填 = 退回内存档**（poem 原本那个实现），
表现是「能登录、能同步，但服务一重启全没了」。所以配完要按 § 七 查一次库。

> **这几个 `MYSQL_*` 不是绑死的。**
> 它们是「服务端存储层」那个插槽的**一个**实现 —— 存储层是一组
> `getX / putX / listX` 的接口（`poem/api/_lib/store.js`），线上这份实现就在本仓库的
> `deploy/store-mysql.js`。换别的实现，**小程序端与管理页一个字都不用改**。
> 条件 upsert 那条不变式换库时该怎么落地、以及「换库不是审核的要求」那句话，
> 见 [`data-backend.md`](data-backend.md) § 三。

## 四、建表

云托管控制台 → 服务所属环境 → **MySQL** → 数据管理 / SQL 窗口，
把本仓库的 [`deploy/sql/mysql-schema.sql`](../deploy/sql/mysql-schema.sql)
整段粘贴执行（幂等，可重复跑）。

它建的是**全部**表（账号 / 微信账号 / 会话 / 进度 / 报告 / 勘误 / 反馈 / 考试），
不只是 `wx_accounts` —— 一次性建齐，省得后面一条条补。

## 五、探活

```
https://poem-wx-326045-4-1502724481.sh.run.tcloudbase.com/healthz   →   回 ok
```

默认域的形状是 `<服务名>-<环境ID>.sh.run.tcloudbase.com`：

| 段 | 值 | 从哪儿拿 |
|---|---|---|
| 服务名 | `poem-wx` | 建服务时填的那个（§ 2） |
| 环境 ID | `326045-4-1502724481` | 环境详情里复制 |
| 地域段 | `sh.run` | 固定这一种 |

- 地域段是 `sh.run`，不是 `ap-shanghai.run`（后者回 `INVALID_HOST`）
- 环境 ID 是**创建时定死的**，改环境名它不动
- 域名以控制台「服务设置 → 基础信息 → 公网访问」里显示的为准；「公网访问」默认可能是关的
- 别拿 `/` 当判据，这份镜像没有静态站，`/` 就是 404

## 六、接上后端：云调用

### 6.1 把云开发环境与云托管服务对起来

云调用要两个标识符，**它们是两个不同的环境**：

| 填在哪 | 是什么 | 从哪儿拿 |
|---|---|---|
| `config.env` | **云开发**环境 ID，形如 `poem-d9g1bqeq978682c58` | 微信开发者工具 → 云开发控制台 → 设置 → 环境 ID |
| `X-WX-SERVICE` | 云托管的**服务名**，如 `poem-api` | 云托管控制台 → 服务管理 → 服务名 |

⚠️ 把云托管那个数字环境 ID（`326045-4-1502724481`）填进 `config.env` 是最常见的错，
平台回 `env not exists`，看着像环境没建。

### 6.2 在小程序里配

小程序 → **我的 → 管理** → 「云调用」两栏，填上 6.1 的两个值，存。

**`baseUrl` 留空，request 合法域名也空着** —— 两个都填时以 `baseUrl` 为准。

## 七、验

```bash
# ① 会话认得出来 —— 回 E_NO_SESSION 就是服务端的 tokenOf() 没上
curl -s -X POST https://<域>/api/sync/pull \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'content-type: application/json' -d '{"deviceId":"d1","since":0}'

# ② 那一行真的落库了
# select poem_id, payload from progress where poem_id = 'settings:v1';
```

③ 换台手机登同一个微信，进度与设置认回来。

判据是**查库**，不是界面写「已同步」。

⚠️ **`select` 得到空 = `MYSQL_HOST` 那几项没生效**（服务端退回了内存档，
数据只活在进程里、一重启就没）。这一条要单独排一次，因为它的症状是
「界面一切正常、换台手机也有，但服务一重启数据全没了」—— 而那时候
你已经在怀疑别的东西了。

⚠️ **头像查不到是正常的**：它只有一个来源（微信那张 `chooseAvatar` 的临时路径）
且**只落本机、不上传**（Issue #111）。所以 `progress` 里**没有** `profile:v1` 那一行，
换台手机头像就是没有 —— 这是刻意的，不是没同步成功。

## 八、发档位

第一个管理员直接在库里把 `accounts.role` 改成 `owner`，其余人由这个 owner 在管理页发。

---

## 出问题了先看这里

| 现象 | 原因 | 处理 |
|---|---|---|
| 昨天还好，今天打不开 | 免费档缩容到 0 实例 | 加个定时探活打 `/healthz`，5 分钟以上一次 |
| 同上 | 「公网访问」被关回去了 | 服务设置 → 基础信息里打开 |
| curl 也不通 | 服务没起来 / 公网访问关着 | 看服务日志与实例数 |
| curl 通、真机不通 | 云调用两栏填错，或配置里还留着 `baseUrl` | `baseUrl` 优先于云调用，留空 |
| 平台回 `env not exists` | `config.env` 填了云托管的数字环境 ID | 换成云开发环境 ID（§ 6.1） |
| 平台回 `service not found` | `X-WX-SERVICE` 填成了环境 ID | 填云托管**服务名** |
| 登录通但同步一律 401 | 服务端没认 `Authorization: Bearer` | 见 [`wx-login-server.md`](wx-login-server.md) |
| 流水线红在 `clone poem`，报 `Repository Not Found.` | 凭据不被接受，不是路径错 | `.cnb.yml` 里已留了不带凭据的退路（`poem` 匿名可读） |
| 流水线红在 `build & push`，报 `invalid reference format` | `.cnb.yml` 的 `env:` 里写了 `${VAR:-default}` | CNB 只替换 `$VAR`，`env:` 的值只能写字面量 |
| 云托管拉镜像报 401 Unauthorized | ① tag 根本没构建出来（CNB 对匿名请求一律回 401，不区分「没权限」和「不存在」）；② tag 在，但槽位私有、没配凭据 | 先查 tag：`cnb registries list-package-tags --slug npu-gpu-cpu/poem-wechat-mini-program --type docker --name npu-gpu-cpu/poem-wechat-mini-program/wx-api`。没有 → 回 § 1；在、还是 401 → § 2.5 |
| **服务一重启，用户数据全没了** | `MYSQL_HOST` 那几项没配 / 配错 → 服务端退回了内存档 | § 3.1。看服务日志里那句话：`[store] 没配 MYSQL_HOST —— 退回 poem 默认的存储层`。配好了它会打 `[store] 存储层 = 腾讯云 MySQL <host>:<port>/<db>` |
| 服务日志报 `配了 MYSQL_HOST 但镜像里没有 mysql2` | 镜像里那个依赖没装上 | 那是 `deploy/Dockerfile` 的 `npm install … mysql2` 那步；重推一次 `main` 出镜像 |
| 服务日志报 `ER_NO_SUCH_TABLE` | 建表语句没跑（或只跑了一半） | § 四，把 `deploy/sql/mysql-schema.sql` 整段重跑一遍（幂等） |
| 服务日志里没有 `[store]` 那两行中的任何一行 | 镜像太老（接线那版还没上） | 回 § 1 重出镜像 —— 接线在 `serve-api.js` 里，那是随镜像走的 |
| 换台手机头像没了 | **正常**（Issue #111）：头像只落本机、不上传 | 不为它养对象存储。要头像跨设备就得先接受「养一个存储桶」这个代价 |

**一句话区分**：curl 也不通 → 看服务和公网访问；curl 通、真机不通 → 看云调用两栏。

---

## P.S.：两条不用走的路

- **request 合法域名**（要备案）：`wx.request` 只能打在微信后台登记过的域上，
  而名单**只收已备案的域名**（ICP，3–20 个工作日）。云托管的默认域填不进去 ——
  微信会提示「云托管域名仅用作测试使用，不可用在正式环境下」。
  个人主体也能备案，只是要等。走这条时才需要：买域名 → 备案 → 云托管绑自定义域
  → 公众平台 request 合法域名 → 小程序里填 `baseUrl`。顺序**先备案、再绑域、最后改名单**。
- **全量镜像**（容器里连静态站一起跑）：云托管指 `poem` 仓库、用它根上的 `Dockerfile`。
  代价是每次部署多传 37MB（26MB 语料 + 11MB 字体），小程序一条都不读。
