import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskController } from '../server/api/tasks/task.controller.js';
import { InMemoryTaskRuntime } from '../server/application/tasks/task-runtime.js';

function response() {
  return {
    code: 0,
    body: undefined as unknown,
    status(code: number) { this.code = code; return this; },
    json(value: unknown) { this.body = value; return this; }
  };
}

test('returns a safe task summary and cancels through the HTTP controller', () => {
  const runtime = new InMemoryTaskRuntime();
  const task = runtime.create();
  const controller = new TaskController(runtime);
  const found = response();
  controller.get(task.id, found as never);
  assert.equal(found.code, 200);
  assert.equal((found.body as { id: string }).id, task.id);

  const cancelled = response();
  controller.cancel(task.id, cancelled as never);
  assert.equal(cancelled.code, 200);
  assert.equal((cancelled.body as { status: string }).status, 'cancelled');
  assert.equal(task.signal.aborted, true);
});

test('returns not_found for malformed or unknown task IDs', () => {
  const controller = new TaskController(new InMemoryTaskRuntime());
  for (const invoke of [
    (res: ReturnType<typeof response>) => controller.get('bad', res as never),
    (res: ReturnType<typeof response>) => controller.cancel('bad', res as never)
  ]) {
    const res = response();
    invoke(res);
    assert.equal(res.code, 404);
    assert.deepEqual(res.body, { errorCode: 'not_found' });
  }
});
