module.exports = function setupSocket(io, frameChannel) {
  io.on('connection', (socket) => {
    console.log('[socket] connected', socket.id);

    const onFrame = (frame) => {
      socket.emit('frame', frame);
    };

    frameChannel.on('frame', onFrame);

    socket.on('disconnect', () => {
      frameChannel.off('frame', onFrame);
      console.log('[socket] disconnected', socket.id);
    });
  });
};
