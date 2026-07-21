const GOOGLE_NEWS_RSS_URL = 'https://news.google.com/rss/search';
const MAX_QUERY_LENGTH = 120;
const MAX_SOURCES = 5;
const TIMEOUT_MS = 8000;

function decodeXml(value) {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&#(x[0-9a-fA-F]+|\d+);/g, (_, entity) => {
      const codePoint = entity.startsWith('x') ? Number.parseInt(entity.slice(1), 16) : Number.parseInt(entity, 10);
      return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function itemTag(item, tagName) {
  const match = item.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}\\s*>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function safeNewsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'news.google.com' ? url.href : null;
  } catch {
    return null;
  }
}

function parseRssItems(xml, serverTimeMs) {
  if (typeof xml !== 'string' || !/<rss\b/i.test(xml)) throw new Error('invalid RSS');

  const sources = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)) {
    const item = match[1];
    const title = itemTag(item, 'title');
    const url = safeNewsUrl(itemTag(item, 'link'));
    const publisher = itemTag(item, 'source');
    const publishedAtValue = itemTag(item, 'pubDate');
    const publishedAtMs = Date.parse(publishedAtValue);
    if (!title || !url || !publisher || Number.isNaN(publishedAtMs) || publishedAtMs > serverTimeMs) continue;
    sources.push({ title, url, publisher, publishedAt: new Date(publishedAtMs).toISOString(), publishedAtMs });
  }
  return sources
    .sort((left, right) => right.publishedAtMs - left.publishedAtMs)
    .slice(0, MAX_SOURCES)
    .map(({ publishedAtMs, ...source }) => source);
}

function isValidQuery(query) {
  return typeof query === 'string' && query.trim().length > 0 && query.length <= MAX_QUERY_LENGTH;
}

async function fetchRss(fetchImpl, url, timeoutMs, signal) {
  if (signal?.aborted) return { ok: false, errorCode: 'request_aborted' };
  const controller = new AbortController();
  let timeoutId;
  let removeAbortListener = () => {};
  try {
    const cancelled = new Promise((resolve) => {
      const abort = () => {
        controller.abort();
        resolve({ aborted: true });
      };
      signal?.addEventListener('abort', abort, { once: true });
      removeAbortListener = () => signal?.removeEventListener('abort', abort);
    });
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        resolve({ timedOut: true });
      }, timeoutMs);
    });
    const response = await Promise.race([
      fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal }),
      timeout,
      cancelled
    ]);
    if (response?.aborted) return { ok: false, errorCode: 'request_aborted' };
    if (response?.timedOut) return { ok: false, errorCode: 'timeout' };
    if (!response || response.status !== 200 || !response.ok || typeof response.text !== 'function') {
      return { ok: false, errorCode: 'upstream_unavailable' };
    }
    const text = await Promise.race([response.text(), timeout, cancelled]);
    if (text?.aborted) return { ok: false, errorCode: 'request_aborted' };
    if (text?.timedOut) return { ok: false, errorCode: 'timeout' };
    return { ok: true, text };
  } catch {
    if (signal?.aborted) return { ok: false, errorCode: 'request_aborted' };
    return { ok: false, errorCode: 'upstream_unavailable' };
  } finally {
    clearTimeout(timeoutId);
    removeAbortListener();
  }
}

export function buildGoogleNewsRssUrl(query) {
  const params = new URLSearchParams({ q: query, hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans' });
  return `${GOOGLE_NEWS_RSS_URL}?${params}`;
}

export async function searchWeb(query, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, now = new Date(), signal } = {}) {
  if (signal?.aborted) return { ok: false, errorCode: 'request_aborted' };
  if (!isValidQuery(query)) return { ok: false, errorCode: 'invalid_query' };

  const serverNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const requestTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : TIMEOUT_MS;
  const response = await fetchRss(fetchImpl, buildGoogleNewsRssUrl(query), requestTimeoutMs, signal);
  if (!response.ok) return response;

  try {
    const sources = parseRssItems(response.text, serverNow.getTime());
    const latestPublishedAt = sources[0]?.publishedAt ?? null;
    return {
      ok: true,
      sources,
      serverTime: serverNow.toISOString(),
      latestPublishedAt,
      latestAgeSeconds: latestPublishedAt === null ? null : Math.floor((serverNow.getTime() - Date.parse(latestPublishedAt)) / 1000)
    };
  } catch {
    return { ok: false, errorCode: 'invalid_response' };
  }
}
