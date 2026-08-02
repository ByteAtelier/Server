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
  // 调用参数覆盖app.config.js的配置项，优先级高于默认配置
  const sourceArg = process.argv[2];
  if (sourceArg === "image") {
    APP_CONFIG.source.type = "imageLoop";
  } else if (sourceArg === "esp32") {
    APP_CONFIG.source.type = "esp32Udp";
  }
  const width = APP_CONFIG.media.width;
  const height = APP_CONFIG.media.height;
  let mediaProcessor = null;
  let source = null;
  let dashboardModule = null;

  // 服务器部分（先创建，拿到 io）
  const {
    httpServer,
    io,
    getStatus: getServerStatus,
  } = createServer({ corsOrigin: "*" });

  // 传输层部分（挂到 io 上）
  const webrtcTransport = setupWebRTCTransport(
    io,
    videoBus,
    width,
    height,
    APP_CONFIG.webrtc,
  );

  // Dashboard：由前端主动请求订阅后，按间隔推送服务端状态
  dashboardModule = setupDashboard(io, {
    ingestBus,
    videoBus,
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
        imageLoop: {
          fps: APP_CONFIG.source.imageLoop.fps,
          jpegQuality: APP_CONFIG.source.imageLoop.jpegQuality,
        },
        esp32Udp: {
          port: APP_CONFIG.source.esp32Udp.port,
          codec: APP_CONFIG.source.esp32Udp.codec,
          headerBytes: APP_CONFIG.source.esp32Udp.headerBytes,
          udpMaxPayload: APP_CONFIG.source.esp32Udp.udpMaxPayload,
        },
      },
      webrtc: {
        fps: APP_CONFIG.webrtc.fps,
        singleClient: APP_CONFIG.webrtc.singleClient,
      },
      yolo: {
        imgsz: APP_CONFIG.media.pythonBridge.scriptArgs.imgsz,
        conf: APP_CONFIG.media.pythonBridge.scriptArgs.conf,
        iou: APP_CONFIG.media.pythonBridge.scriptArgs.iou,
        maxDet: APP_CONFIG.media.pythonBridge.scriptArgs["max-det"],
        maskAlpha: APP_CONFIG.media.pythonBridge.scriptArgs["mask-alpha"],
      },
      dashboard: {
        defaultIntervalMs: APP_CONFIG.dashboard.defaultIntervalMs,
        moduleAliveMs: APP_CONFIG.dashboard.moduleAliveMs,
      },
    },
    statusProviders: {
      server: () => {
        const s = getServerStatus();
        return {
          alive: s.alive,
          listening: s.listening,
          connectedClients: s.connectedClients,
          corsOrigin: s.corsOrigin,
        };
      },
      source: () => {
        if (!source) {
          return {
            alive: false,
            running: false,
            type: APP_CONFIG.source.type,
          };
        }

        const s = source.getStatus();

        if (APP_CONFIG.source.type === "imageLoop") {
          return {
            alive: s.alive,
            running: s.running,
            type: "imageLoop",
            frameId: s.frameId,
            lastFrameAt: s.lastFrameAt,
            index: s.index,
            fileCount: s.fileCount,
          };
        }

        if (APP_CONFIG.source.type === "esp32Udp") {
          return {
            alive: s.alive,
            running: s.running,
            type: "esp32Udp",
            bound: s.bound,
            host: s.host,
            port: s.port,
            codec: s.codec,
            width: s.width,
            height: s.height,
            session: s.session,
            frameId: s.frameId,
            lastFrameId: s.lastFrameId,
            windowRecvCount: s.windowRecvCount,
            windowDropCount: s.windowDropCount,
            windowFps: s.windowFps,
            windowDropPct: s.windowDropPct,
            windowTopDropReasons: s.windowTopDropReasons,
            totalRecvCount: s.totalRecvCount,
            totalDropCount: s.totalDropCount,
            totalDropReasons: s.totalDropReasons,
          };
        }

        return {
          alive: s.alive,
          running: s.running,
          type: APP_CONFIG.source.type,
        };
      },
      mediaProcessor: () => {
        if (!mediaProcessor) return { alive: false };
        const m = mediaProcessor.getStatus();
        return {
          alive: m.alive,
          frameId: m.frameId,
          timestamp: m.timestamp,
          decoder: {
            alive: m.decoder.alive,
          },
          encoder: {
            alive: m.encoder.alive,
          },
          pythonBridge: {
            alive: m.pythonBridge.alive,
            inFlight: m.pythonBridge.inFlight,
            stdinDraining: m.pythonBridge.stdinDraining,
            mailboxPending: m.pythonBridge.mailboxPending,
            stats: m.pythonBridge.stats,
          },
        };
      },
      webrtc: () => {
        const w = webrtcTransport.getStatus();
        return {
          alive: w.alive,
          socketConnectionCount: w.socketConnectionCount,
          signalSocketCount: w.signalSocketCount,
          activeSocketId: w.activeSocketId,
          lastOfferAt: w.lastOfferAt,
          lastConnectionState: w.lastConnectionState,
          hasActivePeer: w.hasActivePeer,
        };
      },
      dashboard: () => dashboardModule.getStatus(),
    },
  });

  // 创建 media 处理器并启动
  mediaProcessor = new MediaProcessor({
    // 新增：实例化并启动 MediaProcessor
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
    throw new Error(
      `[main] unsupported APP_CONFIG.source.type=${APP_CONFIG.source.type}`,
    );
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
    try {
      source.stop?.();
    } catch {}
    try {
      httpServer.close();
    } catch {}
    try {
      mediaProcessor.stop();
    } catch {}
    process.exit(0);
  });
}

main();
