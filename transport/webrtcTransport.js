const wrtc = require("wrtc");

module.exports = function setupWebRTCTransport(
  io,
  frameChannel,
  videoWidth,
  videoHeight,
  options = {},
) {
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
  let socketConnectionCount = 0;
  let signalSocketCount = 0;
  let lastOfferAt = null;
  let lastConnectionState = "new";
  let hasActivePeer = false;

  io.on("connection", (socket) => {
    console.log("\n[signal] connected", socket.id);
    socketConnectionCount += 1;
    let isSignalParticipant = false;

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
      hasActivePeer = false;
      lastConnectionState = "closed";
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
      if (!isSignalParticipant) {
        isSignalParticipant = true;
        signalSocketCount += 1;
      }
      // 单客户端保护：仅对真正发起 WebRTC 的连接生效，避免误伤 dashboard/socket 连接
      if (singleClient && activeSocketId && activeSocketId !== socket.id) {
        const old = io.sockets.sockets.get(activeSocketId);
        if (old) {
          console.log("\n[signal] kicking old socket", activeSocketId);
          old.disconnect(true);
        }
      }
      if (singleClient) activeSocketId = socket.id;
      lastOfferAt = Date.now();

      cleanup();

      const newPc = new wrtc.RTCPeerConnection({ iceServers });
      pc = newPc;

      newPc.onicecandidate = ({ candidate }) => {
        if (candidate) socket.emit("webrtc:ice", candidate);
      };

      newPc.onconnectionstatechange = () => {
        console.log("[pc] state:", newPc.connectionState);
        lastConnectionState = newPc.connectionState;
        hasActivePeer =
          newPc.connectionState === "connecting" ||
          newPc.connectionState === "connected";
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
      console.log("\n[signal] disconnected", socket.id);
      socketConnectionCount = Math.max(0, socketConnectionCount - 1);
      if (isSignalParticipant) {
        signalSocketCount = Math.max(0, signalSocketCount - 1);
      }
      if (singleClient && activeSocketId === socket.id) activeSocketId = null;
      cleanup();
    });
  });

  return {
    getStatus() {
      return {
        alive: true,
        socketConnectionCount,
        signalSocketCount,
        activeSocketId,
        lastOfferAt,
        lastConnectionState,
        hasActivePeer,
        params: {
          fps,
          singleClient,
          videoWidth,
          videoHeight,
          turnUrls: turn.urls || [],
        },
      };
    },
  };
};
