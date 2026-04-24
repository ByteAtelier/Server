const EventEmitter = require("events");

class VideoBus extends EventEmitter {
  constructor() {
    super();
    this._stableBuf = null; // VideoBus 自己持有的稳定内存
    this._latest = null; // { data: Buffer, ...meta }（对象也复用）
    this._totalFrames = 0;
    this._lastSeenAt = null;
  }

  // frame: { data: Buffer|Uint8Array, ...meta }
  push(frame) {
    if (!frame || !frame.data) return;

    const src = Buffer.isBuffer(frame.data)
      ? frame.data
      : Buffer.from(frame.data);

    // 只在首次/尺寸变化时分配（你分辨率写死，正常只会分配一次）
    if (!this._stableBuf || this._stableBuf.length !== src.length) {
      this._stableBuf = Buffer.allocUnsafe(src.length);
    }

    // 拷贝内容，保证对外可见 latest 在下一次 push 前稳定
    src.copy(this._stableBuf);

    // 复用 latest 对象，避免每帧创建对象
    if (!this._latest) this._latest = { data: this._stableBuf };
    this._latest.data = this._stableBuf;

    // 写入/覆盖 meta（浅字段）
    // 不做校验：由传入者/传出者负责
    for (const k of Object.keys(frame)) {
      if (k === "data") continue;
      this._latest[k] = frame[k];
    }

    this._totalFrames += 1;
    this._lastSeenAt = Date.now();

    this.emit("frame", this._latest);
  }

  getLatest() {
    return this._latest;
  }

  clear() {
    this._latest = null;
  }

  getStatus() {
    return {
      alive: true,
      totalFrames: this._totalFrames,
      lastSeenAt: this._lastSeenAt,
      lastTsSrc: this._latest ? this._latest.ts_src : null,
      hasLatestFrame: this._latest !== null,
    };
  }
}

module.exports = new VideoBus();
