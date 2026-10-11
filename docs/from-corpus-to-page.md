# 从语料文件到手机上一行诗：四段链路

> 回答一个问题：**`build-data.js` 跑完之后，还要什么，数据才会出现在页面上。**
> 四段各管一段，断在哪一段的症状不同，认准症状就知道该修哪一段。

## 一、四段分别是什么

| 段 | 这一步做什么 | 做完之后东西在哪 | 断了会看到什么 |
|---|---|---|---|
| ① 文件层 | `bash scripts/clone-poem.sh /tmp/poem` 取 poem；`POEM_WEB_DIR=/tmp/poem npm run build:data` 编译 | `miniprogram/data/**`（**不入库**，`.gitignore` 挡着） | 首页整块「语料未生成」 |
| ② 本地页面 | 微信开发者工具打开 `miniprogram/` 目录；勾上「不校验合法域名」 | 本地窗口 | 有目录、点得开、课内 251 首能背 |
| ③ 容器 | 推 `main` 出镜像 → 云托管建服务 → 配环境变量 → 建表 → 小程序里填云调用两栏 | 真机 | 课外 5604 首点开说「这一篇取不到正文」 |
| ④ 真机 | 云调用两栏在**每台手机**的本机存储里，换机要重填 | 真机 | 同上，且开发者工具里正常 |

**「语料未生成」只属于第 ① 段。** 它不是说服务器没起、也不是说后端没配 ——
是包里的 `data/books/books.json` 取不到。两条来路要分开：

- **本地打开**：`miniprogram/data/` 这个目录在磁盘上都还没有 —— 跑一次 ① 段就好。
- **体验版/正式版**：语料是流水线在打包**之前**生成的（`.cnb.yml` 的「上传体验版」
  那一步重跑 `build-data.js`），数据目录**不入 git**。所以这一版还报「语料未生成」，
  只能是**这一次上传的包本身就没带语料** —— 要么流水线那一步红过（它是
  `allow_failure`，会失败而流水线仍是绿的），要么这一版压根不是流水线传的。

分得清是因为空态会印出一个版本号：`wx.getAccountInfoSync().version`，
由 `app.js` 在 `onLaunch` 时记进本机。带版本号＝这个包是打包上传的；
不带＝本地工具打开的，那就去跑 ① 段。

## 二、① 段：文件是怎么编出来的

```
poem/data/*.js（上游语料，5855 条）
  ↓ scripts/clone-poem.sh —— 检出 poem.lock.json 钉住的那个 commit
bash scripts/clone-poem.sh /tmp/poem
  ↓ scripts/build-data.js —— 读 poem 的 data/，写 miniprogram/data/
POEM_WEB_DIR=/tmp/poem npm run build:data
```

`build-data.js` 一次产出六样，落在哪里决定了它后面走哪条路：

| 产物 | 谁读它 | 体积 |
|---|---|---|
| `data/books/*.json` + `books.json` | 列表页、检索、作者索引 | 索引合计约 1 MB，**进主包** |
| `data/course.json` | 首页「每日背诵」、详情页 | 课内 251 首，约 235 KB，**进主包** |
| `data/pinyin-table.json` | 注音 | 72 KB，**进主包** |
| `data/shards.json` | `corpus.bucketOf(id)` —— 算出某一条在哪一片 | 137 KB，**进主包** |
| `data/texts/t0xx.json` | 课外正文分片 | 120 个文件 / 23 MB，**走容器** |
| `data/roster.json` | 管理页名录 | 没设 `POEM_ROSTER` 就是空名册 |

第三列是分层的全部理由：主包上限 2 MB，23 MB 的正文进不去。
课内那 235 KB 进包，是因为首页出题与详情页都要它，进包等于省掉一次网络往返 ——
账在 [`architecture.md`](architecture.md) § 三。

两个坑记在这里：

- **`miniprogram/data/` 不进 git**，所以 clone 下来直接开工具一定是白屏 —— 这不是 bug。
  推 `main` 的流水线会**自己重跑一遍** `build-data.js`，所以体验版里有数据、你本地没有，
  两件事同时成立。
- **Windows 上 `POEM_WEB_DIR=/tmp/poem npm run build:data` 这条不成立**（那是 sh 语法）。
  PowerShell 与 cmd 的写法见 `README.md`「Windows 上怎么设 `POEM_WEB_DIR`」。

## 三、② 段：为什么文件在手，课内就能读

`utils/corpus.js` 是唯一读语料的地方，它先问一句 `hasData()` ——
**包里那份 `data/books/books.json` 取不取得到**（`require` 得中就是有）。
取不到就抛 `E_NO_DATA`，首页据此渲染空态。

⚠️ 这里判的**不是**「磁盘上有没有 `data/` 这个目录」。真机没有 `fs`，
而且 `data/` 会按包边界拆着打（`data/texts/` 走容器）—— 看目录的探针在真机上
既量不到、又量错：目录在、包内文件缺时它一律回「有数据」，首页于是跳过空态，
渲染出一个空目录，看着像「数据丢了」。

在的话，读的顺序是：

```
corpus.course()          → data/books/poems.json（课内索引，不带正文）
corpus.entry(id)         → data/course.json 里查这一条正文
corpus.ensureEntry(id)   → course.json 没有再走分片（下一节）
```

**课内 251 首这一整段不需要网络、不需要后端、不需要容器** ——
索引和正文都在包里。断网也能背，靠的就是这一步。

所以「数据没进页面」在这段只有一个原因：文件没生成。跑一次 ① 段即可。

## 四、③ 段：课外 5604 首怎么走

课外正文不在包里，只有一份**清单**（`data/shards.json`）在包里。
点开一首课外诗时：

```
corpus.ensureEntry(id)
  → bucketOf(id) 查清单，算出片名 t017
  → corpus.bucket("t017")     先试 require（真机上 ignore 掉了，读不到）
  → corpus.shardFromDisk()    再试磁盘：开发者工具打开 miniprogram/ 时走这一条
  → remote.shard("t017")      都没有才走云：utils/remote.js → wx.cloud.callContainer
  → 容器 /api/shard/t017      deploy-api-serve/shard-api.js 读 /app/shards/t017.json.gz
  → 200 + Content-Encoding: gzip（每片约 44 KB）
  → corpus 缓存这一片（上限 40 片）→ 渲染
```

**磁盘那一条是给开发者工具留的。** 工具是真机打包器：`data/texts/` 被 ignore 掉，
`require` 一律抛 `MODULE_NOT_FOUND`；但那个目录就在你本机磁盘上。
少了这条兜底，本地跑完 ① 段也只能读课内，课外一律「这一篇取不到正文」——
而「这一篇取不到正文」在真机上指的是另一件事（下一节）。
真机上没有 `fs`，这条自动跳过，行为与从前一致。

⚠️ **清单必须进包，正文必须不进包。** `project.config.json` 的 `packOptions.ignore`
排掉整个 `data/texts/`；清单一落进去，`bucketOf()` 就一律回空，
**连请求都不会发**，界面只能说「这一篇取不到正文」。
这条边界由 `check.js` 静态钉着，见 [`shard-delivery.md`](shard-delivery.md)。

容器里有没有分片，由镜像的构建参数决定：`COPY_SHREDS` 不写＝**有**，
`=0`＝瘦镜像（`/api/shard/*` 回 `404 E_NO_SHARDS`，界面说「这个版本里没有课外正文」）。
这两句话指向的下一步动作不同，一路上都不许合并成一句「加载失败」。

**第三段要到这一步才算完：**

```
git checkout main && git push                → 流水线出镜像
云托管按镜像建服务、拉到实例起来
配 SESSION_SECRET / MYSQL_* / WX_APPID / WX_SECRET    docs/wx-cloud-setup.md § 三
先 `CREATE DATABASE \`poem\`` + `USE \`poem\``，再整段跑 deploy/sql/mysql-schema.sql   § 四
小程序 → 我的 → 用户与权限 → 云调用两栏（env + 服务名）  § 6.2
```

整段照 [`wx-cloud-setup.md`](wx-cloud-setup.md) 走。

## 五、④ 段：云调用两栏是**本机设置**

那两格不是微信后台的配置项，也不影响线上服务 ——
值存在这台手机的本地存储里（`store.KEYS.auth` → `auth.cloud`）。
所以：**换台手机要重填一次**，这不是没保存住。

最容易撞的是把两个标识符填串：

| 填哪一格 | 是什么 | 回什么错 |
|---|---|---|
| `config.env` | **云开发**环境 ID，形如 `poem-d9g1bqeq978682c58` | 填了云托管那个数字 ID → `env not exists` |
| `X-WX-SERVICE` | 云托管的**服务名**（本部署是 `poem-wx`） | 填成环境 ID → `service not found` |

`baseUrl` 留空 —— 两个都填时以 `baseUrl` 为准，把云调用那条路顶掉。

## 六、认症状

| 看到什么 | 断在哪一段 | 下一步 |
|---|---|---|
| 首页整块「语料未生成」，副标题**带着一个版本号** | ① 之前 —— 这一版**根本没打进语料**，本地跑构建救不了它 | 见下 |
| 首页整块「语料未生成」，副标题是「本地跑过 build:data…」 | ① | `bash scripts/clone-poem.sh /tmp/poem && POEM_WEB_DIR=/tmp/poem npm run build:data` |
| 有 251 首目录、点得开、能背 | —— | ①② 都通，课外要去接 ③ |
| 点课外诗：「还没接上同步服务器（云调用两栏）」 | ③/④ | 云调用两栏没填或填错，见 § 五 与 `wx-cloud-setup.md` § 6.2 |
| 点「微信登录」弹「还没接上同步服务器」 | ③/④ | 这个包还没配。**未登录也有入口**：「我的 → 数据与账号 → 同步服务器」 |
| 管理页拉不到「云调用」两栏 | ③/④ | 只让管理员填；非管理员在「我的 → 同步服务器」那一行会被告知去找部署方 |
| 点课外诗：「这个版本里没有课外正文」 | ③ | 这个镜像构建时 `COPY_SHREDS=0`，取新镜像 |
| 点课外诗：「这一篇取不到正文」 | ③ | 清单进了包、但容器那一侧没接上（或这一条真不在任何分片里） |
| 开发者工具正常、真机不行 | ④ | 云调用两栏在这台手机上重填；`baseUrl` 清空 |
| 登录「成功」了但库里没有新行 | ③/④ | 见 `wx-cloud-setup.md` 排错表同一条 |

## 七、这张口径怎么守

`check.js` 里与这一段相关的断言：

- `data/shards.json` 不在 `packOptions.ignore` 名下（读 `corpus.js` 的 `MANIFEST` 常量比）
- 包内正文就是课内那 251 条，且包内与分片不重叠
- 课内正文单列 400 KB 预算，超了报红
- 首页有「语料未生成」的空态

这几条都是**静态**判据：Node 里跑不出真机的样子，所以只能钉住边界本身。
真机那一段没有自动化 —— 那是「真机走一遍」记在 `README.md` 提审前清单里的原因。
