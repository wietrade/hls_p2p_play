# 自建 WebTorrent Tracker（wt-tracker）

基于 [Novage/wt-tracker](https://github.com/Novage/wt-tracker)（p2p-media-loader 官方作者出品的高性能 WebTorrent tracker），
为本项目的 HLS P2P 播放器提供**自建 WebSocket 信令服务**，替代免费公共 tracker。

- 兼容 p2p-media-loader core 4.x（peer protocol v2）信令协议
- 基于 uWebSockets.js，支持 `ws://` / `wss://`、IPv4/IPv6，自带 `/stats.json` 统计
- 本地测试默认端口 **8000**

## 目录结构

```text
tracker/
├── wt-tracker/        # 官方 wt-tracker 仓库（git 子模块式克隆）
├── config.json        # 本地运行配置（端口 8000）
├── smoke-test.js      # 信令链路冒烟测试（announce/offer/answer）
└── README.md
```

## 本地运行

前置：Node.js 22.18.0+（本项目开发机 v24 ✅）

```powershell
cd tracker\wt-tracker
npm install          # 首次（含 uWebSockets.js 原生模块）
npm start ..\config.json
```

启动成功后应看到：

```
listening 0.0.0.0:8000
```

验证：

```powershell
# 健康/统计
Invoke-RestMethod http://127.0.0.1:8000/stats.json

# 信令链路冒烟测试（另开一个终端）
cd tracker
node smoke-test.js
```

## 接入 play.html

本地测试时给播放器追加 `?tracker=` 即可（**追加**，不清空默认，防止连不上）：

```
play.html?url=你的m3u8地址&tracker=ws://127.0.0.1:8000/tracker
```

> 注意：`ws://` 只能在 http 页面/本地环境使用；线上 HTTPS 页面必须用 `wss://`（见下方部署）。

## 部署到服务器（wss://）

已在 43 服务器完成部署（2026-08-21）：

- 播放器静态页：`https://bot3.1230sb.com/hls_p2p_play/`（→ `/www/wwwroot/hls_p2p_play/`）
- tracker：`wss://bot3.1230sb.com/tracker`（nginx → 127.0.0.1:8083，wt-tracker 容器）

### 服务器部署方式（Docker）

服务器系统 Node 是 v18（wt-tracker 需要 22.18+），所以用 **Docker 容器隔离**，不动系统 Node：

```bash
# 服务器上
cd /www/wwwroot/hls_p2p_play/tracker
docker compose up -d --build
```

- 配置：`config.server.json`（监听 127.0.0.1:8083，仅本机可连）
- 容器用 `--network host`，nginx 反代 `/tracker` → 127.0.0.1:8083
- 服务自启：compose 里 `restart: unless-stopped`

### ⚠️ 重要坑：基础镜像 glibc 版本

uWebSockets.js 原生二进制要求 **glibc >= 2.38**。默认 `node:24-slim`（Debian bookworm，glibc 2.36）会启动报错：

```
/lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.38' not found
```

必须用新基础镜像，例如 `node:24-trixie-slim`（Debian 13，glibc 2.41，已验证可用）。
`node:24-noble-slim` 标签不存在。

### 上线步骤回顾

1. `scp` 静态文件 → `/www/wwwroot/hls_p2p_play/`（含 vendor/）
2. `scp` tracker 源码包/config.server.json/Dockerfile/docker-compose.yml → `/www/wwwroot/hls_p2p_play/tracker/`
3. 解压 + `docker compose up -d --build`
4. nginx：bot3.1230sb.com.conf 里 `location /tracker` 的 `proxy_pass` 从 8082 改为 8083，`nginx -t && nginx -s reload`
5. 静态目录：新建 `/www/server/panel/vhost/nginx/extension/bot3.1230sb.com/hls_p2p_play.conf`
   （`location ^~ /hls_p2p_play/ { alias /www/wwwroot/hls_p2p_play/; }`，宝塔 extension include 机制）
6. 验证：本地 `node smoke-test.js` 连 `wss://bot3.1230sb.com/tracker`
7. 停旧 tracker：`kill <旧进程pid>`（nginx 切换后可释放 8082）

> 注意：改完 nginx reload 后等 1-2 秒再 curl，立即请求可能命中旧 worker 返回 404。

## 安全建议

- 公网暴露建议在 `websocketsAccess` 里配置 `allowOrigins`（只允许你的站点 Origin），或
  用防火墙/反代做访问控制，避免被人当公共 tracker 滥用
- 播放器默认只用自建 tracker；`?tracker=` 追加策略保留（可临时加其他 tracker 做对照/测试）
