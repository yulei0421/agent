import type { ModelTaskType } from '../../application/chat/chat.ports.js';

export interface ModelProfile {
  readonly id: string;
  readonly taskTypes: readonly ModelTaskType[];
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly maxContextTokens: number;
  readonly structuredOutput: boolean;
  readonly latencyMs: number;
  readonly healthy: boolean;
  readonly client: unknown;
  readonly unhealthyUntil?: number;
}

export interface ModelSelectionRequest {
  readonly taskType?: ModelTaskType;
  readonly structured?: boolean;
  readonly estimatedTokens?: number;
  readonly maxCostUsd?: number;
}

export class ModelRegistry {
  private readonly profiles = new Map<string, ModelProfile>();
  register(profile: ModelProfile): void {
    if (!/^[A-Za-z0-9._:-]{1,96}$/u.test(profile.id) || profile.maxContextTokens < 1 || profile.inputPricePerMillion < 0 || profile.outputPricePerMillion < 0) throw new Error('Invalid model profile');
    this.profiles.set(profile.id, Object.freeze({ ...profile, taskTypes: Object.freeze([...profile.taskTypes]) }));
  }
  constructor(private readonly healthCooldownMs = 30_000) {}

  markHealth(id: string, healthy: boolean, now = Date.now): void {
    const profile = this.profiles.get(id);
    if (profile) this.profiles.set(id, Object.freeze({ ...profile, healthy, ...(healthy ? { unhealthyUntil: undefined } : { unhealthyUntil: now() + this.healthCooldownMs }) }));
  }
  select(request: ModelSelectionRequest): ModelProfile | undefined {
    const candidates = [...this.profiles.values()].filter((profile) => profile.healthy && (!profile.unhealthyUntil || profile.unhealthyUntil <= Date.now())
      && (!request.taskType || profile.taskTypes.includes(request.taskType))
      && (!request.structured || profile.structuredOutput)
      && (!request.estimatedTokens || profile.maxContextTokens >= request.estimatedTokens));
    return candidates.sort((left, right) => {
      const leftCost = (request.estimatedTokens ?? 0) * (left.inputPricePerMillion + left.outputPricePerMillion) / 1_000_000;
      const rightCost = (request.estimatedTokens ?? 0) * (right.inputPricePerMillion + right.outputPricePerMillion) / 1_000_000;
      const leftOver = request.maxCostUsd !== undefined && leftCost > request.maxCostUsd ? 1 : 0;
      const rightOver = request.maxCostUsd !== undefined && rightCost > request.maxCostUsd ? 1 : 0;
      return leftOver - rightOver || leftCost - rightCost || left.latencyMs - right.latencyMs;
    })[0];
  }
  list(): readonly ModelProfile[] { return [...this.profiles.values()]; }
}
