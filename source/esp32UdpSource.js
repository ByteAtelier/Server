const dgram = require("dgram");

function createEsp32UdpSource(defaultOpts = {}) {
  const opts = {
    host: defaultOpts.host ?? "0.0.0.0",
    port: defaultOpts.port ?? 5000,

    width: defaultOpts.width ?? 640,
    height: defaultOpts.height ?? 480,
    codec: defaultOpts.codec ?? "jpeg",

    headerBytes: defaultOpts.headerBytes ?? 16,
    udpMaxPayload: defaultOpts.udpMaxPayload ?? 1024,
  };

  let socket = null;
  let running = false;

  // 最多两帧
  let cur = null;   // 最新帧
  let prev = null;  // 上一帧

  function newFrame(id, total, ts_src) {

    return {
      id,
      total,
      received: 0,
      bytes: 0,
      parts: new Array(total).fill(null),
      ts_firstPacket: ts_src,
      completed: false,
    };
  }

  function dropFrame(frame) {
    if (!frame) return;
    frame.completed = true;
  }

  function pushFrame(frameChannel, frame) {
    const buf = Buffer.concat(frame.parts, frame.bytes);
    frame.completed = true;

    frameChannel.push({
      frameId: frame.id,
      ts_src: frame.ts_firstPacket,  // 用首包时间戳
      codec: opts.codec,
      width: opts.width,
      height: opts.height,
      data: buf,
    });
  }

  function acceptPacket(frameChannel, msg) {
    if (msg.length < opts.headerBytes) return;

    const ts_src = msg.readUInt32LE(0);
    const id = msg.readUInt32LE(4);
    const total = msg.readUInt16LE(8);
    const index = msg.readUInt16LE(10);
    const dataLen = msg.readUInt16LE(12);
    const _ = msg.readUInt16LE(14); // 内存对齐

    // ========== 基本校验 ==========    
    if (total === 0) return;
    if (index >= total) return;
    if (dataLen > opts.udpMaxPayload) return;
    const available = msg.length - opts.headerBytes;
    if (dataLen > available) return;

    const payload = msg.subarray(
      opts.headerBytes,
      opts.headerBytes + dataLen
    );

    // ========== 帧路由 ==========
    let frame = null;

    if (cur && id === cur.id) {
      frame = cur;
    } else if (prev && id === prev.id) {
      frame = prev;
    } else if (!cur || id > cur.id) {
      // 新帧到来
      dropFrame(prev);
      prev = cur;
      cur = newFrame(id, total, ts_src);
      if (!cur) return;
      frame = cur;
    } else {
      // 更旧的帧，直接丢弃
      return;
    }

    // ========== 早期裁决 ==========
    if (frame.completed) return;
    if (frame.total !== total) {
      dropFrame(frame);
      return;
    }

    // ========== 去重 & 组包 ==========
    if (frame.parts[index] !== null) return;

    frame.parts[index] = payload;
    frame.received++;
    frame.bytes += payload.length;

    // ========== 完成 ==========
    if (frame.received === frame.total) {
      pushFrame(frameChannel, frame);

      // 如果当前帧完成，旧帧不再有价值
      if (frame === cur && prev) {
        dropFrame(prev);
        prev = null;
      }
    }
  }

  function start(frameChannel) {
    if (running) return;
    if (!frameChannel)
      throw new Error("[esp32UdpSource] start(frameChannel) required");

    socket = dgram.createSocket("udp4");

    socket.on("error", (err) => {
      console.error("[esp32UdpSource] socket error:", err);
    });

    socket.on("message", (msg) => {
      try {
        acceptPacket(frameChannel, msg);
      } catch (e) {
        console.error("[esp32UdpSource] handle error:", e);
      }
    });

    socket.bind(opts.port, opts.host, () => {
      running = true;
      const addr = socket.address();
      console.log(
        `[esp32UdpSource] Listening udp://${addr.address}:${addr.port} (${opts.width}x${opts.height}, codec=${opts.codec})`
      );
    });
  }

  function stop() {
    if (!running) return;
    running = false;

    cur = null;
    prev = null;

    if (socket) {
      try {
        socket.close();
      } catch (_) {}
      socket = null;
    }

    console.log("[esp32UdpSource] Stopped");
  }

  return { start, stop };
}

module.exports = { createEsp32UdpSource };