import React, { useEffect, useState } from 'react';
import { Card, Typography, Descriptions, Row, Col, Tag } from 'antd';
import { DashboardOutlined, SyncOutlined, SettingOutlined } from '@ant-design/icons';
import { getSocket } from '../services/socket';
import type { DashboardConfig, DashboardConfigPayload, DashboardUpdatePayload } from '../types/dashboard';

interface FlatEntry {
  keyPath: string;
  value: string;
}

function formatValue(value: unknown): string {
  if (value === null) return '-';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  if (Array.isArray(value) && value.length === 0) return '[]';
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return '{}';
  return JSON.stringify(value);
}

function flattenEntries(value: unknown, prefix = ''): FlatEntry[] {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return [{ keyPath: prefix || 'value', value: formatValue(value) }];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [{ keyPath: prefix || 'value', value: '[]' }];
    }
    return value.flatMap((item, index) => {
      const nextPrefix = prefix ? `${prefix}[${index}]` : `[${index}]`;
      return flattenEntries(item, nextPrefix);
    });
  }

  const objectEntries = Object.entries(value as Record<string, unknown>);
  if (objectEntries.length === 0) {
    return [{ keyPath: prefix || 'value', value: '{}' }];
  }

  return objectEntries.flatMap(([key, nestedValue]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return flattenEntries(nestedValue, nextPrefix);
  });
}

function getConfigEntries(moduleName: string, moduleConfig: unknown): FlatEntry[] {
  if (moduleName !== 'source') {
    return flattenEntries(moduleConfig);
  }

  if (typeof moduleConfig !== 'object' || moduleConfig === null || Array.isArray(moduleConfig)) {
    return flattenEntries(moduleConfig);
  }

  const sourceConfig = moduleConfig as Record<string, unknown>;
  const sourceType = sourceConfig.type === 'imageLoop' || sourceConfig.type === 'esp32Udp' ? sourceConfig.type : null;

  if (!sourceType) {
    return flattenEntries(moduleConfig);
  }

  const entries: FlatEntry[] = [];
  entries.push(...flattenEntries(sourceType, 'type'));

  Object.entries(sourceConfig).forEach(([key, value]) => {
    if (key === 'type' || key === 'imageLoop' || key === 'esp32Udp') {
      return;
    }
    entries.push(...flattenEntries(value, key));
  });

  entries.push(...flattenEntries(sourceConfig[sourceType], sourceType));
  return entries;
}

const Dashboard: React.FC = () => {
  const [status, setStatus] = useState<DashboardUpdatePayload | null>(null);
  const [config, setConfig] = useState<DashboardConfig | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (payload: DashboardUpdatePayload) => setStatus(payload);
    const onConfig = (payload: DashboardConfigPayload) => setConfig(payload.config);
    socket.on('dashboard:update', onUpdate);
    socket.on('dashboard:config', onConfig);
    socket.emit('dashboard:request', { withConfig: true });
    socket.emit('dashboard:subscribe');
    return () => {
      socket.off('dashboard:update', onUpdate);
      socket.off('dashboard:config', onConfig);
      socket.emit('dashboard:unsubscribe');
    };
  }, []);

  return (
    <div style={{ maxWidth: 1280, margin: '48px auto', padding: 24 }}>
      <Typography.Title level={2} style={{ textAlign: 'center', marginBottom: 32 }}>
        <DashboardOutlined /> BrightSmile Dashboard
      </Typography.Title>
      <Row gutter={24}>
        <Col span={14}>
          <Card title={<span><SyncOutlined spin /> 实时状态</span>} bordered={false}>
            {status ? (
              <Row gutter={[12, 12]}>
                {Object.entries(status).map(([sectionName, sectionValue]) => {
                  const items = flattenEntries(sectionValue);
                  return (
                    <Col span={24} key={sectionName}>
                      <Card size="small" title={sectionName} bordered>
                        <Descriptions column={1} size="small" bordered>
                          {items.map((item) => (
                            <Descriptions.Item key={`status:${sectionName}:${item.keyPath}`} label={item.keyPath === 'value' ? sectionName : item.keyPath}>
                              {item.value}
                            </Descriptions.Item>
                          ))}
                        </Descriptions>
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            ) : <Tag color="default">等待数据...</Tag>}
          </Card>
        </Col>
        <Col span={10}>
          <Card title={<span><SyncOutlined /> 参数配置</span>} bordered={false}>
            {config ? (
              <Row gutter={[12, 12]}>
                {Object.entries(config).map(([moduleName, moduleConfig]) => {
                  const items = getConfigEntries(moduleName, moduleConfig);
                  return (
                    <Col span={24} key={moduleName}>
                      <Card
                        size="small"
                        title={<span><SettingOutlined /> {moduleName}</span>}
                        bordered
                      >
                        <Descriptions column={1} size="small" bordered>
                          {items.map((item) => (
                            <Descriptions.Item key={`${moduleName}:${item.keyPath}`} label={item.keyPath}>
                              {item.value}
                            </Descriptions.Item>
                          ))}
                        </Descriptions>
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            ) : <Tag color="default">等待参数...</Tag>}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Dashboard;
