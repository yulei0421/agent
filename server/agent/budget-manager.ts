import { AppError } from '../domain/errors/app-error.js';

export interface AgentBudget {
  readonly maxTokens: number;
  readonly maxCostUsd: number;
  readonly maxDurationMs: number;
  readonly maxAgents: number;
}

export interface BudgetUsage {
  tokens: number;
  costUsd: number;
  durationMs: number;
  agents: number;
}

export class BudgetManager {
  readonly budget: AgentBudget;
  readonly usage: BudgetUsage = { tokens: 0, costUsd: 0, durationMs: 0, agents: 0 };
  private readonly startedAt: number;

  constructor(budget: Partial<AgentBudget> = {}, now: () => number = Date.now) {
    this.startedAt = now();
    this.budget = Object.freeze({
      maxTokens: bounded(budget.maxTokens ?? 8_000, 1, 1_000_000),
      maxCostUsd: bounded(budget.maxCostUsd ?? 1, 0, 100_000),
      maxDurationMs: bounded(budget.maxDurationMs ?? 120_000, 100, 3_600_000),
      maxAgents: bounded(budget.maxAgents ?? 4, 1, 32)
    });
    this.now = now;
  }

  private readonly now: () => number;

  reserveAgent(): void {
    if (this.usage.agents + 1 > this.budget.maxAgents) throw new AppError('budget_exceeded');
    this.usage.agents += 1;
    this.assertWithinTime();
  }

  record(input: { tokens?: number; costUsd?: number; durationMs?: number }): void {
    this.usage.tokens += bounded(input.tokens ?? 0, 0, 1_000_000);
    this.usage.costUsd += bounded(input.costUsd ?? 0, 0, 100_000);
    this.usage.durationMs = Math.max(this.usage.durationMs, bounded(input.durationMs ?? 0, 0, 3_600_000));
    if (this.usage.tokens > this.budget.maxTokens || this.usage.costUsd > this.budget.maxCostUsd) throw new AppError('budget_exceeded');
    this.assertWithinTime();
  }

  remaining(): AgentBudget {
    return Object.freeze({
      maxTokens: Math.max(0, this.budget.maxTokens - this.usage.tokens),
      maxCostUsd: Math.max(0, this.budget.maxCostUsd - this.usage.costUsd),
      maxDurationMs: Math.max(0, this.budget.maxDurationMs - this.usage.durationMs),
      maxAgents: Math.max(0, this.budget.maxAgents - this.usage.agents)
    });
  }

  private assertWithinTime(): void {
    if (this.now() - this.startedAt > this.budget.maxDurationMs) throw new AppError('budget_exceeded');
  }
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
