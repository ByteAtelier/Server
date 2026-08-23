const { spawn } = require("child_process");

class FrpProcessor {
  constructor(sourceType) {
    this._proc = null;
    this.running = false;
    this.sourceType = sourceType;
  }

  start() {
    if (this._proc) return;
    console.log(`[FrpProcessor] Starting frp process...`);
    this._proc = spawn(
      "./frp/frpc.exe",
      ["-c", `./frp/frpc_${this.sourceType}.ini`],
      { stdio: "inherit" },
    );
    this.running = true;
  }

  stop() {
    if (this._proc) {
      this._proc.kill("SIGKILL");
      this._proc = null;
      this.running = false;
      console.log(`[FrpProcessor] Stopped`);
    }
  }

  getStatus() {
    return {
      running: this.running,
    };
  }
}

module.exports = FrpProcessor;
