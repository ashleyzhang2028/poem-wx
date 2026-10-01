# 微信登录：服务端要加的那一层

> 这份文档只写一件事：**后端要补什么，小程序才能真的用上微信登录**。
> 上线前的唯一硬阻塞就是它。

## 为什么必须在服务端

`code2Session` 要 `appsecret`。**它不能进小程序包** —— 小程序包是明文可分发的，
拿到 `appsecret` 就等于拿到这个公众号的登录能力。所以这一层没有「客户端先顶着」的写法。

同理，`openid` 也不该落到客户端存储里：客户端只拿 token，`openid` 只活在服务端。

## 要加的两条路由

写在 poem 那边（`api/_lib/routes.js`）：

```js
"POST /wx/login":   "./../_routes/wx/login.js",
"POST /wx/refresh": "./../_routes/wx/refresh.js"
```

### `POST /api/wx/login`

请求：

```json
{ "code": "<wx.login 拿到的 code>", "deviceId": "dxxxxxx" }
```

服务端做三件事：

1. 拿 `code` 去换 `openid` / `unionid`：
   `GET https://api.weixin.qq.com/sns/jscode2session?appid=&secret=&js_code=&grant_type=authorization_code`
2. 按 `unionid`（没有就按 `openid`）在 `wx_accounts` 表里认回或新建一个账号
3. 签发会话，返回

响应（**字段名以小程序端 `utils/auth.js` 的 `applySession()` 读的为准**）：

```json
{
  "accessToken":  "...",
  "refreshToken": "...",
  "expiresIn":    604800,
  "tier":         "free",
  "role":         "user",
  "caps":         { "speak": true },
  "signedGrant":  "...",
  "nickname":     "",
  "avatarUrl":    "",
  "userId":       "wx_xxxx"
}
```

- `tier` 只认 `free` / `pro` / `max`
- `role` 只认 `owner` / `admin` / `user`
- `caps` 可省；给了就按人开关某项能力，不必改档位（`entitlement.switchedOff()` 读它）
- 昵称头像留空即可 —— 用户在小程序里自己选（`chooseAvatar` / `type="nickname"`），
  服务端不静默抓

### `POST /api/wx/refresh`

请求 `{ "refreshToken": "..." }`，响应同上。

## 要用到的那张表

```sql
create table wx_accounts (
  uid            text primary key,        -- 与 poem 的 accounts.uid 同域
  openid         text not null,
  unionid        text,
  nickname       text default '',
  avatar_url     text default '',
  plan           text default 'free',
  plan_until     bigint,
  role           text default 'user',
  created_at     bigint not null,
  last_login_at  bigint
);
create unique index wx_accounts_openid_idx on wx_accounts (openid);
create index wx_accounts_unionid_idx on wx_accounts (unionid);
```

**`uid` 必须与 poem 的 `accounts.uid` 同一个域**，否则同步与管理两头认不出是同一个人：
小程序里改的档，网页版那边读不到；网页版背的进度，小程序拉不回来。

## 同步与管理：已经能用了，不用新写

`/api/sync/pull|push`、`/api/admin/accounts|grant|role` **复用 poem 已上线的那几个**，
小程序端已经把报文换成服务端认的形状（见 `utils/wire.js` 顶上那段说明）。

但有两处**服务端要一起改**，因为「同一个人在两端的身份」和「同一条记录在两端
更新时间」对不上就会出静默的错：

1. **已读行 id 必须统一**。小程序端用的是网页版 `js/read-sync.js` 里那批
   `poem_<book>_read_v1`（含 `poem_dwang_cn_read_v1`）。网页版自己的
   `js/sync-coverage.js` 里，帝王那卷写的是 `poem_dwang_cn_read_v1`，
   而 `js/dwang.js` 的 `readStore` 用的是 `poem_dwang_cn_read_v1` ——
   这两处是一致的，但**早期版本用的是 `poem_dwang_read_v1`**，
   服务端若沿用旧行 id，这一卷的已读会分叉成两份。上线前确认一遍
   `select distinct poem_id from kb_progress where poem_id like 'reads:%'`。
2. **`updatedAt` 的钟**。两端都写 `Date.now()`，设备时钟不准就会「旧的盖新的」。
   服务端 `putProgress` 已经是条件 upsert（比 `updated_at`），这条能兜住；
   但客户端要保证**从不回拨 `updatedAt`**：小程序端现在一律取本机写入时刻。

## 部署顺序

1. 服务端加 `WX_APPID` / `WX_SECRET` 两个环境变量，加上面那张表
2. 加两条路由，部署
3. 小程序端把 `baseUrl` 填上（管理页或 `auth.configure({ baseUrl })`）
4. 把第一个管理员扶成 `owner`：poem 那边走 `OWNER_EMAILS` 环境变量
   （`api/_lib/core.js` 的 `claimOwnerRole`）。**小程序端没有这条口**，
   也不该有 —— 一个能在客户端点出来的「把自己设成 owner」就是权限漏洞
5. 其余人的档位由这个 owner 在管理页里发

## 现在没接上时是什么样

**如实降级，不假装成功**：

- 登录点得动，落地的是本机身份，档位按 `free`
- 同步攒着，界面写「后端未就绪 · 已攒 N 条」
- 管理页名录只读，写明「服务端未就绪」；改档按钮点了给人话，不静默失败
- 朗读三条通道都不就绪时，**界面里根本不出现播放元素**（见 README「能力不可用时不显示」）

## 一件事得说在前面

`baseUrl` 配好之后，**微信公众平台还要把这个域名加进「request 合法域名」**，
否则真机上 `wx.request` 一律失败（开发者工具里勾了「不校验合法域名」能绕过，
真机绕不过）。这是最容易在提审后才发现的一条，所以写在这里。
