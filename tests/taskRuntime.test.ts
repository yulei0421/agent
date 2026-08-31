import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTaskRuntime } from '../server/application/tasks/task-runtime.js';

test('creates a running task and exposes only a safe summary', () => {
  const runtime = new InMemoryTaskRuntime({ ttlMs: 1000, maxEntries: 2 });
  const task = runtime.create(1_000);
  assert.match(task.id, /^[A-Za-z0-9_-]{32,128}$/u);
  assert.equal(task.signal.aborted, false);
  assert.deepEqual(runtime.summary(task.id, 1_000), {
    id: task.id,
    status: 'running',
    createdAt: 1_000,
    updatedAt: 1_000,
    attempts: 1,
    eventCount: 0,
    expiresAt: 2_000
  });
});

test('cancels idempotently and aborts the task signal', () => {
  const runtime = new InMemoryTaskRuntime({ ttlMs: 1000 });
  const task = runtime.create(1_000);
  assert.equal(runtime.cancel(task.id, 1_100)?.status, 'cancelled');
  assert.equal(task.signal.aborted, true);
  assert.equal(runtime.cancel(task.id, 1_200)?.status, 'cancelled');
});

test('marks completion and expires old tasks without exposing internal state', () => {
  const runtime = new InMemoryTaskRuntime({ ttlMs: 1000 });
  const task = runtime.create(1_000);
  runtime.recordEvent(task.id, 1_100);
  assert.equal(runtime.complete(task.id, 'completed', 1_200)?.status, 'completed');
  assert.equal(runtime.summary(task.id, 1_999)?.eventCount, 1);
  assert.equal(runtime.summary(task.id, 2_000), undefined);
  assert.equal(runtime.summary(task.id, 2_001), undefined);
});

test('bounds retained tasks by removing the oldest entry', () => {
  const runtime = new InMemoryTaskRuntime({ ttlMs: 10_000, maxEntries: 2 });
  const first = runtime.create(1_000);
  runtime.create(1_001);
  const third = runtime.create(1_002);
  assert.equal(runtime.summary(first.id, 1_002), undefined);
  assert.ok(runtime.summary(third.id, 1_002));
});
