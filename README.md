# ByteAtelier 服务端

这是一个基于 Node.js 的视频流服务端，用于采集图像帧，并通过 Socket.IO 与 WebRTC
向客户端分发视频流。当前支持图片轮播与 ESP32 UDP 两种帧源。

## 环境要求

- Node.js 与 npm
- 安装 `sharp`、`wrtc` 等依赖时所需的本地编译工具链

## 快速开始

```bash
npm install
npm run start:server
```

默认监听地址为 `http://localhost:3000`，可通过环境变量指定端口：

```bash
PORT=4000 npm run start:server
```

## 常用脚本

- `npm run start:server`：启动服务端
- `npm run dev:frontend`：启动前端开发环境
- `npm run build:frontend`：构建前端
- `npm run preview:frontend`：本地预览前端构建结果
- `npm run lint:frontend`：执行前端静态检查（Biome + TypeScript）

## 配置说明

主要运行时配置集中在 `main.js`：

- **帧源配置**
  - `createImageLoopSource`：从 `imageDir` 轮播图片并缩放到指定尺寸，可调整
    `imageDir`、`fps`、`width`、`height`。
  - `createEsp32UdpSource`：启用 ESP32 UDP 帧源时，按需配置 `host`、`port` 及帧元数据。
- **传输配置**
  - 在 `setupWebRTCTransport` 中配置 STUN/TURN 相关参数。

## 目录结构

- `main.js`：程序入口
- `bus/`：采集与视频事件通道
- `server/`：Express 与 Socket.IO 服务
- `source/`：帧源实现（图片轮播、ESP32 UDP）
- `transport/`：WebRTC 传输层
- `media/`：媒体处理流程
- `frontend/`：前端页面与可视化界面
- `test/`：手动测试页面

## 手动测试

启动服务后，可在浏览器中打开 `test/` 目录下的 HTML 文件（例如 `test/webrtc.html`）
验证视频流输出是否正常。
