const FfmpegCodec = require("./codec/ffmpegCodec");
const PythonBridge = require("./PythonBridge/PythonBridge");

class MediaProcessor {
  // 通过构造器传入所有的参数：fps、width、height，ingestBus 和 videoBus
  constructor({ fps, width, height, ingestBus, videoBus }) {
    this.fps = fps || 30; // 帧率，默认为 30
    this.width = width || 640; // 视频宽度，默认 640
    this.height = height || 480; // 视频高度，默认 480
    this.ingestBus = ingestBus; // 接收数据的总线
    this.videoBus = videoBus; // 视频总线，用于推送解码后的帧
    this.timestamp = 0;
    this.frameId = 0; // 用于标记帧的递增 ID
  }

  start() {
    // 初始化解码器
    this.decoder = new FfmpegCodec({
      width: this.width, // 从构造函数接收宽度
      height: this.height, // 从构造函数接收高度
      onFrame: this.handleDecodedFrame.bind(this), // 解码后帧的处理函数
      onLog: console.log, // 可选：输出解码日志
      mode: "jpegToBgr", // 设置解码模式为 JPEG 到 BGR
    });

    // 初始化编码器
    this.encoder = new FfmpegCodec({
      width: this.width,
      height: this.height,
      onFrame: this.handleEncodedFrame.bind(this),
      onLog: console.log,
      mode: "bgrToI420",
    });

    // 启动解码器
    this.decoder.start();
    // 启动编码器
    this.encoder.start();

    this.pythonBridge = new PythonBridge({
      width: this.width,
      height: this.height,
      onLog: console.log,
      onFrame: this.handlePythonFrame.bind(this),
    });
    this.pythonBridge.start();

    // 监听来自 ingestBus 的新 JPEG 数据
    this.ingestBus.on("frame", (pkt) => {
      if (!pkt || pkt.codec !== "jpeg" || !pkt.data) return; // 只处理有效的 JPEG 数据
      this.decoder.pushFrame(pkt.data); // 将 JPEG 数据推送到解码器
      this.timestamp = pkt.ts_src; // 更新最新的时间戳
    });
  }

  // 处理解码后的 BGR 数据
  handleDecodedFrame(bgrFrame) {
    // Python 是节拍：上游 > Python 时会在 PythonBridge 内部覆盖 mailbox 丢上游帧（不积压）
    // 注意：PythonBridge 约定字段名为 { frameId, tsMs, frameBuf }
    this.pythonBridge.pushFrame({
      frameId: this.frameId++, // u32 递增帧号
      tsMs: this.timestamp, // 毫秒时间戳（来自 ingest 的 pkt.ts_src）
      frameBuf: bgrFrame, // BGR24 = w*h*3
    });
  }

  // 处理来自 PythonBridge 的帧
  handlePythonFrame({ frameId, tsMs, frameBuf }) {
    // 以 Python 输出为准：后续编码与发送使用这帧对应的时间戳
    this.timestamp = typeof tsMs === "bigint" ? Number(tsMs) : tsMs;
    // 将 Python 处理后的 BGR 帧送入编码器（BGR -> I420）
    this.encoder.pushFrame(frameBuf);
  }
  
  // 处理编码后的 I420 数据
  handleEncodedFrame(i420Frame) {
    // 将编码后的 I420 数据推送到 videoBus
    this.videoBus.push({
      data: i420Frame, // 编码后的 I420 数据
      ts_src: this.timestamp, // 源时间戳
      width: this.width, // 视频宽度
      height: this.height, // 视频高度
    });
  }

  // 停止解码器
  stop() {
    if (this.decoder) this.decoder.stop(); // 停止解码器
    if (this.encoder) this.encoder.stop(); // 停止编码器
    if (this.pythonBridge) this.pythonBridge.stop(); // 停止 Python 桥接
    console.log("[MediaProcessor] Stopped");
  }
}

module.exports = MediaProcessor;