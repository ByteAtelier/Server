const fs = require('fs');
const path = require('path');
const frameChannel = require('../channel/frameChannel');

const IMAGE_DIR = path.join('D:\\Code\\BrightSmile\\AI\\datas\\Benchmarking Dataset\\train', 'images');
const FPS = 30;
const INTERVAL = 1000 / FPS;

const SUPPORTED_EXT = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp']);

let frameId = 0;

const files = fs.readdirSync(IMAGE_DIR)
  .filter(f => SUPPORTED_EXT.has(path.extname(f).toLowerCase()));

let index = 0;

console.log(`[imageLoopSource] Loaded ${files.length} images`);

let timer = null;

function pushNextFrame() {
  const file = files[index];

  frameChannel.push({
    frameId: frameId++,
    ts_src: Date.now(),
    codec: path.extname(file).slice(1),
    data: fs.readFileSync(path.join(IMAGE_DIR, file))
  });

  index = (index + 1) % files.length;
}

/**
 * 启动帧循环
 */
function start() {
  if (timer) return;
  timer = setInterval(pushNextFrame, INTERVAL);
  console.log(`[imageLoopSource] Started @ ${FPS} FPS`);
}

/**
 * 停止（调试用）
 */
function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  console.log('[imageLoopSource] Stopped');
}

// 自动启动
start();

// 导出（方便未来控制）
module.exports = {
  start,
  stop
};