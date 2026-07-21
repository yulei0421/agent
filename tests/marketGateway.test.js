import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketGateway } from '../server/market/gateway.js';
import { buildTencentQuoteUrl, parseTencentQuote } from '../server/market/providers/tencent.js';

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function textResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body
  };
}

function tencentQuote({
  prefix,
  name,
  code,
  price,
  previousClose,
  date = '20260717',
  time = '153000'
}) {
  const fields = ['51', name, code, String(price), String(previousClose)];
  fields[30] = date;
  fields[31] = time;
  return `v_${prefix}="${fields.join('~')}";`;
}

test('gets a normalized Yahoo US quote from the fixed Chart API URL', async () => {
  const requests = [];
  const gateway = createMarketGateway({
    fetchImpl: async (url) => {
      requests.push(url);
      return jsonResponse({
        chart: { result: [{
          meta: { regularMarketPrice: 210, previousClose: 200, currency: 'USD' },
          timestamp: [1_720_000_000],
          indicators: { quote: [{}] }
        }] }
      });
    },
    now: () => new Date('2026-07-15T00:00:00.000Z')
  });

  const result = await gateway.getQuote('aapl.us');

  assert.deepEqual(result, {
    ok: true,
    data: { price: 210, changePercent: 5, currency: 'USD' },
    meta: {
      source: 'yahoo-finance',
      asOf: '2024-07-03T09:46:40.000Z',
      observedAt: '2024-07-03T09:46:40.000Z',
      fetchedAt: '2026-07-15T00:00:00.000Z',
      ageSeconds: 64073600,
      delay: 'unknown',
      symbol: 'AAPL.US',
      confidence: 'provider',
      cached: false
    }
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0], /^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/chart\/AAPL\?/);
  assert.match(requests[0], /interval=1d/);
});

test('prefers a valid Eastmoney CN quote before the Tencent fallback', async () => {
  const requests = [];
  const gateway = createMarketGateway({
    fetchImpl: async (url) => {
      requests.push(url);
      assert.match(url, /^https:\/\/push2\.eastmoney\.com\/api\/qt\/stock\/get\?secid=1\.600519&fields=/);
      return jsonResponse({ data: { f43: 157890, f170: 123 } });
    }
  });

  const result = await gateway.getQuote('600519.SH');

  assert.deepEqual(result.data, { price: 1578.9, changePercent: 1.23, currency: 'CNY' });
  assert.equal(result.meta.source, 'eastmoney');
  assert.deepEqual(requests, [
    'https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fields=f43,f170,f58,f124'
  ]);
});

test('requests and normalizes the Eastmoney provider observation time with server freshness metadata', async () => {
  const requests = [];
  const gateway = createMarketGateway({
    fetchImpl: async (url) => {
      requests.push(url);
      return jsonResponse({ data: { f43: 157890, f170: 123, f124: 1784344500 } });
    },
    now: () => new Date('2026-07-18T03:20:00.000Z')
  });

  const result = await gateway.getQuote('600519.SH');

  assert.match(requests[0], /fields=f43,f170,f58,f124/);
  assert.equal(result.meta.observedAt, '2026-07-18T03:15:00.000Z');
  assert.equal(result.meta.asOf, '2026-07-18T03:15:00.000Z');
  assert.equal(result.meta.fetchedAt, '2026-07-18T03:20:00.000Z');
  assert.equal(result.meta.ageSeconds, 300);
});

test('rejects a future Eastmoney observation and falls back under the configured provider rules', async () => {
  const requests = [];
  const gateway = createMarketGateway({
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.startsWith('https://push2.eastmoney.com/')) {
        return jsonResponse({ data: { f43: 157890, f170: 123, f124: 1784345160 } });
      }
      return textResponse(tencentQuote({ prefix: 'sh600519', name: '贵州茅台', code: '600519', price: 1578.9, previousClose: 1559.72, date: '', time: '' }));
    },
    now: () => new Date('2026-07-18T03:20:00.000Z')
  });

  const result = await gateway.getQuote('600519.SH');

  assert.equal(result.ok, true);
  assert.equal(result.meta.source, 'tencent');
  assert.equal(result.meta.asOf, null);
  assert.equal(result.meta.observedAt, null);
  assert.deepEqual(requests.map((url) => new URL(url).origin), ['https://push2.eastmoney.com', 'https://qt.gtimg.cn']);
});

test('keeps an Eastmoney quote observation time unknown instead of using the gateway clock as the observation time', async () => {
  const gateway = createMarketGateway({
    fetchImpl: async () => jsonResponse({ data: { f43: 157890, f170: 123 } }),
    now: () => new Date('2026-07-18T03:20:00.000Z')
  });

  const result = await gateway.getQuote('600519.SH');

  assert.equal(result.ok, true);
  assert.equal(result.meta.source, 'eastmoney');
  assert.equal(result.meta.asOf, null);
  assert.equal(result.meta.observedAt, null);
  assert.equal(result.meta.fetchedAt, '2026-07-18T03:20:00.000Z');
});

test('falls back to Tencent when Eastmoney omits or corrupts its change percent', async () => {
  for (const f170 of [undefined, 'not-a-percent']) {
    const requests = [];
    const gateway = createMarketGateway({
      fetchImpl: async (url) => {
        requests.push(url);
        if (url.startsWith('https://push2.eastmoney.com/')) {
          return jsonResponse({ data: { f43: 157890, ...(f170 === undefined ? {} : { f170 }) } });
        }
        return textResponse(tencentQuote({ prefix: 'sh600519', name: '贵州茅台', code: '600519', price: 1578.9, previousClose: 1559.72 }));
      }
    });

    const result = await gateway.getQuote('600519.SH');

    assert.equal(result.ok, true);
    assert.equal(result.meta.source, 'tencent');
    assert.deepEqual(result.data, { price: 1578.9, changePercent: (1578.9 - 1559.72) / 1559.72 * 100, currency: 'CNY' });
    assert.deepEqual(requests, [
      'https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fields=f43,f170,f58,f124',
      'https://qt.gtimg.cn/q=sh600519'
    ]);
  }
});

test('aborts a timed-out Eastmoney request before falling back to Tencent', async () => {
  let eastmoneySignal;
  const requests = [];
  const gateway = createMarketGateway({
    fetchImpl: (url, options = {}) => {
      requests.push(url);
      if (url.startsWith('https://push2.eastmoney.com/')) {
        eastmoneySignal = options.signal;
        return new Promise((resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('request aborted')));
        });
      }
      return Promise.resolve(textResponse(tencentQuote({ prefix: 'sh600519', name: '贵州茅台', code: '600519', price: 1578.9, previousClose: 1559.72 })));
    },
    timeoutMs: 5
  });

  const result = await gateway.getQuote('600519.SH');

  assert.equal(result.ok, true);
  assert.equal(result.meta.source, 'tencent');
  assert.equal(eastmoneySignal.aborted, true);
  assert.deepEqual(requests, [
    'https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fields=f43,f170,f58,f124',
    'https://qt.gtimg.cn/q=sh600519'
  ]);
});

test('falls back to Tencent when Eastmoney returns an invalid CN quote', async () => {
  const requests = [];
  const gateway = createMarketGateway({
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.startsWith('https://push2.eastmoney.com/')) {
        return jsonResponse({ data: { f43: 'not-a-price', f170: 99 } });
      }
      assert.equal(url, 'https://qt.gtimg.cn/q=sh600519');
      return textResponse(tencentQuote({ prefix: 'sh600519', name: '贵州茅台', code: '600519', price: 1578.9, previousClose: 1559.72 }));
    }
  });

  const result = await gateway.getQuote('600519.SH');

  assert.deepEqual(result.data, { price: 1578.9, changePercent: (1578.9 - 1559.72) / 1559.72 * 100, currency: 'CNY' });
  assert.equal(result.meta.source, 'tencent');
  assert.deepEqual(requests, [
    'https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fields=f43,f170,f58,f124',
    'https://qt.gtimg.cn/q=sh600519'
  ]);
});

test('falls back to Tencent when Eastmoney has a network error or 5xx response', async () => {
  for (const eastmoneyFailure of [
    async () => { throw new TypeError('network unavailable'); },
    async () => jsonResponse({}, { status: 503 })
  ]) {
    const requests = [];
    const gateway = createMarketGateway({
      fetchImpl: async (url) => {
        requests.push(url);
        if (url.startsWith('https://push2.eastmoney.com/')) return eastmoneyFailure();
        assert.equal(url, 'https://qt.gtimg.cn/q=sh600519');
        return textResponse(tencentQuote({ prefix: 'sh600519', name: '贵州茅台', code: '600519', price: 1578.9, previousClose: 1559.72 }));
      }
    });

    const result = await gateway.getQuote('600519.SH');

    assert.equal(result.ok, true);
    assert.equal(result.meta.source, 'tencent');
    assert.deepEqual(requests, [
      'https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fields=f43,f170,f58,f124',
      'https://qt.gtimg.cn/q=sh600519'
    ]);
  }
});

test('does not bypass Eastmoney rate limits through Tencent', async () => {
  const requests = [];
  const gateway = createMarketGateway({
    fetchImpl: async (url) => {
      requests.push(url);
      return jsonResponse({}, { status: 429 });
    }
  });

  const result = await gateway.getQuote('600519.SH');

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'provider_rate_limited');
  assert.equal(result.meta.source, 'eastmoney');
  assert.deepEqual(requests, [
    'https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fields=f43,f170,f58,f124'
  ]);
});

test('builds Tencent quote URLs with fixed exchange prefixes', () => {
  assert.equal(buildTencentQuoteUrl({ canonical: '000001.SZ', market: 'cn' }), 'https://qt.gtimg.cn/q=sz000001');
  assert.equal(buildTencentQuoteUrl({ canonical: '600519.SH', market: 'cn' }), 'https://qt.gtimg.cn/q=sh600519');
  assert.equal(buildTencentQuoteUrl({ canonical: '0700.HK', market: 'hk' }), 'https://qt.gtimg.cn/q=hk00700');
});

test('parses Tencent CN and HK quote strings with response timestamps', () => {
  assert.deepEqual(
    parseTencentQuote(tencentQuote({ prefix: 'sz000001', name: '平安银行', code: '000001', price: 10.86, previousClose: 10.77 })),
    { name: '平安银行', price: 10.86, previousClose: 10.77, changePercent: (10.86 - 10.77) / 10.77 * 100, currency: 'CNY', asOf: '2026-07-17T07:30:00.000Z' }
  );
  assert.deepEqual(
    parseTencentQuote(tencentQuote({ prefix: 'hk00700', name: '腾讯控股', code: '00700', price: 500, previousClose: 490 })),
    { name: '腾讯控股', price: 500, previousClose: 490, changePercent: (500 - 490) / 490 * 100, currency: 'HKD', asOf: '2026-07-17T07:30:00.000Z' }
  );
});

test('uses Tencent compact timestamp field without treating change amount as time', () => {
  const quote = tencentQuote({
    prefix: 'sz000001',
    name: '平安银行',
    code: '000001',
    price: 10.82,
    previousClose: 10.77,
    date: '20260717102048',
    time: '0.05'
  });

  assert.equal(parseTencentQuote(quote).asOf, '2026-07-17T02:20:48.000Z');
});

test('rejects empty and non-numeric Tencent quote strings', () => {
  for (const payload of ['', 'v_sz000001="51~平安银行~000001~abc~10.77";']) {
    assert.throws(() => parseTencentQuote(payload), { code: 'provider_invalid_response' });
  }
});

test('gets normalized Eastmoney Shenzhen and Tencent Hong Kong quotes from fixed endpoints', async () => {
  const requests = [];
  const gateway = createMarketGateway({
    fetchImpl: async (url) => {
      requests.push(url);
      if (url === 'https://push2.eastmoney.com/api/qt/stock/get?secid=0.000001&fields=f43,f170,f58,f124') {
        return jsonResponse({ data: { f43: 1234, f170: -56 } });
      }
      return textResponse(tencentQuote({ prefix: 'hk00700', name: '腾讯控股', code: '00700', price: 500, previousClose: 490, date: '20260714' }));
    },
    now: () => new Date('2026-07-15T00:00:00.000Z')
  });

  const shenzhen = await gateway.getQuote('000001.sz');
  const hongKong = await gateway.getQuote('0700.hk');

  assert.deepEqual(shenzhen.data, { price: 12.34, changePercent: -0.56, currency: 'CNY' });
  assert.equal(shenzhen.meta.source, 'eastmoney');
  assert.equal(shenzhen.meta.symbol, '000001.SZ');
  assert.deepEqual(hongKong.data, { price: 500, changePercent: (500 - 490) / 490 * 100, currency: 'HKD' });
  assert.equal(hongKong.meta.source, 'tencent');
  assert.equal(hongKong.meta.symbol, '0700.HK');
  assert.deepEqual(requests, [
    'https://push2.eastmoney.com/api/qt/stock/get?secid=0.000001&fields=f43,f170,f58,f124',
    'https://qt.gtimg.cn/q=hk00700'
  ]);
});

test('keeps Tencent observation time unknown when the provider does not supply it', async () => {
  const gateway = createMarketGateway({
    fetchImpl: async () => textResponse(tencentQuote({ prefix: 'sz000001', name: '平安银行', code: '000001', price: 10.86, previousClose: 10.77, date: '', time: '' })),
    now: () => new Date('2026-07-15T00:00:00.000Z')
  });

  const result = await gateway.getQuote('000001.SZ');

  assert.equal(result.ok, true);
  assert.equal(result.meta.asOf, null);
  assert.equal(result.meta.observedAt, null);
  assert.equal(result.meta.fetchedAt, '2026-07-15T00:00:00.000Z');
});

test('gets a normalized Binance crypto quote from the fixed ticker URL', async () => {
  const requests = [];
  const gateway = createMarketGateway({
    fetchImpl: async (url) => {
      requests.push(url);
      return jsonResponse({ lastPrice: '60000.25', priceChangePercent: '-2.5', closeTime: 1_720_000_000_000 });
    },
    now: () => new Date('2026-07-15T00:00:00.000Z')
  });

  const result = await gateway.getQuote('btc/usdt');

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { price: 60000.25, changePercent: -2.5, currency: 'USDT' });
  assert.equal(result.meta.source, 'binance');
  assert.equal(result.meta.asOf, '2024-07-03T09:46:40.000Z');
  assert.match(requests[0], /^https:\/\/api\.binance\.com\/api\/v3\/ticker\/24hr\?symbol=BTCUSDT$/);
});

test('gets Binance candles from the fixed klines URL', async () => {
  const gateway = createMarketGateway({
    fetchImpl: async (url) => {
      assert.equal(url, 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=24');
      return jsonResponse([
        [1_720_000_000_000, '10', '12', '9', '11', '123'],
        [1_720_003_600_000, '11', '14', '10', '13', '456']
      ]);
    },
    now: () => new Date('2026-07-15T00:00:00.000Z')
  });

  const result = await gateway.getCandles('BTC/USDT');

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, [
    { time: '2024-07-03T09:46:40.000Z', open: 10, high: 12, low: 9, close: 11, volume: 123 },
    { time: '2024-07-03T10:46:40.000Z', open: 11, high: 14, low: 10, close: 13, volume: 456 }
  ]);
  assert.equal(result.meta.source, 'binance');
});

test('caches an Eastmoney quote without inventing an observation time', async () => {
  let fetchCalls = 0;
  let nowCalls = 0;
  const gateway = createMarketGateway({
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ data: { f43: 10000, f170: 0 } });
    },
    now: () => {
      nowCalls += 1;
      return new Date('2026-07-15T00:00:00.000Z');
    }
  });

  const first = await gateway.getQuote('600519.sh');
  const second = await gateway.getQuote('600519.SH');

  assert.equal(first.meta.cached, false);
  assert.equal(second.meta.cached, true);
  assert.equal(fetchCalls, 1);
  assert.equal(nowCalls, 1);
});

test('de-duplicates concurrent quote requests and caches only successful results', async () => {
  let fetchCalls = 0;
  let completeFetch;
  const gateway = createMarketGateway({
    fetchImpl: () => {
      fetchCalls += 1;
      return new Promise((resolve) => { completeFetch = resolve; });
    }
  });

  const first = gateway.getQuote('BTC/USDT');
  const second = gateway.getQuote('BTC/USDT');
  assert.equal(fetchCalls, 1);
  completeFetch(jsonResponse({ lastPrice: '100', priceChangePercent: '0', closeTime: 1_720_000_000_000 }));

  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal((await gateway.getQuote('BTC/USDT')).meta.cached, true);
  assert.equal(fetchCalls, 1);

  let failedCalls = 0;
  const failedGateway = createMarketGateway({ fetchImpl: async () => {
    failedCalls += 1;
    return jsonResponse({}, { status: 503 });
  } });
  assert.equal((await failedGateway.getQuote('AAPL')).ok, false);
  assert.equal((await failedGateway.getQuote('AAPL')).ok, false);
  assert.equal(failedCalls, 2);
});

test('maps a 429 response to provider_rate_limited without throwing', async () => {
  const gateway = createMarketGateway({ fetchImpl: async () => jsonResponse({}, { status: 429 }) });

  const result = await gateway.getQuote('AAPL');

  assert.deepEqual(result, {
    ok: false,
    error: { code: 'provider_rate_limited', message: 'Market data provider rate limited the request.' },
    meta: {
      source: 'yahoo-finance',
      symbol: 'AAPL.US',
      asOf: null,
      delay: 'unknown',
      confidence: null,
      cached: false
    }
  });
});

test('maps malformed upstream JSON and unexpected shapes to provider_invalid_response', async () => {
  const malformedJsonGateway = createMarketGateway({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } })
  });
  const unexpectedShapeGateway = createMarketGateway({
    fetchImpl: async () => jsonResponse({ chart: { result: [] } })
  });

  for (const gateway of [malformedJsonGateway, unexpectedShapeGateway]) {
    const result = await gateway.getQuote('AAPL');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'provider_invalid_response');
    assert.deepEqual(result.meta, {
      source: 'yahoo-finance',
      symbol: 'AAPL.US',
      asOf: null,
      delay: 'unknown',
      confidence: null,
      cached: false
    });
  }
});

test('returns provider_not_available for operations unsupported by a configured provider', async () => {
  const gateway = createMarketGateway({ fetchImpl: async () => { throw new Error('must not fetch'); } });

  const result = await gateway.getCandles('600519.SH');

  assert.deepEqual(result, {
    ok: false,
    error: { code: 'provider_not_available', message: 'Candles are not available for this market.' },
    meta: {
      source: 'eastmoney',
      symbol: '600519.SH',
      asOf: null,
      delay: 'unknown',
      confidence: null,
      cached: false
    }
  });
});

test('returns provider_invalid_response for empty Yahoo and Binance candle arrays', async () => {
  const yahooGateway = createMarketGateway({
    fetchImpl: async () => jsonResponse({
      chart: { result: [{ timestamp: [], indicators: { quote: [{ open: [], high: [], low: [], close: [], volume: [] }] } }] }
    })
  });
  const binanceGateway = createMarketGateway({ fetchImpl: async () => jsonResponse([]) });

  for (const [gateway, symbol, source, delay] of [
    [yahooGateway, 'AAPL', 'yahoo-finance', 'unknown'],
    [binanceGateway, 'BTC/USDT', 'binance', 'exchange']
  ]) {
    const result = await gateway.getCandles(symbol);
    assert.deepEqual(result, {
      ok: false,
      error: { code: 'provider_invalid_response', message: 'Market data provider returned an invalid response.' },
      meta: { source, symbol: symbol === 'AAPL' ? 'AAPL.US' : symbol, asOf: null, delay, confidence: null, cached: false }
    });
  }
});

test('times out a hung provider request as provider_unavailable', async () => {
  const gateway = createMarketGateway({
    fetchImpl: () => new Promise(() => {}),
    timeoutMs: 5
  });

  const result = await gateway.getQuote('AAPL');

  assert.deepEqual(result, {
    ok: false,
    error: { code: 'provider_unavailable', message: 'Market data provider is unavailable.' },
    meta: { source: 'yahoo-finance', symbol: 'AAPL.US', asOf: null, delay: 'unknown', confidence: null, cached: false }
  });
});

test('returns a complete failure meta for invalid symbols', async () => {
  const gateway = createMarketGateway();

  const result = await gateway.getQuote('not a symbol');

  assert.deepEqual(result.meta, {
    source: null,
    symbol: null,
    asOf: null,
    delay: null,
    confidence: null,
    cached: false
  });
});

test('times out when response.json hangs as provider_unavailable', async () => {
  const gateway = createMarketGateway({
    fetchImpl: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }),
    timeoutMs: 5
  });
  const guard = new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 25));

  const result = await Promise.race([gateway.getQuote('AAPL'), guard]);

  assert.deepEqual(result, {
    ok: false,
    error: { code: 'provider_unavailable', message: 'Market data provider is unavailable.' },
    meta: { source: 'yahoo-finance', symbol: 'AAPL.US', asOf: null, delay: 'unknown', confidence: null, cached: false }
  });
});

test('rejects non-numeric Binance quote values as provider_invalid_response', async () => {
  for (const lastPrice of [null, '', '   ', true, [], {}]) {
    const gateway = createMarketGateway({
      fetchImpl: async () => jsonResponse({ lastPrice, priceChangePercent: '0', closeTime: 1_720_000_000_000 })
    });

    const result = await gateway.getQuote('BTC/USDT');

    assert.equal(result.ok, false, `expected ${JSON.stringify(lastPrice)} to be rejected`);
    assert.equal(result.error.code, 'provider_invalid_response');
  }
});

test('isolates cached quote data from caller mutation', async () => {
  const gateway = createMarketGateway({
    fetchImpl: async () => jsonResponse({ lastPrice: '100', priceChangePercent: '0', closeTime: 1_720_000_000_000 })
  });

  const first = await gateway.getQuote('BTC/USDT');
  first.data.price = 999;
  const second = await gateway.getQuote('BTC/USDT');

  assert.equal(second.data.price, 100);
  assert.equal(second.meta.cached, true);
});

test('evicts expired entries and bounds the cache by maxCacheEntries', async () => {
  let fetchCalls = 0;
  const gateway = createMarketGateway({
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({
        chart: { result: [{
          meta: { regularMarketPrice: fetchCalls, previousClose: 1, currency: 'USD' },
          timestamp: [1_720_000_000],
          indicators: { quote: [{}] }
        }] }
      });
    },
    cacheTtlMs: 0,
    maxCacheEntries: 2
  });

  const expiredFirst = await gateway.getQuote('AAPL');
  const expiredSecond = await gateway.getQuote('AAPL');
  assert.equal(expiredFirst.meta.cached, false);
  assert.equal(expiredSecond.meta.cached, false);

  const boundedGateway = createMarketGateway({
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({
        chart: { result: [{
          meta: { regularMarketPrice: fetchCalls, previousClose: 1, currency: 'USD' },
          timestamp: [1_720_000_000],
          indicators: { quote: [{}] }
        }] }
      });
    },
    cacheTtlMs: 60_000,
    maxCacheEntries: 2
  });

  await boundedGateway.getQuote('AAPL');
  await boundedGateway.getQuote('MSFT');
  await boundedGateway.getQuote('GOOG');
  const evicted = await boundedGateway.getQuote('AAPL');

  assert.equal(fetchCalls, 6);
  assert.equal(evicted.meta.cached, false);
});

test('normalizes invalid cache TTL values to the finite default', async () => {
  const originalDateNow = Date.now;
  let currentTime = 1_000;
  Date.now = () => currentTime;

  try {
    for (const cacheTtlMs of [Number.NaN, -1, Infinity]) {
      let fetchCalls = 0;
      const gateway = createMarketGateway({
        cacheTtlMs,
        fetchImpl: async () => {
          fetchCalls += 1;
          return jsonResponse({ lastPrice: '1', priceChangePercent: '0', closeTime: 1_720_000_000_000 });
        }
      });

      const first = await gateway.getQuote('BTC/USDT');
      currentTime += 2_999;
      const cached = await gateway.getQuote('BTC/USDT');
      currentTime += 2;
      const expired = await gateway.getQuote('BTC/USDT');

      assert.equal(first.meta.cached, false);
      assert.equal(cached.meta.cached, true);
      assert.equal(expired.meta.cached, false);
      assert.equal(fetchCalls, 2);
    }
  } finally {
    Date.now = originalDateNow;
  }
});

test('cancels an in-flight market provider request immediately when the client aborts', async () => {
  const controller = new AbortController();
  let receivedSignal;
  const gateway = createMarketGateway({
    fetchImpl: async (_url, options) => {
      receivedSignal = options.signal;
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    }
  });
  const pending = gateway.getQuote('AAPL', { signal: controller.signal });

  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();

  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'request_aborted');
  assert.equal(receivedSignal.aborted, true);
});

test('keeps a shared market fetch alive when an earlier caller aborts', async () => {
  const firstController = new AbortController();
  const secondController = new AbortController();
  let fetchCalls = 0;
  let completeFetch;
  let providerSignal;
  const gateway = createMarketGateway({
    fetchImpl: async (_url, options) => {
      fetchCalls += 1;
      providerSignal = options.signal;
      return new Promise((resolve) => { completeFetch = resolve; });
    }
  });

  const first = gateway.getQuote('AAPL', { signal: firstController.signal });
  const second = gateway.getQuote('AAPL', { signal: secondController.signal });
  firstController.abort();

  assert.equal((await first).error.code, 'request_aborted');
  assert.equal(fetchCalls, 1);
  assert.equal(providerSignal.aborted, false);
  completeFetch(jsonResponse({
    chart: { result: [{
      meta: { regularMarketPrice: 210, previousClose: 200, currency: 'USD' },
      timestamp: [1_720_000_000],
      indicators: { quote: [{}] }
    }] }
  }));

  assert.equal((await second).ok, true);
  assert.equal(fetchCalls, 1);
});

test('starts a fresh market fetch when a new caller follows the last consumer abort', async () => {
  const firstController = new AbortController();
  let fetchCalls = 0;
  let firstProviderSignal;
  const gateway = createMarketGateway({
    fetchImpl: async (_url, options) => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        firstProviderSignal = options.signal;
        return new Promise(() => {});
      }
      return jsonResponse({
        chart: { result: [{
          meta: { regularMarketPrice: 210, previousClose: 200, currency: 'USD' },
          timestamp: [1_720_000_000],
          indicators: { quote: [{}] }
        }] }
      });
    }
  });

  const first = gateway.getQuote('AAPL', { signal: firstController.signal });
  firstController.abort();
  const second = gateway.getQuote('AAPL');

  assert.equal(firstProviderSignal.aborted, true);
  assert.equal(fetchCalls, 2);
  assert.equal((await first).error.code, 'request_aborted');
  assert.equal((await second).ok, true);
});
