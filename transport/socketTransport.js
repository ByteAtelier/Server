module.exports = function setupSocket(io, frameChannel) {
  let latestFrame = null;
  let sending = false;
  let connectedCount = 0;
  let lastFrameAt = null;

  frameChannel.on("frame", (frame) => {
    // 只保留最新一帧，旧的直接被覆盖
    latestFrame = frame;
    lastFrameAt = Date.now();
  });

  io.on("connection", (socket) => {
    console.log("[socket] connected", socket.id);
    connectedCount += 1;

    const loop = () => {
      if (!socket.connected) return;

      if (latestFrame && !sending) {
        const frame = latestFrame;
        latestFrame = null;
        sending = true;

        socket.volatile.emit("frame", frame);
        sending = false;
      }

      setImmediate(loop);
    };

    loop();

    socket.on("disconnect", () => {
      console.log("[socket] disconnected", socket.id);
      connectedCount = Math.max(0, connectedCount - 1);
    });
  });

  return {
    getStatus() {
      return {
        alive: true,
        connectedCount,
        hasLatestFrame: latestFrame !== null,
        sending,
        lastFrameAt,
      };
    },
  };
};
