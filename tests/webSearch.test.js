import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildGoogleNewsRssUrl, searchWeb } from '../server/tools/web.js';
import { streamChat } from '../src/lib/chat.js';

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

test('streamChat sends only model messages; the server selects registered tools', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(new ReadableStream({ start(controller) { controller.close(); } }), { status: 200 });
  };

  try {
    await streamChat([{ role: 'user', content: '平安银行' }], new AbortController().signal, {});
    assert.deepEqual(requestBody, { messages: [{ role: 'user', content: '平安银行' }] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the server creates one model-directed registry and the UI renders its generic result shape', async () => {
  const [serverSource, windowSource, appSource, itemSource] = await Promise.all([
    readFile(new URL('../server/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ChatWindow.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/MessageItem.jsx', import.meta.url), 'utf8')
  ]);

  assert.match(serverSource, /createToolRegistry\(\{[\s\S]*liveContext: resolveLiveContext,[\s\S]*webSearch: searchWeb,[\s\S]*marketGateway,[\s\S]*assetSearch/);
  assert.match(serverSource, /streamDeepSeek\(req, res, \{ toolRegistry \}\)/);
  assert.doesNotMatch(serverSource, /streamDeepSeek\(req, res, \{ marketGateway \}\)/);
  assert.doesNotMatch(windowSource, /自动联网|固定数据源/);
  assert.doesNotMatch(appSource, /webSearch/);
  assert.match(itemSource, /event\.type === 'tool'/);
  assert.match(itemSource, /event\.type !== 'tool_result'/);
  assert.match(itemSource, /event\.result/);
  assert.match(itemSource, /event\.ok/);
  assert.match(itemSource, /event\.errorCode/);
  assert.match(itemSource, /event\.name === 'get_weather'/);
  assert.match(itemSource, /实时天气来源/);
  assert.match(itemSource, /event\.name === 'search_news'/);
  assert.match(itemSource, /event\.name === 'search_asset'/);
  assert.match(itemSource, /event\.name === 'get_quote'/);
  assert.doesNotMatch(itemSource, /source\.url|href=\{source\.url\}/);
});
