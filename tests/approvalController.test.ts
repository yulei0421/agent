import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { ApprovalController } from '../server/api/approval/approval.controller.js';
import { InMemoryApprovalCoordinator } from '../server/agent/approval-coordinator.js';
import type { AppLoggerService } from '../server/infrastructure/logging/app-logger.service.js';

const logger = { info() {}, error() {} } as unknown as AppLoggerService;

function response() {
  const value = Object.assign(new EventEmitter(), {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      value.statusCode = code;
      return value;
    },
    json(body: unknown) {
      value.body = body;
      return value;
    }
  });
  return value;
}

test('approves a pending in-memory approval and returns a stable public payload', async () => {
  const coordinator = new InMemoryApprovalCoordinator({ ttlMs: 60_000 });
  const handle = coordinator.request([{ name: 'get_quote', arguments: '{"symbol":"AAPL"}' }]);
  const controller = new ApprovalController(coordinator, logger);
  const res = response();

  await controller.decide(handle.id, 'approved', res as never, { requestId: 'request_1' } as never);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { approvalId: handle.id, decision: 'approved' });
  assert.deepEqual(await handle.wait, { id: handle.id, status: 'approved', decision: 'approved' });
});

test('returns a public approval_not_found error for unknown or expired approvals', async () => {
  const coordinator = new InMemoryApprovalCoordinator({ ttlMs: 0 });
  const handle = coordinator.request([{ name: 'get_quote', arguments: '{}' }], () => 10_000);
  const controller = new ApprovalController(coordinator, logger);
  const res = response();

  await controller.decide(handle.id, 'approved', res as never, { requestId: 'request_2' } as never);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { errorCode: 'approval_not_found' });
});

test('rejects invalid decisions without touching the coordinator', async () => {
  let calls = 0;
  const coordinator = {
    async resolve() {
      calls += 1;
    }
  } as unknown as InMemoryApprovalCoordinator;
  const controller = new ApprovalController(coordinator, logger);
  const res = response();

  await controller.decide('approval_1', 'maybe', res as never, { requestId: 'request_3' } as never);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { errorCode: 'invalid_request' });
  assert.equal(calls, 0);
});
