const { createServer } = require("./server/server");
const setupWebRTCTransport = require("./transport/webrtcTransport");
const { createImageLoopSource } = require("./source/imageLoopSource");
const { createEsp32UdpSource } = require("./source/esp32UdpSource");
const MediaProcessor = require("./media/media");
const ingestBus = require("./bus/ingestBus");
const videoBus = require("./bus/videoBus");
const APP_CONFIG = require("./config/app.config");
const setupDashboard = require("./dashboard/dashboard");

function main() {
  const width = APP_CONFIG.media.width;
  const height = APP_CONFIG.media.height;
  let mediaProcessor = null;
  let source = null;
  let dashboardModule = null;

  // 服务器部分（先创建，拿到 io）
  const { httpServer, io, getStatus: getServerStatus } = createServer({ corsOrigin: "*" });

  // 传输层部分（挂到 io 上）
  const webrtcTransport = setupWebRTCTransport(io, videoBus, width, height, APP_CONFIG.webrtc);

  // Dashboard：由前端主动请求订阅后，按间隔推送服务端状态
  dashboardModule = setupDashboard(io, {
    ingestBus,
    videoBus,
    sourceType: APP_CONFIG.source.type,
    media: {
      width,
      height,
      fps: APP_CONFIG.media.fps,
    },
    options: APP_CONFIG.dashboard,
    params: {
      server: {
        port: APP_CONFIG.server.port,
      },
      media: {
        fps: APP_CONFIG.media.fps,
        width,
        height,
      },
      source: {
        type: APP_CONFIG.source.type,
        config: APP_CONFIG.source[APP_CONFIG.source.type],
      },
      webrtc: {
        fps: APP_CONFIG.webrtc.fps,
        singleClient: APP_CONFIG.webrtc.singleClient,
        turnUrls: APP_CONFIG.webrtc.turn.urls,
      },
      dashboard: {
        defaultIntervalMs: APP_CONFIG.dashboard.defaultIntervalMs,
      },
    },
    statusProviders: {
      server: () => getServerStatus(),
      source: () => (source ? source.getStatus() : { alive: false }),
      mediaProcessor: () => (mediaProcessor ? mediaProcessor.getStatus() : { alive: false }),
      pythonBridge: () => {
        if (!mediaProcessor) return { alive: false };
        return mediaProcessor.getStatus().pythonBridge;
      },
      ingestBus: () => ingestBus.getStatus(),
      videoBus: () => videoBus.getStatus(),
      webrtc: () => webrtcTransport.getStatus(),
      dashboard: () => dashboardModule.getStatus(),
    },
  });

  // 创建 media 处理器并启动
  mediaProcessor = new MediaProcessor({ // 新增：实例化并启动 MediaProcessor
    fps: APP_CONFIG.media.fps,
    width,
    height,
    ingestBus,
    videoBus,
    pythonBridge: APP_CONFIG.media.pythonBridge,
  }); // 新增：实例化并启动 MediaProcessor
  mediaProcessor.start();

  // 帧源部分（最后启动）
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

  const port = APP_CONFIG.server.port;
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