# ByteAtelier Server 文档

本项目是一个基于 Node.js 的实时视频处理与分发服务，核心能力是：

1. 从图片目录或 ESP32 UDP 数据包持续接收帧；
2. 在服务端通过 `ffmpeg + Python(YOLO 分割)` 进行图像处理；
3. 将处理后的帧通过 WebRTC（I420）推送到浏览器；
4. 通过 Dashboard 实时输出链路状态、吞吐、延迟与模块健康信息。

---

## 1. 总体架构

数据主链路如下：

`source -> ingestBus -> MediaProcessor(decoder -> PythonBridge -> encoder) -> videoBus -> WebRTC 传输 -> 浏览器`

并行监控链路如下：

`ingestBus + videoBus + 各模块状态 -> dashboard/dashboard.js -> Socket.IO dashboard:* 事件 -> frontend/src/pages/Dashboard.tsx`

---

## 2. 代码组件说明（按职责划分）

### 2.1 入口与装配层

- `main.js`
  - 创建 HTTP + Socket.IO 服务；
  - 初始化 WebRTC 传输；
  - 初始化 Dashboard 状态聚合；
  - 初始化 `MediaProcessor`；
  - 根据配置选择数据源（`imageLoop` 或 `esp32Udp`）；
  - 处理 `SIGINT` 优雅退出（停止 source / server / mediaProcessor）。

- `config/app.config.js`
  - 全局运行参数中心：`server`、`media`、`webrtc`、`dashboard`、`source`；
  - Python 推理入口、模型路径、YOLO 参数在此配置；
  - **当前代码端口来自该文件（`server.port`）；若需环境变量端口，请自行扩展读取逻辑。**

### 2.2 总线层（事件缓冲）

- `bus/ingestBus.js`
  - 接收源帧（通常为 JPEG），保存 latest，并发出 `frame` 事件；
  - 维护 `totalFrames`、`lastSeenAt`、`lastFrameId` 等状态。

- `bus/videoBus.js`
  - 接收处理后视频帧（I420），维护稳定内存缓冲并复用对象；
  - 对外提供 `getLatest()` 供 WebRTC 发送器读取；
  - 维护吞吐统计状态。

### 2.3 数据源层

- `source/imageLoopSource.js`
  - 从目录读取图片（jpg/png/bmp/webp）并循环播放；
  - 使用 `sharp` 做 resize 与 JPEG 编码；
  - 生成统一帧结构后推入 `ingestBus`。

- `source/esp32UdpSource.js`
  - 监听 UDP，按自定义包头重组分片；
  - 支持丢包统计、重复包处理、旧帧淘汰、状态行输出；
  - 完整帧重组后推入 `ingestBus`。

### 2.4 媒体处理层

- `media/media.js`（`MediaProcessor`）
  - 创建解码器：JPEG -> BGR24；
  - 创建 PythonBridge：BGR24 -> YOLO 处理后 BGR24；
  - 创建编码器：BGR24 -> I420；
  - 最终将 I420 帧写入 `videoBus`。

- `media/codec/ffmpegCodec.js`
  - 以子进程方式运行 ffmpeg；
  - 支持两种模式：`jpegToBgr`、`bgrToI420`；
  - 带 stdout 队列上限与 stdin 背压控制（latest-frame-wins）。

- `media/PythonBridge/PythonBridge.js`
  - Node 与 Python 的二进制协议桥接（Header v2，12 字节）；
  - 严格 1 in-flight + mailbox 覆盖策略（上游快于 Python 时丢旧帧，不积压）；
  - 维护 `inFrames/overwritten/sentFrames/outFrames` 统计。

- `media/PythonBridge/index.py`
  - Python 主循环：读 header+payload、调用 YOLO、写回处理后帧；
  - 采用 fail-fast 策略，异常直接抛出。

- `media/PythonBridge/yoloSeg.py`
  - YOLO 分割推理引擎（预处理、推理、后处理、mask 与框绘制）。

### 2.5 传输与服务层

- `server/server.js`
  - 创建 Express + HTTP Server + Socket.IO；
  - 返回 `getStatus()` 用于 Dashboard 聚合服务状态。

- `transport/webrtcTransport.js`
  - 处理 `webrtc:offer / webrtc:answer / webrtc:ice` 信令；
  - 从 `videoBus.getLatest()` 取最新 I420 帧推送到 `RTCVideoSource`；
  - 支持单客户端模式（新会话可踢掉旧会话）。

- `transport/socketTransport.js`
  - 旧/备用 Socket 帧推送逻辑（`frame` 事件, volatile + latest-frame-wins）。

### 2.6 Dashboard（服务端）

- `dashboard/dashboard.js`
  - 汇总 ingest/video 速率、延迟、CPU、内存、事件循环延迟；
  - 维护模块 alive 状态；
  - 对外提供：
    - `dashboard:update`
    - `dashboard:config`
    - `dashboard:subscribe / dashboard:unsubscribe / dashboard:request`

### 2.7 Dashboard（前端）

- `frontend/src/pages/Dashboard.tsx`
  - 实时仪表盘页面；
  - 展示核心指标、趋势图、模块健康、链路保真、配置快照；
  - 支持订阅/暂停、导出快照、模块详情抽屉。

- `frontend/src/services/socket.ts`
  - Dashboard Socket.IO 客户端封装。

- `frontend/src/types/dashboard.ts`
  - Dashboard 事件 payload 类型定义。

- `frontend/src/utils/dashboardSemantic.ts`
  - 字段语义映射、格式化、配置与状态扁平化。

- `frontend/src/utils/dashboardView.tsx`
  - Dashboard 展示层工具（状态分组、统计卡片描述结构等）。

---

## 3. 关键协议与数据格式

### 3.1 ingest/video 总线帧结构（核心字段）

```js
{
  frameId: number,
  ts_src: number,   // 毫秒时间戳
  codec: "jpeg" | "...",
  width: number,
  height: number,
  data: Buffer
}
```

### 3.2 PythonBridge 协议（Node <-> Python）

- Header v2：12 bytes（小端）
  - `frameId`: u32（4 bytes）
  - `tsMs`: u64（8 bytes）
- Payload：
  - 固定 `width * height * 3`（BGR24）

### 3.3 ESP32 UDP 分片头（当前实现）

按 `source/esp32UdpSource.js` 解析：

- `ts_src`（u32, LE）
- `id`（u32, LE）
- `total`（u16, LE）
- `index`（u16, LE）
- `dataLen`（u16, LE）
- 对齐保留位（u16, LE）

默认头长：`headerBytes = 16`。

---

## 4. 运行前准备

### 4.1 Node 环境

- Node.js + npm
- 项目依赖（`sharp`、`wrtc` 等）可能需要本地编译工具链

### 4.2 系统依赖

- `ffmpeg`（需可在命令行直接执行）。

### 4.3 Python 推理环境

需要 Python 环境可运行以下依赖（按代码导入）：

- `numpy`
- `opencv-python`
- `torch`
- `ultralytics`

并确保：

- `config/app.config.js` 中的 `pythonBin` 路径可用；
- `scriptPath` 指向 `media/PythonBridge/index.py`；
- `model` 指向存在的权重文件（默认 `media/PythonBridge/weights/tooth_seg_n_640.pt`）。

---

## 5. 启动与开发

### 5.1 安装依赖

```bash
npm install
```

### 5.2 启动服务端

```bash
npm run start:server
```

默认端口由 `config/app.config.js` 的 `server.port` 决定（默认 3000）。

### 5.3 Dashboard 前端开发

```bash
npm run dev:frontend
```

### 5.4 前端构建与预览

```bash
npm run build:frontend
npm run preview:frontend
```

### 5.5 前端静态检查

```bash
npm run lint:frontend
```

---

## 6. 配置说明（`config/app.config.js`）

可重点关注以下配置块：

- `server.port`：服务监听端口
- `media`
  - `fps / width / height`
  - `pythonBridge.pythonBin`
  - `pythonBridge.scriptPath`
  - `pythonBridge.scriptArgs`（`model/imgsz/conf/iou/max-det/mask-alpha`）
- `source`
  - `type`: `"imageLoop"` 或 `"esp32Udp"`
  - `imageLoop`: `fps/imageDir/jpegQuality`
  - `esp32Udp`: `host/port/codec/headerBytes/udpMaxPayload/logEveryMs`
- `webrtc`
  - `fps`
  - `singleClient`
  - `turn.urls/username/credential`
- `dashboard`
  - `defaultIntervalMs`
  - `moduleAliveMs`

---

## 7. 测试与调试页面

`test/` 目录提供多个手工调试页面/脚本：

- `test/webrtc.html`：WebRTC 播放与 FPS 观察
- `test/dashboard.html`：Dashboard 原始事件输出
- `test/socket.html`：Socket 帧展示（Canvas）
- `test/turn.html`：TURN/ICE 采集测试
- `test/test_udp.js`：UDP 回显测试脚本

> 提示：这些页面内的 Socket 地址当前写死为远端地址（如 `http://39.105.171.44:8800`），本地联调时请改为你的本机服务地址（如 `http://localhost:3000` 或你的实际端口）。

---

## 8. 目录结构（精简）

```text
.
├─ main.js
├─ config/
│  └─ app.config.js
├─ bus/
│  ├─ ingestBus.js
│  └─ videoBus.js
├─ source/
│  ├─ imageLoopSource.js
│  └─ esp32UdpSource.js
├─ media/
│  ├─ media.js
│  ├─ codec/ffmpegCodec.js
│  └─ PythonBridge/
│     ├─ PythonBridge.js
│     ├─ index.py
│     ├─ yoloSeg.py
│     └─ utils/utils.py
├─ server/
│  └─ server.js
├─ transport/
│  ├─ webrtcTransport.js
│  └─ socketTransport.js
├─ dashboard/
│  └─ dashboard.js
├─ frontend/
│  ├─ config/config.ts
│  └─ src/...
└─ test/
```
