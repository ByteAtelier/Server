const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SUPPORTED_EXT = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp"]);

function createImageLoopSource(defaultOpts = {}) {
  const opts = {
    imageDir:
      defaultOpts.imageDir ??
      path.join(
        "D:\\Code\\BrightSmile\\AI\\datas\\Benchmarking Dataset\\train",
        "images",
      ),
    fps: defaultOpts.fps ?? 30,
    width: defaultOpts.width ?? 640,
    height: defaultOpts.height ?? 480,
    jpegQuality: defaultOpts.jpegQuality ?? 80,
  };

  const intervalMs = Math.floor(1000 / opts.fps);

  let frameId = 0;
  let index = 0;
  let timer = null;
  let running = false;
  let lastFrameAt = null;

  const files = fs
    .readdirSync(opts.imageDir)
    .filter((f) => SUPPORTED_EXT.has(path.extname(f).toLowerCase()));

  console.log(
    `[imageLoopSource] Loaded ${files.length} images from ${opts.imageDir}`,
  );

  async function resizeImage(buffer) {
    return sharp(buffer)
      .resize(opts.width, opts.height, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0 },
      })
      .jpeg({ quality: opts.jpegQuality })
      .toBuffer();
  }

  async function pushNextFrame(frameChannel) {
    const file = files[index];
    const filePath = path.join(opts.imageDir, file);

    const raw = fs.readFileSync(filePath);
    const resized = await resizeImage(raw);

    frameChannel.push({
      frameId: frameId++,
      ts_src: Date.now(),
      codec: "jpeg",
      width: opts.width,
      height: opts.height,
      data: resized,
    });

    lastFrameAt = Date.now();

    index = (index + 1) % files.length;
  }

  function start(frameChannel) {
    if (timer) return;
    if (!frameChannel)
      throw new Error(
        "[imageLoopSource] start(frameChannel) requires a frameChannel",
      );

    timer = setInterval(() => {
      pushNextFrame(frameChannel).catch((err) => {
        console.error("[imageLoopSource] resize error:", err);
      });
    }, intervalMs);

    running = true;

    console.log(
      `[imageLoopSource] Started @ ${opts.fps} FPS (${opts.width}x${opts.height})`,
    );
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    running = false;
    console.log("[imageLoopSource] Stopped");
  }

  function getStatus() {
    return {
      alive: running,
      running,
      frameId,
      lastFrameAt,
      index,
      fileCount: files.length,
      params: {
        imageDir: opts.imageDir,
        fps: opts.fps,
        width: opts.width,
        height: opts.height,
        jpegQuality: opts.jpegQuality,
      },
    };
  }

  return { start, stop, getStatus };
}

module.exports = { createImageLoopSource };
