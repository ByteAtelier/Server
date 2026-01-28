# ByteAtelier Server

Node.js server for ingesting image frames and streaming them to WebRTC clients over Socket.IO.
It includes two frame sources (image loop and ESP32 UDP) and a media processing pipeline that
broadcasts frames to connected clients.

## Requirements

- Node.js and npm
- Native build tooling for dependencies such as `sharp`

## Quick start

```bash
npm install
node main.js
```

The server listens on `http://localhost:3000` by default. Set `PORT` to change the port:

```bash
PORT=4000 node main.js
```

## Configuration

All runtime configuration is currently in `main.js`:

- **Frame source**
  - `createImageLoopSource`: loops through images from `imageDir` and resizes them to the
    configured width/height. Update `imageDir`, `fps`, `width`, and `height` as needed.
  - `createEsp32UdpSource`: enable the ESP32 UDP source by uncommenting its block and
    configuring `host`, `port`, and frame metadata.
- **WebRTC transport**
  - Update the TURN server settings in the `setupWebRTCTransport` call.

## Project layout

- `main.js` – application entry point
- `server/` – Express + Socket.IO server setup
- `source/` – frame sources (image loop, ESP32 UDP)
- `transport/` – WebRTC transport
- `media/` – media processing pipeline
- `test/` – HTML pages for manual testing

## Manual testing

Open the HTML files in `test/` (for example, `test/webrtc.html`) in a browser while the server
is running to verify video streaming.
