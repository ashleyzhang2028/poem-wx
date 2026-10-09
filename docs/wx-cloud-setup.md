# 云托管 / 云开发 / 云调用：一步步开通，并让代码接上

> Issue #64 的追问原话：**「告诉我开通云托管、云开发、云调用的详细步骤，一步一步设置完成，我需要代码和设置打通」**。
>
> 这份文档只干这一件事：把三条路各自的**控制台点击顺序**、**要填的代码**、**怎么验**写清楚。
> 后端要补什么（路由 / 表 / 白名单）看 [`wx-login-server.md`](wx-login-server.md)，本文不重复。
>
> **只想照单做完**：[§ 一点五 运维动作清单](#一点五运维动作清单人要做的事照这个顺序做) 是全部
> 要人做的动作，按顺序划完即可。开头的表与 § 一 讲「为什么」，清单讲「做什么」。

---

## 零、先看这张表，再决定走哪条

三条路不是同一个东西的三个名字，是**两种后端** + **一种调用方式**：

| | 云托管 | 云开发 · HTTP | 云开发 · 云调用 |
|---|---|---|---|
| 是什么 | 一个跑你 Docker 的 https 服务 | 云开发给的 https 域名 | `wx.cloud.callFunction` |
| 小程序怎么连 | `wx.request` 打它给的域 | `wx.request` 打它给的域 | `wx.cloud.*`，**不用域名** |
| `baseUrl` 填什么 | 它给的域 | 它给的域 | 不填，填了也不用 |
| request 合法域名 | **要加** | **要加** | **不用** |
| 现成 `remote.js` 能不能跑 | 能，零改动 | 能，零改动 | **不能，要重写 `request()`** |
| appsecret 要不要自己管 | 走内部渠道，可省 | 要 | 要（云函数里 `getWXContext` 可省） |
| 本项目推荐度 | **先跑通就选它** | 同左（更省，但云开发模型重） | 想少运维再选，代价是改客户端 |

**一句话记法**：用 `wx.request` 打 http 域，域名就必须进微信名单 —— 名单看的是域名，不是后端是谁。只有 `wx.cloud.callFunction` 这条路没有域名这回事。

下面三条，**从第一条开始做**。做完一条就真机能跑，不用等三条都懂。

---

## 一、云托管：从零到真机登录跑通

### 1.1 控制台开通

1. 登录 [微信公众平台](https://mp.weixin.qq.com) → 左侧 **云服务 / 云托管**（或直接去 [cloud.weixin.qq.com](https://cloud.weixin.qq.com)）
2. 首次进入要**开通云托管**，选环境地域（就近，如上海）
3. 记下环境 ID，和分到的默认域名，形如
   `https://<env>.ap-shanghai.run.tcloudbase.com`

#### ⚠️ 别被首页那个「选框架」的列表带偏

第一次点进去，很可能**只看到一排框架模板**（Express / Spring Boot / ThinkPHP /
Django / Koa / Flask …），看不到地域、环境、域名 —— 那是 **「无门槛部署」** 的
模板选择页，不是云托管本身的必填项。

模板是给「从零起一个服务」用的**脚手架**（一个现成的 hello-world 仓库）。
本项目**不要选它** —— 我们的后端已经有了（`poem` 的 `api/`，经本仓库的镜像部署），
选模板等于另起一份不是我们的代码。

模板页只负责把你的代码跑成容器，它**既不生成环境、也不发域名**；地区、环境 ID、
默认域名都是**服务建起来之后**才出现的。所以「看不到地域 / 环境 / 域名」不是漏填了什么，
是**顺序还没走到**。

正确入口有两条，任选：

| 走法 | 路径 | 适合 |
|---|---|---|
| 自定义部署（推荐） | 左侧 **云托管 → 服务管理 → 新建服务** | 部署本项目（走镜像，见 § 1.2） |
| 无门槛部署 | 「快速入门 → 无门槛部署」选模板 | 只想先看一个 hello-world 跑起来长什么样 |

**从「新建服务」进去**，依次是：

1. 归属环境 —— 没有环境就**在这一步新建**一个（这里才出现「地域」选项，如上海）
2. 服务名称 —— 随便起，如 `poem-api`
3. 部署方式 —— **先跳过**（或选「手动上传镜像」占个位）。本项目走镜像，真正填法见 § 1.2 那张表；这里不选「代码仓库」—— 理由见 § 1.1 末
4. 建完之后回 **服务设置 → 基础信息**，才看得到「公网访问」开关与**默认域名**

环境 ID 在 **环境设置** 里，默认域名在 **服务设置 → 基础信息**。
两样都不是开通时一次给全的，而是**建完服务才齐**。

⚠️ 默认，「公网访问」可能是**关着**的 —— 关着就没有域名可填，小程序也打不进来。
确认它打开着，再去拿域名。

⚠️ 这默认域**已备案**，能直接填进微信名单 —— 这就是「实在不知道怎么设置域名」的省事解。
代价是它不受你控制，平台换域/回收环境名字就没了。要长期用再绑自有域。

#### 「不用自定义域名，一两天就失效」是怎么回事

用户 2026-10-09 反馈：不绑自定义域名时，服务**一两天就访问不了**。这句话是对的，
但**不是备案或域名过期**，而是三条互相独立的原因 —— 按「先查这个」的顺序：

1. **免费档的实例缩容到 0**（最像「失效」的那一条）。云托管按量计费的环境在
   无流量时会缩到 0 实例，**冷启动期间外部访问全失败**。表现正是「昨天还好、今天就打不开」，
   而控制台里服务还写着「运行中」。判据：日志里有没有冷启动记录。
   规避：**给它一个定时探活**（见下），或把最小实例数设为 ≥1（要钱）。
2. **默认域只在「服务设置 → 基础信息 → 公网访问」开着时才有 DNS**。
   这也是本仓库踩过的坑（§ 1.1 的 ⚠️）：一次重建服务、换环境、或平台侧调整，
   公网访问可能被关回去 —— 关着不是「404」，是**域名解析不到**，看着完全像域名没了。
3. **没进 request 合法域名**。此时 curl / 浏览器能通，**真机微信里一律失败**
   —— 而开发者工具勾着「不校验合法域名」，本机看着一切正常。
   如果「失效」的表现是「工具里能跑、真机不行」，就是这一条，不是域名过期。

**探活怎么写**：打 `/healthz`（只跑 API 的那份镜像）或 `/api/diag`（全量那份），
两者都不拿 `SESSION_SECRET` 缺失当失败 —— 理由见 § 1.2 的第二条。
频率 5 分钟以上一次即可（免费额度下别低于 1 分钟，那是刷自己）。
定时任务可以直接写在 `.cnb.yml` 的 `crontab` 里（`poem` 那边已有同款先例：
Supabase 每 5 天探活，见其 `.cnb.yml` 的 `crontab: 0 3 */5 * *`）。

⚠️ 一句话区分这三条：**「curl 也不通」→ 1 或 2；「curl 通、真机不通」→ 3。**
先做这一步，再去翻平台控制台，能省一轮来回。

#### 部署方式选哪个：**只走镜像**（Git 那条对本项目不成立）

先说结论，免得照上一版文档去填：**本项目云托管只走「部署方式 = 镜像」这一条**，
下面 § 1.2 那张表照填即可。

「代码仓库」那条路有两个坑，本项目一个都避不开：

- **云托管的「代码仓库」部署读的是「被部署仓库根」**。而后端 `api/` 在 `poem`，
  小程序前端在本仓库 —— 哪个仓库的根上都不全。要指 `poem`，那容器里跑的是
  「静态站 + API 一个进程」（全量那份，构建上下文 49MB），不是小程序的瘦后端。
- **它不给你构建容器一把凭据去 clone 第二个仓库**。所以「仓库只放部署描述、
  源码从 `poem` 取」这件事，控制台里做不到 —— 那是 **CNB 流水线**能做的事，
  本项目也正是这么做的（见 § 1.2）。

⚠️ 上一版文档在这里写过「CNB 仓库匿名可读，直接填 `https://cnb.cool/npu-gpu-cpu/poem.git`」——
**那句是错的，已撤。** 匿名可读本身是真的（`poem` 虽然 Private，但匿名拉得下来），
但**云托管指的仓库不是 `poem`**，也对不上本项目的瘦后端。照那句填，得到的是全量那份。

### 1.2 后端怎么进容器：用本仓库的瘦镜像（**照做就行**）

小程序要的后端（账号、进度、会话、`code2Session`）全在
[`poem`](https://cnb.cool/npu-gpu-cpu/poem) 的 `api/` 里 —— **这个仓库里没有后端代码**，
只有**部署描述**。两者的关系是：

```
poem 仓库          后端本体（api/）               ← 唯一一份后端代码
本仓库             部署描述（deploy/ 下的 Dockerfile，
                   deploy-api-serve/ 的服务壳与白名单）
     ↓
CNB 流水线         源码上下文 = poem，Dockerfile 从本仓库取
     ↓
镜像              docker.cnb.cool/npu-gpu-cpu/poem-wechat-mini-program/wx-api:<tag>
     ↓
云托管             部署方式 = 镜像
```

云托管那几栏照抄（**机关在「部署方式」这一栏**）：

| 字段 | 填什么 |
|---|---|
| 部署方式 | **镜像**（不是「代码仓库」） |
| 镜像地址 | `docker.cnb.cool/npu-gpu-cpu/poem-wechat-mini-program/wx-api:<tag>` |
| 端口 | `8080` |
| 环境变量 | `SESSION_SECRET` / `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `WX_APPID` / `WX_SECRET`（§ 1.3） |

⚠️ **别在云托管控制台里指这个仓库**（也就是别填「本仓库 + 容器目录 `deploy`」
那条路）。云托管的「代码仓库」部署是按**被部署仓库的根**找 Dockerfile 的，
而这条路要求「Dockerfile 与 `api/` 在同一个仓库根」—— 本仓库根上没有 `api/`
（小程序前端不是后端）。
上一版文档试过按那条路走，结论是「只剩『把 `poem/api/` 拷一份进来』这一个选择」，
而那份副本正是要撤掉的东西（改完 `poem` 忘了同步 = 线上跑旧代码、而且不报错）。
所以这一版**不走目录那条路**，走镜像。

⚠️ 镜像名里那个 slug 是**本仓库**的：流水线在这个仓库里跑，镜像就推在这个
仓库名下，即使源码来自 `poem`。云托管那边照抄上面那个地址即可。
构建在打 tag 时触发（`.cnb.yml` 的「构建云托管镜像（源码 = poem）」那一节）。
**第一次部署前，先打一个 `v*` tag 把这个镜像构建出来** —— 否则云托管那栏没有
镜像可填。

#### 另一条路：整站都进容器（`poem` 根那份 Dockerfile）

上面那是**瘦镜像**（只跑 `/api/*`，构建上下文 ≈300KB）。如果你想要「静态站 +
API 一个进程跑全」（网页版也搬进容器），`poem` 仓库根有一份全量的
`Dockerfile`（[npu-gpu-cpu/poem#531](https://cnb.cool/npu-gpu-cpu/poem/-/pulls/531)），
云托管那栏改成指 `poem` 仓库、Dockerfile 用默认那个即可 —— 那份是**全量**，
构建上下文 49MB（含 26MB 语料 + 11MB 字体，小程序一条都不取）。

⚠️ 但**小程序端不需要它**：小程序打的那 9 条接口没有一条读 `data/` / `fonts/`。
选全量那份的唯一好处是「一个容器里也有网页版」，代价是每次部署多传 37MB。
两份在**账号、进度、会话**上没有任何区别，差别只在容器里有没有静态站。
详见 [`../deploy/README.md`](../deploy/README.md)。

#### 瘦镜像省掉了什么，以及它的真代价

省掉的只是**每次部署都要上传、而运行时一次都不读**的东西：

| 挡在构建上下文外 | 体积 | 谁在用 |
|---|---|---|
| `data/` | 26 MB | 只有 `/api/game/*`、`/api/exam/*` —— 小程序一条都不打 |
| `fonts/` | 11 MB | 网页版的宋体子集字体 |
| `js/`、页面目录、`css/`、`icons/` | ~2.5 MB | 浏览器 |
| `.git` | 22 MB | 谁都不用 |

⚠️ 代价一条，先看再定：砍掉 `data/` 与 `js/` 之后，
`/api/game/answer`、`/api/exam/records` 会回 **500**（`js/quiz.js` 加载不到，
被兜底 catch 接住）。小程序端两条都不打，所以默认这样；**要语料就别用这份**
（那两条要 `data/` 26MB 加 `js/` 1MB，一起加回来只剩「省个字体」，
不如直接用 `poem` 根那份）。

### 1.3 配环境变量

云托管控制台 → 服务设置 → **环境变量**，至少这两组：

```
# 必须 —— 缺了 /api/* 一律 503 E_NOT_CONFIGURED
SESSION_SECRET=<openssl rand -hex 32>

# 必须 —— 缺了自动降级内存存储，实例一重启账号进度全丢
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=<service_role，不是 anon>

# 微信登录要用的两个（见 wx-login-server.md 的「两条路由」）
WX_APPID=wx200a0c667fc67fcb
WX_SECRET=<小程序 appsecret>
```

⚠️ 云托管里如果走**内部调用渠道**拿 openid，`WX_SECRET` 可以不填，平台替你换
（见 `wx-login-server.md` 末节「关于 appsecret 和云调用」）。
但**别两条路都不做** —— 平台渠道和自建 `code2Session` 选一条。
本项目 `poem` 侧实现的是**自建 `code2Session`**（`api/_lib/core.js`），
所以走它就得把 `WX_SECRET` 配上。

### 1.4 部署

1. 云托管 → 新建服务 → **部署方式选「镜像」**（不是「代码仓库」，理由见 § 1.1 末）
2. 镜像地址填 § 1.2 那张表里的
   `docker.cnb.cool/npu-gpu-cpu/poem-wechat-mini-program/wx-api:<tag>`
   —— tag 用 `.cnb.yml` 打 tag 时构建出来的那个（要回滚就填旧 tag）
3. 端口填 `8080`，触发一次部署，等状态变「运行中」
4. **探活打 `/healthz`**：它回 `ok` 就是进程起来了。
   ⚠️ 别拿根路径 `/` 当判据 —— 这份镜像**没有静态站**，`/` 就是 404（代码里写死的，
   不静默 fallback）。「服务通了」在这一版是 `/healthz` 200，不是「能看到网页首页」。

那几栏的完整写法（含「镜像地址的 slug 为什么是本仓库」）收在
[`../deploy/README.md`](../deploy/README.md)，以那份为准。

## 一点五、运维动作清单（人要做的事，照这个顺序做）

> 这一节是 Issue #71 的后续追问：**「运维步骤也加进去」**。
> 上面 § 1.1–1.4 讲「控制台怎么点」，这里只列**必须由人做、代码侧不用再动**的几件事。
> 做完一项划一项，全做完才算「代码和设置打通」。

| # | 做什么 | 不做的话现象 |
|---|---|---|
| 0 | 先构建一次镜像（打一个 `v*` tag 触发 `.cnb.yml`），拿到 `wx-api:<tag>` | 云托管那栏没有镜像可填 |
| 1 | 配 `SESSION_SECRET`（`openssl rand -hex 32`） | `/api/*` 一律 `503 E_NOT_CONFIGURED` |
| 2 | 配 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`（**service_role，不是 anon**） | 自动降级内存存储，实例一重启账号进度全丢 |
| 3 | 配 **`WX_APPID` / `WX_SECRET`** | 登录回 `503 E_WX_NOT_CONFIGURED`（不是 500，也不是「你 code 不对」） |
| 4 | **建 `wx_accounts` 表**（建表语句在 [`wx-login-server.md`](wx-login-server.md#要用到的那张表)） | 登录回 `503 E_WX_TABLE` 并指路 —— **那句话会原样显示给你看** |
| 5 | 把云托管默认域加进微信「request 合法域名」（§ 1.6） | 开发者工具能跑、**真机一律失败** |
| 6 | 小程序里填 `baseUrl` = 云托管默认域（§ 1.7） | 打不到后端，如实降级 |
| 7 | 把第一个管理员扶成 `owner`：直接在库里改 `accounts.role` | 谁也发不了档位 |

前四项都在**云托管控制台 → 服务设置 → 环境变量**里配（§ 1.3 有模板），
第 4 项的建表在 **Supabase 控制台 → SQL Editor** 跑。

⚠️ **第 4 项为什么单独拎出来**：它是「代码全对、就是不通」的典型 ——
`poem` 侧已经准备好了一句人话（`E_WX_TABLE` 明写「数据库里没有 wx_accounts 这张表，
建表语句见 docs/wx-login-server.md」），客户端也会把这句透传给你看（不是 `HTTP 503`）。

⚠️ **这张表不在 `poem` 的 `api/_lib/schema.sql` 里** —— 那份是网页版的，
网页版一行都不该动。它是小程序这一层新加的，所以建表也要单独做一次。

### 1.5 那两条路由与 Bearer 会话（**已经做完了**）

原先这一节写的是「代码打通的关键，现在还没有」，列了三件待办。**三件都做完了**，
在 [`npu-gpu-cpu/poem#532`](https://cnb.cool/npu-gpu-cpu/poem/-/pulls/532)：

1. `/api/wx/login`、`/api/wx/refresh` 两条路由（`api/_routes/wx/`）
2. 会话同时认 Cookie 与 `Authorization: Bearer`（`api/_lib/handler.js` 的 `tokenOf()`）
3. 同步那道闸放开档位 + `settings:v1` / `profile:v1` 的服务端白名单

你要做的只是**配环境变量**（见 1.3 的 `WX_APPID` / `WX_SECRET`）与
**建那张表**（`wx_accounts`，建表语句在 `docs/wx-login-server.md`）。
缺哪个都会如实回一句人话：缺密钥 `503 E_WX_NOT_CONFIGURED`、
缺表 `503 E_WX_TABLE`、`code` 失效 `401 E_WX_CODE` —— 都不是 500。

**1.5.1 为什么当初会「登录成功但同步一律 401」**

`poem` 原先的会话只从 Cookie 取（`fromCookieHeader`，cookie 名 `kbsid`），
而小程序发的是 `Authorization: Bearer` —— 小程序里没有 Cookie 这回事。
两端都没有一句话是错的，所以谁也定位不到。现在两处都认，Cookie 优先，
走同一套校验（验签 + 查 `sessions` 行）。

**1.5.2 反过来验一次**（别只看界面说「登录成功」）

部署完带一枚自签 token 直接打同步口：

```
curl -s -X POST https://<域>/api/sync/pull \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'content-type: application/json' -d '{"deviceId":"d1","since":0}'
```

**回 `E_NO_SESSION`（401）就是服务端那一半没上**。这条路最容易「以为通了」：
登录回 token、界面写着登录成功，而每一条同步都 401。

### 1.6 微信后台加域名

```
mp.weixin.qq.com → 开发 → 开发管理 → 开发设置 → 服务器域名
→ request 合法域名 → 加 https://<env>.ap-shanghai.run.tcloudbase.com
```

要求：https + 有效证书 + 已备案，不带端口。**默认域已备案，能直接填。**
每月修改次数有上限，想清楚再存。

### 1.7 小程序里填 baseUrl

小程序 → **我的 → 管理** → 「同步服务器地址」填 `https://<env>.ap-shanghai.run.tcloudbase.com`。

（代码里就是 `auth.configure({ baseUrl })`，管理页那个输入框调的就是它，**你不用改代码**。）

### 1.8 验证（判据不是「界面说成功」）

1. 开发者工具 → 详情 → 本地设置 → 勾「不校验合法域名」，先本地联调
2. 真机登录一次
3. **直接查库**，不是看界面：
   ```sql
   select poem_id, payload, updated_at from progress
   where poem_id in ('settings:v1','profile:v1');
   ```
   两条都在 → 代码和设置真打通了。界面写「已同步」而库里没有，就是服务端的
   白名单没上（那份在 `poem#532` 里，见 `wx-login-server.md` 的同名一节）。
4. 换一台手机登同一个微信，进度/设置/头像认回来 → 同步真通了

---

## 二、云开发 · HTTP 直连

比云托管少一步（不用 Dockerfile），多一步（云开发模型的初始化）。

1. 公众平台 → **云开发** → 开通，建一个环境，记环境 ID
2. 开 **HTTP 访问服务**：云开发控制台 → HTTP 访问服务 → 配路径映射到你的服务
   拿到域名，形如 `https://<env>.service.tcb.qcloud.la`
3. 后端怎么上去：云开发没有「跑 Docker」这回事，得把 handler **包成云函数**：

   ```js
   // cloudfunctions/api/index.js
   const handler = require("./api/handler.js");   // poem 的 api/handler.js 拷进来
   const { createServer } = require("http");
   // 或者更省事：用云开发的 HTTP 访问服务反代到自建 Node
   ```

   ⚠️ 这一步是**云开发比云托管麻烦的地方**：`poem` 的 `api/handler.js` 是 Vercel 风格
   `(req, res)`，云函数是 `(event, context)`，中间要一层适配。**要么写这层适配，要么退回云托管。**

4. 环境变量同 1.3（云开发控制台 → 环境设置 → 环境变量）
5. 域名：**同样要加 request 合法域名**（它就是个普通 https 域）
6. `baseUrl`、验证：同 1.7、1.8

**结论**：云开发 HTTP 版 = 云托管 + 一层云函数适配。**第一次做，直接用云托管。**

---

## 三、云调用（`wx.cloud.callFunction`）

免域名、免白名单，微信里点一下就能通 —— 但**客户端要改代码**。

### 3.1 服务端

1. 开通云开发（同上），建环境
2. 把 `code2Session` 那步删掉 —— 云函数里 `cloud.getWXContext()` 直接给 `OPENID` / `UNIONID`：

   ```js
   // cloudfunctions/wxLogin/index.js
   const cloud = require("wx-server-sdk");
   cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
   exports.main = async (event) => {
     const { OPENID, UNIONID } = cloud.getWXContext();
     // 按 UNIONID || OPENID 认回/新建账号，签发会话 token
     return { accessToken, refreshToken, expiresIn, tier, role, userId };
   };
   ```
3. `/api/sync/*`、`/api/admin/*` 也各包一个云函数，或让云函数内部转发到已有 HTTP 后端

### 3.2 客户端（**要改的就是这里**）

`utils/remote.js` 的 `request()` 现在是 `wx.request`，云调用要换成 `wx.cloud.callFunction`：

```js
// utils/remote.js 里 request() 的云调用版
function request(path, data, method) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: nameOf(path),           // 路径 → 云函数名，映射表
      data: { path, method: method || "POST", body: data,
              token: session().accessToken || "" },
      success: (res) => { /* 判 res.result.ok，同现在的 resolve/reject 语义 */ },
      fail: (err) => reject(new Error((err && err.errMsg) || "云函数不可用"))
    });
  });
}
```

并改 `app.js` 初始化：`wx.cloud.init({ env: "<你的环境ID>" })`。

⚠️ **代价说清楚**：`PATHS` 那套「拼 URL」的写法作废，`baseUrl` 这个设置项也失去意义。
也就是 `wx-login-server.md` 里那句承诺 —— **「后端就绪后只改 baseUrl」不再成立**。
这是本项目一直在避免的「为了省事把抽象拆掉」，所以只有你明确不在乎这点时才走这条。

### 3.3 验证

没有域名这回事，真机直接登。验证同 1.8 第 3 步：**查库**。

---

## 四、不管走哪条，这三件事都必须做

1. **`syncTierGate` 放开档位判定**（`api/_lib/core.js`）：改成只判「有没有会话」。
   同步在小程序端是 `login` 能力，不是 `pro`。只改客户端 → 用户看不到已能用的功能；
   只改服务端 → 界面列出点下去必 403 的假入口。**两处同时改。**
2. **给 `settings:v1` / `profile:v1` 加白名单**（`sanitizePayload`）：
   不加的表现是「同步成功但换台手机啥也没变」—— 见 `wx-login-server.md`。
3. **`wx_accounts` 表的 `uid` 必须与 `poem` 的 `accounts.uid` 同域**，
   否则网页版和小程序认不出是同一个人 —— 小程序改的档网页版读不到。

---

## 五、别为了「统一在腾讯」搬错东西

本项目要分发的是 **5300+ 条正文分片、23MB 静态文件**，这块早定了走 **COS + CDN**。

- 云开发数据库：几万条查询，性能成本都不划算，而这里要的只是**静态分发**
- 云开发存储：是存储桶不是 CDN，域还不一定给绑
- 那个域走的是 `downloadFile` 白名单（`wx.loadFontFace` 用它），**跟本文的 request 名单互不干扰**

**分片继续走 COS + CDN，别搬。**

---

## 六、终点：什么算「打通了」

| 判据 | 怎么验 |
|---|---|
| 云服务跑起来了 | `/healthz` 回 `ok`（瘦镜像没有静态站，`/` 就是 404 —— 别拿它当判据） |
| 登录真换来身份 | 真机登录后查库，账号行出现，`tier` 来自服务端 |
| 同步真落库 | 库里能查到进度行 + `settings:v1` + `profile:v1` |
| 换设备认得回 | 第二台手机登同一微信，进度/设置/头像都在 |
| 域名没挡路 | 真机（**不勾**「不校验合法域名」）登录同步都通 |

到这一步，「代码和设置打通」才算真的完成 —— 而不是界面上写着「已同步」。
