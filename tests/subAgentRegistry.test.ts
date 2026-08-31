import test from 'node:test';
import assert from 'node:assert/strict';
import { SubAgentRegistry } from '../server/agent/sub-agent-registry.js';

test('exposes only fixed safe role summaries and enforces duplicate rejection', () => {
  const registry = new SubAgentRegistry();
  assert.deepEqual(registry.publicSummary(), [
    { role: 'researcher', maxItems: 4, timeoutMs: 15_000, maxConcurrent: 1 },
    { role: 'risk_reviewer', maxItems: 4, timeoutMs: 15_000, maxConcurrent: 1 }
  ]);
  assert.equal(registry.get('researcher')?.maxItems, 4);
  assert.equal(registry.get('unknown' as never), undefined);
  assert.throws(() => new SubAgentRegistry([
    registry.get('researcher')!,
    registry.get('researcher')!
  ]), /Duplicate sub-agent role/);
});

test('returns defensive role definitions', () => {
  const registry = new SubAgentRegistry();
  const definition = registry.get('researcher');
  assert.ok(definition);
  assert.throws(() => (definition as { role: string }).role = 'mutated', TypeError);
  assert.deepEqual(registry.roles(), ['researcher', 'risk_reviewer']);
});
