const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

function createServer({ corsOrigin = "*" } = {}) {
  const app = express();
  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    cors: { origin: corsOrigin },
  });

  return { app, httpServer, io };
}

module.exports = { createServer };