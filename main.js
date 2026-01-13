const { createServer } = require("./server/server");
const setupWebRTCTransport = require("./transport/webrtcTransport");
// const { createImageLoopSource } = require("./source/imageLoopSource");
const { createEsp32UdpSource } = require("./source/esp32UdpSource");
const MediaProcessor = require("./media/index");
const ingestBus = require("./bus/ingestBus");
const videoBus = require("./bus/videoBus");

const Width = 640;
const Height = 480;

function main() {
  // 服务器部分（先创建，拿到 io）
  const { app, httpServer, io } = createServer({ corsOrigin: "*" });

  // 传输层部分（挂到 io 上）
  setupWebRTCTransport(io, videoBus, Width, Height, {
    turn: {
      urls: [
        "turn:39.105.171.44:3478?transport=udp",
        "turn:39.105.171.44:3478?transport=tcp",
      ],
      username: "BS-coturn",
      credential: "DnDzRttdGVB25MntSpAEUDxrxvkwBjP8",
    },
    fps: 30,
    singleClient: true,
  });

  // 创建 media 处理器并启动
  const mediaProcessor = new MediaProcessor({ // 新增：实例化并启动 MediaProcessor
    fps: 30,
    width: Width,
    height: Height,
    ingestBus,
    videoBus
  }); // 新增：实例化并启动 MediaProcessor
  mediaProcessor.start();

  // 帧源部分（最后启动）
  // const source = createImageLoopSource({
  //   fps: 30,
  //   width: Width,
  //   height: Height,
  //   imageDir: "D:\\Code\\BrightSmile\\AI\\datas\\Benchmarking Dataset\\train\\images",
  //   jpegQuality: 80,
  // });
  // source.start(ingestBus);

  const source = createEsp32UdpSource({
    host: "0.0.0.0",
    port: 5000,
    width: Width,
    height: Height,
    codec: "jpeg",
    headerBytes: 10,
    udpMaxPayload: 1024,
    frameTimeoutMs: 1500,
    maxInFlightFrames: 16,
    maxFrameBytes: 5 * 1024 * 1024, // 5 MB
  });
  source.start(ingestBus);

  // 后续微信 OAuth 路由可以挂这里
  // app.use("/auth/weixin", ...)

  const port = Number(process.env.PORT || 3000);
  httpServer.listen(port, () => {
    console.log(`[Server] Server listening on ${port}`);
  });

  // 可选但建议：优雅退出，避免残留定时器/句柄
  process.on("SIGINT", () => {
    try { source.stop?.(); } catch {}
    try { httpServer.close(); } catch {}
    try { mediaProcessor.stop(); } catch {}
    process.exit(0);
  });
}

main();