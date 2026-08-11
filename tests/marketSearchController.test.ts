import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { MarketController } from '../server/api/market/market.controller.js';
import { MarketSearchService } from '../server/application/market/market-search.service.js';
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

test('returns application search results without exposing the provider adapter', async () => {
  const service = new MarketSearchService(async (query) => [{
    symbol: query,
    name: 'Apple',
    market: 'us',
    type: 'stock',
    source: 'local-index'
  }]);
  const controller = new MarketController(service, logger);
  const req = new EventEmitter();
  const res = response();

  await controller.search('AAPL', req as never, res as never);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    results: [{ symbol: 'AAPL', name: 'Apple', market: 'us', type: 'stock', source: 'local-index' }]
  });
});

test('rejects invalid market search text before calling the application service', async () => {
  let calls = 0;
  const service = new MarketSearchService(async () => {
    calls += 1;
    return [];
  });
  const controller = new MarketController(service, logger);
  const req = new EventEmitter();
  const res = response();

  await controller.search('', req as never, res as never);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { errorCode: 'invalid_request' });
  assert.equal(calls, 0);
});

test('forwards a request cancellation signal to the market application service', async () => {
  let receivedSignal: AbortSignal | undefined;
  let started: () => void = () => undefined;
  const startedSearch = new Promise<void>((resolve) => {
    started = resolve;
  });
  const service = new MarketSearchService(async (_query, { signal }) => {
    receivedSignal = signal;
    started();
    return new Promise((resolve) => {
      signal?.addEventListener('abort', () => resolve({ ok: false as const, errorCode: 'request_aborted' }), { once: true });
    });
  });
  const controller = new MarketController(service, logger);
  const req = new EventEmitter();
  const res = response();

  const pending = controller.search('AAPL', req as never, res as never);
  await startedSearch;
  req.emit('aborted');
  await pending;

  assert.ok(receivedSignal);
  assert.equal(receivedSignal.aborted, true);
});
