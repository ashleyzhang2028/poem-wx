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
# 这份的构建上下文是 poem 仓库根，瘦身靠上面的 `.dockerignore`（白名单入镜）。
FROM node:20-alpine

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
COPY --chown=node:node api ./api
COPY --chown=node:node deploy-api-serve/serve-api.js ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# 探活打 /healthz：只判「进程还在不在应答」，不拿 /api/* 的状态码当判据 ——
# 缺 SESSION_SECRET 时 /api/* 回 503，而进程是好的，那种情况报成「不健康」
# 会让平台一直重启一个本来在用的容器（poem 根那份 Dockerfile 里同一处坑）。
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz',r=>{r.resume();process.exit(r.statusCode<500?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "serve-api.js"]
