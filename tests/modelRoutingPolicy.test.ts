import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelRegistry } from '../server/infrastructure/deepseek/model-registry.js';

test('model registry prefers healthy, capable and lower-cost models within budget', () => {
  const registry = new ModelRegistry();
  registry.register({ id: 'cheap', taskTypes: ['fast'], inputPricePerMillion: 1, outputPricePerMillion: 1, maxContextTokens: 10_000, structuredOutput: false, latencyMs: 100, healthy: true, client: {} });
  registry.register({ id: 'structured', taskTypes: ['fast'], inputPricePerMillion: 5, outputPricePerMillion: 5, maxContextTokens: 10_000, structuredOutput: true, latencyMs: 200, healthy: true, client: {} });
  assert.equal(registry.select({ taskType: 'fast', structured: true, estimatedTokens: 100 })?.id, 'structured');
  registry.markHealth('structured', false);
  assert.equal(registry.select({ taskType: 'fast', structured: true, estimatedTokens: 100 }), undefined);
});
