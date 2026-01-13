// Esp32UdpSource.js
// 对外接口保持不变：createEsp32UdpSource(defaultOpts) => { start, stop }
// 分片协议严格匹配你给的 
// udp_packet_t：
//   uint32_t id
//   uint16_t total_packets
//   uint16_t packet_index
//   uint16_t data_len
//   uint8_t  data[UDP_MAX_PAYLOAD]
//
// 重要说明：
// - ESP32/多数 MCU 结构体通常是小端序；这里按 LE 解析。
// - 为避免 C 端结构体 padding 影响，请确保发送端用 packed（或手工序列化）；否则 header 可能不是 10 字节。

const dgram = require("dgram");

function createEsp32UdpSource(defaultOpts = {}) {
  const opts = {
    host: defaultOpts.host ?? "0.0.0.0",
    port: defaultOpts.port ?? 5000,

    // 输出元信息（数据本身一般是 jpeg/h264 等完整帧拼接后）
    width: defaultOpts.width ?? 640,
    height: defaultOpts.height ?? 480,
    codec: defaultOpts.codec ?? "jpeg",

    // 协议参数（匹配 udp_packet_t）
    // header = 4 + 2 + 2 + 2 = 10 bytes
    headerBytes: defaultOpts.headerBytes ?? 10,
    udpMaxPayload: defaultOpts.udpMaxPayload ?? 1024, // 与 UDP_MAX_PAYLOAD 一致

    // 组包保护
    frameTimeoutMs: defaultOpts.frameTimeoutMs ?? 1500,
    maxInFlightFrames: defaultOpts.maxInFlightFrames ?? 16,
    maxFrameBytes: defaultOpts.maxFrameBytes ?? 5 * 1024 * 1024,
  };

  let socket = null;
  let running = false;

  // in-flight: id(str) -> { id, total, received, chunks(Map idx->Buffer), bytes, createdAt }
  const inflight = new Map();

  function cleanupInflight() {
    const now = Date.now();

    for (const [k, v] of inflight) {
      if (now - v.createdAt > opts.frameTimeoutMs) inflight.delete(k);
    }

    if (inflight.size > opts.maxInFlightFrames) {
      const entries = Array.from(inflight.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt
      );
      const drop = inflight.size - opts.maxInFlightFrames;
      for (let i = 0; i < drop; i++) inflight.delete(entries[i][0]);
    }
  }

  function pushFrame(frameChannel, id, dataBuf) {
    frameChannel.push({
      frameId: id, // 直接用 udp_packet_t.id 作为 frameId
      ts_src: Date.now(),
      codec: opts.codec,
      width: opts.width,
      height: opts.height,
      data: dataBuf,
    });
  }

  function handlePacket(frameChannel, msg) {
    // 最小头长校验
    if (msg.length < opts.headerBytes) return;

    // 按 udp_packet_t 解析
    const id = msg.readUInt32LE(0);
    const total = msg.readUInt16LE(4);
    const index = msg.readUInt16LE(6);
    const dataLen = msg.readUInt16LE(8);

    // console.log(`[esp32UdpSource] index=0 packet id=${id} index=${index}/${total} dataLen=${dataLen} msgLen=${msg.length}`);

    // 合法性校验
    if (total === 0) return;
    if (index >= total) return;

    // console.log(`[esp32UdpSource] index=1 packet id=${id} index=${index}/${total} dataLen=${dataLen} msgLen=${msg.length}`);

    // data_len 不能超过 UDP_MAX_PAYLOAD
    if (dataLen > opts.udpMaxPayload) return;

    // console.log(`[esp32UdpSource] index=2 packet id=${id} index=${index}/${total} dataLen=${dataLen} msgLen=${msg.length}`);

    // 实际 payload 长度必须够
    const available = msg.length - opts.headerBytes;
    // console.log(`[esp32UdpSource] available=${available} dataLen=${dataLen}`);
    if (dataLen > available) return;

    // console.log(`[esp32UdpSource] index=3 packet id=${id} index=${index}/${total} dataLen=${dataLen} msgLen=${msg.length}`);

    // 取出有效数据
    const payload = msg.subarray(opts.headerBytes, opts.headerBytes + dataLen);

    // console.log(`[esp32UdpSource] index=4 packet id=${id} index=${index}/${total} dataLen=${dataLen} msgLen=${msg.length}`);

    cleanupInflight();

    // console.log(`[esp32UdpSource] index=5 packet id=${id} index=${index}/${total} dataLen=${dataLen} msgLen=${msg.length}`);
    const key = String(id);
    let entry = inflight.get(key);
    if (!entry) {
      entry = {
        id,
        total,
        received: 0,
        chunks: new Map(),
        bytes: 0,
        createdAt: Date.now(),
      };
      inflight.set(key, entry);
    }

    // console.log(`[esp32UdpSource] index=6 packet id=${id} index=${index}/${total} dataLen=${dataLen} msgLen=${msg.length}`);

    // total 不一致（可能 id 重用/乱序）则丢弃该帧缓存
    if (entry.total !== total) {
      inflight.delete(key);
      return;
    }

    // console.log(`[esp32UdpSource] index=7 packet id=${id} index=${index}/${total} dataLen=${dataLen} msgLen=${msg.length}`);

    // 去重
    if (!entry.chunks.has(index)) {
      entry.chunks.set(index, payload);
      entry.received += 1;
      entry.bytes += payload.length;

      if (entry.bytes > opts.maxFrameBytes) {
        inflight.delete(key);
        return;
      }
    }

    // console.log(`[esp32UdpSource] received packet id=${id} index=${index}/${total} len=${payload.length} bytes`);
    // console.log(`[esp32UdpSource] frame id=${entry.id} received ${entry.received}/${entry.total} packets, ${entry.bytes} bytes so far`);

    // 收齐则拼接输出
    if (entry.received === entry.total) {
      console.log(
        `[esp32UdpSource] frame id=${entry.id} all packets received, assembling...`
      );
      const parts = new Array(entry.total);
      for (let i = 0; i < entry.total; i++) {
        const part = entry.chunks.get(i);
        if (!part) {
          // 理论上不会发生；兜底
          inflight.delete(key);
          return;
        }
        parts[i] = part;
      }
      const frame = Buffer.concat(parts, entry.bytes);
      inflight.delete(key);
      console.log(
        `[esp32UdpSource] assembled frame id=${entry.id} size=${frame.length} bytes`
      );
      pushFrame(frameChannel, entry.id, frame);
    }
  }

  function start(frameChannel) {
    if (running) return;
    if (!frameChannel)
      throw new Error(
        "[esp32UdpSource] start(frameChannel) requires a frameChannel"
      );

    socket = dgram.createSocket("udp4");

    socket.on("error", (err) => {
      console.error("[esp32UdpSource] socket error:", err);
    });

    socket.on("message", (msg /*, rinfo*/) => {
      try {
        // console.log("[esp32UdpSource] received udp packet, len=", msg.length);
        handlePacket(frameChannel, msg);
      } catch (e) {
        console.error("[esp32UdpSource] handle message error:", e);
      }
    });

    socket.bind(opts.port, opts.host, () => {
      running = true;
      const addr = socket.address();
      console.log(
        `[esp32UdpSource] Listening on udp://${addr.address}:${addr.port} (udp_packet_t, payload<=${opts.udpMaxPayload}) (${opts.width}x${opts.height}, codec=${opts.codec})`
      );
    });
  }

  function stop() {
    if (!running) return;
    running = false;

    inflight.clear();

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