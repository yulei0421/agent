import assert from 'node:assert/strict';
import test from 'node:test';
import { BudgetManager } from '../server/agent/budget-manager.js';
import { ResearchCoordinator } from '../server/agent/research-coordinator.js';

test('budget manager enforces agent and token/cost budgets', () => {
  const budget = new BudgetManager({ maxAgents: 1, maxTokens: 10, maxCostUsd: 0.1 });
  budget.reserveAgent();
  assert.throws(() => budget.reserveAgent(), { code: 'budget_exceeded' });
  budget.record({ tokens: 10, costUsd: 0.1 });
  assert.deepEqual(budget.remaining(), { maxTokens: 0, maxCostUsd: 0, maxDurationMs: 120_000, maxAgents: 0 });
});

test('coordinator accepts a model-generated bounded sub-agent plan', async () => {
  const model = {
    async *stream() {
      yield { type: 'delta' as const, content: '{"items":["check freshness"]}' };
      yield { type: 'done' as const };
    }
  };
  const coordinator = new ResearchCoordinator(model, undefined, async () => [{ role: 'risk_reviewer' as const, goal: '检查来源新鲜度', maxItems: 1 }]);
  const result = await coordinator.prepare({ goal: '研究市场', signal: new AbortController().signal });
  assert.equal(result.messages.length, 1);
  assert.equal(result.events[0]?.role, 'risk_reviewer');
});
