# hls_p2p_play

基于 **ArtPlayer + p2p-media-loader**（WebRTC 数据通道）的 HLS 流媒体 P2P 播放器。
纯静态 HTML，100% 全宽，可 iframe 嵌入其他网站，iOS 兼容。

## 文件结构

```text
.
├── play.html                # 播放器页面（核心）
├── index.html               # 使用说明页（含在线试玩）
└── vendor/
    └── hlsjs.iife.min.js    # p2p-media-loader-hlsjs UMD 打包（4.0.0）
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
