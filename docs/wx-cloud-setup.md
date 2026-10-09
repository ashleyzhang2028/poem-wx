# 云托管：一步步部署

后端代码在 [`poem`](https://cnb.cool/npu-gpu-cpu/poem) 的 `api/` 里，**不在本仓库**。
本仓库只有部署描述（`deploy/`），镜像由 CNB 流水线构建（源码取 `poem`）。

照着做就行，只有一条路：

```
把代码合进 main（镜像自动构建） → 云托管按镜像部署 → 配环境变量 → 建 wx_accounts 表 → 加 request 域名 → 填 baseUrl → 验
```

---

## 一、部署

### 1. 把代码合进 `main`，镜像自动构建

```bash
git checkout main && git pull
```

推 `main` 就触发流水线 `.cnb.yml` 的「发布（自检 → 镜像 → 体验版）」，跑完出镜像：

```
docker.cnb.cool/npu-gpu-cpu/poem-wechat-mini-program/wx-api:<本仓库 commit 前 8 位>
```

短 sha 就是版本号，回滚时把旧的那个填回云托管那栏即可。

**先确认镜像真的构建出来了**，再去控制台建服务 —— 这一步漏了，下一步那栏填什么都是白填：

- 仓库「流水线」页：`main` 那条「发布（自检 → 镜像 → 体验版）」得有**绿的**记录
- 制品库页：`wx-api` 槽位下得有那个 `<短 sha>` 的 tag

⚠️ 这条流水线的第 1 步是 `git clone` 取 `poem` 的 `api/`，**不带凭据**。
`poem` 匿名可读，去掉凭据才通；带上 ${CNB_TOKEN} 反而回
`remote: Repository Not Found.`（退出码 128），而**镜像槽位不会有任何变化** ——
看着就像「流水线没跑」，实际是第 1 步就断了。

### 2. 建服务，按镜像部署

[cloud.weixin.qq.com](https://cloud.weixin.qq.com) → **云托管 → 服务管理 → 新建服务**。

| 字段 | 填什么 |
|---|---|
| 归属环境 | 没有就这一步新建（地域就近，如上海） |
| 服务名称 | 随便，如 `poem-api` |
| 部署方式 | **镜像** |
| 镜像地址 | `docker.cnb.cool/npu-gpu-cpu/poem-wechat-mini-program/wx-api:<短 sha>` |
| 端口 | `8080` |

首次进入如果看到一排框架模板（Express / Spring Boot…），那是「无门槛部署」的脚手架页，
**不要选**，走「新建服务」这条路。

⚠️ **「目标目录」那一栏不存在** —— 上面这张表里有哪几栏，就填哪几栏。
「目标目录 / 容器目录」（需要构建的代码目录，与 Dockerfile 同级）只在
「部署方式 = **代码仓库**」这条路里才出现：那条路要 clone 代码、按目录找 Dockerfile
现构建，所以得告诉它 Dockerfile 在哪个子目录。**选了镜像，代码已经构建完了，
那一栏连显示都不会有。**

真在控制台里翻到「目标目录」，说明上面「部署方式」那格不是**镜像** ——
回去改掉，别去琢磨那一栏该填什么。它**留空对应的是「Dockerfile 就在仓库根」**，
而本仓库根上既没有 `Dockerfile`（那份在 `deploy/`），更没有 `api/`：填
`deploy` 也构建不出来，Dockerfile 里 `COPY api` 在仓库里找不到那个目录。

镜像那一栏要填**具体版本号**，别填 `latest` —— 回滚时才知道该填回哪个。

⚠️ **镜像地址写对了，不等于镜像存在。** 云托管拉一个不存在的私有地址，回的不是「找不到」
而是 `401 Unauthorized`（CNB 制品库对匿名请求统一如此，不区分「没权限」和「不存在」）。
于是现象很像凭据问题，其实只是**那个 tag 还没构建出来**。

看到这行就去查上面第一步，别去翻云托管的凭据设置：

```
unexpected status from HEAD request to https://docker.cnb.cool/v2/.../manifests/<tag>: 401 Unauthorized
```

⚠️ **别选「部署方式 = 代码仓库」**，两条都走不通：

- 指本仓库 → 它按被部署仓库的根找 Dockerfile，那儿没有 `api/`（后端代码也不在这个仓库里）
- 指 `poem` → 容器里跑的是「静态站 + API 一个进程」的全量版，构建上下文 49MB，
  而小程序一条静态资源都不读

再说一遍那条判据：**一旦界面上要你填「目标目录」，就说明选错了部署方式。**
镜像这条路上没有那一栏。

### 3. 配环境变量

云托管 → 服务设置 → **环境变量**：

```
# 缺了 /api/* 一律 503 E_NOT_CONFIGURED
SESSION_SECRET=<openssl rand -hex 32>

# 缺了降级内存存储，实例一重启账号进度全丢（要 service_role，不是 anon）
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=<service_role key>

# 缺了登录回 503 E_WX_NOT_CONFIGURED
WX_APPID=wx200a0c667fc67fcb
WX_SECRET=<小程序 appsecret>
```

具体哪些键写在服务端：`poem` 的 `api/_lib/config.js`。

### 4. 建 `wx_accounts` 表

Supabase 控制台 → SQL Editor → 跑建表语句（在
[`wx-login-server.md`](wx-login-server.md#要用到的那张表)）。

⚠️ 这张表**不在 `poem` 的 `api/_lib/schema.sql` 里** —— 那份是网页版的，网页版不动。
它是小程序这一层单独加的，所以要单独建一次。

### 5. 探活

```
https://<env>.ap-shanghai.run.tcloudbase.com/healthz   →  应回 ok
```

⚠️ 别拿 `/` 当判据：这份镜像**没有静态站**，`/` 就是 404。

⚠️ 「公网访问」默认可能是关的（服务设置 → 基础信息）。关着不是 404，是域名解析不到。
先确认它开着，再去拿域名。

### 6. 加 request 合法域名

```
mp.weixin.qq.com → 开发 → 开发管理 → 开发设置 → 服务器域名
→ request 合法域名 → 加 https://<env>.ap-shanghai.run.tcloudbase.com
```

默认域是腾讯的、已备案，能直接填。（每月修改次数有上限，想清楚再存。）

### 7. 小程序里填 baseUrl

小程序 → **我的 → 管理** → 「同步服务器地址」填同一个域。不用改代码。

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

第一个管理员直接在库里把 `accounts.role` 改成 `owner` —— 小程序端没有这个口，
也不该有（能在客户端点出来的提权就是漏洞）。其余人的档位由这个 owner 在管理页里发。

---

## 二、出问题了先看这里

**「昨天还好，今天就打不开」** —— 三条独立原因，按顺序查：

| # | 原因 | 判据 / 处理 |
|---|---|---|
| 0 | 流水线第 1 步 `git clone poem` 就断了 | 镜像槽位**一直不新增**。带上 `${CNB_TOKEN}` 会回 `Repository Not Found.`（128）—— 去掉凭据即可（`poem` 匿名可读）。判据：看该次构建里 `clone poem` 这一步 |
| 1 | 免费档缩容到 0 实例（最像「失效」的一条） | 冷启动期间外部访问全失败，而控制台还写着「运行中」。给个定时探活打 `/healthz`，5 分钟以上一次 |
| 2 | 「公网访问」被关回去了 | 重建服务 / 换环境会把它关掉。关着是**解析不到**，不是 404 |
| 3 | 域名没进 request 合法域名 | curl 通、**真机不通**就是这条（开发者工具勾着「不校验合法域名」看不出来） |

**一句话区分**：curl 也不通 → 1 或 2；curl 通、真机不通 → 3。

**登录通但同步一律 401** —— 服务端没认 `Authorization: Bearer`，见
[`wx-login-server.md`](wx-login-server.md)。

**云托管从地址拉镜像报 401 Unauthorized** —— 两种可能，别只看一种：

1. 那栏填的镜像**还没构建出来**（`manifests/<tag>: 401 Unauthorized` 就是这条）。
   CNB 制品库对匿名请求一律回 401，不区分「没权限」和「不存在」，
   所以别急着翻凭据 —— 先回 § 1 第一步：`main` 的发布流水线跑绿了吗？
   `registries list-packages` 或 CNB「制品库」页，`wx-api` 槽位下有那个短 sha 吗？
2. 制品库里确实有那个 tag，但**对云托管是私有、没配拉取凭据** —— 这时才去配凭据。

**流水线红在 `clone poem` 那一步、报 `Repository Not Found. / 仓库不存在。`** ——
那不是路径写错，是**凭据不被接受**。流水线里的 `CNB_TOKEN` 范围跟触发事件走，
未必覆盖到第二个仓库（`poem`）；而带一个不被接受的凭据去 clone，
**连匿名可读的仓库也会被拒成「不存在」**。

判据很好分：同一个地址，**去掉凭据能 clone 下来**，就是这个原因。

```
$ git clone --depth 1 "https://x:y@cnb.cool/npu-gpu-cpu/poem.git" /tmp/t   # → Not Found
$ git clone --depth 1 "https://cnb.cool/npu-gpu-cpu/poem.git" /tmp/t       # → 成功
```

`.cnb.yml` 里已经按这个写死了退路：带令牌试一次，不成就不带凭据再来。

---

## 三、P.S.：还有两条没走的路

只在你明确想要时才看，走上面那条路不需要它们。

**A. 全量镜像**（容器里连静态站一起跑）：云托管指 `poem` 仓库、用它根上的 `Dockerfile`。
代价是每次部署多传 37MB（26MB 语料 + 11MB 字体），而小程序一条都不读。
账号 / 进度 / 会话上与瘦镜像没有任何区别。

**B. 云开发 / 云调用**：要改客户端代码（`wx.cloud.callFunction` 换掉 `wx.request`，
`PATHS` 那套拼 URL 的写法作废），也就是「后端就绪后只改 baseUrl」这句承诺不再成立。
云调用免域名、免白名单；云开发 HTTP 版还要写一层 `(event, context)` 适配。
**第一次做，直接用上面的云托管。**

不管走哪条，**「request 合法域名」只跟「你用没用 `wx.request` 打 http 域」有关** ——
名单看的是域名，不是后端是谁。
