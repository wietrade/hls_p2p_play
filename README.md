# hls_p2p_play

基于 **ArtPlayer + p2p-media-loader**（WebRTC 数据通道）的 HLS 流媒体 P2P 播放器。
纯静态 HTML，100% 全宽，可 iframe 嵌入其他网站，iOS 兼容。

## 文件结构

```text
.
├── play.html                # 播放器页面（核心，可 iframe 嵌入）
├── test.html                # 整合 Demo（含页面内日志面板，便于手机端排查）
├── index.html               # 使用说明页（含在线试玩）
├── tracker/                 # 自建 wt-tracker 部署（配置/Dockerfile/冒烟测试，见 README）
└── vendor/
    ├── hlsjs.iife.min.js    # p2p-media-loader-hlsjs UMD 打包（4.0.0）
    └── indexeddb-storage.js # IndexedDB 持久分片缓存实现
```

## 使用方法

### iframe 嵌入（其他网站调用）

```html
<iframe src="https://你的域名/play.html?url=你的m3u8流地址"
        style="width:100%; aspect-ratio:16/9; border:0;"
        allowfullscreen></iframe>
```

### URL 参数

| 参数 | 必填 | 说明 | 默认 |
| :--- | :--- | :--- | :--- |
| `url` | ✅ | 视频流地址（.m3u8，http/https） | 内置测试流 |
| `tracker` | 可选 | Tracker 地址（逗号分隔，ws/wss），**追加**到默认后 | `wss://bot3.1230sb.com/tracker`（自建 wt-tracker，唯一） |
| `stun` | 可选 | STUN 服务器（逗号分隔），**追加**到默认后 | 4 个公共 STUN |
| `noturn` | 可选 | 传 `1` 关闭 TURN 中继 | 开启 |
| `stats` | 可选 | 传 `0` 隐藏统计悬浮层 | 显示 |
| `lanip` | 可选 | 局域网 IP（IPv4，mDNS 修复） | 无 |
| `swarmId` | 可选 | 固定分组 ID（仅兼容旧用法） | 按流地址派生 |
| `cache` | 可选 | 传 `0` 关闭 IndexedDB 持久分片缓存（改回内存缓存） | 开启（持久） |
| `cacheLimit` | 可选 | 持久缓存容量上限（MiB），超出后最老分片优先逐出 | `1024` |
| `autoplay` | 可选 | 传 `0` 不自动播放 | 自动播放 |
| `muted` | 可选 | 传 `0` 不静音（iOS 自动播放需静音） | 静音 |
| `controls` | 可选 | 传 `0` 隐藏控制条 | 显示 |
| `debug` | 可选 | 传 `1` 输出 ICE 候选统计（host/srflx/relay）与控制台诊断，排查连不上 peer | 关闭 |
| `seglog` | 可选 | 传 `1` 开启分片完成日志（test.html，默认屏蔽防刷屏） | 关闭 |

> IndexedDB 持久缓存：分片落本地浏览器库，页面刷新 / 换源后仍可命中，点播场景大幅提升缓存命中率；
> 存储实现见 `vendor/indexeddb-storage.js`（官方 customSegmentStorageFactory 示例的移植 + 容量逐出）。
> 换源（`p2p:load`）不再整页刷新，改为原地重建播放器，缓存保留。

> tracker / stun 采用「默认 + 追加」策略：即使用户传入错误地址，默认值仍生效，保证可连接。

## 特性

- ✅ 纯静态，无需服务器（任何静态托管 / CDN / 本地均可）
- ✅ 100% 全宽，专为 iframe 嵌入设计
- ✅ iOS 17.1+ 走 ManagedMediaSource 支持 P2P；老 iOS 自动回退原生 HLS
- ✅ 移动端自适应
- ✅ 统计悬浮层：HTTP/P2P 下载、上传、P2P 占比、Peer 数
- ✅ 自建 wt-tracker 信令（`wss://bot3.1230sb.com/tracker`），不依赖公共 tracker

## 浏览器兼容性（自动检测 + 优雅降级）

播放器会检测浏览器的 **MSE** 与 **WebRTC** 能力，自动选择最佳播放方式：

| 浏览器 | MSE | WebRTC | 播放方式 | P2P |
| :--- | :---: | :---: | :--- | :---: |
| Chrome / Edge（PC、手机） | ✅ | ✅ | hls.js + P2P | ✅ |
| 小米自带浏览器 | ✅ | ❌ | 纯 hls.js（HTTP） | ❌ |
| UC 迷你版（无 MSE） | ❌ | — | 原生 HLS（video.src） | ❌ |
| iOS 17.1+ | ✅ | ✅ | ManagedMediaSource + P2P | ✅ |
| 老 iOS | ❌ | — | 原生 HLS | ❌ |

- **无 MSE** → hls.js 无法运行，回退原生 HLS（`video.src`）
- **无 WebRTC** → 不启动 P2P 引擎，回退纯 hls.js HTTP 播放（避免 tracker 警告噪音）
- 降级时界面会提示「当前浏览器不支持 P2P...」

## 近期更新（2026-08-21）

- **默认 tracker 只用自建 wt-tracker**：移除不稳定的公共 tracker（webtorrent.dev / novage / openwebtorrent，实测全部连接失败）
- **浏览器能力检测与降级**：无 MSE（UC 迷你版）/ 无 WebRTC（小米自带浏览器）自动降级，不再产生 `Tn is not a constructor` 之类的 tracker 警告
- **playM3u8 幂等保护**：修复 ArtPlayer 周期性重复触发 customType 导致 P2P 引擎反复销毁重建、peer 抖动的 bug
- **诊断能力**：`?debug=1` ICE 候选统计、`?seglog=1` 分片日志、增强的 tracker/peer 错误日志、WebRTC 支持检测
- **自建 tracker 部署**：服务器 wt-tracker（Docker + nginx wss 反代），详见 `tracker/README.md`
