import { normalizeSymbol } from './symbols.js';
import type { AssetSearchResponse, AssetSearchResult, FetchLike } from './types.js';

export const ASSET_INDEX = Object.freeze([
  Object.freeze({ aliases: Object.freeze(['贵州茅台', '茅台']), symbol: '600519.SH', name: '贵州茅台', market: 'cn', type: 'stock' }),
  Object.freeze({ aliases: Object.freeze(['腾讯', '腾讯控股', 'tencent']), symbol: '0700.HK', name: '腾讯控股', market: 'hk', type: 'stock' }),
  Object.freeze({ aliases: Object.freeze(['苹果', 'apple']), symbol: 'AAPL', name: 'Apple', market: 'us', type: 'stock' }),
  Object.freeze({ aliases: Object.freeze(['比特币', 'btc', 'bitcoin']), symbol: 'BTC/USDT', name: '比特币', market: 'crypto', type: 'crypto' })
]);

const EASTMONEY_SUGGEST_URL = 'https://searchapi.eastmoney.com/api/suggest/get';
const TENCENT_SMARTBOX_URL = 'https://smartbox.gtimg.cn/s3/';
const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const MAX_RESULTS = 10;
const EASTMONEY_SUGGEST_TIMEOUT_MS = 5_000;
const EASTMONEY_FETCH_OPTIONS = Object.freeze({
  headers: Object.freeze({
    'User-Agent': 'Mozilla/5.0 (compatible; deepseek-agent-demo/1.0)',
    Referer: 'https://www.eastmoney.com/'
  })
});
const ABORTED = Symbol('aborted');
type Aborted = typeof ABORTED;
type UnknownRecord = Record<string, unknown>;
type ProviderResponse = { ok: true; payload: unknown } | { ok: false; errorCode: string };
type ChineseAssetResolution = { ok: true; asset: Pick<AssetSearchResult, 'symbol' | 'name' | 'market'> } | { ok: false; errorCode: string };

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function waitForProvider<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T | Aborted> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      resolve(ABORTED);
    };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); }
    );
  });
}

function withSignal(options: RequestInit | undefined, signal: AbortSignal | undefined): RequestInit | undefined {
  if (!signal) return options;
  return { ...(options ?? {}), signal };
}

function normalizedQuery(query: unknown): string {
  return typeof query === 'string' ? query.trim() : '';
}

function directSymbolResult(query: string): AssetSearchResult | null {
  try {
    const normalized = normalizeSymbol(query);
    return {
      symbol: normalized.market === 'us' ? normalized.providerSymbol : normalized.canonical,
      name: normalized.canonical,
      market: normalized.market,
      type: normalized.market === 'crypto' ? 'crypto' : 'stock',
      source: 'direct-symbol'
    };
  } catch {
    return null;
  }
}

export function buildEastmoneySuggestUrl(query: string): string {
  const url = new URL(EASTMONEY_SUGGEST_URL);
  url.searchParams.set('input', query);
  url.searchParams.set('type', '14');
  return url.toString();
}

export function buildTencentSuggestUrl(query: string): string {
  const url = new URL(TENCENT_SMARTBOX_URL);
  url.searchParams.set('t', 'all');
  url.searchParams.set('q', query);
  return url.toString();
}

function buildYahooSearchUrl(query: string): string {
  const url = new URL(YAHOO_SEARCH_URL);
  url.searchParams.set('q', query);
  return url.toString();
}

function firstArray(...values: unknown[]): unknown[] {
  return values.find(Array.isArray) ?? [];
}

function eastmoneyRows(payload: unknown): unknown[] {
  const root = isRecord(payload) ? payload : {};
  const result = isRecord(root.result) ? root.result : {};
  const suggest = isRecord(root.suggest) ? root.suggest : {};
  const quotation = isRecord(root.QuotationCodeTable) ? root.QuotationCodeTable : {};
  const data = isRecord(root.data) ? root.data : {};
  return firstArray(
    result.data,
    result.Data,
    root.result,
    suggest.data,
    suggest.Data,
    root.suggest,
    quotation.Data,
    data.data,
    root.data
  );
}

function field(row: unknown, ...keys: string[]): string {
  const record = isRecord(row) ? row : {};
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  }
  return '';
}

function eastmoneyMarket(row: unknown, code: string): string {
  const details = [
    field(row, 'market', 'Market', 'marketType', 'MarketType', 'marketCode', 'MarketCode', 'JYS'),
    field(row, 'securityTypeName', 'SecurityTypeName', 'typeName', 'TypeName'),
    field(row, 'quoteId', 'QuoteID', 'secid', 'Secid', 'id', 'ID')
  ].join(' ').toUpperCase();
  if (/\.HK$/.test(code) || /(^|\W)(HK|H股|港股|116)(\W|$)/.test(details)) return 'HK';
  if (/\.(SZ)$/.test(code) || /(^|\W)(SZ|0)(\W|$)|深/.test(details)) return 'SZ';
  if (/\.(SH|SS)$/.test(code) || /(^|\W)(SH|SS|1)(\W|$)|沪/.test(details)) return 'SH';
  return '';
}

function eastmoneySymbol(row: unknown) {
  const rawCode = field(row, 'code', 'Code', 'securityCode', 'SecurityCode', 'symbol', 'Symbol');
  if (!rawCode) return null;

  const code = rawCode.toUpperCase().replace(/^(SH|SZ|HK)/, '');
  const market = eastmoneyMarket(row, rawCode.toUpperCase())
    || (/^SH/.test(rawCode.toUpperCase()) ? 'SH' : /^SZ/.test(rawCode.toUpperCase()) ? 'SZ' : /^HK/.test(rawCode.toUpperCase()) ? 'HK' : '');
  if (!market || !/^\d{4,6}(?:\.(?:SH|SS|SZ|HK))?$/.test(code)) return null;

  const bareCode = code.replace(/\.(?:SH|SS|SZ|HK)$/, '');
  try {
    return normalizeSymbol(`${bareCode}.${market}`);
  } catch {
    return null;
  }
}

export function parseEastmoneySuggest(payload: unknown): AssetSearchResult[] {
  return eastmoneyRows(payload).flatMap((row) => {
    const normalized = eastmoneySymbol(row);
    if (!normalized || (normalized.market !== 'cn' && normalized.market !== 'hk')) return [];
    return [{
      symbol: normalized.canonical,
      name: field(row, 'name', 'Name', 'shortName', 'ShortName', 'securityName', 'SecurityName') || normalized.canonical,
      market: normalized.market,
      type: 'stock',
      source: 'eastmoney-suggest'
    }];
  });
}

async function fetchEastmoneySuggest(fetchImpl: FetchLike, query: string, timeoutMs: number): Promise<ProviderResponse> {
  const controller = new AbortController();
  let timer;
  const request: Promise<ProviderResponse> = (async () => {
    try {
      const response = await fetchImpl(buildEastmoneySuggestUrl(query), {
        ...EASTMONEY_FETCH_OPTIONS,
        signal: controller.signal
      });
      if (!response?.ok) return { ok: false, errorCode: 'provider_unavailable' };

      const text = typeof response.text === 'function' ? await response.text() : '';
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = parseJsonp(text);
      }
      return payload ? { ok: true, payload } : { ok: false, errorCode: 'provider_invalid_response' };
    } catch {
      return { ok: false, errorCode: 'provider_unavailable' };
    }
  })();
  const timeout: Promise<ProviderResponse> = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, errorCode: 'provider_unavailable' });
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTencentSuggest(fetchImpl: FetchLike, query: string, timeoutMs: number): Promise<ProviderResponse> {
  const controller = new AbortController();
  let timer;
  const request: Promise<ProviderResponse> = (async () => {
    try {
      const response = await fetchImpl(buildTencentSuggestUrl(query), { signal: controller.signal });
      if (!response?.ok || typeof response.text !== 'function') {
        return { ok: false, errorCode: 'provider_unavailable' };
      }
      const payload = await response.text();
      return typeof payload === 'string'
        ? { ok: true, payload }
        : { ok: false, errorCode: 'provider_invalid_response' };
    } catch {
      return { ok: false, errorCode: 'provider_unavailable' };
    }
  })();
  const timeout: Promise<ProviderResponse> = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, errorCode: 'provider_unavailable' });
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveChineseAssetName(
  query: unknown,
  fetchImpl: FetchLike = fetch,
  { timeoutMs = EASTMONEY_SUGGEST_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<Pick<AssetSearchResult, 'symbol' | 'name' | 'market'> | null> {
  const result = await resolveChineseAssetNameWithStatus(query, fetchImpl, { timeoutMs });
  return result.ok ? result.asset : null;
}

async function resolveChineseAssetNameWithStatusUncached(
  query: unknown,
  fetchImpl: FetchLike,
  { timeoutMs }: { timeoutMs: number }
): Promise<ChineseAssetResolution> {
  const value = normalizedQuery(query);
  if (!value || value.length > 32) return { ok: false, errorCode: 'not_found' };

  const response = await fetchEastmoneySuggest(fetchImpl, value, timeoutMs);
  const isBareCode = /^\d{6}$/.test(value);
  const matchesQuery = (asset: AssetSearchResult) => asset.market === 'cn' && (
    isBareCode ? asset.symbol.startsWith(`${value}.`) : asset.name === value
  );
  const eastmoneyResult = response.ok
    ? parseEastmoneySuggest(response.payload).find(matchesQuery)
    : null;
  if (eastmoneyResult) {
    return { ok: true, asset: { symbol: eastmoneyResult.symbol, name: eastmoneyResult.name, market: eastmoneyResult.market } };
  }

  // Tencent is a fixed fallback only when Eastmoney has no exact A-share match.
  const tencent = await fetchTencentSuggest(fetchImpl, value, timeoutMs);
  const tencentResult = tencent.ok ? parseTencentSuggest(tencent.payload).find(matchesQuery) : null;
  if (tencentResult) {
    return { ok: true, asset: { symbol: tencentResult.symbol, name: tencentResult.name, market: tencentResult.market } };
  }

  if (!response.ok || !tencent.ok) return { ok: false, errorCode: 'provider_unavailable' };
  return { ok: false, errorCode: 'not_found' };
}

export function createChineseAssetNameResolver({
  fetchImpl = fetch,
  timeoutMs = EASTMONEY_SUGGEST_TIMEOUT_MS,
  cacheTtlMs = 3000,
  maxCacheEntries = 200,
  now = () => Date.now()
}: { fetchImpl?: FetchLike; timeoutMs?: number; cacheTtlMs?: number; maxCacheEntries?: number; now?: () => number } = {}) {
  const cache = new Map<string, { result: ChineseAssetResolution; expiresAt: number }>();
  const inFlight = new Map<string, Promise<ChineseAssetResolution>>();
  const ttl = Number.isFinite(cacheTtlMs) && cacheTtlMs >= 0 ? cacheTtlMs : 3000;
  const limit = Number.isInteger(maxCacheEntries) && maxCacheEntries >= 0 ? maxCacheEntries : 200;

  return async function resolve(query: unknown): Promise<ChineseAssetResolution> {
    const value = normalizedQuery(query);
    if (!value || value.length > 32) return { ok: false, errorCode: 'not_found' };

    const cached = cache.get(value);
    if (cached && cached.expiresAt > now()) return cached.result;
    if (cached) cache.delete(value);

    const pending = inFlight.get(value);
    if (pending) return pending;

    const request = resolveChineseAssetNameWithStatusUncached(value, fetchImpl, { timeoutMs })
      .then((result) => {
        if (result.ok && limit > 0) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey !== undefined) cache.delete(oldestKey);
          cache.set(value, { result, expiresAt: now() + ttl });
        }
        return result;
      })
      .finally(() => inFlight.delete(value));
    inFlight.set(value, request);
    return request;
  };
}

const defaultChineseAssetNameResolver = createChineseAssetNameResolver();

export async function resolveChineseAssetNameWithStatus(
  query: unknown,
  fetchImpl: FetchLike = fetch,
  { timeoutMs = EASTMONEY_SUGGEST_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<ChineseAssetResolution> {
  if (fetchImpl === fetch && timeoutMs === EASTMONEY_SUGGEST_TIMEOUT_MS) return defaultChineseAssetNameResolver(query);
  return resolveChineseAssetNameWithStatusUncached(query, fetchImpl, { timeoutMs });
}

function parseTencentHint(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  // Match a JSON-compatible string literal without evaluating provider JavaScript.
  const match = text.match(/^\s*(?:var\s+)?v_hint\s*=\s*("(?:\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|[^"\\])*")\s*;?\s*$/);
  if (!match) return null;

  try {
    return JSON.parse(match[1] ?? '');
  } catch {
    return null;
  }
}

function tencentSymbol(market: unknown, rawCode: unknown) {
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
  try {
    if ((market === 'sh' || market === 'sz') && /^\d{6}$/.test(code)) {
      return normalizeSymbol(`${code}.${market.toUpperCase()}`);
    }
    if (market === 'hk' && /^\d{4,5}$/.test(code)) {
      return normalizeSymbol(`${code.replace(/^0(?=\d{4}$)/, '')}.HK`);
    }
    if (market === 'us' && /^[A-Z][A-Z0-9]{0,14}$/.test(code)) {
      return normalizeSymbol(code);
    }
  } catch {
    return null;
  }
  return null;
}

export function parseTencentSuggest(text: unknown): AssetSearchResult[] {
  const hint = parseTencentHint(text);
  if (!hint) return [];

  return hint.split('^').flatMap((row) => {
    const [rawMarket, code, name, , rawType] = row.split('~');
    const market = rawMarket?.toLowerCase();
    const type = rawType?.toUpperCase();
    if ((type !== 'GP' && type !== 'GP-A') || !name?.trim()) return [];

    const normalized = tencentSymbol(market, code);
    if (!normalized) return [];
    return [{
      symbol: normalized.market === 'us' ? normalized.providerSymbol : normalized.canonical,
      name: name.trim(),
      market: normalized.market,
      type: 'stock',
      source: 'tencent-smartbox'
    }];
  });
}

function yahooCryptoSymbol(symbol: unknown): string | null {
  const match = typeof symbol === 'string' && symbol.trim().toUpperCase().match(/^([A-Z0-9]{2,15})-(USD|USDT)$/);
  return match ? `${match[1]}/USDT` : null;
}

function toYahooResult(quote: unknown): AssetSearchResult | null {
  const record = isRecord(quote) ? quote : {};
  const cryptoSymbol = yahooCryptoSymbol(record.symbol);
  if (cryptoSymbol) {
    return {
      symbol: cryptoSymbol,
      name: typeof record.shortname === 'string' ? record.shortname : typeof record.longname === 'string' ? record.longname : cryptoSymbol,
      market: 'crypto',
      type: 'crypto',
      source: 'yahoo-finance'
    };
  }

  try {
    const normalized = normalizeSymbol(record.symbol);
    return {
      symbol: normalized.market === 'us' ? normalized.providerSymbol : normalized.canonical,
      name: typeof record.shortname === 'string' ? record.shortname : typeof record.longname === 'string' ? record.longname : normalized.canonical,
      market: normalized.market,
      type: typeof record.quoteType === 'string' ? record.quoteType : 'UNKNOWN',
      source: 'yahoo-finance'
    };
  } catch {
    return null;
  }
}

function parseJsonp(text: unknown): unknown | null {
  if (typeof text !== 'string') return null;
  const match = text.match(/^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(\s*([\[{][\s\S]*[\]}])\s*\)\s*;?\s*$/);
  if (!match) return null;

  try {
    return JSON.parse(match[1] ?? '');
  } catch {
    return null;
  }
}

async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  options: RequestInit | undefined,
  signal: AbortSignal | undefined
): Promise<unknown | null | Aborted> {
  if (signal?.aborted) return ABORTED;
  try {
    const response = await waitForProvider(fetchImpl(url, withSignal(options, signal)), signal);
    if (response === ABORTED) return ABORTED;
    if (!response?.ok) return null;
    if (typeof response.text === 'function') {
      const text = await waitForProvider(response.text(), signal);
      if (text === ABORTED) return ABORTED;
      try {
        return JSON.parse(text);
      } catch {
        return parseJsonp(text);
      }
    }
    const payload = typeof response.json === 'function' ? await waitForProvider(response.json(), signal) : null;
    return payload === ABORTED ? ABORTED : payload;
  } catch {
    return signal?.aborted ? ABORTED : null;
  }
}

async function fetchText(fetchImpl: FetchLike, url: string, signal: AbortSignal | undefined): Promise<string | null | Aborted> {
  if (signal?.aborted) return ABORTED;
  try {
    const response = await waitForProvider(fetchImpl(url, withSignal(undefined, signal)), signal);
    if (response === ABORTED) return ABORTED;
    if (!response?.ok || typeof response.text !== 'function') return null;
    const text = await waitForProvider(response.text(), signal);
    return text === ABORTED ? ABORTED : text;
  } catch {
    return signal?.aborted ? ABORTED : null;
  }
}

function mergeResults(...resultSets: AssetSearchResult[][]): AssetSearchResult[] {
  const seen = new Set<string>();
  return resultSets.flat().filter((result) => {
    if (!result || seen.has(`${result.market}:${result.symbol}`)) return false;
    seen.add(`${result.market}:${result.symbol}`);
    return true;
  }).slice(0, MAX_RESULTS);
}

export function createAssetSearch({ fetchImpl = fetch }: { fetchImpl?: FetchLike } = {}) {
  return async function searchAssets(query: unknown, { signal }: { signal?: AbortSignal } = {}): Promise<AssetSearchResponse> {
    const value = normalizedQuery(query);
    if (!value || value.length > 64) return [];
    if (signal?.aborted) return { ok: false, errorCode: 'request_aborted' };

    // Normalize first, but let established aliases such as BTC keep their local meaning.
    const direct = directSymbolResult(value);
    const local = ASSET_INDEX.find((asset) => asset.aliases.some((alias) => alias.toLocaleLowerCase() === value.toLocaleLowerCase()));
    if (local) {
      const { aliases, ...result } = local;
      return [{ ...result, source: 'local-index' }];
    }
    if (direct) return [direct];

    const tencentText = await fetchText(fetchImpl, buildTencentSuggestUrl(value), signal);
    if (tencentText === ABORTED) return { ok: false, errorCode: 'request_aborted' };
    const eastmoneyPayload = await fetchJson(fetchImpl, buildEastmoneySuggestUrl(value), EASTMONEY_FETCH_OPTIONS, signal);
    if (eastmoneyPayload === ABORTED) return { ok: false, errorCode: 'request_aborted' };
    const yahooPayload = await fetchJson(fetchImpl, buildYahooSearchUrl(value), undefined, signal);
    if (yahooPayload === ABORTED) return { ok: false, errorCode: 'request_aborted' };
    const tencentResults = parseTencentSuggest(tencentText);
    const eastmoneyResults = eastmoneyPayload ? parseEastmoneySuggest(eastmoneyPayload) : [];
    const yahooQuotes = isRecord(yahooPayload) && Array.isArray(yahooPayload.quotes) ? yahooPayload.quotes : [];
    const yahooResults = yahooQuotes.map(toYahooResult).filter((result): result is AssetSearchResult => result !== null);
    return mergeResults(tencentResults, eastmoneyResults, yahooResults);
  };
}
