import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketController } from '../server/api/market/market.controller.js';
import { MarketSearchService } from '../server/application/market/market-search.service.js';

test('returns application search results without exposing the provider adapter', async () => {
  const service = new MarketSearchService(async (query) => [{
    symbol: query,
    name: 'Apple',
    market: 'us',
    type: 'stock',
    source: 'local-index'
  }]);
  const controller = new MarketController(service);

  assert.deepEqual(await controller.search('AAPL'), {
    results: [{ symbol: 'AAPL', name: 'Apple', market: 'us', type: 'stock', source: 'local-index' }]
  });
});

test('rejects invalid market search text before calling the application service', async () => {
  let calls = 0;
  const service = new MarketSearchService(async () => {
    calls += 1;
    return [];
  });
  const controller = new MarketController(service);

  await assert.rejects(() => controller.search(''), { code: 'invalid_request' });
  assert.equal(calls, 0);
});
