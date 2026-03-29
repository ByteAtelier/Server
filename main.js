const { createServer } = require("./server/server");
const setupWebRTCTransport = require("./transport/webrtcTransport");
const { createImageLoopSource } = require("./source/imageLoopSource");
const { createEsp32UdpSource } = require("./source/esp32UdpSource");
const MediaProcessor = require("./media/index");
const ingestBus = require("./bus/ingestBus");
const videoBus = require("./bus/videoBus");
const APP_CONFIG = require("./config/app.config");

function main() {
  const width = APP_CONFIG.media.width;
  const height = APP_CONFIG.media.height;

  // 服务器部分（先创建，拿到 io）
  const { app, httpServer, io } = createServer({ corsOrigin: "*" });

  // 传输层部分（挂到 io 上）
  setupWebRTCTransport(io, videoBus, width, height, APP_CONFIG.webrtc);

  // 创建 media 处理器并启动
  const mediaProcessor = new MediaProcessor({ // 新增：实例化并启动 MediaProcessor
    fps: APP_CONFIG.media.fps,
    width,
    height,
    ingestBus,
    videoBus,
    pythonBridge: APP_CONFIG.media.pythonBridge,
  }); // 新增：实例化并启动 MediaProcessor
  mediaProcessor.start();

  // 帧源部分（最后启动）
  let source;
  if (APP_CONFIG.source.type === "imageLoop") {
    source = createImageLoopSource({
      ...APP_CONFIG.source.imageLoop,
      width,
      height,
    });
  } else if (APP_CONFIG.source.type === "esp32Udp") {
    source = createEsp32UdpSource({
      ...APP_CONFIG.source.esp32Udp,
      width,
      height,
    });
  } else {
    throw new Error(`[main] unsupported APP_CONFIG.source.type=${APP_CONFIG.source.type}`);
  }
  source.start(ingestBus);

  // 后续微信 OAuth 路由可以挂这里
  // app.use("/auth/weixin", ...)

  const port = Number(process.env.PORT || 3000);
  httpServer.listen(port, () => {
    console.log(`[Server] Server listening on ${port}`);
  });

  // 优雅退出，避免残留定时器/句柄
  process.on("SIGINT", () => {
    try { source.stop?.(); } catch {}
    try { httpServer.close(); } catch {}
    try { mediaProcessor.stop(); } catch {}
    process.exit(0);
  });
}

main();