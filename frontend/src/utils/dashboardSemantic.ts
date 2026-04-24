import type { DashboardConfig } from '../types/dashboard';

export interface SemanticEntry {
  keyPath: string;
  label: string;
  value: string;
}

const NAME_MAP: Record<string, string> = {
  type: '类型',
  ts: '采样时间',
  uptimeMs: '系统运行时长',
  uptimeSec: '进程运行时长',
  process: '进程信息',
  memory: '内存',
  rss: '驻留内存 RSS',
  heapTotal: '堆内存总量',
  heapUsed: '堆内存已用',
  external: '外部内存',
  server: '服务端',
  connectedClients: '连接客户端数',
  ingest: '输入链路',
  fps: '帧率 FPS',
  totalFrames: '累计帧数',
  lastFrameId: '最新帧 ID',
  lastTsSrc: '最新源时间戳',
  video: '输出链路',
  latencyMs: '端到端延迟',
  latestMs: '最新延迟',
  averageMs: '平均延迟',
  p95Ms: 'P95 延迟',
  p99Ms: 'P99 延迟',
  modules: '模块状态',
  alive: '存活状态',
  lastSeenAt: '最后活跃时间',
  startedAt: '启动时间',
  defaultIntervalMs: '默认推送间隔',
  moduleAliveMs: '模块超时阈值',
  subscriberCount: '订阅者数量',
  listening: '监听状态',
  source: '数据源',
  running: '运行状态',
  frameId: '帧 ID',
  lastFrameAt: '最新帧时间',
  index: '图片索引',
  fileCount: '图片总数',
  bound: 'UDP 绑定状态',
  mediaProcessor: '媒体处理器',
  timestamp: '时间戳',
  cpuPercent: 'CPU 使用率',
  eventLoopLagMs: '事件循环延迟',
  meanMs: '平均延迟',
  decoder: '解码器',
  encoder: '编码器',
  pythonBridge: 'Python 桥接',
  inFlight: '在途请求',
  stdinDraining: '输入缓冲排空',
  mailboxPending: '邮箱待处理',
  stats: '统计信息',
  inFrames: '输入帧',
  overwritten: '覆盖帧',
  sentFrames: '发送帧',
  outFrames: '输出帧',
  webrtc: 'WebRTC',
  signalSocketCount: '信令连接数',
  socketConnectionCount: 'Socket 连接数',
  activeSocketId: '当前会话 ID',
  lastOfferAt: '最近 Offer 时间',
  lastConnectionState: '连接状态',
  hasActivePeer: '活跃对端',
  media: '媒体参数',
  width: '宽度',
  height: '高度',
  imageLoop: '图片轮播源',
  esp32Udp: 'ESP32 UDP 源',
  jpegQuality: 'JPEG 质量',
  port: '端口',
  host: '主机',
  codec: '编码格式',
  headerBytes: '头字节数',
  udpMaxPayload: 'UDP 最大负载',
  windowRecvCount: '窗口接收帧数',
  windowDropCount: '窗口丢弃数',
  windowFps: '窗口 FPS',
  windowDropPct: '窗口丢包占比',
  windowTopDropReasons: '窗口主要丢包原因',
  totalRecvCount: '累计接收帧数',
  totalDropCount: '累计丢弃数',
  totalDropReasons: '累计丢包原因',
  reason: '原因',
  count: '次数',
  hasLatestFrame: '存在最新帧',
  corsOrigin: 'CORS 来源',
  singleClient: '单客户端模式',
  yolo: 'YOLO 参数',
  imgsz: '推理尺寸',
  conf: '置信度阈值',
  iou: 'IoU 阈值',
  maxDet: '最大检测数',
  maskAlpha: '掩码透明度',
  dashboard: '面板参数',
  ingestBus: '输入总线',
  videoBus: '视频总线',
};

const BOOL_TEXT_MAP: Record<string, { yes: string; no: string }> = {
  alive: { yes: '存活 √', no: '离线 ×' },
  listening: { yes: '监听中 √', no: '未监听 ×' },
  running: { yes: '运行中 √', no: '已停止 ×' },
  bound: { yes: '已绑定 √', no: '未绑定 ×' },
  hasActivePeer: { yes: '已连接 √', no: '未连接 ×' },
  hasLatestFrame: { yes: '有最新帧 √', no: '无最新帧 ×' },
  singleClient: { yes: '是', no: '否' },
  inFlight: { yes: '是', no: '否' },
  stdinDraining: { yes: '是', no: '否' },
  mailboxPending: { yes: '是', no: '否' },
};

const BYTE_KEYS = new Set(['rss', 'heapTotal', 'heapUsed', 'external']);
const TIME_KEYS = new Set(['ts', 'lastSeenAt', 'startedAt', 'lastTsSrc', 'lastOfferAt', 'lastFrameAt', 'timestamp']);

function prettySegment(segment: string): string {
  return NAME_MAP[segment] ?? segment;
}

function normalizePath(path: string): string {
  return path.replace(/\.(\[\d+\])/g, '$1');
}

function splitPath(path: string): string[] {
  if (!path) return [];
  const tokens = path.match(/[^.[\]]+|\[\d+\]/g);
  return tokens ?? [];
}

function joinLabel(path: string): string {
  const parts = splitPath(path).map((part) => {
    if (part.startsWith('[')) return part;
    return prettySegment(part);
  });
  return parts.join(' / ');
}

function formatByKey(key: string, value: unknown): string {
  if (value === null) return '-';

  if (typeof value === 'boolean') {
    const mapped = BOOL_TEXT_MAP[key];
    if (mapped) return value ? mapped.yes : mapped.no;
    return value ? '是' : '否';
  }

  if (typeof value === 'number') {
    if (key === 'cpuPercent') {
      return `${value.toFixed(2)} %`;
    }
    if (key === 'latestMs' || key === 'averageMs' || key === 'p95Ms' || key === 'p99Ms' || key === 'meanMs') {
      return `${value.toFixed(2)} ms`;
    }
    if (BYTE_KEYS.has(key)) {
      const mb = (value / 1024 / 1024).toFixed(2);
      return `${mb} MB`;
    }
    if (key === 'uptimeMs' || key === 'uptimeSec') {
      // 优先用 ms，若大于1h则 h m s，否则 m s
      const totalSec = Math.max(0, Math.floor(key === 'uptimeMs' ? value / 1000 : value));
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      let str = '';
      if (h > 0) str += `${h}h`;
      if (m > 0 || h > 0) str += `${m}m`;
      str += `${s}s`;
      return str;
    }
    if (TIME_KEYS.has(key)) {
      return `${new Date(value).toLocaleString()}`;
    }
    return String(value);
  }

  if (typeof value === 'string') {
    if (key === 'type') {
      if (value === 'imageLoop') return '图片轮播源';
      if (value === 'esp32Udp') return 'ESP32 UDP 源';
      if (value === 'dashboard:update') return '实时状态更新';
      if (value === 'dashboard:config') return '配置快照';
    }
    return value;
  }

  if (Array.isArray(value) && value.length === 0) return '[]';
  if (typeof value === 'object' && value && Object.keys(value).length === 0) return '{}';

  return JSON.stringify(value);
}

export function flattenSemanticEntries(value: unknown, path = ''): SemanticEntry[] {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    const safePath = normalizePath(path || 'value');
    const key = splitPath(safePath).slice(-1)[0] ?? safePath;
    return [
      {
        keyPath: safePath,
        label: joinLabel(safePath),
        value: formatByKey(key, value),
      },
    ];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      const safePath = normalizePath(path || 'value');
      return [{ keyPath: safePath, label: joinLabel(safePath), value: '[]' }];
    }
    return value.flatMap((item, index) => {
      const nextPath = path ? `${path}[${index}]` : `[${index}]`;
      return flattenSemanticEntries(item, nextPath);
    });
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    const safePath = normalizePath(path || 'value');
    return [{ keyPath: safePath, label: joinLabel(safePath), value: '{}' }];
  }

  return entries.flatMap(([key, nested]) => {
    const nextPath = path ? `${path}.${key}` : key;
    return flattenSemanticEntries(nested, nextPath);
  });
}

export function sourceConfigForDisplay(config: unknown): unknown {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;

  const source = config as Record<string, unknown>;
  const sourceType = source.type === 'imageLoop' || source.type === 'esp32Udp' ? source.type : null;
  if (!sourceType) return source;

  const result: Record<string, unknown> = { type: source.type };
  Object.entries(source).forEach(([key, val]) => {
    if (key === 'type' || key === 'imageLoop' || key === 'esp32Udp') return;
    result[key] = val;
  });
  result[sourceType] = source[sourceType];
  return result;
}

export function moduleTitle(moduleName: string): string {
  return prettySegment(moduleName);
}

export function statusSectionTitle(sectionName: string): string {
  return prettySegment(sectionName);
}

export function configModuleEntries(moduleName: string, moduleConfig: unknown): SemanticEntry[] {
  if (moduleName === 'source') {
    return flattenSemanticEntries(sourceConfigForDisplay(moduleConfig), 'source');
  }
  return flattenSemanticEntries(moduleConfig, moduleName);
}

export function statusSectionEntries(sectionName: string, sectionValue: unknown): SemanticEntry[] {
  return flattenSemanticEntries(sectionValue, sectionName);
}

export function configModuleMap(config: DashboardConfig): Array<{ moduleName: string; entries: SemanticEntry[] }> {
  return Object.entries(config).map(([moduleName, moduleConfig]) => ({
    moduleName,
    entries: configModuleEntries(moduleName, moduleConfig),
  }));
}
