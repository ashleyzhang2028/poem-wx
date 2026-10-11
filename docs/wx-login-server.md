# 微信登录：服务端那一层

> 这份文档写**小程序后端要什么形状**：报文契约、会话从哪儿取、两张新行、
> 那张 `wx_accounts` 表，以及部署顺序。
>
> **⏹ 状态：服务端已实现**（[`poem#532`](https://cnb.cool/npu-gpu-cpu/poem/-/pulls/532)，
> 2026-10-11）。下面「要加」的写法保留着 —— 它们是**契约**，不是待办：
> 哪天又冒出一条新的小程序路由，照着这份的形状写就不会歪。
> 只剩两件要运维做的：配 `WX_APPID` / `WX_SECRET`，建 `wx_accounts` 表。

## 为什么必须在服务端

`code2Session` 要 `appsecret`。**它不能进小程序包** —— 小程序包是明文可分发的，
拿到 `appsecret` 就等于拿到这个公众号的登录能力。所以这一层没有「客户端先顶着」的写法。

同理，`openid` 也不该落到客户端存储里：客户端只拿 token，`openid` 只活在服务端。

## 两条路由（已在 `poem#532`）

写在 poem 那边（`api/_lib/routes.js`）：

```js
"POST /wx/login":   "./../_routes/wx/login.js",
"POST /wx/refresh": "./../_routes/wx/refresh.js"
```

两条 route 照 `api/_routes/auth/login.js` 的样子写就行 —— 用同一个
`api/_lib/handler.js` 的 `make()` 包一层，会话就自动管住了：

```js
"use strict";
var handler = require("../../_lib/handler");

module.exports = handler.make("wx.login", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.wxLogin(d, {
    code: body.code,
    device: body.device || d.deviceId
  }).then(function (r) { return handler.settleSession(d, r); });
});
```

`handler.settleSession()` 那一句别省 —— 它是「把 Cookie 剥掉、只留 body」
的那一步（`api/_lib/handler.js` 里 `settleSession` 只在 `r._session` 在时才动）。
小程序端**不接 Cookie**，少写这一句也不报错，只是白带一个没用的头。

### `POST /api/wx/login`

请求：

```json
{ "code": "<wx.login 拿到的 code>", "device": "dxxxxxx" }
```

⚠️ **字段名是 `device`，不是 `deviceId`。** 小程序端
`utils/remote.js` 的 `credentialBody()` 发出去的就是这个键，
`/api/sync/pull|push` 那两条用的是 `deviceId` —— 两套报文在本仓库里并存，
照抄别的接口会在此处静默对不上：服务端读不到设备号，服务端按它签会话
（`sessions.device`）也按它限流，拿到空串的结果是「同一台设备的限流被拆成
无数个互不相干的桶」——限流形同虚设，而没有任何一处会报错。

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

请求 `{ "refreshToken": "...", "device": "dxxxxxx" }` —— **`device` 同样不能少**
（理由同上：签会话与限流都要它）。响应同上。

⚠️ 这一条**容易漏**：登录时记得带、刷新时忘了带，服务端拿到空串也不报错，
于是「同一台设备」这个概念在刷新那条路上整个消失。

刷新不回话（401）时，客户端会**自己清掉本机会话**（见 `utils/auth.js`
`refresh()`）—— 因为 refreshToken 不认了意味着本机举着一份服务端不认的档位，
留着比清掉更糟。清掉会话不影响本机进度与设置，一个字都不丢。

## ⚠️ 会话从哪儿取：Cookie **或** `Authorization: Bearer`

**这是 Issue #71 点出来的第二件事，也是「登录成功了但 `/api/sync/*` 一律 401」
的成因。** 两条路由加对了、登录一路绿灯，跟着每一个同步接口都回
`{"code":"E_NO_SESSION","message":"还没有登录"}` —— 而用户明明刚登录完。

成因一句话：`api/_lib/handler.js` 的 `withSession()` 只从一个地方取会话：

```js
var token = session.fromCookieHeader((req.headers || {}).cookie, CONFIG.cookieName);
```

**网页版带 Cookie，小程序不带。** 小程序把 token 放在
`Authorization: Bearer <accessToken>`（见 `miniprogram/utils/remote.js` 的
`send()`）—— 那是小程序端唯一能放长凭证的地方：`wx.request` 不共享浏览器的
Cookie 罐，`session.setCookieHeader()` 里还有个 `SameSite=Lax` + `Secure`，
本来也不是给小程序准备的。

所以 `withSession()` 要**两处都认**，cookie 优先（网页版那条路一个字不改）：

```js
function tokenOf(req) {
  var h = (req.headers || {});

  // ① 网页版：Cookie。先看这一处，网页版的行为一个字节都不变
  var fromCookie = session.fromCookieHeader(h.cookie, CONFIG.cookieName);
  if (fromCookie) return fromCookie;

  // ② 小程序：Authorization: Bearer <token>
  //    ⚠️ 这一条是 Issue #71 那次「登录成功了但同步一律 401」的根因。
  //    不补它，网页版一切正常，小程序端除登录以外每一条都 401。
  var raw = String(h.authorization || h.Authorization || "").trim();
  var m = /^Bearer\s+(\S+)$/i.exec(raw);
  return m ? m[1] : null;
}
```

然后把 `withSession()` 里那一行换成 `session.read(CONFIG, tokenOf(req), Date.now())`。

### 三条容易踩的边界

1. **别在这儿 `decodeURIComponent`**。`fromCookieHeader()` 里面替 Cookie
   做了一次（Cookie 里 `=`、`;` 都是保留字）；Bearer 那一枚是
   base64url + 一个点，原样用就是对的 —— 多解一次，令牌里恰好出现 `%`
   时会被改掉，签名对不上，回一个彻底的 401，而你看着代码怎么都对。
2. **认出来之后走的是同一套校验**，别给 Bearer 开小门：`session.read()` 验签
   与过期、再查 `sessions` 那一行（`revoked` / `uid` 对得上）——这两步一步都不能省。
   一个只有签名的令牌是不够的：账号注销之后那一行就没了，
   而令牌还能验过去（`api/_lib/handler.js` 里原本那句注释说的就是这件事）。
3. **`Authorization` 头的大小写**：HTTP 头名不区分大小写，Node 会把它归一成
   小写 `authorization`，但在别处（比如自己写的 `http` 包装、某些代理）
   拿到的可能是原样那个 `Authorization`。两个都读，一行的事。

### 这一节已经在 poem 里实现了

`api/_lib/handler.js` 的 `tokenOf()`，加在 `withSession()` 之前，Cookie 优先。
上面这三条边界都写进了注释 —— 它们各自对应一个踩过的坑，不是理论。

### 顺带一句：`/api/me` 也在这条路上

小程序端启动时会调一次 `GET /api/me`（`utils/auth.js` 的 `refresh()`）——
**它就是「网页版与小程序同号」那条路的兜底**：用户在浏览器里登录过，
手机上就有 Cookie，而小程序手里一枚 token 都没有；这时
`/api/wx/refresh` 无从发起（没 refreshToken），只有 `/api/me` 能问出
「服务端认不认得这台」。补了上面的 `tokenOf()` 之后这条也一起通了。

⚠️ 它必须是 **GET**（`api/_routes/me.js` 就是这么注册的）。小程序端
`auth.request()` 少传 `method` 会以 POST 打过去 —— 服务端回 405，
而客户端看见的只是「叫不通」，于是「网页版同号的人拿不到档位」这条
又悄悄回来了（自检里钉着这一个）。

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

---

## 同步不再分档（2026-10-04）

> ✅ 服务端那一半已在 `poem#532` 落地（`syncTierGate` 改成只判有没有会话）。
> 客户端那一半在自检里（W5 + V34）。下面这段是这条边界的出处。

**这条改了服务端的一道闸，必须先说。**

poem 的 `api/_lib/core.js` 里，`syncPull` / `syncPush` 第一步都过
`syncTierGate()`：free 档直接 403（`E_TIER`，`cap: sync.multiDevice`）。

用户 2026-10-04 裁决改了这条边界：

> 「我现在是微信小程序项目，不是之前的 web 应用，需要修改，同步功能只要用户登录
> 就全部提供，确保用户数据不丢失，背诵进度换设备也能得到。请重新设计」

所以小程序端的能力表里，`sync` 从 `pro` 改成了 **`login`**（登录即得，不看档位）。
**服务端那道闸要一起放开**：`syncTierGate` 改成只判「有没有会话」，
不再判 `gameAllowed(cfg, tier, "sync.multiDevice")`。

两处必须同时改：

- 只改服务端 → 客户端还按 pro 藏入口，用户看不到自己已经能用的功能
- 只改客户端 → 界面列出一个点下去必然 403 的入口（那正是我们一直在修的那种假按钮）

自检里钉着客户端这一半（`check.js` W5 + V34 第 6 条）；
服务端那一半改完，poem 那边 `sync.multiDevice` 这条能力键可以直接从表里退场。

## 一条新的行 id：`settings:v1`

**设置原来是压根不上云的**，换台手机主题回「墨」、每日计划回 5 首、
算法回艾宾浩斯。现在它占一行，走那张 `progress` 表、
那套时间戳规则（新者胜），不加表、不加字段。

| 行 id | 载荷 | 谁写 |
|---|---|---|
| `settings:v1` | `{ v:1, settings:{ grade, term, dailyCount, scope, algo, align, fontSize, theme, pinyin }, updatedAt }` | 两端 |

两条设计口径：

1. **整份快照，不逐键合并**。设置是「一台机器上的全部选择」，逐键合并会造出
   「年级是我的、算法是他的」这种**谁都没选过**的中间态。
2. **跟设备走的那几项不进报文**（当前只有「答题音效」：它取决于这台机器的扬声器）。
   客户端在 `store.js` 的 `DEVICE_DEFAULTS` 里分流，云端那份里根本没有它。

### ⚠️ **头像不再有那一行**（Issue #111）

曾经有过一行 `profile:v1`，装的是「用户自己传的那张头像」。Issue #111 收掉了
「用户自己上传头像」这条路（用户原话：*不要再提供用户自己上传头像的功能了，
也许能节省对象存储或者静态资源存储*），于是：

- 头像只认微信那一张，而它是 `chooseAvatar` 给回的一枚**临时文件路径**
  （`wxfile://…`）—— 那是**这台机器上的**东西，进报文没有意义。
- 所以 `profile:v1` 这一行**整个退场**：客户端不再打包它，
  服务端那条 `sanitizeProfile` 白名单也就没有对象了。
- **不上传 = 不需要对象存储**，`/api/avatar` 那条路由与存储桶一并从这份契约里去掉。
- 昵称不靠这一行 —— 它在 `accounts.nickname` 上，登录时随会话下发
  （`nicknameSet` 那条路没动）。

> 服务端那一半（`sanitizePayload` 里去掉 `PROFILE_ROW_ID` 那条分支、
> 去掉 `/api/avatar` 路由）在 `poem` 仓库。**留着它不会出错**
> （客户端不发那行了，它永远收不到），但它是一条没人走的岔路 ——
> 下一轮清 `poem` 时一并去掉。

### ⚠️ 服务端必须给 `settings:v1` 加白名单，否则数据会被静默清空

> ✅ 已在 `poem#532` 落地（`SETTINGS_KEYS` + `sanitizeSettings`，
> 插在 `readRowKeyOf` **之前**）。下面这段是要加的形状，也是「为什么必须加」的出处。

这是**实测**出来的，不是推的：poem 的 `sanitizePayload(p, poemId)` 对认不出的
行 id **一律返回 `{}`** ——

```js
if (poemId === DAILY_EXTRA_ROW_ID)    return sanitizeDailyExtra(p);
if (poemId === COLLECTIONS_ROW_ID)    return sanitizeCollections(p);
if (poemId === PINYIN_FIX_ROW_ID)     return sanitizePinyinFix(p);
if (readRowKeyOf(poemId))             return sanitizeReads(p);
// 进度白名单…
```

我们发的 `settings:v1` 走不进任何一条分支，落到最后那段进度白名单上 ——
而它读的是 `level / nextReviewAt / learned / reps / history`，
于是 `{ grade, theme, … }` 一个字段都不剩。

**表现是「同步成功但什么也没发生」**：客户端一路绿灯、界面写着「已同步」、
换台手机一看还是默认值。这是这个项目反复在修的那类错，所以把它写在最显眼的地方。

要加的两段（形状照 `sanitizeDailyExtra` 写，白名单 + 长度上限，别照单全收）：

```js
var SETTINGS_ROW_ID = "settings:v1";

// 设置里的白名单。**列出来，不用 Object.keys(p) 照单全收** ——
// 这一层的作用就是「服务端说了算」，照单全收等于把客户端的话当真理。
var SETTINGS_KEYS = {
  grade: "int", term: "int", dailyCount: "int", fontSize: "int",
  scope: "str", algo: "str", align: "str", theme: "str", pinyin: "str"
};

function sanitizeSettings(p) {
  var out = { v: 1, updatedAt: 0, settings: {} };
  var s = (p && typeof p.settings === "object" && p.settings) || {};
  Object.keys(SETTINGS_KEYS).forEach(function (k) {
    var v = s[k];
    if (v === undefined || v === null) return;
    if (SETTINGS_KEYS[k] === "bool") out.settings[k] = !!v;
    else if (SETTINGS_KEYS[k] === "str") out.settings[k] = refText(v, 40);
    else if (typeof v === "number" && isFinite(v)) {
      out.settings[k] = SETTINGS_KEYS[k] === "int" ? Math.round(v) : v;
    }
  });
  var t = Number((p && p.updatedAt) || 0);
  out.updatedAt = isFinite(t) && t > 0 ? Math.round(t) : 0;
  return out;
}

```

再把那条分支插进 `sanitizePayload`（放在 `readRowKeyOf` **之前**）：

```js
if (poemId === SETTINGS_ROW_ID) return sanitizeSettings(p);
```

（原来这里还有一条 `PROFILE_ROW_ID` —— Issue #111 之后没有 `profile:v1`
这一行了，那条分支随之没有对象。见上一节。）

### 还有一件事：`updated_at` 与 `created_at` 被同一条 upsert 揉在一起

poem 的 `kb_upsert_progress` 是「按 `updated_at` 比新旧的条件覆盖」，
而线上那份建表语句里 `progress` 表还有一列 `created_at`（Postgres 版有，
MySQL 译版里已按这里说的口径去掉）：

```sql
insert into public.progress (uid, child_id, poem_id, payload, updated_at, deleted)
select … on conflict (uid, child_id, poem_id) do update
   set payload = excluded.payload, updated_at = excluded.updated_at, deleted = excluded.deleted
 where excluded.updated_at >= public.progress.updated_at;
```

**这一条对前 5000 条篇目进度是对的，对设置这一行不是**：
`on conflict do update` 会把那一行的其他列（`created_at` 之类）留成原来的，
如果将来有人拿 `created_at` 判「哪一份是这台设备的初次记录」，设置行会显得
比实际早。当前没有代码读它，所以**先记在这里，不要顺手改 upsert** ——
改 `kb_upsert_progress` 会波及全部进度行，风险远大于收益。
真要与 `created_at` 分开，做法是给小程序的同步单独走一条 `preserve_created`
的 upsert；那一天到来之前，这一节读作「已知，不改」。

## 部署顺序

代码已经在了（`poem#532`）。剩下全是运维动作，完整清单在
[`wx-cloud-setup.md`](wx-cloud-setup.md)（控制台怎么点、镜像怎么来、云调用怎么填）。

跟后端这一层直接相关的只有两步：

1. 配 `WX_APPID` / `WX_SECRET` —— 缺了登录回 `503 E_WX_NOT_CONFIGURED`
2. 建 `wx_accounts` 表 —— 缺了回 `503 E_WX_TABLE` 并指路

验的时候别只看客户端说成功，见 `wx-cloud-setup.md` 第七节那两条（带 token 打 `/api/sync/pull`、直接查库）。

## 现在没接上时是什么样

**如实降级，不假装成功**：

- 登录点得动，落地的是本机身份，档位按 `free`
- 同步攒着，界面写「后端未就绪 · 已攒 N 条」；登录那一刻会试一次，成功了就说「进度已认回」
- 管理页名录只读，写明「服务端未就绪」；改档按钮点了给人话，不静默失败
- 朗读三条通道都不就绪时，界面里根本不出现播放元素
