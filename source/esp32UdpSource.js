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
    logEveryMs: defaultOpts.logEveryMs ?? 1000,
  };

  let socket = null;
  let running = false;

  // 收帧日志做限频，避免高帧率刷屏
  let recvStatWindowStart = 0;
  let recvStatCount = 0;
  let lastInlineLen = 0;

  function writeStatusLine(line) {
    if (process.stdout.isTTY) {
      const pad = Math.max(0, lastInlineLen - line.length);
      process.stdout.write(`\r${line}${" ".repeat(pad)}`);
      lastInlineLen = line.length;
      return;
    }
    console.log(line);
  }

  function writeEventLine(line) {
    if (process.stdout.isTTY) {
      if (lastInlineLen > 0) {
        // 先结束行内状态，再打印事件日志，避免被下一次 \r 覆盖
        process.stdout.write("\n");
        lastInlineLen = 0;
      }
      process.stdout.write(`${line}\n`);
      return;
    }
    console.log(line);
  }

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

  function summarizeMissingParts(frame, maxItems = 12) {
    const missing = [];
    for (let i = 0; i < frame.total; i++) {
      if (frame.parts[i] === null) missing.push(i);
    }
    return {
      count: missing.length,
      preview: missing.slice(0, maxItems),
      truncated: missing.length > maxItems,
    };
  }

  function dropFrame(frame, reason = "unknown") {
    if (!frame) return;

    if (!frame.completed && frame.received < frame.total) {
      const miss = summarizeMissingParts(frame);
      const suffix = miss.truncated ? "..." : "";
      writeEventLine(
        `[esp32UdpSource] packet loss: drop frame id=${frame.id}, reason=${reason}, recv=${frame.received}/${frame.total}, missing=${miss.count}, missingIndex=[${miss.preview.join(",")}${suffix}]`
      );
    }

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

    const now = Date.now();
    if (recvStatWindowStart === 0) recvStatWindowStart = now;
    recvStatCount++;

    if (recvStatCount > 0 && now - recvStatWindowStart >= opts.logEveryMs) {
      const sec = (now - recvStatWindowStart) / 1000;
      const fps = sec > 0 ? (recvStatCount / sec).toFixed(1) : "0.0";
      const line = `[esp32UdpSource] recv frame id=${frame.id}, size=${buf.length}B, window=${recvStatCount} frames/${sec.toFixed(1)}s (~${fps} FPS)`;
      writeStatusLine(line);
      recvStatWindowStart = now;
      recvStatCount = 0;
    }
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
      dropFrame(prev, "superseded_by_newer_frame");
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
      dropFrame(frame, "inconsistent_total");
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
        dropFrame(prev, "older_frame_after_current_complete");
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
    recvStatWindowStart = 0;
    recvStatCount = 0;

    if (process.stdout.isTTY && lastInlineLen > 0) {
      process.stdout.write("\r\n");
      lastInlineLen = 0;
    }

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