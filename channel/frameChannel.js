const EventEmitter = require('events');

class FrameChannel extends EventEmitter {
  push(frame) {
    this.emit('frame', frame);
  }
}

module.exports = new FrameChannel();
