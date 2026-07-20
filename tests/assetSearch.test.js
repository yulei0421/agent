import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildEastmoneySuggestUrl,
  buildTencentSuggestUrl,
  createAssetSearch,
  parseTencentSuggest,
  createChineseAssetNameResolver,
  resolveChineseAssetName,
  resolveChineseAssetNameWithStatus
} from '../server/market/search.js';
import { searchAssets } from '../src/lib/market.js';

test('asset search resolves local Chinese and English aliases without a provider request', async () => {
  const search = createAssetSearch({
    fetchImpl: async () => {
      throw new Error('local matches must not call Yahoo');
    }
  });

  assert.deepEqual(await search(' 贵州茅台 '), [{
    symbol: '600519.SH', name: '贵州茅台', market: 'cn', type: 'stock', source: 'local-index'
  }]);
  assert.deepEqual(await search('tEnCeNt'), [{
    symbol: '0700.HK', name: '腾讯控股', market: 'hk', type: 'stock', source: 'local-index'
  }]);
  assert.deepEqual(await search('Apple'), [{
    symbol: 'AAPL', name: 'Apple', market: 'us', type: 'stock', source: 'local-index'
  }]);
  assert.deepEqual(await search('btc'), [{
    symbol: 'BTC/USDT', name: '比特币', market: 'crypto', type: 'crypto', source: 'local-index'
  }]);
});

test('asset search resolves canonical and provider symbols directly without a provider request', async () => {
  const search = createAssetSearch({
    fetchImpl: async () => {
      throw new Error('direct symbols must not call providers');
    }
  });

  assert.deepEqual(await search(' BTC/USDT '), [{
    symbol: 'BTC/USDT', name: 'BTC/USDT', market: 'crypto', type: 'crypto', source: 'direct-symbol'
  }]);
  assert.deepEqual(await search('600519.SH'), [{
    symbol: '600519.SH', name: '600519.SH', market: 'cn', type: 'stock', source: 'direct-symbol'
  }]);
  assert.deepEqual(await search('000001.SZ'), [{
    symbol: '000001.SZ', name: '000001.SZ', market: 'cn', type: 'stock', source: 'direct-symbol'
  }]);
  assert.deepEqual(await search('0700.HK'), [{
    symbol: '0700.HK', name: '0700.HK', market: 'hk', type: 'stock', source: 'direct-symbol'
  }]);
  assert.deepEqual(await search('AAPL'), [{
    symbol: 'AAPL', name: 'AAPL.US', market: 'us', type: 'stock', source: 'direct-symbol'
  }]);
});

test('Tencent smartbox uses a fixed URL and parses real Chinese stock suggestions before fallbacks', async () => {
  const requestedUrls = [];
  const realSmartboxHint = String.raw`v_hint="sz~000001~\u5e73\u5b89\u94f6\u884c~payh~GP-A^hk~00700~\u817e\u8baf\u63a7\u80a1~txkg~GP^sh~601857~\u4e2d\u56fd\u77f3\u6cb9~zgsy~GP-A^hk~00857~\u4e2d\u56fd\u77f3\u6cb9\u80a1\u4efd~zgsygf~GP^sz~399001~\u6df1\u8bc1\u6210\u6307~szcz~ZS^sh~510300~\u6caa\u6df1300ETF~hs300~ZQ"`;
  const search = createAssetSearch({
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      if (String(url).startsWith('https://smartbox.gtimg.cn')) {
        return new Response(realSmartboxHint, { status: 200 });
      }
      throw new Error('fallback providers must not prevent Tencent results');
    }
  });

  assert.deepEqual(await search('平安银行'), [
    { symbol: '000001.SZ', name: '平安银行', market: 'cn', type: 'stock', source: 'tencent-smartbox' },
    { symbol: '0700.HK', name: '腾讯控股', market: 'hk', type: 'stock', source: 'tencent-smartbox' },
    { symbol: '601857.SH', name: '中国石油', market: 'cn', type: 'stock', source: 'tencent-smartbox' },
    { symbol: '0857.HK', name: '中国石油股份', market: 'hk', type: 'stock', source: 'tencent-smartbox' }
  ]);
  assert.equal(buildTencentSuggestUrl('腾讯?domain=https://attacker.example/path'), 'https://smartbox.gtimg.cn/s3/?t=all&q=%E8%85%BE%E8%AE%AF%3Fdomain%3Dhttps%3A%2F%2Fattacker.example%2Fpath');
  assert.deepEqual(requestedUrls.map((url) => new URL(url).origin), [
    'https://smartbox.gtimg.cn',
    'https://searchapi.eastmoney.com',
    'https://query1.finance.yahoo.com'
  ]);
});

test('Tencent smartbox rejects non-assignment JavaScript without executing it', async () => {
  assert.deepEqual(parseTencentSuggest('globalThis.smartboxWasExecuted = true'), []);
  assert.deepEqual(parseTencentSuggest('v_hint="sz~000001~平安银行~payh~GP"; globalThis.smartboxWasExecuted = true'), []);
  assert.equal(globalThis.smartboxWasExecuted, undefined);
});

test('asset search uses fixed Eastmoney and Yahoo URLs and filters unrecognized provider symbols', async () => {
  const requestedUrls = [];
  const search = createAssetSearch({
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      if (String(url).startsWith('https://searchapi.eastmoney.com')) {
        return new Response(JSON.stringify({ result: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ quotes: [
        { symbol: 'MSFT', shortname: 'Microsoft Corporation', quoteType: 'EQUITY' },
        { symbol: 'NOT-A-SYMBOL', shortname: 'Ignore me', quoteType: 'EQUITY' },
        { symbol: '600519.SS', shortname: 'Kweichow Moutai', quoteType: 'EQUITY' }
      ] }), { status: 200 });
    }
  });

  assert.deepEqual(await search('Microsoft?x=1'), [
    { symbol: 'MSFT', name: 'Microsoft Corporation', market: 'us', type: 'EQUITY', source: 'yahoo-finance' },
    { symbol: '600519.SH', name: 'Kweichow Moutai', market: 'cn', type: 'EQUITY', source: 'yahoo-finance' }
  ]);
  assert.deepEqual(requestedUrls, [
    'https://smartbox.gtimg.cn/s3/?t=all&q=Microsoft%3Fx%3D1',
    'https://searchapi.eastmoney.com/api/suggest/get?input=Microsoft%3Fx%3D1&type=14',
    'https://query1.finance.yahoo.com/v1/finance/search?q=Microsoft%3Fx%3D1'
  ]);
});

test('Eastmoney suggest uses a fixed URL and parses common A and H stock result formats', async () => {
  const requestedUrls = [];
  const search = createAssetSearch({
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return new Response(JSON.stringify({ result: { data: [
        { Code: '000001', Name: '平安银行', Market: 'SZ' },
        { code: '0700', name: '腾讯控股', market: 'HK' },
        { code: 'not-a-code', name: 'Ignore' }
      ] } }), { status: 200 });
    }
  });

  assert.deepEqual(await search('平安银行?host=example.com'), [
    { symbol: '000001.SZ', name: '平安银行', market: 'cn', type: 'stock', source: 'eastmoney-suggest' },
    { symbol: '0700.HK', name: '腾讯控股', market: 'hk', type: 'stock', source: 'eastmoney-suggest' }
  ]);
  assert.equal(requestedUrls[0], 'https://smartbox.gtimg.cn/s3/?t=all&q=%E5%B9%B3%E5%AE%89%E9%93%B6%E8%A1%8C%3Fhost%3Dexample.com');
  assert.equal(requestedUrls[1], 'https://searchapi.eastmoney.com/api/suggest/get?input=%E5%B9%B3%E5%AE%89%E9%93%B6%E8%A1%8C%3Fhost%3Dexample.com&type=14');
  assert.equal(requestedUrls[2], 'https://query1.finance.yahoo.com/v1/finance/search?q=%E5%B9%B3%E5%AE%89%E9%93%B6%E8%A1%8C%3Fhost%3Dexample.com');
});

test('resolves a Chinese A-share name through only the fixed Eastmoney suggest endpoint', async () => {
  const requestedUrls = [];
  const result = await resolveChineseAssetName('贵州茅台', async (url, options) => {
    requestedUrls.push({ url: String(url), options });
    return new Response(JSON.stringify({ result: { data: [{
      Code: '600519', Name: '贵州茅台', Market: 'SH'
    }] } }), { status: 200 });
  });

  assert.deepEqual(result, { symbol: '600519.SH', name: '贵州茅台', market: 'cn' });
  assert.deepEqual(requestedUrls.map(({ url }) => url), [buildEastmoneySuggestUrl('贵州茅台')]);
  assert.match(requestedUrls[0].options.headers['User-Agent'], /Mozilla/);
  assert.equal(requestedUrls[0].options.headers.Referer, 'https://www.eastmoney.com/');
});

test('Chinese asset resolver falls back to Tencent when Eastmoney has no exact mainland name', async () => {
  const requestedUrls = [];
  const result = await resolveChineseAssetNameWithStatus('贵州茅台', async (url) => {
    requestedUrls.push(String(url));
    if (String(url).startsWith('https://searchapi.eastmoney.com')) {
      return new Response(JSON.stringify({ result: { data: [{
        Code: '600009', Name: '上海机场', Market: 'SH'
      }] } }), { status: 200 });
    }
    return new Response('v_hint="sh~600519~贵州茅台~gzmt~GP-A"', { status: 200 });
  });

  assert.deepEqual(result, {
    ok: true,
    asset: { symbol: '600519.SH', name: '贵州茅台', market: 'cn' }
  });
  assert.deepEqual(requestedUrls, [
    buildEastmoneySuggestUrl('贵州茅台'),
    buildTencentSuggestUrl('贵州茅台')
  ]);
});

test('Chinese asset resolver does not call Tencent after an exact Eastmoney mainland match', async () => {
  const requestedUrls = [];
  const result = await resolveChineseAssetNameWithStatus('贵州茅台', async (url) => {
    requestedUrls.push(String(url));
    if (String(url).startsWith('https://smartbox.gtimg.cn')) {
      throw new Error('Tencent must not run after an Eastmoney exact match');
    }
    return new Response(JSON.stringify({ result: { data: [{
      Code: '600519', Name: '贵州茅台', Market: 'SH'
    }] } }), { status: 200 });
  });

  assert.deepEqual(result, {
    ok: true,
    asset: { symbol: '600519.SH', name: '贵州茅台', market: 'cn' }
  });
  assert.deepEqual(requestedUrls, [buildEastmoneySuggestUrl('贵州茅台')]);
});

test('Chinese asset resolver distinguishes two valid misses from provider failures across both sources', async () => {
  const validMiss = await resolveChineseAssetNameWithStatus('不存在股票', async (url) => String(url).startsWith('https://searchapi.eastmoney.com')
    ? new Response(JSON.stringify({ result: { data: [] } }), { status: 200 })
    : new Response('v_hint="sh~600519~贵州茅台~gzmt~GP-A"', { status: 200 }));
  const upstreamFailure = await resolveChineseAssetNameWithStatus('不存在股票', async () => new Response('unavailable', { status: 503 }));
  const mixedFailure = await resolveChineseAssetNameWithStatus('不存在股票', async (url) => String(url).startsWith('https://searchapi.eastmoney.com')
    ? new Response('unavailable', { status: 503 })
    : new Response('v_hint="sh~600519~贵州茅台~gzmt~GP-A"', { status: 200 }));

  assert.deepEqual(validMiss, { ok: false, errorCode: 'not_found' });
  assert.deepEqual(upstreamFailure, { ok: false, errorCode: 'provider_unavailable' });
  assert.deepEqual(mixedFailure, { ok: false, errorCode: 'provider_unavailable' });
});

test('Chinese asset resolver rejects non-mainland Eastmoney suggestions', async () => {
  const result = await resolveChineseAssetName('腾讯控股', async () => new Response(JSON.stringify({ result: { data: [{
    Code: '0700', Name: '腾讯控股', Market: 'HK'
  }] } }), { status: 200 }));

  assert.equal(result, null);
});

test('Chinese asset resolver skips an upstream fuzzy match and returns only an exact name match', async () => {
  const result = await resolveChineseAssetName('贵州茅台', async () => new Response(JSON.stringify({ result: { data: [
    { Code: '600009', Name: '上海机场', Market: 'SH' },
    { Code: '600519', Name: '贵州茅台', Market: 'SH' }
  ] } }), { status: 200 }));

  assert.deepEqual(result, { symbol: '600519.SH', name: '贵州茅台', market: 'cn' });
});

test('Chinese asset resolver accepts a matching bare six-digit code without guessing its exchange', async () => {
  const result = await resolveChineseAssetName('600519', async () => new Response(JSON.stringify({ result: { data: [{
    Code: '600519', Name: '贵州茅台', Market: 'SH'
  }] } }), { status: 200 }));

  assert.deepEqual(result, { symbol: '600519.SH', name: '贵州茅台', market: 'cn' });
});

test('Chinese asset resolver supplies an abort signal to bound the fixed Eastmoney request', async () => {
  let signal;
  await resolveChineseAssetName('贵州茅台', async (_, options) => {
    signal = options.signal;
    return new Response(JSON.stringify({ result: { data: [] } }), { status: 200 });
  });

  assert.ok(signal instanceof AbortSignal);
});

test('Chinese asset resolver returns after its configured timeout when an upstream ignores abort', async () => {
  const result = await resolveChineseAssetName('贵州茅台', async () => new Promise(() => {}), { timeoutMs: 0 });

  assert.equal(result, null);
});

test('Chinese asset resolver status distinguishes provider failure from an exact-match miss', async () => {
  const unavailable = await resolveChineseAssetNameWithStatus('贵州茅台', async () => new Response('unavailable', { status: 503 }));
  const notFound = await resolveChineseAssetNameWithStatus('不存在股票', async () => new Response(JSON.stringify({ result: { data: [] } }), { status: 200 }));

  assert.deepEqual(unavailable, { ok: false, errorCode: 'provider_unavailable' });
  assert.deepEqual(notFound, { ok: false, errorCode: 'not_found' });
});

test('Chinese asset resolver de-duplicates concurrent successful lookups and caches only the success', async () => {
  let fetchCalls = 0;
  let completeFetch;
  const resolver = createChineseAssetNameResolver({
    fetchImpl: () => {
      fetchCalls += 1;
      return new Promise((resolve) => { completeFetch = resolve; });
    },
    cacheTtlMs: 60_000
  });

  const first = resolver('贵州茅台');
  const second = resolver('贵州茅台');
  assert.equal(fetchCalls, 1);
  completeFetch(new Response(JSON.stringify({ result: { data: [{ Code: '600519', Name: '贵州茅台', Market: 'SH' }] } }), { status: 200 }));

  assert.deepEqual(await first, { ok: true, asset: { symbol: '600519.SH', name: '贵州茅台', market: 'cn' } });
  assert.deepEqual(await second, { ok: true, asset: { symbol: '600519.SH', name: '贵州茅台', market: 'cn' } });
  await resolver('贵州茅台');
  assert.equal(fetchCalls, 1);
});

test('Chinese asset resolver does not cache failed lookups', async () => {
  let fetchCalls = 0;
  const resolver = createChineseAssetNameResolver({
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('unavailable', { status: 503 });
    },
    cacheTtlMs: 60_000
  });

  assert.deepEqual(await resolver('贵州茅台'), { ok: false, errorCode: 'provider_unavailable' });
  assert.deepEqual(await resolver('贵州茅台'), { ok: false, errorCode: 'provider_unavailable' });
  // Each uncached miss probes both fixed name-resolution providers.
  assert.equal(fetchCalls, 4);
});

test('Eastmoney suggest uses fixed browser headers for a real QuotationCodeTable response', async () => {
  const requests = [];
  const search = createAssetSearch({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return String(url).startsWith('https://searchapi.eastmoney.com')
        ? new Response(JSON.stringify({
            QuotationCodeTable: { Data: [{
              Code: '000001', Name: '平安银行', QuoteID: '0.000001', SecurityTypeName: '深A'
            }] }
          }), { status: 200 })
        : new Response(JSON.stringify({ quotes: [] }), { status: 200 });
    }
  });

  assert.deepEqual(await search('000001'), [{
    symbol: '000001.SZ', name: '平安银行', market: 'cn', type: 'stock', source: 'eastmoney-suggest'
  }]);
  assert.equal(requests[0].url, buildTencentSuggestUrl('000001'));
  assert.equal(requests[0].options, undefined);
  assert.equal(requests[1].url, buildEastmoneySuggestUrl('000001'));
  assert.match(requests[1].options.headers['User-Agent'], /Mozilla/);
  assert.equal(requests[1].options.headers.Referer, 'https://www.eastmoney.com/');
  assert.equal(requests[2].url, 'https://query1.finance.yahoo.com/v1/finance/search?q=000001');
  assert.equal(requests[2].options?.headers?.Referer, undefined);
});

test('Eastmoney suggest parses a JSONP text response for mainland codes', async () => {
  const search = createAssetSearch({
    fetchImpl: async (url) => String(url).startsWith('https://searchapi.eastmoney.com')
      ? {
          ok: true,
          text: async () => ' \n  jQuery1830123456789_1234567890({"result":{"data":[{"Code":"000001","Name":"平安银行","Market":"SZ"}]}}) \t'
        }
      : new Response(JSON.stringify({ quotes: [] }), { status: 200 })
  });

  assert.deepEqual(await search('000001'), [{
    symbol: '000001.SZ', name: '平安银行', market: 'cn', type: 'stock', source: 'eastmoney-suggest'
  }]);
});

test('Tencent and Eastmoney failures fall back to Yahoo for exact mainland codes', async () => {
  const requestedUrls = [];
  const search = createAssetSearch({
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      if (String(url).startsWith('https://searchapi.eastmoney.com')) throw new Error('offline');
      return new Response(JSON.stringify({ quotes: [
        { symbol: '000001.SZ', shortname: 'Ping An Bank', quoteType: 'EQUITY' }
      ] }), { status: 200 });
    }
  });

  assert.deepEqual(await search('000001'), [
    { symbol: '000001.SZ', name: 'Ping An Bank', market: 'cn', type: 'EQUITY', source: 'yahoo-finance' }
  ]);
  assert.equal(requestedUrls.length, 3);
});

test('asset search keeps Eastmoney results first and de-duplicates matching Yahoo symbols', async () => {
  const search = createAssetSearch({
    fetchImpl: async (url) => String(url).startsWith('https://searchapi.eastmoney.com')
      ? new Response(JSON.stringify({ suggest: [{ code: '600519', name: '贵州茅台', market: 'SH' }] }), { status: 200 })
      : new Response(JSON.stringify({ quotes: [
        { symbol: '600519.SS', shortname: 'Kweichow Moutai', quoteType: 'EQUITY' },
        { symbol: 'AAPL', shortname: 'Apple', quoteType: 'EQUITY' }
      ] }), { status: 200 })
  });

  assert.deepEqual(await search('600519'), [
    { symbol: '600519.SH', name: '贵州茅台', market: 'cn', type: 'stock', source: 'eastmoney-suggest' },
    { symbol: 'AAPL', name: 'Apple', market: 'us', type: 'EQUITY', source: 'yahoo-finance' }
  ]);
});

test('asset search limits merged provider results to ten and keeps provider origins fixed for hostile queries', async () => {
  const requestedUrls = [];
  const search = createAssetSearch({
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      if (String(url).startsWith('https://searchapi.eastmoney.com')) {
        return new Response(JSON.stringify({ result: Array.from({ length: 12 }, (_, index) => ({
          code: String(index + 1).padStart(6, '0'), name: `股票${index + 1}`, market: 'SZ'
        })) }), { status: 200 });
      }
      return new Response(JSON.stringify({ quotes: [{ symbol: 'MSFT', shortname: 'Microsoft', quoteType: 'EQUITY' }] }), { status: 200 });
    }
  });

  const results = await search('x?input=https://attacker.example/path');
  assert.equal(results.length, 10);
  assert.deepEqual(requestedUrls.map((url) => new URL(url).origin), [
    'https://smartbox.gtimg.cn',
    'https://searchapi.eastmoney.com',
    'https://query1.finance.yahoo.com'
  ]);
});

test('asset search returns no results for invalid provider input or provider failures', async () => {
  const search = createAssetSearch({ fetchImpl: async () => { throw new Error('offline'); } });

  assert.deepEqual(await search(''), []);
  assert.deepEqual(await search('x'.repeat(65)), []);
  assert.deepEqual(await search('unknown symbol'), []);
});

test('searchAssets requests the search endpoint and returns only server results', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/market/search?q=Apple');
    assert.equal(options.signal, controller.signal);
    return new Response(JSON.stringify({ results: [{ symbol: 'AAPL', name: 'Apple' }] }), { status: 200 });
  };

  try {
    assert.deepEqual(await searchAssets('Apple', controller.signal), [{ symbol: 'AAPL', name: 'Apple' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('financial search renders remote results and selection sets the active research symbol', async () => {
  const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');

  assert.match(source, /searchAssets\(assetQuery, assetSearchAbortRef\.current\.signal\)/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /setFinancialSymbol\(result\.symbol\)/);
  assert.match(source, /setAssetResults\(\[\]\)/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /onKeyDown=\{handleAssetSearchKeyDown\}/);
});
