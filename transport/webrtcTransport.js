const wrtc = require("wrtc");
const jpeg = require("jpeg-js");

/**
 * RGBA -> I420 (YUV420p)
 */
function rgbaToI420(rgba, width, height) {
  const frameSize = width * height;
  const i420 = Buffer.allocUnsafe(frameSize + (frameSize >> 1));

  const yPlane = i420.subarray(0, frameSize);
  const uPlane = i420.subarray(frameSize, frameSize + (frameSize >> 2));
  const vPlane = i420.subarray(frameSize + (frameSize >> 2));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];

      let yy = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
      if (yy < 0) yy = 0;
      else if (yy > 255) yy = 255;
      yPlane[y * width + x] = yy;

      if (x % 2 === 0 && y % 2 === 0) {
        let uu = (-0.169 * r - 0.331 * g + 0.5 * b + 128) | 0;
        let vv = (0.5 * r - 0.419 * g - 0.081 * b + 128) | 0;
        if (uu < 0) uu = 0;
        else if (uu > 255) uu = 255;
        if (vv < 0) vv = 0;
        else if (vv > 255) vv = 255;

        const uvIndex = (y >> 1) * (width >> 1) + (x >> 1);
        uPlane[uvIndex] = uu;
        vPlane[uvIndex] = vv;
      }
    }
  }
  return i420;
}

module.exports = function setupWebRTCTransport(io, frameChannel, options = {}) {
  const fps = options.fps ?? 30;
  const singleClient = options.singleClient ?? true;

  const turn = options.turn || {};
  const iceServers = [
    {
      urls: turn.urls || [],
      username: turn.username,
      credential: turn.credential,
    },
  ];

  // 只保留最新 packet
  let latestPacket = null;
  frameChannel.on("frame", (pkt) => {
    if (!pkt || pkt.codec !== "jpeg" || !pkt.data) return;
    latestPacket = pkt;
  });

  let activeSocketId = null;

  io.on("connection", (socket) => {
    console.log("[signal] connected", socket.id);

    // 单客户端保护：新连接踢掉旧连接
    if (singleClient) {
      if (activeSocketId && activeSocketId !== socket.id) {
        const old = io.sockets.sockets.get(activeSocketId);
        if (old) {
          console.log("[signal] kicking old socket", activeSocketId);
          old.disconnect(true);
        }
      }
      activeSocketId = socket.id;
    }

    let pc = null;
    let videoSource = null;
    let videoTrack = null;
    let pumpTimer = null;

    const cleanup = () => {
      if (pumpTimer) clearInterval(pumpTimer);
      pumpTimer = null;
      try {
        videoTrack?.stop();
      } catch {}
      try {
        pc?.close();
      } catch {}
      pc = null;
      videoSource = null;
      videoTrack = null;
    };

    const startPump = () => {
      if (pumpTimer) return;
      const intervalMs = Math.floor(1000 / fps);

      pumpTimer = setInterval(() => {
        if (!videoSource) return;
        if (!latestPacket) return;

        const pkt = latestPacket;
        latestPacket = null;

        try {
          // pkt.data: Buffer / Uint8Array
          const decoded = jpeg.decode(pkt.data, { useTArray: true });
          const w = decoded.width;
          const h = decoded.height;

          const i420 = rgbaToI420(decoded.data, w, h);

          videoSource.onFrame({ width: w, height: h, data: i420 });
        } catch {
          // 解码失败丢帧
        }
      }, intervalMs);
    };

    socket.on("webrtc:offer", async (offer) => {
      cleanup();

      const newPc = new wrtc.RTCPeerConnection({ iceServers });
      pc = newPc;

      newPc.onicecandidate = ({ candidate }) => {
        if (candidate) socket.emit("webrtc:ice", candidate);
      };

      newPc.onconnectionstatechange = () => {
        console.log("[pc] state:", newPc.connectionState);
      };

      videoSource = new wrtc.nonstandard.RTCVideoSource();
      videoTrack = videoSource.createTrack();
      newPc.addTrack(videoTrack);

      socket.removeAllListeners("webrtc:ice");
      socket.on("webrtc:ice", async (candidate) => {
        try {
          await newPc.addIceCandidate(candidate);
        } catch {}
      });

      await newPc.setRemoteDescription(new wrtc.RTCSessionDescription(offer));
      const answer = await newPc.createAnswer();
      await newPc.setLocalDescription(answer);

      socket.emit("webrtc:answer", newPc.localDescription);

      startPump();
    });

    socket.on("disconnect", () => {
      console.log("[signal] disconnected", socket.id);
      if (singleClient && activeSocketId === socket.id) activeSocketId = null;
      cleanup();
    });
  });
};
