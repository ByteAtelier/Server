const FfmpegCodec = require("./codec/ffmpegCodec");

class MediaProcessor {
  // 通过构造器传入所有的参数：fps、width、height，ingestBus 和 videoBus
  constructor({fps, width, height, ingestBus, videoBus}) {
    this.fps = fps || 30;      // 帧率，默认为 30
    this.width = width || 640; // 视频宽度，默认 640
    this.height = height || 480; // 视频高度，默认 480
    this.ingestBus = ingestBus; // 接收数据的总线
    this.videoBus = videoBus;   // 视频总线，用于推送解码后的帧
    this.timestamp = 0;
  }

  start() {
    // 初始化解码器
    this.decoder = new FfmpegCodec({
      width: this.width,    // 从构造函数接收宽度
      height: this.height,  // 从构造函数接收高度
      onFrame: this.handleDecodedFrame.bind(this),  // 解码后帧的处理函数
      onLog: console.log,  // 可选：输出解码日志
      mode: "jpegToRgb"   // 设置解码模式为 JPEG 到 I420
    });

    // 初始化编码器
    this.encoder = new FfmpegCodec({
      width: this.width,
      height: this.height,
      onFrame: this.handleEncodedFrame.bind(this),
      onLog: console.log,
      mode: "rgbToI420"
    });

    // 启动解码器
    this.decoder.start();
    // 启动编码器
    this.encoder.start();

    // 监听来自 ingestBus 的新 JPEG 数据
    this.ingestBus.on("frame", (pkt) => {
      if (!pkt || pkt.codec !== "jpeg" || !pkt.data) return;  // 只处理有效的 JPEG 数据
      this.decoder.pushFrame(pkt.data);  // 将 JPEG 数据推送到解码器
      this.timestamp = pkt.ts_src;  // 更新最新的时间戳
    });
  }

  // 处理解码后的 RGB 数据
  handleDecodedFrame(rgbFrame) {
    // 将解码后的 RGB 数据推送到编码器进行 I420 编码
    this.encoder.pushFrame(rgbFrame);
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
    if (this.decoder) this.decoder.stop();  // 停止解码器
    if (this.encoder) this.encoder.stop();  // 停止编码器
    console.log("[MediaProcessor] Stopped");
  }
}

module.exports = MediaProcessor;