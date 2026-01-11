// src/bus/ingestBus.js
const EventEmitter = require("events");

class IngestBus extends EventEmitter {
  constructor() {
    super();
    this._latest = null; // 最新完整 JPEG pkt（borrowed）
  }

  // pkt: { codec: 'jpeg', data: Buffer, ...meta }
  push(pkt) {
    if (!pkt) return;

    // latest-only：覆盖旧值
    this._latest = pkt;

    // 事件只是“通知有新帧”
    this.emit("frame", pkt);
  }

  getLatest() {
    return this._latest;
  }

  clear() {
    this._latest = null;
  }
}

module.exports = new IngestBus();