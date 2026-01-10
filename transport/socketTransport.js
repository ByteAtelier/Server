module.exports = function setupSocket(io, frameChannel) {
  let latestFrame = null;
  let sending = false;

  frameChannel.on('frame', (frame) => {
    // 只保留最新一帧，旧的直接被覆盖
    latestFrame = frame;
  });

  io.on("connection", (socket) => {
    console.log("[socket] connected", socket.id);

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
    });
  });
};
