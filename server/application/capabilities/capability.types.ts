export type CapabilityKind = 'tool' | 'agent' | 'model';
export type CapabilityRiskLevel = 'read_only' | 'internal';
export type CapabilityTaskType = 'fast' | 'reasoning' | 'structured';

export interface CapabilityManifest {
  readonly name: string;
  readonly kind: CapabilityKind;
  readonly version: string;
  readonly riskLevel: CapabilityRiskLevel;
  readonly timeoutMs: number;
  readonly maxCalls: number;
  readonly taskTypes: readonly CapabilityTaskType[];
  readonly description: string;
  readonly requiresApproval: boolean;
  /** Server-owned implementation detail. It is never returned by the API. */
  readonly execute?: (...args: readonly unknown[]) => unknown;
}

export type PublicCapability = Omit<CapabilityManifest, 'execute'>;
