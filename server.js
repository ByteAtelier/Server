const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const frameChannel = require('./channel/frameChannel');
// const setupSocket = require('./transport/socketTransport');
const setupWebRTCTransport = require('./transport/webrtcTransport');

// 启动帧源（现在是假流）
require('./source/imageLoopSource');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// setupSocket(io, frameChannel);
setupWebRTCTransport(io, frameChannel, {
  turn: {
    urls: [
      'turn:39.105.171.44:3478?transport=udp',
      'turn:39.105.171.44:3478?transport=tcp',
    ],
    username: 'BS-coturn',
    credential: 'DnDzRttdGVB25MntSpAEUDxrxvkwBjP8',
  },
  fps: 30,              // 建议先 15，后续可调 30
  singleClient: true,   // 单客户端保护（刷新/重连不会双路推）
});

server.listen(25565, () => {
  console.log('Server listening on 25565');
});
