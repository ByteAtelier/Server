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

  // 单行状态栏统计窗口（仅有活动时输出）
  let statWindowStart = 0;
  let recvStatCount = 0;
  let lastFrameId = -1;
  let lastInlineLen = 0;
  let dropStatCount = 0;
  let dropReasons = Object.create(null);

  function writeStatusLine(line) {
    if (process.stdout.isTTY) {
      const pad = Math.max(0, lastInlineLen - line.length);
      process.stdout.write(`\r${line}${" ".repeat(pad)}`);
      lastInlineLen = line.length;
      return;
    }
    console.log(line);
  }

  function topDropReasons(maxItems = 2) {
    return Object.entries(dropReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxItems)
      .map(([k, v]) => `${k}:${v}`)
      .join("|");
  }

  function flushStatus(now, force = false) {
    if (statWindowStart === 0) statWindowStart = now;
    if (!force && now - statWindowStart < opts.logEveryMs) return;

    const active = recvStatCount > 0 || dropStatCount > 0;
    if (!active) {
      statWindowStart = now;
      return;
    }

    const sec = (now - statWindowStart) / 1000;
    const fps = sec > 0 ? recvStatCount / sec : 0;
    const totalEvents = recvStatCount + dropStatCount;
    const dropPct = totalEvents > 0 ? (dropStatCount * 100) / totalEvents : 0;
    const reasonSummary = dropStatCount > 0 ? topDropReasons(2) : "-";
    const idText = lastFrameId >= 0 ? String(lastFrameId) : "-";
    const recvText = String(recvStatCount);
    const fpsText = fps.toFixed(1);
    const dropPctText = dropPct.toFixed(1);

    writeStatusLine(
      `[esp32UdpSource] id=${idText} recv=${recvText} fps=${fpsText} drop=${dropStatCount} drop%=${dropPctText} top=${reasonSummary}`
    );

    statWindowStart = now;
    recvStatCount = 0;
    dropStatCount = 0;
    dropReasons = Object.create(null);
  }

  function recordDrop(reason) {
    const now = Date.now();
    if (statWindowStart === 0) statWindowStart = now;
    dropStatCount++;
    dropReasons[reason] = (dropReasons[reason] || 0) + 1;
    flushStatus(now, false);
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

  function dropFrame(frame, reason = "unknown") {
    if (!frame) return;

    recordDrop(`frame:${reason}`);

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
    if (statWindowStart === 0) statWindowStart = now;
    recvStatCount++;
    lastFrameId = frame.id;

    flushStatus(now, false);
  }

  function acceptPacket(frameChannel, msg) {
    if (msg.length < opts.headerBytes) {
      recordDrop("pkt:short_header");
      return;
    }

    const ts_src = msg.readUInt32LE(0);
    const id = msg.readUInt32LE(4);
    const total = msg.readUInt16LE(8);
    const index = msg.readUInt16LE(10);
    const dataLen = msg.readUInt16LE(12);
    const _ = msg.readUInt16LE(14); // 内存对齐

    // ========== 基本校验 ==========    
    if (total === 0) {
      recordDrop("pkt:total_zero");
      return;
    }
    if (index >= total) {
      recordDrop("pkt:index_out_of_range");
      return;
    }
    if (dataLen > opts.udpMaxPayload) {
      recordDrop("pkt:dataLen_exceed_udpMaxPayload");
      return;
    }
    const available = msg.length - opts.headerBytes;
    if (dataLen > available) {
      recordDrop("pkt:dataLen_exceed_available");
      return;
    }

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
      recordDrop("pkt:older_than_current");
      return;
    }

    // ========== 早期裁决 ==========
    if (frame.completed) {
      recordDrop("pkt:on_completed_frame");
      return;
    }
    if (frame.total !== total) {
      dropFrame(frame, "inconsistent_total");
      return;
    }

    // ========== 去重 & 组包 ==========
    if (frame.parts[index] !== null) {
      recordDrop("pkt:duplicate_index");
      return;
    }

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
    flushStatus(Date.now(), true);
    statWindowStart = 0;
    recvStatCount = 0;
    lastFrameId = -1;
    dropStatCount = 0;
    dropReasons = Object.create(null);

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