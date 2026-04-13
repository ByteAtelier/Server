import React from 'react';
import { ProCard, ProDescriptions } from '@ant-design/pro-components';
import type { DashboardUpdatePayload } from '../types/dashboard';
import type { SemanticEntry } from './dashboardSemantic';

export type FpsLevel = {
  label: string;
  tagColor: 'default' | 'success' | 'warning' | 'error';
  valueColor?: string;
};

export interface DescriptionSchema {
  dataSource: Record<string, string>;
  columns: Array<{
    key: string;
    dataIndex: string;
    title: string;
  }>;
}

export function readPath(source: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, source);
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

export function toStringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

export function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

export function fpsLevel(fps: number | null): FpsLevel {
  if (fps === null) {
    return { label: '未知', tagColor: 'default' };
  }
  if (fps < 8) {
    return { label: '差', tagColor: 'error', valueColor: '#ff4d4f' };
  }
  if (Math.abs(fps - 8) < 0.001) {
    return { label: '正常', tagColor: 'warning', valueColor: '#faad14' };
  }
  return { label: '优', tagColor: 'success', valueColor: '#52c41a' };
}

export function splitStatusModules(
  modules: DashboardUpdatePayload['modules'] | null | undefined,
): Array<{ moduleName: string; moduleData: unknown }> {
  if (!modules) return [];

  const hasStandalonePythonBridge = Object.hasOwn(modules, 'pythonBridge');
  const result: Array<{ moduleName: string; moduleData: unknown }> = [];

  Object.entries(modules).forEach(([moduleName, moduleData]) => {
    if (moduleName !== 'mediaProcessor' || !moduleData || typeof moduleData !== 'object' || Array.isArray(moduleData)) {
      result.push({ moduleName, moduleData });
      return;
    }

    const mediaProcessor = moduleData as Record<string, unknown>;
    const { pythonBridge, ...mediaWithoutPythonBridge } = mediaProcessor;
    result.push({ moduleName, moduleData: mediaWithoutPythonBridge });

    if (!hasStandalonePythonBridge && pythonBridge !== undefined) {
      result.push({ moduleName: 'pythonBridge', moduleData: pythonBridge });
    }
  });

  return result;
}

export function stripLeadingPrefix(label: string, prefix: string): string {
  const withSlash = `${prefix} / `;
  if (label.startsWith(withSlash)) {
    return label.slice(withSlash.length);
  }
  return label;
}

export function buildDescriptionSchema(entries: SemanticEntry[]): DescriptionSchema {
  const dataSource: Record<string, string> = {};
  const columns: DescriptionSchema['columns'] = entries.map((entry, index) => {
    const fieldKey = `f_${index}`;
    dataSource[fieldKey] = entry.value;
    return {
      key: fieldKey,
      dataIndex: fieldKey,
      title: entry.label,
    };
  });

  return {
    dataSource,
    columns,
  };
}

export function renderSemanticCard(
  title: string,
  entries: SemanticEntry[],
  parentKey = '',
  hideTitle = false,
): React.ReactNode {
  const directFields: SemanticEntry[] = [];
  const nestedGroups: Record<string, SemanticEntry[]> = {};

  entries.forEach((entry) => {
    const localLabel = stripLeadingPrefix(entry.label, title);
    const normalizedLabel = localLabel || entry.label;
    const idx = normalizedLabel.indexOf(' / ');

    if (idx < 0) {
      directFields.push({ ...entry, label: normalizedLabel });
      return;
    }

    const group = normalizedLabel.slice(0, idx);
    const childLabel = normalizedLabel.slice(idx + 3) || normalizedLabel;
    if (!nestedGroups[group]) nestedGroups[group] = [];
    nestedGroups[group].push({ ...entry, label: childLabel });
  });

  const schema = buildDescriptionSchema(directFields);

  return (
    <ProCard size="small" title={hideTitle ? undefined : title} bordered style={{ marginBottom: 8 }} key={parentKey + title}>
      {directFields.length > 0 && (
        <ProDescriptions
          size="small"
          column={1}
          columns={schema.columns}
          dataSource={schema.dataSource}
        />
      )}
      {Object.entries(nestedGroups).map(([group, groupEntries]) => (
        <div key={group} style={{ marginTop: 8, marginLeft: 8 }}>
          {renderSemanticCard(group, groupEntries, `${parentKey + title}/${group}`)}
        </div>
      ))}
    </ProCard>
  );
}
