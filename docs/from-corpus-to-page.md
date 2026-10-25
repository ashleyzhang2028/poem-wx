# 从语料文件到手机上一行诗：三段链路

> 回答一个问题：**`build-data.js` 跑完之后，还要什么，数据才会出现在页面上。**
> 各段管一段，断在哪一段的症状不同，认准症状就知道该修哪一段。

## 一、三段分别是什么

| 段 | 这一步做什么 | 做完之后东西在哪 | 断了会看到什么 |
|---|---|---|---|
| ① 文件层 | `npm run build:data` 编译（语料在 `scripts/corpus/`，随仓库走） | `miniprogram/data/**`（**不入库**，`.gitignore` 挡着） | 首页目录空着、控制台说「语料 没进这个包」 |
| ② 本地页面 | 微信开发者工具打开 `miniprogram/` 目录；勾上「不校验合法域名」 | 本地窗口 | 有目录、点得开、课内 251 首能背 |
| ③ 真机 | 云调用两栏在**包里**（`miniprogram/utils/server.js`，构建期注入）；容器那侧照 `wx-cloud-setup.md` 建服务、配环境变量、建表 | 真机 | 登录与同步不通，正文照读（正文全在包里） |

**「语料没进这个包」只属于第 ① 段。** 它不是说服务器没起、也不是说后端没配 ——
是**这个包里的 `data/books/books.js` 取不到**。两条来路要分开：

- **本地打开**：本地没编过，`miniprogram/data/` 在磁盘上都不存在 —— 跑一次 ① 段就好。
  注意开发者工具**不会**替你跑这一步：`npm test` / `.cnb.yml` 只在 CI 里跑，
  本地那份 `data/` 得手动编译，工具里再重新编译一次才会进包。
- **体验版/正式版**：语料是流水线在打包**之前**生成的（`.cnb.yml` 的「上传体验版」
  那一步重跑 `build-data.js`），数据目录**不入 git**。所以这一版还缺语料，
  只能是**这一次上传的包本身就没带语料** —— 要么流水线那一步红过（它是
  `allow_failure`，会失败而流水线仍是绿的），要么这一版压根不是流水线传的。

首页**不为这件事单独出一张卡**：语料缺了照常渲染，各卡片按自己那点数据报错。
是哪一段断的，看 `app.js` 在 `onLaunch` 打的那一行 —— `版本 <rev> · 语料 <有/无>`，
`rev` 来自 `wx.getAccountInfoSync().version`。带版本号＝这个包是打包上传的；
不带＝本地工具打开的，那就去跑 ① 段。

## 二、① 段：文件是怎么编出来的

```
scripts/corpus/data/*.js（语料，随仓库走）
  ↓ scripts/build-data.js —— 读它，写 miniprogram/data/
npm run build:data
```

`build-data.js` 一次产出六样，**全部进主包**：

| 产物 | 谁读它 | 体积 |
|---|---|---|
| `data/books/index.js` | 列表页、检索、作者索引（只有课内那一部） | 18 KB |
| `data/books/books.js` | 集子表（11 条：课内一部 + 目录那十部） | 4 KB |
| `data/books/catalogs.js` | 十部集子的目录（书名 + 标题 + 作者或出处，正文一个字不在里面） | 84 KB |
| `data/course.js` | 首页「每日背诵」、详情页 | 课内 251 首，约 235 KB |
| `data/pinyin-table.js` | 注音 | 62 KB |
| `data/roster.js` | 用户列表页名录 | 没设 `POEM_ROSTER` 就是空名册 |

课内那 235 KB 进包，是因为首页出题与详情页都要它，进包等于省掉一次网络往返 ——
账在 [`architecture.md`](architecture.md) § 三。编译同时删掉上一版的
`data/texts/` 与 `data/shards.js`（课外正文那套已经不产出了）。

两个坑记在这里：

- **`miniprogram/data/` 不进 git**，所以 clone 下来直接开工具一定是白屏 —— 这不是 bug。
  推 `main` 的流水线会**自己重跑一遍** `build-data.js`，所以体验版里有数据、你本地没有，
  两件事同时成立。
- **换一版语料是一次要人来做的事**：把 `scripts/corpus/` 整份换掉、
  把 `VERSION.json` 的 `upstreamRef` / `syncedAt` 改过来，再跑构建与自检。
  没有「自动跟上游」那条流水线了 —— 那是跨仓库依赖的一部分，已经撤掉。

## 三、② 段：为什么文件在手，课内就能读

`utils/corpus.js` 是唯一读语料的地方，它先问一句 `hasData()` ——
**包里那份 `data/books/books.js` 取不取得到**（`require` 得中就是有）。
取不到就抛 `E_NO_DATA`，各读语料的入口按空值回。

判据必须是「包内 require 得中」，不能是「`fs.existsSync(miniprogram/data)` 目录在不在」。
真机没有 `fs`；开发者工具里那个目录恒在磁盘上，两类环境量到的东西正好相反 ——
目录在、包内文件缺时目录判据一律回「有数据」，首页于是拿空目录往下渲染，
看着像「数据丢了」。

同理，`books.js` / `course.js` 的 `require` 路径都写成字面量 ——
打包器只认静态字符串，拼出来的路径它看不见，包内一样取不到。`check.js` 钉着这两条。

⚠️ **语料的根本判据是「在模块图上」。** 打包器（开发者工具编译、`miniprogram-ci`
上传各一条路径）按模块图剔文件：图上够不到的，一律当「没人 require 的文件」踢出包。
而图上只有 `.js` 里**字面量**的 `require("./x")`。

三份语料曾经是字面量、其余 19 份是拼接路径（`readJson(BOOKS_DIR + id + ".js")`、
`require("../" + TABLE)`），那 19 份就被剔出包。症状不齐整、最难认：
`books.js` 在（集子表渲染得出来），`poems.js` 不在（**首页课内目录整块空**），
点进每一部也都是空的 —— 磁盘上文件明明在，跑多少次 `build:data` 都没用。

修法是把每一份该进包的文件都写进字面量 `require` 表：

| 表 | 在哪 | 管哪几份 |
|---|---|---|
| `PACKED` | `utils/corpus.js` | `books.js` / `course.js`（集子索引也在这张表里） |
| `PACKED_TABLE` | `utils/pinyin.js` | `pinyin-table.js` |

关键在**读文件的那一行要走到那张表**：`ofBook` 写 `indexPack()`（它调 `PACKED.index()`），
`pinyin.table` 写 `PACKED_TABLE()`。只摆一张没人调的表，摇树照旧剔。
`check.js` 从 `app.js` 与各页面走一遍模块图钉这条。

配置那三处（下一节）是**兜底**，不是根因上的修法：`ignore*UnusedFiles` 关的是
分析器的行为，`include` 是「无论分析器怎么想都带上」。它们挡不住「读文件的那行
根本不走字面量表」这种改法，模块图判据才挡得住。

在的话，读的顺序是：

```
corpus.course()          → data/books/index.js 里 poems 那一组（课内索引，不带正文）
corpus.entry(id)         → data/course.js 里查这一条正文
corpus.ensureEntry(id)   → 同一条，回 Promise；包内没有就抛 E_NO_TEXT
```

**课内 251 首这一整段不需要网络、不需要后端、不需要容器** ——
索引和正文都在包里。断网也能背，靠的就是这一步。

所以「数据没进页面」在这段只有一个原因：文件没生成。跑一次 ① 段即可。

## 四、③ 段：只剩「登录与同步」

课外正文那一条（分片清单 → 本机缓存 → 磁盘 → `wx.cloud.callContainer` →
容器 `/api/shard/*`）已经整体删掉：语料里不再有课外集子的条目与正文，
`data/shards.js` 与 `data/texts/` 不再产出，容器也不再有那条路由。
客户端不再留任何分片兜底：`corpus` 只查包内，缺正文就报 `E_NO_TEXT`，
不看网络也不发请求。现在**正文全在包里**，读一篇不需要网络、不需要后端、不需要容器。

⚠️ **语料进包靠三处配置，不是「生成了就自然进」。** 编译器的模块图只认 `.js` 依赖，
`data/` 下的 JSON 一个都不在图上，默认会被当「无依赖文件」摇掉：

| 处 | 管哪条路 | 值 |
|---|---|---|
| `setting.ignoreUploadUnusedFiles` | 上传（`miniprogram-ci`） | `false` |
| `setting.ignoreDevUnusedFiles` | 开发者工具的模拟器 / 预览 / 真机调试 | `false` |
| `packOptions.include` | 上面两条的兜底（压过 `ignore`） | `data/books` 与三份根模块 |

两只 `ignore*UnusedFiles` 是**两个**开关，关一只另一条路照样摇。`include` 是
「无论分析器怎么想都带上」的那一档，`check.js` 钉着它必须覆盖 `data/books` /
`course.js` / `pinyin-table.js` / `roster.js`。

这三处都只是保险。真正的判据在上一节：**每一份该进包的语料都要在模块图上**。

**这一段要到这一步才算完：**

```
git checkout main && git push                → 流水线出镜像
云托管按镜像建服务、拉到实例起来
配 SESSION_SECRET / MYSQL_* / WX_APPID / WX_SECRET    docs/wx-cloud-setup.md § 三
先 `CREATE DATABASE \`poem\`` + `USE \`poem\``，再整段跑 deploy/sql/mysql-schema.sql   § 四
两栏的值在代码库里（`miniprogram/utils/server.js`），构建期由密钥仓库覆写；界面上没有填的地方  § 6.2
```

整段照 [`wx-cloud-setup.md`](wx-cloud-setup.md) 走。

## 五、云调用两栏**构建期注入进包，用户不必填**

两格的值是部署方的密钥，存在密钥仓库 `wechat-ci.yml`：

| 变量 | 是什么 |
|---|---|
| `CLOUD_ENV` | **云开发**环境 ID，形如 `poem-d9g1bqeq978682c58` |
| `CLOUD_SERVICE` | 云托管的**服务名**（本部署是 `poem-wx`） |

流水线把这两个变量交给 `build-data.js`，它据此**覆写** `miniprogram/utils/server.js`
里那两个值，随包走，用户装上去就能用。本机没注入时两格为空（值不动），
界面照实说没配服务器。

⚠️ `server.js` 的文件本体**入库**（值是空的），只有值由构建期写。别把它加进
`.gitignore`：它不在时 `remote.js` 里那句 `require("./server")` 会抛
`MODULE_NOT_FOUND`，整个模块加载失败；而主包每个页面都直接或间接 require `remote` ——
页面在 `onLoad` 之前就报错，**首页连语料一起渲染不出来**，看着恰好像「语料没进包」。
`remote.js` 对这句 require 另有一层兜底（读不到就坐实「没配」），两层都要有。

本机跑一遍要验证这条路：

```bash
CLOUD_ENV=… CLOUD_SERVICE=… npm run build:data
```

两个标识符容易填串，串了的回错是 `env not exists` / `service not found`。

调 `callContainer` 之前必须先 `wx.cloud.init({ env })`，否则真机一律回
`errCode: -1 | errMsg: Cloud API isn't enabled, please call ...`，登录与同步一起哑掉。
这一步在 `utils/remote.js` 的 `cloudReady()` 里，同一个 env 只 init 一次、env 变了重新 init。

两栏的值**只存在于代码库**（`miniprogram/utils/server.js`，构建期由密钥仓库覆写）：
换后端改那份或改密钥仓库变量重跑流水线，界面上没有配置入口（Issue #198）。

## 六、认症状

| 看到什么 | 断在哪一段 | 下一步 |
|---|---|---|
| 首页目录空着，控制台「版本 xxxx · 语料 没进这个包」 | ① 之前 —— 这一版**没打进语料**（多为模块图摇树剔掉） | 合上把语料写成字面量 `require` 的那一版，重传。若三处配置没配齐也会摇掉 —— 见上一节 |
| 首页目录空着，控制台「版本 本地打开 · 未上传 · 语料 没进这个包」，编译输出里一行 `ignoring files: data/books/index.js …` | ① —— 工具把语料当「无依赖文件」摇掉了（`ignoreDevUnusedFiles` 默认 true），磁盘上那份明明在 | 配置里补 `ignoreDevUnusedFiles: false` 与 `packOptions.include`（见上一节），重开项目再编译。与 `npm run build:data` 无关：构建跑过也不代表工具肯把它打进包 |
| **首页整页空、连「课本目录」那张卡片都没有**，控制台 `Cannot find module './server'` | ① 之前 —— `server.js` 不在，`remote.js` 加载失败，页面根本没跑起来 | 把 `miniprogram/utils/server.js` 从 git 捡回来（空壳，**要入库**），重新编译。见 § 五 |
| 控制台 `module 'data/xxx.json.js' is not defined` | 工具（2.02.2607271 RC 实测）不把 `.json` 当模块打包，任何 `require("….json")` 都抛这句；`.js` 正常（Issue #224） | 进包的语料产物一律输出为 `module.exports = …` 的 `.js`（`build-data.js` 的 `writeModule`） |
| 首页目录空着，控制台「版本 本地打开 · 未上传 · 语料 没进这个包」，编译输出里没有 `ignoring files` | ① | `npm run build:data`，再在开发者工具里重新编译 |
| 有 251 首目录、点得开、能背 | —— | ①② 都通；登录与同步要去接 ③ |
| 点「微信登录」弹「还没接上同步服务器」 | ③ | 这个包还没配。改 `miniprogram/utils/server.js` 那两个值，或按 § 五 重跑流水线 |
| 界面上找不到云调用两栏 | ③ | 运维配置本就不在界面上；改 `miniprogram/utils/server.js` 那两个值 |
| 点开一篇说「这一篇的正文不在这个包里」 | ① | 语料没编全，或这一条的正文干脆没有 —— 跑一次 ① 段再编译 |
| 开发者工具正常、真机不行 | ③ | `server.js` 那两个值填错，或 `baseUrl` 留着 —— 核对代码库里那份，重出体验版 |
| 登录「成功」了但库里没有新行 | ③ | 见 `wx-cloud-setup.md` 排错表同一条 |

## 七、这张口径怎么守

`check.js` 里与这一段相关的断言：

- `books.js` / `course.js` 都是字面量 `require`，`hasData()` 里没有 `fs` 判据
- **主包每一份语料都在模块图上**（从 `app.js` 与各页面走 require 图），且读文件的那行走到字面量表
- `setting.ignoreUploadUnusedFiles` 与 `setting.ignoreDevUnusedFiles` 都显式是 `false`
- `packOptions.include` 列出该进的语料
- `server.js` 是入库的空壳（不许被 gitignore 挡住），且 `remote.js` 对它的 require 有兜底
- 界面上没有任何连接配置入口（云调用两栏只在代码库里配）；用户看得到的地方不出现「云调用」
- 包内正文就是课内那 251 条；包里不再有 `data/texts/` 与 `data/shards.js`
- 课内正文单列 400 KB 预算，超了报红
- 首页不摆语料空态卡；`app.js` 在 `onLaunch` 报版本与语料在不在
- 课本目录那一屏（未登录首页）没有目录时必须自己说出来（`catalogLead` + `!catalogCount`），
  不许整块空着

这几条都是**静态**判据：Node 里跑不出真机的样子，所以只能钉住边界本身。
真机那一段没有自动化 —— 那是「真机走一遍」记在 `README.md` 提审前清单里的原因。
