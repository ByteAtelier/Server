export type DashboardPrimitive = string | number | boolean | null;

export interface DashboardConfigObject {
  [key: string]: DashboardConfigValue;
}

export type DashboardConfigValue =
  | DashboardPrimitive
  | DashboardConfigObject
  | DashboardConfigValue[];

export interface DashboardModuleStatus {
  alive: boolean;
  lastSeenAt?: number | null;
  [key: string]: unknown;
}

export interface DashboardLatencyMs {
  latestMs: number | null;
  averageMs?: number | null;
  p95Ms?: number | null;
  p99Ms?: number | null;
}

export interface DashboardEventLoopLagMs {
  meanMs: number | null;
  p99Ms: number | null;
}

export interface DashboardUpdatePayload {
  type: 'dashboard:update';
  ts: number;
  uptimeMs: number;
  process: {
    uptimeSec: number;
    cpuPercent: number;
    eventLoopLagMs: DashboardEventLoopLagMs;
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
  };
  server: {
    connectedClients: number;
  };
  ingest: {
    fps: number;
    totalFrames: number;
    lastFrameId: number | null;
    lastTsSrc: number | null;
  };
  video: {
    fps: number;
    totalFrames: number;
    lastTsSrc: number | null;
    latencyMs: DashboardLatencyMs;
  };
  modules: Record<string, DashboardModuleStatus>;
}

export type DashboardConfig = DashboardConfigObject;

export interface DashboardConfigPayload {
  type: 'dashboard:config';
  ts: number;
  config: DashboardConfig;
}

export interface DashboardRequestPayload {
  withConfig?: boolean;
  subscribe?: boolean;
  intervalMs?: number;
}

export interface DashboardSubscribedPayload {
  intervalMs: number;
}
