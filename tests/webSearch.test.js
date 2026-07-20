import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildGoogleNewsRssUrl, searchWeb } from '../server/tools/web.js';
import { streamDeepSeek } from '../server/deepseek.js';
import { streamChat } from '../src/lib/chat.js';

function completedUpstream() {
  return {
    ok: true,
    body: {
      async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode('data: [DONE]\\n\\n');
      }
    }
  };
}

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

function rssResponse(text, status = 200) {
  return { ok: status === 200, status, text: async () => text };
}

const rss = `<?xml version="1.0"?><rss><channel>
  <item><title><![CDATA[可信新闻]]></title><link>https://news.google.com/rss/articles/CBMi123</link><source>演示媒体</source><pubDate>Wed, 15 Jul 2026 08:00:00 GMT</pubDate></item>
  <item><title>不安全链接</title><link>https://evil.example/article</link><source>恶意媒体</source><pubDate>Wed, 15 Jul 2026 09:00:00 GMT</pubDate></item>
  <item><title>缺失发布时间</title><link>https://news.google.com/rss/articles/CBMi456</link><source>演示媒体</source></item>
</channel></rss>`;

test('buildGoogleNewsRssUrl uses the fixed Google News RSS endpoint and contains malicious input only in q', () => {
  const url = new URL(buildGoogleNewsRssUrl('平安银行&gl=US#fragment'));

  assert.equal(url.origin + url.pathname, 'https://news.google.com/rss/search');
  assert.equal(url.searchParams.get('q'), '平安银行&gl=US#fragment');
  assert.equal(url.searchParams.get('hl'), 'zh-CN');
  assert.equal(url.searchParams.get('gl'), 'CN');
  assert.equal(url.searchParams.get('ceid'), 'CN:zh-Hans');
});

test('searchWeb filters unsafe or incomplete RSS items and exposes only normalized source fields', async () => {
  const result = await searchWeb('平安银行', {
    fetchImpl: async () => rssResponse(rss),
    now: new Date('2026-07-15T10:00:00.000Z')
  });

  assert.deepEqual(result, {
    ok: true,
    sources: [{
      title: '可信新闻',
      url: 'https://news.google.com/rss/articles/CBMi123',
      publisher: '演示媒体',
      publishedAt: '2026-07-15T08:00:00.000Z'
    }],
    serverTime: '2026-07-15T10:00:00.000Z',
    latestPublishedAt: '2026-07-15T08:00:00.000Z',
    latestAgeSeconds: 7200
  });
});

test('searchWeb sorts sources by the latest publish time and excludes future timestamps relative to the server clock', async () => {
  const mixedRss = `<?xml version="1.0"?><rss><channel>
    <item><title>较早新闻</title><link>https://news.google.com/rss/articles/old</link><source>媒体 A</source><pubDate>Wed, 15 Jul 2026 07:00:00 GMT</pubDate></item>
    <item><title>最新新闻</title><link>https://news.google.com/rss/articles/latest</link><source>媒体 B</source><pubDate>Wed, 15 Jul 2026 09:30:00 GMT</pubDate></item>
    <item><title>未来新闻</title><link>https://news.google.com/rss/articles/future</link><source>媒体 C</source><pubDate>Wed, 15 Jul 2026 12:00:00 GMT</pubDate></item>
  </channel></rss>`;

  const result = await searchWeb('平安银行', {
    fetchImpl: async () => rssResponse(mixedRss),
    now: new Date('2026-07-15T10:00:00.000Z')
  });

  assert.deepEqual(result.sources.map((source) => source.title), ['最新新闻', '较早新闻']);
  assert.equal(result.latestPublishedAt, '2026-07-15T09:30:00.000Z');
  assert.equal(result.latestAgeSeconds, 1800);
});

test('searchWeb returns a structured error for invalid queries, bad HTTP responses, and malformed RSS', async () => {
  assert.deepEqual(await searchWeb('', { fetchImpl: async () => { throw new Error('must not fetch'); } }), {
    ok: false,
    errorCode: 'invalid_query'
  });
  assert.deepEqual(await searchWeb('x'.repeat(121), { fetchImpl: async () => { throw new Error('must not fetch'); } }), {
    ok: false,
    errorCode: 'invalid_query'
  });
  assert.deepEqual(await searchWeb('平安银行', { fetchImpl: async () => rssResponse('', 503) }), {
    ok: false,
    errorCode: 'upstream_unavailable'
  });
  assert.deepEqual(await searchWeb('平安银行', { fetchImpl: async () => rssResponse('<html>bad</html>') }), {
    ok: false,
    errorCode: 'invalid_response'
  });
});

test('searchWeb returns a structured timeout error without throwing when the RSS request hangs', async () => {
  const result = await Promise.race([
    searchWeb('平安银行', { fetchImpl: () => new Promise(() => {}), timeoutMs: 5 }),
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 50))
  ]);

  assert.deepEqual(result, { ok: false, errorCode: 'timeout' });
});

test('web search stays off by default without a network call or web SSE event', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let searchCalls = 0;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async () => completedUpstream();

  try {
    const res = createSseResponse();
    await streamDeepSeek({ body: { messages: [{ role: 'user', content: '平安银行' }] } }, res, {
      webSearch: async () => { searchCalls += 1; return { ok: true, sources: [] }; }
    });

    assert.equal(searchCalls, 0);
    assert.equal(res.writes.some((chunk) => chunk.includes('search_web')), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('enabled web search emits ordered SSE events and injects an explicitly unverified context before the LLM request', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
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
      order.push(chunk.includes('"type":"tool_result"') ? 'tool_result' : chunk.includes('"type":"tool"') ? 'tool' : 'other');
      originalWrite.call(res, chunk);
    };
    await streamDeepSeek({ body: { webSearch: true, messages: [{ role: 'system', content: '原系统提示' }, { role: 'user', content: '平安银行' }] } }, res, {
      webSearch: async (query) => {
        assert.equal(query, '平安银行');
        return {
          ok: true,
          sources: [{ title: '可信新闻', url: 'https://news.google.com/rss/articles/CBMi123', publisher: '演示媒体', publishedAt: '2026-07-15T08:00:00.000Z' }],
          serverTime: '2026-07-15T10:00:00.000Z',
          latestPublishedAt: '2026-07-15T08:00:00.000Z',
          latestAgeSeconds: 7200
        };
      }
    });

    assert.deepEqual(order.slice(0, 3), ['tool', 'tool_result', 'upstream']);
    assert.match(res.writes[0], /"name":"search_web"/);
    assert.match(res.writes[0], /"query":"平安银行"/);
    assert.match(res.writes[1], /"status":"success"/);
    assert.match(res.writes[1], /"sources"/);
    assert.match(res.writes[1], /"serverTime":"2026-07-15T10:00:00.000Z"/);
    assert.match(res.writes[1], /"latestAgeSeconds":7200/);
    assert.match(upstreamBody.messages[1].content, /仅基于以下搜索结果回答，不能将其当成验证过的事实/);
    assert.match(upstreamBody.messages[1].content, /可信新闻/);
    assert.match(upstreamBody.messages[1].content, /7200/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('enabled weather request emits a weather tool record and injects date, location, and observed data without a news search', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let upstreamBody;
  let searchCalls = 0;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async (_, options) => {
    upstreamBody = JSON.parse(options.body);
    return completedUpstream();
  };

  try {
    const res = createSseResponse();
    await streamDeepSeek({
      ip: '203.0.113.10',
      body: { webSearch: true, messages: [{ role: 'user', content: '今天天气如何？' }] }
    }, res, {
      liveContext: async () => ({
        ok: true,
        serverTime: '2026-07-20T01:00:00.000Z',
        date: '2026-07-20',
        timeZone: 'Asia/Shanghai',
        location: 'Shanghai',
        weather: {
          city: 'Shanghai',
          observedAt: '2026-07-20T09:00',
          timeZone: 'Asia/Shanghai',
          ageSeconds: 0,
          temperatureC: 31.2,
          apparentTemperatureC: 35,
          weatherCode: 2,
          windSpeedKph: 12,
          source: 'open-meteo'
        }
      }),
      webSearch: async () => { searchCalls += 1; return { ok: true, sources: [] }; }
    });

    assert.match(res.writes[0], /"name":"get_weather"/);
    assert.match(res.writes[1], /"name":"get_weather"/);
    assert.match(res.writes[1], /"city":"Shanghai"/);
    assert.match(res.writes[1], /"serverTime":"2026-07-20T01:00:00.000Z"/);
    assert.match(res.writes[1], /"ageSeconds":0/);
    assert.equal(searchCalls, 0);
    assert.match(upstreamBody.messages[0].content, /2026-07-20/);
    assert.match(upstreamBody.messages[0].content, /Shanghai/);
    assert.match(upstreamBody.messages[0].content, /31.2/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('weather requests automatically invoke a live tool and prohibit delegating the lookup to users', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let upstreamBody;
  let searchCalls = 0;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async (_, options) => {
    upstreamBody = JSON.parse(options.body);
    return completedUpstream();
  };

  try {
    const res = createSseResponse();
    await streamDeepSeek({
      ip: '203.0.113.10',
      body: { messages: [{ role: 'user', content: '上海今天天气怎么样？' }] }
    }, res, {
      liveContext: async () => ({
        ok: true,
        serverTime: '2026-07-20T01:00:00.000Z',
        date: '2026-07-20',
        timeZone: 'Asia/Shanghai',
        location: 'Shanghai',
        weather: {
          city: 'Shanghai', observedAt: '2026-07-20T01:00:00.000Z', timeZone: 'Asia/Shanghai', ageSeconds: 0,
          temperatureC: 31.2, apparentTemperatureC: 35, weatherCode: 2, windSpeedKph: 12, source: 'open-meteo'
        }
      }),
      webSearch: async () => { searchCalls += 1; return { ok: true, sources: [] }; }
    });

    assert.match(res.writes[0], /"name":"get_weather"/);
    assert.equal(searchCalls, 0);
    assert.match(upstreamBody.messages[0].content, /不得建议用户前往 App、网站或搜索引擎/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('unavailable weather keeps the no-delegation instruction in the model context', async () => {
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
    await streamDeepSeek({
      ip: '203.0.113.10',
      body: { messages: [{ role: 'user', content: '上海今天天气怎么样？' }] }
    }, res, {
      liveContext: async () => ({ ok: false, errorCode: 'weather_unavailable' })
    });

    assert.match(res.writes[1], /"errorCode":"weather_unavailable"/);
    assert.match(upstreamBody.messages[0].content, /实时数据工具不可用/);
    assert.match(upstreamBody.messages[0].content, /不得建议用户前往 App、网站或搜索引擎/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('temporal news searches use the entity query and retain a current-context tool record', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let receivedQuery;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async () => completedUpstream();

  try {
    const res = createSseResponse();
    await streamDeepSeek({
      ip: '203.0.113.10',
      body: { messages: [{ role: 'user', content: '今天平安银行有什么新闻？' }] }
    }, res, {
      liveContext: async () => ({ ok: true, serverTime: '2026-07-20T01:00:00.000Z', date: '2026-07-20', timeZone: 'Asia/Shanghai', location: 'Shanghai' }),
      webSearch: async (query) => {
        receivedQuery = query;
        return { ok: true, sources: [] };
      }
    });

    assert.equal(receivedQuery, '平安银行');
    assert.match(res.writes[0], /"name":"get_current_context"/);
    assert.match(res.writes[1], /"date":"2026-07-20"/);
    assert.match(res.writes[1], /"serverTime"/);
    assert.match(res.writes[2], /"name":"search_web"/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('streamChat forwards the explicit webSearch choice in its request body', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(new ReadableStream({ start(controller) { controller.close(); } }), { status: 200 });
  };

  try {
    await streamChat([{ role: 'user', content: '平安银行' }], new AbortController().signal, {}, { webSearch: true });
    assert.deepEqual(requestBody, { messages: [{ role: 'user', content: '平安银行' }], webSearch: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the chat UI describes default automatic data access and renders linked source provenance', async () => {
  const [windowSource, appSource, itemSource] = await Promise.all([
    readFile(new URL('../src/components/ChatWindow.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/MessageItem.jsx', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(windowSource, /role="switch"/);
  assert.doesNotMatch(windowSource, /type="checkbox"/);
  assert.match(windowSource, /自动联网/);
  assert.match(windowSource, /时效问题将调用固定数据源/);
  assert.match(appSource, /streamChat\(payload, abortRef\.current\.signal,[\s\S]*\{ webSearch: false \}\)/);
  assert.match(itemSource, /联网搜索来源/);
  assert.match(itemSource, /event\.sources\.slice\(0, 5\)/);
  assert.match(itemSource, /event\.serverTime/);
  assert.match(itemSource, /event\.latestPublishedAt/);
  assert.match(itemSource, /event\.latestAgeSeconds/);
  assert.match(itemSource, /href=\{source\.url\}/);
  assert.match(itemSource, /source\.publisher/);
  assert.match(itemSource, /source\.publishedAt/);
  assert.match(itemSource, /event\.name === 'get_weather'/);
  assert.match(itemSource, /实时天气来源/);
  assert.match(itemSource, /event\.temperatureC/);
  assert.match(itemSource, /event\.observedAt/);
  assert.match(itemSource, /event\.ageSeconds/);
  assert.match(itemSource, /event\.name === 'get_current_context'/);
  assert.match(itemSource, /实时日期上下文/);
  assert.match(itemSource, /event\.errorCode/);
});
