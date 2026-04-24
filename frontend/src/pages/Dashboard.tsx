import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Drawer,
  Empty,
  Segmented,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DashboardOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  PageContainer,
  ProCard,
  ProDescriptions,
  StatisticCard,
} from '@ant-design/pro-components';
import { Column, Line } from '@ant-design/plots';
import { getSocket } from '../services/socket';
import type {
  DashboardConfig,
  DashboardConfigPayload,
  DashboardRequestPayload,
  DashboardUpdatePayload,
} from '../types/dashboard';
import {
  configModuleMap,
  moduleTitle,
  statusSectionEntries,
  statusSectionTitle,
  flattenSemanticEntries,
} from '../utils/dashboardSemantic';
import type { SemanticEntry } from '../utils/dashboardSemantic';
import {
  readPath,
  toNumber,
  toStringValue,
  toBoolean,
  fpsLevel,
  splitStatusModules,
  stripLeadingPrefix,
  buildDescriptionSchema,
  type DescriptionSchema,
} from '../utils/dashboardView';
import styles from './Dashboard.module.less';

interface ActiveModuleDetail {
  moduleName: string;
  moduleData: unknown;
}

interface ModuleStatePoint {
  alive: boolean;
  lastSeenAt: number | null;
}

interface TrendPoint {
  ts: number;
  ingestFps: number;
  videoFps: number;
  latencyLatest: number | null;
  latencyAverage: number | null;
  latencyP95: number | null;
  latencyP99: number | null;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  cpuPercent: number | null;
  eventLoopLagMean: number | null;
  sourceFrames: number | null;
  ingestFrames: number;
  pythonInFrames: number | null;
  pythonSentFrames: number | null;
  pythonOutFrames: number | null;
  videoFrames: number;
  esp32WindowRecvCount: number | null;
  esp32WindowDropCount: number | null;
  esp32WindowDropPct: number | null;
  modules: Record<string, ModuleStatePoint>;
}

interface ModuleHealthRow {
  key: string;
  moduleName: string;
  status: '在线' | '离线' | '未知';
  flapping: '否' | '轻微' | '是';
  reconnectCount: number;
  timeoutCount: number;
}

type DrawerTabKey = 'overview' | 'stats' | 'raw';

interface MetricCardItem {
  key: string;
  title: React.ReactNode;
  value: number | string;
  suffix?: string;
  valueStyle?: React.CSSProperties;
}

interface RuntimeSection {
  sectionName: string;
  title: string;
  schema: DescriptionSchema;
}

const TREND_WINDOW_MS = 60 * 1000;
const FIDELITY_WINDOW_MS = 60 * 1000;

const MODULE_ORDER = [
  'ingestBus',
  'videoBus',
  'source',
  'mediaProcessor',
  'pythonBridge',
  'webrtc',
  'dashboard',
  'server',
] as const;

function formatTimeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function safeDelta(current: number | null, baseline: number | null): number {
  if (current == null || baseline == null) return 0;
  const value = current - baseline;
  return value > 0 ? value : 0;
}

function toMb(bytes: number | null): number {
  if (bytes == null) return 0;
  return Number((bytes / 1024 / 1024).toFixed(2));
}

function percentile(samples: number[], ratio: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return Number(sorted[index].toFixed(2));
}

function calcLatencyStats(samples: number[]): {
  average: number | null;
  p95: number | null;
  p99: number | null;
} {
  if (samples.length === 0) {
    return {
      average: null,
      p95: null,
      p99: null,
    };
  }

  const sum = samples.reduce((acc, value) => acc + value, 0);
  return {
    average: Number((sum / samples.length).toFixed(2)),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
  };
}

const metricValueStyle: React.CSSProperties = {
  whiteSpace: 'normal',
  wordBreak: 'break-word',
  lineHeight: 1.2,
};

const DEMO_COLOR_RANGE = ['#30BF78', '#F4664A', '#FAAD14'];
const DEMO_COLOR_RANGE_EXTENDED = ['#30BF78', '#F4664A', '#FAAD14', '#5B8FF9'];
const DEMO_COLOR_RANGE_RUNTIME = ['#30BF78', '#F4664A'];

function moduleStatusTag(moduleData: unknown): {
  text: string;
  color: 'default' | 'success' | 'error';
} {
  const alive = toBoolean(readPath(moduleData, ['alive']));
  if (alive === true) return { text: '正常', color: 'success' };
  if (alive === false) return { text: '离线', color: 'error' };
  return { text: '未知', color: 'default' };
}

function metricTitle(
  text: string,
  tagText?: string,
  tagColor?: string,
): React.ReactNode {
  return (
    <div className={styles.wrapInline}>
      <Typography.Text className={styles.wrapText}>{text}</Typography.Text>
      {tagText && <Tag color={tagColor}>{tagText}</Tag>}
    </div>
  );
}

function moduleSummary(moduleName: string, moduleData: unknown): string {
  if (moduleName === 'pythonBridge') {
    const overwritten = toNumber(
      readPath(moduleData, ['stats', 'overwritten']),
    );
    return `覆盖帧：${overwritten === null ? '-' : overwritten}`;
  }

  if (moduleName === 'webrtc') {
    const state =
      toStringValue(readPath(moduleData, ['lastConnectionState'])) ?? 'unknown';
    return `连接状态：${state}`;
  }

  const fps = toNumber(readPath(moduleData, ['fps']));
  if (fps !== null) {
    return `帧率：${fps.toFixed(2)} FPS`;
  }

  const ts =
    toNumber(readPath(moduleData, ['lastSeenAt'])) ??
    toNumber(readPath(moduleData, ['lastOfferAt'])) ??
    toNumber(readPath(moduleData, ['startedAt']));
  if (ts !== null) {
    return `最近时间：${new Date(ts).toLocaleTimeString()}`;
  }

  return '点击查看字段详情';
}

const Dashboard: React.FC = () => {
  const [status, setStatus] = useState<DashboardUpdatePayload | null>(null);
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [trendHistory, setTrendHistory] = useState<TrendPoint[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [intervalMs, setIntervalMs] = useState(1000);
  const [activeModule, setActiveModule] = useState<ActiveModuleDetail | null>(
    null,
  );
  const [drawerTab, setDrawerTab] = useState<DrawerTabKey>('overview');

  const buildTrendPoint = (
    payload: DashboardUpdatePayload,
    history: TrendPoint[],
  ): TrendPoint => {
    const moduleStates: Record<string, ModuleStatePoint> = {};
    splitStatusModules(payload.modules).forEach(
      ({ moduleName, moduleData }) => {
        const alive = toBoolean(readPath(moduleData, ['alive']));
        const lastSeenAt =
          toNumber(readPath(moduleData, ['lastSeenAt'])) ??
          toNumber(readPath(moduleData, ['lastOfferAt'])) ??
          toNumber(readPath(moduleData, ['startedAt'])) ??
          null;
        moduleStates[moduleName] = {
          alive: alive === true,
          lastSeenAt,
        };
      },
    );

    const pythonStatsBase = ['modules', 'pythonBridge', 'stats'] as const;
    const pythonLegacyBase = [
      'modules',
      'mediaProcessor',
      'pythonBridge',
      'stats',
    ] as const;
    const latencyLatest = toNumber(
      readPath(payload, ['video', 'latencyMs', 'latestMs']),
    );
    const latencySamples = history
      .filter((point) => point.ts >= payload.ts - TREND_WINDOW_MS)
      .map((point) => point.latencyLatest)
      .filter((value): value is number => value !== null);

    if (latencyLatest !== null) {
      latencySamples.push(latencyLatest);
    }

    const latencyStats = calcLatencyStats(latencySamples);

    return {
      ts: payload.ts,
      ingestFps: payload.ingest.fps,
      videoFps: payload.video.fps,
      latencyLatest,
      latencyAverage: latencyStats.average,
      latencyP95: latencyStats.p95,
      latencyP99: latencyStats.p99,
      rssMb: toMb(toNumber(readPath(payload, ['process', 'memory', 'rss']))),
      heapUsedMb: toMb(
        toNumber(readPath(payload, ['process', 'memory', 'heapUsed'])),
      ),
      heapTotalMb: toMb(
        toNumber(readPath(payload, ['process', 'memory', 'heapTotal'])),
      ),
      cpuPercent: toNumber(readPath(payload, ['process', 'cpuPercent'])),
      eventLoopLagMean: toNumber(
        readPath(payload, ['process', 'eventLoopLagMs', 'meanMs']),
      ),
      sourceFrames:
        toNumber(readPath(payload, ['modules', 'source', 'frameId'])) ??
        toNumber(readPath(payload, ['modules', 'source', 'lastFrameId'])),
      ingestFrames: payload.ingest.totalFrames,
      pythonInFrames:
        toNumber(readPath(payload, [...pythonStatsBase, 'inFrames'])) ??
        toNumber(readPath(payload, [...pythonLegacyBase, 'inFrames'])),
      pythonSentFrames:
        toNumber(readPath(payload, [...pythonStatsBase, 'sentFrames'])) ??
        toNumber(readPath(payload, [...pythonLegacyBase, 'sentFrames'])),
      pythonOutFrames:
        toNumber(readPath(payload, [...pythonStatsBase, 'outFrames'])) ??
        toNumber(readPath(payload, [...pythonLegacyBase, 'outFrames'])),
      videoFrames: payload.video.totalFrames,
      esp32WindowRecvCount: toNumber(
        readPath(payload, ['modules', 'source', 'windowRecvCount']),
      ),
      esp32WindowDropCount: toNumber(
        readPath(payload, ['modules', 'source', 'windowDropCount']),
      ),
      esp32WindowDropPct: toNumber(
        readPath(payload, ['modules', 'source', 'windowDropPct']),
      ),
      modules: moduleStates,
    };
  };

  const statusModules = splitStatusModules(status?.modules);

  const ingestFps = toNumber(status?.ingest?.fps);
  const videoFps = toNumber(status?.video?.fps);
  const latestTrendPoint =
    trendHistory.length > 0 ? trendHistory[trendHistory.length - 1] : null;
  const avgLatencyMs =
    latestTrendPoint?.latencyAverage ??
    toNumber(status?.video?.latencyMs?.latestMs);
  const p95LatencyMs =
    latestTrendPoint?.latencyP95 ?? toNumber(status?.video?.latencyMs?.p95Ms);
  const cpuPercent =
    latestTrendPoint?.cpuPercent ?? toNumber(status?.process?.cpuPercent);
  const rssBytes = toNumber(status?.process?.memory?.rss);
  const rssMb =
    latestTrendPoint?.rssMb ?? (rssBytes === null ? null : toMb(rssBytes));
  const connectedClients = toNumber(status?.server?.connectedClients);
  const webrtcConnectionCount =
    toNumber(readPath(status, ['modules', 'webrtc', 'signalSocketCount'])) ??
    toNumber(
      readPath(status, ['modules', 'webrtc', 'socketConnectionCount']),
    ) ??
    (toBoolean(readPath(status, ['modules', 'webrtc', 'hasActivePeer']))
      ? 1
      : 0);

  const overwritten =
    toNumber(
      readPath(status, ['modules', 'pythonBridge', 'stats', 'overwritten']),
    ) ??
    toNumber(
      readPath(status, [
        'modules',
        'mediaProcessor',
        'pythonBridge',
        'stats',
        'overwritten',
      ]),
    );
  const pythonBridgeAlive =
    toBoolean(readPath(status, ['modules', 'pythonBridge', 'alive'])) ??
    toBoolean(
      readPath(status, ['modules', 'mediaProcessor', 'pythonBridge', 'alive']),
    ) ??
    toBoolean(readPath(status, ['modules', 'mediaProcessor', 'alive']));

  const sourceType = toStringValue(readPath(config, ['source', 'type']));

  const ingestFpsLevel = fpsLevel(ingestFps);
  const videoFpsLevel = fpsLevel(videoFps);

  const pipelineMetrics = useMemo<MetricCardItem[]>(() => {
    const ingestMetric: MetricCardItem = {
      key: 'ingest-fps',
      title: metricTitle(
        '输入 FPS',
        ingestFpsLevel.label,
        ingestFpsLevel.tagColor,
      ),
      value: ingestFps === null ? '--' : Number(ingestFps.toFixed(2)),
      suffix: 'FPS',
      valueStyle: ingestFpsLevel.valueColor
        ? { ...metricValueStyle, color: ingestFpsLevel.valueColor }
        : metricValueStyle,
    };

    const videoMetric: MetricCardItem = {
      key: 'video-fps',
      title: metricTitle(
        '输出 FPS',
        videoFpsLevel.label,
        videoFpsLevel.tagColor,
      ),
      value: videoFps === null ? '--' : Number(videoFps.toFixed(2)),
      suffix: 'FPS',
      valueStyle: videoFpsLevel.valueColor
        ? { ...metricValueStyle, color: videoFpsLevel.valueColor }
        : metricValueStyle,
    };

    return [
      ingestMetric,
      videoMetric,
      {
        key: 'avg-latency',
        title: metricTitle('平均延迟'),
        value: avgLatencyMs === null ? '--' : Number(avgLatencyMs.toFixed(2)),
        suffix: 'ms',
        valueStyle: metricValueStyle,
      },
      {
        key: 'p95-latency',
        title: metricTitle('P95 延迟'),
        value: p95LatencyMs === null ? '--' : Number(p95LatencyMs.toFixed(2)),
        suffix: 'ms',
        valueStyle: metricValueStyle,
      },
      {
        key: 'cpu-percent',
        title: metricTitle('CPU 占用'),
        value: cpuPercent === null ? '--' : Number(cpuPercent.toFixed(2)),
        suffix: '%',
        valueStyle: metricValueStyle,
      },
      {
        key: 'rss-mb',
        title: metricTitle('RSS 内存'),
        value: rssMb === null ? '--' : Number(rssMb.toFixed(2)),
        suffix: 'MB',
        valueStyle: metricValueStyle,
      },
    ];
  }, [
    ingestFps,
    ingestFpsLevel.label,
    ingestFpsLevel.tagColor,
    ingestFpsLevel.valueColor,
    videoFps,
    videoFpsLevel.label,
    videoFpsLevel.tagColor,
    videoFpsLevel.valueColor,
    avgLatencyMs,
    p95LatencyMs,
    cpuPercent,
    rssMb,
  ]);

  const bridgeMetrics = useMemo<MetricCardItem[]>(() => {
    return [
      {
        key: 'python-bridge',
        title: metricTitle('PythonBridge'),
        value:
          pythonBridgeAlive === null
            ? '未知'
            : pythonBridgeAlive
              ? '存活'
              : '离线',
        valueStyle: metricValueStyle,
      },
      {
        key: 'overwritten',
        title: metricTitle('覆盖帧数'),
        value: overwritten === null ? '--' : overwritten,
        valueStyle: metricValueStyle,
      },
      {
        key: 'broadcast-clients',
        title: metricTitle('广播连接数'),
        value: connectedClients === null ? '--' : connectedClients,
        valueStyle: metricValueStyle,
      },
      {
        key: 'webrtc-connections',
        title: metricTitle('WebRTC 连接数'),
        value: webrtcConnectionCount,
        valueStyle: metricValueStyle,
      },
    ];
  }, [pythonBridgeAlive, overwritten, connectedClients, webrtcConnectionCount]);

  const runtimeSections = useMemo<RuntimeSection[]>(() => {
    if (!status) return [];

    const orderMap = new Map<string, number>([
      ['type', 0],
      ['ts', 1],
      ['uptimeMs', 2],
      ['server', 3],
      ['process', 4],
      ['ingest', 5],
      ['video', 6],
    ]);

    return Object.entries(status)
      .filter(([sectionName]) => sectionName !== 'modules')
      .sort(([a], [b]) => {
        const left = orderMap.get(a) ?? Number.MAX_SAFE_INTEGER;
        const right = orderMap.get(b) ?? Number.MAX_SAFE_INTEGER;
        if (left !== right) return left - right;
        return a.localeCompare(b);
      })
      .map(([sectionName, sectionValue]) => {
        const title = statusSectionTitle(sectionName);
        const entries = statusSectionEntries(sectionName, sectionValue).map(
          (item) => ({
            ...item,
            label: stripLeadingPrefix(item.label, title),
          }),
        );
        return {
          sectionName,
          title,
          schema: buildDescriptionSchema(entries),
        };
      });
  }, [status]);

  const runtimeSectionMap = useMemo(() => {
    const map = new Map<string, RuntimeSection>();
    runtimeSections.forEach((section) => {
      map.set(section.sectionName, section);
    });
    return map;
  }, [runtimeSections]);

  const runtimePrimarySections = useMemo(() => {
    return ['type', 'ts', 'uptimeMs', 'server']
      .map((sectionName) => runtimeSectionMap.get(sectionName))
      .filter((section): section is RuntimeSection => Boolean(section));
  }, [runtimeSectionMap]);

  const runtimeSecondarySections = useMemo(() => {
    return ['process', 'ingest', 'video']
      .map((sectionName) => runtimeSectionMap.get(sectionName))
      .filter((section): section is RuntimeSection => Boolean(section));
  }, [runtimeSectionMap]);

  const configSections = useMemo(() => {
    if (!config) return [];

    return configModuleMap(config).map(({ moduleName, entries }) => {
      const title = moduleTitle(moduleName);
      const normalizedEntries = entries.map((item) => ({
        ...item,
        label: stripLeadingPrefix(item.label, title),
      }));

      return {
        moduleName,
        title,
        schema: buildDescriptionSchema(normalizedEntries),
      };
    });
  }, [config]);

  const activeModuleEntries = useMemo(() => {
    if (!activeModule) return [];

    const title = moduleTitle(activeModule.moduleName);
    return flattenSemanticEntries(
      activeModule.moduleData,
      activeModule.moduleName,
    ).map((item) => ({
      ...item,
      label: stripLeadingPrefix(item.label, title),
    }));
  }, [activeModule]);

  const activeOverviewEntries = useMemo(() => {
    return activeModuleEntries.filter((item) => {
      return (
        !item.keyPath.includes('.stats.') && !item.keyPath.endsWith('.stats')
      );
    });
  }, [activeModuleEntries]);

  const activeOverviewSchema = useMemo(() => {
    return buildDescriptionSchema(activeOverviewEntries);
  }, [activeOverviewEntries]);

  const activeSummarySchema = useMemo(() => {
    if (!activeModule) return null;

    const statusTag = moduleStatusTag(activeModule.moduleData);
    const entries: SemanticEntry[] = [
      { keyPath: 'summary.status', label: '模块状态', value: statusTag.text },
      {
        keyPath: 'summary.brief',
        label: '摘要',
        value: moduleSummary(activeModule.moduleName, activeModule.moduleData),
      },
      {
        keyPath: 'summary.fieldCount',
        label: '字段数量',
        value: String(activeModuleEntries.length),
      },
    ];

    return buildDescriptionSchema(entries);
  }, [activeModule, activeModuleEntries.length]);

  const activeModuleStatsEntries = useMemo(() => {
    if (!activeModule) return [];

    const statsValue = readPath(activeModule.moduleData, ['stats']);
    if (
      !statsValue ||
      typeof statsValue !== 'object' ||
      Array.isArray(statsValue)
    ) {
      return [];
    }

    const statsTitle = '统计信息';
    return flattenSemanticEntries(statsValue, 'stats').map((item) => {
      const normalized = stripLeadingPrefix(item.label, statsTitle);
      return {
        ...item,
        label: normalized || item.label,
      };
    });
  }, [activeModule]);

  const activeStatsSchema = useMemo(() => {
    if (!activeModule) return null;

    const numericFieldCount = activeModuleEntries.filter((entry) =>
      /^[-+]?\d+(\.\d+)?$/.test(entry.value),
    ).length;
    const boolLikeFieldCount = activeModuleEntries.filter((entry) =>
      /(√|×|是|否)$/.test(entry.value),
    ).length;
    const latestTs =
      toNumber(readPath(activeModule.moduleData, ['lastSeenAt'])) ??
      toNumber(readPath(activeModule.moduleData, ['lastOfferAt'])) ??
      toNumber(readPath(activeModule.moduleData, ['startedAt']));

    const aggregateEntries: SemanticEntry[] = [
      {
        keyPath: 'stats.total',
        label: '总字段数',
        value: String(activeModuleEntries.length),
      },
      {
        keyPath: 'stats.numeric',
        label: '数值字段数',
        value: String(numericFieldCount),
      },
      {
        keyPath: 'stats.boolLike',
        label: '状态字段数',
        value: String(boolLikeFieldCount),
      },
      {
        keyPath: 'stats.latest',
        label: '最近时间',
        value: latestTs === null ? '-' : new Date(latestTs).toLocaleString(),
      },
    ];

    const entries: SemanticEntry[] = [
      ...activeModuleStatsEntries,
      ...aggregateEntries,
    ];

    return buildDescriptionSchema(entries);
  }, [activeModule, activeModuleEntries, activeModuleStatsEntries]);

  const fpsTrendData = useMemo(() => {
    return trendHistory.flatMap((point) => {
      return [
        {
          time: formatTimeLabel(point.ts),
          value: point.ingestFps,
          series: 'ingest FPS',
        },
        {
          time: formatTimeLabel(point.ts),
          value: point.videoFps,
          series: 'video FPS',
        },
      ];
    });
  }, [trendHistory]);

  const latencyTrendData = useMemo(() => {
    return trendHistory.flatMap((point) => {
      const rows: Array<{ time: string; value: number; series: string }> = [];
      if (point.latencyAverage != null) {
        rows.push({
          time: formatTimeLabel(point.ts),
          value: point.latencyAverage,
          series: 'average latency',
        });
      }
      if (point.latencyLatest != null) {
        rows.push({
          time: formatTimeLabel(point.ts),
          value: point.latencyLatest,
          series: 'latest latency',
        });
      }
      if (point.latencyP95 != null) {
        rows.push({
          time: formatTimeLabel(point.ts),
          value: point.latencyP95,
          series: 'p95 latency',
        });
      }
      if (point.latencyP99 != null) {
        rows.push({
          time: formatTimeLabel(point.ts),
          value: point.latencyP99,
          series: 'p99 latency',
        });
      }
      return rows;
    });
  }, [trendHistory]);

  const memoryTrendData = useMemo(() => {
    return trendHistory.flatMap((point) => {
      return [
        {
          time: formatTimeLabel(point.ts),
          value: point.rssMb,
          series: 'RSS MB',
        },
        {
          time: formatTimeLabel(point.ts),
          value: point.heapUsedMb,
          series: 'heapUsed MB',
        },
        {
          time: formatTimeLabel(point.ts),
          value: point.heapTotalMb,
          series: 'heapTotal MB',
        },
      ];
    });
  }, [trendHistory]);

  const runtimeTrendData = useMemo(() => {
    return trendHistory.flatMap((point) => {
      const rows: Array<{ time: string; value: number; series: string }> = [];
      if (point.cpuPercent != null) {
        rows.push({
          time: formatTimeLabel(point.ts),
          value: point.cpuPercent,
          series: 'CPU %',
        });
      }
      if (point.eventLoopLagMean != null) {
        rows.push({
          time: formatTimeLabel(point.ts),
          value: point.eventLoopLagMean,
          series: 'event loop lag ms',
        });
      }
      return rows;
    });
  }, [trendHistory]);

  const packetLossTrendData = useMemo(() => {
    return trendHistory.flatMap((point) => {
      const rows: Array<{ time: string; value: number; series: string }> = [];
      if (point.esp32WindowDropCount != null) {
        rows.push({
          time: formatTimeLabel(point.ts),
          value: point.esp32WindowDropCount,
          series: 'drop count',
        });
      }
      if (point.esp32WindowRecvCount != null) {
        rows.push({
          time: formatTimeLabel(point.ts),
          value: point.esp32WindowRecvCount,
          series: 'recv count',
        });
      }
      if (point.esp32WindowDropPct != null) {
        rows.push({
          time: formatTimeLabel(point.ts),
          value: point.esp32WindowDropPct,
          series: 'drop %',
        });
      }
      return rows;
    });
  }, [trendHistory]);

  const moduleHealthRows = useMemo<ModuleHealthRow[]>(() => {
    const latestPoint =
      trendHistory.length > 0 ? trendHistory[trendHistory.length - 1] : null;
    if (!latestPoint) {
      return MODULE_ORDER.map((moduleName) => ({
        key: moduleName,
        moduleName: moduleTitle(moduleName),
        status: '未知',
        flapping: '否',
        reconnectCount: 0,
        timeoutCount: 0,
      }));
    }

    const now = latestPoint.ts;
    const windowPoints = trendHistory.filter(
      (point) => point.ts >= now - TREND_WINDOW_MS,
    );

    return MODULE_ORDER.map((moduleName) => {
      const points = windowPoints
        .map((point) => point.modules[moduleName])
        .filter((point): point is ModuleStatePoint => Boolean(point));
      const current = latestPoint.modules[moduleName];

      let transitions = 0;
      let reconnectCount = 0;
      let timeoutCount = 0;

      for (let index = 1; index < points.length; index += 1) {
        const prev = points[index - 1];
        const next = points[index];
        if (prev.alive !== next.alive) {
          transitions += 1;
          if (!prev.alive && next.alive) reconnectCount += 1;
          if (prev.alive && !next.alive) timeoutCount += 1;
        }
      }

      const flapping: ModuleHealthRow['flapping'] =
        transitions >= 2 ? '是' : transitions === 1 ? '轻微' : '否';
      const status: ModuleHealthRow['status'] = current
        ? current.alive
          ? '在线'
          : '离线'
        : '未知';

      return {
        key: moduleName,
        moduleName: moduleTitle(moduleName),
        status,
        flapping,
        reconnectCount,
        timeoutCount,
      };
    });
  }, [trendHistory]);

  const moduleHealthColumns = useMemo(() => {
    return [
      {
        title: '模块',
        dataIndex: 'moduleName',
        key: 'moduleName',
      },
      {
        title: '当前状态',
        dataIndex: 'status',
        key: 'status',
        render: (value: ModuleHealthRow['status']) => {
          const color =
            value === '在线'
              ? 'success'
              : value === '离线'
                ? 'error'
                : 'default';
          return <Tag color={color}>{value}</Tag>;
        },
      },
      {
        title: '最近1分钟抖动',
        dataIndex: 'flapping',
        key: 'flapping',
      },
    ];
  }, []);

  const fidelityData = useMemo(() => {
    if (trendHistory.length === 0) return [];

    const latest = trendHistory[trendHistory.length - 1];
    const windowPoints = trendHistory.filter(
      (point) => point.ts >= latest.ts - FIDELITY_WINDOW_MS,
    );
    const baseline =
      windowPoints.length > 0 ? windowPoints[0] : trendHistory[0];

    const stageDeltas = [
      {
        stageLabel: '源帧计数',
        value: safeDelta(latest.sourceFrames, baseline.sourceFrames),
      },
      {
        stageLabel: '输入总线帧',
        value: safeDelta(latest.ingestFrames, baseline.ingestFrames),
      },
      {
        stageLabel: 'Python 输入帧',
        value: safeDelta(latest.pythonInFrames, baseline.pythonInFrames),
      },
      {
        stageLabel: 'Python 发送帧',
        value: safeDelta(latest.pythonSentFrames, baseline.pythonSentFrames),
      },
      {
        stageLabel: 'Python 输出帧',
        value: safeDelta(latest.pythonOutFrames, baseline.pythonOutFrames),
      },
      {
        stageLabel: '视频输出帧',
        value: safeDelta(latest.videoFrames, baseline.videoFrames),
      },
    ];

    // Make fidelity follow upstream throughput and keep a descending trend across stages.
    let prev = Number.POSITIVE_INFINITY;
    return stageDeltas.map((item) => {
      const nextValue = Math.min(prev, item.value);
      prev = nextValue;
      return {
        stageLabel: item.stageLabel,
        value: nextValue,
      };
    });
  }, [trendHistory]);

  const requestSnapshot = (withConfig: boolean) => {
    const socket = getSocket();
    const payload: DashboardRequestPayload = {
      withConfig,
      intervalMs,
    };
    socket.emit('dashboard:request', payload);
  };

  const handleExportSnapshot = () => {
    if (!status && !config) {
      void message.warning('暂无可导出快照数据');
      return;
    }

    const content = JSON.stringify(
      {
        exportedAt: Date.now(),
        status,
        config,
      },
      null,
      2,
    );

    const blob = new Blob([content], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dashboard-snapshot-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    void message.success('快照已导出');
  };

  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (payload: DashboardUpdatePayload) => {
      setStatus(payload);
      setTrendHistory((prev) => {
        const cutoff = payload.ts - TREND_WINDOW_MS;
        const trimmed = prev.filter((item) => item.ts >= cutoff);
        const nextPoint = buildTrendPoint(payload, trimmed);
        return [...trimmed, nextPoint];
      });
    };
    const onConfig = (payload: DashboardConfigPayload) => {
      setConfig(payload.config);
    };
    socket.on('dashboard:update', onUpdate);
    socket.on('dashboard:config', onConfig);
    socket.emit('dashboard:request', { withConfig: true, intervalMs });
    socket.emit('dashboard:subscribe');
    return () => {
      socket.off('dashboard:update', onUpdate);
      socket.off('dashboard:config', onConfig);
      socket.emit('dashboard:unsubscribe');
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    socket.emit('dashboard:request', { withConfig: false, intervalMs });
    if (autoRefresh) {
      socket.emit('dashboard:subscribe');
      return;
    }
    socket.emit('dashboard:unsubscribe');
  }, [autoRefresh, intervalMs]);

  useEffect(() => {
    if (activeModule) {
      setDrawerTab('overview');
    }
  }, [activeModule?.moduleName]);

  return (
    <PageContainer
      title="BrightSmile Dashboard"
      subTitle="实时链路监控 / 推理链路状态"
      header={{
        title: (
          <Space>
            <DashboardOutlined />
            BrightSmile Dashboard
          </Space>
        ),
      }}
      tags={[
        <Tag key="refresh" color={autoRefresh ? 'success' : 'default'}>
          {autoRefresh ? '自动刷新' : '已暂停'}
        </Tag>,
        <Tag key="source" color="blue">
          source: {sourceType ?? 'unknown'}
        </Tag>,
        <Tag key="clients" color="cyan">
          clients: {connectedClients ?? '--'}
        </Tag>,
      ]}
      extra={[
        <Segmented
          key="interval"
          size="small"
          value={intervalMs}
          options={[
            { label: '1s', value: 1000 },
            { label: '2s', value: 2000 },
          ]}
          onChange={(value) => setIntervalMs(Number(value))}
        />,
        <Button
          key="toggle"
          icon={autoRefresh ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          onClick={() => setAutoRefresh((prev) => !prev)}
        >
          {autoRefresh ? '暂停订阅' : '恢复订阅'}
        </Button>,
        <Button
          key="refresh"
          icon={<ReloadOutlined />}
          onClick={() => requestSnapshot(true)}
        >
          刷新快照
        </Button>,
        <Button key="export" onClick={handleExportSnapshot}>
          导出快照
        </Button>,
      ]}
    >
      <ProCard direction="column" gutter={[16, 16]} ghost>
        <ProCard title="核心指标" bordered>
          <div className={styles.metricTopLayout}>
            <ProCard
              title="链路性能"
              size="small"
              bordered
              className={styles.fillCard}
            >
              <div className={styles.pipelineMetricGrid}>
                {pipelineMetrics.map((metric) => (
                  <StatisticCard
                    key={metric.key}
                    bordered
                    className={styles.fillCard}
                    statistic={{
                      title: metric.title,
                      value: metric.value,
                      suffix: metric.suffix,
                      valueStyle: metric.valueStyle,
                    }}
                  />
                ))}
              </div>
            </ProCard>

            <ProCard
              title="连接状态"
              size="small"
              bordered
              className={styles.fillCard}
            >
              <div className={styles.bridgeMetricGrid}>
                {bridgeMetrics.map((metric) => (
                  <StatisticCard
                    key={metric.key}
                    bordered
                    className={styles.fillCard}
                    statistic={{
                      title: metric.title,
                      value: metric.value,
                      suffix: metric.suffix,
                      valueStyle: metric.valueStyle,
                    }}
                  />
                ))}
              </div>
            </ProCard>
          </div>
        </ProCard>

        <ProCard title="实时图表" bordered>
          <div className={styles.chartGrid}>
            <ProCard
              title="链路吞吐趋势（最近1分钟）"
              size="small"
              bordered
              className={styles.fillCard}
            >
              {fpsTrendData.length > 0 ? (
                <Line
                  data={fpsTrendData}
                  xField="time"
                  yField="value"
                  colorField="series"
                  scale={{ color: { range: DEMO_COLOR_RANGE } }}
                  smooth
                  autoFit
                  height={260}
                  animation={false}
                />
              ) : (
                <Empty
                  description="等待趋势数据"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              )}
            </ProCard>

            <ProCard
              title="延迟趋势（最近1分钟）"
              size="small"
              bordered
              className={styles.fillCard}
            >
              {latencyTrendData.length > 0 ? (
                <Line
                  data={latencyTrendData}
                  xField="time"
                  yField="value"
                  colorField="series"
                  scale={{ color: { range: DEMO_COLOR_RANGE_EXTENDED } }}
                  smooth
                  autoFit
                  height={260}
                  animation={false}
                />
              ) : (
                <Empty
                  description="等待延迟数据"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              )}
            </ProCard>

            <ProCard
              title="资源趋势（最近1分钟）"
              size="small"
              bordered
              className={styles.fillCard}
            >
              {memoryTrendData.length > 0 ? (
                <Line
                  data={memoryTrendData}
                  xField="time"
                  yField="value"
                  colorField="series"
                  scale={{ color: { range: DEMO_COLOR_RANGE } }}
                  height={260}
                  animation={false}
                />
              ) : (
                <Empty
                  description="等待资源数据"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              )}
            </ProCard>

            <ProCard
              title="运行时趋势（最近1分钟）"
              size="small"
              bordered
              className={styles.fillCard}
            >
              <div className={styles.subChartSpacer} />

              {runtimeTrendData.length > 0 ? (
                <Line
                  data={runtimeTrendData}
                  xField="time"
                  yField="value"
                  colorField="series"
                  scale={{ color: { range: DEMO_COLOR_RANGE_RUNTIME } }}
                  height={260}
                  animation={false}
                />
              ) : (
                <Empty
                  description="等待 CPU / Event Loop 数据"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              )}
            </ProCard>
          </div>

          <div className={styles.diagnosisChartGrid}>
            <ProCard
              title="模块健康时间线（最近1分钟）"
              size="small"
              bordered
              className={styles.fillCard}
            >
              <Table<ModuleHealthRow>
                size="small"
                rowKey="key"
                columns={moduleHealthColumns}
                dataSource={moduleHealthRows}
                pagination={false}
                scroll={{ x: 260 }}
              />
            </ProCard>

            <ProCard
              title="丢包诊断（最近1分钟）"
              size="small"
              bordered
              className={styles.fillCard}
            >
              {packetLossTrendData.length > 0 ? (
                <Line
                  data={packetLossTrendData}
                  xField="time"
                  yField="value"
                  colorField="series"
                  scale={{ color: { range: DEMO_COLOR_RANGE_EXTENDED } }}
                  height={360}
                  animation={false}
                />
              ) : (
                <Empty
                  description="等待 ESP32 UDP 丢包数据"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              )}
            </ProCard>

            <ProCard
              title="链路保真（最近1分钟差分）"
              size="small"
              bordered
              className={styles.fillCard}
            >
              {fidelityData.length > 0 ? (
                <Column
                  data={fidelityData}
                  xField="stageLabel"
                  yField="value"
                  height={360}
                  animation={false}
                  label={{
                    text: (datum: { value: number }) => `${datum.value}`,
                    textBaseline: 'bottom',
                  }}
                  style={{
                    maxWidth: 48,
                    radiusTopLeft: 8,
                    radiusTopRight: 8,
                  }}
                />
              ) : (
                <Empty
                  description="等待链路计数数据"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              )}
            </ProCard>
          </div>
        </ProCard>

        <ProCard
          title={
            <span>
              <SyncOutlined spin /> 运行态概览
            </span>
          }
          headerBordered
          direction="column"
        >
          {status ? (
            <div className={styles.runtimeOverviewLayout}>
              <div className={styles.runtimePrimaryColumn}>
                {runtimePrimarySections.map((section) => (
                  <ProCard
                    key={`runtime-primary:${section.sectionName}`}
                    size="small"
                    title={section.title}
                    bordered
                    className={styles.sectionCard}
                  >
                    <ProDescriptions
                      size="small"
                      column={1}
                      columns={section.schema.columns}
                      dataSource={section.schema.dataSource}
                    />
                  </ProCard>
                ))}
              </div>

              <div className={styles.runtimeSecondaryRow}>
                {runtimeSecondarySections.map((section) => (
                  <ProCard
                    key={`runtime-secondary:${section.sectionName}`}
                    size="small"
                    title={section.title}
                    bordered
                    className={styles.sectionCard}
                  >
                    <ProDescriptions
                      size="small"
                      column={1}
                      columns={section.schema.columns}
                      dataSource={section.schema.dataSource}
                    />
                  </ProCard>
                ))}
              </div>
            </div>
          ) : (
            <Empty
              description="等待实时状态数据"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
        </ProCard>

        <ProCard
          title="模块摘要"
          headerBordered
          extra={<Tag color="blue">{statusModules.length} modules</Tag>}
        >
          {status ? (
            <div className={styles.moduleGrid}>
              {statusModules.map(({ moduleName, moduleData }) => {
                const statusTag = moduleStatusTag(moduleData);
                return (
                  <ProCard
                    key={`summary:${moduleName}`}
                    size="small"
                    bordered
                    className={styles.fillCard}
                    title={
                      <div className={styles.wrapInline}>
                        <span className={styles.wrapText}>
                          {moduleTitle(moduleName)}
                        </span>
                        <Tag color={statusTag.color}>{statusTag.text}</Tag>
                      </div>
                    }
                    extra={
                      <Button
                        type="link"
                        onClick={() =>
                          setActiveModule({ moduleName, moduleData })
                        }
                      >
                        详情
                      </Button>
                    }
                  >
                    <Typography.Text
                      type="secondary"
                      className={styles.summaryText}
                    >
                      {moduleSummary(moduleName, moduleData)}
                    </Typography.Text>
                  </ProCard>
                );
              })}
            </div>
          ) : (
            <Empty
              description="等待模块状态"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
        </ProCard>

        <ProCard
          title={
            <span>
              <SettingOutlined /> 配置快照
            </span>
          }
          headerBordered
          extra={<Tag color="geekblue">{configSections.length} modules</Tag>}
        >
          {config ? (
            <div className={styles.configGrid}>
              {configSections.map((section) => (
                <ProCard
                  key={`config-card:${section.moduleName}`}
                  size="small"
                  bordered
                  className={styles.fillCard}
                  title={
                    <span className={styles.wrapText}>{section.title}</span>
                  }
                >
                  <ProDescriptions
                    size="small"
                    column={1}
                    columns={section.schema.columns}
                    dataSource={section.schema.dataSource}
                  />
                </ProCard>
              ))}
            </div>
          ) : (
            <Empty
              description="等待配置快照"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
        </ProCard>
      </ProCard>

      <Drawer
        width={680}
        open={Boolean(activeModule)}
        onClose={() => setActiveModule(null)}
        destroyOnClose
        title={
          activeModule
            ? `${moduleTitle(activeModule.moduleName)} 详情`
            : '模块详情'
        }
      >
        {activeModule ? (
          <ProCard direction="column" ghost gutter={[12, 12]}>
            {activeSummarySchema && (
              <ProCard title="状态摘要" size="small" bordered>
                <ProDescriptions
                  size="small"
                  column={1}
                  columns={activeSummarySchema.columns}
                  dataSource={activeSummarySchema.dataSource}
                />
              </ProCard>
            )}

            <Tabs
              className={styles.drawerTabs}
              activeKey={drawerTab}
              onChange={(key) => setDrawerTab(key as DrawerTabKey)}
              items={[
                {
                  key: 'overview',
                  label: '概览',
                  children: (
                    <ProDescriptions
                      size="small"
                      column={1}
                      columns={activeOverviewSchema.columns}
                      dataSource={activeOverviewSchema.dataSource}
                    />
                  ),
                },
                {
                  key: 'stats',
                  label: '统计',
                  children: activeStatsSchema ? (
                    <ProDescriptions
                      size="small"
                      column={1}
                      columns={activeStatsSchema.columns}
                      dataSource={activeStatsSchema.dataSource}
                    />
                  ) : (
                    <Empty
                      description="暂无统计信息"
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                  ),
                },
                {
                  key: 'raw',
                  label: '原始字段',
                  children: (
                    <pre className={styles.drawerRaw}>
                      {JSON.stringify(activeModule.moduleData, null, 2)}
                    </pre>
                  ),
                },
              ]}
            />
          </ProCard>
        ) : (
          <Empty
            description="请选择模块查看详情"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </Drawer>
    </PageContainer>
  );
};

export default Dashboard;
