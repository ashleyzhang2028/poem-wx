# 云托管 / 云开发 / 云调用：一步步开通，并让代码接上

> Issue #64 的追问原话：**「告诉我开通云托管、云开发、云调用的详细步骤，一步一步设置完成，我需要代码和设置打通」**。
>
> 这份文档只干这一件事：把三条路各自的**控制台点击顺序**、**要填的代码**、**怎么验**写清楚。
> 后端要补什么（路由 / 表 / 白名单）看 [`wx-login-server.md`](wx-login-server.md)，本文不重复。

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
本项目**不要选它** —— 我们的后端是 `poem` 那个现成仓库，选模板等于另起一份不是我们的代码。

模板页只负责把你的代码跑成容器，它**既不生成环境、也不发域名**；地区、环境 ID、
默认域名都是**服务建起来之后**才出现的。所以「看不到地域 / 环境 / 域名」不是漏填了什么，
是**顺序还没走到**。

正确入口有两条，任选：

| 走法 | 路径 | 适合 |
|---|---|---|
| 自定义部署（推荐） | 左侧 **云托管 → 服务管理 → 新建服务** | 部署已有的 `poem` 仓库 |
| 无门槛部署 | 「快速入门 → 无门槛部署」选模板 | 只想先看一个 hello-world 跑起来长什么样 |

**从「新建服务」进去**，依次是：

1. 归属环境 —— 没有环境就**在这一步新建**一个（这里才出现「地域」选项，如上海）
2. 服务名称 —— 随便起，如 `poem-api`
3. 部署方式 —— 选 **代码仓库**（GitHub / 自有 Git 都行），或先跳过、之后手动上传镜像
4. 建完之后回 **服务设置 → 基础信息**，才看得到「公网访问」开关与**默认域名**

环境 ID 在 **环境设置** 里，默认域名在 **服务设置 → 基础信息**。
两样都不是开通时一次给全的，而是**建完服务才齐**。

⚠️ 默认，「公网访问」可能是**关着**的 —— 关着就没有域名可填，小程序也打不进来。
确认它打开着，再去拿域名。

⚠️ 这默认域**已备案**，能直接填进微信名单 —— 这就是「实在不知道怎么设置域名」的省事解。
代价是它不受你控制，平台换域/回收环境名字就没了。要长期用再绑自有域。

#### 想用「代码仓库」部署，得先把 `poem` 接进去

云托管要读你的 Git 仓库。CNB 的仓库不在它的默认列表里，两种接法：

- **镜像**：本地 `docker build` → 推到云托管的镜像仓库 → 服务从镜像部署（最稳，不依赖 Git 打通）
- **Git**：云托管支持填一个**公开可读**的 Git 地址；CNB 仓库如果对匿名可读，直接填 `https://cnb.cool/npu-gpu-cpu/poem.git`。
  私有仓库要配凭据，第一次做建议先走镜像那条。

### 1.2 让仓库能部署（云托管要镜像）

云托管跑的是容器，`poem` 侧要加一个 `Dockerfile`（**这件事还没做**，是本节第一个待补的代码）：

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm i --omit=dev
COPY . .
ENV PORT=80
EXPOSE 80
CMD ["node", "scripts/serve.js"]
```

`poem` 的 `scripts/serve.js` 本来就同时伺服静态站 + `api/`（Vercel 那套 handler 收在同一个进程里），所以一个容器就能全跑，不用拆。

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

⚠️ 云托管里如果走**内部调用渠道**拿 openid，`WX_SECRET` 可以不填，平台替你换。
但**别两条路都不做** —— 平台渠道和自建 `code2Session` 选一条，见 1.5。

### 1.4 部署

1. 云托管 → 新建服务 → 部署方式选 **代码仓库**（GitHub/自有 Git 皆可，或手动上传镜像）
2. 选 `poem` 仓库、目标分支
3. 触发一次部署，等状态变「运行中」
4. 点默认域名根路径，应能看到 `poem` 静态首页 → **服务通了**

### 1.5 补那两条路由（**代码打通的关键，现在还没有**）

`poem` 的 `api/_lib/routes.js` 现在**没有** `/wx/login`。要加：

```js
// api/_lib/routes.js
"POST /wx/login":   "./../_routes/wx/login.js",
"POST /wx/refresh": "./../_routes/wx/refresh.js",
```

新增 `api/_routes/wx/login.js`，要点三条：

1. `code` 换 `openid`：云托管走内部渠道可直接拿，自建则打
   `https://api.weixin.qq.com/sns/jscode2session`
2. 按 `unionid`（没有按 `openid`）在 `wx_accounts` 表认回或新建账号
3. 签发会话，**字段名必须是小程序 `utils/auth.js` 的 `applySession()` 读的那几个**：
   `accessToken / refreshToken / expiresIn / tier / role / caps / signedGrant / nickname / avatarUrl / userId`

⚠️ **这里有第二个待补的代码坑，比路由更隐蔽**：

`poem` 现在的会话是 **Cookie**（`api/_lib/session.js` 的 `fromCookieHeader`，cookie 名 `kbsid`），
而小程序 `utils/remote.js` 发的是 **`Authorization: Bearer <token>`** —— 小程序里没有 Cookie 这回事。

所以 `withSession()` 要**同时认两条**（`api/_lib/handler.js`）：

```js
// 先 Cookie（网页版），再 Bearer（小程序）
var token = session.fromCookieHeader((req.headers || {}).cookie, CONFIG.cookieName)
         || bearerOf(req.headers && req.headers.authorization);
```

不补这一步，现象是：**`/wx/login` 返回了 token、小程序显示登录成功，但 `/api/sync/*` 一律 401** ——
报错指向「没登录」，而登录明明成功了。这是本项目反复在修的那类「假成功」，先说在前面。

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
   两条都在 → 代码和设置真打通了。界面写「已同步」而库里没有，就是白名单没加
   （见 `wx-login-server.md` 的「服务端必须给这两行加白名单」）。
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
| 云服务跑起来了 | 域名根路径能打开静态首页 |
| 登录真换来身份 | 真机登录后查库，账号行出现，`tier` 来自服务端 |
| 同步真落库 | 库里能查到进度行 + `settings:v1` + `profile:v1` |
| 换设备认得回 | 第二台手机登同一微信，进度/设置/头像都在 |
| 域名没挡路 | 真机（**不勾**「不校验合法域名」）登录同步都通 |

到这一步，「代码和设置打通」才算真的完成 —— 而不是界面上写着「已同步」。
