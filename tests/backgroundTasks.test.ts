import assert from 'node:assert/strict';
import test from 'node:test';
import { BackgroundTaskService } from '../server/application/tasks/background-task.service.js';
import { InMemoryTaskRuntime } from '../server/application/tasks/task-runtime.js';
import { TaskNotificationService } from '../server/application/tasks/task-notification.service.js';

test('background task continues independently and replays emitted events', async () => {
  const runtime = new InMemoryTaskRuntime({ ttlMs: 10_000 });
  const notifications = new TaskNotificationService();
  const service = new BackgroundTaskService(runtime, notifications);
  const handle = service.start(async ({ emit }) => {
    emit({ type: 'delta', content: 'done' });
    return [{ type: 'done' }];
  }, { idempotencyKey: 'job-1' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runtime.summary(handle.id)?.status, 'completed');
  assert.equal(runtime.events(handle.id).length, 1);
  assert.equal(notifications.list(handle.id).at(-1)?.status, 'completed');
});

test('idempotency key returns the same task handle', () => {
  const runtime = new InMemoryTaskRuntime();
  const first = runtime.create(1_000, 'same');
  const second = runtime.create(1_001, 'same');
  assert.equal(second.id, first.id);
});

test('retry starts a new background attempt after failure', async () => {
  const runtime = new InMemoryTaskRuntime({ ttlMs: 10_000 });
  const service = new BackgroundTaskService(runtime);
  let attempts = 0;
  const handle = service.start(async () => {
    attempts += 1;
    if (attempts === 1) return [{ type: 'error', message: 'temporary' }];
    return [{ type: 'done' }];
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runtime.summary(handle.id)?.status, 'failed');
  runtime.retry(handle.id);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runtime.summary(handle.id)?.status, 'completed');
  assert.equal(runtime.summary(handle.id)?.attempts, 2);
});
