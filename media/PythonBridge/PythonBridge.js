// PythonBridge（Header v2：12B）
//
// 目标：Python 作为链路节拍；上游 > Python 时丢上游帧；不排队、不积压。
// 模型：push/onFrame（不提供 Promise / 帧级 RPC）。
//
// Header v2（12B，小而够用）：
// 0..3   frameId  u32 LE
// 4..11  tsMs     u64 LE（毫秒）
//
// Payload：固定长度 BGR24 = width * height * 3
//
// 项目风格：
// - 不做 >>>0 / &0xffff 这类“修正型转换”
// - 信任上游：不做层层拦截式校验
// - 输出端校验（fail-fast）：协议/对齐出问题直接抛异常，不吞错不自恢复

const { spawn } = require("child_process");
const path = require("path");

const HEADER_SIZE = 12;
const CHANNELS_BGR = 3;

class PythonBridge {
  constructor(opts = {}) {
    this.width = opts.width ?? 640;
    this.height = opts.height ?? 480;

    // 建议传入 venv 的 python 路径，避免污染 base 环境
    this.pythonBin = opts.pythonBin || "python";

    // Python 核心调度入口：默认同目录 index.py
    this.scriptPath = opts.scriptPath || path.join(__dirname, "index.py");
    this.scriptArgs = opts.scriptArgs || {};

    this.onLog = opts.onLog;

    // onFrame：Python 输出的“处理后完整图像（BGR24）”唯一出口，下游（编码/传输）从这里取帧
    this.onFrame = opts.onFrame;

    this._payloadLen = this.width * this.height * CHANNELS_BGR;

    this._proc = null;
    this._alive = false;
    this._startedAt = null;
    this._lastError = null;
    this._lastExit = null;

    // stdout 组包缓冲（header+payload 连续字节流）
    this._stdoutBuf = Buffer.alloc(0);

    // stdin 背压：write() 返回 false -> 等待 drain
    this._stdinDraining = false;

    // Python 为节拍：严格 1 in-flight；上游 > Python：mailbox 覆盖丢上游帧
    this._inFlight = false;
    this._mailbox = null; // { frameId, tsMs, frameBuf }

    this.stats = {
      inFrames: 0,
      overwritten: 0,
      sentFrames: 0,
      outFrames: 0,
    };
  }

  isAlive() {
    return this._alive && this._proc && !this._proc.killed;
  }

  start() {
    if (this._proc) return;

    const args = ["-u", this.scriptPath, "--w", String(this.width), "--h", String(this.height), ...this._buildScriptArgs()];
    const p = spawn(this.pythonBin, args, { stdio: ["pipe", "pipe", "pipe"] });

    this._proc = p;
    this._alive = true;
    this._startedAt = Date.now();
    this._lastError = null;
    this._lastExit = null;

    this.onLog(
      `[PythonBridge] start pythonBin=${this.pythonBin} scriptPath=${this.scriptPath} w=${this.width} h=${this.height} args=${JSON.stringify(this.scriptArgs)}`
    );

    p.on("error", (err) => {
      this._alive = false;
      this._lastError = err?.message || String(err);
      this.onLog(`[PythonBridge] process error: ${err?.message || err}`);
    });

    p.on("exit", (code, signal) => {
      this._alive = false;
      this._lastExit = {
        code,
        signal,
        at: Date.now(),
      };
      this.onLog(`[PythonBridge] python exited code=${code} signal=${signal}`);
    });

    p.stdout.on("data", (chunk) => {
      if (!chunk || chunk.length === 0) return;
      this._stdoutBuf = Buffer.concat([this._stdoutBuf, chunk]);
      this._drainStdout();
    });

    p.stderr.on("data", (chunk) => {
      const s = chunk.toString("utf8").trimEnd();
      if (s) this.onLog(`\n[python] ${s}`);
    });

    p.stdin.on("drain", () => {
      this._stdinDraining = false;
      this._trySendNext();
    });

    this._trySendNext();
  }

  _buildScriptArgs() {
    const cli = [];
    for (const [k, v] of Object.entries(this.scriptArgs)) {
      if (v === undefined || v === null) continue;
      const key = `--${String(k)}`;
      if (typeof v === "boolean") {
        if (v) cli.push(key);
        continue;
      }
      cli.push(key, String(v));
    }
    return cli;
  }

  stop() {
    if (!this._proc) return;

    try {
      this._proc.stdin.end();
    } catch (_) {}
    try {
      this._proc.kill("SIGTERM");
    } catch (_) {}

    this._proc = null;
    this._alive = false;

    this._stdoutBuf = Buffer.alloc(0);
    this._stdinDraining = false;

    this._inFlight = false;
    this._mailbox = null;

    this.onLog("[PythonBridge] stopped");
  }

  /**
  * pushFrame：推入一帧 BGR24
   * - 上游>Python：覆盖 mailbox（丢上游帧），不排队、不积压
   * - Python 为节拍：严格 1 in-flight
   *
   * 输出端校验（最小 framing 断言）：payload 长度不对会写坏协议流 => 直接抛异常
   */
  pushFrame({ frameId, tsMs, frameBuf }) {
    this.stats.inFrames++;

    if (!this.isAlive()) {
      throw new Error("[PythonBridge] pushFrame called but python process is not alive");
    }

    // 最小 framing 断言：不允许写坏协议流
    if (!Buffer.isBuffer(frameBuf)) {
      throw new TypeError("[PythonBridge] frameBuf must be a Buffer");
    }
    if (frameBuf.length !== this._payloadLen) {
      throw new RangeError(
        `[PythonBridge] bad frameBuf length=${frameBuf.length}, expected=${this._payloadLen}`
      );
    }

    // mailbox 覆盖：设计行为（丢上游帧）
    if (this._mailbox) this.stats.overwritten++;
    this._mailbox = { frameId, tsMs, frameBuf };

    this._trySendNext();
  }

  _trySendNext() {
    if (!this.isAlive()) return;
    if (!this._proc || !this._proc.stdin) return;

    if (this._inFlight) return;
    if (this._stdinDraining) return;
    if (!this._mailbox) return;

    const { frameId, tsMs, frameBuf } = this._mailbox;
    this._mailbox = null;

    const header = this._encodeHeader(frameId, tsMs);
    const packet = Buffer.concat([header, frameBuf]);

    this._inFlight = true;

    const ok = this._proc.stdin.write(packet);
    this.stats.sentFrames++;

    if (!ok) this._stdinDraining = true;
  }

  _encodeHeader(frameId, tsMs) {
    const b = Buffer.alloc(HEADER_SIZE);

    // u32 frameId：非法/越界 -> Node 直接抛 RangeError（fail-fast）
    b.writeUInt32LE(frameId, 0);

    // u64 tsMs（毫秒）：允许 number/bigint；不做“猜测修正”
    // - 若 tsMs 为 number（如 Date.now()），BigInt(tsMs) OK（毫秒 < 2^53）
    // - 若 tsMs 为 bigint，也 OK
    b.writeBigUInt64LE(typeof tsMs === "bigint" ? tsMs : BigInt(tsMs), 4);

    return b;
  }

  _decodeHeader(buf) {
    const frameId = buf.readUInt32LE(0);
    const tsMs = buf.readBigUInt64LE(4); // BigInt
    return { frameId, tsMs };
  }

  _drainStdout() {
    while (this._stdoutBuf.length >= HEADER_SIZE) {
      const h = this._decodeHeader(this._stdoutBuf);

      const need = HEADER_SIZE + this._payloadLen;
      if (this._stdoutBuf.length < need) return; // 等待更多数据

      const payload = this._stdoutBuf.subarray(HEADER_SIZE, need);
      this._stdoutBuf = this._stdoutBuf.subarray(need);

      // 一进一出：收到输出即认为 Python 可处理下一帧
      this._inFlight = false;
      this.stats.outFrames++;

      // 输出处理后的完整图像给下游（编码/传输）
      // 复制 Buffer：避免 payload 引用 stdoutBuf 切片导致的生命周期问题
      this.onFrame({
        frameId: h.frameId,
        tsMs: h.tsMs, // BigInt（如需 number：Number(h.tsMs)；毫秒范围内安全）
        frameBuf: Buffer.from(payload),
      });

      // 以 Python 输出节拍驱动下一次输入
      this._trySendNext();
    }
  }

  getStatus() {
    return {
      alive: this.isAlive(),
      pid: this._proc ? this._proc.pid : null,
      startedAt: this._startedAt,
      lastError: this._lastError,
      lastExit: this._lastExit,
      width: this.width,
      height: this.height,
      payloadLen: this._payloadLen,
      pythonBin: this.pythonBin,
      scriptPath: this.scriptPath,
      scriptArgs: this.scriptArgs,
      inFlight: this._inFlight,
      stdinDraining: this._stdinDraining,
      mailboxPending: this._mailbox !== null,
      stats: {
        inFrames: this.stats.inFrames,
        overwritten: this.stats.overwritten,
        sentFrames: this.stats.sentFrames,
        outFrames: this.stats.outFrames,
      },
    };
  }
}

module.exports = PythonBridge;