import { Injectable } from '@nestjs/common';
import type { ToolExecutor } from '../../domain/tools/tool.types.js';
import type { CapabilityManifest, CapabilityTaskType, PublicCapability } from './capability.types.js';

const TASK_TYPES: readonly CapabilityTaskType[] = ['fast', 'reasoning', 'structured'];

function freezeManifest(manifest: CapabilityManifest): CapabilityManifest {
  return Object.freeze({
    ...manifest,
    taskTypes: Object.freeze([...manifest.taskTypes])
  });
}

function toolCapability(name: string, description: string, maxCalls = 6): CapabilityManifest {
  return {
    name,
    kind: 'tool',
    version: '1.0.0',
    riskLevel: 'read_only',
    timeoutMs: 10_000,
    maxCalls,
    taskTypes: TASK_TYPES,
    description,
    requiresApproval: false,
    execute: () => undefined
  };
}

export function createDefaultCapabilityManifests(): readonly CapabilityManifest[] {
  return [
    toolCapability('get_weather', '查询指定城市或当前所在地天气'),
    toolCapability('search_news', '检索近期新闻和报道'),
    toolCapability('search_asset', '按名称或代码搜索金融资产'),
    toolCapability('get_quote', '查询已确认金融资产报价'),
    toolCapability('get_technical_indicators', '计算固定窗口技术指标'),
    toolCapability('get_economic_calendar', '查询本周宏观经济日历'),
    {
      name: 'researcher',
      kind: 'agent',
      version: '1.0.0',
      riskLevel: 'internal',
      timeoutMs: 15_000,
      maxCalls: 1,
      taskTypes: ['reasoning', 'structured'],
      description: '生成研究数据需求清单，不执行工具',
      requiresApproval: false
    },
    {
      name: 'risk_reviewer',
      kind: 'agent',
      version: '1.0.0',
      riskLevel: 'internal',
      timeoutMs: 15_000,
      maxCalls: 1,
      taskTypes: ['reasoning', 'structured'],
      description: '检查研究风险和证据缺口，不执行工具',
      requiresApproval: false
    },
    {
      name: 'model.fast',
      kind: 'model',
      version: '1.0.0',
      riskLevel: 'internal',
      timeoutMs: 60_000,
      maxCalls: 1,
      taskTypes: ['fast'],
      description: '低延迟普通对话模型槽位',
      requiresApproval: false
    },
    {
      name: 'model.reasoning',
      kind: 'model',
      version: '1.0.0',
      riskLevel: 'internal',
      timeoutMs: 120_000,
      maxCalls: 1,
      taskTypes: ['reasoning'],
      description: '复杂研究与规划模型槽位',
      requiresApproval: false
    },
    {
      name: 'model.structured',
      kind: 'model',
      version: '1.0.0',
      riskLevel: 'internal',
      timeoutMs: 120_000,
      maxCalls: 1,
      taskTypes: ['structured'],
      description: '结构化输出模型槽位',
      requiresApproval: false
    }
  ];
}

@Injectable()
export class CapabilityRegistry {
  private readonly values: readonly CapabilityManifest[];

  constructor(manifests: readonly CapabilityManifest[] = createDefaultCapabilityManifests()) {
    const names = new Set<string>();
    this.values = Object.freeze(manifests.map((manifest) => {
      if (names.has(manifest.name)) throw new Error(`Duplicate capability: ${manifest.name}`);
      names.add(manifest.name);
      return freezeManifest(manifest);
    }));
  }

  manifests(): readonly CapabilityManifest[] {
    return this.values;
  }

  publicSummary(): readonly PublicCapability[] {
    return Object.freeze(this.values.map(({ execute: _execute, ...publicValue }) => Object.freeze({
      ...publicValue,
      taskTypes: Object.freeze([...publicValue.taskTypes])
    })));
  }

  has(name: string): boolean {
    return this.values.some((manifest) => manifest.name === name);
  }

  forTask(taskType: CapabilityTaskType): readonly CapabilityManifest[] {
    return this.values.filter((manifest) => manifest.taskTypes.includes(taskType));
  }
}

export function capabilityRegistryFromTools(_tools?: ToolExecutor): CapabilityRegistry {
  return new CapabilityRegistry();
}
