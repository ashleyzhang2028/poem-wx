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

---

## 同步不再分档（2026-10-04）

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

## 两条新的行 id：`settings:v1` 与 `profile:v1`

**设置与头像原来是压根不上云的**，换台手机主题回「墨」、每日计划回 5 首、
算法回艾宾浩斯、头像没了。现在各占一行，走同一张 `progress` 表、
同一套时间戳规则（新者胜），不加表、不加字段。

| 行 id | 载荷 | 谁写 |
|---|---|---|
| `settings:v1` | `{ v:1, settings:{ grade, term, dailyCount, scope, algo, align, fontSize, theme, pinyin, autoNext, speechRate, speechAutoNext }, updatedAt }` | 两端 |
| `profile:v1` | `{ v:1, avatar, updatedAt }` —— `avatar` 是**用户自己传的那张**的地址 | 小程序端 |

两条设计口径：

1. **整份快照，不逐键合并**。设置是「一台机器上的全部选择」，逐键合并会造出
   「年级是我的、算法是他的」这种**谁都没选过**的中间态。
2. **跟设备走的那几项不进报文**（当前只有「答题音效」：它取决于这台机器的扬声器）。
   客户端在 `store.js` 的 `DEVICE_DEFAULTS` 里分流，云端那份里根本没有它。

### ⚠️ 服务端必须给这两行加白名单，否则数据会被静默清空

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
var PROFILE_ROW_ID  = "profile:v1";

// 设置里的白名单。**列出来，不用 Object.keys(p) 照单全收** ——
// 这一层的作用就是「服务端说了算」，照单全收等于把客户端的话当真理。
var SETTINGS_KEYS = {
  grade: "int", term: "int", dailyCount: "int", fontSize: "int",
  scope: "str", algo: "str", align: "str", theme: "str", pinyin: "str",
  autoNext: "bool", speechRate: "num", speechAutoNext: "bool"
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

function sanitizeProfile(p) {
  var out = { v: 1, avatar: "", updatedAt: 0 };
  out.avatar = refText(p && p.avatar, 512);   // 与 sanitizeImgUrl 同口径即可
  var t = Number((p && p.updatedAt) || 0);
  out.updatedAt = isFinite(t) && t > 0 ? Math.round(t) : 0;
  return out;
}
```

再把两条分支插进 `sanitizePayload`（放在 `readRowKeyOf` **之前**）：

```js
if (poemId === SETTINGS_ROW_ID) return sanitizeSettings(p);
if (poemId === PROFILE_ROW_ID)  return sanitizeProfile(p);
```

### 还有一件事：`updated_at` 与 `created_at` 被同一条 upsert 揉在一起

poem 的 `kb_upsert_progress` 是「按 `updated_at` 比新旧的条件覆盖」，
而 Supabase 版里 `progress` 表还有一列 `created_at`：

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

1. 服务端加 `WX_APPID` / `WX_SECRET` 两个环境变量，加上面那张表
2. 加两条路由，部署；**同时放开 `syncTierGate` 的档位判定**（见「同步不再分档」），
   并给 `settings:v1` / `profile:v1` 加白名单（见上一节）
3. 部署完**真机验一遍这两条新行** —— 判据不是「客户端说成功」，
   而是直接查库：
   `select poem_id, payload from progress where poem_id in ('settings:v1','profile:v1')`
4. 小程序端把 `baseUrl` 填上（管理页或 `auth.configure({ baseUrl })`）
5. 把第一个管理员扶成 `owner`：poem 那边走 `OWNER_EMAILS` 环境变量
   （`api/_lib/core.js` 的 `claimOwnerRole`）。**小程序端没有这条口**，
   也不该有 —— 一个能在客户端点出来的「把自己设成 owner」就是权限漏洞
6. 其余人的档位由这个 owner 在管理页里发

## 现在没接上时是什么样

**如实降级，不假装成功**：

- 登录点得动，落地的是本机身份，档位按 `free`
- 同步攒着，界面写「后端未就绪 · 已攒 N 条」；
  **登录那一刻会试一次**，成功了就在提示里说「进度已认回」
- 管理页名录只读，写明「服务端未就绪」；改档按钮点了给人话，不静默失败
- 朗读三条通道都不就绪时，**界面里根本不出现播放元素**（见 README「能力不可用时不显示」）

## 一件事得说在前面

`baseUrl` 配好之后，**微信公众平台还要把这个域名加进「request 合法域名」**，
否则真机上 `wx.request` 一律失败（开发者工具里勾了「不校验合法域名」能绕过，
真机绕不过）。这是最容易在提审后才发现的一条，所以写在这里。
