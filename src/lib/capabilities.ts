export type PublicCapabilityKind = 'tool' | 'agent' | 'model';
export type PublicCapabilityRisk = 'read_only' | 'internal';

export interface PublicCapability {
  name: string;
  kind: PublicCapabilityKind;
  version: string;
  riskLevel: PublicCapabilityRisk;
  timeoutMs: number;
  maxCalls: number;
  taskTypes: readonly ('fast' | 'reasoning' | 'structured')[];
  description: string;
  requiresApproval: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseCapability(value: unknown): PublicCapability | null {
  if (!isRecord(value)) return null;
  const taskTypes = Array.isArray(value.taskTypes) && value.taskTypes.every((item) => item === 'fast' || item === 'reasoning' || item === 'structured')
    ? value.taskTypes as PublicCapability['taskTypes']
    : null;
  if (typeof value.name !== 'string' || !/^[A-Za-z0-9_.-]{1,96}$/u.test(value.name)
    || (value.kind !== 'tool' && value.kind !== 'agent' && value.kind !== 'model')
    || typeof value.version !== 'string' || value.version.length > 32
    || (value.riskLevel !== 'read_only' && value.riskLevel !== 'internal')
    || typeof value.timeoutMs !== 'number' || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1
    || typeof value.maxCalls !== 'number' || !Number.isSafeInteger(value.maxCalls) || value.maxCalls < 1
    || !taskTypes || typeof value.description !== 'string' || value.description.length > 240
    || typeof value.requiresApproval !== 'boolean') return null;
  return {
    name: value.name,
    kind: value.kind,
    version: value.version,
    riskLevel: value.riskLevel,
    timeoutMs: value.timeoutMs,
    maxCalls: value.maxCalls,
    taskTypes: [...taskTypes],
    description: value.description,
    requiresApproval: value.requiresApproval
  } as PublicCapability;
}

export async function fetchCapabilities(signal?: AbortSignal): Promise<readonly PublicCapability[]> {
  const response = await fetch('/api/capabilities', { signal });
  if (!response.ok) throw new Error(`能力清单请求失败：${response.status}`);
  const payload = await response.json() as unknown;
  if (!isRecord(payload) || !Array.isArray(payload.capabilities) || payload.capabilities.length > 64) throw new Error('能力清单格式无效');
  const capabilities = payload.capabilities.map(parseCapability);
  if (capabilities.some((capability) => capability === null)) throw new Error('能力清单格式无效');
  return Object.freeze(capabilities as PublicCapability[]);
}
