# 课外正文与检索的来源

> 课内 251 首照旧在包里（正文、注音、朝代作者、出处）。课外的正文、检索、
> 飞花令判句、新增温习搜索、自选集合找诗，一律**问服务端**，不再读打包的分片。
>
> 服务是 `spovk/wx-kb-chinese-poetry-api`（源码 [belem/chinese-poetry-api](https://github.com/belem/chinese-poetry-api)，
> 上游 palemoky/chinese-poetry-api），部署在微信云托管，服务名 **`poem-source`**。

## 一、为什么换

旧路是「语料编译成 121 个分片 → 跟镜像走云托管 → 客户端按需取」。它有两个毛病：

1. **两端版本必须一致。** 分片由本仓库的 `scripts/corpus/` 编译，客户端按分片清单算片号。
   镜像落后一个提交，客户端就会取到旧正文，或者取不到 —— 现场是「一直停在正在取正文」。
2. **范围就那么大。** 5677 条课外 + 251 条课内。飞花令的判句在本地诗词集里查，
   答得出、集子里没有的句子一律判错 —— 明明是对的，说人家不在范围。

这个服务是全量库（37 万首）（唐、宋、元、金、先秦至清），带全文检索与单字倒排索引。
换过去之后：

| 事 | 旧 | 新 |
|---|---|---|
| 课外正文 | 取分片（44 KB/片） | `GET /api/v1/poems/search?type=title` 或 `GET /api/v1/poems?author=` 取整首（没有按 id 取单篇的接口） |
| 全文检索 | 本机倒排索引 + 扫分片 | `GET /api/v1/poems/search?q=` |
| 飞花令判句 | 本地集子里逐句比 | `search?type=content` 命中即为真 |
| 令字池 / 给答案看 | 本地集子 | 同一个 search 接口 |

## 二、接口清单（服务实际提供的全部 REST）

基址 `http://<服务>.<环境>.sh.run.tcloudbase.com/api/v1`，客户端（小程序）走云调用，
路径从 `/api/v1` 起。接口源码见 `reference/chinese-poetry-api`。只读接口一律 GET（同时接 HEAD）；除 `/health`、`/stats` 外都支持 `lang=zh-Hans`（默认）/ `zh-Hant`。

| 方法 | 路径 | 参数 | 回什么 |
|---|---|---|---|
| GET | `/health` | — | `{"status":"healthy"}`；库不可用回 503 |
| GET | `/stats` | —（不接受任何参数，含 `lang`） | `total_poems` / `total_authors` / `total_dynasties` / `poems_by_dynasty[]` / `poems_by_type[]` |
| GET | `/poems` | `page` `page_size`(≤100) `after`(游标) `author` `author_id` `dynasty` `dynasty_id` `type` `type_id`(可重复，OR) | `{data:[poem], pagination:{page,page_size,total,total_pages,has_next_page,next_cursor}}` |
| GET | `/poems/search` | `q`（必填）`type`=all/title/content/author `page` `page_size` `lang` | `{data:[poem], pagination:{page,page_size,total,total_pages}}`，**没有 `has_next_page` / `next_cursor`**；无命中回 200 与空数组 |
| GET | `/poems/random` | `lang`，与 `/poems` 同一组过滤（不含分页）；**或** `char`（单字） | 单首 `poem`，**直接是 poem 对象，没有 `data` 包裹**；`char` 只能与 `lang` 同用 |
| GET | `/authors` | `page` `page_size` `lang` | `{data:[{id,name,dynasty,poem_count}], pagination:{page,page_size,total,total_pages}}`，`dynasty` 是朝代名字符串，分页同样没有 `has_next_page` |
| GET | `/authors/{id}` | `lang` | `{data:{id,name,dynasty,description}}`；查无此人 404 |
| GET | `/dynasties` | `lang` | `{data:[{id,name,name_en,start_year,end_year,poem_count,author_count}]}` |
| GET | `/dynasties/{id}` | `lang` | `{data:{id,name,name_en,start_year,end_year}}` |
| GET | `/types` | `lang` | `{data:[{id,name,category,lines,chars_per_line,poem_count}]}` |
| GET | `/types/{id}` | `lang` | `{data:{…}}` |
| POST | `/graphql` | GraphQL 查询 | 同一批数据的另一种形状 —— **小程序不用** |

`poem` 的形状（就是客户端认的那一份）：

```json
{
  "id": 309946,
  "title": "静夜思",
  "content": ["床前看月光，疑是地上霜。", "举头望山月，低头思故乡。"],
  "author": { "id": 2045, "name": "李白" },
  "dynasty": { "id": 6, "name": "唐" },
  "type": { "id": 11, "name": "五言绝句", "category": "诗" }
}
```

几条硬规矩：

- **未知的查询参数一律 400**（`unknown query parameter(s)`）。写错一个参数名不会静默降级成全量。
- `page_size` 取值 1–100，越界或非整数一律 400，不会被截断；`page * page_size > 10000` 同样 400。
  只有 `/poems` 有 `after` 游标可以翻得更深，且与 `page` 互斥。
- `char` 只接单字，且不能与作者 / 体裁 / 朝代同用（400）。
- 404 只出现在：`/poems`、`/poems/random` 的 `author` / `dynasty` / `type` 按名称查不到，
  `random` 没有符合条件的诗，`/authors/{id}` 等详情接口查无此条。
  **`/poems/search` 无命中是 200 空数组**，不是 404。
- 翻页是否还有下一页：`/poems` 看 `has_next_page`；`/poems/search` 与 `/authors` 没有这个字段，
  只能比 `page` 与 `total_pages`（`utils/poem-source.js` 的 `paged()`）。
- 按 IP 限流，默认 10 次/秒、突发 20（`config.yaml`）；超了回 429。云托管出口 IP 是共用的，
  并发请求别铺得太开。
- 单个请求服务端 10 秒超时；数据库首启要下载，期间 `/health` 可能 503。
- 数据只在发布时更新，可缓存接口带 `Cache-Control` + 弱 `ETag`。

## 三、客户端怎么接

`miniprogram/utils/poem-source.js` 是唯一出口，`utils/remote.js` 的 `source()` 是唯一通道：

```
pages/search  ─┐
pages/reader  ─┤
authors/index ─┤
feihua/lib    ─┼→ utils/poem-source.js → utils/remote.js source()
               ┘                          → wx.cloud.callContainer
                                            X-WX-SERVICE: poem-source
                                            path: /api/v1/...
```

- **搜索**：先出包内命中（篇名 / 作者 / 书名，一次扫全、按 20 条分批绘制），
  再并上 `search?type=all` 的全文命中；命中的服务端 id 不带集子前缀，
  开阅读页时以 `src=1` 标记，正文直接取会话里记下的那一首（`seen`）。
- **作者索引**：名册只从包里收人（课内 + 十部目录，112 位）。
  作者搜索框另有一份课外库作者名册（`utils/author-directory.js`）：进页面后按 `GET /authors` 逐页（每页 100，服务端最深翻到第 100 页，按作品数降序）补全，
  存本机并可续传；输入关键字时按「名字含关键字」匹配，补全期间随页数增加刷新结果，尾部作者再由 `search?type=author` 兜底。
  点开一位时用 `GET /poems?author=<名>`（有 id 则 `author_id=`）拉他的全部作品，
  一页 100 首，`page_size` 上限即 `PAGE_MAX`。

- **服务名只有一处**：`remote.js` 的 `SOURCE_AGENT`。改部署就改那一行，别在别处再写一遍。
- 走云调用，**不经过 request 合法域名名单**，仍然免备案（同后端那条路，见 `wx-cloud-setup.md`）。
- 只读接口不进离线队列（`PATHS` 那套 outbox 只装用户数据）。
- 结果按 `path+query` 缓在本机，上限 60 条、过期 24 小时；`random` / `health` 不缓存。
- 每次请求都在控制台打一行 `[remote] GET … HTTP <状态码>`（`remote.js` 的 `sendTraced`），失败带 `FAIL`。
- 只有网络层失败（无状态码）与 5xx 才把课外库标成不可用（10 分钟内搜索 / 作者远端 / 飞花令 / 题库不再发请求）；
  4xx 与「没对上这一篇」只让这一次失败。`/poems` 的 404 当空页处理。

### 能力就绪

`readiness()` 同步返回，界面拿它决定显不显示：

```js
{ visible: true, usable: true,  state: "ready"    }   // 通
{ visible: true, usable: false, state: "awaiting" }   // 配了但连不上（掉线 / 冷启动）
{ visible: true, usable: false, state: "denied"   }   // 这一版没配后端
```

### 正文的取法

```
corpus.entry(id)          → 课内 251 条，读 data/course.js，取不到报 E_NO_TEXT
poem-source.byId(sid, meta) → 先查本次会话里搜索 / 列表见过的那一首；
                              没有再按目录行的标题与作者模糊对齐
```

课外库的 REST 没有按 id 取单篇的接口，只有 `/poems`、`/poems/search`、`/poems/random`。
十部集子的目录在包里（`data/books/catalogs.js`，见 `docs/parity.md` 一），正文不在。
目录行的 `sid`（`tangshi300-11`）是包内编号，不是课外库的 id，不能拼进接口。

- 搜索页、作者索引点开的诗：id 是课外库返回的整数，`search` / `poems` 返回时已记下整首，阅读页直接取用。
- 集子里的篇目：`/poems/search?type=title` 取回后按标题与作者对齐，各自分「相等 / 相容 / 不符」三档。
  标题相等，或目录题是命中题的前缀且余下只有「·」「其N」「N首」这类分卷尾巴，或目录题在 `·` 处截断后是前缀。
  作者相等，或一方包含另一方（`左丘明` 与 `左传`）。任一侧缺作者时只看标题。
  标题先按原名检索，取不到再按去标点归一后的题、`·` 前的词题各试一次；每级检索里优先取作者相等的那一批。
  命中里出现两位以上作者，视为没对上。
- 译文献空 —— 课外库不带译文，那一段本来也不出。一次只取点开的那一篇，不预取整本。

会话记录不跨启动：冷启动后直接重开一首只有课外库 id 的诗，走 `E_NO_POEM`，界面出重试提示。

集子里的篇目靠标题与作者对齐（两边命名不一定一致，见上一节），所以 `sid` 必须跟着入口走：作者索引那一行把 `sid` 带进
`/pages/reader/reader?…&sid=`，详情页另有一份 `data/sid`，翻篇与分享都续上。
少了 `sid` 时只剩包内编号（`tangshi300-4`），按标题猜不到，读出来就是「没对上这一篇」。

`data/site-catalogs.js` 里每部书的 `src` 决定 `sid` 的前缀（`tangshi300s` → `tangshi300`）。
前缀换了等于换一套 id，本机「已读」与自选集合里的引用会跟着断，改之前先想清楚。

检索与飞花令判句走 `/poems/search`，与 `corpus` 无关。

### 界面上的话

| 情况 | 说的话 |
|---|---|
| 这一篇正文不在包里 | 这一篇的正文不在这个包里 |
| 集子里那一篇没取到 | 这一篇的正文没取到，点一下重试 |
| 加了背但没配后端 | 还没接上课外库（取诗的那个服务），退出重进再看 |
| 冷启动超时（`102002`） | 取正文超时了 —— 多半是服务实例刚被唤醒，重试一次 |

## 四、运维：云托管与密钥仓库

### 4.1 云托管那边要什么

服务与后端那个 `poem-wx` **是同一个环境、两个服务**。课外库那一格：

| 字段 | 值 |
|---|---|
| 归属环境 | `poem-d9g1bqeq978682c58`（与 `poem-wx` 同一个） |
| 服务名称 | **`poem-source`** —— 与 `remote.js` 的 `SOURCE_AGENT` 逐字相同 |
| 部署方式 | 从地址拉取镜像 |
| 镜像地址 | `docker.io/spovk/wx-kb-chinese-poetry-api:latest` |
| 端口 | `1279` |
| 最小实例数 | **1**（免费档缩容到 0 时，第一次请求要等冷启动，客户端会报超时） |

这个镜像**不需要任何环境变量**也能起来：`config.yaml` 里的默认值够用，数据库是容器内
`data/poetry.db`，启动脚本从 GitHub Release 下载并校验。要调的只有下面几项，可选：

| 变量 | 默认 | 什么时候改 |
|---|---|---|
| `PORT` | `1279` | 不改 —— 云托管那格填的是同一个数 |
| `RATE_LIMIT_RPS` / `RATE_LIMIT_BURST` | `10` / `20` | 用户量上来后按 IP 限流会误伤（同一出口 IP 的多个用户共享配额），必要时调高 |
| `DB_PATH` | `data/poetry.db` | 不改 |
| `TRUSTED_PROXIES` | 回环 + 私网段 | 不改 —— 云托管在同一私网里，`X-Forwarded-For` 的客户端 IP 才认 |

⚠️ **首启要能出网**：`startup.sh` 从 `github.com` 下载 `poetry.db`（约 100 MB）。
云托管实例若不允许出网，容器会一直重启（日志里 `ERROR: Failed to download checksums`）。
真遇到了就把数据库打进镜像、或换一个可达的 `DATA_RELEASE_URL`。

⚠️ **镜像体积与冷启动**：库在容器内的 `data/` 卷里，实例扩缩容不会重建；
但**首次拉起的第一个请求**要等下载与解压完，实际观测是几十秒到几分钟。
所以最小实例数设 1，并且部署完先用 `/api/v1/stats` 打一次确认。
（题库的库文件很小时 `/api/v1/stats` 会立刻回，这也正是任务里那一步验证做的。）

### 4.2 密钥仓库里要配什么

结论先说：**`wechat-ci.yml` 一行都不用加。**

课外库那一路不占任何新变量。要用它，只需要让包里的云调用两栏指向**同一个云开发环境**：

```yaml
CLOUD_ENV=poem-d9g1bqeq978682c58      # 云开发环境 ID（不是云托管那个 326045-4-… 数字环境 ID）
CLOUD_SERVICE=poem-wx                 # 「登录 / 同步」那个后端服务名
```

- `CLOUD_ENV` 是**环境**，两个服务（`poem-wx`、`poem-source`）都在这一个环境里，
  所以同一格 env 两处通用。
- `CLOUD_SERVICE` 只给「登录 / 同步 / 管理」用。课外库的服务名 **不放进包**，
  它固定写在 `remote.js` 的 `SOURCE_AGENT` 里 —— 服务名是部署方的事，
  但它同时是「课外库在哪」这件事的唯一一处，不需要密钥。
- 也就是说：**云调用两栏配好，两路就都通了；课外库挂了不影响登录与同步**（反过来亦然）。

⚠️ 别在 `.cnb.yml` 的 `env:` 里再声明这几个变量 —— `imports` 的变量在 `env:` 求值时尚不可见，
`${VAR}` 会原样留在包里（Issue #175 的现场）。

### 4.3 验

```bash
# ① 服务活着，且这一版带了全量库
curl -s https://poem-source-<环境>.sh.run.tcloudbase.com/api/v1/stats
#    → {"total_poems":371313,"total_authors":13577,...} 量级对得上才算数据下完了

# ② 检索通（正文命中）
curl -s "https://poem-source-<环境>.sh.run.tcloudbase.com/api/v1/poems/search?q=床前明月光&type=content"

# ③ 单字出诗（飞花令那条路）
curl -s "https://poem-source-<环境>.sh.run.tcloudbase.com/api/v1/poems/random?char=春"
```

真机上再看一眼控制台那行 `[remote] GET cloud env=… service=poem-source path=/api/v1/…`。
`service=poem-source` 才对得上；回 `invalid host` 就是云托管里没有这个名字。

## 五、踩过的坑

| 现象 | 真因 |
|---|---|
| 点课外诗一律「取不到正文」，日志里一个请求都没有 | 课外篇目没进本机索引，`sourceIdOf` 回空；不再有兜底 |
| 回 `invalid host` | `SOURCE_AGENT` 与云托管里那个服务名不一致，或服务建在别的环境 |
| 回 `102002` | 实例缩容到 0，冷启动超过 15 秒。最小实例数设 1，或重试 |
| 检索一次要好几秒 | 单字 / 两字的检索靠单字倒排索引，正常是毫秒级；慢说明库刚下完索引还没建，或实例在冷启动 |
| 飞花令判「不在集子里」 | 客户端还在用本地判句（`feihua.judge`）。`onSource()` 为真时必须走 `judgeAsync` |
| 前端拿到了 40 万首的列表 | `page_size` 没有截到 100 —— 服务端会 400，客户端也不该发 |
