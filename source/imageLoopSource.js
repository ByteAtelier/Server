const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const frameChannel = require('../channel/frameChannel');

const IMAGE_DIR = path.join(
  'D:\\Code\\BrightSmile\\AI\\datas\\Benchmarking Dataset\\train',
  'images'
);

const FPS = 30;
const INTERVAL = 1000 / FPS;

const TARGET_WIDTH = 640;
const TARGET_HEIGHT = 480;

const SUPPORTED_EXT = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp']);

let frameId = 0;

const files = fs.readdirSync(IMAGE_DIR)
  .filter(f => SUPPORTED_EXT.has(path.extname(f).toLowerCase()));

let index = 0;
let timer = null;

console.log(`[imageLoopSource] Loaded ${files.length} images`);

/**
 * sharp resize（纯内存）
 */
async function resizeImage(buffer) {
  return sharp(buffer)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0 }
    })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function pushNextFrame() {
  const file = files[index];
  const filePath = path.join(IMAGE_DIR, file);

  const raw = fs.readFileSync(filePath);
  const resized = await resizeImage(raw);

  frameChannel.push({
    frameId: frameId++,
    ts_src: Date.now(),
    codec: 'jpeg',
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    data: resized
  });

  index = (index + 1) % files.length;
}

function start() {
  if (timer) return;

  timer = setInterval(() => {
    // 防止 async 抛到外面
    pushNextFrame().catch(err => {
      console.error('[imageLoopSource] resize error:', err);
    });
  }, INTERVAL);

  console.log(`[imageLoopSource] Started @ ${FPS} FPS (${TARGET_WIDTH}x${TARGET_HEIGHT})`);
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  console.log('[imageLoopSource] Stopped');
}

// 自动启动
start();

module.exports = {
  start,
  stop
};
