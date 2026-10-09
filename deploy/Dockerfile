# 云托管运行时 —— 只跑 /api/* 的那一份（Issue #71 的 B 方案）
#
# 云托管控制台这么填（实测过的填法，见 README）：
#   代码仓库   https://cnb.cool/npu-gpu-cpu/poem-wechat-mini-program.git
#   容器目录   deploy
#   Dockerfile Dockerfile        ← 就是本文件；不填默认也是它
#
# ⚠️ 为什么 Dockerfile 与上下文都在 deploy/，而不是「在 poem 里加 Dockerfile.api」：
#    云托管按**你的仓库根**取 `容器目录`，取不到就退回仓库根。CNB 那份代码在
#    另一个仓库（poem）里，云托管根本不会去那儿找 —— 所以部署件得跟仓库同库。
#    代价是 api/ 得有**一份副本**，靠 `deploy/sync-api.sh` 同步、自检盯着。
#
# ⚠️ 瘦下来省的是**部署与镜像**，不是「少跑一个后端」：容器里跑的是同一份
#    poem 的 api/，账号、进度、会话、code2Session 一处不漏。
#
# ⚠️ 这份的构建上下文只有 api/（436KB）：本目录的 .dockerignore 是**白名单**，
#    不是常规的排除名单 —— 多留一条就是多上传一坨运行时读不到的东西。
FROM node:20-alpine

WORKDIR /app
RUN chown node:node /app
USER node

# 三条 ARG：**声明是有用的** —— Docker 里 ARG 值参与缓存键，声明之后
# `--build-arg API_REV=<commit>` 会真的让 COPY 那一层失效、重建。
# 云托管每次部署都是新上下文（缓存基本不命中），这三条的用处是：
# 本机构建时能强制重建 + 把「这一版 api/ 是哪来的」钉在构建参数里。
ARG API_REV=unknown
ARG API_SYNCED_AT=unknown
ARG API_SOURCE=unknown
LABEL org.opencontainers.image.revision=$API_REV \
      org.opencontainers.image.created=$API_SYNCED_AT \
      org.opencontainers.image.source=$API_SOURCE

# 运行时依赖只有 dotenv 一个（api/ 全用 Node 内置模块），所以这里
# 不拷 package.json、不跑 npm ci —— 少一层、少一次网络。
# 以后 api/ 真加了外部依赖，在这一行上面补 COPY + RUN npm ci。
# ⚠️ 注意这会静默出问题：poem 的 package.json 里加依赖时，这边不会跟着红，
#    得靠 deploy/sync-api.sh 的清单对账（它会报 package.json 里有什么）。
COPY --chown=node:node api ./api
COPY --chown=node:node serve-api.js ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# 探活打 /healthz：只判「进程还在不在应答」，不拿 /api/* 的状态码当判据 ——
# 缺 SESSION_SECRET 时 /api/* 回 503，而进程是好的，那种情况报成「不健康」
# 会让平台一直重启一个本来在用的容器（poem 根那份 Dockerfile 里同一处坑）。
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz',r=>{r.resume();process.exit(r.statusCode<500?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "serve-api.js"]
