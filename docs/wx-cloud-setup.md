# 云托管：一步步部署

后端代码在 [`poem`](https://cnb.cool/npu-gpu-cpu/poem) 的 `api/` 里，**不在本仓库**。
本仓库只有部署描述（`deploy/`），镜像由 CNB 流水线构建（源码取 `poem`）。

照着做就行，只有一条路：

```
把代码合进 main（镜像自动构建，同时推一份到 GHCR）
  → 云托管按镜像部署（地址填 ghcr.io 那份，不用配凭据）
  → 配环境变量 → 建 wx_accounts 表 → 加 request 域名 → 填 baseUrl → 验
```

⚠️ **两份镜像地址别搞混**（Issue #71 之后流水线一次出两份）：

| | 地址 | 云托管能直接用吗 |
|---|---|---|
| GHCR（**要填这份**） | `ghcr.io/ashleyzhang2028/poem-wx/wx-api:<poem 短 sha>` | ✅ 公开包，**不用配拉取凭据** |
| CNB 制品库 | `docker.cnb.cool/npu-gpu-cpu/poem-wechat-mini-program/wx-api:<本仓库短 sha>` | ⚠️ 私有（跟着代码仓库走），**必须配凭据** |

两份是**同一棵树**，功能没有任何差别。差别只在「谁拉得动」与「tag 是谁的 sha」。
下面 § 1 说的就是这件事，§ 2.5 是那份备用地址要配凭据时怎么配。

---

## 一、部署

```
① 合 main（镜像自动构建，同时出一份 GHCR 公开包）
② 建服务、按镜像部署，填 **ghcr.io 那份**地址 + 8080
③ 配环境变量
④ 建 wx_accounts 表
⑤ 探活 /healthz → 加 request 合法域名 → 填 baseUrl → 验
```

⚠️ 只有走**备用地址**（CNB 私有槽位）时才多一步「配拉取凭据」—— § 2.5。
主路不用，因为 GHCR 那份是公开包。

### 1. 把代码合进 `main`，镜像自动构建

```bash
git checkout main && git pull
```

推 `main` 就触发流水线 `.cnb.yml` 的「发布（自检 → 镜像 → GHCR → 体验版）」，
跑完出**两份**镜像 —— 同一棵树，两个地址：

```
docker.cnb.cool/npu-gpu-cpu/poem-wechat-mini-program/wx-api:<本仓库 commit 前 8 位>   # 私有，要凭据
ghcr.io/ashleyzhang2028/poem-wx/wx-api:<上游 poem 的 commit 前 8 位>                  # 公开，不用凭据
```

**注意两个 tag 不是同一个 sha**：CNB 那份记的是本仓库这一版，GHCR 那份记的是
「这一版后端来自 poem 的哪一次提交」（两者本来就不是一回事，见 `deploy/README.md` 的 REV）。

⚠️ **「选哪个地址」的门槛只有一个：镜像仓库公开不公开。** CNB 的 Docker 制品库
可见性**跟着代码仓库走**（官方文档「权限管控」原话：Docker/Helm/Docker Model 制品的
可见性与所托管的代码仓库一致）—— 本仓库是 Private，制品就是私有，云托管要拉就得配
一对凭据。GHCR 那份是公开包，所以**主路走它，省掉 § 2.5 整节**。

（云托管报「仅支持拉取公开镜像」时别急着建凭据：那是它没找到公开的那一份。
换 ghcr.io 这个地址即可。反过来说，**把 CNB 仓库改 public 当然也能解决**，
代价是整个仓库连同全部历史都公开 —— 这个仓库里只有小程序前端与部署描述，
没有密钥，但也没必要为了一个镜像槽位公开整个仓库。）

**先确认镜像真的构建出来了**，再去控制台建服务 —— 这一步漏了，下一步那栏填什么都是白填：

- 仓库「流水线」页：`main` 那条「发布（自检 → 镜像 → GHCR → 体验版）」得有**绿的**记录
- 制品库页：CNB 的 `wx-api` 槽位下有那个 `<本仓库短 sha>`
- GitHub 的包页：`ghcr.io/ashleyzhang2028/poem-wx/wx-api` 下有那个 `<poem 短 sha>`，
  且 Package settings 那页把它设成 **Public**（第一次推完要手动点一下，之后不用管）

⚠️ **推 GHCR 那一步要的两个密钥，其中 `GHCR_TOKEN` 必须是 classic PAT。**
GitHub 官方原话是 *GitHub Packages only supports authentication using a personal
access token (classic)*，所以**在 fine-grained token 的 Permissions 里找不到
Packages 那一栏 —— 它不在那儿，不是菜单藏得深**。`write:packages` 是 classic 的
老式 scope，走这个链接建（只勾它一个）：
<https://github.com/settings/tokens/new?scopes=write:packages>。

| 用途 | 密钥名 | 哪种 token | 权限 |
|---|---|---|---|
| 推 `ghcr.io` 镜像 | `GHCR_USER` / `GHCR_TOKEN` | **classic** | `write:packages` |
| 同步代码到 `poem-wx` | `GH_PAT` / `GH_REPO` | fine-grained | `Contents: Read and write` |

这两组是**两种不同的 token**，不能互相顶替：同步要的 `contents` 与推包要的
`packages` 在两个体系里是分开的。顺带一句 classic 的坑：UI 上勾 `write:packages`
会顺手把范围过宽的 `repo` 一起勾上，用上面那个带 `?scopes=` 的链接就没这问题。

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
| 镜像地址 | `ghcr.io/ashleyzhang2028/poem-wx/wx-api:<poem 短 sha>`（公开包，不用凭据） |
| 端口 | `8080` |

⚠️ 「镜像地址」这一栏就是 UI 上写着**「仅支持拉取公开镜像」**的那一栏 ——
那句话不是让你去公开代码仓库，是在说「这个地址得是个公开的镜像仓库」。
GHCR 那份满足它，所以下面 § 2.5 整节可以跳过。

首次进入如果看到一排框架模板（Express / Spring Boot…），那是「无门槛部署」的脚手架页，
**不要选**，走「新建服务」这条路。

控制台要你选的不是「代码从哪来」那一问，而是**「六选一」**那一栏：绑定 GitHub / GitLab /
Gitee 仓库、手动上传代码包、从镜像仓库拉取镜像、从地址拉取镜像。选错一个，后面全是死路：

| 那一栏选 | 会怎样 |
|---|---|
| 绑定 GitHub / GitLab / Gitee 仓库 | **都不行**。远端仓库里没有这份代码 —— 后端在 `poem` 的 `api/`，那三个平台上也都没有它 |
| 手动上传代码包 | **不行**。传上去的是小程序前端，容器里没有后端可跑 |
| **从地址拉取镜像** | ✅ **就选这个。** 镜像已经在 CNB 流水线里构建好了，填下面那行地址即可 |
| 从镜像仓库拉取镜像 | 除需配凭据、且通常要选具体制品库类型（如 GitHub Container Registry）。GHCR 这份按「从地址拉取」填更省事 |

「从地址拉取镜像」要填的只有**镜像地址**与**端口**，**没有「目标目录」那一栏**。

⚠️ **「目标目录」那一栏不存在** —— 上面这张表里有哪几栏，就填哪几栏。
「目标目录 / 容器目录」（需要构建的代码目录，与 Dockerfile 同级）只在
「部署方式 = **代码仓库**」那条路上才出现（就是上面的「绑定 xx 仓库」与「手动上传
代码包」）：那条路要 clone 代码、按目录找 Dockerfile 现构建，所以得告诉它 Dockerfile
在哪个子目录。**选了「从地址拉取镜像」，代码已经构建完了，那一栏连显示都不会有。**

真在控制台里翻到「目标目录」，说明上面「部署方式」那格不是**镜像** ——
回去改掉，别去琢磨那一栏该填什么。它**留空对应的是「Dockerfile 就在仓库根」**，
而本仓库根上既没有 `Dockerfile`（那份在 `deploy/`），更没有 `api/`：填
`deploy` 也构建不出来，Dockerfile 里 `COPY api` 在仓库里找不到那个目录。

镜像那一栏要填**具体版本号**，别填 `latest` —— 回滚时才知道该填回哪个。

⚠️ **镜像地址写对了，不等于镜像存在。** 这一点在**私有**地址上最阴：云托管拉一个
不存在的私有地址，回的不是「找不到」而是 `401 Unauthorized`
（CNB 制品库对匿名请求统一如此，不区分「没权限」和「不存在」）。GHCR 那份是公开的，
「不存在」就老实报 `manifest unknown` —— 也是省事的一条。

```
unexpected status from HEAD request to https://docker.cnb.cool/v2/.../manifests/<tag>: 401 Unauthorized
```

这行有**两种成因，长得一模一样**：tag 不存在，或者存在但没带凭据。
先看两者共同的判据 —— **制品库页面上到底有没有那个短 sha**：
没有 → 回上面第一步查流水线；有 → 是凭据问题，见 § 2.5。
（这两句只针对 `docker.cnb.cool` 那个备用地址；GHCR 那份不吞这个区别。）

⚠️ **别选「六选一」里那四项「代码从哪来」**（绑定 GitHub / GitLab / Gitee 仓库、
手动上传代码包），两条都走不通：

- 指本仓库 → 它按被部署仓库的根找 Dockerfile，那儿没有 `api/`（后端代码也不在这个仓库里）
- 指 `poem` → 容器里跑的是「静态站 + API 一个进程」的全量版，构建上下文 49MB，
  而小程序一条静态资源都不读

再说一遍那条判据：**一旦界面上要你填「目标目录」，就说明选错了部署方式。**
镜像这条路上没有那一栏。

### 2.5 拉镜像的凭据（只走备用地址时才需要）

⚠️ **走 § 2 那个 ghcr.io 地址的话，这一节整节不用看。**
这节是给**备用地址**用的：CNB 私有槽位（`docker.cnb.cool/...`）。

CNB 制品库里的 `wx-api` 是**私有**的（跟着代码仓库走，见 § 1）。云托管要拉，
得给它一对凭据 —— **「镜像地址填对了」和「拉得动」是两件事。**

配在**控制台 → 服务设置 → 部署配置 → 镜像仓库凭据**（各版本文案略有出入，
找带「镜像 / 拉取 / 凭据」的那几栏）：

| 字段 | 填什么 |
|---|---|
| 仓库地址 | `docker.cnb.cool`（**只有域名**，不带路径、不带 `https://`） |
| 用户名 | `cnb` |
| 密码 | 一枚 **CNB 访问令牌**（不是登录密码） |

⚠️ **用户名是固定的三个字母 `cnb`，不是你的 CNB 账号名。** 反直觉，但 CNB 的
Git 与制品库认证统一是这套（官方文档原话：访问代码仓库和访问制品库，
**用户名为 `cnb`，密码为访问令牌**）。填账号名或邮箱会认证失败。

密码那枚令牌怎么来：

1. 登录 CNB → 右上角头像 → **个人设置** → **访问令牌** →
   [添加访问令牌](https://cnb.cool/profile/token)
2. **「使用范围」选「指定仓库」→ `npu-gpu-cpu/poem-wechat-mini-program`**
   （「常见场景」选「制品库」时，默认只开 `registry-package` 的读写权限，正好够；
   需求只有「拉」，给只读也行）
3. 建好**当场复制**，那一串只显示这一次

⚠️ **不配的后果**是这一行：

```
unexpected status from HEAD request to https://docker.cnb.cool/v2/.../manifests/<tag>: 401 Unauthorized
```

它和「那个 tag 根本不存在」**报的是同一句话**，所以别急着配凭据 ——
**先确认制品库里真有那个 tag**，判据在 § 二「出问题了先看这里」第一条。

⚠️ **凭据不在「环境变量」那一栏。** 环境变量（`SESSION_SECRET` / `WX_APPID`…，
见 § 3）是**给容器里跑的进程用的**；拉取凭据是**平台去镜像仓库拉镜像时用的**，
两者是两处，别在环境变量里加 `CNB_USER` / `CNB_TOKEN` 那两行 —— 加了也拉不到镜像，
只会让人以为配过了。

⚠️ 这对凭据**只给云托管用**，别写进仓库、别写进 `.cnb.yml`。
流水线自己推镜像用的是 `${CNB_TOKEN}`（`.cnb.yml` 里那句 `docker login`），两回事。

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

**流水线红在 `build & push`、报 `invalid reference format`** —— 报错里那串
tag **原样带着 `${...:-...}`**，就是这条（Issue #100）：

```
ERROR: failed to build: invalid tag
"${GHCR_IMAGE:-ghcr.io/ashleyzhang2028/poem-wx/wx-api}:36ad9fe":
invalid reference format
```

值没被展开，直接拼进了镜像 tag。根子在 `.cnb.yml` 的 `env:` 那一栏：
**CNB 的环境变量替换只认 `$VAR`**（文档「环境变量 → 变量替换」），
`${VAR}`、`${VAR:-default}` 都**不在它的语法里** —— 不认的形态既不报错
也不清空，**原样当普通字符串留下**。而变量值**不会再被二次展开**，于是
一直留到 docker 才炸。

⚠️ 这和 `script:` 里的 `${VAR:-x}` **不是一回事**（那是 shell 的，是对的）——
同一个写法在两个地方含义相反，别一起改。药方是 `env:` 的值只写**字面量**、
想换槽位就改那一行；自检里有一条专门守这个（`env:` 的值里不许出现
`${VAR:-...}`）。

**云托管从地址拉镜像报 401 Unauthorized** —— 两种可能，别只看一种：

1. 那栏填的镜像**还没构建出来**（`manifests/<tag>: 401 Unauthorized` 就是这条）。
   CNB 制品库对匿名请求一律回 401，不区分「没权限」和「不存在」，
   所以别急着翻凭据 —— 先回 § 1 第一步：`main` 的发布流水线跑绿了吗？
   `registries list-packages` 或 CNB「制品库」页，`wx-api` 槽位下有那个短 sha 吗？
2. 制品库里确实有那个 tag，但**对云托管是私有、没配拉取凭据** —— 见 § 2.5。
   （私有槽位这条**文档原先没写**，是 Issue #71 现场补上的：制品库里
   `6fd88860` 确实在 —— 2026-10-09 21:18 推的 —— 而云托管 21:19 拉它还是 401。）

**怎么把两种分开**：两条判据一起看。

**① 快路（先做）** —— `cnb registries list-package-tags` 查那个 tag 在不在：

```bash
cnb registries list-package-tags --slug <org>/<repo> --type docker --name <repo>/wx-api
```

没有 → 第 1 种，回 § 1 第一步看流水线，此时配凭据是白配。
在、还是 401 → 第 2 种，见 § 2.5。

**② 旁证** —— 流水线日志里 `[auth] ... DONE` 说明匿名令牌那步是通的（第 2 种）。

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
