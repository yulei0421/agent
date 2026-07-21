import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarketContext, extractMarketSymbols, resolveMarketSymbols } from '../server/tools/market.js';

test('extracts explicit market symbols from text, de-duplicates, and caps at three', () => {
  assert.deepEqual(
    extractMarketSymbols('请比较 600519.SH、0700.HK、AAPL.US、AAPL 和 BTC/USDT，以及 apple 与 mixedCase'),
    ['600519.SH', '0700.HK', 'AAPL.US']
  );
  assert.deepEqual(extractMarketSymbols('请分析 apple 和 mixedCase'), []);
});

test('extracts Shenzhen symbols alongside other explicit market symbols and caps at three', () => {
  assert.deepEqual(
    extractMarketSymbols('查询 000001.SZ、600519.SH、0700.HK、AAPL.US、BTC/USDT'),
    ['000001.SZ', '600519.SH', '0700.HK']
  );
});

test('does not mistake the A in A股 for a US ticker in the legacy symbol extractor', () => {
  assert.deepEqual(extractMarketSymbols('A股贵州茅台'), []);
});

test('resolves Chinese market names and the Shanghai Composite alias from a chat query', async () => {
  const requestedNames = [];
  const symbols = await resolveMarketSymbols('贵州茅台和上证指数最新行情', async (name) => {
    requestedNames.push(name);
    return name === '贵州茅台'
      ? { symbol: '600519.SH', name: '贵州茅台', market: 'cn' }
      : null;
  });

  assert.deepEqual(symbols, [
    { symbol: '600519.SH', name: '贵州茅台' },
    { symbol: '000001.SH', name: '上证指数' }
  ]);
  assert.deepEqual(requestedNames, ['贵州茅台']);
});

test('market name resolution keeps explicit symbols, de-duplicates symbols, and caps output at three', async () => {
  const symbols = await resolveMarketSymbols('600519.SH、贵州茅台、平安银行、宁德时代、比亚迪', async (name) => ({
    '贵州茅台': { symbol: '600519.SH', name: '贵州茅台', market: 'cn' },
    '平安银行': { symbol: '000001.SZ', name: '平安银行', market: 'cn' },
    '宁德时代': { symbol: '300750.SZ', name: '宁德时代', market: 'cn' },
    '比亚迪': { symbol: '002594.SZ', name: '比亚迪', market: 'cn' }
  })[name] ?? null);

  assert.deepEqual(symbols, [
    { symbol: '600519.SH', name: '600519.SH' },
    { symbol: '000001.SZ', name: '平安银行' },
    { symbol: '300750.SZ', name: '宁德时代' }
  ]);
});

test('market name resolution removes question phrasing before requesting the Chinese asset name', async () => {
  const queries = [
    '今天贵州茅台怎么样',
    '请分析一下贵州茅台',
    '帮我看一下贵州茅台今天的行情'
  ];

  for (const query of queries) {
    const requestedNames = [];
    const symbols = await resolveMarketSymbols(query, async (name) => {
      requestedNames.push(name);
      return { symbol: '600519.SH', name: '贵州茅台', market: 'cn' };
    });
    assert.deepEqual(symbols, [{ symbol: '600519.SH', name: '贵州茅台' }]);
    assert.deepEqual(requestedNames, ['贵州茅台']);
  }
});

test('market name resolution preserves the A-share name 和而泰 instead of splitting its first character', async () => {
  const requestedNames = [];
  const symbols = await resolveMarketSymbols('和而泰最新行情', async (name) => {
    requestedNames.push(name);
    return { symbol: '002402.SZ', name: '和而泰', market: 'cn' };
  });

  assert.deepEqual(symbols, [{ symbol: '002402.SZ', name: '和而泰' }]);
  assert.deepEqual(requestedNames, ['和而泰']);
});

test('market name resolution retries a compound 和而泰 candidate as two controlled names after an exact miss', async () => {
  const requestedNames = [];
  const symbols = await resolveMarketSymbols('请对比隆基绿能和而泰今日走势', async (name) => {
    requestedNames.push(name);
    return {
      '隆基绿能': { symbol: '601012.SH', name: '隆基绿能', market: 'cn' },
      '和而泰': { symbol: '002402.SZ', name: '和而泰', market: 'cn' }
    }[name] ?? null;
  });

  assert.deepEqual(symbols, [
    { symbol: '601012.SH', name: '隆基绿能' },
    { symbol: '002402.SZ', name: '和而泰' }
  ]);
  assert.deepEqual(requestedNames, ['隆基绿能和而泰', '隆基绿能', '和而泰']);
});

test('market name resolution separates multiple Chinese names joined by 和', async () => {
  const requestedNames = [];
  const symbols = await resolveMarketSymbols('比较贵州茅台和宁德时代最新行情', async (name) => {
    requestedNames.push(name);
    return {
      '贵州茅台': { symbol: '600519.SH', name: '贵州茅台', market: 'cn' },
      '宁德时代': { symbol: '300750.SZ', name: '宁德时代', market: 'cn' }
    }[name] ?? null;
  });

  assert.deepEqual(symbols, [
    { symbol: '600519.SH', name: '贵州茅台' },
    { symbol: '300750.SZ', name: '宁德时代' }
  ]);
  assert.deepEqual(requestedNames, ['贵州茅台', '宁德时代']);
});

test('market name resolution supports Chinese A-share prefixes and bare six-digit code lookups', async () => {
  const requestedNames = [];
  const symbols = await resolveMarketSymbols('A股贵州茅台和600519最新行情', async (name) => {
    requestedNames.push(name);
    return name === '贵州茅台'
      ? { symbol: '600519.SH', name: '贵州茅台', market: 'cn' }
      : { symbol: '600519.SH', name: '贵州茅台', market: 'cn' };
  });

  assert.deepEqual(symbols, [{ symbol: '600519.SH', name: '贵州茅台' }]);
  assert.deepEqual(requestedNames, ['贵州茅台', '600519']);
});

test('market name resolution makes no more than three de-duplicated candidate requests after failures', async () => {
  const requestedNames = [];
  const symbols = await resolveMarketSymbols('甲一、乙二、丙三、丁四、甲一、戊五', async (name) => {
    requestedNames.push(name);
    return null;
  });

  assert.deepEqual(symbols, []);
  assert.deepEqual(requestedNames, ['甲一', '乙二', '丙三']);
});

test('market name resolution removes action prefixes and prioritizes the first three valid Chinese names', async () => {
  const prefixRequests = [];
  await resolveMarketSymbols('我想查询贵州茅台今天行情', async (name) => {
    prefixRequests.push(name);
    return { symbol: '600519.SH', name: '贵州茅台', market: 'cn' };
  });
  assert.deepEqual(prefixRequests, ['贵州茅台']);

  const requestedNames = [];
  const symbols = await resolveMarketSymbols('关注贵州茅台、宁德时代、比亚迪和招商银行行情', async (name) => {
    requestedNames.push(name);
    return {
      '贵州茅台': { symbol: '600519.SH', name: '贵州茅台', market: 'cn' },
      '宁德时代': { symbol: '300750.SZ', name: '宁德时代', market: 'cn' },
      '比亚迪': { symbol: '002594.SZ', name: '比亚迪', market: 'cn' },
      '招商银行': { symbol: '600036.SH', name: '招商银行', market: 'cn' }
    }[name] ?? null;
  });

  assert.deepEqual(requestedNames, ['贵州茅台', '宁德时代', '比亚迪']);
  assert.deepEqual(symbols, [
    { symbol: '600519.SH', name: '贵州茅台' },
    { symbol: '300750.SZ', name: '宁德时代' },
    { symbol: '002594.SZ', name: '比亚迪' }
  ]);
});

test('builds safe market context with snapshot provenance for successful quotes', async () => {
  const calls = [];
  const gateway = {
    async getQuote(symbol) {
      calls.push(symbol);
      return {
        ok: true,
        data: { price: 123.45, changePercent: -1.5 },
        meta: { symbol, source: 'yahoo-finance', asOf: '2026-07-15T00:00:00.000Z', delay: 'unknown' }
      };
    }
  };

  const result = await buildMarketContext([{ role: 'user', content: 'AAPL.US 和 BTC/USDT' }], gateway);

  assert.deepEqual(calls, ['AAPL.US', 'BTC/USDT']);
  assert.equal(result.messages.length, 2);
  assert.match(result.messages[0].content, /symbol=AAPL\.US/);
  assert.match(result.messages[0].content, /price=123\.45/);
  assert.match(result.messages[0].content, /changePercent=-1\.5/);
  assert.match(result.messages[0].content, /source=yahoo-finance/);
  assert.match(result.messages[0].content, /asOf=2026-07-15T00:00:00\.000Z/);
  assert.match(result.messages[0].content, /delay=unknown/);
  assert.deepEqual(result.toolEvents[0], {
    name: 'get_quote',
    assetName: 'AAPL.US',
    symbol: 'AAPL.US',
    status: 'success',
    source: 'yahoo-finance',
    asOf: '2026-07-15T00:00:00.000Z',
    observedAt: null,
    fetchedAt: null,
    ageSeconds: null,
    delay: 'unknown',
    currency: 'unknown'
  });
});

test('reports unavailable quotes without inventing a price', async () => {
  const result = await buildMarketContext([{ role: 'user', content: 'AAPL.US' }], {
    async getQuote() {
      return {
        ok: false,
        error: { code: 'provider_rate_limited', message: 'sensitive upstream detail' },
        meta: { symbol: 'AAPL.US', source: 'yahoo-finance' }
      };
    }
  });

  assert.match(result.messages[0].content, /不可用/);
  assert.match(result.messages[0].content, /provider_rate_limited/);
  assert.doesNotMatch(result.messages[0].content, /price=/);
  assert.doesNotMatch(result.messages[0].content, /sensitive upstream detail/);
  assert.deepEqual(result.toolEvents[0], {
    name: 'get_quote',
    assetName: 'AAPL.US',
    symbol: 'AAPL.US',
    status: 'error',
    errorCode: 'provider_rate_limited'
  });
});


test('prefers a fallback provider failure over an earlier composite-name not_found error', async () => {
  const result = await resolveMarketSymbols('请查询隆基绿能和而泰最新行情', async (name) => {
    if (name === '和而泰') return { ok: false, errorCode: 'provider_unavailable' };
    return { ok: false, errorCode: 'not_found' };
  }, { includeFailures: true });

  assert.deepEqual(result, {
    assets: [],
    unresolved: [{ assetName: '隆基绿能和而泰', symbol: null, errorCode: 'provider_unavailable' }]
  });
});
