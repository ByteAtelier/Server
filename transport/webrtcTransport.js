const wrtc = require("wrtc");

module.exports = function setupWebRTCTransport(io, frameChannel, videoWidth, videoHeight, options = {}) {
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
  frameChannel.on("frame", () => {
    const pkt = frameChannel.getLatest();
    if (!pkt || !pkt.data) return;
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
      console.log("[webrtc] startPump fps=", fps);
      if (pumpTimer) return;
      const intervalMs = Math.floor(1000 / fps);

      pumpTimer = setInterval(() => {
        if (!videoSource) return;
        if (!latestPacket) return;

        const pkt = latestPacket;
        latestPacket = null;
        try {
          // pkt.data: Buffer / Uint8Array
          videoSource.onFrame({
            ts_src: pkt.ts_src,
            data: pkt.data,
            width: videoWidth,
            height: videoHeight,
          });
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
