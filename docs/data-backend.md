# 数据在哪、后端怎么解耦、CI 为什么会被上游绊住

> 这份文件回答 Issue #111 的三个问题：
>
> 1. **现在小程序的数据库服务是什么？**
> 2. **后端存储怎么解耦、换库要动什么？**
> 3. **小程序的数据是怎么管的、放在哪里？上游 poem 改数据集导致这边 CI 出故障，有没有办法？**
>
> 先给结论，再给账。凡是要动代码的地方，都标了「已做 / 待做 / 不做」。

---

## 一、先分清五样东西，它们的归属完全不同

「后端依赖」这四个字，在这份工程里对应的其实是**五件互不相干的事**。
把它们混成一件，就会得出「换掉数据库要重写一遍」这个错结论。

| # | 是什么 | 现在在哪 | 属于谁 | 用户能不能感觉到 |
|---|---|---|---|---|
| ① | **运行时代码**（登录 / 同步 / 管理那几条路由） | poem 的 `api/`，跑在我们自己的容器里（微信云托管，走**云调用**） | **这个项目** | 能（登录、换手机还在不在） |
| ② | **数据存储**（账号 / 会话 / 进度 / 设置） | 代码里是**可替换**的存储层，接口是一组 `getX / putX / listX`；线上实现 = 腾讯云 MySQL | 运营选择 | 能（数据在不在） |
| ③ | **静态资产**（5604 条课外正文分片 + 倒排索引） | 现在是**构建产物，跟包走**（`miniprogram/data/`） | **这个项目** | 基本感觉不到（除非你打算上 CDN） |
| ④ | **构建输入**（语料从哪来） | `scripts/build-data.js` 在 CI 里 `git clone` **poem 的锁定版本** | **这个项目** | 不能，但能让 CI 红 |
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
- 用户对「上游改数据集 → 这边 CI 红」的顾虑是**对的，而且已经真的红过**。
  这一条的根治办法只有一个：**把「上游改了什么」和「推我们的 main」拆开**（见 § 四）。

---

## 二、存储层到底在哪：一个接口，两个实现

`poem/api/_lib/store.js` 里那组 `getX / putX / listX` 是**契约**：
`api` 对象上的方法名就是全部约定，路由层只认这些名字，**不认底下是谁**。

```
                     ┌─ memoryStore()   ← 本地自检 / e2e（进程内存）
getStore(cfg) ───────┤
                     └─ mysqlStore()    ← 线上（腾讯云 MySQL）
```

- **`memoryStore()`** 是 poem 里现成的内存档，本地自检与 `e2e-wx-sync.js` 跑的
  就是它 —— 换句话说，「换库」这件事**有两份实现同时在跑**，插槽是活的。
- **`mysqlStore()`** 是本仓库新加的那份：代码在 **`deploy/store-mysql.js`**，
  建表语句在 **`deploy/sql/mysql-schema.sql`**。

### 它在哪儿接上去：`serve-api.js`，不是 poem

这一点值得单独说清，因为它决定了「改 poem 吗」这个问题的答案。

`poem` 同时伺服**网页版**（跑在 Vercel 上、用它自己那台库）与小程序这份镜像。
两边共用同一套 `api/`，但**数据库选择本来就该分开** —— 所以：

```
serve-api.js（这份镜像的入口）
  ├─ 认 MYSQL_HOST  → 建连接池 → 把 poem 的 getStore() 换成 mysqlStore（并 _reset 单例）
  └─ 不认            → 什么都不做，poem 原样（内存档）
  ↓
require("./api/handler.js")   ← ⚠️ 必须在上面那步**之后**：handler 在 require 时就取单例
```

于是 **`poem` 一行都不用改**，它压根不认识 MySQL。接线、建池、`mysql2` 依赖
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

### 3.5 建表与操作入口

```
cloud.weixin.qq.com → 云托管 → 服务所属环境 → MySQL
  → 数据管理 / SQL 窗口 → 粘贴 deploy/sql/mysql-schema.sql 整段执行
```

建完表之后，第一个管理员直接在库里改：

```sql
UPDATE accounts SET role = 'owner' WHERE uid = '<你的 uid>';
```

---

## 四、上游数据集导致 CI 红：病情与根因

### 4.1 病症长什么样

`.cnb.yml` 里，**每一个任务的第一步**都是：

```bash
bash scripts/clone-poem.sh /tmp/poem      # 取 poem 的锁定版本
POEM_WEB_DIR=/tmp/poem node scripts/build-data.js
node scripts/check.js
```

`clone-poem.sh` 检出的是 **`poem.lock.json` 里钉住的那一版**。
于是 poem 那边补录几十条、改一版译文、动一个朝代归类，
这边的自检（`check.js` 里的 `K.counts` / `seqMax` / `KNOWN_HOLES` 那张表）
就会当场红 —— **推 ours 的 main 的时候红，改 ours 的代码的人是受害者，而错在上游。**

这不是猜测，`check.js` 里那张表本身就把这几轮记着：

```
counts: { poems: 251, classic: 287, ... }   ← 「这段话会过期，过期就红」
seqMax:  { gushi: 126, songci: 331, ... }    ← 「补录接号时最容易断的那根线」
```

那张表的注释里写着「补录之后回来对一次」，就是承认了：**上游一动，我们必红一次**。

### 4.2 根因：把「上游的什么」和「我们推什么」绑在同一次运行里

现在的模型是：

```
CI 运行时刻 → 决定用哪一版语料 → 决定自检对不对
```

于是「CI 绿」同时挂上了三件毫不相干的事：我们的代码对不对、
上游今天改没改、这两件事碰在一起会怎样。任何一件变，整条红。

### 4.3 治法：把「上游更新」变成一次**显式的、会开 PR 的**动作

原则一句话：**推我们的 `main`，用的必须是这个仓库里记着的那个上游版本；
上游动了，要让「有人去跟」这件事自己冒出来，而不是拦别人的发布。**

#### 第一步：钉住上游版本（已做）

- 新增 `poem.lock.json`，记 poem 的 commit/短 sha 与这一版对上的篇数。
- `scripts/clone-poem.sh` 支持**检出锁定的那个 commit**（`POEM_REF`）。
- CI 走锁定版，`build-data.js` 打出来的篇数就与 `K` 表逐条对得上。

#### 第二步：上游更新，不出红，出 PR（已做）

- 新增 `.cnb.yml` 的定时任务：**每 6 小时**取一次 poem 的 `main` 头。
  - 头 **== 锁里那个** → 什么都不做（绿）。
  - 头 **!=** 锁里那个 → 自动跑一次 `build-data.js` + `check.js`：
    - 自检**过** → 自动开一个 PR：**只改 `poem.lock.json`**（把新 sha 写进去），
      描述里带上这次的语料读数。有人点合并，锁就前进。
    - 自检**红** → 开一个 Issue（或 PR 里标红），把 `check.js` 的那几句话原样贴进去 ——
      「要跟着改的是 `K` 表，不是去修上游」。人来看，人来改，人合并。

这样**两件事分开了**：

| 事件 | 谁受影响 | 结果 |
|---|---|---|
| 上游 poem 改了语料 | **没人**（我们推 main 仍旧用锁定版） | 定时任务自己开出 PR 或 Issue |
| 我们推 main | 只有我们的代码 | 自检判的只有这一件事 |

#### 第三步（已做）：锁定 + 自动跟进

现在 `.cnb.yml` 里多了一条 **`poem-watch` 定时流水线**，每 6 小时跑一次：

```yaml
main:
  "crontab: 0 */6 * * *":      # 与 push: 并列在同一个 main: 之下（见下）
    - name: 跟上游语料（poem-watch）
      script:
        - bash scripts/poem-watch.sh
# 脚本里：
# 取 upstream/main 的头
# 与 poem.lock.json 里比：
#   same    上游没动      → 什么都不做
#   ahead   上游动了      → 用 POEM_REF=<新 sha> 跑一次 build-data + check
#              过（绿）→ 用 CNB 的 cnb 命令行开 PR（只动 poem.lock.json，附语料读数）
#              不过（红）→ 在 Issue #111 上留一条评论，把 check.js 的几句话原样贴过去
#   unknown 拿不到上游的头 → 出声（「没跟成」不是「跟过了」）
```

读锁 / 写锁在 `scripts/poem-lock.sh`，跟上游在 `scripts/poem-watch.sh`，
两个脚本都能在本机干跑（`WATCH_DRY=1` 只判断、不开 PR、不写文件）：

```bash
bash scripts/poem-lock.sh                              # 看锁里钉的是哪一版
bash scripts/poem-lock.sh --ref                        # 只打印那个 sha（给脚本拼命令用）
bash scripts/poem-lock.sh --verdict <sha>              # 回 same / ahead / behind / unknown
bash scripts/poem-lock.sh --write <sha> [日期]          # 把锁前进到某一版
WATCH_DRY=1 bash scripts/poem-watch.sh                 # 手动跟一次上游（只判断，不写文件、不开 PR）
bash scripts/poem-watch.sh                             # 真跟一次（CI 里由定时任务跑）
```

---

## 五、现在数据到底怎么管的：一张图

```
① 内容（诗、译文、索引、注音表）
   poem 仓库（上游语料）
     └─ CI 里 build-data.js 编译 → miniprogram/data/**（打包进小程序包）
          · data/books/<集子>.json   各集子索引（不含正文）
          · data/course.json         课内 251 首正文 + 译文（进主包）
          · data/pinyin-table.json   读音表（离线注音）
          · data/texts/**            其余 5604 条正文 + 倒排索引
                                     ⚠️ project.config.json 里被 ignore，不进包

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
| 1 | 钉住上游 + 定时跟踪（§ 四） | **解掉 CI 被上游绊住这条** | ✅ 已做 |
| 2 | 这份文档 | 把「数据在哪」一次说清，省下每一次重问 | ✅ 已做 |
| 3 | 换到腾讯云 MySQL（§ 三） | 数据主权：不依赖境外托管商 | ✅ 已做（`deploy/store-mysql.js` + 建表语句） |
| 4 | 中文 CDN（把 `data/texts/**` 挪出包） | 现在 26MB 分片虽被 ignore，但没进 CDN 就等于「没缓存的条目要联网」这条还没真正兑现。**要走这一步，必须办备案** | ⏸️ 未办备案，见 `todo.md` 第 13 条 |

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
