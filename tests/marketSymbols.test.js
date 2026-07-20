import assert from 'node:assert/strict';
import test from 'node:test';
import { getAllowedOrigins, getMarketConfig } from '../server/market/config.js';
import { normalizeSymbol } from '../server/market/symbols.js';

test('normalizeSymbol maps supported public-market symbols to fixed provider symbols', () => {
  assert.deepEqual(normalizeSymbol('600519.SH'), {
    canonical: '600519.SH',
    market: 'cn',
    providerSymbol: '600519.SS'
  });
  assert.deepEqual(normalizeSymbol('000001.SZ'), {
    canonical: '000001.SZ',
    market: 'cn',
    providerSymbol: '000001.SZ'
  });
  assert.deepEqual(normalizeSymbol('600519.SS'), {
    canonical: '600519.SH',
    market: 'cn',
    providerSymbol: '600519.SS'
  });
  assert.deepEqual(normalizeSymbol('0700.HK'), {
    canonical: '0700.HK',
    market: 'hk',
    providerSymbol: '0700.HK'
  });
  assert.deepEqual(normalizeSymbol('AAPL.US'), {
    canonical: 'AAPL.US',
    market: 'us',
    providerSymbol: 'AAPL'
  });
  assert.deepEqual(normalizeSymbol('AAPL'), {
    canonical: 'AAPL.US',
    market: 'us',
    providerSymbol: 'AAPL'
  });
  assert.deepEqual(normalizeSymbol('BTC/USDT'), {
    canonical: 'BTC/USDT',
    market: 'crypto',
    providerSymbol: 'BTCUSDT'
  });
});

test('normalizeSymbol rejects unsupported or malformed symbols with a clear error', () => {
  for (const value of ['', '600519', 'AAPL.CN', 'BTC-USDT', null]) {
    assert.throws(() => normalizeSymbol(value), /Invalid market symbol/);
  }
});

test('getMarketConfig exposes only fixed public providers and known delay semantics', () => {
  assert.deepEqual(getMarketConfig('cn'), {
    configured: true,
    provider: 'eastmoney',
    delay: 'unknown'
  });
  assert.deepEqual(getMarketConfig('hk'), {
    configured: true,
    provider: 'tencent',
    delay: 'unknown'
  });
  assert.deepEqual(getMarketConfig('us'), {
    configured: true,
    provider: 'yahoo-finance',
    delay: 'unknown'
  });
  assert.deepEqual(getMarketConfig('crypto'), {
    configured: true,
    provider: 'binance',
    delay: 'exchange'
  });
  assert.throws(() => getMarketConfig('forex'), /Unsupported market/);
});

test('getMarketConfig rejects inherited, non-string, and unknown markets', () => {
  for (const market of ['toString', '__proto__', Symbol('cn'), 123]) {
    assert.throws(() => getMarketConfig(market), /Unsupported market/);
  }

  assert.equal(Object.isFrozen(getMarketConfig('cn')), true);
});

test('getAllowedOrigins returns the immutable provider allowlist', () => {
  const origins = getAllowedOrigins();

  assert.deepEqual(origins, [
    'https://query1.finance.yahoo.com',
    'https://push2.eastmoney.com',
    'https://searchapi.eastmoney.com',
    'https://smartbox.gtimg.cn',
    'https://qt.gtimg.cn',
    'https://api.binance.com'
  ]);
  assert.equal(Object.isFrozen(origins), true);
  assert.throws(() => origins.push('https://example.com'), TypeError);
});
