# 云托管运行时 —— 只跑 /api/* 的那一份（Issue #71）
#
# ⚠️ **这份文件不在这个仓库里构建。** 它躺在小程序仓库里，供 **CNB 流水线**
#    取来构建（见 `.cnb.yml` 的「构建云托管镜像」那一节）：
#    源码上下文是 **poem 仓库**（后端在那儿），Dockerfile 从这边取。
#
#    所以**别在云托管控制台里指这个仓库**：那儿的「容器目录」是按被部署的
#    仓库根取的，而这个仓库里没有 `api/`（小程序前端不是后端）。
#    控制台那几栏填什么见 README「云托管怎么填」。
#
# ⚠️ 换掉了 B 方案原先那份「往本仓库拷一份 api/」的做法：云托管不 clone 第二个
#    仓库，CNB 流水线可以 —— 于是那份副本连同「改完 poem 忘了同步」这个税一起没了。
#    代价是本仓库多一个镜像槽位（见 README），换来的是**后端只有一份代码**。
#
# ⚠️ **旁边那份 `.dockerignore`（`deploy-api-serve/` 里）不生效 —— 位置不对。**
#
#    忽略文件跟**构建上下文**走，跟 Dockerfile 放哪儿无关。这条流水线的上下文是
#    摊出来的 `/tmp/ctx`，所以唯一生效的位置是 **`/tmp/ctx/.dockerignore`** ——
#    流水线那一步现在就在往那儿拷（`cp deploy-api-serve/.dockerignore /tmp/ctx/…`）。
#
#    三个位置里只有一个是对的，另外两个都**最像对的**：
#
#      ✅ `/tmp/ctx/.dockerignore`        ← 有效。`docker build -f <ctx>/Dockerfile <ctx>`
#      ❌ `deploy-api-serve/.dockerignore` ← 原样躺在本仓库里，从来没进过上下文
#      ❌ `/tmp/ctx/api/.dockerignore`     ← **嵌套的不生效**，Docker 一个字节都不读
#
#    第二、三个的共同点是**不报错**：构建绿、部署绿，只是上下文从 0.3MB 变成 38MB ——
#    poem 的 `data/`（26MB 语料）与 `fonts/`（11MB）照传，而这个小程序一条都不读那几条
#    路由要的东西。所以工程里要在 `build & push` 之前当场断掉，别留给体积去说。
#
#    ⚠️ 顺带记一条 CNB 的文档坑：它写「忽略文件按 **repo 根**取」。本条流水线的 repo 根
#    是 poem，那么写下来就该用 poem 根那份 `poem/.dockerignore` —— 而那份**不是**白名单，
#    它只排掉 `.git` / `test` / `docs`，poem 的 `data/` 不在排除名单里，26MB 照进。
#    也就是说：照文档做也能「不报错地错」，只是错的方向换了。
#
#    所以别再把白名单挪走 —— 判据在自检 V43 里钉着（摆错位置会红）。
#
# 基础镜像走 `BASE_IMAGE`，**默认是 Docker Hub 的 node:20-alpine**。
# 多这一层不是为了好看：国内构建机上 Docker Hub 慢／不通时，命令行加
#     --build-arg BASE_IMAGE=<你的镜像源>/library/node:20-alpine
# 就能换源，不用改这个文件。
#
# 另一条同样重要：**这一行必须写「一个公开的、谁都能拉的基础镜像」**。
# 写成一个需要凭据才能拉的私有地址，构建机没那份凭据时一 pull 就拒 ——
# 而报错会指向 Dockerfile 第 1 行，看着像 Dockerfile 写错了。
ARG BASE_IMAGE=node:20-alpine
FROM ${BASE_IMAGE}

WORKDIR /app
RUN chown node:node /app
USER node

# 三条 ARG：**声明是有用的** —— ARG 值参与缓存键，声明之后
# `--build-arg API_REV=<commit>` 会真的让 COPY 那一层失效、重建，
# 并把「这一版 api/ 是哪来的」钉在构建参数里。
ARG API_REV=unknown
ARG API_SYNCED_AT=unknown
ARG API_SOURCE=unknown
LABEL org.opencontainers.image.revision=$API_REV \
      org.opencontainers.image.created=$API_SYNCED_AT \
      org.opencontainers.image.source=$API_SOURCE

# 只拷运行时真正要用的：api/ 与只挂 /api/* 的服务壳。
# 语料（data/ 26MB）、字体（fonts/ 11MB）、网页版前端（js/ 1MB）一律不进 ——
# 小程序一条都不打那几条要它们的路由。上面 .dockerignore 已经把构建上下文
# 挡到这几MB，这里再逐条点明。
#
# ⚠️ COPY 的**源**是「构建上下文根」，不是本仓库的目录树 —— 这一点这里踩过一次：
#    上下文是流水线摊出来的（poem 的 api/ + 本仓库那两样，**平铺在同一层**），
#    所以服务壳在这一层叫 `./serve-api.js`，而**不是** `deploy-api-serve/serve-api.js`
#    —— `deploy-api-serve/` 只存在于本仓库里，构建上下文里根本没有这个目录。
#    写成带前缀那版，docker 报的是
#      failed to calculate checksum ... "/deploy-api-serve/serve-api.js": not found
#    看着像「文件没提交 / 路径写错」，其实是**源路径按错的那棵树上找**。
#    （同一份文件在本仓库里的名字仍是 deploy-api-serve/serve-api.js，
#      流水线 stage context 那一步把它拷进来并更名 —— 两边名字不同是故意的。）
COPY --chown=node:node api ./api
COPY --chown=node:node serve-api.js ./

# 存储层那份 MySQL 实现（Issue #111）。它**不在 poem 里** —— 后端代码在 poem，
# 而「用哪台数据库」是这份部署自己的选择。放本仓库、由流水线摆进上下文，
# 与 serve-api.js 同一层、同一个名字（COPY 的源按上下文根取）。
COPY --chown=node:node store-mysql.js ./

# mysql2 是**唯一**多出来的运行时依赖（上面那份实现只用它的连接池，不引 ORM）。
# 装在 /app 里，让 serve-api.js 的 require("./store-mysql.js") → require("mysql2/promise")
# 找得到。npm 缓存与本层的内容一起沉在镜像里，不必每次重装。
#
# ⚠️ `--omit=dev` 之外**不要**做成 `npm ci`：上下文是摊出来的，没有 package.json。
#    这里就装这一个包，装完把清单删掉（镜像里少两个文件，也少一处会漂的东西）。
RUN npm install --no-audit --no-fund --omit=dev mysql2@3 --no-package-lock \
 && rm -rf /app/package.json /app/package-lock.json /root/.npm

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# 探活打 /healthz：只判「进程还在不在应答」，不拿 /api/* 的状态码当判据 ——
# 缺 SESSION_SECRET 时 /api/* 回 503，而进程是好的，那种情况报成「不健康」
# 会让平台一直重启一个本来在用的容器（poem 根那份 Dockerfile 里同一处坑）。
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz',r=>{r.resume();process.exit(r.statusCode<500?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "serve-api.js"]
