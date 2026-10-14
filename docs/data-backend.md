# 数据在哪、后端怎么解耦、CI 为什么会被上游绊住

> 这份文件回答 Issue #111 的三个问题：
>
> 1. **现在小程序的数据库服务是什么？**
> 2. **后端存储怎么解耦、换库要动什么？**
> 3. **小程序的数据是怎么管的、放在哪里？上游改数据集导致这边 CI 出故障，有没有办法？**
>
> 先给结论，再给账。凡是要动代码的地方，都标了「已做 / 待做 / 不做」。

---

## 一、先分清五样东西，它们的归属完全不同

「后端依赖」这四个字，在这份工程里对应的其实是**五件互不相干的事**。
把它们混成一件，就会得出「换掉数据库要重写一遍」这个错结论。

| # | 是什么 | 现在在哪 | 属于谁 | 用户能不能感觉到 |
|---|---|---|---|---|
| ① | **运行时代码**（登录 / 同步 / 管理那几条路由） | 仓库根的 `api/`，跑在我们自己的容器里（微信云托管，走**云调用**） | **这个项目** | 能（登录、换手机还在不在） |
| ② | **数据存储**（账号 / 会话 / 进度 / 设置） | 代码里是**可替换**的存储层，接口是一组 `getX / putX / listX`；线上实现 = 腾讯云 MySQL | 运营选择 | 能（数据在不在） |
| ③ | **静态资产**（5604 条课外正文分片 + 倒排索引） | 现在是**构建产物，跟包走**（`miniprogram/data/`） | **这个项目** | 基本感觉不到（除非你打算上 CDN） |
| ④ | **构建输入**（语料从哪来） | 语料在 **`scripts/corpus/`**（随本仓库走），`scripts/build-data.js` 读它 | **这个项目** | 不能 |
| ⑤ | **代码镜像**（GitHub 只读镜像） | 推 `main` 时同步过去 | 这个项目 | 不能 |

**①②③④⑤ 里，只有 ② 是「数据库」这件事，而且它本来就是一个可替换件。**
所以「减少对外部服务的依赖」这件事，成本不在小程序前端（那边一行都不用改），
而在**服务端存储层的实现**。

### 一句话结论

- 小程序**不需要备案**已经做到了：出网走**云调用**（`wx.cloud.callContainer`），
  不经过 request 合法域名那张名单。这一条与数据库无关，早就落地了。
- **线上那台库是腾讯云 MySQL**，跑在云托管同一个 VPC 里 —— 数据不出境、
  也不受第三方托管商的可用性影响。要换别的（比如云开发数据库）就是再写一个
  store 实现，**不是重写后端**。
- 「上游改数据集 → 这边 CI 红」那条依赖已经**整个撤掉**：语料搬进本仓库
  `scripts/corpus/`，构建不再 clone 另一个仓库（见 § 四）。

---

## 二、存储层到底在哪：一个接口，两个实现

`api/_lib/store.js` 里那组 `getX / putX / listX` 是**契约**：
`api` 对象上的方法名就是全部约定，路由层只认这些名字，**不认底下是谁**。

```
                     ┌─ memoryStore()   ← 本地自检 / e2e（进程内存）
getStore(cfg) ───────┤
                     └─ mysqlStore()    ← 线上（腾讯云 MySQL）
```

- **`memoryStore()`** 是内存档，本地自检与 `e2e-wx-sync.js` 跑的就是它 ——
  换句话说，「换库」这件事**有两份实现同时在跑**，插槽是活的。
- **`mysqlStore()`** 是本仓库新加的那份：代码在 **`deploy/store-mysql.js`**，
  建表语句在 **`deploy/sql/mysql-schema.sql`**。

### 它在哪儿接上去：`serve-api.js`

这一点值得单独说清，因为它决定了「改了这里，路由层要不要跟着动」这个问题的答案。

数据库选择不写进路由，写在容器的入口上：

```
serve-api.js（这份镜像的入口）
  ├─ 认 MYSQL_HOST  → 建连接池 → 把 getStore() 换成 mysqlStore（并 _reset 单例）
  └─ 不认            → 什么都不做，原样（内存档）
  ↓
require("./api/handler.js")   ← ⚠️ 必须在上面那步**之后**：handler 在 require 时就取单例
```

于是 **`api/` 一行都不用改**，它压根不认识 MySQL。接线、建池、`mysql2` 依赖
全落在 `deploy/` 与 `deploy-api-serve/` 这两处（自检 V49 钉着这一段）。

### 「换库」这件事实际动到的四处

| 动哪 | 做什么 | 已经做完的 |
|---|---|---|
| `deploy/store-mysql.js`（新增） | 按 `store.js` 里 `api` 对象**同一个形状**实现一遍（方法名逐字相同） | ✅ |
| `deploy/sql/mysql-schema.sql`（新增） | 建表语句；条件 upsert 见 § 三.3 | ✅ |
| `serve-api.js` 里接线 | `MYSQL_HOST` 在 → 建池、换 `getStore()`、`_reset()`；不在 → 原样 | ✅ |
| `Dockerfile` / `.cnb.yml` / `build.sh` | 装 `mysql2`；把 `store-mysql.js` 摊进构建上下文 | ✅ |

**小程序前端一行都不用改。** 登录、同步、管理的报文与路径都不动 ——
客户端只认 `PATHS` 与报文形状，不认对面是谁。

---

## 三、腾讯云 MySQL 这条路：三处最容易踩的坑

### 3.1 环境变量

云托管控制台 → 服务设置 → **环境变量**：

```
SESSION_SECRET=<openssl rand -hex 32>
MYSQL_HOST=<内网地址>            # 云托管与 MySQL 在同一个 VPC
MYSQL_PORT=3306
MYSQL_USER=poem
MYSQL_PASSWORD=<口令>
MYSQL_DATABASE=poem
WX_APPID=wx200a0c667fc67fcb
WX_SECRET=<小程序 appsecret>
```

### 3.2 `jsonb` → `json`

MySQL 的 `json` 不做 GIN 索引，也不做规范化。这里 `payload` 一直是**整取整存**
（没有行内 JSON 查询），所以没影响 —— 但**别顺手加**「按 payload 里某个键筛选」
的新查询：MySQL 上那条会全表扫。

### 3.3 「新的赢」是下沉在数据库层的原子约束

现在的核心不变式是「**新的赢，旧的到了也不许覆盖**」——
断网重连后一批旧数据补发时，晚到的旧值不许盖掉新值。它**不是**靠 JS 里的比较，
而是下沉在数据库层的那一句里（`deploy/sql/mysql-schema.sql` 的 `kb_upsert_progress`）。

**为什么不能「等价改写」成应用层的读-比-写**：两条请求并发时，读到的
`updated_at` 可能已经过时 —— 那就又用旧值盖了新值。这正是当初把它放进数据库的原因。

MySQL 里写法是这样（`ON DUPLICATE KEY UPDATE` **没有 `WHERE`**，
条件只能塞进赋值表达式，而且**每一列都要写**）：

```sql
INSERT INTO progress (uid, child_id, poem_id, payload, updated_at, deleted)
VALUES (?,?,?,?,?,?)
ON DUPLICATE KEY UPDATE
  payload    = IF(VALUES(updated_at) >= updated_at, VALUES(payload), payload),
  updated_at = GREATEST(updated_at, VALUES(updated_at)),   -- 只增不减
  deleted    = IF(VALUES(updated_at) >= updated_at, VALUES(deleted), deleted)
```

只给 `payload` 加 `IF(...)`、把 `updated_at` 无条件盖上去，就会造出
「payload 是旧的、updated_at 是新的」这种**一半新一半旧**的行 ——
它下一次还会把真正的新值顶掉，而且**到处都不报错**。InnoDB 的行锁在，
所以这一句仍然是原子的。

### 3.4 `bigint` 的时间戳

这里存的是 `Date.now()` 毫秒（`bigint`）。MySQL 的 `bigint` 没问题，
但**驱动默认会把超过 2^53 的整数转成字符串** —— `Date.now()` 现在远没到那个量级，
**但 `deploy/store-mysql.js` 里每一处读出来的数都过一遍 `Number()`**，
否则将来某一天会得到「时间戳是字符串」这种要查半天的错。

### 3.5 建库 → 建表 → 操作入口（顺序别颠倒）

⚠️ **实例自带的库只有 MySQL 自己的那几个**（`information_schema` /
`performance_schema` / `mysql` / `sys` / `__cdb_recycle_bin__`）。
DMS 里只列出它们，**不是选错了，是 `poem` 这个库还没建** —— 建表语句建的是
**表**，它得先有个库可落；那五个一个都不能当落点（在 `mysql` 库里建
`accounts`，是在改账号字典）。

```sql
-- ① 先建库（实例里只有系统库时，这是缺的那一步）
CREATE DATABASE IF NOT EXISTS `poem` DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci;
SHOW DATABASES;          -- 要能列出 poem

-- ② 再切库：建表语句里的 CREATE TABLE 不带库名，靠的就是当前库
USE `poem`;
SELECT DATABASE();       -- 回 poem 才算切上了；没切会是一片 No database selected

-- ③ 整段执行 deploy/sql/mysql-schema.sql（幂等）
-- ④ 确认建上了
SHOW TABLES;             -- 要看到 accounts / wx_accounts / progress / sessions …
```

入口：`cloud.weixin.qq.com → 云托管 → 服务所属环境 → MySQL → 数据管理 / SQL 窗口`
（DMS 也是同一个窗口）。操作步骤与排错表见
[`wx-cloud-setup.md`](wx-cloud-setup.md) § 3.1 与 § 四。

⚠️ **`MYSQL_DATABASE` 要和你建的库名逐字对上。** 对不上时驱动在建池那一刻抛
`ER_BAD_DB_ERROR`，而进程照起、日志里那行 `[store] 存储层 = 腾讯云 MySQL …`
照打 —— 症状是「看着配好了，但登录一律 500」。自检 V49 钉着这一条：
`deploy/store-mysql.js` 里那个默认库名必须和 `wx-cloud-setup.md` 写的是同一个。

建完表之后，第一个管理员直接在库里改：

```sql
UPDATE accounts SET role = 'owner' WHERE uid = '<你的 uid>';
```

---

## 四、跨仓库那条依赖已经撤掉（2026-10-12）

### 4.1 以前的问题

`.cnb.yml` 里每一个任务的第一步都是 clone 另一个仓库取语料：

```bash
bash scripts/clone-poem.sh /tmp/poem      # 取另一个仓库的锁定版本
POEM_WEB_DIR=/tmp/poem node scripts/build-data.js
```

于是「CI 绿」同时挂上了三件毫不相干的事：我们的代码对不对、
上游今天改没改、这两件事碰在一起会怎样。任何一件变，整条红 ——
推 main 的人成了受害者，而错在上游。中间那层「锁 + 定时跟随
（`poem.lock.json` / `poem-watch.sh`）」是把这件事从「随时红」压到「按节奏红」，
但它没有消掉依赖本身。

### 4.2 现在的做法：语料随仓库走

```
scripts/corpus/
  ├── VERSION.json    取自哪一版（upstreamRef / syncedAt）
  ├── data/           语料全量（含 text-master.js 与 author-index.js）
  ├── js/             构建与自检要读的那几个（pinyin / entitlement / sync-coverage）
  ├── scripts/        build-works-map.js（自检拿它挂 AuthorIndex）
  └── fonts/          标题宋体子集化的源（font:subset 用）

scripts/parity-web/   服务端契约的只读副本（路由表 / 报文清洗 / 存储层形状 / 能力表）
api/                  后端运行时契约（登录 / 同步 / 管理那几条路由）
```

构建、自检、e2e 读的都是仓库里这几份，**没有第二个仓库**。
`.cnb.yml` 里那一步就是一条命令：

```bash
node scripts/build-data.js
```

| 事件 | 谁受影响 | 结果 |
|---|---|---|
| 上游改了语料 | **没人** | 这里什么都不发生 —— 没有「跟」这回事了 |
| 我们推 main | 只有我们的代码 | 自检判的只有这一件事 |

### 4.3 换一版语料怎么做

一次**要人来做**的动作，三步：

1. 把新的 `data/` 与 `js/` 覆盖到 `scripts/corpus/`（整份换）
2. 改 `VERSION.json` 的 `upstreamRef` 与 `syncedAt`
3. `node scripts/build-data.js && node scripts/check.js` —— 绿了才算换过

红了的意思是「回来对一次」：要改的是 `check.js` 里那张 `K` 表（篇数 / 号段 /
归位那几条），**不是**去改上游。`.cnb.yml` 里那些取上游的步骤连同
`scripts/clone-poem.sh` 一类的脚本都撤掉了 —— 「跟上游」没有对象了。

## 五、现在数据到底怎么管的：一张图

```
① 内容（诗、译文、索引、注音表）
   scripts/corpus/（语料，随本仓库走）
     └─ build-data.js 编译 → miniprogram/data/**（构建产物，不进 git）
          · data/books/<集子>.json   各集子索引（不含正文）       → 进包
          · data/course.js         课内 251 首正文 + 译文       → 进主包
          · data/pinyin-table.js   读音表（离线注音）           → 进包
          · data/texts/**            其余 5604 条正文 + 倒排索引
                                     ⚠️ project.config.json 里被 ignore，**不进包**；
                                        而 CDN 那条路还没铺（等备案，见 todo.md 第 13 条）
                                        —— 今天这份分片既不在包里、也没处下载

     ⚠️ 编译这一步**不在 checkout 里**：产物不进 git，CI 上传体验版之前会重跑一次
     （见 .cnb.yml）。本地 clone 下来直接开开发者工具必然白屏 —— 先跑
     `node scripts/build-data.js`，见 README「快速开始」。

② 本机（每台手机自己一份，不上云）
   wx.setStorageSync 存：背诵进度、设置、已读标记、今日加背、自选清单、离线队列

③ 云端（跟账号走，登录即可用）
   我们的后端（云托管容器，走微信云调用）
     + 服务端存储层（腾讯云 MySQL，同一个 VPC 内网）
     存：账号 / 会话 / 进度（含 settings:v1 那个快照行）
     ⚠️ 头像**不在这儿** —— 它只落本机、不上传（见 design-system.md「头像」一节）
```

**用户能感觉到的差别只有一处**：换手机时数据在不在。这也是为什么界面文案
一条都不许提「本机 / 云端 / 后端」—— 用户不需要懂这张图（见 `design-system.md`）。

---

## 六、要动什么，按优先级排

| # | 做什么 | 为什么 | 状态 |
|---|---|---|---|
| 1 | 语料搬进本仓库（§ 四） | **解掉跨仓库依赖这条** | ✅ 已做（2026-10-12） |
| 2 | 这份文档 | 把「数据在哪」一次说清，省下每一次重问 | ✅ 已做 |
| 3 | 换到腾讯云 MySQL（§ 三） | 数据主权：不依赖境外托管商 | ✅ 已做（`deploy/store-mysql.js` + 建表语句） |
| 4 | 中文 CDN（把 `data/texts/**` 挪出包） | 现在 26MB 分片虽被 ignore，但没进 CDN 就等于「没缓存的条目要联网」这条还没真正兑现。**要走这一步，必须办备案** | ⏸️ 未办备案，见 `todo.md` 第 13 条 |

### 6.1 「后端拆到另一个仓库」这件事：不拆，改用 `ifModify`

动机是成立的：**小程序端推 main 不该重出一份后端镜像**。但达成它的手段不必是拆仓。

判据是 `ifModify`（CNB 的 Pipeline 字段，[语法](https://docs.cnb.cool/zh/build/grammar.md#pipeline-ifmodify)）：
`main` 的发布流水线只列 `api/**`、`deploy/**`、`deploy-api-serve/**` 与 `.cnb.yml` ——
这四样一个都没动，那一步连跑都不跑。名单与它必须一致，自检守着（`check.js`）。

推 `main` 之外还有一个人工入口：`main` 分支详情页上的「发布」按钮
（`.cnb/web_trigger.yml` → `web_trigger_release`）。脚本与推 `main` 那份是同一套，
只是不挂 `ifModify` —— 手动发版要的正是「不看改了什么，按当前代码重出一遍」。

拿 `main` 上那 357 个提交量过一遍：

| 类别 | 提交数 | 该不该出镜像 |
|---|---|---|
| 改了 `api/` / `deploy/` / `deploy-api-serve/` | 56 | 该 |
| 只改了 `scripts/check.js` 或 `.cnb.yml` | 255 | 不该 |
| 其余（`miniprogram/`、`docs/`、语料） | 46 | 不该 |

也就是说，**近 86% 的 main 提交是白出镜像**。`ifModify` 一句话消掉它们。

**为什么不拆仓**，两条硬理由：

1. **发布链就在要被拆掉的 `scripts/` 里。** 镜像的构建上下文是流水线在
   `/tmp/ctx` 摊出来的，而摊法、`.dockerignore` 白名单、四条端到端自检
   （`check.js` / `parity.js` / `e2e-wx-sync.js` / `e2e-mysql.js`）全在
   `scripts/`。要让后端自检跟着 `api/` 一起走，得把 `scripts/check.js`（7800 行、
   七成是小程序端断言）拆开 —— 而它一拆，两边都不再有完整的判据。
2. **微信端的上传与同步会跟着劣化。** 拆走之后，
   `miniprogram-ci` 上传体验版与「同步到 GitHub」要么只在新仓（那 CNB 的
   `CNB_TOKEN` 受 `build-in-env.md` 的**安全限制**约束：跨仓取私有仓要另配凭据）、
   要么留在旧仓（那老仓还是每次推 main 都跑一遍）。两条都不是「解耦」，
   是换一处耦合。

**不拆的代价要认**：`api/` 改一行仍然是全仓自检 + 一次发布。
今天的量级下这条不贵 —— 发布 task 的 `metricCoreHours` 是 0.23–0.27，
自检 task 是 0.04–0.06；而消掉那 86% 已经拿回了九成收益。

**关于「怕小程序审核出问题」的一句实话**：**换数据库不是审核的要求**。
小程序审核看的是「你的内容合规不合规、功能是不是真的」，不看你的数据库跑在哪。
真正会踩线的只有一件事：**`wx.request` 打到一个未备案的域名上** ——
而云调用这条路根本不经过那张名单（`wx-cloud-setup.md` § 6）。

所以「防小程序审核出问题」这个目的，**在换库之前就已经达到了**；
换库是「数据主权 / 少一层外部依赖」的考虑。

---

## 七、不改的那几条（免得被误读成「以后要换」）

- **不换后端语言 / 不拆服务**。现在是「一个容器跑全 `api/`」，够用。
- **不上自建数据库**。云托管的容器不做持久化，自建只会多一份运维。
- **不把语料搬进数据库**。语料是**静态资产**，它的正确形态是文件 + CDN，
  不是数据库里的行 —— 这一条在 `architecture.md` § 三已经算过账（几万条级查询的性能与成本都不划算）。
- **小程序前端不动**。它只认识 `PATHS` 与报文。
