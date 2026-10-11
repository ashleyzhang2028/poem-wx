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
  → 小程序「我的 → 用户与权限」填云调用两栏
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

## 一点五、镜像里要不要带正文分片

**默认带。** 课外那 5604 首的正文分片（gzip 后 5.6MB）随镜像走，
由一面旗决定要不要关掉：

| 构建参数 `COPY_SHREDS` | 镜像 | `/api/shard/*` | 什么时候用 |
|---|---|---|---|
| 不写（默认） | **含分片**（+5.6MB） | 200 gzip | 正式版 —— 用户要能背课外那 5604 首 |
| `=0` | 不含分片 | `404 E_NO_SHARDS` | 调后端、试登录、回滚验证 |

⚠️ **别把它读反。** 这里以前写的是「默认不带」，而线上正式版因此少了一半功能：
课外正文一直回 `E_NO_SHARDS`，界面上说的是「这个版本里没有课外正文」——
那句话是给调试镜像留的，不是给用户看的。

开着它，就是从 `<服务名>-<环境ID>.sh.run.tcloudbase.com` 的容器直接把分片发给
小程序 —— **仍然免备案**（云调用不走那份域名名单）。为什么可以这样、
代价是什么、一个月大概多少钱，见 [`shard-delivery.md`](shard-delivery.md)。

**默认那一档不用做任何事** —— 不写就是带分片。要瘦镜像才在 `.cnb.yml` 的 `env:` 里关：

```yaml
env:
  COPY_SHREDS: "0"
```

⚠️ 值是**字面量**，别写 `${VAR:-1}` —— CNB 的变量替换只认 `$VAR`，
另外两种写法既不报错也不清空，会原样拼进参数，直到 docker 才炸。

⚠️ 关掉这面旗时，小程序里点开一首课外诗会看到「这个版本里没有课外正文」——
**这时是对的，不是坏了**。课内那 251 首不受影响（它们在主包里）。

### 这条路与「后端走云调用免备案」是同一条口径

| | 走哪条通道 | 要备案吗 |
|---|---|---|
| 登录 / 同步 / 管理 | 云调用（`/api/*`） | 不要 |
| **正文分片** | 云调用（`/api/shard/*`） | **不要** |
| 走公网的 CDN / 自有域 | request / downloadFile | **要**（`todo.md` 第 13 条） |

## 二、建服务

[cloud.weixin.qq.com](https://cloud.weixin.qq.com) → **云托管 → 服务管理 → 新建服务**。

| 字段 | 填什么 |
|---|---|
| 归属环境 | 没有就新建（地域就近） |
| 服务名称 | 自己起一个，**记住它** —— 后面 § 6.1 要填进 `X-WX-SERVICE`。本套部署用的是 `poem-wx` |
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
| 已建的库名 —— **先建一个 `poem`**，别照抄界面默认那个 | `MYSQL_DATABASE` |

#### 先搞清「库」和「表」是两件事：实例自带的那几个库一个都不能用

控制台建的**实例**里只有 MySQL 自己的库，而**库要自己建** —— 建表语句
（§ 四）建的是**表**，它得先有个库可落。这两步顺序颠倒，症状就是下一节那样。

⚠️ **DMS（[dms.cloud.tencent.com](https://dms.cloud.tencent.com)）里只列得出系统库，
不是选错了、也不是权限不够，是库里真没有你自己建的库。** 它列出来的那五个：

| 列出来的库 | 是什么 |
|---|---|
| `information_schema` | 元数据视图，只读 |
| `performance_schema` | 性能计数器 |
| `mysql` | 账号与权限字典 |
| `sys` | 前两个的易读视图 |
| `__cdb_recycle_bin__` | 回收站 |

**这五个都是 MySQL 自己的，一个都不能拿来建表。** 在 `mysql` 库里建
`accounts` / `progress`，看着能跑，实际是在改账号字典 —— 那台实例迟早出事。

**先建库**（两种办法，任选）：

命令行：

```sql
CREATE DATABASE IF NOT EXISTS `poem` DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- 顺手确认建上了（下面这条要能列出 poem）
SHOW DATABASES;
```

⚠️ **`CREATE DATABASE` 不能带 `USE`** —— 库还不存在，`USE poem` 会先报
`Unknown database 'poem'`。列系统库的那个下拉里也就没有 `poem` 可勾。

DMS 界面：**实例 → 数据库管理 → 新建数据库**，库名 `poem`、字符集 `utf8mb4`。
建完回到 SQL 窗口，**先把当前库切到 `poem`**（顶部那个库下拉，或者写一句
`USE \`poem\`;`），再往下走 § 四。

⚠️ **`MYSQL_DATABASE` 要和你建的库名逐字对上。** 建了 `poem` 而环境变量写
`poem-db`，驱动会在建库那一刻报 `ER_BAD_DB_ERROR: Unknown database`，
而**服务本身照起** —— 症状是「服务日志里那行 `[store] 存储层 = 腾讯云 MySQL
<host>:<port>/poem` 看着挺好，但登录一律 500」，一种要查半天的错。
（自检 V49 钉着这一条：`deploy/store-mysql.js` 里那个默认库名必须和本文件
写的是同一个。）

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

## 四、建表（**先切库，再执行**）

⚠️ **执行前那一步：当前库必须是 § 3.1 建的那个 `poem`。** SQL 窗口默认的当前库
多半是空的 —— 顶上那个库下拉里只有系统库可勾（库还没建完），这时整段粘进去
会得到一片 `No database selected`。不是建表语句的问题，是没告诉它往哪个库建。

```sql
USE `poem`;        -- ← 少了这一句，下面整段都会红
SELECT DATABASE(); -- 回 poem 才算切上了
```

（其实也可以不切 —— 建表语句里的 `CREATE TABLE` 没写库名，纯粹靠当前库。
所以这一步没有替代写法。）

切好之后：云托管控制台 → 服务所属环境 → **MySQL** → 数据管理 / SQL 窗口，
把本仓库的 [`deploy/sql/mysql-schema.sql`](../deploy/sql/mysql-schema.sql)
整段粘贴执行（幂等，可重复跑）。

它建的是**全部**表（账号 / 微信账号 / 会话 / 进度 / 报告 / 勘误 / 反馈 / 考试），
不只是 `wx_accounts` —— 一次性建齐，省得后面一条条补。

建完当场确认一句，**这一步是真判据**：

```sql
SHOW TABLES;   -- 要看到 accounts / wx_accounts / progress / sessions …
```

只剩系统库那四张（`character_sets` / `collations` 之类）= 上面 `USE` 没生效，
或 § 3.1 的库压根没建。

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
| `X-WX-SERVICE` | 云托管的**服务名**，如 `poem-wx` | 云托管控制台 → 服务管理 → 服务名 |

⚠️ 把云托管那个数字环境 ID（`326045-4-1502724481`）填进 `config.env` 是最常见的错，
平台回 `env not exists`，看着像环境没建。

**服务名不是固定值，以你实际建的那个为准。** 上面 `poem-wx` 是**本仓库当前那套部署**用的名字
（云托管 → 服务列表里那一行），文档早先举例写的是 `poem-api`，那只是形状示例 ——
照抄示例而服务叫别的名字，平台回 `service not found`，看着像服务没部署。

**环境 ≠ 服务**：`poem` 是**环境**名（`poem-d9g1bqeq978682c58` 那个前缀就是从它来的），
`poem-wx` 才是**服务**名。这两格一个要环境、一个要服务，别互相填串。

### 6.2 在小程序里配

小程序 → **我的 → 用户与权限** → 拉到底「云调用（不用域名，也不用备案）」
两张输入框，填上 6.1 的两个值，点「保存云调用配置」。

⚠️ 这一页在**小程序自己**里头（`packages/admin/index/index`），不在 mp.weixin.qq.com 后台。
微信公众平台那个 [`/wxamp/cloudservice/`](https://mp.weixin.qq.com/wxamp/cloudservice/) 是
**云开发 / 云托管服务**的开通与配额页，没有这个表单 —— 指路指错了地方。
入口要**先登录**：未登录时「数据与账号」那张卡不整块显示，「用户与权限」那一行也就不在。

**谁看得到这一页**：「用户与权限」那一行所有登录用户都看得见，但**里面那张「云调用」卡
不是所有用户的**。管理页整块裹在 `wx:if="{{!logged}}"` 的 else 里，普通用户（Free 档）
看到的只有「我的授权」与「能力矩阵」，没有同步服务器、也没有云调用那两格。
能拉到两格的人 = 至少 admin；写不进也不影响别人，见下条。

**这两格不是平台配置项，是本机设置**：值存在**这台手机的本地存储**里
（`store.KEYS.auth` → `auth.cloud`），只是借「云调用」来称呼 `wx.cloud.callContainer` 这条路。
所以它不经过微信后台任何一个配置项（在 mp 后台找不到是正常的），
也不影响线上服务或别的用户 —— 换台手机要重填一次。

**`baseUrl` 留空，request 合法域名也空着** —— 两个都填时以 `baseUrl` 为准。

## 七、验

```bash
# ① 会话认得出来 —— 回 E_NO_SESSION 就是服务端的 tokenOf() 没上
curl -s -X POST https://<域>/api/sync/pull \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'content-type: application/json' -d '{"deviceId":"d1","since":0}'

# ② 那一行真的落库了（DMS 里查的话，别忘了 `USE \`poem\`;` —— 同 § 四）
# select poem_id, payload from progress where poem_id = 'settings:v1';
```

③ 换台手机登同一个微信，进度与设置认回来。

判据是**查库**，不是界面写「已同步」。特别是**登录**这一步：库里没有新的
`accounts` / `wx_accounts` 行，就是没真的登录（没连上服务器时客户端会明说，
不会再报「已登录」—— Issue #121）。

⚠️ **`select` 得到空 = `MYSQL_HOST` 那几项没生效**（服务端退回了内存档，
数据只活在进程里、一重启就没）。这一条要单独排一次，因为它的症状是
「界面一切正常、换台手机也有，但服务一重启数据全没了」—— 而那时候
你已经在怀疑别的东西了。

⚠️ **头像查不到是正常的**：它只有一个来源（微信那张 `chooseAvatar` 的临时路径）
且**只落本机、不上传**（Issue #111）。所以 `progress` 里**没有** `profile:v1` 那一行，
换台手机头像就是没有 —— 这是刻意的，不是没同步成功。

## 八、发档位

第一个管理员直接在库里把 `accounts.role` 改成 `owner`，其余人由这个 owner 在管理页发。

## 八点五、上传体验版（流水线上这一步，要三样凑齐）

`main` 流水线的「上传体验版」那一步走的是 `scripts/upload.js` + `miniprogram-ci`，
它要三样东西同时成立，缺哪样都会红在那一步：

| | 在哪儿 | 缺了会怎样 |
|---|---|---|
| `WX_APPID` | 密钥仓库 `wechat-ci.yml` | 那步自己先说「读不到 WX_APPID」并列出已注入的变量名 |
| `WX_PRIVATE_KEY_B64` | 同上，**代码上传密钥**的 base64 | 同上；解码不是 PEM 时当场说清（不会拿「密钥无效」糊过去） |
| 密钥与 appid **对得上号** | 公众平台 | 平台回 `20003 … appIdToAppuin failed`，见下 |

⚠️ **那一步是 `allow_failure: true`** —— 它红了**流水线照样是绿的**。别拿流水线颜色
当判据，要翻那一步的日志找 `✗✗✗` / `✓✓✓` 两块横幅（自检 V46b 守着这两块横幅）。

### 平台回 `20003 checkIpInWhiteList Failed: "appIdToAppuin failed"`

这句话**不是它字面上的意思**：不用去查 IP 白名单，也不用去查 appid 拼错。
`appIdToAppuin` 是「appid → 主体账号」这一步映射，**建不起来**说明公众平台
不认「这枚上传密钥属于这个 appid」。

实测过的那一次（`cnb-hat-1k4k8oanv`），根因是密钥与 appid 换了其一、或密钥下到
别的小程序去了。逐条排：

1. **appid 对不对**：流水线里用的是 `WX_APPID`，本地那份是
   `miniprogram/project.config.json` 的 `appid`（现在是 `wx200a0c667fc67fcb`）。
   `upload.js` 会把两者逐字比对 —— 不一致它自己会拦下，所以两处一致不代表
   这枚 appid 就是你以为的那一枚。
2. **这枚 appid 是不是你能操作的那个**：mp.weixin.qq.com → 登录 → 账号信息里
   核对 appid；「成员管理 → 开发成员」里要能看到你。个人主体**拿不到**某个
   appid 时，就是这里露馅。
3. **密钥是不是这个 appid 名下的**：公众平台 → **开发管理 → 开发设置 →
   小程序代码上传** → 生成/重置密钥。**重置了就的密钥立刻失效**，
   而且新密钥要重新 base64 再写进密钥仓库。
4. **两样一起换**：appid 变了，密钥必须跟着换；密钥换了，别再用旧的 base64。
5. 换完**重跑这条流水线**（那一步不做缓存，重跑就会重新用新密钥）。

> IP 白名单是**另一回事**：密钥那一栏如果填了 IP 白名单，回的是
> `invalid ip` 那类话（不带 `appIdToAppuin`），碰见那种才需要放行出口 IP。
> 两种话都是 `checkIpInWhiteList Failed:` 开头 —— 看**后半句**才分得清。

`upload.js` 现在会把这几句话翻成人话（见脚本里的 `explain()`），
流水线日志里直接带着「怎么办」，不必回来翻这一节。

---

---

## 出问题了先看这里

| 现象 | 原因 | 处理 |
|---|---|---|
| 昨天还好，今天打不开 | 免费档缩容到 0 实例 | 加个定时探活打 `/healthz`，5 分钟以上一次 |
| 同上 | 「公网访问」被关回去了 | 服务设置 → 基础信息里打开 |
| curl 也不通 | 服务没起来 / 公网访问关着 | 看服务日志与实例数 |
| curl 通、真机不通 | 云调用两栏填错，或配置里还留着 `baseUrl` | `baseUrl` 优先于云调用，留空 |
| 平台回 `env not exists` | `config.env` 填了云托管的数字环境 ID | 换成云开发环境 ID（§ 6.1） |
| 平台回 `service not found` | `X-WX-SERVICE` 填成了环境 ID，或填了别处看到的名字 | 填云托管**服务名**，逐字以「服务管理」里那个为准（本部署是 `poem-wx`，§ 6.1） |
| 管理页只剩「我的授权」，找不到云调用那两格 | 当前档位不是 admin/owner（那两格只在管理页里） | 先按 § 八 发档位；云调用是运维配置，本就不该给所有用户 |
| 填完云调用，换台手机要重填 | **正常**：那两格存在本机存储，不是服务端配置 | 它只影响这台手机怎么连后端，不是线上服务的设置项 |
| 登录通但同步一律 401 | 服务端没认 `Authorization: Bearer` | 见 [`wx-login-server.md`](wx-login-server.md) |
| 上传体验版回 `20003 … appIdToAppuin failed` | 上传密钥不是这个 appid 名下的（密钥/appid 换过其一） | § 八点五：重新生成代码上传密钥 + 核对 appid + 重跑流水线。**不是** IP 白名单的问题 |
| 上传体验版回 `checkIpInWhiteList Failed: invalid ip` | 密钥设了 IP 白名单，构建机出口 IP 不在里面 | 放行构建机出口 IP，或把密钥那栏的白名单留空 |
| **点一下登录就「成功」了，但库里没有新行** | 两格没填 / 填错 → 客户端没打到服务端。**Issue #121 又踩了一次这个坑**，而当时界面把它报成了「已登录」（空壳登录），用户只能靠翻数据库才发现 | § 6.1 / § 6.2 把两格填对。**已经不会静默成功了**：没连上时界面明说「还没接上同步服务器」，`profile.logged` 也保持 false（见下条）。填好两格后管理页会自动补上那次登录，不必再去点一次 |
| 没连上服务器时的正确长相 | 点登录 → 弹「还没接上同步服务器」，`数据与账号 → 同步进度` 的副标题写「同步服务器没接上（云调用两栏）」。「我的」页顶部**仍显示未登录** —— 这是对的，不是坏了 | 去 § 6.2 填两格。本机那份进度一字不丢，接上之后第一次同步会带上去 |
| 流水线红在 `clone poem`，报 `Repository Not Found.` | 凭据不被接受，不是路径错 | `.cnb.yml` 里已留了不带凭据的退路（`poem` 匿名可读） |
| 流水线红在 `build & push`，报 `invalid reference format` | `.cnb.yml` 的 `env:` 里写了 `${VAR:-default}` | CNB 只替换 `$VAR`，`env:` 的值只能写字面量 |
| 云托管拉镜像报 401 Unauthorized | ① tag 根本没构建出来（CNB 对匿名请求一律回 401，不区分「没权限」和「不存在」）；② tag 在，但槽位私有、没配凭据 | 先查 tag：`cnb registries list-package-tags --slug npu-gpu-cpu/poem-wechat-mini-program --type docker --name npu-gpu-cpu/poem-wechat-mini-program/wx-api`。没有 → 回 § 1；在、还是 401 → § 2.5 |
| **服务一重启，用户数据全没了** | `MYSQL_HOST` 那几项没配 / 配错 → 服务端退回了内存档 | § 3.1。看服务日志里那句话：`[store] 没配 MYSQL_HOST —— 退回 poem 默认的存储层`。配好了它会打 `[store] 存储层 = 腾讯云 MySQL <host>:<port>/<db>` |
| 服务日志报 `配了 MYSQL_HOST 但镜像里没有 mysql2` | 镜像里那个依赖没装上 | 那是 `deploy/Dockerfile` 的 `npm install … mysql2` 那步；重推一次 `main` 出镜像 |
| 服务日志报 `ER_NO_SUCH_TABLE` | 建表语句没跑（或只跑了一半） | § 四，把 `deploy/sql/mysql-schema.sql` 整段重跑一遍（幂等） |
| 容器起不来，报 `Back-off restarting failed container`，日志里是 `Cannot find module './_lib/…'` 或 `'./_routes/…'` | 镜像里的 `api/` 是**空壳** —— 构建上下文的白名单只放行了 `api/` 根那层（`!api/**` 不跨层），底下没进去 | 这一版已修（白名单逐条放行 `api/_lib/**` 与 `api/_routes/**`，`.cnb.yml` 在 build 前按 `api/_lib/routes.js` 那张表核一遍）。旧镜像要**重推一次 `main`** 取新的；别去改容器的启动命令，它救不了缺文件 |
| 同上，但报的是 `Cannot find module './shard-api.js'` | 白名单没放行那一个文件（Issue #115） | 同上，重推 `main`。`shard-api.js` 是 `serve-api.js` 在**启动那一刻** require 的，`/healthz` 探活看不到这一份 |
| **DMS 里只能选系统库**（`information_schema` / `mysql` / `sys` / `performance_schema` / `__cdb_recycle_bin__`） | 库压根没建 —— 那五个是 MySQL 自己的 | § 3.1，先 `CREATE DATABASE \`poem\``。**别将就在 `mysql` 库里建表** |
| SQL 窗口报 `No database selected` | 没切当前库 | § 四：执行前 `USE \`poem\`;`（`SELECT DATABASE();` 确认） |
| 服务日志报 `ER_BAD_DB_ERROR` | `MYSQL_DATABASE` 与真建的库名不是同一个 | § 3.1：建的库名与环境变量逐字对上，然后**重部署**让新变量生效 |
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
