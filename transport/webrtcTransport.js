const { Server } = require('socket.io');
const wrtc = require('wrtc');

/**
 * WebRTC transport (DataChannel, binary)
 * - socket.io: signaling only
 * - WebRTC DataChannel: frame data
 */
module.exports = function setupWebRTC(httpServer, frameChannel) {
  const io = new Server(httpServer, {
    path: '/webrtc-signal'
  });

  io.on('connection', (socket) => {
    console.log('[webrtc] signaling connected', socket.id);

    const pc = new wrtc.RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // ===== DataChannel =====
    let dc = null;
    let sending = false; // backpressure + drop

    pc.ondatachannel = (e) => {
      dc = e.channel;
      dc.binaryType = 'arraybuffer';

      dc.onopen = () => {
        console.log('[webrtc] datachannel open');
      };

      dc.onclose = () => {
        console.log('[webrtc] datachannel closed');
      };
    };

    // ===== frameChannel → WebRTC =====
    const onFrame = (frame) => {
      if (!dc || dc.readyState !== 'open') return;
      if (sending) return; // 丢帧（实时优先）

      sending = true;

      try {
        // 1️⃣ 先发 meta（小 JSON，完全可接受）
        dc.send(JSON.stringify({
          t: 'meta',
          frameId: frame.frameId,
          ts_src: frame.ts_src,
          codec: frame.codec,
          size: frame.data.length
        }));

        // 2️⃣ 再发 raw binary（核心）
        dc.send(frame.data);
      } catch (err) {
        console.warn('[webrtc] send error', err);
      } finally {
        sending = false;
      }
    };

    frameChannel.on('frame', onFrame);

    // ===== Signaling =====
    socket.on('offer', async (offer) => {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', answer);
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('ice', e.candidate);
      }
    };

    socket.on('ice', (candidate) => {
      pc.addIceCandidate(candidate);
    });

    socket.on('disconnect', () => {
      frameChannel.off('frame', onFrame);
      try { dc && dc.close(); } catch {}
      try { pc.close(); } catch {}
      console.log('[webrtc] disconnected', socket.id);
    });
  });
};
