import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryApprovalCoordinator } from '../server/agent/approval-coordinator.js';
import { AppError } from '../server/domain/errors/app-error.js';

function createApproval(calls: readonly string[] = ['get_weather']) {
  return calls.map((name) => ({ id: `call_${name}`, name, arguments: '{}' }));
}

test('creates a pending approval then resolves it with a public approval id', async () => {
  const coordinator = new InMemoryApprovalCoordinator({ ttlMs: 60_000 });

  const handle = coordinator.request(createApproval());
  await coordinator.resolve(handle.id, { decision: 'approved' });

  assert.equal(handle.status, 'pending');
  assert.deepEqual(await handle.wait, { id: handle.id, status: 'approved', decision: 'approved' });
});

test('reports an explicit rejection without executing any tool', async () => {
  const coordinator = new InMemoryApprovalCoordinator({ ttlMs: 60_000 });
  const handle = coordinator.request(createApproval());

  await coordinator.resolve(handle.id, { decision: 'rejected' });

  assert.deepEqual(await handle.wait, { id: handle.id, status: 'rejected', decision: 'rejected' });
});

test('expires pending approvals after the short in-memory window', async () => {
  const coordinator = new InMemoryApprovalCoordinator({ ttlMs: 1 });
  let now = 10_000;
  const handle = coordinator.request(createApproval(), () => now);

  now = 10_002;

  assert.deepEqual(await handle.wait, { id: handle.id, status: 'expired', decision: 'rejected' });
  assert.equal(coordinator.status('approval_3', () => now), undefined);
  assert.equal(coordinator.status(handle.id, () => now), undefined);
});

test('treats repeated and unknown decisions as not found', async () => {
  const coordinator = new InMemoryApprovalCoordinator({ ttlMs: 60_000 });

  const handle = coordinator.request(createApproval());
  await coordinator.resolve(handle.id, { decision: 'approved' });
  await assert.rejects(
    () => coordinator.resolve(handle.id, { decision: 'approved' }),
    (error: unknown) => error instanceof AppError && error.code === 'approval_not_found'
  );
  await assert.rejects(
    () => coordinator.resolve('unknown', { decision: 'approved' }),
    (error: unknown) => error instanceof AppError && error.code === 'approval_not_found'
  );
});

test('waits are released when the owner request is cancelled', async () => {
  const coordinator = new InMemoryApprovalCoordinator({ ttlMs: 60_000 });
  const controller = new AbortController();
  const handle = coordinator.request(createApproval(), () => Date.now(), controller.signal);

  controller.abort();

  assert.deepEqual(await handle.wait, { id: handle.id, status: 'cancelled', decision: 'rejected' });
});
