import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarketContext, extractMarketSymbols, resolveMarketSymbols } from '../server/tools/market.js';
import { streamDeepSeek } from '../server/deepseek.js';

function createSseResponse() {
  const writes = [];
  return {
    destroyed: false,
    writableEnded: false,
    writes,
    writeHead() {},
    write(chunk) { writes.push(chunk); },
    end() { this.writableEnded = true; },
    status() { return this; },
    json() {}
  };
}

function completedUpstream() {
  return {
    ok: true,
    body: {
      async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode('data: [DONE]\n\n');
      }
    }
  };
}

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

test('keeps old chat requests unchanged when no market gateway is provided', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalMessages = [{ role: 'system', content: '原系统提示' }, { role: 'user', content: 'AAPL.US' }];
  let upstreamBody;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async (_, options) => {
    upstreamBody = JSON.parse(options.body);
    return completedUpstream();
  };

  try {
    const res = createSseResponse();
    await streamDeepSeek({ body: { messages: originalMessages } }, res);

    assert.deepEqual(upstreamBody.messages, originalMessages);
    assert.deepEqual(originalMessages, [{ role: 'system', content: '原系统提示' }, { role: 'user', content: 'AAPL.US' }]);
    assert.equal(res.writes.some((line) => line.includes('"type":"tool"')), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('emits market tool events before upstream and injects context after system prompts', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const messages = [{ role: 'system', content: '原系统提示' }, { role: 'user', content: '查询 AAPL.US' }];
  const order = [];
  let upstreamBody;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async (_, options) => {
    order.push('upstream');
    upstreamBody = JSON.parse(options.body);
    return completedUpstream();
  };

  try {
    const res = createSseResponse();
    const originalWrite = res.write;
    res.write = (chunk) => {
      order.push(chunk.includes('"type":"tool"') ? 'tool' : chunk.includes('"type":"tool_result"') ? 'tool_result' : 'other');
      originalWrite.call(res, chunk);
    };
    await streamDeepSeek({ body: { messages } }, res, {
      marketGateway: {
        async getQuote(symbol) {
          return {
            ok: true,
            data: { price: 210, changePercent: 5 },
            meta: { symbol, source: 'yahoo-finance', asOf: '2026-07-15T00:00:00.000Z', delay: 'unknown' }
          };
        }
      }
    });

    assert.deepEqual(order.slice(0, 3), ['tool', 'tool_result', 'upstream']);
    assert.deepEqual(upstreamBody.messages[0], messages[0]);
    assert.deepEqual(upstreamBody.messages[2], messages[1]);
    assert.match(upstreamBody.messages[1].content, /source=yahoo-finance/);
    assert.deepEqual(messages, [{ role: 'system', content: '原系统提示' }, { role: 'user', content: '查询 AAPL.US' }]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('emits Shenzhen market tool events before upstream', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const order = [];
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async () => {
    order.push('upstream');
    return completedUpstream();
  };

  try {
    const res = createSseResponse();
    const originalWrite = res.write;
    res.write = (chunk) => {
      order.push(chunk.includes('"type":"tool"') ? 'tool' : chunk.includes('"type":"tool_result"') ? 'tool_result' : 'other');
      originalWrite.call(res, chunk);
    };
    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '查询 000001.SZ' }] } }, res, {
      marketGateway: {
        async getQuote(symbol) {
          return {
            ok: true,
            data: { price: 12.34, changePercent: 1.5 },
            meta: { symbol, source: 'eastmoney', asOf: '2026-07-15T00:00:00.000Z', delay: 'unknown' }
          };
        }
      }
    });

    assert.deepEqual(order.slice(0, 3), ['tool', 'tool_result', 'upstream']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('streams a resolved Chinese A-share quote with its name and Eastmoney resolver before DeepSeek', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const resolverCalls = [];
  const quoteCalls = [];
  let upstreamBody;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async (_, options) => {
    upstreamBody = JSON.parse(options.body);
    return completedUpstream();
  };

  try {
    const res = createSseResponse();
    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '贵州茅台最新行情' }] } }, res, {
      marketResolver: async (name) => {
        resolverCalls.push(name);
        return { symbol: '600519.SH', name: '贵州茅台', market: 'cn' };
      },
      marketGateway: {
        async getQuote(symbol) {
          quoteCalls.push(symbol);
          return {
            ok: true,
            data: { price: 1500, changePercent: 1.2 },
            meta: { symbol, source: 'eastmoney', asOf: '2026-07-20T06:00:00.000Z', delay: 'real-time' }
          };
        }
      }
    });

    assert.deepEqual(resolverCalls, ['贵州茅台']);
    assert.deepEqual(quoteCalls, ['600519.SH']);
    assert.match(res.writes[0], /"type":"tool"/);
    assert.match(res.writes[0], /"assetName":"贵州茅台"/);
    assert.match(res.writes[0], /"symbol":"600519\.SH"/);
    assert.match(res.writes[1], /"type":"tool_result"/);
    assert.match(res.writes[1], /"assetName":"贵州茅台"/);
    assert.match(res.writes[1], /"source":"eastmoney"/);
    assert.match(upstreamBody.messages[0].content, /name=贵州茅台/);
    assert.match(upstreamBody.messages[0].content, /symbol=600519\.SH/);
    assert.match(upstreamBody.messages[0].content, /source=eastmoney/);
    assert.equal(upstreamBody.messages.length, 2);
    assert.equal(res.writes.some((write) => write.includes('"name":"get_current_context"')), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('streams the Shanghai Composite alias without invoking the name resolver', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let resolverCalls = 0;
  let quoteSymbol;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async () => completedUpstream();

  try {
    const res = createSseResponse();
    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '上证指数现在多少' }] } }, res, {
      marketResolver: async () => {
        resolverCalls += 1;
        return null;
      },
      marketGateway: {
        async getQuote(symbol) {
          quoteSymbol = symbol;
          return {
            ok: true,
            data: { price: 3500, changePercent: 0.3 },
            meta: { symbol, source: 'eastmoney', asOf: '2026-07-20T06:00:00.000Z', delay: 'real-time' }
          };
        }
      }
    });

    assert.equal(resolverCalls, 0);
    assert.equal(quoteSymbol, '000001.SH');
    assert.match(res.writes[0], /"assetName":"上证指数"/);
    assert.match(res.writes[0], /"symbol":"000001\.SH"/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('constrains DeepSeek not to redirect users when a resolved market quote fails', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let upstreamBody;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async (_, options) => {
    upstreamBody = JSON.parse(options.body);
    return completedUpstream();
  };

  try {
    const res = createSseResponse();
    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '贵州茅台最新行情' }] } }, res, {
      marketResolver: async () => ({ symbol: '600519.SH', name: '贵州茅台', market: 'cn' }),
      marketGateway: {
        async getQuote() {
          return { ok: false, error: { code: 'provider_unavailable' } };
        }
      }
    });

    const quoteError = res.writes.find((write) => write.includes('"name":"get_quote"') && write.includes('"status":"error"'));
    assert.match(quoteError, /"assetName":"贵州茅台"/);
    assert.match(quoteError, /"errorCode":"provider_unavailable"/);
    assert.match(upstreamBody.messages[0].content, /不得建议用户前往财经网站、交易软件或搜索引擎自行查询/);
    assert.match(upstreamBody.messages[0].content, /不得编造价格/);
    assert.doesNotMatch(upstreamBody.messages[0].content, /price=/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('reports a structured resolver provider failure for a Chinese A-share before DeepSeek', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let upstreamBody;
  let quoteCalls = 0;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async (_, options) => {
    upstreamBody = JSON.parse(options.body);
    return completedUpstream();
  };

  try {
    const res = createSseResponse();
    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '贵州茅台最新行情' }] } }, res, {
      marketResolver: async () => {
        const error = new Error('Eastmoney timed out');
        error.code = 'provider_unavailable';
        throw error;
      },
      marketGateway: {
        async getQuote() {
          quoteCalls += 1;
          return { ok: true };
        }
      }
    });

    const resolverError = res.writes.find((write) => write.includes('"name":"resolve_asset"') && write.includes('"status":"error"'));
    assert.match(resolverError, /"assetName":"贵州茅台"/);
    assert.match(resolverError, /"errorCode":"provider_unavailable"/);
    assert.equal(quoteCalls, 0);
    assert.match(upstreamBody.messages[0].content, /不得编造价格/);
    assert.match(upstreamBody.messages[0].content, /不得建议用户前往财经网站、交易软件或搜索引擎自行查询/);
    assert.equal(res.writes.some((write) => write.includes('"name":"get_current_context"')), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('reports a structured not_found error when a Chinese A-share has no exact match', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let upstreamBody;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async (_, options) => {
    upstreamBody = JSON.parse(options.body);
    return completedUpstream();
  };

  try {
    const res = createSseResponse();
    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '不存在股票最新行情' }] } }, res, {
      marketResolver: async () => null,
      marketGateway: {
        async getQuote() {
          throw new Error('quote must not be called without a resolved symbol');
        }
      }
    });

    const resolverError = res.writes.find((write) => write.includes('"name":"resolve_asset"') && write.includes('"status":"error"'));
    assert.match(resolverError, /"assetName":"不存在股票"/);
    assert.match(resolverError, /"errorCode":"not_found"/);
    assert.match(upstreamBody.messages[0].content, /errorCode=not_found/);
    assert.match(upstreamBody.messages[0].content, /不得编造价格/);
    assert.match(upstreamBody.messages[0].content, /不得建议用户前往财经网站、交易软件或搜索引擎自行查询/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('inserts this turn market context immediately before the latest user message', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let upstreamBody;
  const messages = [
    { role: 'system', content: '原系统提示' },
    { role: 'user', content: '上一轮问题' },
    { role: 'assistant', content: '上一轮回答' },
    { role: 'user', content: '贵州茅台最新行情' }
  ];
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async (_, options) => {
    upstreamBody = JSON.parse(options.body);
    return completedUpstream();
  };

  try {
    await streamDeepSeek({ body: { messages } }, createSseResponse(), {
      marketResolver: async () => ({ symbol: '600519.SH', name: '贵州茅台', market: 'cn' }),
      marketGateway: {
        async getQuote(symbol) {
          return {
            ok: true,
            data: { price: 1500, changePercent: 1.2 },
            meta: { symbol, source: 'eastmoney', asOf: '2026-07-20T06:00:00.000Z', delay: 'real-time' }
          };
        }
      }
    });

    assert.deepEqual(upstreamBody.messages.map((message) => message.role), ['system', 'user', 'assistant', 'system', 'user']);
    assert.equal(upstreamBody.messages[3].content.includes('市场行情工具快照'), true);
    assert.equal(upstreamBody.messages[4].content, '贵州茅台最新行情');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
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

test('keeps a weather request on the weather tool when a market gateway is configured', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let resolverCalls = 0;
  let gatewayCalls = 0;
  let upstreamBody;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async (_, options) => {
    upstreamBody = JSON.parse(options.body);
    return completedUpstream();
  };

  try {
    const res = createSseResponse();
    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '上海今天天气怎么样？' }] } }, res, {
      marketResolver: async () => {
        resolverCalls += 1;
        return { ok: false, errorCode: 'not_found' };
      },
      marketGateway: {
        async getQuote() {
          gatewayCalls += 1;
          return { ok: false };
        }
      },
      liveContext: async () => ({
        ok: true,
        serverTime: '2026-07-20T06:00:00.000Z',
        date: '2026-07-20',
        timeZone: 'Asia/Shanghai',
        weather: { city: '上海', temperatureC: 30, apparentTemperatureC: 35, observedAt: '2026-07-20T05:55:00.000Z', ageSeconds: 300, source: 'open-meteo' }
      })
    });

    assert.equal(resolverCalls, 0);
    assert.equal(gatewayCalls, 0);
    assert.equal(res.writes.some((write) => write.includes('"name":"get_weather"')), true);
    assert.equal(res.writes.some((write) => write.includes('"name":"resolve_asset"')), false);
    assert.match(upstreamBody.messages[0].content, /实时上下文/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('does not let a failed market-name lookup block an independent weather tool call', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async () => completedUpstream();

  try {
    const res = createSseResponse();
    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '上海天气和不存在股票行情' }] } }, res, {
      marketResolver: async () => ({ ok: false, errorCode: 'not_found' }),
      marketGateway: { async getQuote() { throw new Error('no resolved symbol'); } },
      liveContext: async () => ({
        ok: true,
        serverTime: '2026-07-20T06:00:00.000Z',
        date: '2026-07-20',
        timeZone: 'Asia/Shanghai',
        weather: { city: '上海', temperatureC: 30, apparentTemperatureC: 35, observedAt: '2026-07-20T05:55:00.000Z', ageSeconds: 300, source: 'open-meteo' }
      })
    });

    assert.equal(res.writes.some((write) => write.includes('"name":"resolve_asset"')), true);
    assert.equal(res.writes.some((write) => write.includes('"name":"get_weather"')), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('streams currency, delay, and quote freshness metadata to DeepSeek and the tool result', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let upstreamBody;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async (_, options) => {
    upstreamBody = JSON.parse(options.body);
    return completedUpstream();
  };

  try {
    const res = createSseResponse();
    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '贵州茅台最新行情' }] } }, res, {
      marketResolver: async () => ({ symbol: '600519.SH', name: '贵州茅台', market: 'cn' }),
      marketGateway: {
        async getQuote(symbol) {
          return {
            ok: true,
            data: { price: 1500, changePercent: 1.2, currency: 'CNY' },
            meta: {
              symbol,
              source: 'eastmoney',
              asOf: '2026-07-20T05:55:00.000Z',
              observedAt: '2026-07-20T05:55:00.000Z',
              fetchedAt: '2026-07-20T06:00:00.000Z',
              ageSeconds: 300,
              delay: 'unknown'
            }
          };
        }
      }
    });

    const quote = res.writes.find((write) => write.includes('"name":"get_quote"') && write.includes('"status":"success"'));
    assert.match(quote, /"currency":"CNY"/);
    assert.match(quote, /"delay":"unknown"/);
    assert.match(quote, /"observedAt":"2026-07-20T05:55:00.000Z"/);
    assert.match(quote, /"fetchedAt":"2026-07-20T06:00:00.000Z"/);
    assert.match(quote, /"ageSeconds":300/);
    assert.match(upstreamBody.messages[0].content, /currency=CNY/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});
