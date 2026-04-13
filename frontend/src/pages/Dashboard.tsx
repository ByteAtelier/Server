import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Drawer,
  Empty,
  Segmented,
  Space,
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
import {
  readPath,
  toNumber,
  toStringValue,
  toBoolean,
  fpsLevel,
  splitStatusModules,
  stripLeadingPrefix,
  renderSemanticCard,
  buildDescriptionSchema,
} from '../utils/dashboardView';

interface ActiveModuleDetail {
  moduleName: string;
  moduleData: unknown;
}

const wrapInlineStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  lineHeight: 1.3,
};

const wrapTextStyle: React.CSSProperties = {
  whiteSpace: 'normal',
  wordBreak: 'break-word',
};

const metricValueStyle: React.CSSProperties = {
  ...wrapTextStyle,
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
    <div style={wrapInlineStyle}>
      <Typography.Text style={wrapTextStyle}>{text}</Typography.Text>
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

  const statusModules = splitStatusModules(status?.modules);

  const ingestFps = toNumber(status?.ingest?.fps);
  const videoFps = toNumber(status?.video?.fps);
  const avgLatencyMs = toNumber(status?.video?.latencyMs?.averageMs);
  const connectedClients = toNumber(status?.server?.connectedClients);

  const overwritten =
    toNumber(readPath(status, ['modules', 'pythonBridge', 'stats', 'overwritten'])) ??
    toNumber(readPath(status, ['modules', 'mediaProcessor', 'pythonBridge', 'stats', 'overwritten']));
  const webrtcState = toStringValue(readPath(status, ['modules', 'webrtc', 'lastConnectionState'])) ?? 'unknown';
  const pythonBridgeAlive =
    toBoolean(readPath(status, ['modules', 'pythonBridge', 'alive'])) ??
    toBoolean(readPath(status, ['modules', 'mediaProcessor', 'pythonBridge', 'alive'])) ??
    toBoolean(readPath(status, ['modules', 'mediaProcessor', 'alive']));

  const sourceType = toStringValue(readPath(config, ['source', 'type']));
  const sourceTargetFps = toNumber(readPath(config, ['source', 'imageLoop', 'fps']));

  const ingestFpsLevel = fpsLevel(ingestFps);
  const videoFpsLevel = fpsLevel(videoFps);

  const metricCards: Array<{
    key: string;
    title: React.ReactNode;
    value: number | string;
    suffix?: string;
    valueStyle?: React.CSSProperties;
  }> = [
    {
      key: 'ingest-fps',
      title: metricTitle('输入 FPS', ingestFpsLevel.label, ingestFpsLevel.tagColor),
      value: ingestFps === null ? '--' : Number(ingestFps.toFixed(2)),
      suffix: 'FPS',
      valueStyle: ingestFpsLevel.valueColor
        ? { ...metricValueStyle, color: ingestFpsLevel.valueColor }
        : metricValueStyle,
    },
    {
      key: 'video-fps',
      title: metricTitle('输出 FPS', videoFpsLevel.label, videoFpsLevel.tagColor),
      value: videoFps === null ? '--' : Number(videoFps.toFixed(2)),
      suffix: 'FPS',
      valueStyle: videoFpsLevel.valueColor
        ? { ...metricValueStyle, color: videoFpsLevel.valueColor }
        : metricValueStyle,
    },
    {
      key: 'avg-latency',
      title: metricTitle('平均延迟'),
      value: avgLatencyMs === null ? '--' : Number(avgLatencyMs.toFixed(2)),
      suffix: 'ms',
      valueStyle: metricValueStyle,
    },
    {
      key: 'overwritten',
      title: metricTitle('覆盖帧数'),
      value: overwritten === null ? '--' : overwritten,
      valueStyle: metricValueStyle,
    },
    {
      key: 'webrtc-state',
      title: metricTitle('WebRTC 状态'),
      value: webrtcState,
      valueStyle: metricValueStyle,
    },
    {
      key: 'python-bridge',
      title: metricTitle('PythonBridge'),
      value: pythonBridgeAlive === null ? '未知' : pythonBridgeAlive ? '存活' : '离线',
      valueStyle: metricValueStyle,
    },
    {
      key: 'source-type',
      title: metricTitle('数据源'),
      value: sourceType ?? 'unknown',
      valueStyle: metricValueStyle,
    },
    {
      key: 'source-fps',
      title: metricTitle('目标 FPS'),
      value: sourceTargetFps === null ? '--' : sourceTargetFps,
      valueStyle: metricValueStyle,
    },
  ];

  const runtimeSections = useMemo(() => {
    if (!status) return [];

    return Object.entries(status)
      .filter(([sectionName]) => sectionName !== 'modules')
      .map(([sectionName, sectionValue]) => {
        const title = statusSectionTitle(sectionName);
        const entries = statusSectionEntries(sectionName, sectionValue).map((item) => ({
          ...item,
          label: stripLeadingPrefix(item.label, title),
        }));
        return {
          sectionName,
          title,
          entries,
        };
      });
  }, [status]);

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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {metricCards.map((metric) => (
              <StatisticCard
                key={metric.key}
                bordered
                style={{ minWidth: 0 }}
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
          title={<span><SyncOutlined spin /> 运行态概览</span>}
          headerBordered
        >
          {status ? (
            runtimeSections.map((section) => (
              <ProCard key={section.sectionName} size="small" title={section.title} bordered style={{ marginBottom: 8 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: 8,
                  }}
                >
                  {section.entries.map((entry) => (
                    <div
                      key={`runtime:${section.sectionName}:${entry.keyPath}`}
                      style={{
                        border: '1px solid #f0f0f0',
                        borderRadius: 8,
                        padding: '8px 10px',
                        minHeight: 72,
                      }}
                    >
                      <Typography.Text
                        type="secondary"
                        style={{
                          display: 'block',
                          fontSize: 12,
                          lineHeight: 1.3,
                          ...wrapTextStyle,
                        }}
                      >
                        {entry.label}
                      </Typography.Text>
                      <Typography.Text
                        style={{
                          display: 'block',
                          marginTop: 6,
                          fontSize: 14,
                          lineHeight: 1.35,
                          ...wrapTextStyle,
                        }}
                        strong
                      >
                        {entry.value}
                      </Typography.Text>
                    </div>
                  ))}
                </div>
              </ProCard>
            ))
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
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: 12,
                alignItems: 'stretch',
              }}
            >
              {statusModules.map(({ moduleName, moduleData }) => {
                const statusTag = moduleStatusTag(moduleData);
                return (
                  <ProCard
                    key={`summary:${moduleName}`}
                    size="small"
                    bordered
                    style={{ minWidth: 0, height: '100%' }}
                    title={
                      <div style={wrapInlineStyle}>
                        <span style={wrapTextStyle}>{moduleTitle(moduleName)}</span>
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
                    <Typography.Text type="secondary" style={wrapTextStyle}>
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
        >
          {config ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: 12,
                alignItems: 'stretch',
              }}
            >
              {configSections.map((section) => (
                <ProCard
                  key={`config-card:${section.moduleName}`}
                  size="small"
                  bordered
                  style={{ minWidth: 0, height: '100%' }}
                  title={<span style={wrapTextStyle}>{section.title}</span>}
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
        {activeModule &&
          renderSemanticCard(
            moduleTitle(activeModule.moduleName),
            flattenSemanticEntries(activeModule.moduleData, activeModule.moduleName),
            `drawer:${activeModule.moduleName}`,
            true,
          )}
      </Drawer>
    </PageContainer>
  );
};

export default Dashboard;
