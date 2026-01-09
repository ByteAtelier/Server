const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const frameChannel = require('./channel/frameChannel');
const setupSocket = require('./transport/socketTransport');

// 启动帧源（现在是假流）
require('./source/imageLoopSource');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

setupSocket(io, frameChannel);

server.listen(25565, () => {
  console.log('Server listening on 25565');
});
