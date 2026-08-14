import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolRegistry } from '../server/tools/registry.js';

test('publishes the fixed deploy-time manifests with closed schemas in a stable order', () => {
  const registry = createToolRegistry();
  const manifests = registry.manifests();
  const definitions = registry.definitions();

  assert.deepEqual(manifests.map((manifest) => manifest.name), [
    'get_weather',
    'search_news',
    'search_asset',
    'get_quote',
    'get_technical_indicators',
    'get_economic_calendar'
  ]);
  assert.deepEqual(definitions.map((tool) => tool.function.name), manifests.map((manifest) => manifest.name));
  for (const [index, manifest] of manifests.entries()) {
    const tool = definitions[index];
    assert.ok(tool);
    assert.strictEqual(tool, manifest.definition);
    assert.equal(manifest.version, '1.0.0');
    assert.equal(manifest.riskLevel, 'read_only');
    assert.equal(typeof manifest.execute, 'function');
    assert.equal(Number.isFinite(manifest.timeoutMs), true);
    assert.ok(manifest.timeoutMs > 0);
    assert.equal(Object.isFrozen(manifest), true);
    assert.equal(Object.isFrozen(manifest.definition), true);
    assert.equal(Object.isFrozen(manifest.definition.function), true);
    assert.equal(Object.isFrozen(manifest.definition.function.parameters), true);
    assert.equal(Object.isFrozen(manifest.definition.function.parameters.properties), true);
    assert.equal(Object.values(manifest.definition.function.parameters.properties).every(Object.isFrozen), true);
    assert.equal(tool.type, 'function');
    assert.equal(typeof tool.function.description, 'string');
    assert.ok(tool.function.description.length > 0);
    assert.equal(tool.function.parameters.type, 'object');
    assert.equal(tool.function.parameters.additionalProperties, false);
  }
  assert.deepEqual(definitions[0]?.function.parameters, {
    type: 'object',
    properties: { city: { type: 'string', maxLength: 64 } },
    additionalProperties: false
  });
  assert.deepEqual(definitions.slice(1).map((tool) => tool.function.parameters.required), [
    ['query'],
    ['query'],
    ['symbol'],
    ['symbol'],
    undefined
  ]);
});

test('executes fixed-window technical indicators from market candles and sanitizes provider data', async () => {
  const calls: unknown[] = [];
  const registry = createToolRegistry({
    marketGateway: {
      async getQuote() { return { ok: true, data: {}, meta: {} }; },
      async getCandles(symbol, options) {
        calls.push({ symbol, options });
        return {
          ok: true,
          data: Array.from({ length: 15 }, (_, index) => ({
            time: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
            close: index + 1,
            private: 'https://private.example'
          })),
          meta: { source: 'yahoo-finance', symbol, cached: false, private: '203.0.113.7' }
        };
      }
    }
  });

  const result = await registry.execute({ name: 'get_technical_indicators', arguments: '{"symbol":"AAPL.US"}' });

  assert.deepEqual(calls, [{
    symbol: 'AAPL.US',
    options: { interval: '1d', range: '1mo', signal: (calls[0] as { options: { signal?: AbortSignal } }).options.signal }
  }]);
  assert.deepEqual(result, {
    ok: true,
    name: 'get_technical_indicators',
    result: {
      data: { close: 15, sma14: 8.5, rsi14: 100, asOf: '2026-07-15T00:00:00.000Z' },
      meta: { source: 'yahoo-finance', symbol: 'AAPL.US', cached: false, interval: '1d', range: '1mo', points: 15 }
    }
  });
});

test('returns a sanitized fixed-source economic calendar and propagates cancellation', async () => {
  let childSignal: AbortSignal | undefined;
  const registry = createToolRegistry({
    now: () => new Date('2026-07-20T00:00:00.000Z'),
    economicCalendar: async (options) => {
      childSignal = options.signal;
      return {
        ok: true,
        source: 'forexfactory',
        fetchedAt: '2026-07-20T00:00:00.000Z',
        events: [{
          time: '2026-07-20T12:30:00.000Z', country: 'US', title: 'CPI', impact: 'high', actual: 'https://private.example', forecast: '2.5%', previous: '2.4%'
        }]
      };
    }
  });

  const result = await registry.execute({ name: 'get_economic_calendar', arguments: '{}' });

  assert.ok(childSignal);
  assert.deepEqual(result, {
    ok: true,
    name: 'get_economic_calendar',
    result: {
      events: [{ time: '2026-07-20T12:30:00.000Z', country: 'US', title: 'CPI', impact: 'high', forecast: '2.5%', previous: '2.4%' }],
      meta: { source: 'forexfactory', fetchedAt: '2026-07-20T00:00:00.000Z' }
    }
  });
});

test('returns the timeout error when a manifest executor does not settle', async () => {
  let childSignal: AbortSignal | undefined;
  let timeoutCallback: (() => void) | undefined;
  const registry = createToolRegistry({
    timeoutScheduler: {
      setTimeout(callback) {
        timeoutCallback = callback;
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout() {}
    },
    webSearch: async (_query, options) => {
      childSignal = options.signal;
      return new Promise(() => {});
    }
  });

  const result = registry.execute({ name: 'search_news', arguments: '{"query":"市场"}' });
  assert.ok(childSignal);
  timeoutCallback?.();
  assert.deepEqual(await result, {
    ok: false,
    name: 'search_news',
    errorCode: 'tool_execution_timeout'
  });
});

test('prioritizes parent cancellation over a manifest timeout and passes a child signal to the executor', async () => {
  const parent = new AbortController();
  let childSignal: AbortSignal | undefined;
  const registry = createToolRegistry({
    timeoutScheduler: {
      setTimeout() {
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout() {}
    },
    webSearch: async (_query, options) => {
      childSignal = options.signal;
      parent.abort();
      return new Promise(() => {});
    }
  });

  assert.deepEqual(await registry.execute(
    { name: 'search_news', arguments: '{"query":"市场"}' },
    { signal: parent.signal }
  ), {
    ok: false,
    name: 'search_news',
    errorCode: 'request_aborted'
  });
  assert.ok(childSignal);
  assert.notStrictEqual(childSignal, parent.signal);
  assert.equal(childSignal.aborted, true);
});

test('short-circuits pre-aborted execution without invoking a tool adapter', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const registry = createToolRegistry({
    liveContext: async () => { calls += 1; return { ok: true }; }
  });

  assert.deepEqual(await registry.execute(
    { name: 'get_weather', arguments: '{}' },
    { signal: controller.signal }
  ), {
    ok: false,
    name: 'get_weather',
    errorCode: 'request_aborted'
  });
  assert.equal(calls, 0);
});

test('forwards a child abort signal to every registry adapter', async () => {
  const controller = new AbortController();
  const signals: (AbortSignal | undefined)[] = [];
  const registry = createToolRegistry({
    liveContext: async (input) => { signals.push(input.signal); return { ok: true }; },
    webSearch: async (_query, options) => { signals.push(options.signal); return { ok: true }; },
    assetSearch: async (_query, options) => { signals.push(options.signal); return []; },
    marketGateway: { getQuote: async (_symbol, options) => { signals.push(options.signal); return { ok: true, data: {}, meta: {} }; } }
  });

  await registry.execute({ name: 'get_weather', arguments: '{}' }, { signal: controller.signal });
  await registry.execute({ name: 'search_news', arguments: '{"query":"市场"}' }, { signal: controller.signal });
  await registry.execute({ name: 'search_asset', arguments: '{"query":"资产"}' }, { signal: controller.signal });
  await registry.execute({ name: 'get_quote', arguments: '{"symbol":"AAPL"}' }, { signal: controller.signal });

  assert.equal(signals.length, 4);
  for (const signal of signals) {
    assert.ok(signal);
    assert.notStrictEqual(signal, controller.signal);
    assert.equal(signal.aborted, false);
  }
});

test('uses one field contract for published schemas and execution validation', async () => {
  const calls: string[] = [];
  const registry = createToolRegistry({
    liveContext: async () => { calls.push('get_weather'); return { ok: true }; },
    webSearch: async () => { calls.push('search_news'); return { ok: true }; },
    assetSearch: async () => { calls.push('search_asset'); return [{ market: 'cn' }]; },
    marketGateway: {
      getQuote: async () => { calls.push('get_quote'); return { ok: true, data: {}, meta: {} }; },
      getCandles: async () => {
        calls.push('get_technical_indicators');
        return {
          ok: true,
          data: Array.from({ length: 15 }, (_, index) => ({ time: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, close: index + 1 })),
          meta: {}
        };
      }
    },
    economicCalendar: async () => {
      calls.push('get_economic_calendar');
      return { ok: true, source: 'forexfactory', fetchedAt: '2026-07-20T00:00:00.000Z', events: [] };
    }
  });

  const callsByTool: Record<string, Record<string, string>> = {
    get_weather: {},
    search_news: { query: '新闻' },
    search_asset: { query: '资产' },
    get_quote: { symbol: 'AAPL' },
    get_technical_indicators: { symbol: 'AAPL' },
    get_economic_calendar: {}
  };
  const fieldsByTool: Record<string, string[]> = {
    get_weather: ['city'],
    search_news: ['query'],
    search_asset: ['query'],
    get_quote: ['symbol'],
    get_technical_indicators: ['symbol'],
    get_economic_calendar: []
  };
  for (const definition of registry.definitions()) {
    const { name, parameters } = definition.function;
    assert.deepEqual(Object.keys(parameters.properties), fieldsByTool[name]);
    const result = await registry.execute({ name, arguments: JSON.stringify(callsByTool[name]) });
    assert.equal(result.ok, true);
  }
  assert.deepEqual(calls, ['get_weather', 'search_news', 'search_asset', 'get_quote', 'get_technical_indicators', 'get_economic_calendar']);
});

test('executes weather with contextual IP and clock while returning safe weather data', async () => {
  const calls: unknown[] = [];
  const registryNow = () => new Date('2026-07-20T00:00:00.000Z');
  const contextNow = () => new Date('2026-07-20T01:00:00.000Z');
  const weather = { city: '上海', temperatureC: 31.2, source: 'open-meteo' };
  const registry = createToolRegistry({
    now: registryNow,
    liveContext: async (input) => {
      calls.push(input);
      return {
        ok: true,
        weather,
        location: '上海',
        date: '2026-07-20',
        serverTime: '2026-07-20T01:00:00.000Z',
        ip: '203.0.113.10',
        url: 'https://internal.example/weather'
      };
    }
  });

  const result = await registry.execute(
    { name: 'get_weather', arguments: '{"city":"上海"}' },
    { ip: '203.0.113.10', now: contextNow }
  );

  assert.equal(calls.length, 1);
  const weatherCall = calls[0] as { ip: string; content: string; now: () => Date; signal?: AbortSignal };
  assert.deepEqual(weatherCall, {
    ip: '203.0.113.10',
    content: '上海天气',
    now: contextNow,
    signal: weatherCall.signal
  });
  assert.notStrictEqual(weatherCall.signal, undefined);
  assert.deepEqual(result, {
    ok: true,
    name: 'get_weather',
    result: {
      weather,
      location: '上海',
      date: '2026-07-20',
      serverTime: '2026-07-20T01:00:00.000Z'
    }
  });
});

test('rejects malformed weather arguments before calling the live dependency', async () => {
  let calls = 0;
  const registry = createToolRegistry({
    liveContext: async () => {
      calls += 1;
      return { ok: true, weather: {} };
    }
  });

  for (const argumentsText of ['{"city":1}', '{"city":"上海","extra":true}']) {
    assert.deepEqual(await registry.execute({ name: 'get_weather', arguments: argumentsText }), {
      ok: false,
      name: 'get_weather',
      errorCode: 'invalid_arguments'
    });
  }
  assert.equal(calls, 0);
});

test('rejects invalid JSON, non-object arguments, and invalid strings before dependencies run', async () => {
  let calls = 0;
  const registry = createToolRegistry({
    liveContext: async () => { calls += 1; },
    webSearch: async () => { calls += 1; },
    assetSearch: async () => { calls += 1; },
    marketGateway: { getQuote: async () => { calls += 1; } }
  });

  for (const call of [
    { name: 'get_weather', arguments: '{' },
    { name: 'get_weather', arguments: '[]' },
    { name: 'get_weather', arguments: 'null' },
    { name: 'get_weather', arguments: '{"city":"   "}' },
    { name: 'search_news', arguments: JSON.stringify({ query: 'x'.repeat(121) }) },
    { name: 'search_asset', arguments: JSON.stringify({ query: 'x'.repeat(65) }) },
    { name: 'get_quote', arguments: JSON.stringify({ symbol: 'x'.repeat(33) }) }
  ]) {
    assert.deepEqual(await registry.execute(call), {
      ok: false,
      name: call.name,
      errorCode: 'invalid_arguments'
    });
  }
  assert.equal(calls, 0);
});

test('rejects unknown tools without executing a dependency', async () => {
  let calls = 0;
  const registry = createToolRegistry({
    liveContext: async () => { calls += 1; }
  });

  assert.deepEqual(await registry.execute({ name: 'shell', arguments: '{}' }), {
    ok: false,
    name: 'shell',
    errorCode: 'unknown_tool'
  });
  assert.equal(calls, 0);
});

test('caps and sanitizes asset search results', async () => {
  const registry = createToolRegistry({
    assetSearch: async () => Array.from({ length: 6 }, (_, index) => ({
      symbol: `ASSET${index}`,
      name: `资产 ${index}`,
      market: 'cn',
      type: 'stock',
      source: 'fixed-provider',
      url: 'https://provider.example/private',
      nested: { secret: true },
      ...(index === 1 ? { name: 2 } : {})
    }))
  });

  const result = await registry.execute({ name: 'search_asset', arguments: '{"query":"资产"}' });

  assert.deepEqual(result, {
    ok: true,
    name: 'search_asset',
    result: [
      { symbol: 'ASSET0', name: '资产 0', market: 'cn', type: 'stock', source: 'fixed-provider' },
      { symbol: 'ASSET1', market: 'cn', type: 'stock', source: 'fixed-provider' },
      { symbol: 'ASSET2', name: '资产 2', market: 'cn', type: 'stock', source: 'fixed-provider' },
      { symbol: 'ASSET3', name: '资产 3', market: 'cn', type: 'stock', source: 'fixed-provider' },
      { symbol: 'ASSET4', name: '资产 4', market: 'cn', type: 'stock', source: 'fixed-provider' }
    ]
  });
});

test('executes search_news with its adapter clock and returns sanitized news data', async () => {
  const now = () => new Date('2026-07-20T02:00:00.000Z');
  const calls: { query: string; options: { now: Date; signal?: AbortSignal } }[] = [];
  const registry = createToolRegistry({
    now,
    webSearch: async (query, options) => {
      calls.push({ query, options });
      return {
        ok: true,
        sources: [
          {
            title: '上海市场早报',
            publisher: '财经日报',
            publishedAt: '2026-07-20T01:00:00.000Z',
            url: 'https://news.example/private'
          },
          {
            title: 'https://private.example/headline',
            publisher: '203.0.113.10',
            publishedAt: '2026-07-20T00:00:00.000Z'
          },
          {
            title: 'Apple: Q2 earnings beat estimates',
            publisher: '财经日报',
            publishedAt: '2026-07-20T00:30:00.000Z'
          }
        ],
        serverTime: '2026-07-20T02:00:00.000Z',
        latestPublishedAt: '2026-07-20T01:00:00.000Z',
        latestAgeSeconds: 3600
      };
    }
  });

  const result = await registry.execute({ name: 'search_news', arguments: '{"query":"上海市场"}' });

  assert.equal(calls.length, 1);
  const [firstCall] = calls;
  assert.ok(firstCall);
  assert.equal(firstCall.query, '上海市场');
  assert.equal(firstCall.options.now.toISOString(), '2026-07-20T02:00:00.000Z');
  assert.deepEqual(result, {
    ok: true,
    name: 'search_news',
    result: {
      sources: [
        { title: '上海市场早报', publisher: '财经日报', publishedAt: '2026-07-20T01:00:00.000Z' },
        { publishedAt: '2026-07-20T00:00:00.000Z' },
        { title: 'Apple: Q2 earnings beat estimates', publisher: '财经日报', publishedAt: '2026-07-20T00:30:00.000Z' }
      ],
      serverTime: '2026-07-20T02:00:00.000Z',
      latestPublishedAt: '2026-07-20T01:00:00.000Z',
      latestAgeSeconds: 3600
    }
  });
});

test('normalizes get_quote to its public data and metadata fields', async () => {
  const registry = createToolRegistry({
    marketGateway: {
      async getQuote(symbol) {
        assert.equal(symbol, 'AAPL.US');
        return {
          ok: true,
          data: { price: 210, changePercent: 5, currency: 'USD', private: 'omit' },
          meta: {
            source: 'yahoo-finance',
            asOf: '2026-07-20T00:00:00.000Z',
            observedAt: '2026-07-20T00:00:00.000Z',
            fetchedAt: '2026-07-20T00:00:01.000Z',
            ageSeconds: 1,
            delay: 'unknown',
            symbol,
            confidence: 'provider',
            cached: false,
            url: 'https://private.example'
          }
        };
      }
    }
  });

  const result = await registry.execute({ name: 'get_quote', arguments: '{"symbol":"AAPL.US"}' });

  assert.deepEqual(result, {
    ok: true,
    name: 'get_quote',
    result: {
      data: { price: 210, changePercent: 5, currency: 'USD' },
      meta: {
        source: 'yahoo-finance',
        asOf: '2026-07-20T00:00:00.000Z',
        observedAt: '2026-07-20T00:00:00.000Z',
        fetchedAt: '2026-07-20T00:00:01.000Z',
        ageSeconds: 1,
        delay: 'unknown',
        symbol: 'AAPL.US',
        confidence: 'provider',
        cached: false
      }
    }
  });
});

test('omits raw URL and IP strings from every tool result', async () => {
  const registry = createToolRegistry({
    liveContext: async () => ({
      ok: true,
      weather: {
        city: 'https://weather.example',
        observedAt: '203.0.113.10',
        timeZone: 'Asia/Shanghai',
        source: '2001:db8::1'
      },
      location: 'https://location.example',
      date: '198.51.100.2'
    }),
    webSearch: async () => ({
      ok: true,
      sources: [{ title: 'https://news.example', publisher: '203.0.113.11', publishedAt: '2026-07-20T00:00:00.000Z' }],
      serverTime: 'https://time.example',
      latestPublishedAt: '203.0.113.12'
    }),
    assetSearch: async () => ([{
      symbol: '203.0.113.13',
      name: 'https://asset.example',
      market: 'cn',
      type: 'stock',
      source: '2001:db8::2'
    }]),
    marketGateway: {
      getQuote: async () => ({
        ok: true,
        data: { price: 1, changePercent: 2, currency: 'https://currency.example' },
        meta: {
          source: '203.0.113.14',
          asOf: 'https://asof.example',
          observedAt: '203.0.113.15',
          fetchedAt: 'https://fetch.example',
          delay: '203.0.113.16',
          symbol: 'https://symbol.example',
          confidence: '203.0.113.17',
          cached: false
        }
      })
    }
  });

  const results = await Promise.all([
    registry.execute({ name: 'get_weather', arguments: '{}' }),
    registry.execute({ name: 'search_news', arguments: '{"query":"新闻"}' }),
    registry.execute({ name: 'search_asset', arguments: '{"query":"资产"}' }),
    registry.execute({ name: 'get_quote', arguments: '{"symbol":"AAPL"}' })
  ]);

  const serialized = JSON.stringify(results);
  assert.doesNotMatch(serialized, /https?:\/\//iu);
  assert.doesNotMatch(serialized, /(?:\d{1,3}\.){3}\d{1,3}|2001:db8::/u);
  assert.deepEqual(results[2], {
    ok: true,
    name: 'search_asset',
    result: [{ market: 'cn', type: 'stock' }]
  });
  assert.equal(results.every((result) => result.ok), true);
});

test('drops every URI scheme, embedded IPv4, and nested quote or weather values', async () => {
  const registry = createToolRegistry({
    liveContext: async () => ({
      ok: true,
      weather: {
        city: 'file:/private/weather',
        observedAt: 'ws://weather.example/socket',
        timeZone: 'Asia/Shanghai',
        source: 'abc203.0.113.10',
        temperatureC: { endpoint: 'mailto:weather@example.com', safe: 31.2 },
        weatherCode: ['data:text/plain,secret', 2]
      },
      location: 'custom:/private/location'
    }),
    marketGateway: {
      getQuote: async () => ({
        ok: true,
        data: {
          price: { source: 'file:///private/quote', value: 210 },
          changePercent: ['ws://quote.example/socket', 5],
          currency: 'mailto:quote@example.com'
        },
        meta: {
          source: { host: 'abc203.0.113.11', label: 'Yahoo' },
          delay: ['data:text/plain,secret', 'unknown'],
          cached: false
        }
      })
    }
  });

  const results = await Promise.all([
    registry.execute({ name: 'get_weather', arguments: '{}' }),
    registry.execute({ name: 'get_quote', arguments: '{"symbol":"AAPL"}' })
  ]);

  const serialized = JSON.stringify(results);
  assert.doesNotMatch(serialized, /(?:file|ws|mailto|data|custom):/iu);
  assert.doesNotMatch(serialized, /203\.0\.113\.1[01]/u);
  assert.deepEqual(results, [
    {
      ok: true,
      name: 'get_weather',
      result: {
        weather: {
          timeZone: 'Asia/Shanghai'
        }
      }
    },
    {
      ok: true,
      name: 'get_quote',
      result: {
        data: {},
        meta: { cached: false }
      }
    }
  ]);
});

test('keeps only per-field valid scalars and rejects embedded IPv6', async () => {
  const registry = createToolRegistry({
    liveContext: async () => ({
      ok: true,
      weather: {
        city: '上海',
        observedAt: '2026-07-20T01:00:00.000Z',
        timeZone: 'Asia/Shanghai',
        ageSeconds: 60,
        temperatureC: 31.2,
        apparentTemperatureC: '31.5',
        weatherCode: Number.NaN,
        windSpeedKph: [12],
        source: '11000:2000::1'
      },
      location: '上海',
      date: '2026-07-20'
    }),
    webSearch: async () => ({
      ok: true,
      sources: [
        { title: '上海市场早报', publisher: '财经日报', publishedAt: '2026-07-20T01:00:00.000Z' },
        { title: 'x'.repeat(301), publisher: ['nested'], publishedAt: 'not-a-date' }
      ],
      serverTime: '2026-07-20T02:00:00.000Z',
      latestPublishedAt: 'tomorrow',
      latestAgeSeconds: Number.NaN
    }),
    assetSearch: async () => ([
      { symbol: '600519.SH', name: '贵州茅台', market: 'cn', type: 'stock', source: 'local-index' },
      { symbol: { nested: '600519.SH' }, name: 'x'.repeat(201), market: 'cn' }
    ]),
    marketGateway: {
      getQuote: async () => ({
        ok: true,
        data: { price: 210, changePercent: Number.NaN, currency: { value: 'USD' } },
        meta: {
          source: 'yahoo-finance',
          asOf: '2026-07-20T01:00:00.000Z',
          observedAt: 'bad-date',
          fetchedAt: '2026-07-20T01:01:00.000Z',
          ageSeconds: -1,
          delay: 'unknown',
          symbol: 'AAPL.US',
          confidence: 'provider',
          cached: true
        }
      })
    }
  });

  const results = await Promise.all([
    registry.execute({ name: 'get_weather', arguments: '{}' }),
    registry.execute({ name: 'search_news', arguments: '{"query":"市场"}' }),
    registry.execute({ name: 'search_asset', arguments: '{"query":"资产"}' }),
    registry.execute({ name: 'get_quote', arguments: '{"symbol":"AAPL"}' })
  ]);

  assert.doesNotMatch(JSON.stringify(results), /1000:2000::1/u);
  assert.deepEqual(results, [
    {
      ok: true,
      name: 'get_weather',
      result: {
        weather: {
          city: '上海',
          observedAt: '2026-07-20T01:00:00.000Z',
          timeZone: 'Asia/Shanghai',
          ageSeconds: 60,
          temperatureC: 31.2
        },
        location: '上海',
        date: '2026-07-20'
      }
    },
    {
      ok: true,
      name: 'search_news',
      result: {
        sources: [
          { title: '上海市场早报', publisher: '财经日报', publishedAt: '2026-07-20T01:00:00.000Z' },
          {}
        ],
        serverTime: '2026-07-20T02:00:00.000Z'
      }
    },
    {
      ok: true,
      name: 'search_asset',
      result: [
        { symbol: '600519.SH', name: '贵州茅台', market: 'cn', type: 'stock', source: 'local-index' },
        { market: 'cn' }
      ]
    },
    {
      ok: true,
      name: 'get_quote',
      result: {
        data: { price: 210 },
        meta: {
          source: 'yahoo-finance',
          asOf: '2026-07-20T01:00:00.000Z',
          fetchedAt: '2026-07-20T01:01:00.000Z',
          delay: 'unknown',
          symbol: 'AAPL.US',
          confidence: 'provider',
          cached: true
        }
      }
    }
  ]);
});
