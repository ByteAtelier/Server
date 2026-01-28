# ByteAtelier Server

基于 Node.js 的服务器，用于采集图像帧并通过 Socket.IO + WebRTC 推流给客户端。
项目包含两种帧源（图片轮播与 ESP32 UDP）以及媒体处理流程。

## 环境要求

- Node.js 与 npm

## 快速开始

```bash
npm install
node main.js
```

默认监听 `http://localhost:3000`，可通过 `PORT` 指定端口：

```bash
PORT=4000 node main.js
```

## 配置说明

运行时配置集中在 `main.js`：

- **帧源**
  - `createImageLoopSource`：从 `imageDir` 轮播图片并缩放到指定尺寸，按需修改
    `imageDir`、`fps`、`width`、`height`。
  - `createEsp32UdpSource`：启用 ESP32 UDP 帧源时取消注释，并配置 `host`、`port`
    以及帧元数据。
- **WebRTC 传输**
  - 在 `setupWebRTCTransport` 中更新 TURN 服务器配置。

## 目录结构

- `main.js` – 程序入口
- `bus/` – 采集/视频事件通道
- `server/` – Express + Socket.IO 服务
- `source/` – 帧源（图片轮播、ESP32 UDP）
- `transport/` – WebRTC 传输层
- `media/` – 媒体处理流程
- `test/` – 手动测试页面

## 手动测试

启动服务后，可在浏览器中打开 `test/` 下的 HTML 文件（例如 `test/webrtc.html`）
以验证视频流输出。
