# wt-tracker 服务器部署镜像
# 用 Node 24（服务器系统 Node 是 v18，不支持 wt-tracker 的 TS 直跑，用容器隔离最安全）
# 注意：uWebSockets.js 原生二进制要求 glibc >= 2.38，
# 必须用 trixie(Debian 13, glibc 2.41) / noble(Ubuntu 24.04) 等新基础镜像；
# 默认 node:24-slim 是 bookworm(glibc 2.36) 会启动失败。
FROM node:24-trixie-slim

WORKDIR /app

# 只拷贝运行所需（源码 + 依赖清单），不拷 node_modules/.git
COPY package.json package-lock.json ./
COPY src ./src
COPY bin ./bin

RUN npm install --omit=dev

# 配置文件由 -v 挂载到 /config/config.json（只读）
CMD ["node", "src/run-tracker.ts", "/config/config.json"]
