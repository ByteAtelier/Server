const { spawn } = require("child_process");

class FfmpegJpegToI420 {
  constructor({ width, height, onFrame, onLog }) {
    this.width = width;
    this.height = height;
    this.onFrame = onFrame;
    this.onLog = onLog || (() => {});

    this.frameSize = (width * height * 3) >> 1;
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

    console.log(`[FfmpegJpegToI420] Starting ffmpeg for ${this.width}x${this.height} I420 decode`);

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
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-i",
      "pipe:0",

      "-vf",
      // 临时翻转
      // `scale=${this.width}:${this.height},format=yuv420p`,
      `scale=${this.width}:${this.height},rotate=PI,format=yuv420p`,
      "-an",
      "-c:v",
      "rawvideo",
      "-pix_fmt",
      "yuv420p",
      "-f",
      "rawvideo",
      "pipe:1",
    ];

    this._proc = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });

    this._proc.stdout.on("data", (chunk) => this._handleStdout(chunk));
    this._proc.stderr.on("data", (d) => this.onLog(d.toString()));

    this._proc.stdin.on("drain", () => {
      this._stdinBusy = false;
    });

    this._proc.on("close", (code, signal) => {
      this.onLog(`ffmpeg exited code=${code} signal=${signal}`);
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
  }

  _resetParser() {
    this._chunks.length = 0;
    this._chunksBytes = 0;
    this._headOffset = 0;
  }

  pushJpeg(jpegBuf) {
    if (!this._proc) return;
    if (this._stdinBusy) return; // latest-frame-wins：直接丢
    const buf = Buffer.isBuffer(jpegBuf) ? jpegBuf : Buffer.from(jpegBuf);
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

module.exports = FfmpegJpegToI420;
