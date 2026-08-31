import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../server/application/capabilities/capability.registry.js';
import type { CapabilityManifest } from '../server/application/capabilities/capability.types.js';
import { CapabilitiesController } from '../server/api/capabilities/capabilities.controller.js';

test('returns a stable, sanitized capability summary without executable details', () => {
  const registry = new CapabilityRegistry([
    {
      name: 'quote',
      kind: 'tool',
      version: '1.0.0',
      riskLevel: 'read_only',
      timeoutMs: 1000,
      maxCalls: 2,
      taskTypes: ['fast', 'reasoning'],
      description: 'Read-only quote lookup',
      requiresApproval: false,
      execute: async () => ({ ok: true })
    }
  ] as readonly CapabilityManifest[]);

  const first = registry.publicSummary();
  const second = registry.publicSummary();
  assert.deepEqual(first, second);
  assert.deepEqual(first, [{
    name: 'quote',
    kind: 'tool',
    version: '1.0.0',
    riskLevel: 'read_only',
    timeoutMs: 1000,
    maxCalls: 2,
    taskTypes: ['fast', 'reasoning'],
    description: 'Read-only quote lookup',
    requiresApproval: false
  }]);
  assert.equal(Object.hasOwn(first[0] ?? {}, 'execute'), false);
  assert.throws(() => (registry.manifests()[0] as { name: string }).name = 'mutated', TypeError);
});

test('controller exposes only the public capability summary', () => {
  const registry = new CapabilityRegistry([]);
  const controller = new CapabilitiesController(registry);
  assert.deepEqual(controller.list(), { capabilities: [] });
});
