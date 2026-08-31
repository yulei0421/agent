import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelTask, getTask } from '../src/lib/tasks.js';

const id = 'A'.repeat(32);

test('gets and cancels a server task with a validated opaque id', async () => {
  const requests: { url: string; method: string }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify({ id, status: 'cancelled', createdAt: 1, updatedAt: 2, attempts: 1, eventCount: 1, expiresAt: 3 }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal((await getTask(id)).id, id);
    assert.equal((await cancelTask(id)).status, 'cancelled');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(requests, [
    { url: `/api/tasks/${id}`, method: 'GET' },
    { url: `/api/tasks/${id}/cancel`, method: 'POST' }
  ]);
});

test('rejects malformed task IDs before making a request', async () => {
  await assert.rejects(() => getTask('bad'), /任务 ID 无效/);
  await assert.rejects(() => cancelTask('bad'), /任务 ID 无效/);
});
