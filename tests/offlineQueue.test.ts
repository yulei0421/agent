import assert from 'node:assert/strict';
import test from 'node:test';
import { nextQueueState } from '../src/lib/offlineQueue.js';

test('offline queue keeps failed message and removes sent message', () => {
  const queued = nextQueueState([], { type: 'enqueue', message: { id: 'm1', content: 'hello' } });
  assert.equal(queued.length, 1);
  assert.deepEqual(nextQueueState(queued, { type: 'sent', id: 'm1' }), []);
  assert.deepEqual(nextQueueState(queued, { type: 'failed', id: 'm1' }), queued);
});
