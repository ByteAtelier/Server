const { createServer } = require("./server/server");
const setupWebRTCTransport = require("./transport/webrtcTransport");
const { createImageLoopSource } = require("./source/imageLoopSource");
const ingestBus = require("./bus/ingestBus");

function main() {
  // 服务器部分（先创建，拿到 io）
  const { app, httpServer, io } = createServer({ corsOrigin: "*" });

  // 传输层部分（挂到 io 上）
  setupWebRTCTransport(io, ingestBus, {
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

  // 帧源部分（最后启动）
  const source = createImageLoopSource({
    fps: 30,
    width: 640,
    height: 480,
    imageDir: "D:\\Code\\BrightSmile\\AI\\datas\\Benchmarking Dataset\\train\\images",
    jpegQuality: 80,
  });
  source.start(ingestBus);

  // 后续微信 OAuth 路由可以挂这里
  // app.use("/auth/weixin", ...)

  const port = Number(process.env.PORT || 25565);
  httpServer.listen(port, () => {
    console.log(`Server listening on ${port}`);
  });

  // 可选但建议：优雅退出，避免残留定时器/句柄
  process.on("SIGINT", () => {
    try { source.stop?.(); } catch {}
    try { httpServer.close(); } catch {}
    process.exit(0);
  });
}

main();