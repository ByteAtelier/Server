// src/bus/ingestBus.js
const EventEmitter = require("events");

class IngestBus extends EventEmitter {
  constructor() {
    super();
    this._latest = null; // 最新完整 JPEG pkt（borrowed）
    this._totalFrames = 0;
    this._lastSeenAt = null;
  }

  // pkt: { codec: 'jpeg', data: Buffer, ...meta }
  push(pkt) {
    if (!pkt) return;

    this._latest = pkt;
    this._totalFrames += 1;
    this._lastSeenAt = Date.now();

    // 事件只是“通知有新帧”
    this.emit("frame", pkt);
  }

  getStatus() {
    return {
      alive: true,
      totalFrames: this._totalFrames,
      lastSeenAt: this._lastSeenAt,
      lastFrameId: this._latest ? this._latest.frameId : null,
    };
  }
}

module.exports = new IngestBus();