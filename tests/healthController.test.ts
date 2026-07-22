import assert from 'node:assert/strict';
import test from 'node:test';
import { HealthController } from '../server/api/health/health.controller.js';

test('returns a stable health payload without probing external providers', () => {
  assert.deepEqual(new HealthController().check(), { ok: true });
});
