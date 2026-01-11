const FfmpegJpegToI420 = require("./decode/ffmpegJpegToI420");

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
    // 启动解码器，传入宽度、高度、回调方法等
    this.decoder = new FfmpegJpegToI420({
      width: this.width,    // 从构造函数接收宽度
      height: this.height,  // 从构造函数接收高度
      onFrame: this.handleDecodedFrame.bind(this),  // 解码后帧的处理函数
      onLog: console.log,  // 可选：输出解码日志
    });

    // 启动解码器
    this.decoder.start();

    // 监听来自 ingestBus 的新 JPEG 数据
    this.ingestBus.on("frame", (pkt) => {
      if (!pkt || pkt.codec !== "jpeg" || !pkt.data) return;  // 只处理有效的 JPEG 数据
      this.decoder.pushJpeg(pkt.data);  // 将 JPEG 数据推送到解码器
      this.timestamp = pkt.ts_src;  // 更新最新的时间戳
    });
  }

  // 处理解码后的 I420 数据
  handleDecodedFrame(i420Frame) {
    // 将解码后的 I420 数据推送到 videoBus
    this.videoBus.push({
      data: i420Frame, // 解码后的 I420 数据
      ts_src: this.timestamp, // 源时间戳
      width: this.width, // 视频宽度
      height: this.height, // 视频高度
    });
  }

  // 停止解码器
  stop() {
    if (this.decoder) this.decoder.stop();  // 停止解码器
  }
}

module.exports = MediaProcessor;