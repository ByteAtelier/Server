const path = require("path");

const APP_CONFIG = {
  server: {
    port: 3000,
  },
  media: {
    fps: 30,
    width: 640,
    height: 480,
    pythonBridge: {
      pythonBin: "D:\\anaconda3\\envs\\yolo-cpu\\python.exe",
      scriptPath: path.join(
        __dirname,
        "..",
        "media",
        "PythonBridge",
        "index.py",
      ),
      scriptArgs: {
        model: path.join(
          __dirname,
          "..",
          "media",
          "PythonBridge",
          "weights",
          "tooth_seg_n_640.pt",
        ),
        imgsz: 640,
        conf: 0.25,
        iou: 0.45,
        "max-det": 100,
        // device: "cuda:0",
        "mask-alpha": 0.45,
      },
    },
  },
  webrtc: {
    fps: 30,
    singleClient: true,
    turn: {
      urls: [
        "turn:39.105.171.44:3478?transport=udp",
        "turn:39.105.171.44:3478?transport=tcp",
      ],
      username: "BS-coturn",
      credential: "DnDzRttdGVB25MntSpAEUDxrxvkwBjP8",
    },
  },
  dashboard: {
    defaultIntervalMs: 1000,
    moduleAliveMs: 3000,
  },
  source: {
    // 可选: "imageLoop" | "esp32Udp"
    type: "esp32Udp",
    imageLoop: {
      fps: 10,
      imageDir: "D:\\Code\\BrightSmile\\AI\\datas\\video",
      jpegQuality: 80,
    },
    esp32Udp: {
      host: "0.0.0.0",
      port: 50000,
      codec: "jpeg",
      headerBytes: 16,
      udpMaxPayload: 1024,
      logEveryMs: 1000,
    },
  },
};

module.exports = APP_CONFIG;
