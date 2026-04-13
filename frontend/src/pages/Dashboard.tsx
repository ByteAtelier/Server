import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Drawer,
  Empty,
  Segmented,
  Space,
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

const metricValueStyle: React.CSSProperties = {
  whiteSpace: 'normal',
  wordBreak: 'break-word',
  lineHeight: 1.2,
};

function moduleStatusTag(moduleData: unknown): { text: string; color: 'default' | 'success' | 'error' } {
  const alive = toBoolean(readPath(moduleData, ['alive']));
  if (alive === true) return { text: '正常', color: 'success' };
  if (alive === false) return { text: '离线', color: 'error' };
  return { text: '未知', color: 'default' };
}

function metricTitle(text: string, tagText?: string, tagColor?: string): React.ReactNode {
  return (
    <div className={styles.wrapInline}>
      <Typography.Text className={styles.wrapText}>{text}</Typography.Text>
      {tagText && <Tag color={tagColor}>{tagText}</Tag>}
    </div>
  );
}

function moduleSummary(moduleName: string, moduleData: unknown): string {
  if (moduleName === 'pythonBridge') {
    const overwritten = toNumber(readPath(moduleData, ['stats', 'overwritten']));
    return `覆盖帧：${overwritten === null ? '-' : overwritten}`;
  }

  if (moduleName === 'webrtc') {
    const state = toStringValue(readPath(moduleData, ['lastConnectionState'])) ?? 'unknown';
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
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [intervalMs, setIntervalMs] = useState(1000);
  const [activeModule, setActiveModule] = useState<ActiveModuleDetail | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTabKey>('overview');

  const statusModules = splitStatusModules(status?.modules);

  const ingestFps = toNumber(status?.ingest?.fps);
  const videoFps = toNumber(status?.video?.fps);
  const avgLatencyMs = toNumber(status?.video?.latencyMs?.averageMs);
  const connectedClients = toNumber(status?.server?.connectedClients);

  const overwritten =
    toNumber(readPath(status, ['modules', 'pythonBridge', 'stats', 'overwritten'])) ??
    toNumber(readPath(status, ['modules', 'mediaProcessor', 'pythonBridge', 'stats', 'overwritten']));
  const pythonBridgeAlive =
    toBoolean(readPath(status, ['modules', 'pythonBridge', 'alive'])) ??
    toBoolean(readPath(status, ['modules', 'mediaProcessor', 'pythonBridge', 'alive'])) ??
    toBoolean(readPath(status, ['modules', 'mediaProcessor', 'alive']));

  const sourceType = toStringValue(readPath(config, ['source', 'type']));
  const sourceTargetFps = toNumber(readPath(config, ['source', 'imageLoop', 'fps']));

  const ingestFpsLevel = fpsLevel(ingestFps);
  const videoFpsLevel = fpsLevel(videoFps);

  const pipelineMetrics = useMemo<MetricCardItem[]>(() => {
    const ingestMetric: MetricCardItem = {
      key: 'ingest-fps',
      title: metricTitle('输入 FPS', ingestFpsLevel.label, ingestFpsLevel.tagColor),
      value: ingestFps === null ? '--' : Number(ingestFps.toFixed(2)),
      suffix: 'FPS',
      valueStyle: ingestFpsLevel.valueColor
        ? { ...metricValueStyle, color: ingestFpsLevel.valueColor }
        : metricValueStyle,
    };

    const videoMetric: MetricCardItem = {
      key: 'video-fps',
      title: metricTitle('输出 FPS', videoFpsLevel.label, videoFpsLevel.tagColor),
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
  ]);

  const bridgeMetrics = useMemo<MetricCardItem[]>(() => {
    return [
      {
        key: 'python-bridge',
        title: metricTitle('PythonBridge'),
        value: pythonBridgeAlive === null ? '未知' : pythonBridgeAlive ? '存活' : '离线',
        valueStyle: metricValueStyle,
      },
      {
        key: 'overwritten',
        title: metricTitle('覆盖帧数'),
        value: overwritten === null ? '--' : overwritten,
        valueStyle: metricValueStyle,
      },
    ];
  }, [
    pythonBridgeAlive,
    overwritten,
  ]);

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
        const entries = statusSectionEntries(sectionName, sectionValue).map((item) => ({
          ...item,
          label: stripLeadingPrefix(item.label, title),
        }));
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
    return flattenSemanticEntries(activeModule.moduleData, activeModule.moduleName).map((item) => ({
      ...item,
      label: stripLeadingPrefix(item.label, title),
    }));
  }, [activeModule]);

  const activeOverviewEntries = useMemo(() => {
    return activeModuleEntries.filter((item) => {
      return !item.keyPath.includes('.stats.') && !item.keyPath.endsWith('.stats');
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
    if (!statsValue || typeof statsValue !== 'object' || Array.isArray(statsValue)) {
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

    const numericFieldCount = activeModuleEntries.filter((entry) => /^[-+]?\d+(\.\d+)?$/.test(entry.value)).length;
    const boolLikeFieldCount = activeModuleEntries.filter((entry) => /(√|×|是|否)$/.test(entry.value)).length;
    const latestTs =
      toNumber(readPath(activeModule.moduleData, ['lastSeenAt'])) ??
      toNumber(readPath(activeModule.moduleData, ['lastOfferAt'])) ??
      toNumber(readPath(activeModule.moduleData, ['startedAt']));

    const aggregateEntries: SemanticEntry[] = [
      { keyPath: 'stats.total', label: '总字段数', value: String(activeModuleEntries.length) },
      { keyPath: 'stats.numeric', label: '数值字段数', value: String(numericFieldCount) },
      { keyPath: 'stats.boolLike', label: '状态字段数', value: String(boolLikeFieldCount) },
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

    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
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
    const onUpdate = (payload: DashboardUpdatePayload) => setStatus(payload);
    const onConfig = (payload: DashboardConfigPayload) => setConfig(payload.config);
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
            { label: '500ms', value: 500 },
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
        <Button key="refresh" icon={<ReloadOutlined />} onClick={() => requestSnapshot(true)}>
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
            <ProCard title="链路性能" size="small" bordered className={styles.fillCard}>
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

            <ProCard title="桥接状态" size="small" bordered className={styles.fillCard}>
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

        <ProCard
          title={<span><SyncOutlined spin /> 运行态概览</span>}
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
            <Empty description="等待实时状态数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
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
                        <span className={styles.wrapText}>{moduleTitle(moduleName)}</span>
                        <Tag color={statusTag.color}>{statusTag.text}</Tag>
                      </div>
                    }
                    extra={
                      <Button
                        type="link"
                        onClick={() => setActiveModule({ moduleName, moduleData })}
                      >
                        详情
                      </Button>
                    }
                  >
                    <Typography.Text type="secondary" className={styles.summaryText}>
                      {moduleSummary(moduleName, moduleData)}
                    </Typography.Text>
                  </ProCard>
                );
              })}
            </div>
          ) : (
            <Empty description="等待模块状态" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </ProCard>

        <ProCard
          title={<span><SettingOutlined /> 配置快照</span>}
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
                  title={<span className={styles.wrapText}>{section.title}</span>}
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
            <Empty description="等待配置快照" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </ProCard>
      </ProCard>

      <Drawer
        width={680}
        open={Boolean(activeModule)}
        onClose={() => setActiveModule(null)}
        destroyOnClose
        title={activeModule ? `${moduleTitle(activeModule.moduleName)} 详情` : '模块详情'}
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
                    <Empty description="暂无统计信息" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ),
                },
                {
                  key: 'raw',
                  label: '原始字段',
                  children: <pre className={styles.drawerRaw}>{JSON.stringify(activeModule.moduleData, null, 2)}</pre>,
                },
              ]}
            />
          </ProCard>
        ) : (
          <Empty description="请选择模块查看详情" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Drawer>
    </PageContainer>
  );
};

export default Dashboard;
