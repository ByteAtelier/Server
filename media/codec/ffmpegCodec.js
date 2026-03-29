const { spawn } = require("child_process");

class FfmpegCodec {
  constructor({ width, height, onFrame, onLog, mode }) {
    this.width = width;
    this.height = height;
    this.onFrame = onFrame;
    this.onLog = onLog || (() => {});
    if (!["jpegToBgr", "bgrToI420"].includes(mode)) {
      throw new Error(
        `[FfmpegCodec] Invalid mode: ${mode}. Supported modes are "jpegToBgr" and "bgrToI420".`
      );
    }
    this.mode = mode;

    this.frameSize = this.mode === "jpegToBgr"
      ? width * height * 3
      : (width * height * 3) >> 1;
    this._chunks = []; // stdout chunk 队列
    this._chunksBytes = 0; // 队列总字节数
    this._headOffset = 0; // 队首 chunk 已消费偏移
    this._frameBuf = Buffer.allocUnsafe(this.frameSize); // 复用的帧缓冲（重要）
    this._proc = null;
    this._closed = false;
    // stdin backpressure
    this._stdinBusy = false;
    // stdout 队列上限（最多缓存 N 帧 raw 数据）
    this.MAX_QUEUE_FRAMES = 3;
    this.MAX_QUEUE_BYTES = this.frameSize * this.MAX_QUEUE_FRAMES;
  }

  start() {
    if (this._proc) return;

    this.onLog(`[FfmpegCodec] Starting ffmpeg for ${this.width}x${this.height} with mode=${this.mode}`);

    const isJpegToBgr = this.mode === "jpegToBgr";
    const inputCodec = isJpegToBgr ? "mjpeg" : "rawvideo";
    const outputCodec = isJpegToBgr ? "bgr24" : "yuv420p";
    const format = isJpegToBgr ? "image2pipe" : "rawvideo";
    const scaleFilter = isJpegToBgr
      ? `scale=${this.width}:${this.height},format=${outputCodec}`
      : `scale=${this.width}:${this.height},format=${outputCodec}`;
    const inputPixFmt = isJpegToBgr ? null : "bgr24";

    const args = [
      "-hide_banner",
      "-loglevel",
      "error",

      "-fflags",
      "nobuffer",
      "-flags",
      "low_delay",
      "-analyzeduration",
      "0",
      "-probesize",
      "32",

      "-f",
      format,
      "-vcodec",
      inputCodec,
      "-s",
      `${this.width}x${this.height}`,
      ...(inputPixFmt ? ["-pix_fmt", inputPixFmt] : []),
      "-i",
      "pipe:0",

      "-vf",
      scaleFilter,
      "-an",
      "-c:v",
      "rawvideo",
      "-pix_fmt",
      outputCodec,
      "-f",
      "rawvideo",
      "pipe:1",
    ];

    this._proc = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });

    this.onLog(`[FfmpegCodec] ffmpeg started with PID=${this._proc.pid} mode=${this.mode} args=${args.join(" ")}`);

    this._proc.stdout.on("data", (chunk) => this._handleStdout(chunk));
    this._proc.stderr.on("data", (d) => this.onLog(`\n[FfmpegCodec] ffmpeg mode=${this.mode} stderr: ${d.toString()}`));

    this._proc.stdin.on("drain", () => {
      this._stdinBusy = false;
    });

    this._proc.on("close", (code, signal) => {
      this.onLog(`[FfmpegCodec] ffmpeg exited code=${code} signal=${signal} mode=${this.mode}`);
      this._proc = null;
      this._resetParser();
      if (!this._closed) this.start();
    });
  }

  stop() {
    this._closed = true;
    if (this._proc) {
      try {
        this._proc.stdin.end();
      } catch {}
      try {
        this._proc.kill("SIGKILL");
      } catch {}
      this._proc = null;
    }
    this._chunks = [];
    this._chunksBytes = 0;
    this._headOffset = 0;
    this.onLog("[FfmpegCodec] Stopped");
  }

  _resetParser() {
    this._chunks.length = 0;
    this._chunksBytes = 0;
    this._headOffset = 0;
  }

  pushFrame(frameBuf) {
    if (!this._proc) return;
    if (this._stdinBusy) return; // latest-frame-wins：直接丢
    const buf = Buffer.isBuffer(frameBuf) ? frameBuf : Buffer.from(frameBuf);
    const ok = this._proc.stdin.write(buf);
    if (!ok) {
      // stdin 写满，进入 busy，后续帧全部丢
      this._stdinBusy = true;
    }
  }

  _handleStdout(chunk) {
    if (!chunk || chunk.length === 0) return;

    // 1) 入队
    this._chunks.push(chunk);
    this._chunksBytes += chunk.length;

    // 2) 超过上限：按整帧丢旧数据（保持对齐）
    if (this._chunksBytes > this.MAX_QUEUE_BYTES) {
      const dropBytes =
        Math.floor(
          (this._chunksBytes - this.MAX_QUEUE_BYTES) / this.frameSize
        ) * this.frameSize;

      if (dropBytes > 0) {
        this._dropBytes(dropBytes);
      }
    }

    // 3) 只要够一帧，就输出
    while (this._chunksBytes >= this.frameSize) {
      let need = this.frameSize;
      let dstOff = 0;

      while (need > 0) {
        const head = this._chunks[0];
        const avail = head.length - this._headOffset;
        const take = avail >= need ? need : avail;

        head.copy(
          this._frameBuf,
          dstOff,
          this._headOffset,
          this._headOffset + take
        );

        dstOff += take;
        need -= take;
        this._headOffset += take;

        if (this._headOffset >= head.length) {
          this._chunks.shift();
          this._headOffset = 0;
        }
      }

      this._chunksBytes -= this.frameSize;

      this.onFrame(this._frameBuf);
    }
  }

  _dropBytes(bytes) {
    let remain = bytes;

    while (remain > 0 && this._chunks.length > 0) {
      const head = this._chunks[0];
      const avail = head.length - this._headOffset;
      const take = avail >= remain ? remain : avail;

      this._headOffset += take;
      this._chunksBytes -= take;
      remain -= take;

      if (this._headOffset >= head.length) {
        this._chunks.shift();
        this._headOffset = 0;
      }
    }
  }
}

module.exports = FfmpegCodec;
